// Lot 3B : statistiques (fonctions pures), calculées sur des données enregistrées.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { CardMeta, TestSession } from '../domain/types';
import { buildCards } from '../imports/buildCards';
import { applyRating, type ReviewState } from '../review/schedule';
import { activity, childRows, collectAnswers, levelCounts, resultStats, sessionHistory, summarizeActivity, weakSpots } from '../statistics/stats';
import { openFlashcardsDb } from '../storage/db';
import * as repo from '../storage/repo';
import { buildTaxonomy, cardsUnder, nodeIdFor, ROOT_ID } from '../taxonomy/tree';
import { advance, createSession, deferAnswer, gradeMcq, recordAnswer, selfEvaluate } from './session';

const TODAY = '2026-11-10';
const at = (day: string, h = 10) => `${day}T${String(h).padStart(2, '0')}:00:00`;
const dayOf = (iso: string) => iso.slice(0, 10);
const meta = (cardId: string, matiere: string, theme?: string, notion?: string, formatQuestion: 'open' | 'mcq' = 'open'): CardMeta => ({
  cardId,
  collectionId: 'c',
  matiere,
  theme,
  notion,
  formatQuestion,
  sourceRow: Number(cardId.slice(1)),
});
const metas = [
  meta('c1', 'Calcul', 'Fractions', 'Addition', 'mcq'),
  meta('c2', 'Calcul', 'Fractions', 'Addition'),
  meta('c3', 'Calcul', 'Fractions', 'Simplification'),
  meta('c4', 'Calcul', 'Pourcentages'),
  meta('c5', 'Anglais', 'Grammaire'),
];
const tax = buildTaxonomy(metas);
const calc = nodeIdFor([{ kind: 'matiere', label: 'Calcul' }]);
const addition = nodeIdFor([
  { kind: 'matiere', label: 'Calcul' },
  { kind: 'theme', label: 'Fractions' },
  { kind: 'notion', label: 'Addition' },
]);
const rate = (id: string, ratings: ('again' | 'hard' | 'good' | 'easy')[], day = '2026-10-01'): ReviewState => {
  let s: ReviewState | undefined;
  for (const r of ratings) s = applyRating(s, id, r, day, at(day));
  return s!;
};

/** Séance avec réponses données (cardId → réponse) à une date */
function session(ids: string[], answers: Record<string, 'ok' | 'ko' | 'again' | 'good' | 'deferred'>, day: string, mode: 'libre' | 'revision' = 'libre', extra: Partial<TestSession> = {}): TestSession {
  const config = { count: null, format: 'all' as const, order: 'library' as const, ...(Object.values(answers).includes('deferred') ? { correction: 'end' as const } : {}) };
  let s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', config, ids, at(day), mode);
  for (const id of ids) {
    const a = answers[id];
    if (!a) break;
    const t = at(day);
    const rec =
      a === 'ok' || a === 'ko'
        ? { kind: 'mcq' as const, selectedOptionId: a === 'ok' ? 'A' : 'B', correct: a === 'ok', answeredAt: t, ...(mode === 'revision' ? { rating: a === 'ok' ? ('good' as const) : ('again' as const) } : {}) }
        : a === 'deferred'
          ? deferAnswer(t)
          : selfEvaluate(a, t);
    s = advance(recordAnswer(s, id, rec), t);
  }
  return { ...s, ...extra };
}

describe('compteurs par niveau', () => {
  const states = new Map<string, ReviewState>([
    ['c1', rate('c1', ['good', 'good', 'good'])], // intervalle 14 : maîtrisée ; due le 2026-10-15
    ['c2', rate('c2', ['again'], '2026-11-10')], // due demain
    ['c4', rate('c4', ['hard'], '2026-11-05')], // due
  ]);

  it('étudiées, nouvelles, dues, maîtrisées — global et par niveau', () => {
    expect(levelCounts(metas, states, TODAY)).toEqual({ cards: 5, studied: 3, fresh: 2, due: 2, mastered: 1 });
    expect(levelCounts(cardsUnder(tax, metas, addition), states, TODAY)).toEqual({ cards: 2, studied: 2, fresh: 0, due: 1, mastered: 1 });
  });

  it('sous-niveaux : matières à la racine, thèmes d’une matière', () => {
    expect(childRows(tax.root, metas, tax, states, TODAY).map((r) => [r.node.label, r.counts.cards, r.counts.studied])).toEqual([
      ['Calcul', 4, 3],
      ['Anglais', 1, 0],
    ]);
    const rows = childRows(tax.byId.get(calc)!, cardsUnder(tax, metas, calc), tax, states, TODAY);
    expect(rows.map((r) => [r.node.label, r.counts])).toEqual([
      ['Fractions', { cards: 3, studied: 2, fresh: 1, due: 1, mastered: 1 }],
      ['Pourcentages', { cards: 1, studied: 1, fresh: 0, due: 1, mastered: 0 }],
    ]);
  });
});

describe('réponses, résultats et activité', () => {
  const sessions = [
    session(['c1', 'c2', 'c3'], { c1: 'ok', c2: 'again', c3: 'good' }, '2026-11-10'),
    session(['c1', 'c2'], { c1: 'ko', c2: 'again' }, '2026-11-08', 'revision'),
    session(['c1', 'c3', 'c5'], { c1: 'ko', c3: 'deferred' }, '2026-11-04', 'libre', { status: 'abandoned' }),
    session(['c2'], { c2: 'good' }, '2026-10-20'),
    session(['gone'], { gone: 'again' }, '2026-11-09'), // carte supprimée depuis
  ];
  const facts = collectAnswers(sessions, dayOf);

  it('premier passage seulement ; autoévaluation en attente non comptée ; séances interrompues comptées', () => {
    expect(facts).toHaveLength(8);
    expect(facts.filter((f) => f.cardId === 'c3').map((f) => f.selfEval)).toEqual(['good']);
    // La révision a programmé une reprise de c1 et c2 : non recomptée
    expect(sessions[1]!.repeatIds).toEqual(['c1', 'c2']);
  });

  it('QCM : taux objectif seul ; questions ouvertes : autoévaluations à part ; répartition par mode', () => {
    const r = resultStats(facts);
    expect(r.mcq).toEqual({ answered: 3, correct: 1, rate: 1 / 3 });
    expect(r.open).toEqual({ answered: 5, byEval: { again: 3, hard: 0, good: 2, easy: 0 } });
    expect(r.byMode.revision).toEqual({ answers: 2, mcqAnswered: 1, mcqCorrect: 0 });
    expect(r.byMode.libre.answers).toBe(6);
  });

  it('activité sur 7 et 30 jours', () => {
    const week = activity(facts, TODAY, 7);
    expect(week.map((d) => d.day)).toEqual(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
    expect(week.map((d) => [d.libre, d.revision])).toEqual([
      [1, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 2],
      [1, 0],
      [3, 0],
    ]);
    expect(summarizeActivity(week, facts)).toEqual({ answers: 7, activeDays: 4, sessions: 4 });
    expect(summarizeActivity(activity(facts, TODAY, 30), facts)).toEqual({ answers: 8, activeDays: 5, sessions: 5 });
  });

  it('notions difficiles : niveau le plus précis, au moins 3 réponses, tri par taux d’erreur', () => {
    const weak = weakSpots(facts, tax);
    expect(weak).toEqual([{ nodeId: addition, label: 'Calcul › Fractions › Addition', answered: 6, errors: 4, errorRate: 4 / 6 }]);
    expect(weakSpots(facts, tax, { minAnswers: 1 }).map((w) => w.label)).toEqual(['Calcul › Fractions › Addition']);
  });

  it('vue d’un niveau : réponses et séances des seules cartes du niveau', () => {
    const inAnglais = new Set(cardsUnder(tax, metas, nodeIdFor([{ kind: 'matiere', label: 'Anglais' }])).map((m) => m.cardId));
    expect(facts.filter((f) => inAnglais.has(f.cardId))).toEqual([]);
    const hist = sessionHistory(sessions, { inScope: (id) => inAnglais.has(id) });
    expect(hist.map((h) => [h.status, h.answered, h.total])).toEqual([['abandoned', 2, 3]]);
  });

  it('historique : du plus récent au plus ancien, avec scores', () => {
    const hist = sessionHistory(sessions);
    expect(hist[0]).toMatchObject({ mode: 'libre', answered: 3, total: 3, mcqAnswered: 1, mcqCorrect: 1, openAnswered: 2, again: 1, status: 'finished' });
    expect(hist.map((h) => h.at.slice(0, 10))).toEqual(['2026-11-10', '2026-11-09', '2026-11-08', '2026-11-04', '2026-10-20']);
  });
});

describe('données réelles enregistrées', () => {
  it('statistiques calculées sur la base : test libre et révision enregistrés', async () => {
    const db = await openFlashcardsDb(`lot3b-stats-${Date.now()}`);
    const rows = [
      ['Q1', 'Calcul', 'Fractions', 'Combien ?\nA) 1  B) 2', 'B'],
      ['Q2', 'Calcul', 'Fractions', 'Ouverte', 'R'],
    ];
    await repo.commitImport(db, { kind: 'new', name: 'C' }, 'c.csv', buildCards(rows, { externalId: 0, matiere: 1, theme: 2, question: 3, reponse: 4 }, {}).drafts);
    const ms = await repo.loadAllMeta(db);
    const [q1, q2] = [ms[0]!.cardId, ms[1]!.cardId];
    const card1 = (await repo.getCard(db, q1))!;
    let s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: null, format: 'all', order: 'library' }, [q1, q2], at(TODAY));
    await repo.startNewSession(db, s, at(TODAY));
    s = advance(recordAnswer(s, q1, gradeMcq(card1, 'B', at(TODAY), 'libre')), at(TODAY));
    s = advance(recordAnswer(s, q2, selfEvaluate('hard', at(TODAY))), at(TODAY));
    await repo.saveSessionTransition(db, { ...s, revision: 1 });
    const facts = collectAnswers(await repo.listAllSessions(db), dayOf);
    expect(resultStats(facts)).toMatchObject({ mcq: { answered: 1, correct: 1, rate: 1 }, open: { answered: 1, byEval: { hard: 1 } } });
    expect(levelCounts(ms, await repo.loadReviewStates(db), TODAY)).toEqual({ cards: 2, studied: 0, fresh: 2, due: 0, mastered: 0 });
  });
});
