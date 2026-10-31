// Lot 4 : finitions du lot 3 — périmètres renommés ou fusionnés depuis le lancement d'une séance
// (anomalies mineures n° 3 et 4 de la recette intégrée).
import { describe, expect, it } from 'vitest';
import type { CardMeta, TestSession } from '../domain/types';
import { addMergeRules, currentScope, currentScopeLabel, mapNodeId } from '../taxonomy/labelMerge';
import { buildTaxonomy, childNodeId, nodeIdFor, ROOT_ID, segmentsOfNodeId } from '../taxonomy/tree';
import { createSession } from './session';

const NOW = '2026-11-02T09:00:00.000Z';
const calc = nodeIdFor([{ kind: 'matiere', label: 'Calcul' }]);
const fractions = childNodeId(calc, 'theme', 'Fractions');
const meta = (cardId: string, matiere: string, theme?: string, notion?: string): CardMeta => ({ cardId, collectionId: 'c', matiere, theme, notion, formatQuestion: 'open', sourceRow: 1 });

describe('niveaux renommés depuis une séance', () => {
  it('identifiant de niveau ↔ libellés', () => {
    const id = childNodeId(fractions, 'notion', 'Addition : règles');
    expect(segmentsOfNodeId(id)).toEqual([
      { kind: 'matiere', label: 'Calcul' },
      { kind: 'theme', label: 'Fractions' },
      { kind: 'notion', label: 'Addition : règles' },
    ]);
    expect(nodeIdFor(segmentsOfNodeId(id))).toBe(id);
    expect(segmentsOfNodeId(ROOT_ID)).toEqual([]);
  });

  it('thème renommé puis matière fusionnée : l’ancien périmètre retrouve le niveau actuel', () => {
    let rules = addMergeRules([], { level: 'theme', parentId: calc, from: ['Fractions'], to: 'Fractions et rapports', at: NOW });
    rules = addMergeRules(rules, { level: 'matiere', parentId: ROOT_ID, from: ['Calcul'], to: 'Mathématiques', at: NOW });
    const maths = nodeIdFor([{ kind: 'matiere', label: 'Mathématiques' }]);
    const now = childNodeId(childNodeId(maths, 'theme', 'Fractions et rapports'), 'notion', 'Addition');
    expect(mapNodeId(childNodeId(fractions, 'notion', 'Addition'), rules)).toBe(now);
    expect(mapNodeId(ROOT_ID, rules)).toBe(ROOT_ID);
    expect(mapNodeId(nodeIdFor([{ kind: 'matiere', label: 'Anglais' }]), rules)).toBe(nodeIdFor([{ kind: 'matiere', label: 'Anglais' }]));

    const tax = buildTaxonomy([meta('1', 'Mathématiques', 'Fractions et rapports', 'Addition'), meta('2', 'Anglais', 'Grammaire')]);
    const cfg = { count: null, format: 'all' as const, order: 'library' as const };
    const s: TestSession = createSession({ kind: 'node', nodeId: fractions }, 'Calcul › Fractions', cfg, ['1'], NOW);
    expect(currentScope(s.scope, tax, rules)).toEqual({ kind: 'node', nodeId: childNodeId(maths, 'theme', 'Fractions et rapports') });
    expect(currentScopeLabel(s, tax, rules)).toBe('Mathématiques › Fractions et rapports');
    // Révision : préfixe conservé
    expect(currentScopeLabel({ ...s, mode: 'revision', scopeLabel: 'Révision — Calcul › Fractions' }, tax, rules)).toBe('Révision — Mathématiques › Fractions et rapports');
    // Périmètre multiple et sélection de cartes
    const anglais = nodeIdFor([{ kind: 'matiere', label: 'Anglais' }]);
    expect(currentScope({ kind: 'multi', nodeIds: [fractions, anglais] }, tax, rules)).toEqual({ kind: 'multi', nodeIds: [childNodeId(maths, 'theme', 'Fractions et rapports'), anglais] });
    expect(currentScope({ kind: 'cards', cardIds: ['1'], label: 'Recherche' }, tax, rules)).toEqual({ kind: 'cards', cardIds: ['1'], label: 'Recherche' });
    // Niveau disparu sans fusion (cartes supprimées) : libellé enregistré au lancement
    const gone = createSession({ kind: 'node', nodeId: nodeIdFor([{ kind: 'matiere', label: 'Économie' }]) }, 'Économie', cfg, ['x'], NOW);
    expect(currentScopeLabel(gone, tax, rules)).toBe('Économie');
    // Sans règle : niveau existant inchangé
    expect(currentScopeLabel(createSession({ kind: 'node', nodeId: anglais }, 'Anglais', cfg, ['2'], NOW), tax, [])).toBe('Anglais');
  });
});
