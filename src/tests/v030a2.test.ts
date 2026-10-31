// Tests de non-régression de la version corrective 0.3.0-a2 (contre-audit de la v0.3.0-a1).
// 1. Temps limité : échéance absolue enregistrée au lancement, décompte en temps réel (fermeture, veille).
// 2. Sortie : la limite est vérifiée avant tout enregistrement ou toute navigation.
// 3. Aperçu : actualisation annoncée seulement une fois réussie (voir aussi les parcours navigateur).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { CardMeta, TestConfig, TestSession } from '../domain/types';
import { buildCards } from '../imports/buildCards';
import { openFlashcardsDb } from '../storage/db';
import * as repo from '../storage/repo';
import { ROOT_ID } from '../taxonomy/tree';
import { previewRefreshPhase } from '../ui/previewRefresh';
import { advance, createSession, recordAnswer, remainingMs, selfEvaluate, withDeadline } from './session';
import { SessionController } from './sessionController';
import { applyUserTransition, elapsedAt, enforceTimeLimit, inQuestions, limitReached, prepareExit, stampTime, timeLeft, type TimeSource } from './timeLimit';

const NOW = '2026-10-30T09:00:00.000Z';
const T0 = Date.parse(NOW);
const iso = (ms: number) => new Date(ms).toISOString();
let n = 0;

const cfg = (over: Partial<TestConfig> = {}): TestConfig => ({ count: null, format: 'all', order: 'library', ...over });
const LIMITED = cfg({ timer: { mode: 'limit', limitSec: 60 } });

/** Heure réelle et temps actif simulés */
function source(atMs: number, activeMs = 0): TimeSource & { at(ms: number): void; add(ms: number): void } {
  let t = atMs;
  let active = activeMs;
  return {
    now: () => t,
    peek: () => active,
    take: () => {
      const v = active;
      active = 0;
      return v;
    },
    at: (ms) => {
      t = ms;
    },
    add: (ms) => {
      t += ms;
      active += ms;
    },
  };
}

function saver() {
  const calls: TestSession[] = [];
  let mode: 'ok' | 'fail' | 'hold' = 'ok';
  let release: (() => void) | null = null;
  return {
    calls,
    set: (m: typeof mode) => {
      mode = m;
    },
    release: () => release?.(),
    save: (s: TestSession) => {
      calls.push(s);
      if (mode === 'fail') return Promise.reject(new Error('QuotaExceededError'));
      if (mode === 'hold') return new Promise<void>((r) => (release = r));
      return Promise.resolve();
    },
  };
}

const answer = (cardId: string) => (s: TestSession) => advance(recordAnswer(s, cardId, selfEvaluate('good', iso(T0))), iso(T0));
const limited = (config = LIMITED) => withDeadline(createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', config, ['a', 'b', 'c'], NOW), NOW);

async function libraryDb() {
  const name = `v030a2-${++n}`;
  const db = await openFlashcardsDb(name);
  const rows = [
    ['C1', 'Calcul', 'Fractions', 'Q1', 'R'],
    ['C2', 'Calcul', 'Fractions', 'Q2', 'R'],
    ['C3', 'Calcul', 'Fractions', 'Q3', 'R'],
  ];
  await repo.commitImport(db, { kind: 'new', name: 'L' }, 'l.csv', buildCards(rows, { externalId: 0, matiere: 1, theme: 2, question: 3, reponse: 4 }, {}).drafts);
  const metas = await repo.loadAllMeta(db);
  return { db, name, ids: metas.map((m) => m.cardId) };
}

/** Lance un test libre comme l'écran (sélection revalidée), à l'instant `atMs` */
async function launch(db: Awaited<ReturnType<typeof openFlashcardsDb>>, ids: string[], config: TestConfig, atMs: number) {
  const s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', config, ids, iso(atMs));
  const running = (await repo.getInProgressSessions(db)).map((r) => r.sessionId);
  const res = await repo.startTestSession(db, { session: s, expectedEligible: ids, confirmedReplace: running, now: iso(atMs) });
  if (res.status !== 'started') throw new Error(res.status);
  return res.session;
}

describe('1 — temps limité : échéance absolue', () => {
  it('l’échéance est enregistrée au lancement, dans la même écriture que la séance ; pas d’échéance sans limite', async () => {
    const { db, ids } = await libraryDb();
    const s = await launch(db, ids, LIMITED, T0);
    expect(s.deadlineAt).toBe(iso(T0 + 60_000));
    expect((await repo.getSession(db, s.sessionId))!.deadlineAt).toBe(iso(T0 + 60_000));
    const e = await launch(db, ids, cfg({ timer: { mode: 'elapsed' } }), T0);
    expect(e.deadlineAt).toBeUndefined();
    const off = await launch(db, ids, cfg(), T0);
    expect(off.deadlineAt).toBeUndefined();
  });

  it('59 s enregistrées, fermeture brutale, réouverture à 61 s : test terminé, aucune réponse acceptée', async () => {
    const { db, name, ids } = await libraryDb();
    const s0 = await launch(db, ids, LIMITED, T0);
    // Réponse validée à 59 s : enregistrée avec 59 s
    let src = source(T0 + 59_000);
    let ctl = new SessionController(s0, (x) => repo.saveSessionTransition(db, x));
    expect((await applyUserTransition(ctl, src, answer(ids[0]!))).status).toBe('saved');
    expect((await repo.getSession(db, s0.sessionId))!.elapsedMs).toBe(59_000);
    // 2 s plus tard, fermeture brutale (rien n'est enregistré), réouverture à 61 s
    db.close();
    const again = await openFlashcardsDb(name);
    const stored = withDeadline((await repo.getSession(again, s0.sessionId))!, iso(T0 + 61_000));
    // Ancien calcul (temps actif enregistré) : il serait resté 1 s
    expect(remainingMs({ ...stored, deadlineAt: undefined }, 0, T0 + 61_000)).toBe(1000);
    src = source(T0 + 61_000);
    expect(timeLeft(stored, src)).toBe(0);
    expect(limitReached(stored, src)).toBe(true);
    ctl = new SessionController(stored, (x) => repo.saveSessionTransition(again, x));
    const late = await applyUserTransition(ctl, src, answer(ids[1]!));
    expect(late.status).toBe('expired');
    const end = (await repo.getSession(again, s0.sessionId))!;
    expect(end).toMatchObject({ status: 'finished', timedOut: true, elapsedMs: 60_000 });
    expect(Object.keys(end.answers)).toEqual([ids[0]]);
    expect(await again.getAll('reviewStates')).toEqual([]);
  });

  it('ouverture après l’échéance (vérification d’ouverture, sans action) : correction en fin de test ouverte', async () => {
    const s = limited({ ...LIMITED, correction: 'end' });
    const io = saver();
    const ctl = new SessionController(s, io.save);
    const res = await enforceTimeLimit(ctl, source(T0 + 3_600_000)); // une heure plus tard (téléphone verrouillé)
    expect(res.status).toBe('saved');
    expect(ctl.current).toMatchObject({ status: 'in_progress', phase: 'correction', timedOut: true, elapsedMs: 60_000 });
    expect(io.calls).toHaveLength(1);
    expect(await enforceTimeLimit(ctl, source(T0 + 3_700_000))).toEqual({ status: 'none' });
  });

  it('reprise avant l’échéance : temps restant exact, temps hors application compté', () => {
    // 20 s enregistrées, fermeture, réouverture à 30,5 s
    const s = { ...limited(), elapsedMs: 20_000 };
    const src = source(T0 + 30_500);
    expect(timeLeft(s, src)).toBe(29_500);
    expect(elapsedAt(s, src)).toBe(30_500);
    expect(limitReached(s, src)).toBe(false);
    // Le temps actif non enregistré n'intervient pas en temps limité
    expect(timeLeft(s, source(T0 + 30_500, 99_000))).toBe(29_500);
    expect(stampTime(s, src).elapsedMs).toBe(30_500);
  });

  it('expiration pendant une écriture en cours puis en échec (échéance absolue)', async () => {
    const io = saver();
    const ctl = new SessionController(limited(), io.save);
    const src = source(T0 + 59_500);
    io.set('hold');
    const writing = applyUserTransition(ctl, src, answer('a'));
    src.at(T0 + 60_500);
    expect(timeLeft(ctl.latest, src)).toBe(0);
    expect(await enforceTimeLimit(ctl, src)).toEqual({ status: 'waiting' });
    expect(await applyUserTransition(ctl, src, answer('b'))).toEqual({ status: 'busy' });
    io.set('ok');
    io.release();
    expect((await writing).status).toBe('saved');
    expect((await enforceTimeLimit(ctl, src)).status).toBe('saved');
    expect(ctl.current).toMatchObject({ status: 'finished', timedOut: true, elapsedMs: 60_000 });
    expect(Object.keys(ctl.current.answers)).toEqual(['a']);

    // Réponse en échec juste avant l'échéance, puis fin en échec, puis réessai
    const io2 = saver();
    const ctl2 = new SessionController(limited(), io2.save);
    io2.set('fail');
    expect((await applyUserTransition(ctl2, source(T0 + 59_000), answer('a'))).status).toBe('failed');
    expect((await enforceTimeLimit(ctl2, source(T0 + 61_000))).status).toBe('failed');
    expect(ctl2.pending).toMatchObject({ status: 'finished', timedOut: true });
    expect(ctl2.pending!.answers['a']).toBeDefined();
    expect(await enforceTimeLimit(ctl2, source(T0 + 62_000))).toEqual({ status: 'awaiting-retry' });
    io2.set('ok');
    expect((await ctl2.retry()).status).toBe('saved');
    expect(ctl2.current.answers['a']).toBeDefined();
  });

  it('séance créée en 0.3.0-a/a1 (sans échéance) : échéance fixée à la réouverture, enregistrée à la première transition', async () => {
    const legacy: TestSession = { ...createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', LIMITED, ['a', 'b'], NOW), elapsedMs: 50_000 };
    const reopened = withDeadline(legacy, iso(T0 + 600_000));
    expect(reopened.deadlineAt).toBe(iso(T0 + 610_000)); // 10 s restantes, comme en 0.3.0-a1
    expect(withDeadline(reopened, iso(T0 + 999_999))).toBe(reopened); // jamais recalculée
    const io = saver();
    const ctl = new SessionController(reopened, io.save);
    expect((await applyUserTransition(ctl, source(T0 + 604_000), answer('a'))).status).toBe('saved');
    expect(io.calls[0]).toMatchObject({ deadlineAt: iso(T0 + 610_000), elapsedMs: 54_000 });
    // Révision programmée, temps écoulé et séance en correction : jamais d'échéance
    expect(withDeadline({ ...legacy, mode: 'revision' }, NOW).deadlineAt).toBeUndefined();
    expect(withDeadline({ ...legacy, config: cfg({ timer: { mode: 'elapsed' } }) }, NOW).deadlineAt).toBeUndefined();
    expect(withDeadline({ ...legacy, phase: 'correction' }, NOW).deadlineAt).toBeUndefined();
  });

  it('temps écoulé : temps actif inchangé (arrière-plan non compté) ; sans chronomètre : rien n’est mesuré', () => {
    const e = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', cfg({ timer: { mode: 'elapsed' } }), ['a'], NOW);
    const src = source(T0 + 3_600_000, 42_000); // une heure de temps réel, 42 s d'activité
    expect(elapsedAt(e, src)).toBe(42_000);
    expect(timeLeft(e, src)).toBeNull();
    expect(stampTime(e, src).elapsedMs).toBe(42_000);
    const off = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', cfg(), ['a'], NOW);
    expect(stampTime(off, source(T0 + 9_000, 0))).toBe(off);
  });
});

describe('2 — sortie de la séance', () => {
  it('quitter après l’échéance : fin enregistrée, jamais d’état « en cours »', async () => {
    const io = saver();
    const ctl = new SessionController(limited(), io.save);
    const res = await prepareExit(ctl, source(T0 + 61_000));
    expect(res.status).toBe('ended');
    expect(ctl.current).toMatchObject({ status: 'finished', timedOut: true });
    expect(io.calls.every((c) => !inQuestions(c))).toBe(true);
  });

  it('quitter après l’échéance, écriture refusée : échec signalé, aucun état « en cours » écrit, réessai', async () => {
    const io = saver();
    const ctl = new SessionController(limited(), io.save);
    io.set('fail');
    expect(await prepareExit(ctl, source(T0 + 61_000))).toMatchObject({ status: 'end-failed', error: 'QuotaExceededError' });
    // Nouvelle tentative de sortie : la fin déjà en échec attend le réessai explicite, rien n'est écrit
    const before = io.calls.length;
    expect(await prepareExit(ctl, source(T0 + 62_000))).toEqual({ status: 'end-failed', error: null, stale: false });
    expect(io.calls).toHaveLength(before);
    expect(io.calls.every((c) => !inQuestions(c))).toBe(true);
    io.set('ok');
    expect((await ctl.retry()).status).toBe('saved');
    expect(ctl.current.status).toBe('finished');
  });

  it('quitter après l’échéance avec une réponse non enregistrée : la fin conserve la réponse', async () => {
    const io = saver();
    const ctl = new SessionController(limited(), io.save);
    io.set('fail');
    await applyUserTransition(ctl, source(T0 + 58_000), answer('a'));
    io.set('ok');
    const res = await prepareExit(ctl, source(T0 + 70_000));
    expect(res.status === 'ended' && res.session).toMatchObject({ status: 'finished', timedOut: true, elapsedMs: 60_000 });
    expect(ctl.current.answers['a']).toBeDefined();
  });

  it('quitter avant l’échéance : temps enregistré ; temps écoulé : temps actif conservé, y compris celui d’une réponse abandonnée', async () => {
    const io = saver();
    const ctl = new SessionController(limited(), io.save);
    expect(await prepareExit(ctl, source(T0 + 30_000))).toEqual({ status: 'leave' });
    expect(io.calls.at(-1)).toMatchObject({ status: 'in_progress', elapsedMs: 30_000, deadlineAt: iso(T0 + 60_000) });

    const io2 = saver();
    const e = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', cfg({ timer: { mode: 'elapsed' } }), ['a', 'b'], NOW);
    const ctl2 = new SessionController(e, io2.save);
    io2.set('fail');
    await applyUserTransition(ctl2, source(T0, 10_000), answer('a')); // 10 s portées par la réponse en échec
    io2.set('ok');
    expect(await prepareExit(ctl2, source(T0, 5_000))).toEqual({ status: 'leave' });
    expect(ctl2.current).toMatchObject({ status: 'in_progress', currentIndex: 0, elapsedMs: 15_000 });
    expect(ctl2.current.answers['a']).toBeUndefined();
  });

  it('quitter sans chronomètre : rien n’est enregistré ; échec d’enregistrement du temps signalé', async () => {
    const io = saver();
    const off = new SessionController(createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', cfg(), ['a'], NOW), io.save);
    expect(await prepareExit(off, source(T0 + 5_000))).toEqual({ status: 'leave' });
    expect(io.calls).toHaveLength(0);
    const io2 = saver();
    const ctl = new SessionController(limited(), io2.save);
    io2.set('fail');
    expect(await prepareExit(ctl, source(T0 + 10_000))).toMatchObject({ status: 'save-failed' });
  });
});

describe('3 — actualisation de l’aperçu', () => {
  const before: CardMeta[] = [];
  const after: CardMeta[] = [];

  it('n’est annoncée qu’après rechargement de la bibliothèque ET relecture des statuts pour celle-ci', () => {
    expect(previewRefreshPhase({ status: 'loading' }, { loadedFor: before, error: null }, before)).toEqual({ phase: 'loading' });
    // Bibliothèque rechargée, statuts encore ceux de l'ancienne bibliothèque
    expect(previewRefreshPhase({ status: 'done' }, { loadedFor: before, error: null }, after)).toEqual({ phase: 'loading' });
    expect(previewRefreshPhase({ status: 'done' }, { loadedFor: after, error: null }, after)).toEqual({ phase: 'done' });
  });

  it('échec puis réessai : échec du rechargement de la bibliothèque, puis des statuts, puis réussite', () => {
    expect(previewRefreshPhase({ status: 'failed', error: 'lecture impossible' }, { loadedFor: before, error: null }, before)).toEqual({
      phase: 'failed',
      error: 'lecture impossible',
    });
    expect(previewRefreshPhase({ status: 'done' }, { loadedFor: after, error: 'états illisibles' }, after)).toEqual({
      phase: 'failed',
      error: 'états illisibles',
    });
    expect(previewRefreshPhase({ status: 'done' }, { loadedFor: after, error: null }, after)).toEqual({ phase: 'done' });
  });
});
