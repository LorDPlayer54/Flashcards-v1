// Lot 3B : pause / reprise d'un entraînement chronométré.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { TestConfig, TestSession } from '../domain/types';
import { openFlashcardsDb } from '../storage/db';
import * as repo from '../storage/repo';
import { ROOT_ID } from '../taxonomy/tree';
import {
  advance,
  canPause,
  createSession,
  finishEarly,
  pauseSession,
  recordAnswer,
  resumeSession,
  selfEvaluate,
  withDeadline,
} from './session';
import { SessionController } from './sessionController';
import { applyUserTransition, elapsedAt, enforceTimeLimit, limitReached, prepareExit, timeLeft, type TimeSource } from './timeLimit';

const NOW = '2026-11-02T09:00:00.000Z';
const T0 = Date.parse(NOW);
const iso = (ms: number) => new Date(ms).toISOString();
const cfg = (over: Partial<TestConfig> = {}): TestConfig => ({ count: null, format: 'all', order: 'library', ...over });
const TRAINING = cfg({ timer: { mode: 'limit', limitSec: 600, pausable: true } });
const EXAM = cfg({ timer: { mode: 'limit', limitSec: 600 } });
const ELAPSED = cfg({ timer: { mode: 'elapsed' } });

const make = (config: TestConfig, mode: 'libre' | 'revision' = 'libre') =>
  withDeadline(createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', config, ['a', 'b', 'c'], NOW, mode), NOW);
const src = (atMs: number, active = 0): TimeSource => {
  let a = active;
  return { now: () => atMs, peek: () => a, take: () => ((a = 0), active) };
};
const answer = (id: string) => (s: TestSession) => advance(recordAnswer(s, id, selfEvaluate('good', NOW)), NOW);
const ok = (r: { status: string }) => {
  expect(r.status).toBe('saved');
  return r as { status: 'saved'; session: TestSession };
};

describe('pause : règles', () => {
  it('possible en entraînement (temps limité ou temps écoulé), jamais en simulation d’examen, sans chronomètre ou en révision', () => {
    expect(canPause(make(TRAINING))).toBe(true);
    expect(canPause(make(ELAPSED))).toBe(true);
    expect(canPause(make(EXAM))).toBe(false);
    expect(canPause(make(cfg()))).toBe(false);
    expect(canPause(make(TRAINING, 'revision'))).toBe(false);
    expect(canPause({ ...make(TRAINING), phase: 'correction' })).toBe(false);
    expect(() => pauseSession(make(EXAM), NOW)).toThrow();
    // Séance limitée créée avant le lot 3B : pas de champ « pausable » → simulation d'examen
    const legacy = withDeadline(createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', cfg({ timer: { mode: 'limit', limitSec: 60 } }), ['a'], NOW), NOW);
    expect(canPause(legacy)).toBe(false);
  });

  it('temps limité : décompte figé pendant la pause, échéance reportée de la durée de la pause', () => {
    let s = make(TRAINING); // échéance T0 + 10 min
    s = pauseSession(s, iso(T0 + 120_000));
    expect(canPause(s)).toBe(false);
    // Deux heures plus tard (téléphone verrouillé, application fermée) : toujours 8 min
    expect(timeLeft(s, src(T0 + 7_200_000))).toBe(480_000);
    expect(limitReached(s, src(T0 + 7_200_000))).toBe(false);
    expect(elapsedAt(s, src(T0 + 7_200_000))).toBe(120_000);
    expect(() => recordAnswer(s, 'a', selfEvaluate('good', NOW))).toThrow(/pause/);
    s = resumeSession(s, iso(T0 + 7_200_000));
    expect(s.pausedAt).toBeUndefined();
    expect(s.deadlineAt).toBe(iso(T0 + 600_000 + 7_080_000));
    expect(timeLeft(s, src(T0 + 7_200_000))).toBe(480_000);
    expect(timeLeft(s, src(T0 + 7_200_000 + 60_000))).toBe(420_000);
    expect(resumeSession(s, iso(T0))).toBe(s); // reprendre sans pause : sans effet
  });

  it('terminer pendant la pause : la pause est levée, le temps de la pause n’est pas compté', () => {
    let s = pauseSession(make(TRAINING), iso(T0 + 60_000));
    s = finishEarly(s, iso(T0 + 3_600_000));
    expect(s).toMatchObject({ status: 'finished' });
    expect(s.pausedAt).toBeUndefined();
    const end = pauseSession(make({ ...TRAINING, correction: 'end' }), iso(T0 + 1000));
    expect(finishEarly(end, iso(T0 + 2000))).toMatchObject({ status: 'in_progress', phase: 'correction' });
  });
});

describe('pause : enregistrement', () => {
  it('temps écoulé : le temps actif est enregistré à la pause ; reprise sans temps ajouté', async () => {
    const saved: TestSession[] = [];
    const ctl = new SessionController(make(ELAPSED), async (x) => void saved.push(x));
    ok(await applyUserTransition(ctl, src(T0, 12_000), answer('a')));
    ok(await applyUserTransition(ctl, src(T0, 3_000), (s) => pauseSession(s, iso(T0 + 15_000))));
    expect(ctl.current).toMatchObject({ elapsedMs: 15_000, pausedAt: iso(T0 + 15_000) });
    // Pendant la pause, l'horloge active de l'écran est arrêtée (aucun temps à confier)
    ok(await applyUserTransition(ctl, src(T0 + 900_000, 0), (s) => resumeSession(s, iso(T0 + 900_000))));
    expect(ctl.current.elapsedMs).toBe(15_000);
    expect(ctl.current.pausedAt).toBeUndefined();
  });

  it('temps limité : pause, fermeture, réouverture deux heures plus tard, reprise ; la limite n’expire pas pendant la pause', async () => {
    const db = await openFlashcardsDb(`lot3b-pause-${Date.now()}`);
    const s0 = make(TRAINING);
    await repo.startNewSession(db, s0, NOW);
    let ctl = new SessionController(s0, (x) => repo.saveSessionTransition(db, x));
    ok(await applyUserTransition(ctl, src(T0 + 100_000), answer('a')));
    ok(await applyUserTransition(ctl, src(T0 + 130_000), (s) => pauseSession(s, iso(T0 + 130_000))));
    // « Quitter » pendant la pause : la pause est conservée
    expect(await prepareExit(ctl, src(T0 + 140_000))).toEqual({ status: 'leave' });
    const stored = (await repo.getSession(db, s0.sessionId))!;
    expect(stored).toMatchObject({ pausedAt: iso(T0 + 130_000), elapsedMs: 130_000, status: 'in_progress' });

    // Réouverture bien après l'échéance initiale : rien n'expire, aucune réponse acceptée tant que la pause dure
    ctl = new SessionController(withDeadline(stored, iso(T0 + 7_200_000)), (x) => repo.saveSessionTransition(db, x));
    expect(await enforceTimeLimit(ctl, src(T0 + 7_200_000))).toEqual({ status: 'none' });
    await expect(applyUserTransition(ctl, src(T0 + 7_200_000), answer('b'))).rejects.toThrow(/pause/);
    expect(ctl.pending).toBeNull();
    // Reprise : 470 s restantes (600 − 130), puis réponse acceptée et enregistrée
    ok(await applyUserTransition(ctl, src(T0 + 7_200_000), (s) => resumeSession(s, iso(T0 + 7_200_000))));
    expect(timeLeft(ctl.current, src(T0 + 7_200_000))).toBe(470_000);
    ok(await applyUserTransition(ctl, src(T0 + 7_210_000), answer('b')));
    const end = (await repo.getSession(db, s0.sessionId))!;
    expect(end).toMatchObject({ currentIndex: 2, elapsedMs: 140_000 });
    expect(end.pausedAt).toBeUndefined();
    expect(await db.getAll('reviewStates')).toEqual([]);
  });
});
