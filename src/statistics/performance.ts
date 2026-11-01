// Refonte (Statistiques V6) : indicateur de performance aux exercices par matière et détail d'une journée.
// Fonctions pures, calculées sur les réponses enregistrées (collectAnswers). Aucune donnée nouvelle n'est stockée.
//
// Indicateur de performance (ce n'est pas une mesure de maîtrise ni de mémorisation) :
//  - QCM : taux de bonnes réponses ;
//  - questions ouvertes : part des autoévaluations « À revoir » ou « Difficile » ;
//  - indice sur 100 = moyenne des composantes disponibles (taux QCM, 1 − part « À revoir »/« Difficile ») ;
//  - une matière n'est classée qu'à partir de MIN_ANSWERS réponses ; point fort et point faible exigent
//    au moins deux matières classées.
import type { SelfEval, SessionMode } from '../domain/types';
import type { AnswerFact } from './stats';

export const MIN_ANSWERS = 10;
const EVALS: SelfEval[] = ['again', 'hard', 'good', 'easy'];

export interface SubjectPerformance {
  subject: string;
  answers: number;
  mcqCorrect: number;
  mcqTotal: number;
  open: Record<SelfEval, number>;
  openTotal: number;
  /** Autoévaluations « À revoir » + « Difficile » */
  flagged: number;
  qcmRate: number | null;
  difficultRate: number | null;
  /** Indice sur 100, null si moins de MIN_ANSWERS réponses */
  score: number | null;
}

function emptyEvals(): Record<SelfEval, number> {
  return { again: 0, hard: 0, good: 0, easy: 0 };
}

export function subjectPerformance(facts: readonly AnswerFact[], subjectOf: (cardId: string) => string | undefined): SubjectPerformance[] {
  const acc = new Map<string, { mcqCorrect: number; mcqTotal: number; open: Record<SelfEval, number> }>();
  for (const f of facts) {
    const subject = subjectOf(f.cardId);
    if (!subject) continue; // carte supprimée depuis
    const a = acc.get(subject) ?? { mcqCorrect: 0, mcqTotal: 0, open: emptyEvals() };
    if (f.kind === 'mcq') {
      a.mcqTotal++;
      if (f.correct) a.mcqCorrect++;
    } else if (f.selfEval) a.open[f.selfEval]++;
    acc.set(subject, a);
  }
  return [...acc.entries()].map(([subject, a]) => {
    const openTotal = EVALS.reduce((n, e) => n + a.open[e], 0);
    const flagged = a.open.again + a.open.hard;
    const qcmRate = a.mcqTotal ? a.mcqCorrect / a.mcqTotal : null;
    const difficultRate = openTotal ? flagged / openTotal : null;
    const answers = a.mcqTotal + openTotal;
    const parts = [qcmRate, difficultRate === null ? null : 1 - difficultRate].filter((x): x is number => x !== null);
    const score = answers >= MIN_ANSWERS && parts.length ? Math.round((parts.reduce((s, x) => s + x, 0) / parts.length) * 100) : null;
    return { subject, answers, mcqCorrect: a.mcqCorrect, mcqTotal: a.mcqTotal, open: a.open, openTotal, flagged, qcmRate, difficultRate, score };
  });
}

/** Tri : matières classées par indice décroissant (puis volume, puis nom), non classées ensuite. */
export function sortPerformance(rows: readonly SubjectPerformance[]): SubjectPerformance[] {
  return [...rows].sort(
    (a, b) =>
      (b.score ?? -1) - (a.score ?? -1) || b.answers - a.answers || a.subject.localeCompare(b.subject, 'fr'),
  );
}

/** Point fort et point faible ; null si moins de deux matières classées. */
export function highlights(rows: readonly SubjectPerformance[]): { strong: SubjectPerformance; weak: SubjectPerformance } | null {
  const ranked = sortPerformance(rows).filter((r) => r.score !== null);
  if (ranked.length < 2) return null;
  return { strong: ranked[0]!, weak: ranked[ranked.length - 1]! };
}

export interface DayDetail {
  answers: number;
  sessions: number;
  mcqCorrect: number;
  mcqTotal: number;
  open: Record<SelfEval, number>;
  openTotal: number;
}

/** Détail d'une journée pour un type de séance (révisions ou tests libres). */
export function dayDetail(facts: readonly AnswerFact[], day: string, mode: SessionMode): DayDetail {
  const list = facts.filter((f) => f.day === day && f.mode === mode);
  const open = emptyEvals();
  let mcqCorrect = 0;
  let mcqTotal = 0;
  for (const f of list) {
    if (f.kind === 'mcq') {
      mcqTotal++;
      if (f.correct) mcqCorrect++;
    } else if (f.selfEval) open[f.selfEval]++;
  }
  return {
    answers: list.length,
    sessions: new Set(list.map((f) => f.sessionId)).size,
    mcqCorrect,
    mcqTotal,
    open,
    openTotal: EVALS.reduce((n, e) => n + open[e], 0),
  };
}
