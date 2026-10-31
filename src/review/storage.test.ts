// Tests d'intégration du lot 2 : persistance de la révision, isolement du test libre, imports, suppression,
// migration v2 → v3, export, et scénario de recette du cahier des charges.
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Card, TestSession } from '../domain/types';
import { buildBackup } from '../backup/export';
import { buildCards } from '../imports/buildCards';
import { autoDetectMapping } from '../imports/columnMapping';
import { parseCsvBytes } from '../imports/csvParse';
import { openFlashcardsDb, type DB } from '../storage/db';
import * as repo from '../storage/repo';
import { buildTaxonomy, nodeIdFor, ROOT_ID } from '../taxonomy/tree';
import { applyFilters, drawCards, resolveScope } from '../tests/selection';
import { advance, createSession, gradeMcq, rateMcq, recordAnswer, selfEvaluate } from '../tests/session';
import { SessionController } from '../tests/sessionController';
import { newRemainingToday, planReview } from './queue';
import { addDays } from './schedule';

let n = 0;
const fresh = () => openFlashcardsDb(`lot2-${++n}`);
const D = '2026-10-30';
const NOW = '2026-10-30T09:00:00.000Z';
const M = { externalId: 0, matiere: 1, question: 2, reponse: 3 } as const;

async function importRows(db: DB, rows: string[][], name = 'C') {
  return repo.commitImport(db, { kind: 'new', name }, `${name}.csv`, buildCards(rows, M, {}).drafts);
}
const revision = (ids: string[]) =>
  createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: null, format: 'all', order: 'library' }, ids, NOW, 'revision');
/** Contrôleur de révision branché sur le stockage réel, à une date donnée */
const reviewCtl = (db: DB, s: TestSession, day: string) => new SessionController(s, (x) => repo.saveRevisionTransition(db, x, day, `${day}T09:00:00.000Z`));

async function idsByExt(db: DB, collectionId: string): Promise<Record<string, string>> {
  return Object.fromEntries((await repo.getCardsOfCollection(db, collectionId)).map((c) => [c.externalId!, c.cardId]));
}

describe('enregistrement d’une révision', () => {
  it('une évaluation crée l’état de mémorisation et une ligne d’historique, dans la même transaction', async () => {
    const db = await fresh();
    const out = await importRows(db, [['X1', 'Calcul', 'Q1', 'R1']]);
    const id = (await idsByExt(db, out.collectionId))['X1']!;
    const s = revision([id]);
    await repo.startNewSession(db, s, NOW);
    const ctl = reviewCtl(db, s, D);
    expect((await ctl.apply(advance(recordAnswer(s, id, selfEvaluate('good', NOW)), NOW))).status).toBe('saved');
    expect(await repo.getReviewState(db, id)).toMatchObject({ status: 'review', intervalDays: 3, dueDay: '2026-11-02', firstReviewedDay: D });
    const log = await repo.getReviewLogForCard(db, id);
    expect(log).toEqual([expect.objectContaining({ rating: 'good', repeat: false, dueDay: '2026-11-02', sessionId: s.sessionId })]);
    expect((await repo.getSession(db, s.sessionId))!.status).toBe('finished');
  });

  it('QCM faux → « À revoir » J+1 ; reprise en fin de séance historisée sans changer l’échéance', async () => {
    const db = await fresh();
    const out = await repo.commitImport(
      db,
      { kind: 'new', name: 'C' },
      'c.csv',
      buildCards([['Q1', 'Q ?\nA) un  B) deux', 'B']], { externalId: 0, question: 1, reponse: 2 }, { matiere: 'Calcul' }).drafts,
    );
    const card = (await repo.getCardsOfCollection(db, out.collectionId))[0]!;
    let s = revision([card.cardId]);
    await repo.startNewSession(db, s, NOW);
    const ctl = reviewCtl(db, s, D);
    s = (await ctl.apply(recordAnswer(s, card.cardId, gradeMcq(card, 'A', NOW, 'revision'))) as { session: TestSession }).session;
    expect(await repo.getReviewState(db, card.cardId)).toMatchObject({ lastRating: 'again', dueDay: '2026-10-31', lapses: 1 });
    s = (await ctl.apply(advance(s, NOW)) as { session: TestSession }).session; // passage à la reprise
    s = (await ctl.apply(recordAnswer(s, card.cardId, gradeMcq(card, 'B', NOW, 'revision'))) as { session: TestSession }).session;
    s = (await ctl.apply(advance(rateMcq(s, card.cardId, 'easy', NOW), NOW)) as { session: TestSession }).session;
    expect(s.status).toBe('finished');
    expect(await repo.getReviewState(db, card.cardId)).toMatchObject({ lastRating: 'again', dueDay: '2026-10-31', reviewCount: 1 });
    const log = await repo.getReviewLogForCard(db, card.cardId);
    expect(log.map((l) => [l.rating, l.repeat, l.correct])).toEqual([
      ['again', false, false],
      ['easy', true, true],
    ]);
  });

  it('QCM juste : l’échéance n’est fixée qu’une fois la maîtrise notée', async () => {
    const db = await fresh();
    const out = await repo.commitImport(
      db,
      { kind: 'new', name: 'C' },
      'c.csv',
      buildCards([['Q1', 'Q ?\nA) un  B) deux', 'B']], { externalId: 0, question: 1, reponse: 2 }, { matiere: 'Calcul' }).drafts,
    );
    const card = (await repo.getCardsOfCollection(db, out.collectionId))[0]!;
    let s = revision([card.cardId]);
    await repo.startNewSession(db, s, NOW);
    const ctl = reviewCtl(db, s, D);
    s = (await ctl.apply(recordAnswer(s, card.cardId, gradeMcq(card, 'B', NOW, 'revision'))) as { session: TestSession }).session;
    expect(await repo.getReviewState(db, card.cardId)).toBeUndefined();
    await ctl.apply(advance(rateMcq(s, card.cardId, 'hard', NOW), NOW));
    expect(await repo.getReviewState(db, card.cardId)).toMatchObject({ lastRating: 'hard', status: 'learning', dueDay: '2026-10-31' });
  });

  it('échec d’écriture : ni session, ni état, ni historique ; le réessai n’applique l’évaluation qu’une fois', async () => {
    const name = `lot2-${++n}`;
    let db = await openFlashcardsDb(name);
    const out = await importRows(db, [['X1', 'Calcul', 'Q1', 'R1']]);
    const id = (await idsByExt(db, out.collectionId))['X1']!;
    const s = revision([id]);
    await repo.startNewSession(db, s, NOW);
    const ctl = new SessionController(s, (x) => repo.saveRevisionTransition(db, x, D, NOW));
    db.close();
    const next = advance(recordAnswer(s, id, selfEvaluate('easy', NOW)), NOW);
    expect((await ctl.apply(next)).status).toBe('failed');
    db = await openFlashcardsDb(name);
    expect(await repo.getReviewState(db, id)).toBeUndefined();
    expect(await repo.getReviewLogForCard(db, id)).toEqual([]);
    expect((await ctl.retry()).status).toBe('saved');
    expect(await repo.getReviewState(db, id)).toMatchObject({ reviewCount: 1, intervalDays: 7 });
    expect(await repo.getReviewLogForCard(db, id)).toHaveLength(1);
  });

  it('copie périmée (autre onglet) : refusée, l’état de mémorisation n’est pas modifié', async () => {
    const db = await fresh();
    const out = await importRows(db, [['X1', 'Calcul', 'Q1', 'R1']]);
    const id = (await idsByExt(db, out.collectionId))['X1']!;
    const s = revision([id]);
    await repo.startNewSession(db, s, NOW);
    await repo.startNewSession(db, revision([id]), NOW); // une autre séance remplace la première
    const res = await reviewCtl(db, s, D).apply(recordAnswer(s, id, selfEvaluate('easy', NOW)));
    expect(res).toMatchObject({ status: 'failed', stale: true });
    expect(await repo.getReviewState(db, id)).toBeUndefined();
  });

  it('refuse d’enregistrer une session de test libre comme une révision', async () => {
    const db = await fresh();
    const libre = createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', { count: 1, format: 'all', order: 'random' }, ['a']);
    await expect(repo.saveRevisionTransition(db, libre, D)).rejects.toThrow();
  });
});

describe('isolement du test libre', () => {
  it('un test libre ne crée ni ne modifie aucun état de mémorisation', async () => {
    const db = await fresh();
    const out = await importRows(db, [
      ['X1', 'Calcul', 'Q1', 'R1'],
      ['X2', 'Calcul', 'Q2', 'R2'],
    ]);
    const ids = await idsByExt(db, out.collectionId);
    // X1 a déjà une échéance
    const r = revision([ids['X1']!]);
    await repo.startNewSession(db, r, NOW);
    await reviewCtl(db, r, D).apply(advance(recordAnswer(r, ids['X1']!, selfEvaluate('good', NOW)), NOW));
    const before = await repo.loadReviewStates(db);

    let t = createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', { count: 2, format: 'all', order: 'library' }, [ids['X1']!, ids['X2']!], NOW);
    await repo.startNewSession(db, t, NOW);
    const ctl = new SessionController(t, (x) => repo.saveSessionTransition(db, x));
    t = (await ctl.apply(advance(recordAnswer(t, ids['X1']!, selfEvaluate('again', NOW)), NOW)) as { session: TestSession }).session;
    await ctl.apply(advance(recordAnswer(t, ids['X2']!, selfEvaluate('easy', NOW)), NOW));

    expect(await repo.loadReviewStates(db)).toEqual(before);
    expect(await repo.getReviewLogForCard(db, ids['X1']!)).toHaveLength(1);
    expect(await repo.getReviewLogForCard(db, ids['X2']!)).toEqual([]);
  });
});

describe('imports, suppressions et états de mémorisation', () => {
  it('importer un nouveau CSV ne touche à aucune échéance existante', async () => {
    const db = await fresh();
    const out = await importRows(db, [['X1', 'Calcul', 'Q1', 'R1']], 'A');
    const id = (await idsByExt(db, out.collectionId))['X1']!;
    const r = revision([id]);
    await repo.startNewSession(db, r, NOW);
    await reviewCtl(db, r, D).apply(advance(recordAnswer(r, id, selfEvaluate('easy', NOW)), NOW));
    const before = await repo.loadReviewStates(db);
    await importRows(db, [['X1', 'Anglais', 'Q autre', 'R']], 'B'); // même ID source, autre collection
    const reimport = await repo.commitImport(db, { kind: 'existing', collectionId: out.collectionId }, 'A.csv', buildCards([['X1', 'Calcul', 'Q1', 'R1']], M, {}).drafts);
    expect(reimport.unchanged).toBe(1);
    expect(await repo.loadReviewStates(db)).toEqual(before);
  });

  it('carte modifiée : réinitialisation de l’état pour CETTE carte seulement, sur demande', async () => {
    const db = await fresh();
    const out = await importRows(db, [
      ['X1', 'Calcul', 'Q1', 'R1'],
      ['X2', 'Calcul', 'Q2', 'R2'],
      ['X3', 'Calcul', 'Q3', 'R3'],
    ]);
    const ids = await idsByExt(db, out.collectionId);
    let r = revision([ids['X1']!, ids['X2']!, ids['X3']!]);
    await repo.startNewSession(db, r, NOW);
    const ctl = reviewCtl(db, r, D);
    for (const x of ['X1', 'X2', 'X3']) r = (await ctl.apply(advance(recordAnswer(r, ids[x]!, selfEvaluate('good', NOW)), NOW)) as { session: TestSession }).session;

    // X1 et X2 modifiées ; réinitialisation demandée pour X1 et pour X3 (inchangée → ignorée)
    const v2 = buildCards(
      [
        ['X1', 'Calcul', 'Q1', 'R1 corrigée'],
        ['X2', 'Calcul', 'Q2', 'R2 corrigée'],
        ['X3', 'Calcul', 'Q3', 'R3'],
      ],
      M,
      {},
    ).drafts;
    const res = await repo.commitImport(db, { kind: 'existing', collectionId: out.collectionId }, 'v2.csv', v2, NOW, {
      resetReviewFor: [ids['X1']!, ids['X3']!],
    });
    expect(res).toMatchObject({ updated: 2, unchanged: 1, reviewReset: 1 });
    const states = await repo.loadReviewStates(db);
    expect(states.has(ids['X1']!)).toBe(false); // redevenue nouvelle
    expect(states.get(ids['X2']!)).toMatchObject({ intervalDays: 3 }); // état conservé (choix par défaut)
    expect(states.get(ids['X3']!)).toMatchObject({ intervalDays: 3 }); // inchangée : jamais réinitialisée
    expect(await repo.getReviewLogForCard(db, ids['X1']!)).toHaveLength(1); // historique conservé
  });

  it('supprimer une carte ou une collection retire l’état mais conserve l’historique', async () => {
    const db = await fresh();
    const a = await importRows(db, [['X1', 'Calcul', 'Q1', 'R1']], 'A');
    const b = await importRows(db, [['Y1', 'Anglais', 'Q', 'R']], 'B');
    const x1 = (await idsByExt(db, a.collectionId))['X1']!;
    const y1 = (await idsByExt(db, b.collectionId))['Y1']!;
    let r = revision([x1, y1]);
    await repo.startNewSession(db, r, NOW);
    const ctl = reviewCtl(db, r, D);
    r = (await ctl.apply(advance(recordAnswer(r, x1, selfEvaluate('good', NOW)), NOW)) as { session: TestSession }).session;
    await ctl.apply(advance(recordAnswer(r, y1, selfEvaluate('good', NOW)), NOW));
    await repo.deleteCard(db, x1);
    await repo.deleteCollection(db, b.collectionId);
    expect((await repo.loadReviewStates(db)).size).toBe(0);
    expect(await repo.getReviewLogForCard(db, x1)).toHaveLength(1);
    expect(await repo.getReviewLogForCard(db, y1)).toHaveLength(1);
  });
});

describe('migration v2 → v3 et export', () => {
  it('ajoute les magasins de révision sans toucher aux données du lot 1', async () => {
    const name = `lot2-mig-${++n}`;
    const v2 = await openDB(name, 2, {
      upgrade(d) {
        const s = d.createObjectStore('cards', { keyPath: 'cardId' });
        s.createIndex('byCollection', 'collectionId');
        s.createIndex('byCollectionExternal', ['collectionId', 'externalId'], { unique: true });
        s.createIndex('byMatiere', 'matiere');
        s.createIndex('byPath', 'pathKey');
        d.createObjectStore('collections', { keyPath: 'collectionId' });
        d.createObjectStore('sessions', { keyPath: 'sessionId' }).createIndex('byStatus', 'status');
        d.createObjectStore('settings', { keyPath: 'key' });
      },
    });
    const card = { cardId: 'c1', collectionId: 'col', externalId: 'X', matiere: 'M', formatQuestion: 'open', question: 'Q', rawQuestion: 'Q', reponse: 'R', sourceRow: 1, pathKey: 'm:M', sourceFile: 'f', contentHash: 'h', createdAt: 't', updatedAt: 't' };
    await v2.put('cards', card);
    await v2.put('collections', { collectionId: 'col', name: 'C', sourceFiles: ['f'], createdAt: 't', updatedAt: 't', seq: 1 });
    const session = { ...createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', { count: 1, format: 'all', order: 'random' }, ['c1'], 't'), sessionId: 's1' };
    await v2.put('sessions', session);
    await v2.put('settings', { key: 'lastScope', value: { nodeId: 'root', label: 'x' } });
    v2.close();

    const db = await openFlashcardsDb(name);
    expect(db.version).toBe(3);
    expect(await db.get('cards', 'c1')).toEqual(card);
    expect(await db.get('sessions', 's1')).toEqual(session);
    expect(await db.count('collections')).toBe(1);
    expect(await db.count('settings')).toBe(1);
    expect(await db.count('reviewStates')).toBe(0);
    expect(await db.count('reviewLog')).toBe(0);
    // La révision fonctionne immédiatement sur les données migrées
    const r = revision(['c1']);
    await repo.startNewSession(db, r, NOW);
    await reviewCtl(db, r, D).apply(advance(recordAnswer(r, 'c1', selfEvaluate('good', NOW)), NOW));
    expect(await repo.getReviewState(db, 'c1')).toMatchObject({ dueDay: '2026-11-02' });
  });

  it('l’export (format 2, puis 3 au lot 4) contient les états et l’historique', async () => {
    const db = await fresh();
    const out = await importRows(db, [['X1', 'Calcul', 'Q1', 'R1']]);
    const id = (await idsByExt(db, out.collectionId))['X1']!;
    const r = revision([id]);
    await repo.startNewSession(db, r, NOW);
    await reviewCtl(db, r, D).apply(advance(recordAnswer(r, id, selfEvaluate('easy', NOW)), NOW));
    const b = await buildBackup(db, 'now');
    expect(b).toMatchObject({ version: 3, counts: { cards: 1, reviewStates: 1, reviewLog: 1 } }); // lot 4 : format 3
    expect(b.reviewStates[0]).toMatchObject({ cardId: id, intervalDays: 7 });
  });

  it('nouvelles cartes par jour : 20 par défaut, modifiable, valeurs invalides refusées', async () => {
    const db = await fresh();
    expect(await repo.getNewPerDay(db)).toBe(20);
    await repo.setNewPerDay(db, 5);
    expect(await repo.getNewPerDay(db)).toBe(5);
    await expect(repo.setNewPerDay(db, -1)).rejects.toThrow();
    await expect(repo.setNewPerDay(db, 2.5)).rejects.toThrow();
  });
});

describe('recette du lot 2 (cahier des charges)', () => {
  it('3 matières, échéances, fermeture/réouverture, nouvel import, test libre sans effet', async () => {
    const name = `lot2-recette-${++n}`;
    let db = await openFlashcardsDb(name);
    const ref = parseCsvBytes(new Uint8Array(readFileSync(new URL('../../fixtures/mini_reference_fictif.csv', import.meta.url))));
    await repo.commitImport(db, { kind: 'new', name: 'Mini' }, 'mini.csv', buildCards(ref.rows, autoDetectMapping(ref.headers), {}, { rowNumbers: ref.rowNumbers }).drafts);
    await importRows(db, [['A1', 'Anglais', 'Q a1', 'R'], ['A2', 'Anglais', 'Q a2', 'R'], ['E1', 'Économie', 'Q e1', 'R'], ['E2', 'Économie', 'Q e2', 'R']], 'AE');

    // Jour 1 : séance « Réviser aujourd'hui » sur toute la bibliothèque, plafond 4 nouvelles cartes
    await repo.setNewPerDay(db, 4);
    let metas = await repo.loadAllMeta(db);
    let tax = buildTaxonomy(metas);
    let states = await repo.loadReviewStates(db);
    const plan1 = planReview(resolveScope({ kind: 'node', nodeId: ROOT_ID }, tax, metas), states, D, newRemainingToday(await repo.countIntroducedOn(db, D), await repo.getNewPerDay(db)));
    expect(plan1.due).toEqual([]);
    expect(plan1.fresh).toHaveLength(4);
    const matieres = new Set(plan1.fresh.map((id) => metas.find((m) => m.cardId === id)!.matiere));
    expect(matieres).toEqual(new Set(['Calcul', 'Raisonnement', 'Anglais', 'Économie'])); // aucune matière exclue

    let s = revision(plan1.queue);
    await repo.startNewSession(db, s, NOW);
    const ctl = reviewCtl(db, s, D);
    const notes = ['good', 'easy', 'hard', 'again'] as const;
    const cards = await repo.getCards(db, plan1.queue);
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i]!;
      const ans = c.formatQuestion === 'mcq' ? gradeMcq(c, c.correctOptionId!, NOW, 'revision') : selfEvaluate(notes[i]!, NOW);
      s = (await ctl.apply(recordAnswer(s, c.cardId, ans)) as { session: TestSession }).session;
      if (c.formatQuestion === 'mcq') s = (await ctl.apply(rateMcq(s, c.cardId, 'good', NOW)) as { session: TestSession }).session;
      s = (await ctl.apply(advance(s, NOW)) as { session: TestSession }).session;
    }
    // Reprises de fin de séance éventuelles (« À revoir »)
    while (s.status === 'in_progress') s = (await ctl.apply(advance(recordAnswer(s, s.repeatIds![s.currentIndex - s.cardIds.length]!, selfEvaluate('good', NOW)), NOW)) as { session: TestSession }).session;

    states = await repo.loadReviewStates(db);
    expect(states.size).toBe(4);
    const dueDays = [...states.values()].map((x) => x.dueDay).sort();
    expect(dueDays.every((d) => d > D)).toBe(true);
    // Le plafond du jour est atteint : plus aucune nouvelle carte aujourd'hui, dans aucun périmètre
    expect(newRemainingToday(await repo.countIntroducedOn(db, D), 4)).toBe(0);

    // Fermeture / réouverture
    db.close();
    db = await openFlashcardsDb(name);
    const reopened = await repo.loadReviewStates(db);
    expect(reopened).toEqual(states);

    // Nouvel import : échéances intactes
    await importRows(db, [['N1', 'Histoire', 'Q', 'R']], 'H');
    expect(await repo.loadReviewStates(db)).toEqual(states);

    // Test libre sur toute la bibliothèque : échéances intactes
    metas = await repo.loadAllMeta(db);
    tax = buildTaxonomy(metas);
    const ids = drawCards(applyFilters(resolveScope({ kind: 'node', nodeId: ROOT_ID }, tax, metas), { format: 'open' }).eligible, { count: 3, format: 'open', order: 'library' });
    let t = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: 3, format: 'open', order: 'library' }, ids, NOW);
    await repo.startNewSession(db, t, NOW);
    const tctl = new SessionController(t, (x) => repo.saveSessionTransition(db, x));
    for (const id of ids) t = (await tctl.apply(advance(recordAnswer(t, id, selfEvaluate('again', NOW)), NOW)) as { session: TestSession }).session;
    expect(await repo.loadReviewStates(db)).toEqual(states);

    // Le lendemain : les cartes « Difficile » et « À revoir » (J+1) sont dues, ciblées par matière
    const tomorrow = addDays(D, 1);
    const plan2 = planReview(resolveScope({ kind: 'node', nodeId: ROOT_ID }, tax, metas), reopened, tomorrow, 0);
    expect(plan2.due.length).toBeGreaterThanOrEqual(1);
    expect(plan2.due.every((id) => reopened.get(id)!.dueDay <= tomorrow)).toBe(true);
    const anglais = nodeIdFor([{ kind: 'matiere', label: 'Anglais' }]);
    const planAnglais = planReview(resolveScope({ kind: 'node', nodeId: anglais }, tax, metas), reopened, addDays(D, 30), 0);
    expect(planAnglais.due.every((id) => metas.find((m) => m.cardId === id)!.matiere === 'Anglais')).toBe(true);
  });
});

// Garde-fou de typage : les cartes du lot 1 restent compatibles
const _cardShape: Pick<Card, 'cardId'> = { cardId: 'x' };
void _cardShape;
