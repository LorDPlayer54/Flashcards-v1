import { describe, expect, it } from 'vitest';
import type { AnswerFact } from './stats';
import { dayDetail, highlights, MIN_ANSWERS, sortPerformance, subjectPerformance } from './performance';

const subjectOf = (id: string) => id.split('-')[0];
function mcq(card: string, correct: boolean, extra: Partial<AnswerFact> = {}): AnswerFact {
  return { cardId: card, sessionId: 's1', mode: 'libre', kind: 'mcq', correct, day: '2026-11-04', ...extra };
}
function open(card: string, selfEval: AnswerFact['selfEval'], extra: Partial<AnswerFact> = {}): AnswerFact {
  return { cardId: card, sessionId: 's1', mode: 'revision', kind: 'open', selfEval, day: '2026-11-04', ...extra };
}

describe('performance par matière', () => {
  it('combine taux QCM et autoévaluations, à partir de MIN_ANSWERS réponses', () => {
    const facts = [
      ...Array.from({ length: 8 }, (_, i) => mcq(`A-${i}`, i < 6)), // 6/8
      open('A-x', 'again'),
      open('A-y', 'good'), // 1/2 difficile
      ...Array.from({ length: 5 }, (_, i) => mcq(`B-${i}`, true)),
    ];
    const rows = subjectPerformance(facts, subjectOf);
    const a = rows.find((r) => r.subject === 'A')!;
    expect(a.answers).toBe(10);
    expect(a.qcmRate).toBe(0.75);
    expect(a.difficultRate).toBe(0.5);
    expect(a.score).toBe(63); // (0,75 + 0,5) / 2
    const b = rows.find((r) => r.subject === 'B')!;
    expect(b.answers).toBeLessThan(MIN_ANSWERS);
    expect(b.score).toBeNull();
    expect(highlights(rows)).toBeNull(); // une seule matière classée
  });

  it('point fort et point faible, une seule composante si un format manque', () => {
    const facts = [
      ...Array.from({ length: 10 }, (_, i) => mcq(`A-${i}`, i < 9)), // 90
      ...Array.from({ length: 10 }, (_, i) => open(`B-${i}`, i < 4 ? 'hard' : 'easy')), // 60
      ...Array.from({ length: 10 }, (_, i) => mcq(`C-${i}`, i < 7)), // 70
      mcq('gone', false), // carte supprimée : ignorée
    ];
    const rows = subjectPerformance(facts, (id) => (id === 'gone' ? undefined : subjectOf(id)));
    expect(rows).toHaveLength(3);
    const h = highlights(rows)!;
    expect(h.strong.subject).toBe('A');
    expect(h.strong.score).toBe(90);
    expect(h.weak.subject).toBe('B');
    expect(h.weak.score).toBe(60);
    expect(sortPerformance(rows).map((r) => r.subject)).toEqual(['A', 'C', 'B']);
  });

  it('détail du jour par type de séance', () => {
    const facts = [
      mcq('A-1', true, { mode: 'revision', sessionId: 'r1' }),
      mcq('A-2', false, { mode: 'revision', sessionId: 'r2' }),
      open('A-3', 'again', { sessionId: 'r2' }),
      mcq('A-4', true), // test libre
      open('A-5', 'easy', { day: '2026-11-03' }), // autre jour
    ];
    expect(dayDetail(facts, '2026-11-04', 'revision')).toEqual({
      answers: 3,
      sessions: 2,
      mcqCorrect: 1,
      mcqTotal: 2,
      open: { again: 1, hard: 0, good: 0, easy: 0 },
      openTotal: 1,
    });
    expect(dayDetail(facts, '2026-11-04', 'libre').answers).toBe(1);
  });
});
