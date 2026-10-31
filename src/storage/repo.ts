// Accès aux données. Toutes les écritures d'un import se font dans UNE transaction (tout ou rien).
import type { Card, CardMeta, Collection, TestSession } from '../domain/types';
import { newId } from '../domain/text';
import { applyRulesToDrafts, computeContentHash, type CardDraft } from '../imports/buildCards';
import type { CardContent } from '../library/cardForm';
import { planImport, type ImportPlan } from '../imports/importPlan';
import { introducedFromLog, newRemainingToday, planReview, sameQueue, type ReviewPlan } from '../review/queue';
import { applyRating, DEFAULT_NEW_PER_DAY, type ReviewLogEntry, type ReviewState } from '../review/schedule';
import { addMergeRules, applyLabelRules, LABEL_RULES_KEY, type LabelLevel, type LabelRule } from '../taxonomy/labelMerge';
import { buildTaxonomy, nodeDepth, nodeIdFor, pathKeyOf, ROOT_ID, scopeKeyBounds, segmentsOf } from '../taxonomy/tree';
import { applyTestFilters, NO_FILTERS, resolveScope } from '../tests/selection';
import { createSession, ratingOf, withDeadline } from '../tests/session';
import type { DB } from './db';

/**
 * Marque une requête comme « suivie » dès sa création : si la transaction est annulée avant que le Promise.all
 * final ne soit atteint (ex. erreur levée en construisant une écriture suivante), son rejet AbortError
 * n'est pas signalé comme promesse non gérée. L'erreur d'origine reste propagée par le try/catch appelant.
 */
function guard<T>(p: Promise<T>): Promise<T> {
  p.catch(() => undefined);
  return p;
}

/** Retire les propriétés undefined (IndexedDB conserve sinon des clés vides). */
function stripUndefined<T extends object>(obj: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

export function toMeta(c: Card): CardMeta {
  return stripUndefined({
    cardId: c.cardId,
    collectionId: c.collectionId,
    matiere: c.matiere,
    theme: c.theme,
    lecon: c.lecon,
    notion: c.notion,
    formatQuestion: c.formatQuestion,
    difficulte: c.difficulte,
    typePedagogique: c.typePedagogique,
    sourceRow: c.sourceRow,
  });
}

// ---------- Collections ----------

export async function listCollections(db: DB): Promise<Collection[]> {
  const all = await db.getAll('collections');
  return all.sort((a, b) => a.seq - b.seq);
}

// ---------- Cartes ----------

/**
 * Charge la projection légère de toutes les cartes, par lots, triée dans l'ordre de la bibliothèque
 * (ordre de création des collections, puis rang dans le fichier).
 * Les textes longs ne sont pas conservés en mémoire.
 */
export async function loadAllMeta(db: DB, batchSize = 1000): Promise<CardMeta[]> {
  const collections = await listCollections(db);
  const seq = new Map(collections.map((c) => [c.collectionId, c.seq]));
  const metas: CardMeta[] = [];
  let lastKey: string | undefined;
  for (;;) {
    const range = lastKey === undefined ? undefined : IDBKeyRange.lowerBound(lastKey, true);
    const batch = await db.getAll('cards', range, batchSize);
    for (const c of batch) metas.push(toMeta(c));
    if (batch.length < batchSize) break;
    lastKey = batch[batch.length - 1]!.cardId;
  }
  return sortLibraryOrder(metas, seq);
}

/** Ordre de la bibliothèque : ordre de création des collections, puis rang dans le fichier, puis identifiant. */
export function sortLibraryOrder(metas: CardMeta[], seq: ReadonlyMap<string, number>): CardMeta[] {
  return metas.sort(
    (a, b) =>
      (seq.get(a.collectionId) ?? Number.MAX_SAFE_INTEGER) - (seq.get(b.collectionId) ?? Number.MAX_SAFE_INTEGER) ||
      a.sourceRow - b.sourceRow ||
      (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0),
  );
}

/** Charge des cartes complètes dans l'ordre demandé ; les identifiants introuvables sont ignorés. */
export async function getCards(db: DB, ids: readonly string[]): Promise<Card[]> {
  const tx = db.transaction('cards', 'readonly');
  const found = await Promise.all(ids.map((id) => tx.store.get(id)));
  await tx.done;
  return found.filter((c): c is Card => c !== undefined);
}

export async function getCard(db: DB, id: string): Promise<Card | undefined> {
  return db.get('cards', id);
}

export async function getCardsOfCollection(db: DB, collectionId: string): Promise<Card[]> {
  return db.getAllFromIndex('cards', 'byCollection', collectionId);
}

export async function countCards(db: DB): Promise<number> {
  return db.count('cards');
}

/**
 * Supprime une carte et son état de mémorisation (même transaction).
 * L'historique des évaluations (reviewLog) et les sessions passées sont conservés.
 */
export async function deleteCard(db: DB, cardId: string): Promise<void> {
  const tx = db.transaction(['cards', 'reviewStates'], 'readwrite');
  await Promise.all([tx.objectStore('cards').delete(cardId), tx.objectStore('reviewStates').delete(cardId), tx.done]);
}

// ---------- Lot 3B : saisie et modification manuelles ----------

export const MANUAL_COLLECTION_NAME = "Cartes saisies dans l'application";
export const MANUAL_SOURCE = "Saisie dans l'application";

/** La carte a été modifiée ailleurs (autre onglet, import, fusion) depuis l'ouverture du formulaire : rien n'est écrit. */
export class CardConflictError extends Error {
  constructor(message = "Cette carte a été modifiée ailleurs depuis l'ouverture du formulaire.") {
    super(message);
    this.name = 'CardConflictError';
  }
}

/** Empreinte et chemin d'un contenu de carte (mêmes règles qu'à l'import). */
function derivedOf(content: CardContent): Pick<Card, 'pathKey' | 'contentHash'> {
  return { pathKey: pathKeyOf(content), contentHash: computeContentHash(content) };
}

/**
 * Ajoute une carte saisie dans l'application, en une transaction. Collection : une collection existante, ou la
 * collection « Cartes saisies dans l'application » (créée à la première carte). La carte est placée en fin de
 * collection (ordre de la bibliothèque) ; elle n'a pas d'identifiant source.
 */
export async function createCard(
  db: DB,
  req: { content: CardContent; collection: { kind: 'manual' } | { kind: 'existing'; collectionId: string }; now?: string },
): Promise<Card> {
  const now = req.now ?? new Date().toISOString();
  const tx = db.transaction(['cards', 'collections'], 'readwrite');
  try {
    const collections = tx.objectStore('collections');
    const all = await collections.getAll();
    let collection =
      req.collection.kind === 'existing' ? all.find((c) => c.collectionId === (req.collection as { collectionId: string }).collectionId) : all.find((c) => c.manual);
    if (req.collection.kind === 'existing' && !collection) throw new Error('Collection introuvable : la carte n’a pas été ajoutée.');
    if (!collection) {
      collection = {
        collectionId: newId(),
        name: MANUAL_COLLECTION_NAME,
        sourceFiles: [],
        createdAt: now,
        updatedAt: now,
        seq: all.reduce((max, c) => Math.max(max, c.seq), 0) + 1,
        manual: true,
      };
    }
    const siblings = await tx.objectStore('cards').index('byCollection').getAll(collection.collectionId);
    const card: Card = stripUndefined({
      ...req.content,
      ...derivedOf(req.content),
      cardId: newId(),
      collectionId: collection.collectionId,
      sourceRow: siblings.reduce((max, c) => Math.max(max, c.sourceRow), 0) + 1,
      sourceFile: MANUAL_SOURCE,
      createdAt: now,
      updatedAt: now,
    });
    await Promise.all([guard(collections.put({ ...collection, updatedAt: now })), guard(tx.objectStore('cards').add(card)), tx.done]);
    return card;
  } catch (err) {
    tx.done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // transaction déjà terminée ou annulée
    }
    throw err;
  }
}

/**
 * Modifie le contenu d'une carte, en une transaction :
 *  - identité et provenance conservées (cardId, collection, identifiant source, rang, fichier, date de création) ;
 *  - historique des révisions jamais modifié ; état de mémorisation conservé, ou supprimé (carte redevenue nouvelle)
 *    si `resetReview` — à n'utiliser qu'après le choix explicite de l'utilisatrice ;
 *  - contrôle de concurrence : la carte doit être celle chargée dans le formulaire (`expectedUpdatedAt`),
 *    sinon CardConflictError et rien n'est écrit.
 */
export async function updateCard(
  db: DB,
  req: { cardId: string; expectedUpdatedAt: string; content: CardContent; resetReview: boolean; now?: string },
): Promise<Card> {
  const now = req.now ?? new Date().toISOString();
  const tx = db.transaction(['cards', 'reviewStates'], 'readwrite');
  try {
    const cards = tx.objectStore('cards');
    const existing = await cards.get(req.cardId);
    if (!existing) throw new CardConflictError('Cette carte a été supprimée entre-temps.');
    if (existing.updatedAt !== req.expectedUpdatedAt) throw new CardConflictError();
    const card: Card = stripUndefined({
      ...req.content,
      ...derivedOf(req.content),
      cardId: existing.cardId,
      collectionId: existing.collectionId,
      externalId: existing.externalId,
      duplicateExternalId: existing.duplicateExternalId,
      sourceRow: existing.sourceRow,
      sourceFile: existing.sourceFile,
      createdAt: existing.createdAt,
      updatedAt: now,
      editedAt: now,
    });
    const ops: Promise<unknown>[] = [guard(cards.put(card))];
    if (req.resetReview) ops.push(guard(tx.objectStore('reviewStates').delete(card.cardId)));
    await Promise.all([...ops, tx.done]);
    return card;
  } catch (err) {
    tx.done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // transaction déjà terminée ou annulée
    }
    throw err;
  }
}

/** Supprime une collection et toutes ses cartes, atomiquement. Renvoie le nombre de cartes supprimées. */
export async function deleteCollection(db: DB, collectionId: string): Promise<number> {
  const tx = db.transaction(['cards', 'collections', 'reviewStates'], 'readwrite');
  const index = tx.objectStore('cards').index('byCollection');
  const states = tx.objectStore('reviewStates');
  let removed = 0;
  let cursor = await index.openCursor(IDBKeyRange.only(collectionId));
  while (cursor) {
    await states.delete(cursor.primaryKey);
    await cursor.delete();
    removed++;
    cursor = await cursor.continue();
  }
  await tx.objectStore('collections').delete(collectionId);
  await tx.done;
  return removed;
}

// ---------- Import ----------

export type ImportTarget = { kind: 'new'; name: string } | { kind: 'existing'; collectionId: string };

export interface ImportOutcome {
  collectionId: string;
  added: number;
  updated: number;
  unchanged: number;
  keptAbsent: number;
  /** Plan réellement appliqué (recalculé dans la transaction) */
  plan: ImportPlan;
  /** Lot 2 : nombre d'états de mémorisation réinitialisés à la demande de l'utilisatrice */
  reviewReset: number;
}

export interface CommitImportOptions {
  /**
   * Lot 2 (§3.4) : cartes MODIFIÉES dont l'utilisatrice a choisi de réinitialiser l'état de mémorisation,
   * carte par carte. Toutes les autres cartes gardent leur état et leurs échéances.
   */
  resetReviewFor?: readonly string[];
}

function draftToCard(d: CardDraft, collectionId: string, cardId: string, sourceFile: string, createdAt: string, now: string): Card {
  return stripUndefined({
    cardId,
    collectionId,
    externalId: d.externalId,
    matiere: d.matiere,
    theme: d.theme,
    lecon: d.lecon,
    notion: d.notion,
    typePedagogique: d.typePedagogique,
    difficulte: d.difficulte,
    formatQuestion: d.formatQuestion,
    question: d.question,
    rawQuestion: d.rawQuestion,
    options: d.options,
    correctOptionId: d.correctOptionId,
    reponse: d.reponse,
    explication: d.explication,
    astucePiege: d.astucePiege,
    sourceRow: d.sourceRow,
    pathKey: pathKeyOf(d),
    sourceFile,
    contentHash: d.contentHash,
    createdAt,
    updatedAt: now,
  });
}

/**
 * Importe des brouillons de cartes en UNE transaction (v1.1, I2) :
 * la comparaison avec la collection est refaite DANS la transaction d'écriture, sur l'état réel de la base.
 * IndexedDB exécutant l'une après l'autre deux transactions d'écriture sur les mêmes magasins,
 * deux imports simultanés du même fichier ne peuvent pas créer de doublon : le second voit les cartes du premier.
 * L'index unique (collectionId, externalId) sert de garde-fou supplémentaire.
 * En cas d'erreur, la transaction est annulée : la bibliothèque reste inchangée.
 */
export async function commitImport(
  db: DB,
  target: ImportTarget,
  fileName: string,
  drafts: CardDraft[],
  now: string = new Date().toISOString(),
  options: CommitImportOptions = {},
): Promise<ImportOutcome> {
  const tx = db.transaction(['cards', 'collections', 'reviewStates', 'settings'], 'readwrite');
  const collections = tx.objectStore('collections');
  const cards = tx.objectStore('cards');
  const reset = new Set(options.resetReviewFor ?? []);
  let reviewReset = 0;
  try {
    let collection: Collection;
    let existing: Card[] = [];
    if (target.kind === 'new') {
      const all = await collections.getAll();
      const seq = all.reduce((max, c) => Math.max(max, c.seq), 0) + 1;
      collection = {
        collectionId: newId(),
        name: target.name.trim() || fileName,
        sourceFiles: [fileName],
        createdAt: now,
        updatedAt: now,
        seq,
      };
    } else {
      const found = await collections.get(target.collectionId);
      if (!found) throw new Error('Collection introuvable : import annulé.');
      collection = { ...found, sourceFiles: [...found.sourceFiles, fileName], updatedAt: now };
      existing = await cards.index('byCollection').getAll(target.collectionId);
    }

    // Lot 3B : fusions de libellés mémorisées, relues dans la transaction (sans effet si l'aperçu les a déjà appliquées)
    const rulesRec = await tx.objectStore('settings').get(LABEL_RULES_KEY);
    const rules = Array.isArray(rulesRec?.value) ? (rulesRec.value as LabelRule[]) : [];
    const plan = planImport(applyRulesToDrafts(drafts, rules).drafts, existing);
    const ops: Promise<unknown>[] = [guard(collections.put(collection))];
    for (const d of plan.toAdd) {
      ops.push(guard(cards.add(draftToCard(d, collection.collectionId, newId(), fileName, now, now))));
    }
    for (const u of plan.toUpdate) {
      // cardId et date de création conservés : la progression future reste attachée à la carte
      ops.push(guard(cards.put(draftToCard(u.draft, collection.collectionId, u.existing.cardId, fileName, u.existing.createdAt, now))));
      // Réinitialisation demandée explicitement pour CETTE carte modifiée (jamais pour une carte inchangée)
      if (reset.has(u.existing.cardId)) {
        ops.push(guard(tx.objectStore('reviewStates').delete(u.existing.cardId)));
        reviewReset++;
      }
    }
    await Promise.all([...ops, tx.done]);
    return {
      collectionId: collection.collectionId,
      added: plan.toAdd.length,
      updated: plan.toUpdate.length,
      unchanged: plan.unchanged,
      keptAbsent: plan.keptAbsent,
      plan,
      reviewReset,
    };
  } catch (err) {
    tx.done.catch(() => undefined); // évite une promesse rejetée non gérée
    try {
      tx.abort();
    } catch {
      // transaction déjà terminée ou annulée
    }
    if ((err as { name?: string } | null)?.name === 'ConstraintError') {
      throw new Error('Conflit d’identifiant dans la collection (deux cartes avec le même ID source). Import annulé, aucune donnée modifiée.');
    }
    throw err;
  }
}

// ---------- Sessions de test ----------

/** Écriture inconditionnelle (création, outils et tests). Le déroulement d'un test utilise saveSessionTransition. */
export async function saveSession(db: DB, s: TestSession): Promise<void> {
  await db.put('sessions', stripUndefined(s));
}

/** La session enregistrée a changé depuis sa lecture (autre onglet) : l'écriture est refusée. */
export class StaleSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleSessionError';
  }
}

export function sessionRevision(s: Pick<TestSession, 'revision'>): number {
  return s.revision ?? 0;
}

/**
 * Enregistre une transition de test de façon CONDITIONNELLE (v1.1.1, concurrence entre onglets).
 * Dans une transaction lecture/écriture, l'écriture n'a lieu que si la base contient encore la session
 * « en cours » à la révision de départ (`next.revision - 1`). Sinon StaleSessionError, et rien n'est écrit :
 * une copie périmée ne peut ni réactiver une session abandonnée, ni écraser des réponses plus récentes.
 */
export async function saveSessionTransition(db: DB, next: TestSession): Promise<void> {
  const expected = sessionRevision(next) - 1;
  const tx = db.transaction('sessions', 'readwrite');
  try {
    const stored = await tx.store.get(next.sessionId);
    if (!stored) throw new StaleSessionError("Ce test n'existe plus.");
    if (stored.status === 'abandoned') {
      throw new StaleSessionError('Ce test a été remplacé par un nouveau test, peut-être dans un autre onglet.');
    }
    if (stored.status !== 'in_progress') throw new StaleSessionError('Ce test a déjà été terminé, peut-être dans un autre onglet.');
    if (sessionRevision(stored) !== expected) throw new StaleSessionError('Ce test a été modifié dans un autre onglet.');
    await Promise.all([tx.store.put(stripUndefined(next)), tx.done]);
  } catch (err) {
    tx.done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // transaction déjà terminée ou annulée
    }
    throw err;
  }
}

export async function getSession(db: DB, id: string): Promise<TestSession | undefined> {
  return db.get('sessions', id);
}

export async function getInProgressSessions(db: DB): Promise<TestSession[]> {
  const list = await db.getAllFromIndex('sessions', 'byStatus', 'in_progress');
  return list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Lot 3B : toutes les séances (statistiques). */
export async function listAllSessions(db: DB): Promise<TestSession[]> {
  return db.getAll('sessions');
}

export async function listFinishedSessions(db: DB, limit = 20): Promise<TestSession[]> {
  const list = await db.getAllFromIndex('sessions', 'byStatus', 'finished');
  return list.sort((a, b) => ((a.finishedAt ?? '') < (b.finishedAt ?? '') ? 1 : -1)).slice(0, limit);
}

/** Magasin « sessions » ouvert en écriture, quelle que soit la transaction qui le porte */
interface SessionStore {
  index(name: 'byStatus'): { getAll(query: string): Promise<TestSession[]> };
  put(value: TestSession): Promise<unknown>;
  add(value: TestSession): Promise<unknown>;
}

/**
 * Dans la transaction fournie : abandonne les sessions en cours (révision + 1) et ajoute la nouvelle.
 * `add` (et non put) : échoue si l'identifiant existe déjà, au lieu d'écraser une autre session.
 */
async function abandonRunningAndAdd(store: SessionStore, session: TestSession, now: string) {
  const running = await store.index('byStatus').getAll('in_progress');
  // La révision change aussi : une copie de ces sessions restée ouverte ailleurs ne pourra plus être enregistrée
  const ops: Promise<unknown>[] = running.map((s) => guard(store.put({ ...s, status: 'abandoned', updatedAt: now, revision: sessionRevision(s) + 1 })));
  ops.push(guard(store.add(stripUndefined(session))));
  return { ops, abandoned: running.length };
}

/**
 * Lance un nouveau test (correctif B2, v1.1) : dans UNE seule transaction, marque les sessions en cours
 * comme abandonnées et ajoute la nouvelle. Si l'ajout échoue, la transaction est annulée et
 * les anciennes sessions restent « en cours », avec leurs réponses.
 * Renvoie le nombre de sessions abandonnées.
 */
export async function startNewSession(
  db: DB,
  session: TestSession,
  now: string = new Date().toISOString(),
  /**
   * v0.2.2 (I2) : séances en cours dont le remplacement a été confirmé. Si fourni et que les séances en cours
   * ont changé depuis (autre onglet), SessionConflictError et rien n'est écrit. Non fourni : remplacement direct
   * (usage interne et tests).
   */
  confirmedReplace?: readonly string[],
): Promise<number> {
  if (session.status !== 'in_progress') throw new Error('La nouvelle session doit être « en cours ».');
  const tx = db.transaction('sessions', 'readwrite');
  try {
    if (confirmedReplace) {
      const running = await tx.store.index('byStatus').getAll('in_progress');
      if (!sameRunning(running, confirmedReplace)) throw new SessionConflictError(running.map(runningInfo));
    }
    const { ops, abandoned } = await abandonRunningAndAdd(tx.store, session, now);
    await Promise.all([...ops, tx.done]);
    return abandoned;
  } catch (err) {
    tx.done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // transaction déjà terminée ou annulée
    }
    throw err;
  }
}

// ---------- Révision programmée (lot 2) ----------

export async function loadReviewStates(db: DB): Promise<Map<string, ReviewState>> {
  const all = await db.getAll('reviewStates');
  return new Map(all.map((s) => [s.cardId, s]));
}

export async function getReviewState(db: DB, cardId: string): Promise<ReviewState | undefined> {
  return db.get('reviewStates', cardId);
}

export async function getReviewLogForCard(db: DB, cardId: string): Promise<ReviewLogEntry[]> {
  const list = await db.getAllFromIndex('reviewLog', 'byCard', cardId);
  // Ordre chronologique ; à horodatage égal, le premier passage précède sa reprise
  return list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : Number(a.repeat) - Number(b.repeat)));
}

/** Nombre de cartes introduites (vues nouvelles) le jour donné, d'après l'historique : voir introducedFromLog. */
export async function countIntroducedOn(db: DB, day: string): Promise<number> {
  return introducedFromLog(await db.getAllFromIndex('reviewLog', 'byDay', day), day);
}

export const NEW_PER_DAY_KEY = 'newCardsPerDay';
/** Lot 4 : date de la dernière sauvegarde exportée depuis cet appareil */
export const LAST_BACKUP_KEY = 'lastBackupAt';

export async function getNewPerDay(db: DB): Promise<number> {
  const v = await getSetting<number>(db, NEW_PER_DAY_KEY, DEFAULT_NEW_PER_DAY);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : DEFAULT_NEW_PER_DAY;
}

export async function setNewPerDay(db: DB, n: number): Promise<void> {
  if (!Number.isInteger(n) || n < 0 || n > 999) throw new Error('Le nombre de nouvelles cartes par jour doit être un entier entre 0 et 999.');
  await setSetting(db, NEW_PER_DAY_KEY, n);
}

interface RatedEntry {
  cardId: string;
  rating: NonNullable<ReturnType<typeof ratingOf>>;
  correct?: boolean;
  repeat: boolean;
}

/** Évaluations présentes dans `next` mais pas encore dans `stored` (en pratique : au plus une par transition). */
export function newlyRated(stored: TestSession, next: TestSession): RatedEntry[] {
  const out: RatedEntry[] = [];
  for (const id of next.cardIds) {
    const a = next.answers[id];
    const r = ratingOf(a);
    if (r && !ratingOf(stored.answers[id])) out.push({ cardId: id, rating: r, correct: a?.kind === 'mcq' ? a.correct : undefined, repeat: false });
  }
  for (const id of next.repeatIds ?? []) {
    const a = next.repeatAnswers?.[id];
    const r = ratingOf(a);
    if (r && !ratingOf(stored.repeatAnswers?.[id])) out.push({ cardId: id, rating: r, correct: a?.kind === 'mcq' ? a.correct : undefined, repeat: true });
  }
  return out;
}

/**
 * Enregistre une transition de RÉVISION PROGRAMMÉE (lot 2), dans UNE transaction :
 *  - mêmes contrôles que saveSessionTransition (session en cours, révision attendue, sinon StaleSessionError) ;
 *  - pour chaque nouvelle évaluation du premier passage : nouvel état de mémorisation calculé à partir de l'état
 *    EN BASE (applyRating) + ligne d'historique ;
 *  - pour une reprise de fin de séance : ligne d'historique seulement (l'échéance J+1 reste acquise).
 * Tout ou rien : la session, l'état et l'historique ne peuvent pas diverger.
 * Une carte supprimée entre-temps n'obtient pas d'état (pas d'orphelin) ; l'évaluation reste historisée.
 */
export async function saveRevisionTransition(db: DB, next: TestSession, today: string, nowIso: string = new Date().toISOString()): Promise<void> {
  if (next.mode !== 'revision') throw new Error('Seule une révision programmée modifie les échéances.');
  const expected = sessionRevision(next) - 1;
  const tx = db.transaction(['sessions', 'reviewStates', 'reviewLog', 'cards'], 'readwrite');
  try {
    const sessions = tx.objectStore('sessions');
    const stored = await sessions.get(next.sessionId);
    if (!stored) throw new StaleSessionError("Cette révision n'existe plus.");
    if (stored.status === 'abandoned') {
      throw new StaleSessionError('Cette révision a été remplacée par une autre séance, peut-être dans un autre onglet.');
    }
    if (stored.status !== 'in_progress') throw new StaleSessionError('Cette révision a déjà été terminée, peut-être dans un autre onglet.');
    if (sessionRevision(stored) !== expected) throw new StaleSessionError('Cette révision a été modifiée dans un autre onglet.');

    const states = tx.objectStore('reviewStates');
    const log = tx.objectStore('reviewLog');
    const ops: Promise<unknown>[] = [];
    for (const r of newlyRated(stored, next)) {
      const prev = await states.get(r.cardId);
      const exists = (await tx.objectStore('cards').count(r.cardId)) > 0;
      const after = r.repeat ? prev : applyRating(prev, r.cardId, r.rating, today, nowIso);
      if (!r.repeat && after && exists) ops.push(guard(states.put(after)));
      const entry: ReviewLogEntry = {
        logId: newId(),
        cardId: r.cardId,
        sessionId: next.sessionId,
        at: nowIso,
        day: today,
        rating: r.rating,
        repeat: r.repeat,
        ...(r.correct !== undefined ? { correct: r.correct } : {}),
        ...(prev ? { previousDueDay: prev.dueDay } : {}),
        intervalDays: after?.intervalDays ?? 0,
        dueDay: after?.dueDay ?? today,
      };
      ops.push(guard(log.add(entry)));
    }
    ops.push(guard(sessions.put(stripUndefined(next))));
    await Promise.all([...ops, tx.done]);
  } catch (err) {
    tx.done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // transaction déjà terminée ou annulée
    }
    throw err;
  }
}

/** Séance en cours, telle que présentée à l'utilisatrice avant confirmation de son remplacement */
export interface RunningSessionInfo {
  sessionId: string;
  scopeLabel: string;
  mode: TestSession['mode'];
}

/**
 * v0.2.2 (I2) : une séance est devenue active depuis que l'utilisatrice a été consultée (autre onglet).
 * Rien n'a été écrit ; il faut lui redemander de confirmer le remplacement de `running`.
 */
export class SessionConflictError extends Error {
  constructor(public readonly running: RunningSessionInfo[]) {
    super('Une autre séance a été lancée entre-temps.');
    this.name = 'SessionConflictError';
  }
}

const runningInfo = (s: TestSession): RunningSessionInfo => ({ sessionId: s.sessionId, scopeLabel: s.scopeLabel, mode: s.mode });

/**
 * Vrai si les séances en cours sont exactement celles dont le remplacement a été confirmé.
 * Comparaison par identité de séance : la progression d'une séance confirmée dans un autre onglet ne change pas
 * l'objet du consentement (ses réponses restent conservées quand elle est abandonnée).
 */
function sameRunning(running: TestSession[], confirmed: readonly string[]): boolean {
  const a = new Set(running.map((s) => s.sessionId));
  const b = new Set(confirmed);
  return a.size === b.size && [...a].every((id) => b.has(id));
}

export type ReviewLaunchResult =
  | { status: 'started'; session: TestSession; abandoned: number }
  /** La sélection affichée n'est plus valable : rien n'a été écrit, l'aperçu doit être actualisé */
  | { status: 'changed'; plan: ReviewPlan; reason: string }
  | { status: 'empty'; plan: ReviewPlan }
  /** v0.2.2 : des séances non confirmées sont en cours ; rien n'a été écrit, une nouvelle confirmation est requise */
  | { status: 'conflict'; running: RunningSessionInfo[] };

/**
 * Cartes d'un niveau d'après l'état ACTUEL de la base (v0.2.2, I1), dans l'ordre de la bibliothèque :
 * index `byPath` (clé exacte + intervalle des descendants), classement relu sur chaque carte.
 * Les cartes reclassées ailleurs en sont exclues, les cartes ajoutées au niveau y figurent.
 */
async function scopedMetasInTx(
  cards: { getAll(): Promise<Card[]>; index(name: 'byPath'): { getAll(query: IDBKeyRange): Promise<Card[]> } },
  collections: { getAll(): Promise<Collection[]> },
  nodeId: string,
): Promise<CardMeta[]> {
  let found: Card[];
  if (nodeId === ROOT_ID) {
    found = await cards.getAll();
  } else {
    const b = scopeKeyBounds(nodeId);
    const idx = cards.index('byPath');
    const [exact, below] = await Promise.all([idx.getAll(IDBKeyRange.only(b.exact)), idx.getAll(IDBKeyRange.bound(b.lower, b.upper))]);
    found = exact.concat(below);
  }
  const seq = new Map((await collections.getAll()).map((c) => [c.collectionId, c.seq]));
  return sortLibraryOrder(found.map(toMeta), seq);
}

/**
 * Lance une séance de révision en REVALIDANT, dans la transaction qui la crée (v0.2.1, complété en v0.2.2) :
 *  - le périmètre, reconstruit depuis la base (classement actuel des cartes, cartes ajoutées ou retirées) ;
 *  - les états de mémorisation, l'historique du jour (quota), le réglage « nouvelles cartes par jour », la date ;
 *  - les séances en cours : elles doivent être exactement celles dont l'utilisatrice a confirmé le remplacement
 *    (`confirmedReplace`, liste vide si elle n'en a vu aucune), sinon 'conflict'.
 * Résultats sans écriture : 'conflict', 'changed' (file différente de `expectedQueue`), 'empty'.
 * Sinon : abandon des séances confirmées et création de la nouvelle séance, atomiquement.
 * IndexedDB exécute l'une après l'autre les transactions d'écriture qui se recouvrent.
 */
export async function startReviewSession(
  db: DB,
  req: {
    nodeId: string;
    scopeLabel: string;
    expectedQueue: readonly string[];
    /** Identifiants des séances en cours dont le remplacement a été confirmé */
    confirmedReplace: readonly string[];
    today: string;
    now?: string;
  },
): Promise<ReviewLaunchResult> {
  const now = req.now ?? new Date().toISOString();
  const tx = db.transaction(['sessions', 'reviewStates', 'reviewLog', 'settings', 'cards', 'collections'], 'readwrite');
  try {
    const sessions = tx.objectStore('sessions');
    const running = await sessions.index('byStatus').getAll('in_progress');
    if (!sameRunning(running, req.confirmedReplace)) {
      await tx.done;
      return { status: 'conflict', running: running.map(runningInfo) };
    }

    const [scoped, stateList, dayLog, setting] = await Promise.all([
      scopedMetasInTx(tx.objectStore('cards'), tx.objectStore('collections'), req.nodeId),
      tx.objectStore('reviewStates').getAll(),
      tx.objectStore('reviewLog').index('byDay').getAll(req.today),
      tx.objectStore('settings').get(NEW_PER_DAY_KEY),
    ]);
    const states = new Map(stateList.map((st) => [st.cardId, st]));
    const rawPerDay = setting?.value;
    const newPerDay = typeof rawPerDay === 'number' && Number.isFinite(rawPerDay) && rawPerDay >= 0 ? Math.floor(rawPerDay) : DEFAULT_NEW_PER_DAY;
    const plan = planReview(scoped, states, req.today, newRemainingToday(introducedFromLog(dayLog, req.today), newPerDay));

    if (!sameQueue(plan.queue, req.expectedQueue)) {
      await tx.done;
      const reason =
        plan.queue.length !== req.expectedQueue.length
          ? `la séance compte maintenant ${plan.queue.length} carte(s) au lieu de ${req.expectedQueue.length}`
          : 'les cartes à réviser ont changé';
      return { status: 'changed', plan, reason };
    }
    if (plan.queue.length === 0) {
      await tx.done;
      return { status: 'empty', plan };
    }
    const session = createSession(
      { kind: 'node', nodeId: req.nodeId },
      `Révision — ${req.scopeLabel}`,
      { count: null, format: 'all', order: 'library' },
      plan.queue,
      now,
      'revision',
    );
    const { ops, abandoned } = await abandonRunningAndAdd(sessions, session, now);
    await Promise.all([...ops, tx.done]);
    return { status: 'started', session, abandoned };
  } catch (err) {
    tx.done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // transaction déjà terminée ou annulée
    }
    throw err;
  }
}

// ---------- Lot 3B : fusion explicite des libellés ----------

export type MergeResult =
  | { status: 'merged'; updated: number; rules: LabelRule[] }
  /** Les cartes concernées ne sont plus celles de l'aperçu (autre onglet, import…) : rien n'a été écrit */
  | { status: 'changed'; counts: Record<string, number> };

/** Cartes d'un niveau parent dont le libellé du type `level`, juste sous ce parent, figure dans `labels`. */
function mergeTarget(card: Card, parentId: string, level: LabelLevel, labels: ReadonlySet<string>): boolean {
  const segs = segmentsOf(card);
  const depth = nodeDepth(parentId);
  const seg = segs[depth];
  if (!seg || seg.kind !== level || !labels.has(seg.label)) return false;
  return depth === 0 || nodeIdFor(segs.slice(0, depth)) === parentId;
}

/**
 * Fusionne, sous le niveau `parentId`, les libellés `from` (type `level`) en `to`, en UNE transaction :
 *  - revalidation : nombre de cartes par libellé identique à l'aperçu (`expectedCounts`), sinon 'changed' sans écriture ;
 *  - chaque carte concernée change de classement (chemin et empreinte recalculés) ; identifiant, collection,
 *    provenance, état de mémorisation et historique inchangés ;
 *  - la fusion est mémorisée (règles appliquées aux importations suivantes).
 * Jamais déclenchée automatiquement : seulement sur confirmation explicite de l'utilisatrice.
 */
export async function mergeLabels(
  db: DB,
  req: { parentId: string; level: LabelLevel; from: string[]; to: string; expectedCounts: Record<string, number>; now?: string },
): Promise<MergeResult> {
  const now = req.now ?? new Date().toISOString();
  const to = req.to.replace(/\s+/g, ' ').trim();
  if (!to) throw new Error('Le libellé cible est vide.');
  const from = [...new Set(req.from)];
  if (from.length === 0 || from.every((f) => f === to)) throw new Error('Aucun libellé à remplacer.');
  if (req.level === 'matiere' ? req.parentId !== ROOT_ID : req.parentId === ROOT_ID) throw new Error('Niveau parent incohérent.');
  const labels = new Set(from);
  const tx = db.transaction(['cards', 'settings'], 'readwrite');
  try {
    const cards = tx.objectStore('cards');
    let candidates: Card[];
    if (req.parentId === ROOT_ID) candidates = await cards.getAll();
    else {
      const b = scopeKeyBounds(req.parentId);
      const idx = cards.index('byPath');
      candidates = await idx.getAll(IDBKeyRange.bound(b.lower, b.upper));
    }
    const affected = candidates.filter((c) => mergeTarget(c, req.parentId, req.level, labels));
    const counts: Record<string, number> = Object.fromEntries(from.map((f) => [f, 0]));
    for (const c of affected) {
      const l = segmentsOf(c)[nodeDepth(req.parentId)]!.label;
      counts[l] = (counts[l] ?? 0) + 1;
    }
    const expected = Object.fromEntries(from.map((f) => [f, req.expectedCounts[f] ?? 0]));
    if (from.some((f) => counts[f] !== expected[f])) {
      await tx.done;
      return { status: 'changed', counts };
    }
    const settings = tx.objectStore('settings');
    const rec = await settings.get(LABEL_RULES_KEY);
    const rules = addMergeRules(Array.isArray(rec?.value) ? (rec.value as LabelRule[]) : [], {
      level: req.level,
      parentId: req.parentId,
      from,
      to,
      at: now,
    });
    const single: LabelRule[] = from.filter((f) => f !== to).map((f) => ({ level: req.level, parentId: req.parentId, from: f, to, at: now }));
    const ops: Promise<unknown>[] = [guard(settings.put({ key: LABEL_RULES_KEY, value: rules }))];
    let updated = 0;
    for (const c of affected) {
      const moved = applyLabelRules(c, single);
      if (moved === c) continue;
      const { contentHash: _h, pathKey: _p, ...rest } = moved;
      ops.push(guard(cards.put({ ...rest, pathKey: pathKeyOf(moved), contentHash: computeContentHash(moved), updatedAt: now, editedAt: now })));
      updated++;
    }
    await Promise.all([...ops, tx.done]);
    return { status: 'merged', updated, rules };
  } catch (err) {
    tx.done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // transaction déjà terminée ou annulée
    }
    throw err;
  }
}

/** Fusions mémorisées (appliquées aux importations). */
export async function getLabelRules(db: DB): Promise<LabelRule[]> {
  const v = await getSetting<unknown>(db, LABEL_RULES_KEY, []);
  return Array.isArray(v) ? (v as LabelRule[]) : [];
}

/** Retire une fusion mémorisée : seules les importations futures sont concernées, les cartes ne changent pas. */
export async function forgetLabelRule(db: DB, rule: Pick<LabelRule, 'level' | 'parentId' | 'from'>): Promise<void> {
  const tx = db.transaction('settings', 'readwrite');
  const rec = await tx.store.get(LABEL_RULES_KEY);
  const rules = (Array.isArray(rec?.value) ? (rec.value as LabelRule[]) : []).filter(
    (r) => !(r.level === rule.level && r.parentId === rule.parentId && r.from === rule.from),
  );
  await Promise.all([tx.store.put({ key: LABEL_RULES_KEY, value: rules }), tx.done]);
}

// ---------- Test libre : lancement revalidé (v0.3.0-a1, I2) ----------

export type TestLaunchResult =
  /** `session` : la séance enregistrée (avec son échéance absolue si elle est à temps limité, v0.3.0-a2) */
  | { status: 'started'; abandoned: number; session: TestSession }
  /** Les cartes éligibles ne sont plus celles de l'aperçu (autre onglet, import…) : rien n'a été écrit */
  | { status: 'changed'; eligibleCount: number; expectedCount: number; reason: string }
  /** Des séances non confirmées sont en cours : rien n'a été écrit, une nouvelle confirmation est requise */
  | { status: 'conflict'; running: RunningSessionInfo[] };

/**
 * Lance un test libre en REVALIDANT, dans la transaction qui le crée, la sélection présentée à l'utilisatrice :
 *  - périmètre reconstruit depuis les cartes actuelles (classement relu, cartes ajoutées, modifiées ou supprimées) ;
 *  - filtres (format, difficulté, type, statut de maîtrise) appliqués aux cartes et aux états de mémorisation actuels ;
 *  - l'ensemble des cartes éligibles doit être exactement `expectedEligible` (celui de l'aperçu), et les cartes
 *    tirées doivent en faire partie ; sinon 'changed' et rien n'est écrit ;
 *  - séances en cours : exactement celles dont le remplacement a été confirmé, sinon 'conflict'.
 * Aucune écriture dans les états de mémorisation ni l'historique : la répétition espacée n'est pas concernée.
 * v0.3.0-a2 : un test à temps limité reçoit ici, dans la même écriture, son échéance absolue (`now` + limite).
 */
export async function startTestSession(
  db: DB,
  req: {
    /** Séance construite d'après l'aperçu (périmètre, réglages, cartes tirées) */
    session: TestSession;
    /** Identifiants des cartes éligibles affichées dans l'aperçu */
    expectedEligible: readonly string[];
    confirmedReplace: readonly string[];
    now?: string;
  },
): Promise<TestLaunchResult> {
  const { session } = req;
  if (session.status !== 'in_progress' || session.mode !== 'libre') throw new Error('La nouvelle séance doit être un test libre « en cours ».');
  const now = req.now ?? new Date().toISOString();
  const tx = db.transaction(['sessions', 'cards', 'reviewStates'], 'readwrite');
  try {
    const sessions = tx.objectStore('sessions');
    const running = await sessions.index('byStatus').getAll('in_progress');
    if (!sameRunning(running, req.confirmedReplace)) {
      await tx.done;
      return { status: 'conflict', running: running.map(runningInfo) };
    }
    const [cards, stateList] = await Promise.all([tx.objectStore('cards').getAll(), tx.objectStore('reviewStates').getAll()]);
    const metas = cards.map(toMeta);
    const scoped = resolveScope(session.scope, buildTaxonomy(metas), metas);
    const { eligible } = applyTestFilters(
      scoped,
      { format: session.config.format, filters: session.config.filters ?? NO_FILTERS },
      new Map(stateList.map((st) => [st.cardId, st])),
    );
    const current = new Set(eligible.map((m) => m.cardId));
    const expected = new Set(req.expectedEligible);
    const same = current.size === expected.size && [...expected].every((id) => current.has(id));
    if (!same || !session.cardIds.every((id) => current.has(id))) {
      await tx.done;
      const reason =
        current.size !== expected.size
          ? `le test compterait maintenant ${current.size} carte(s) éligible(s) au lieu de ${expected.size}`
          : 'les cartes répondant aux critères ont changé';
      return { status: 'changed', eligibleCount: current.size, expectedCount: expected.size, reason };
    }
    const stored = withDeadline(session, now);
    const { ops, abandoned } = await abandonRunningAndAdd(sessions, stored, now);
    await Promise.all([...ops, tx.done]);
    return { status: 'started', abandoned, session: stored };
  } catch (err) {
    tx.done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // transaction déjà terminée ou annulée
    }
    throw err;
  }
}

// ---------- Paramètres ----------

export async function getSetting<T>(db: DB, key: string, fallback: T): Promise<T> {
  const rec = await db.get('settings', key);
  return rec === undefined ? fallback : (rec.value as T);
}

export async function setSetting(db: DB, key: string, value: unknown): Promise<void> {
  await db.put('settings', { key, value });
}
