// v1.2 : intégration des tests libres à la répétition espacée. Règles (schedule.ts) et enregistrement (repo.ts).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { TestSession } from '../domain/types';
import { buildCards } from '../imports/buildCards';
import { openFlashcardsDb, type DB } from '../storage/db';
import * as repo from '../storage/repo';
import { ROOT_ID } from '../taxonomy/tree';
import { createSession, deferAnswer, gradeMcq, recordAnswer, advance, selfEvaluate } from '../tests/session';
import { introducedFromLog } from './queue';
import { addDays, applyFreeTest, applyRating, applyRevision, inDueWindow, type ReviewState } from './schedule';

const T = '2026-11-02';
const AT = `${T}T10:00:00.000Z`;
const mcq = (correct: boolean) => ({ kind: 'mcq' as const, correct });
const open = (rating: 'again' | 'hard' | 'good' | 'easy') => ({ kind: 'open' as const, rating });
/** Carte connue au palier `streak`, d'intervalle `interval`, échue dans `inDays` jours */
const known = (streak: number, interval: number, inDays: number): ReviewState => ({
  cardId: 'c',
  status: 'review',
  reviewCount: streak,
  lapses: 0,
  successStreak: streak,
  lastRating: 'good',
  intervalDays: interval,
  firstReviewedDay: '2026-01-01',
  lastReviewedAt: `${addDays(T, inDays - interval)}T09:00:00.000Z`,
  lastReviewedDay: addDays(T, inDays - interval),
  dueDay: addDays(T, inDays),
});

describe('règles des tests libres', () => {
  it('QCM juste : sans effet avant l’échéance, palier « Correct » à l’échéance ; QCM faux : J+1 même loin de l’échéance', () => {
    expect(applyFreeTest(known(2, 7, 2), 'c', mcq(true), T, AT)).toBeUndefined();
    expect(applyFreeTest(known(2, 7, 0), 'c', mcq(true), T, AT)).toMatchObject({ successStreak: 3, intervalDays: 14, dueDay: addDays(T, 14), lastSource: 'libre' });
    expect(applyFreeTest(known(4, 30, 25), 'c', mcq(false), T, AT)).toMatchObject({ status: 'learning', successStreak: 0, lapses: 1, dueDay: addDays(T, 1) });
  });

  it('question ouverte : réussite comptée dans la fenêtre d’échéance (jusqu’aux paliers de 120 jours), « Facile » sur son échelle', () => {
    expect(inDueWindow(known(5, 120, 30), T)).toBe(true);
    expect(inDueWindow(known(5, 120, 31), T)).toBe(false);
    expect(applyFreeTest(known(3, 30, 8), 'c', open('good'), T, AT)).toBeUndefined();
    expect(applyFreeTest(known(3, 30, 7), 'c', open('easy'), T, AT)).toMatchObject({ successStreak: 4, intervalDays: 60, lastRating: 'easy' });
    expect(applyFreeTest(known(3, 30, 20), 'c', open('hard'), T, AT)).toMatchObject({ status: 'learning', successStreak: 2, dueDay: addDays(T, 1) });
  });

  it('carte nouvelle : échec J+1, première réussite J+3 comptée dans la série', () => {
    expect(applyFreeTest(undefined, 'c', mcq(false), T, AT)).toMatchObject({ status: 'learning', dueDay: addDays(T, 1) });
    expect(applyFreeTest(undefined, 'c', mcq(true), T, AT)).toMatchObject({ status: 'review', successStreak: 1, intervalDays: 3, dayBase: null });
    expect(applyFreeTest(undefined, 'c', open('easy'), T, AT)).toMatchObject({ successStreak: 1, intervalDays: 3, lastRating: 'easy' });
  });

  it('réussites successives à échéance : un palier à chaque fois, sans effet si anticipées (QCM et question ouverte)', () => {
    // QCM : J+3 → 7 → 14 → 30, une réussite anticipée ne change rien
    let s = applyFreeTest(undefined, 'c', mcq(true), T, AT)!;
    const steps: number[] = [s.intervalDays];
    for (let i = 0; i < 3; i++) {
      const early = addDays(s.dueDay, -1);
      expect(applyFreeTest(s, 'c', mcq(true), early, `${early}T10:00:00.000Z`)).toBeUndefined();
      s = applyFreeTest(s, 'c', mcq(true), s.dueDay, `${s.dueDay}T10:00:00.000Z`)!;
      steps.push(s.intervalDays);
    }
    expect(steps).toEqual([3, 7, 14, 30]);
    // Question ouverte « Correct » : même échelle ; « Facile » : échelle « Facile » à partir de la deuxième réussite
    const good = applyFreeTest(undefined, 'c', open('good'), T, AT)!;
    expect(applyFreeTest(good, 'c', open('good'), good.dueDay, AT)).toMatchObject({ successStreak: 2, intervalDays: 7 });
    const easy = applyFreeTest(undefined, 'c', open('easy'), T, AT)!;
    expect(applyFreeTest(easy, 'c', open('easy'), easy.dueDay, AT)).toMatchObject({ successStreak: 2, intervalDays: 14 });
    // Après un échec (série remise à 0), la reprise repart du premier palier
    const lapse = applyFreeTest(s, 'c', mcq(false), addDays(s.dueDay, 1), AT)!;
    expect(applyFreeTest(lapse, 'c', mcq(true), lapse.dueDay, AT)).toMatchObject({ successStreak: 1, intervalDays: 3 });
    // « Difficile » baisse la série d'un cran : la réussite suivante reprend un palier plus bas
    const hard = applyFreeTest(s, 'c', open('hard'), addDays(s.dueDay, -20), AT)!;
    expect(applyFreeTest(hard, 'c', open('good'), hard.dueDay, AT)).toMatchObject({ successStreak: 4, intervalDays: 30 });
  });

  it('même jour : pas de seconde progression ; un échec remplace la réussite, compté une seule fois', () => {
    const first = applyFreeTest(known(2, 7, 0), 'c', mcq(true), T, AT)!;
    expect(applyFreeTest(first, 'c', mcq(true), T, AT)).toBeUndefined();
    expect(applyFreeTest(first, 'c', open('easy'), T, AT)).toBeUndefined();
    const fail = applyFreeTest(first, 'c', mcq(false), T, AT)!;
    expect(fail).toMatchObject({ successStreak: 0, lapses: 1, reviewCount: 3, dueDay: addDays(T, 1) });
    expect(applyFreeTest(fail, 'c', mcq(false), T, AT)).toBeUndefined();
  });

  it('révision après un test libre le même jour : l’évaluation de révision remplace celle du test, sans cumul', () => {
    const base = known(2, 7, 0);
    const afterTest = applyFreeTest(base, 'c', mcq(true), T, AT)!;
    const afterRevision = applyRevision(afterTest, 'c', 'easy', T, AT);
    expect(afterRevision).toEqual(expect.objectContaining({ ...applyRating(base, 'c', 'easy', T, AT), dayBase: expect.anything() }));
    expect(afterRevision.successStreak).toBe(3);
    expect(afterRevision.lastSource).toBeUndefined();
    // Un état antérieur (sans base du jour) suit la règle de révision habituelle
    expect(applyRevision(base, 'c', 'good', T, AT)).toMatchObject(applyRating(base, 'c', 'good', T, AT));
  });
});

// ---------- Enregistrement ----------
let n = 0;
const D = T;
async function setup(): Promise<{ db: DB; ids: string[] }> {
  const db = await openFlashcardsDb(`free-${++n}`);
  const drafts = buildCards(
    [
      ['F1', 'Q1 ?\nA) un  B) deux', 'B'],
      ['F2', 'Question ouverte', 'Réponse'],
    ],
    { externalId: 0, question: 1, reponse: 2 },
    { matiere: 'Calcul' },
  ).drafts;
  const out = await repo.commitImport(db, { kind: 'new', name: 'C' }, 'c.csv', drafts);
  const ids = (await repo.getCardsOfCollection(db, out.collectionId)).sort((a, b) => a.externalId!.localeCompare(b.externalId!)).map((c) => c.cardId);
  return { db, ids };
}
const free = (ids: string[], correction: 'immediate' | 'end' = 'immediate') =>
  createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: null, format: 'all', order: 'library', correction }, ids, AT, 'libre');
const save = (db: DB, s: TestSession) => repo.saveEvaluatedTransition(db, s, D, AT);
const bump = (prev: TestSession, next: TestSession): TestSession => ({ ...next, revision: (prev.revision ?? 0) + 1 });

describe('enregistrement d’un test libre', () => {
  it('réponse appliquée une seule fois (rechargement), historique « libre », quota et régularité inchangés', async () => {
    const { db, ids } = await setup();
    const [q, o] = ids as [string, string];
    let s = free([q, o]);
    await repo.startNewSession(db, s, AT);
    const card = (await repo.getCard(db, q))!;
    const answered = bump(s, recordAnswer(s, q, gradeMcq(card, 'A', AT)));
    await save(db, answered);
    s = answered;
    expect(await repo.getReviewState(db, q)).toMatchObject({ status: 'learning', dueDay: addDays(D, 1), lastSource: 'libre' });
    // Transition suivante (passage à la question ouverte) : la réponse déjà enregistrée n'est pas réappliquée
    const moved = bump(s, advance(s, AT));
    await save(db, moved);
    expect((await repo.getReviewState(db, q))!.lapses).toBe(1);
    const log = await repo.getReviewLogForCard(db, q);
    expect(log).toEqual([expect.objectContaining({ mode: 'libre', rating: 'again', correct: false })]);
    expect(introducedFromLog(log, D)).toBe(0);
    expect((await repo.listReviewDays(db)).size).toBe(0);
    // La même transition, rejouée depuis une copie périmée, est refusée sans rien écrire
    await expect(save(db, moved)).rejects.toThrow();
    expect(await repo.getReviewLogForCard(db, q)).toHaveLength(1);
  });

  it('question laissée sans réponse ou autoévaluation reportée : aucun effet, puis effet à l’autoévaluation', async () => {
    const { db, ids } = await setup();
    const o = ids[1]!;
    const s = free([o], 'end');
    await repo.startNewSession(db, s, AT);
    const deferred = bump(s, recordAnswer(s, o, deferAnswer(AT)));
    await save(db, deferred);
    expect(await repo.getReviewState(db, o)).toBeUndefined();
    const evaluated = bump(deferred, { ...deferred, answers: { ...deferred.answers, [o]: selfEvaluate('good', AT) } });
    await save(db, evaluated);
    expect(await repo.getReviewState(db, o)).toMatchObject({ successStreak: 1, intervalDays: 3 });
  });
});
