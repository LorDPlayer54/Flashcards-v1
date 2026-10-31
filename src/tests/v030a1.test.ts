// Tests de non-régression de la version corrective 0.3.0-a1 (audit du lot 3A).
// B1 : fin automatique au temps limite malgré une écriture en cours ou en échec.
// I1 : statuts de maîtrise non chargés ou illisibles jamais assimilés à « Nouvelle ».
// I2 : sélection d'un test libre revalidée dans la transaction qui le crée.
// M1/M2 : voir aussi les parcours navigateur (écran de déroulement).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { type CardMeta, type ScopeSpec, type TestConfig, type TestSession } from '../domain/types';
import { buildCards } from '../imports/buildCards';
import { applyRating, isMastered, type ReviewState } from '../review/schedule';
import { openFlashcardsDb, type DB } from '../storage/db';
import * as repo from '../storage/repo';
import { buildTaxonomy, nodeIdFor, ROOT_ID } from '../taxonomy/tree';
import { applyTestFilters, drawCards, filterOptions, NO_FILTERS, resolveScope, statesViewOf, type FilterSet } from './selection';
import { addElapsed, advance, createSession, recordAnswer, selfEvaluate, timeUp } from './session';
import { SessionController } from './sessionController';
import { applyUserTransition, enforceTimeLimit, limitReached, type TimeSource } from './timeLimit';

const D = '2026-10-30';
const NOW = '2026-10-30T09:00:00.000Z';
let n = 0;

const cfg = (over: Partial<TestConfig> = {}): TestConfig => ({ count: null, format: 'all', order: 'library', ...over });

/** Temps actif simulé (non enregistré) */
function fakeClock(ms = 0): TimeSource & { add(ms: number): void } {
  let pending = ms;
  return {
    now: () => Date.parse(NOW), // séances sans échéance (créées par createSession) : décompte en temps actif
    peek: () => pending,
    take: () => {
      const v = pending;
      pending = 0;
      return v;
    },
    add: (x: number) => {
      pending += x;
    },
  };
}

/** Écriture contrôlable : chaque appel peut être suspendu, réussir ou échouer */
function controllableSaver() {
  const calls: TestSession[] = [];
  let mode: 'ok' | 'fail' | 'hold' = 'ok';
  let release: (() => void) | null = null;
  const save = (s: TestSession) => {
    calls.push(s);
    if (mode === 'fail') return Promise.reject(new Error('QuotaExceededError'));
    if (mode === 'hold') return new Promise<void>((res) => (release = res));
    return Promise.resolve();
  };
  return {
    save,
    calls,
    set: (m: typeof mode) => {
      mode = m;
    },
    release: () => {
      release?.();
      release = null;
    },
  };
}

const LIMITED = cfg({ timer: { mode: 'limit', limitSec: 60 } });
const session = (config = LIMITED, ids = ['a', 'b', 'c']) => createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', config, ids, NOW);
const answer = (cardId: string) => (s: TestSession) => advance(recordAnswer(s, cardId, selfEvaluate('good', NOW)), NOW);

describe('B1 — fin automatique au temps limite', () => {
  it('limite atteinte pendant une écriture suspendue : la fin attend, puis est enregistrée une seule fois avec la réponse', async () => {
    const io = controllableSaver();
    const s0 = { ...session(), elapsedMs: 59_000 };
    const ctl = new SessionController(s0, io.save);
    const clock = fakeClock(500);

    io.set('hold');
    const writing = applyUserTransition(ctl, clock, answer('a')); // réponse validée à 59,5 s
    clock.add(1000); // l'écriture dure : la limite (60 s) passe
    // Le temps de l'écriture en cours reste pris en compte (affichage et constat de la limite)
    expect(ctl.latest.elapsedMs).toBe(59_500);
    expect(limitReached(ctl.latest, clock)).toBe(true);
    expect(await enforceTimeLimit(ctl, clock)).toEqual({ status: 'waiting' });
    // Une autre réponse pendant l'écriture est refusée
    expect(await applyUserTransition(ctl, clock, answer('b'))).toEqual({ status: 'busy' });
    io.set('ok');
    io.release();
    expect((await writing).status).toBe('saved');
    expect(ctl.current.answers['a']).toBeDefined();

    // Vérification après l'écriture (l'écran la fait aussitôt) : fin enregistrée
    const end = await enforceTimeLimit(ctl, clock);
    expect(end.status).toBe('saved');
    expect(ctl.current).toMatchObject({ status: 'finished', timedOut: true, elapsedMs: 60_000 });
    // Vérifications suivantes : plus rien à faire, aucune écriture supplémentaire
    expect(await enforceTimeLimit(ctl, clock)).toEqual({ status: 'none' });
    expect(io.calls.filter((c) => c.timedOut)).toHaveLength(1);
    expect(Object.keys(ctl.current.answers)).toEqual(['a']);
  });

  it('écriture de la réponse en échec puis limite atteinte : la fin remplace la transition et conserve la réponse', async () => {
    const io = controllableSaver();
    const ctl = new SessionController({ ...session(), elapsedMs: 59_000 }, io.save);
    const clock = fakeClock(500);
    io.set('fail');
    expect((await applyUserTransition(ctl, clock, answer('a'))).status).toBe('failed');
    expect(ctl.pending?.answers['a']).toBeDefined();

    clock.add(1000);
    io.set('ok');
    const end = await enforceTimeLimit(ctl, clock);
    expect(end.status).toBe('saved');
    expect(ctl.pending).toBeNull();
    expect(ctl.current).toMatchObject({ status: 'finished', timedOut: true });
    expect(ctl.current.answers['a']).toMatchObject({ kind: 'open', selfEval: 'good' });
  });

  it('écriture de la fin en échec : elle reste en attente, sans nouvel essai automatique, et aboutit au réessai', async () => {
    const io = controllableSaver();
    const ctl = new SessionController({ ...session(), elapsedMs: 60_000 }, io.save);
    const clock = fakeClock(0);
    io.set('fail');
    expect((await enforceTimeLimit(ctl, clock)).status).toBe('failed');
    expect(ctl.pending).toMatchObject({ status: 'finished', timedOut: true });
    const attempts = io.calls.length;

    // Les vérifications périodiques ne relancent pas d'écriture ; aucune réponse n'est acceptée
    expect(await enforceTimeLimit(ctl, clock)).toEqual({ status: 'awaiting-retry' });
    expect(await applyUserTransition(ctl, clock, answer('a'))).toEqual({ status: 'blocked' });
    expect(io.calls).toHaveLength(attempts);
    expect(limitReached(ctl.current, fakeClock(0))).toBe(true); // la limite reste constatée tant que la fin n'est pas enregistrée

    io.set('ok');
    expect((await ctl.retry()).status).toBe('saved');
    expect(ctl.current).toMatchObject({ status: 'finished', timedOut: true });
  });

  it('reprise d’une séance dont la limite est déjà atteinte : la réponse tardive est refusée, le test se termine', async () => {
    const io = controllableSaver();
    // Séance enregistrée au-delà de la limite (onglet fermé avant que la fin ait pu être enregistrée)
    const ctl = new SessionController({ ...session(), elapsedMs: 61_000, currentIndex: 1 }, io.save);
    const res = await applyUserTransition(ctl, fakeClock(0), answer('b'));
    expect(res.status).toBe('expired');
    expect(ctl.current).toMatchObject({ status: 'finished', timedOut: true, elapsedMs: 60_000 });
    expect(ctl.current.answers['b']).toBeUndefined();
    expect(io.calls).toHaveLength(1);
  });

  it('correction en fin de test : la limite ouvre la correction une seule fois ; plus aucune réponse enregistrée', async () => {
    const io = controllableSaver();
    const config = { ...LIMITED, correction: 'end' as const };
    const ctl = new SessionController({ ...session(config), elapsedMs: 59_900 }, io.save);
    const clock = fakeClock(200);
    expect((await enforceTimeLimit(ctl, clock)).status).toBe('saved');
    expect(ctl.current).toMatchObject({ status: 'in_progress', phase: 'correction', timedOut: true });
    expect(await enforceTimeLimit(ctl, clock)).toEqual({ status: 'none' });
    const late = await applyUserTransition(ctl, clock, answer('a'));
    expect(late.status === 'saved' && late.session.answers['a']).toBeFalsy();
  });

  it('sans limite ou avant la limite : aucune intervention', async () => {
    const io = controllableSaver();
    const free = new SessionController({ ...session(cfg({ timer: { mode: 'elapsed' } })), elapsedMs: 10_000_000 }, io.save);
    expect(await enforceTimeLimit(free, fakeClock(1000))).toEqual({ status: 'none' });
    const early = new SessionController({ ...session(), elapsedMs: 30_000 }, io.save);
    const res = await applyUserTransition(early, fakeClock(1000), answer('a'));
    expect(res.status === 'saved' && res.session).toMatchObject({ currentIndex: 1, elapsedMs: 31_000 });
    expect(io.calls).toHaveLength(1);
  });

  it('intégration IndexedDB : écriture bloquée au passage de la limite, fin enregistrée en base, rechargement', async () => {
    const name = `v030a1-b1-${++n}`;
    const db = await openFlashcardsDb(name);
    const s0 = { ...session(), elapsedMs: 59_000 };
    await repo.startNewSession(db, s0, NOW);
    let gate: Promise<void> | null = null;
    let open: () => void = () => undefined;
    const ctl = new SessionController(s0, async (x) => {
      if (gate) await gate;
      await repo.saveSessionTransition(db, x);
    });
    gate = new Promise((r) => (open = r));
    const clock = fakeClock(600);
    const writing = applyUserTransition(ctl, clock, answer('a'));
    clock.add(1000);
    expect((await enforceTimeLimit(ctl, clock)).status).toBe('waiting');
    gate = null;
    open();
    await writing;
    expect((await enforceTimeLimit(ctl, clock)).status).toBe('saved');
    db.close();
    const again = await openFlashcardsDb(name);
    const stored = (await repo.getSession(again, s0.sessionId))!;
    expect(stored).toMatchObject({ status: 'finished', timedOut: true, elapsedMs: 60_000, revision: 2 });
    expect(Object.keys(stored.answers)).toEqual(['a']);
    expect(await again.getAll('reviewStates')).toEqual([]);
  });

  it('timeUp borne le temps enregistré à la limite', () => {
    expect(timeUp({ ...session(), elapsedMs: 75_000 }, NOW).elapsedMs).toBe(60_000);
    expect(timeUp(addElapsed(session(cfg({ timer: { mode: 'elapsed' } })), 75_000), NOW).status).toBe('finished');
  });
});

// ---------- I1 ----------

const meta = (cardId: string, difficulte: string): CardMeta => ({
  cardId,
  collectionId: 'col',
  matiere: 'Calcul',
  theme: 'Fractions',
  formatQuestion: 'open',
  sourceRow: 1,
  difficulte,
});
const rate = (cardId: string, ratings: ('again' | 'hard' | 'good' | 'easy')[]): ReviewState => {
  let s: ReviewState | undefined;
  for (const r of ratings) s = applyRating(s, cardId, r, D, NOW);
  return s!;
};
const fsNew: FilterSet = { format: 'all', filters: { ...NO_FILTERS, statuses: ['new'] } };

describe('I1 — statuts de maîtrise indisponibles', () => {
  const metas = [meta('m', 'Facile'), meta('x', 'Facile')];
  const mastered = rate('m', ['easy', 'easy', 'easy', 'easy', 'easy']);
  const loaded = new Map([['m', mastered]]);

  it('états non chargés : aucune carte classée « Nouvelle », filtre de maîtrise indisponible, rien de sélectionnable', () => {
    expect(isMastered(mastered)).toBe(true);
    const r = applyTestFilters(metas, fsNew, null);
    expect(r).toMatchObject({ eligible: [], statesUnavailable: true, culprits: [] });
    expect(r.emptyReason).toMatch(/pas disponibles/);
    expect(filterOptions(metas, null).statuses).toBeNull();
  });

  it('états chargés : la carte maîtrisée n’est jamais « Nouvelle »', () => {
    expect(applyTestFilters(metas, fsNew, loaded).eligible.map((m) => m.cardId)).toEqual(['x']);
    expect(filterOptions(metas, loaded).statuses).toEqual([
      { value: 'new', count: 1 },
      { value: 'learning', count: 0 },
      { value: 'review', count: 0 },
      { value: 'mastered', count: 1 },
    ]);
  });

  it('sans filtre de maîtrise, la sélection ne dépend pas des états : utilisable pendant le chargement', () => {
    const f: FilterSet = { format: 'all', filters: { ...NO_FILTERS, difficulties: ['Facile'] } };
    expect(applyTestFilters(metas, f, null).eligible).toHaveLength(2);
    expect(applyTestFilters(metas, f, null).statesUnavailable).toBeUndefined();
  });

  it('lecture différée, rejetée puis réussie : seule une lecture réussie donne des statuts', async () => {
    const name = `v030a1-i1-${++n}`;
    const db = await openFlashcardsDb(name);
    await db.put('reviewStates', mastered);
    // 1. Chargement en cours
    expect(statesViewOf({ data: null, error: null })).toBeNull();
    // 2. Lecture rejetée (base fermée) : l'erreur ne produit pas une table vide
    const closed = await openFlashcardsDb(name);
    closed.close();
    const error = await repo.loadReviewStates(closed).then(
      () => null,
      (e: unknown) => String(e),
    );
    expect(error).not.toBeNull();
    const failedView = statesViewOf({ data: null, error });
    expect(applyTestFilters(metas, fsNew, failedView)).toMatchObject({ eligible: [], statesUnavailable: true });
    // Des données antérieures accompagnées d'une erreur de relecture ne sont pas utilisées non plus
    expect(statesViewOf({ data: { states: new Map() }, error })).toBeNull();
    // 3. Relecture réussie : la carte maîtrisée n'est pas « Nouvelle »
    const okView = statesViewOf({ data: { states: await repo.loadReviewStates(db) }, error: null });
    expect(applyTestFilters(metas, fsNew, okView).eligible.map((m) => m.cardId)).toEqual(['x']);
  });
});

// ---------- I2 ----------

const M = { externalId: 0, matiere: 1, theme: 2, difficulte: 3, question: 4, reponse: 5 };
const baseRows = [
  ['F1', 'Calcul', 'Fractions', 'Facile', 'Q1', 'R'],
  ['F2', 'Calcul', 'Fractions', 'Facile', 'Q2', 'R'],
  ['F3', 'Calcul', 'Fractions', 'Difficile', 'Q3', 'R'],
  ['A1', 'Anglais', 'Grammaire', 'Facile', 'Qa', 'R'],
];
const fractions = nodeIdFor([
  { kind: 'matiere', label: 'Calcul' },
  { kind: 'theme', label: 'Fractions' },
]);
const NEW_EASY: TestConfig = cfg({ filters: { ...NO_FILTERS, difficulties: ['Facile'], statuses: ['new'] } });

async function library() {
  const name = `v030a1-i2-${++n}`;
  const db = await openFlashcardsDb(name);
  const out = await repo.commitImport(db, { kind: 'new', name: 'Lib' }, 'lib.csv', buildCards(baseRows, M, {}).drafts);
  const ids = Object.fromEntries((await repo.getCardsOfCollection(db, out.collectionId)).map((c) => [c.externalId!, c.cardId]));
  return { db, name, collectionId: out.collectionId, ids };
}

/** Aperçu tel que calculé par l'écran de configuration, à partir des données chargées à cet instant */
async function preview(db: DB, scope: ScopeSpec, config: TestConfig) {
  const metas = await repo.loadAllMeta(db);
  const states = await repo.loadReviewStates(db);
  const { eligible } = applyTestFilters(resolveScope(scope, buildTaxonomy(metas), metas), { format: config.format, filters: config.filters ?? NO_FILTERS }, states);
  const session = createSession(scope, 'Fractions', config, drawCards(eligible, config), NOW);
  return { session, expectedEligible: eligible.map((m) => m.cardId) };
}

describe('I2 — lancement d’un test libre revalidé', () => {
  const scope: ScopeSpec = { kind: 'node', nodeId: fractions };

  it('« Nouvelle + Facile » : révision de la carte dans un autre onglet → lancement refusé, aperçu actualisé accepté', async () => {
    const { db, name, ids } = await library();
    const shown = await preview(db, scope, NEW_EASY);
    expect(shown.expectedEligible.sort()).toEqual([ids['F1'], ids['F2']].sort());

    // Onglet B : révision programmée complète de F1 (la carte n'est plus « Nouvelle »)
    const tabB = await openFlashcardsDb(name);
    const r = createSession(scope, 'Révision', cfg(), [ids['F1']!], NOW, 'revision');
    await repo.startNewSession(tabB, r, NOW);
    const ctlB = new SessionController(r, (x) => repo.saveRevisionTransition(tabB, x, D, NOW));
    await ctlB.apply(advance(recordAnswer(r, ids['F1']!, selfEvaluate('good', NOW)), NOW));
    expect((await repo.getSession(tabB, r.sessionId))!.status).toBe('finished');

    const before = await db.getAll('sessions');
    const res = await repo.startTestSession(db, { ...shown, confirmedReplace: [], now: NOW });
    expect(res).toMatchObject({ status: 'changed', eligibleCount: 1, expectedCount: 2 });
    expect(await db.getAll('sessions')).toEqual(before); // aucune séance créée

    const fresh = await preview(db, scope, NEW_EASY);
    expect(fresh.expectedEligible).toEqual([ids['F2']]);
    expect((await repo.startTestSession(db, { ...fresh, confirmedReplace: [], now: NOW })).status).toBe('started');
    expect((await repo.getSession(db, fresh.session.sessionId))!.cardIds).toEqual([ids['F2']]);
  });

  it('réimportation qui change la difficulté : refus sans remplacer la séance en cours ; aucun état modifié', async () => {
    const { db, name, collectionId, ids } = await library();
    const P = createSession({ kind: 'cards', cardIds: [ids['A1']!], label: 'A' }, 'A', cfg(), [ids['A1']!], NOW);
    await repo.startNewSession(db, P, NOW);
    const shown = await preview(db, scope, cfg({ filters: { ...NO_FILTERS, difficulties: ['Facile'] } }));

    const tabB = await openFlashcardsDb(name);
    const v2 = baseRows.map((r) => (r[0] === 'F2' ? ['F2', 'Calcul', 'Fractions', 'Difficile', 'Q2', 'R'] : r));
    expect(await repo.commitImport(tabB, { kind: 'existing', collectionId }, 'lib-v2.csv', buildCards(v2, M, {}).drafts)).toMatchObject({ updated: 1 });

    const res = await repo.startTestSession(db, { ...shown, confirmedReplace: [P.sessionId], now: NOW });
    expect(res.status).toBe('changed');
    expect((await repo.getSession(db, P.sessionId))!.status).toBe('in_progress');
    expect(await db.getAll('sessions')).toHaveLength(1);
    expect(await db.getAll('reviewStates')).toEqual([]);
  });

  it('carte reclassée dans une autre matière ou supprimée : refus', async () => {
    const { db, name, collectionId, ids } = await library();
    const config = cfg();
    const shown = await preview(db, scope, config);
    const tabB = await openFlashcardsDb(name);
    const v2 = baseRows.map((r) => (r[0] === 'F3' ? ['F3', 'Anglais', 'Grammaire', 'Difficile', 'Q3', 'R'] : r));
    await repo.commitImport(tabB, { kind: 'existing', collectionId }, 'lib-v2.csv', buildCards(v2, M, {}).drafts);
    expect(await repo.startTestSession(db, { ...shown, confirmedReplace: [], now: NOW })).toMatchObject({
      status: 'changed',
      eligibleCount: 2,
      expectedCount: 3,
    });

    const shown2 = await preview(db, scope, config);
    await repo.deleteCard(tabB, ids['F1']!);
    expect((await repo.startTestSession(db, { ...shown2, confirmedReplace: [], now: NOW })).status).toBe('changed');
    expect(await db.getAll('sessions')).toEqual([]);
  });

  it('modification sans effet sur la sélection : lancement accepté, séance confirmée abandonnée', async () => {
    const { db, name, collectionId, ids } = await library();
    const P = createSession({ kind: 'cards', cardIds: [ids['A1']!], label: 'A' }, 'A', cfg(), [ids['A1']!], NOW);
    await repo.startNewSession(db, P, NOW);
    const shown = await preview(db, scope, cfg({ filters: { ...NO_FILTERS, difficulties: ['Facile'] } }));
    // Autre onglet : changement d'une carte hors périmètre et d'une carte exclue par le filtre
    const tabB = await openFlashcardsDb(name);
    const v2 = baseRows.map((r) => (r[0] === 'A1' ? ['A1', 'Anglais', 'Grammaire', 'Moyen', 'Qa', 'R'] : r[0] === 'F3' ? ['F3', 'Calcul', 'Fractions', 'Moyen', 'Q3', 'R'] : r));
    await repo.commitImport(tabB, { kind: 'existing', collectionId }, 'lib-v2.csv', buildCards(v2, M, {}).drafts);
    const res = await repo.startTestSession(db, { ...shown, confirmedReplace: [P.sessionId], now: NOW });
    expect(res).toMatchObject({ status: 'started', abandoned: 1 });
    expect((await repo.getSession(db, P.sessionId))!.status).toBe('abandoned');
  });

  it('périmètre multiple, recherche et sélection de cartes ; séance non confirmée → conflit ; tirage hors éligibles refusé', async () => {
    const { db, ids } = await library();
    const anglais = nodeIdFor([{ kind: 'matiere', label: 'Anglais' }]);
    const multi = await preview(db, { kind: 'multi', nodeIds: [fractions, anglais] }, cfg({ filters: { ...NO_FILTERS, difficulties: ['Facile'] } }));
    expect(multi.expectedEligible).toHaveLength(3);

    const other = createSession({ kind: 'cards', cardIds: [ids['F3']!], label: 'x' }, 'x', cfg(), [ids['F3']!], NOW);
    await repo.startNewSession(db, other, NOW);
    const conflict = await repo.startTestSession(db, { ...multi, confirmedReplace: [], now: NOW });
    expect(conflict).toMatchObject({ status: 'conflict', running: [{ sessionId: other.sessionId }] });

    const forged = { ...multi, session: { ...multi.session, cardIds: [ids['F3']!] } };
    expect((await repo.startTestSession(db, { ...forged, confirmedReplace: [other.sessionId], now: NOW })).status).toBe('changed');

    const cards = await preview(db, { kind: 'cards', cardIds: [ids['F1']!, ids['A1']!], label: 'Recherche' }, cfg());
    expect(await repo.startTestSession(db, { ...cards, confirmedReplace: [other.sessionId], now: NOW })).toMatchObject({ status: 'started', abandoned: 1 });
  });

  it('une révision programmée ne peut pas passer par ce lancement', async () => {
    const { db, ids } = await library();
    const r = createSession(scope, 'R', cfg(), [ids['F1']!], NOW, 'revision');
    await expect(repo.startTestSession(db, { session: r, expectedEligible: [ids['F1']!], confirmedReplace: [] })).rejects.toThrow();
  });

  it('format « Ouvertes » : une carte devenue QCM par réimportation fait refuser le lancement', async () => {
    const { db, name, collectionId } = await library();
    const shown = await preview(db, scope, cfg({ format: 'open' }));
    expect(shown.expectedEligible).toHaveLength(3);
    const tabB = await openFlashcardsDb(name);
    const v2 = baseRows.map((r) => (r[0] === 'F1' ? ['F1', 'Calcul', 'Fractions', 'Facile', 'Q1 ?\nA) un  B) deux', 'B'] : r));
    await repo.commitImport(tabB, { kind: 'existing', collectionId }, 'lib-v2.csv', buildCards(v2, M, {}).drafts);
    expect((await repo.getCardsOfCollection(db, collectionId)).find((c) => c.externalId === 'F1')!.formatQuestion).toBe('mcq');
    expect(await repo.startTestSession(db, { ...shown, confirmedReplace: [], now: NOW })).toMatchObject({ status: 'changed', eligibleCount: 2 });
  });
});
