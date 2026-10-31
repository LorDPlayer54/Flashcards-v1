// Tests du moteur de répétition espacée (lot 2) : algorithme, plafond, équité, séance avec reprises.
import { describe, expect, it } from 'vitest';
import type { CardMeta } from '../domain/types';
import { ROOT_ID } from '../taxonomy/tree';
import {
  advance,
  createSession,
  currentAnswer,
  currentCardId,
  gradeMcq,
  isRepeatPosition,
  rateMcq,
  recordAnswer,
  selfEvaluate,
  sequence,
  summarize,
} from '../tests/session';
import { introducedFromLog, newRemainingToday, planReview, roundRobinByMatiere, sameQueue } from './queue';
import { addDays, applyRating, daysBetween, isDue, isMastered, localDay, type Rating, type ReviewState } from './schedule';

const D = '2026-10-30';
const NOW = '2026-10-30T09:00:00.000Z';

/** Enchaîne des notes, chacune le jour de l'échéance précédente */
function run(ratings: Rating[], start = D): ReviewState {
  let s: ReviewState | undefined;
  let day = start;
  for (const r of ratings) {
    s = applyRating(s, 'c', r, day, NOW);
    day = s.dueDay;
  }
  return s!;
}

describe('dates locales', () => {
  it('ajoute des jours en franchissant mois, année et années bissextiles', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); // passage à l'heure d'été en Europe : sans effet
    expect(daysBetween('2026-10-30', '2027-02-27')).toBe(120);
  });
  it('produit la date locale au format AAAA-MM-JJ', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('refuse une date mal formée', () => expect(() => addDays('30/10/2026', 1)).toThrow());
});

describe('algorithme V1', () => {
  it('« À revoir » : série remise à zéro, apprentissage, J+1', () => {
    const s = run(['good', 'good', 'again']);
    expect(s).toMatchObject({ status: 'learning', successStreak: 0, intervalDays: 1, lapses: 1, reviewCount: 3, lastRating: 'again' });
    expect(daysBetween(s.lastReviewedDay, s.dueDay)).toBe(1);
  });
  it('« Difficile » : apprentissage, J+1, la série redescend d’un cran', () => {
    const s = run(['good', 'good', 'hard']);
    expect(s).toMatchObject({ status: 'learning', successStreak: 1, intervalDays: 1 });
    expect(applyRating(undefined, 'c', 'hard', D, NOW)).toMatchObject({ successStreak: 0, intervalDays: 1, dueDay: '2026-10-31' });
  });
  it('« Correct » : 3, 7, 14, 30, 60 puis 60', () => {
    const intervals = [1, 2, 3, 4, 5, 6].map((k) => run(Array<Rating>(k).fill('good')).intervalDays);
    expect(intervals).toEqual([3, 7, 14, 30, 60, 60]);
  });
  it('« Facile » : 7, 14, 30, 60, 120 puis 120', () => {
    const intervals = [1, 2, 3, 4, 5, 6].map((k) => run(Array<Rating>(k).fill('easy')).intervalDays);
    expect(intervals).toEqual([7, 14, 30, 60, 120, 120]);
  });
  it('l’intervalle dépend de l’historique individuel', () => {
    expect(run(['good', 'easy']).intervalDays).toBe(14); // 2e réussite sur l'échelle « Facile »
    expect(run(['easy', 'good']).intervalDays).toBe(7); // 2e réussite sur l'échelle « Correct »
    expect(run(['good', 'good', 'hard', 'good']).intervalDays).toBe(7); // reprise un palier plus bas
    expect(run(['good', 'good', 'again', 'good']).intervalDays).toBe(3); // repart du début
  });
  it('échéance = jour de révision + intervalle ; date de première révision conservée', () => {
    const first = applyRating(undefined, 'c', 'good', D, NOW);
    expect(first).toMatchObject({ dueDay: '2026-11-02', firstReviewedDay: D, lastReviewedDay: D });
    const second = applyRating(first, 'c', 'easy', '2026-11-02', NOW);
    expect(second).toMatchObject({ firstReviewedDay: D, dueDay: addDays('2026-11-02', 14) });
  });
  it('maîtrise : dernière note Correct/Facile et intervalle ≥ 14 jours', () => {
    expect(isMastered(run(['good', 'good']))).toBe(false); // 7 j
    expect(isMastered(run(['good', 'good', 'good']))).toBe(true); // 14 j
    expect(isMastered(run(['easy', 'easy']))).toBe(true);
    expect(isMastered(run(['easy', 'easy', 'hard']))).toBe(false);
    expect(isMastered(undefined)).toBe(false);
  });
  it('échéance : due le jour même et après, pas avant', () => {
    const s = applyRating(undefined, 'c', 'good', D, NOW); // due le 2026-11-02
    expect(isDue(s, '2026-11-01')).toBe(false);
    expect(isDue(s, '2026-11-02')).toBe(true);
    expect(isDue(s, '2026-12-01')).toBe(true);
    expect(isDue(undefined, D)).toBe(false); // une carte nouvelle n'est pas « due »
  });
});

// ---------- File de révision ----------

let k = 0;
const meta = (matiere: string): CardMeta => ({ cardId: `${matiere}-${++k}`, collectionId: 'c', matiere, formatQuestion: 'open', sourceRow: k });
const st = (cardId: string, dueDay: string, firstReviewedDay = '2026-10-01'): ReviewState => ({
  cardId,
  status: 'review',
  reviewCount: 1,
  lapses: 0,
  successStreak: 1,
  lastRating: 'good',
  intervalDays: 3,
  firstReviewedDay,
  lastReviewedAt: NOW,
  lastReviewedDay: firstReviewedDay,
  dueDay,
});

describe('plafond global de nouvelles cartes (décompte par l’historique, v0.2.1)', () => {
  const log = (cardId: string, day: string, extra: { repeat?: boolean; previousDueDay?: string } = {}) => ({
    cardId,
    day,
    repeat: extra.repeat ?? false,
    previousDueDay: extra.previousDueDay,
  });
  it('compte les cartes vues nouvelles aujourd’hui, toutes matières confondues, une fois chacune', () => {
    const entries = [
      log('a', D), // nouvelle aujourd'hui
      log('a', D, { repeat: true }), // sa reprise de fin de séance : ne compte pas
      log('b', D),
      log('b', D), // revue nouvelle une 2e fois (réinitialisée puis réétudiée) : comptée une seule fois
      log('c', D, { previousDueDay: '2026-10-29' }), // carte déjà connue : ne compte pas
      log('d', '2026-10-29'), // autre jour
    ];
    expect(introducedFromLog(entries, D)).toBe(2);
    expect(newRemainingToday(2, 20)).toBe(18);
    expect(newRemainingToday(2, 1)).toBe(0);
    expect(newRemainingToday(0, 0)).toBe(0);
  });
  it('compare deux files à l’identique (cartes et ordre)', () => {
    expect(sameQueue(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameQueue(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameQueue(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('composition de la séance', () => {
  const calcul = [meta('Calcul'), meta('Calcul'), meta('Calcul'), meta('Calcul')];
  const anglais = [meta('Anglais'), meta('Anglais')];
  const eco = [meta('Économie'), meta('Économie')];
  const all = [...calcul, ...anglais, ...eco];

  it('alterne les matières sans perdre ni dupliquer de carte', () => {
    const rr = roundRobinByMatiere(all).map((m) => m.matiere);
    expect(rr.slice(0, 6)).toEqual(['Calcul', 'Anglais', 'Économie', 'Calcul', 'Anglais', 'Économie']);
    expect(rr).toHaveLength(all.length);
  });

  it('prend toutes les dues (aucun plafond) et seulement elles, la plus ancienne échéance d’abord', () => {
    const states = new Map<string, ReviewState>([
      [calcul[0]!.cardId, st(calcul[0]!.cardId, '2026-10-30')],
      [calcul[1]!.cardId, st(calcul[1]!.cardId, '2026-10-20')],
      [anglais[0]!.cardId, st(anglais[0]!.cardId, '2026-10-29')],
      [eco[0]!.cardId, st(eco[0]!.cardId, '2026-11-05')], // pas encore due
    ]);
    const p = planReview(all, states, D, 0);
    expect(p.due).toEqual([calcul[1]!.cardId, anglais[0]!.cardId, calcul[0]!.cardId]);
    expect(p.fresh).toEqual([]);
    expect(p.nextDueDay).toBe('2026-11-05');
  });

  it('répartit le plafond de nouvelles cartes entre les matières', () => {
    const p = planReview(all, new Map(), D, 3);
    const byId = new Map(all.map((m) => [m.cardId, m.matiere]));
    expect(p.fresh.map((id) => byId.get(id))).toEqual(['Calcul', 'Anglais', 'Économie']);
    expect(p.freshAvailable).toBe(8);
    expect(p.queue).toEqual(p.fresh);
  });

  it('une matière dont des cartes sont dues n’est jamais exclue', () => {
    const states = new Map<string, ReviewState>(
      [...calcul, anglais[0]!, eco[0]!].map((m) => [m.cardId, st(m.cardId, '2026-10-01')] as const),
    );
    const p = planReview(all, states, D, 0);
    const byId = new Map(all.map((m) => [m.cardId, m.matiere]));
    expect(new Set(p.due.map((id) => byId.get(id)))).toEqual(new Set(['Calcul', 'Anglais', 'Économie']));
    expect(p.due.slice(0, 3).map((id) => byId.get(id))).toEqual(['Calcul', 'Anglais', 'Économie']);
  });

  it('dues puis nouvelles, sans doublon', () => {
    const states = new Map([[anglais[1]!.cardId, st(anglais[1]!.cardId, D)]]);
    const p = planReview([...all, ...all], states, D, 2);
    expect(p.queue[0]).toBe(anglais[1]!.cardId);
    expect(new Set(p.queue).size).toBe(p.queue.length);
    expect(p.queue).toHaveLength(3);
  });
});

describe('séance de révision : QCM, reprises de fin de séance', () => {
  const T = NOW;
  const mcq = { formatQuestion: 'mcq' as const, correctOptionId: 'B' };
  const mk = (ids: string[]) =>
    createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: null, format: 'all', order: 'library' }, ids, T, 'revision');

  it('QCM faux → « À revoir » automatique et reprise unique en fin de séance', () => {
    let s = mk(['q1', 'q2']);
    s = recordAnswer(s, 'q1', gradeMcq(mcq, 'A', T, 'revision'));
    expect(s.answers['q1']).toMatchObject({ correct: false, rating: 'again' });
    expect(s.repeatIds).toEqual(['q1']);
    s = advance(s, T);
    s = recordAnswer(s, 'q2', selfEvaluate('good', T));
    s = advance(s, T);
    expect(sequence(s)).toEqual(['q1', 'q2', 'q1']);
    expect(currentCardId(s)).toBe('q1');
    expect(isRepeatPosition(s)).toBe(true);
    expect(currentAnswer(s)).toBeUndefined(); // la reprise attend sa propre réponse
    // Nouvel échec à la reprise : PAS de seconde reprise
    s = recordAnswer(s, 'q1', gradeMcq(mcq, 'C', T, 'revision'));
    expect(s.repeatIds).toEqual(['q1']);
    expect(s.answers['q1']).toMatchObject({ selectedOptionId: 'A' }); // premier passage intact
    expect(s.repeatAnswers!['q1']).toMatchObject({ selectedOptionId: 'C' });
    s = advance(s, T);
    expect(s.status).toBe('finished');
    expect(summarize(s)).toMatchObject({ total: 2, answered: 2, ratings: { again: 1, good: 1 }, repeats: { planned: 1, done: 1 } });
  });

  it('QCM juste → noté ensuite Difficile / Correct / Facile ; pas de reprise', () => {
    let s = mk(['q1']);
    s = recordAnswer(s, 'q1', gradeMcq(mcq, 'B', T, 'revision'));
    expect(s.answers['q1']).toMatchObject({ correct: true });
    expect((s.answers['q1'] as { rating?: string }).rating).toBeUndefined();
    s = rateMcq(s, 'q1', 'easy', T);
    expect(s.answers['q1']).toMatchObject({ correct: true, rating: 'easy' });
    expect(rateMcq(s, 'q1', 'hard', T)).toBe(s); // déjà notée
    expect(s.repeatIds).toBeUndefined();
  });

  it('question ouverte « À revoir » → une seule reprise, même si elle est revue « À revoir »', () => {
    let s = mk(['o1']);
    s = advance(recordAnswer(s, 'o1', selfEvaluate('again', T)), T);
    expect(s.status).toBe('in_progress');
    s = advance(recordAnswer(s, 'o1', selfEvaluate('again', T)), T);
    expect(s.status).toBe('finished');
    expect(s.repeatIds).toEqual(['o1']);
  });

  it('en test libre : aucune note de maîtrise ni reprise', () => {
    let s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: 1, format: 'all', order: 'library' }, ['q1'], T);
    s = recordAnswer(s, 'q1', gradeMcq(mcq, 'A', T));
    expect(s.answers['q1']).not.toHaveProperty('rating');
    expect(rateMcq(s, 'q1', 'good', T)).toBe(s);
    expect(s.repeatIds).toBeUndefined();
    s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: 1, format: 'all', order: 'library' }, ['o1'], T);
    expect(advance(recordAnswer(s, 'o1', selfEvaluate('again', T)), T).status).toBe('finished');
  });
});
