import { describe, expect, it } from 'vitest';
import type { CardMeta, TestConfig } from '../domain/types';
import { buildTaxonomy, cardsDirectlyAt, nodeIdFor, ROOT_ID } from '../taxonomy/tree';
import { applyFilters, drawCards, effectiveCount, resolveScope } from './selection';
import { advance, createSession, finishEarly, gradeMcq, recordAnswer, selfEvaluate, summarize } from './session';

let k = 0;
const meta = (matiere: string, theme?: string, lecon?: string, notion?: string, format: 'open' | 'mcq' = 'open'): CardMeta => ({
  cardId: `c${++k}`,
  collectionId: 'col',
  matiere,
  theme,
  lecon,
  notion,
  formatQuestion: format,
  sourceRow: k,
});

const metas: CardMeta[] = [
  meta('Calcul', 'Fractions', undefined, 'Addition', 'mcq'),
  meta('Calcul', 'Fractions', undefined, 'Addition'),
  meta('Calcul', 'Fractions', undefined, 'Simplification'),
  meta('Calcul', 'Pourcentages', undefined, 'Hausse', 'mcq'),
  meta('Anglais', 'Grammaire', 'Temps verbaux', 'Present perfect', 'mcq'),
  meta('Anglais', 'Grammaire', 'Temps verbaux', 'Past simple'),
  meta('Anglais', 'Grammaire', undefined, 'Articles'), // notion directement sous le thème
  meta('Anglais', 'Grammaire'), // carte rattachée au thème
  meta('Anglais'), // carte rattachée à la matière
];
const tax = buildTaxonomy(metas);
const id = (...labels: [string, ...string[]]) => {
  const kinds = ['matiere', 'theme', 'lecon', 'notion'] as const;
  return nodeIdFor(labels.map((label, i) => ({ kind: kinds[i]!, label })));
};
/** Notion rattachée directement à un thème (sans leçon) */
const notionId = (matiere: string, theme: string, notion: string) =>
  nodeIdFor([
    { kind: 'matiere', label: matiere },
    { kind: 'theme', label: theme },
    { kind: 'notion', label: notion },
  ]);

describe('hiérarchie souple', () => {
  it('compte les cartes à chaque niveau', () => {
    expect(tax.root.total).toBe(9);
    expect(tax.byId.get(id('Calcul'))!.total).toBe(4);
    expect(tax.byId.get(id('Anglais'))!.total).toBe(5);
    expect(tax.byId.get(id('Anglais'))!.direct).toBe(1);
    expect(tax.byId.get(id('Anglais', 'Grammaire'))!.direct).toBe(1);
  });

  it("n'invente aucun niveau : pas de leçon pour Calcul, notion « Articles » directement sous le thème", () => {
    const fractions = tax.byId.get(id('Calcul', 'Fractions'))!;
    expect(fractions.children.map((c) => c.kind)).toEqual(['notion', 'notion']);
    const gram = tax.byId.get(id('Anglais', 'Grammaire'))!;
    expect(gram.children.map((c) => `${c.kind}:${c.label}`)).toEqual(['lecon:Temps verbaux', 'notion:Articles']);
  });

  it('liste les cartes rattachées directement à un niveau', () => {
    expect(cardsDirectlyAt(tax, metas, id('Anglais')).map((m) => m.cardId)).toEqual([metas[8]!.cardId]);
  });
});

describe('périmètre d’un test', () => {
  it('bibliothèque entière', () => expect(resolveScope({ kind: 'node', nodeId: ROOT_ID }, tax, metas)).toHaveLength(9));
  it('matière', () =>
    expect(resolveScope({ kind: 'node', nodeId: id('Calcul') }, tax, metas).every((m) => m.matiere === 'Calcul')).toBe(true));
  it('thème (y compris sous-niveaux et cartes directes)', () =>
    expect(resolveScope({ kind: 'node', nodeId: id('Anglais', 'Grammaire') }, tax, metas)).toHaveLength(4));
  it('leçon', () =>
    expect(resolveScope({ kind: 'node', nodeId: id('Anglais', 'Grammaire', 'Temps verbaux') }, tax, metas)).toHaveLength(2));
  it('notion', () => {
    const r = resolveScope({ kind: 'node', nodeId: notionId('Calcul', 'Fractions', 'Addition') }, tax, metas);
    expect(r.map((m) => m.notion)).toEqual(['Addition', 'Addition']);
  });
  it('nœud inconnu → vide', () => expect(resolveScope({ kind: 'node', nodeId: 'x' }, tax, metas)).toEqual([]));
  it('sélection de cartes dédupliquée', () => {
    const r = resolveScope({ kind: 'cards', cardIds: ['c1', 'c1', 'c2'], label: 'x' }, tax, metas);
    expect(r).toHaveLength(2);
  });
});

describe('filtres et tirage', () => {
  const cfg = (over: Partial<TestConfig> = {}): TestConfig => ({ count: 10, format: 'all', order: 'random', ...over });

  it('filtre par format et explique un résultat vide', () => {
    const scoped = resolveScope({ kind: 'node', nodeId: notionId('Calcul', 'Fractions', 'Simplification') }, tax, metas);
    const r = applyFilters(scoped, { format: 'mcq' });
    expect(r.eligible).toHaveLength(0);
    expect(r.emptyReason).toContain('aucun QCM');
    expect(applyFilters([], { format: 'all' }).emptyReason).toContain('aucune carte');
  });

  it('borne le nombre demandé au stock', () => {
    expect(effectiveCount(30, 4)).toBe(4);
    expect(effectiveCount(null, 4)).toBe(4);
    expect(effectiveCount(2, 4)).toBe(2);
    expect(effectiveCount(0, 4)).toBe(1);
  });

  it('tire sans doublon, uniquement dans le périmètre', () => {
    const scoped = resolveScope({ kind: 'node', nodeId: id('Anglais') }, tax, metas);
    for (let i = 0; i < 20; i++) {
      const ids = drawCards([...scoped, ...scoped], cfg({ count: null }));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(5);
      expect(ids.every((x) => scoped.some((m) => m.cardId === x))).toBe(true);
    }
  });

  it("respecte l'ordre de la bibliothèque si demandé", () => {
    expect(drawCards(metas, cfg({ order: 'library', count: 3 }))).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('déroulement et bilan', () => {
  const now = '2026-10-30T10:00:00.000Z';
  it('enregistre QCM et autoévaluations puis résume', () => {
    let s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: 3, format: 'all', order: 'library' }, ['a', 'b', 'c'], now);
    s = recordAnswer(s, 'a', gradeMcq({ formatQuestion: 'mcq', correctOptionId: 'B' }, 'B', now));
    s = advance(s, now);
    s = recordAnswer(s, 'b', gradeMcq({ formatQuestion: 'mcq', correctOptionId: 'B' }, 'C', now));
    s = advance(s, now);
    s = recordAnswer(s, 'c', selfEvaluate('again', now));
    s = advance(s, now);
    expect(s.status).toBe('finished');
    const sum = summarize(s);
    expect(sum.mcq).toEqual({ answered: 2, correct: 1 });
    expect(sum.open.byEval.again).toBe(1);
    expect(sum.errorIds).toEqual(['b', 'c']);
  });

  it('refuse une réponse hors carte courante et ignore une seconde réponse', () => {
    let s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: 2, format: 'all', order: 'library' }, ['a', 'b'], now);
    expect(() => recordAnswer(s, 'b', selfEvaluate('good', now))).toThrow();
    s = recordAnswer(s, 'a', selfEvaluate('good', now));
    const again = recordAnswer(s, 'a', selfEvaluate('again', now));
    expect(again.answers['a']).toEqual(s.answers['a']);
  });

  it('refuse une sélection vide ou avec doublons', () => {
    expect(() => createSession({ kind: 'node', nodeId: ROOT_ID }, '', { count: 1, format: 'all', order: 'random' }, [])).toThrow();
    expect(() => createSession({ kind: 'node', nodeId: ROOT_ID }, '', { count: 2, format: 'all', order: 'random' }, ['a', 'a'])).toThrow();
  });

  it('terminer avant la fin compte les cartes non traitées', () => {
    let s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: 3, format: 'all', order: 'library' }, ['a', 'b', 'c'], now);
    s = recordAnswer(s, 'a', selfEvaluate('easy', now));
    s = finishEarly(s, now);
    expect(summarize(s)).toMatchObject({ answered: 1, notAnswered: 2 });
  });
});
