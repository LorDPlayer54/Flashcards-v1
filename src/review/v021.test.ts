// Tests de non-régression v0.2.1 : lancement revalidé, changement de jour, annulation intégrale d'une transaction
// qui échoue en cours de route, compteur de reprises, règle du quota après réinitialisation.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { CardMeta, TestSession } from '../domain/types';
import { buildCards } from '../imports/buildCards';
import { openFlashcardsDb, type DB } from '../storage/db';
import * as repo from '../storage/repo';
import { buildTaxonomy, nodeIdFor, ROOT_ID } from '../taxonomy/tree';
import { resolveScope } from '../tests/selection';
import { advance, createSession, currentAnswer, gradeMcq, progressOf, rateMcq, recordAnswer, selfEvaluate } from '../tests/session';
import { SessionController } from '../tests/sessionController';
import { msUntilNextDay, watchLocalDay } from './dayWatch';
import { newRemainingToday, planReview } from './queue';
import { addDays } from './schedule';
import { startReviewAllStudied } from '../tests/studyAll';

const D = '2026-10-30';
const NOW = '2026-10-30T09:00:00.000Z';
let n = 0;
const M = { externalId: 0, matiere: 1, question: 2, reponse: 3 } as const;
const realUuid = globalThis.crypto.randomUUID.bind(globalThis.crypto);
afterEach(() => {
  globalThis.crypto.randomUUID = realUuid;
});

/** Bibliothèque : 4 cartes Calcul, 4 Économie */
async function setup(name = `v021-${++n}`) {
  const db = await openFlashcardsDb(name);
  const rows = [
    ...[1, 2, 3, 4].map((i) => [`C${i}`, 'Calcul', `Qc${i}`, 'R']),
    ...[1, 2, 3, 4].map((i) => [`E${i}`, 'Économie', `Qe${i}`, 'R']),
  ];
  await repo.commitImport(db, { kind: 'new', name: 'Lib' }, 'lib.csv', buildCards(rows, M, {}).drafts);
  const metas = await repo.loadAllMeta(db);
  return { db, name, metas, tax: buildTaxonomy(metas) };
}
const scopeOf = (metas: CardMeta[], matiere?: string) => (matiere ? metas.filter((m) => m.matiere === matiere) : metas);
const mat = (label: string) => nodeIdFor([{ kind: 'matiere', label }]);

/** Aperçu tel que l'écran le calcule (instantané) */
async function preview(db: DB, scoped: CardMeta[], today = D) {
  const states = await repo.loadReviewStates(db);
  const remaining = newRemainingToday(await repo.countIntroducedOn(db, today), await repo.getNewPerDay(db));
  return planReview(scoped, states, today, remaining);
}

/** Révise des cartes (toutes « Correct ») dans une séance enregistrée */
async function review(db: DB, ids: string[], day = D) {
  const s0 = createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', { count: null, format: 'all', order: 'library' }, ids, NOW, 'revision');
  await repo.startNewSession(db, s0, NOW);
  const ctl = new SessionController(s0, (x) => repo.saveRevisionTransition(db, x, day, `${day}T10:00:00.000Z`));
  let s = s0;
  for (const id of ids) s = ((await ctl.apply(advance(recordAnswer(s, id, selfEvaluate('good', NOW)), NOW))) as { session: TestSession }).session;
  return s;
}

describe('Important 1 — lancement d’une révision revalidé dans la transaction', () => {
  it('cas nominal : la séance créée correspond exactement à l’aperçu', async () => {
    const { db, metas } = await setup();
    const plan = await preview(db, metas);
    const res = await startReviewAllStudied(db, { nodeId: ROOT_ID, scopeLabel: 'Tout', expectedQueue: plan.queue, confirmedReplace: [], today: D, now: NOW });
    expect(res.status).toBe('started');
    if (res.status !== 'started') return;
    expect(res.session.cardIds).toEqual(plan.queue);
    expect(res.session.mode).toBe('revision');
    expect((await repo.getInProgressSessions(db)).map((s) => s.sessionId)).toEqual([res.session.sessionId]);
  });

  it('sélection périmée sur la même matière : refus sans écriture, nouvel aperçu sans les cartes déjà notées', async () => {
    const { db, metas } = await setup();
    const calcul = scopeOf(metas, 'Calcul');
    const stale = await preview(db, calcul); // aperçu affiché : 4 nouvelles cartes
    await review(db, stale.queue.slice(0, 2)); // ailleurs, 2 d'entre elles sont notées (non dues avant J+3)
    const before = await db.getAll('sessions');
    const res = await startReviewAllStudied(db, { nodeId: mat('Calcul'), scopeLabel: 'Calcul', expectedQueue: stale.queue, confirmedReplace: [], today: D });
    expect(res.status).toBe('changed');
    if (res.status !== 'changed') return;
    expect(res.plan.queue).toEqual(stale.queue.slice(2));
    expect(await db.getAll('sessions')).toEqual(before); // aucune écriture
  });

  it('quota global épuisé par une autre matière : l’ancienne sélection ne peut pas le dépasser', async () => {
    const { db, metas } = await setup();
    await repo.setNewPerDay(db, 3);
    const eco = scopeOf(metas, 'Économie');
    const staleEco = await preview(db, eco);
    expect(staleEco.fresh).toHaveLength(3);
    await review(db, (await preview(db, scopeOf(metas, 'Calcul'))).queue); // 3 cartes Calcul introduites
    const res = await startReviewAllStudied(db, { nodeId: mat('Économie'), scopeLabel: 'Économie', expectedQueue: staleEco.queue, confirmedReplace: [], today: D });
    expect(res.status).toBe('changed');
    if (res.status === 'changed') expect(res.plan.fresh).toEqual([]);
    expect(await repo.countIntroducedOn(db, D)).toBe(3);
    // Nouvel essai avec l'aperçu actualisé : rien à réviser, aucune séance créée
    const again = await startReviewAllStudied(db, { nodeId: mat('Économie'), scopeLabel: 'Économie', expectedQueue: [], confirmedReplace: [], today: D });
    expect(again.status).toBe('empty');
  });

  it('quota modifié dans « Plus » avant le clic : sélection refusée puis acceptée une fois actualisée', async () => {
    const { db, metas } = await setup();
    const stale = await preview(db, metas); // 8 nouvelles (quota 20)
    await repo.setNewPerDay(db, 2);
    const res = await startReviewAllStudied(db, { nodeId: ROOT_ID, scopeLabel: 'Tout', expectedQueue: stale.queue, confirmedReplace: [], today: D });
    expect(res.status).toBe('changed');
    if (res.status !== 'changed') return;
    expect(res.plan.queue).toHaveLength(2);
    const ok = await startReviewAllStudied(db, { nodeId: ROOT_ID, scopeLabel: 'Tout', expectedQueue: res.plan.queue, confirmedReplace: [], today: D });
    expect(ok.status).toBe('started');
  });

  it('changement de jour entre l’aperçu et le clic : la carte devenue due est prise en compte', async () => {
    const { db, metas } = await setup();
    await repo.setNewPerDay(db, 0);
    // Une carte notée « À revoir » hier → due aujourd'hui
    const s0 = createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', { count: null, format: 'all', order: 'library' }, [metas[0]!.cardId], NOW, 'revision');
    await repo.startNewSession(db, s0, NOW);
    await new SessionController(s0, (x) => repo.saveRevisionTransition(db, x, addDays(D, -1))).apply(recordAnswer(s0, metas[0]!.cardId, selfEvaluate('again', NOW)));
    const staleYesterday = await preview(db, metas, addDays(D, -1)); // aperçu calculé la veille : vide
    expect(staleYesterday.queue).toEqual([]);
    const res = await startReviewAllStudied(db, { nodeId: ROOT_ID, scopeLabel: 'Tout', expectedQueue: staleYesterday.queue, confirmedReplace: [s0.sessionId], today: D });
    expect(res.status).toBe('changed');
    if (res.status === 'changed') expect(res.plan.due).toEqual([metas[0]!.cardId]);
  });

  it('lancements simultanés dans deux onglets : une seule séance active, sans remplacement silencieux', async () => {
    const { name, metas, db } = await setup();
    const tabB = await openFlashcardsDb(name);
    const plan = await preview(db, metas);
    // v0.2.2 (I2) : aucun des deux onglets n'a vu de séance en cours → aucun remplacement silencieux
    const req = { nodeId: ROOT_ID, scopeLabel: 'Tout', expectedQueue: plan.queue, confirmedReplace: [], today: D };
    const [a, b] = await Promise.all([startReviewAllStudied(db, req), startReviewAllStudied(tabB, req)]);
    expect([a.status, b.status].sort()).toEqual(['conflict', 'started']);
    const active = await repo.getInProgressSessions(db);
    expect(active).toHaveLength(1);
    expect((await db.getAll('sessions')).filter((s) => s.status === 'abandoned')).toHaveLength(0);
  });

  it('échec de création : la séance précédente reste intacte, rien n’est écrit', async () => {
    const { db, metas } = await setup();
    const previous = recordAnswer(
      createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', { count: 2, format: 'all', order: 'library' }, [metas[0]!.cardId, metas[1]!.cardId], NOW),
      metas[0]!.cardId,
      selfEvaluate('hard', NOW),
    );
    await repo.startNewSession(db, previous, NOW);
    const plan = await preview(db, metas);
    // Échec provoqué : l'identifiant de la nouvelle séance entre en collision avec la séance existante
    globalThis.crypto.randomUUID = (() => previous.sessionId) as typeof globalThis.crypto.randomUUID;
    await expect(startReviewAllStudied(db, { nodeId: ROOT_ID, scopeLabel: 'Tout', expectedQueue: plan.queue, confirmedReplace: [previous.sessionId], today: D })).rejects.toBeTruthy();
    globalThis.crypto.randomUUID = realUuid;
    const all = await db.getAll('sessions');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ sessionId: previous.sessionId, status: 'in_progress', answers: previous.answers });
  });
});

describe('Important 2 — changement de jour sans navigation', () => {
  class FakeEnv {
    t: Date;
    timers: { fn: () => void; ms: number; id: number }[] = [];
    target = new EventTarget();
    private seq = 0;
    constructor(start: Date) {
      this.t = start;
    }
    env() {
      return {
        now: () => this.t,
        targets: [this.target],
        setTimer: (fn: () => void, ms: number) => {
          const id = ++this.seq;
          this.timers.push({ fn, ms, id });
          return id;
        },
        clearTimer: (id: unknown) => {
          this.timers = this.timers.filter((x) => x.id !== id);
        },
      };
    }
  }

  it('minuteur programmé pour juste après minuit', () => {
    expect(msUntilNextDay(new Date(2026, 9, 30, 23, 59, 0))).toBe(61_000);
    expect(msUntilNextDay(new Date(2026, 9, 30, 0, 0, 0))).toBe(86_401_000);
  });

  it('page affichée à 23:59, retour au premier plan à 00:01 : le nouveau jour est signalé une seule fois', () => {
    const f = new FakeEnv(new Date(2026, 9, 30, 23, 59));
    const days: string[] = [];
    const stop = watchLocalDay('2026-10-30', (d) => days.push(d), f.env());
    f.target.dispatchEvent(new Event('visibilitychange')); // même jour : rien
    expect(days).toEqual([]);
    f.t = new Date(2026, 9, 31, 0, 1);
    f.target.dispatchEvent(new Event('visibilitychange'));
    f.target.dispatchEvent(new Event('focus'));
    expect(days).toEqual(['2026-10-31']);
    stop();
    f.t = new Date(2026, 10, 1, 0, 1);
    f.target.dispatchEvent(new Event('pageshow')); // arrêté : plus d'écoute
    expect(days).toEqual(['2026-10-31']);
    expect(f.timers).toEqual([]);
  });

  it('application restée au premier plan : le minuteur de minuit déclenche l’actualisation', () => {
    const f = new FakeEnv(new Date(2026, 9, 30, 23, 59));
    const days: string[] = [];
    watchLocalDay('2026-10-30', (d) => days.push(d), f.env());
    expect(f.timers).toHaveLength(1);
    f.t = new Date(2026, 9, 31, 0, 0, 1);
    f.timers[0]!.fn();
    expect(days).toEqual(['2026-10-31']);
    expect(f.timers).toHaveLength(1); // un seul minuteur, reprogrammé pour la nuit suivante
  });

  it('à minuit, le quota et les cartes dues sont recalculés pour le nouveau jour', async () => {
    const { db, metas } = await setup();
    await repo.setNewPerDay(db, 2);
    await review(db, (await preview(db, metas)).queue); // 2 nouvelles cartes introduites le 30, dues le 2 novembre
    expect((await preview(db, metas, D)).queue).toEqual([]); // le 30 : quota épuisé
    const next = await preview(db, metas, addDays(D, 1)); // le 31 : nouveau quota
    expect(next.fresh).toHaveLength(2);
    expect((await preview(db, metas, addDays(D, 3))).due).toHaveLength(2); // le 2 novembre : dues
  });
});

describe('Important 3 — échec PENDANT la transaction : annulation intégrale puis réessai', () => {
  async function withKnownCard() {
    const { db, metas } = await setup();
    const id = metas[0]!.cardId;
    await review(db, [id], addDays(D, -3)); // état existant : dû aujourd'hui (Correct → J+3)
    const s0 = createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', { count: null, format: 'all', order: 'library' }, [id], NOW, 'revision');
    await repo.startNewSession(db, s0, NOW);
    const snapshot = {
      session: await repo.getSession(db, s0.sessionId),
      state: await repo.getReviewState(db, id),
      log: await db.getAll('reviewLog'),
    };
    return { db, id, s0, snapshot };
  }

  it('échec de reviewLog.add (identifiant en conflit) après reviewStates.put : aucune modification partielle', async () => {
    const { db, id, s0, snapshot } = await withKnownCard();
    await db.put('reviewLog', { ...snapshot.log[0]!, logId: 'conflit' });
    const logBefore = await db.getAll('reviewLog');
    globalThis.crypto.randomUUID = (() => 'conflit') as unknown as typeof globalThis.crypto.randomUUID;
    const ctl = new SessionController(s0, (x) => repo.saveRevisionTransition(db, x, D, NOW));
    const res = await ctl.apply(advance(recordAnswer(s0, id, selfEvaluate('easy', NOW)), NOW));
    globalThis.crypto.randomUUID = realUuid;

    expect(res).toMatchObject({ status: 'failed', stale: false });
    expect(await repo.getSession(db, s0.sessionId)).toEqual(snapshot.session); // session inchangée
    expect(await repo.getReviewState(db, id)).toEqual(snapshot.state); // état inchangé malgré le put demandé
    expect(await db.getAll('reviewLog')).toEqual(logBefore); // aucune ligne ajoutée

    expect((await ctl.retry()).status).toBe('saved');
    const after = await repo.getReviewState(db, id);
    expect(after).toMatchObject({ reviewCount: snapshot.state!.reviewCount + 1, lastRating: 'easy' }); // appliquée une fois
    expect(await db.getAll('reviewLog')).toHaveLength(logBefore.length + 1);
    expect((await repo.getSession(db, s0.sessionId))!).toMatchObject({ status: 'finished', revision: 1 });
  });

  it('échec de sessions.put après reviewStates.put et reviewLog.add déjà demandés : tout est annulé', async () => {
    const { db, id, s0, snapshot } = await withKnownCard();
    const next = { ...advance(recordAnswer(s0, id, selfEvaluate('good', NOW)), NOW), revision: 1 };
    // Valeur non sérialisable : sessions.put échoue alors que les deux autres écritures sont déjà en file
    const poisoned = { ...next, piege: () => 0 } as unknown as TestSession;
    await expect(repo.saveRevisionTransition(db, poisoned, D, NOW)).rejects.toBeTruthy();
    expect(await repo.getSession(db, s0.sessionId)).toEqual(snapshot.session);
    expect(await repo.getReviewState(db, id)).toEqual(snapshot.state);
    expect(await db.getAll('reviewLog')).toEqual(snapshot.log);

    await repo.saveRevisionTransition(db, next, D, NOW); // réessai
    expect((await repo.getReviewLogForCard(db, id)).filter((l) => l.sessionId === s0.sessionId)).toHaveLength(1);
    expect((await repo.getReviewState(db, id))!.reviewCount).toBe(snapshot.state!.reviewCount + 1);
  });
});

describe('Mineur — compteur de progression pendant les reprises', () => {
  it('21/23 pendant les reprises d’une révision de 20 cartes avec 3 « À revoir »', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
    let s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', { count: null, format: 'all', order: 'library' }, ids, NOW, 'revision');
    for (const id of ids) s = advance(recordAnswer(s, id, selfEvaluate(['c1', 'c5', 'c9'].includes(id) ? 'again' : 'good', NOW)), NOW);
    expect(progressOf(s)).toEqual({ position: 21, total: 23, repeat: true });
    const libre = createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', { count: 2, format: 'all', order: 'library' }, ['a', 'b'], NOW);
    expect(progressOf(libre)).toEqual({ position: 1, total: 2, repeat: false });
  });
});

describe('Quota et réinitialisation à la réimportation (règle v0.2.1)', () => {
  it('réinitialiser une carte étudiée aujourd’hui ne libère aucune place du quota', async () => {
    const { db } = await setup();
    await repo.setNewPerDay(db, 1);
    const col = (await repo.listCollections(db))[0]!;
    const metas = await repo.loadAllMeta(db);
    const plan = await preview(db, metas);
    expect(plan.fresh).toHaveLength(1);
    await review(db, plan.fresh);
    const studied = plan.fresh[0]!;
    const ext = (await repo.getCard(db, studied))!.externalId!;
    // Réimportation avec cette carte modifiée et sa mémorisation réinitialisée
    const rows = (await repo.getCardsOfCollection(db, col.collectionId)).map((c) => [c.externalId!, c.matiere, c.question, c.externalId === ext ? 'R modifiée' : c.reponse]);
    const res = await repo.commitImport(db, { kind: 'existing', collectionId: col.collectionId }, 'v2.csv', buildCards(rows, M, {}).drafts, NOW, { resetReviewFor: [studied] });
    expect(res.reviewReset).toBe(1);
    expect(await repo.getReviewState(db, studied)).toBeUndefined();
    expect(await repo.countIntroducedOn(db, D)).toBe(1); // toujours comptée
    expect((await preview(db, metas)).queue).toEqual([]); // quota toujours épuisé aujourd'hui
    expect((await preview(db, metas, addDays(D, 1))).fresh).toEqual([studied]); // redevenue nouvelle : proposée demain
  });
});

describe('Reprise d’une révision après rechargement, QCM juste en attente de note', () => {
  it('la position et la réponse sont conservées ; la note donnée après rechargement fixe l’échéance', async () => {
    const db = await openFlashcardsDb(`v021-qcm-${++n}`);
    const out = await repo.commitImport(
      db,
      { kind: 'new', name: 'Q' },
      'q.csv',
      buildCards([['Q1', 'Q ?\nA) un  B) deux', 'B'], ['Q2', 'Autre', 'R']], { externalId: 0, question: 1, reponse: 2 }, { matiere: 'M' }).drafts,
    );
    const cards = await repo.getCardsOfCollection(db, out.collectionId);
    const q = cards.find((c) => c.externalId === 'Q1')!;
    const other = cards.find((c) => c.externalId === 'Q2')!;
    const s0 = createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', { count: null, format: 'all', order: 'library' }, [q.cardId, other.cardId], NOW, 'revision');
    await repo.startNewSession(db, s0, NOW);
    await new SessionController(s0, (x) => repo.saveRevisionTransition(db, x, D, NOW)).apply(recordAnswer(s0, q.cardId, gradeMcq(q, 'B', NOW, 'revision')));

    // « Rechargement » : relecture depuis la base
    const reloaded = (await repo.getSession(db, s0.sessionId))!;
    expect(reloaded.currentIndex).toBe(0);
    expect(currentAnswer(reloaded)).toMatchObject({ kind: 'mcq', correct: true });
    expect((currentAnswer(reloaded) as { rating?: string }).rating).toBeUndefined();
    expect(await repo.getReviewState(db, q.cardId)).toBeUndefined(); // pas d'échéance tant que la note manque

    const ctl = new SessionController(reloaded, (x) => repo.saveRevisionTransition(db, x, D, NOW));
    const res = await ctl.apply(advance(rateMcq(reloaded, q.cardId, 'easy', NOW), NOW));
    expect(res.status).toBe('saved');
    expect(await repo.getReviewState(db, q.cardId)).toMatchObject({ lastRating: 'easy', intervalDays: 7 });
    expect((await repo.getSession(db, s0.sessionId))!.currentIndex).toBe(1);
  });
});

// L'aperçu de l'écran et la revalidation utilisent le même périmètre
it('le périmètre résolu par l’arbre est accepté tel quel par startReviewSession', async () => {
  const { db, metas, tax } = await setup();
  const scoped = resolveScope({ kind: 'node', nodeId: ROOT_ID }, tax, metas);
  const plan = await preview(db, scoped);
  expect((await startReviewAllStudied(db, { nodeId: ROOT_ID, scopeLabel: 'x', expectedQueue: plan.queue, confirmedReplace: [], today: D })).status).toBe('started');
});
