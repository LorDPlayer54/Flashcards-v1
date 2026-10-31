// Tests du lot 3A : périmètre multiple, filtres multicritères, explication des résultats vides,
// correction en fin de test, chronomètre, bilan approfondi, persistance et absence d'effet sur les échéances.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { UNSET, type CardMeta, type TestConfig, type TestSession } from '../domain/types';
import { buildCards } from '../imports/buildCards';
import { applyRating, type ReviewState } from '../review/schedule';
import { openFlashcardsDb } from '../storage/db';
import * as repo from '../storage/repo';
import { buildTaxonomy, nodeIdFor, ROOT_ID } from '../taxonomy/tree';
import {
  applyTestFilters,
  drawCards,
  filterOptions,
  masteryBucket,
  NO_FILTERS,
  resolveScope,
  scopeLabelOf,
  type FilterSet,
} from './selection';
import {
  addElapsed,
  advance,
  breakdown,
  createSession,
  deferAnswer,
  evaluateDeferred,
  finishCorrection,
  finishEarly,
  gradeMcq,
  isEndCorrection,
  recordAnswer,
  remainingMs,
  selfEvaluate,
  summarize,
  timeUp,
} from './session';
import { SessionController } from './sessionController';

const D = '2026-10-30';
const NOW = '2026-10-30T09:00:00.000Z';
let k = 0;
const meta = (
  matiere: string,
  theme: string | undefined,
  notion: string | undefined,
  extra: Partial<Pick<CardMeta, 'difficulte' | 'typePedagogique' | 'formatQuestion' | 'lecon'>> = {},
): CardMeta => ({
  cardId: `c${++k}`,
  collectionId: 'col',
  matiere,
  theme,
  notion,
  formatQuestion: 'open',
  sourceRow: k,
  ...extra,
});

const metas: CardMeta[] = [
  meta('Calcul', 'Fractions', 'Addition', { difficulte: 'Facile', typePedagogique: 'Application', formatQuestion: 'mcq' }),
  meta('Calcul', 'Fractions', 'Simplification', { difficulte: 'Difficile', typePedagogique: 'Connaissance' }),
  meta('Calcul', 'Pourcentages', 'Hausse', { difficulte: 'Moyen', typePedagogique: 'Piège', formatQuestion: 'mcq' }),
  meta('Anglais', 'Grammaire', 'Present perfect', { difficulte: 'Facile', lecon: 'Temps', formatQuestion: 'mcq' }),
  meta('Anglais', 'Grammaire', 'Articles', { difficulte: 'Difficile', typePedagogique: 'Application' }),
  meta('Anglais', 'Vocabulaire', undefined, {}), // ni difficulté ni type
];
const tax = buildTaxonomy(metas);
const node = (...labels: [string, ...string[]]) => {
  const kinds = ['matiere', 'theme', 'notion'] as const;
  return nodeIdFor(labels.map((label, i) => ({ kind: kinds[i]!, label })));
};
const st = (cardId: string, ratings: ('again' | 'hard' | 'good' | 'easy')[]): ReviewState => {
  let s: ReviewState | undefined;
  for (const r of ratings) s = applyRating(s, cardId, r, D, NOW);
  return s!;
};
const fs = (over: Partial<FilterSet['filters']> = {}, format: FilterSet['format'] = 'all'): FilterSet => ({
  format,
  filters: { ...NO_FILTERS, ...over },
});

describe('périmètre multiple', () => {
  it('union de deux thèmes de matières différentes, sans doublon', () => {
    const r = resolveScope({ kind: 'multi', nodeIds: [node('Calcul', 'Fractions'), node('Anglais', 'Grammaire')] }, tax, metas);
    expect(r.map((m) => m.cardId)).toEqual(['c1', 'c2', 'c4', 'c5']);
  });
  it('un niveau et l’un de ses descendants : chaque carte une seule fois', () => {
    const r = resolveScope({ kind: 'multi', nodeIds: [node('Calcul'), node('Calcul', 'Fractions'), node('Calcul', 'Fractions', 'Addition')] }, tax, metas);
    expect(r.map((m) => m.cardId)).toEqual(['c1', 'c2', 'c3']);
  });
  it('racine incluse → toute la bibliothèque ; niveau disparu ignoré', () => {
    expect(resolveScope({ kind: 'multi', nodeIds: [ROOT_ID] }, tax, metas)).toHaveLength(6);
    expect(resolveScope({ kind: 'multi', nodeIds: ['inconnu', node('Anglais', 'Vocabulaire')] }, tax, metas).map((m) => m.cardId)).toEqual(['c6']);
    expect(resolveScope({ kind: 'multi', nodeIds: [] }, tax, metas)).toEqual([]);
  });
  it('libellé lisible', () => {
    expect(scopeLabelOf({ kind: 'multi', nodeIds: [node('Calcul', 'Fractions'), node('Anglais', 'Grammaire')] }, tax)).toBe(
      'Calcul › Fractions + Anglais › Grammaire',
    );
    expect(scopeLabelOf({ kind: 'node', nodeId: ROOT_ID }, tax)).toBe('Toutes les matières');
  });
});

describe('filtres multicritères', () => {
  const states = new Map<string, ReviewState>([
    ['c1', st('c1', ['good', 'good', 'good'])], // maîtrisée (14 j)
    ['c2', st('c2', ['again'])], // en apprentissage
    ['c3', st('c3', ['good'])], // en révision (3 j), non maîtrisée
  ]);
  const ids = (f: FilterSet) => applyTestFilters(metas, f, states).eligible.map((m) => m.cardId);

  it('statut de maîtrise en catégories exclusives', () => {
    expect(['c1', 'c2', 'c3', 'c4'].map((id) => masteryBucket(states.get(id)))).toEqual(['mastered', 'learning', 'review', 'new']);
  });
  it('choix d’une même dimension additionnés (OU)', () => {
    expect(ids(fs({ difficulties: ['Facile', 'Difficile'] }))).toEqual(['c1', 'c2', 'c4', 'c5']);
    expect(ids(fs({ statuses: ['new', 'mastered'] }))).toEqual(['c1', 'c4', 'c5', 'c6']);
  });
  it('dimensions différentes cumulées (ET)', () => {
    expect(ids(fs({ difficulties: ['Facile'] }, 'mcq'))).toEqual(['c1', 'c4']);
    expect(ids(fs({ difficulties: ['Facile'], statuses: ['new'] }, 'mcq'))).toEqual(['c4']);
    expect(ids(fs({ types: ['Application'], difficulties: ['Difficile'] }))).toEqual(['c5']);
  });
  it('valeurs non renseignées filtrables', () => {
    expect(ids(fs({ difficulties: [UNSET] }))).toEqual(['c6']);
    expect(ids(fs({ types: [UNSET] }))).toEqual(['c4', 'c6']);
  });
  it('aucune carte : le filtre responsable est identifié', () => {
    const r = applyTestFilters(metas, fs({ difficulties: ['Moyen'] }, 'open'), states);
    expect(r.eligible).toEqual([]);
    expect(r.culprits.map((c) => [c.label, c.countWithout])).toEqual([
      ['format', 1],
      ['difficulté', 3],
    ]);
    expect(r.emptyReason).toContain('Sans le filtre « difficulté », 3 carte(s)');
  });
  it('aucune carte à cause de la combinaison seule : expliqué', () => {
    // Moyen (c3) + Connaissance (c2) + Maîtrisée (c1) : retirer n'importe quel filtre laisse encore 0 carte
    const r = applyTestFilters(metas, fs({ difficulties: ['Moyen'], types: ['Connaissance'], statuses: ['mastered'] }), states);
    expect(r.eligible).toEqual([]);
    expect(r.culprits).toEqual([]);
    expect(r.emptyReason).toContain('combinaison');
  });
  it('périmètre vide', () => {
    expect(applyTestFilters([], fs(), states).emptyReason).toContain('aucune carte');
  });
  it('options disponibles et effectifs dans le périmètre', () => {
    const o = filterOptions(metas, states);
    expect(o.difficulties).toEqual([
      { value: 'Facile', count: 2 },
      { value: 'Moyen', count: 1 },
      { value: 'Difficile', count: 2 },
      { value: UNSET, count: 1 },
    ]);
    expect(o.types.map((t) => t.value)).toEqual(['Application', 'Connaissance', 'Piège', UNSET]);
    expect(o.statuses).toEqual([
      { value: 'new', count: 3 },
      { value: 'learning', count: 1 },
      { value: 'review', count: 1 },
      { value: 'mastered', count: 1 },
    ]);
  });
  it('tirage : nombre borné, sans doublon, uniquement des cartes éligibles', () => {
    const scoped = resolveScope({ kind: 'multi', nodeIds: [node('Calcul'), node('Calcul', 'Fractions'), node('Anglais')] }, tax, metas);
    const elig = applyTestFilters([...scoped, ...scoped], fs({ difficulties: ['Facile', 'Difficile'] }), states).eligible;
    for (let i = 0; i < 20; i++) {
      const drawn = drawCards(elig, { count: 30, format: 'all', order: 'random' });
      expect(new Set(drawn).size).toBe(drawn.length);
      expect(drawn.sort()).toEqual(['c1', 'c2', 'c4', 'c5']);
    }
  });
});

// ---------- Séance ----------

const cfg = (over: Partial<TestConfig> = {}): TestConfig => ({ count: null, format: 'all', order: 'library', ...over });
const mcq = { formatQuestion: 'mcq' as const, correctOptionId: 'B' };

describe('correction en fin de test', () => {
  it('QCM et questions ouvertes enregistrés sans correction, puis phase de correction', () => {
    let s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', cfg({ correction: 'end' }), ['q', 'o1', 'o2'], NOW);
    expect(isEndCorrection(s)).toBe(true);
    s = advance(recordAnswer(s, 'q', { ...gradeMcq(mcq, 'A', NOW), timeMs: 4000 }), NOW);
    s = advance(recordAnswer(s, 'o1', deferAnswer(NOW, 9000)), NOW);
    s = advance(recordAnswer(s, 'o2', deferAnswer(NOW)), NOW);
    expect(s).toMatchObject({ status: 'in_progress', phase: 'correction', currentIndex: 2 });
    expect(summarize(s)).toMatchObject({ answered: 3, pendingSelfEval: 2, mcq: { answered: 1, correct: 0 }, errorIds: ['q'] });
    // Plus aucune réponse ni avancée pendant la correction
    expect(advance(s, NOW)).toBe(s);
    s = evaluateDeferred(s, 'o1', 'again', NOW);
    expect(s.answers['o1']).toEqual({ kind: 'open', selfEval: 'again', answeredAt: NOW, timeMs: 9000 });
    expect(evaluateDeferred(s, 'o1', 'easy', NOW)).toBe(s); // une seule fois
    s = finishCorrection(s, NOW);
    expect(s.status).toBe('finished');
    expect(summarize(s)).toMatchObject({ pendingSelfEval: 1, open: { answered: 1, byEval: { again: 1 } }, errorIds: ['q', 'o1'] });
  });

  it('« Terminer » pendant les questions ouvre la correction ; un second « Terminer » clôt', () => {
    let s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', cfg({ correction: 'end' }), ['a', 'b'], NOW);
    s = finishEarly(recordAnswer(s, 'a', deferAnswer(NOW)), NOW);
    expect(s).toMatchObject({ status: 'in_progress', phase: 'correction' });
    expect(finishEarly(s, NOW).status).toBe('finished');
  });

  it('correction immédiate et révision programmée : comportement inchangé, report refusé', () => {
    const imm = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', cfg(), ['a'], NOW);
    expect(advance(recordAnswer(imm, 'a', selfEvaluate('good', NOW)), NOW).status).toBe('finished');
    expect(() => recordAnswer(imm, 'a', deferAnswer(NOW))).toThrow();
    const rev = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', cfg({ correction: 'end' }), ['a'], NOW, 'revision');
    expect(isEndCorrection(rev)).toBe(false);
    expect(() => recordAnswer(rev, 'a', deferAnswer(NOW))).toThrow();
  });

  it('séance antérieure au lot 3A (sans les nouveaux champs) : inchangée', () => {
    const legacy = { ...createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: 1, format: 'all', order: 'random' }, ['a'], NOW) };
    expect(isEndCorrection(legacy)).toBe(false);
    expect(summarize(advance(recordAnswer(legacy, 'a', selfEvaluate('hard', NOW)), NOW))).toMatchObject({
      answered: 1,
      pendingSelfEval: 0,
      timing: { elapsedMs: 0, avgMs: null },
    });
  });
});

describe('chronomètre', () => {
  it('temps cumulé, restant et fin automatique', () => {
    let s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', cfg({ timer: { mode: 'limit', limitSec: 60 } }), ['a', 'b'], NOW);
    s = addElapsed(s, 20_000);
    expect(remainingMs(s)).toBe(40_000);
    expect(remainingMs(s, 5_000)).toBe(35_000);
    s = addElapsed(s, -5); // ignoré
    expect(s.elapsedMs).toBe(20_000);
    s = timeUp(s, NOW);
    expect(s).toMatchObject({ status: 'finished', timedOut: true });
    expect(addElapsed(s, 1000)).toBe(s); // plus de temps compté après la fin
  });
  it('limite atteinte en correction de fin de test → phase de correction', () => {
    const s = timeUp(createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', cfg({ correction: 'end', timer: { mode: 'limit', limitSec: 10 } }), ['a'], NOW), NOW);
    expect(s).toMatchObject({ status: 'in_progress', phase: 'correction', timedOut: true });
  });
  it('sans limite : aucun temps restant ; temps moyen et questions les plus longues au bilan', () => {
    let s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', cfg({ timer: { mode: 'elapsed' } }), ['a', 'b', 'c'], NOW);
    expect(remainingMs(s)).toBeNull();
    s = advance(recordAnswer(s, 'a', { ...selfEvaluate('good', NOW), timeMs: 3000 }), NOW);
    s = advance(recordAnswer(s, 'b', { ...selfEvaluate('easy', NOW), timeMs: 9000 }), NOW);
    expect(summarize(s).timing).toMatchObject({ timedAnswers: 2, avgMs: 6000, slowest: [{ cardId: 'b', timeMs: 9000 }, { cardId: 'a', timeMs: 3000 }] });
  });
});

describe('bilan approfondi', () => {
  it('résultats par matière et par difficulté, triés par taux d’erreur', () => {
    const byId = new Map(metas.map((m) => [m.cardId, m]));
    let s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', cfg(), ['c1', 'c2', 'c4', 'c5'], NOW);
    s = advance(recordAnswer(s, 'c1', gradeMcq(mcq, 'B', NOW)), NOW); // Calcul QCM juste
    s = advance(recordAnswer(s, 'c2', selfEvaluate('again', NOW)), NOW); // Calcul « À revoir »
    s = advance(recordAnswer(s, 'c4', gradeMcq(mcq, 'A', NOW)), NOW); // Anglais QCM faux
    s = advance(recordAnswer(s, 'c5', selfEvaluate('again', NOW)), NOW); // Anglais « À revoir »
    const byMatiere = breakdown(s, byId, (m) => [m.matiere, m.matiere]);
    expect(byMatiere.map((r) => [r.label, r.errorRate, r.mcqCorrect, r.mcqAnswered, r.openAgain])).toEqual([
      ['Anglais', 1, 0, 1, 1],
      ['Calcul', 0.5, 1, 1, 1],
    ]);
    const byDiff = breakdown(s, byId, (m) => (m.difficulte ? [m.difficulte, m.difficulte] : null));
    expect(byDiff.map((r) => [r.label, r.errorRate])).toEqual([
      ['Difficile', 1],
      ['Facile', 0.5],
    ]);
  });
});

describe('persistance et isolement de la répétition espacée', () => {
  it('test multi-matières filtré, correction en fin de test, chronomètre : enregistré, repris, sans effet sur les échéances', async () => {
    const name = `lot3a-${++k}`;
    let db = await openFlashcardsDb(name);
    const rows = [
      ['C1', 'Calcul', 'Fractions', 'Facile', 'Q ?\nA) un  B) deux', 'B'],
      ['C2', 'Calcul', 'Fractions', 'Difficile', 'Q2', 'R'],
      ['C3', 'Calcul', 'Pourcentages', 'Facile', 'Q3', 'R'],
      ['A1', 'Anglais', 'Grammaire', 'Facile', 'Qa', 'R'],
      ['A2', 'Anglais', 'Vocabulaire', 'Facile', 'Qb', 'R'],
    ];
    await repo.commitImport(db, { kind: 'new', name: 'L' }, 'l.csv', buildCards(rows, { externalId: 0, matiere: 1, theme: 2, difficulte: 3, question: 4, reponse: 5 }, {}).drafts);
    let allMetas = await repo.loadAllMeta(db);
    const t = buildTaxonomy(allMetas);
    // Une échéance existe déjà (révision programmée)
    const known = allMetas.find((m) => m.sourceRow === 4)!.cardId; // A1
    const r0 = createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', cfg(), [known], NOW, 'revision');
    await repo.startNewSession(db, r0, NOW);
    await new SessionController(r0, (x) => repo.saveRevisionTransition(db, x, D, NOW)).apply(advance(recordAnswer(r0, known, selfEvaluate('good', NOW)), NOW));
    const statesBefore = await repo.loadReviewStates(db);

    // Deux thèmes de matières différentes, difficulté « Facile »
    const scope = { kind: 'multi' as const, nodeIds: [node('Calcul', 'Fractions'), node('Anglais', 'Grammaire')] };
    const scoped = resolveScope(scope, t, allMetas);
    const elig = applyTestFilters(scoped, fs({ difficulties: ['Facile'] }), statesBefore).eligible;
    expect(elig.map((m) => m.sourceRow)).toEqual([1, 4]); // C1 et A1
    const config = cfg({ filters: { ...NO_FILTERS, difficulties: ['Facile'] }, correction: 'end', timer: { mode: 'elapsed' } });
    let s = createSession(scope, scopeLabelOf(scope, t), config, drawCards(elig, config), NOW);
    await repo.startNewSession(db, s, NOW, []);
    let ctl = new SessionController(s, (x) => repo.saveSessionTransition(db, x));
    const [first, second] = s.cardIds;
    const c1 = (await repo.getCard(db, first!))!;
    s = ((await ctl.apply(advance(addElapsed(recordAnswer(s, first!, { ...gradeMcq(c1, 'A', NOW), timeMs: 5000 }), 5000), NOW))) as { session: TestSession }).session;

    // Fermeture / réouverture au milieu du test
    db.close();
    db = await openFlashcardsDb(name);
    s = (await repo.getSession(db, s.sessionId))!;
    expect(s).toMatchObject({ currentIndex: 1, elapsedMs: 5000 });
    expect(s.phase).toBeUndefined();
    ctl = new SessionController(s, (x) => repo.saveSessionTransition(db, x));
    s = ((await ctl.apply(advance(addElapsed(recordAnswer(s, second!, deferAnswer(NOW, 7000)), 7000), NOW))) as { session: TestSession }).session;
    expect(s.phase).toBe('correction');
    s = ((await ctl.apply(evaluateDeferred(s, second!, 'hard', NOW))) as { session: TestSession }).session;
    s = ((await ctl.apply(finishCorrection(s, NOW))) as { session: TestSession }).session;

    const stored = (await repo.getSession(db, s.sessionId))!;
    expect(stored).toMatchObject({ status: 'finished', elapsedMs: 12_000 });
    expect(summarize(stored)).toMatchObject({ answered: 2, mcq: { answered: 1, correct: 0 }, pendingSelfEval: 0, timing: { avgMs: 6000 } });
    // Aucune échéance modifiée, aucune ligne d'historique de révision ajoutée par le test libre
    expect(await repo.loadReviewStates(db)).toEqual(statesBefore);
    expect((await db.getAll('reviewLog')).every((l) => l.sessionId === r0.sessionId)).toBe(true);
    allMetas = await repo.loadAllMeta(db);
    expect(allMetas).toHaveLength(5);
  });
});
