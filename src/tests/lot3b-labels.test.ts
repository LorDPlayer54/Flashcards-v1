// Lot 3B : fusion explicite des libellés.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildCards } from '../imports/buildCards';
import { analyseFile } from '../imports/importFlow';
import { parseCsvBytes } from '../imports/csvParse';
import { applyRating } from '../review/schedule';
import { openFlashcardsDb } from '../storage/db';
import * as repo from '../storage/repo';
import { addMergeRules, applyLabelRules, similarLabelGroups, similarLabels, type LabelRule } from '../taxonomy/labelMerge';
import { buildTaxonomy, childNodeId, nodeIdFor, pathKeyOf, ROOT_ID } from '../taxonomy/tree';
import { createSession } from './session';

const NOW = '2026-11-02T09:00:00.000Z';
const D = '2026-11-02';
let n = 0;
const calc = nodeIdFor([{ kind: 'matiere', label: 'Calcul' }]);
const rule = (level: LabelRule['level'], parentId: string, from: string, to: string): LabelRule => ({ level, parentId, from, to, at: NOW });

describe('règles de fusion (fonctions pures)', () => {
  it('application du plus général au plus précis, avec parents exprimés en libellés en vigueur', () => {
    const rules = addMergeRules(addMergeRules([], { level: 'theme', parentId: calc, from: ['Fraction'], to: 'Fractions', at: NOW }), {
      level: 'matiere',
      parentId: ROOT_ID,
      from: ['Calcul'],
      to: 'Mathématiques',
      at: NOW,
    });
    // La règle du thème a suivi la matière fusionnée
    expect(rules).toContainEqual(rule('theme', nodeIdFor([{ kind: 'matiere', label: 'Mathématiques' }]), 'Fraction', 'Fractions'));
    expect(applyLabelRules({ matiere: 'Calcul', theme: 'Fraction', notion: 'Addition' }, rules)).toEqual({
      matiere: 'Mathématiques',
      theme: 'Fractions',
      notion: 'Addition',
    });
    const untouched = { matiere: 'Raisonnement', theme: 'Fraction' };
    expect(applyLabelRules(untouched, rules)).toBe(untouched);
  });

  it('règles tenues « à plat » : chaînes compressées, cible redevenue référence, application idempotente', () => {
    let rules = addMergeRules([], { level: 'theme', parentId: calc, from: ['A', 'B'], to: 'B', at: NOW });
    expect(rules).toEqual([rule('theme', calc, 'A', 'B')]);
    rules = addMergeRules(rules, { level: 'theme', parentId: calc, from: ['B'], to: 'C', at: NOW });
    expect(rules).toEqual([rule('theme', calc, 'A', 'C'), rule('theme', calc, 'B', 'C')]);
    // « C » fusionné dans « A » : A redevient la référence (la règle A → C disparaît)
    rules = addMergeRules(rules, { level: 'theme', parentId: calc, from: ['C'], to: 'A', at: NOW });
    expect(rules).toEqual([rule('theme', calc, 'B', 'A'), rule('theme', calc, 'C', 'A')]);
    for (const t of ['A', 'B', 'C', 'D']) {
      const once = applyLabelRules({ matiere: 'Calcul', theme: t }, rules);
      expect(applyLabelRules(once, rules)).toEqual(once);
      expect(rules.some((r) => r.from === once.theme)).toBe(false);
    }
  });

  it('libellés semblables : simples suggestions entre niveaux frères de même type', () => {
    expect(similarLabels('Fraction', 'Fractions')).toBe(true);
    expect(similarLabels('Économie', 'economie ')).toBe(true);
    expect(similarLabels('A1', 'A2')).toBe(false);
    expect(similarLabels('Calcul', 'Raisonnement')).toBe(false);
    const metas = [
      { cardId: '1', collectionId: 'c', matiere: 'Calcul', theme: 'Fraction', formatQuestion: 'open' as const, sourceRow: 1 },
      { cardId: '2', collectionId: 'c', matiere: 'Calcul', theme: 'Fractions', formatQuestion: 'open' as const, sourceRow: 2 },
      { cardId: '3', collectionId: 'c', matiere: 'calcul', formatQuestion: 'open' as const, sourceRow: 3 },
      { cardId: '4', collectionId: 'c', matiere: 'Raisonnement', theme: 'Fraction', formatQuestion: 'open' as const, sourceRow: 4 },
    ];
    const groups = similarLabelGroups(buildTaxonomy(metas));
    expect(groups.map((g) => [g.parentId, g.level, g.labels.map((l) => l.label)])).toEqual([
      [ROOT_ID, 'matiere', ['Calcul', 'calcul']],
      [calc, 'theme', ['Fraction', 'Fractions']],
    ]);
  });
});

// ---------- Opération en base ----------

const M = { externalId: 0, matiere: 1, theme: 2, lecon: 3, notion: 4, question: 5, reponse: 6 };
const rows = [
  ['F1', 'Calcul', 'Fraction', '', 'Addition', 'Q1', 'R'],
  ['F2', 'Calcul', 'Fraction', '', 'Addition', 'Q2', 'R'],
  ['F3', 'Calcul', 'Fractions', '', 'Simplification', 'Q3', 'R'],
  ['F4', 'Calcul', 'Fractions', '', 'Addition', 'Q4', 'R'],
  ['P1', 'Calcul', 'Pourcentages', '', '', 'Q5', 'R'],
  ['R1', 'Raisonnement', 'Fraction', '', '', 'Q6', 'R'],
  ['L1', 'Calcul', 'Fractions', 'Leçon 1', 'Addition', 'Q7', 'R'],
];
const csv = ['ID;Matière;Thème;Leçon;Notion;Question;Réponse', ...rows.map((r) => r.join(';'))].join('\n');

async function library() {
  const db = await openFlashcardsDb(`lot3b-labels-${++n}`);
  const out = await repo.commitImport(db, { kind: 'new', name: 'L' }, 'l.csv', buildCards(rows, M, {}).drafts, NOW);
  const cards = await repo.getCardsOfCollection(db, out.collectionId);
  const id = (ext: string) => cards.find((c) => c.externalId === ext)!.cardId;
  return { db, collectionId: out.collectionId, id };
}

describe('fusion en base', () => {
  it('« Fraction » + « Fractions » → « Fractions » : classement mis à jour, identifiants, mémorisation, historique et séances intacts', async () => {
    const { db, id } = await library();
    await db.put('reviewStates', applyRating(undefined, id('F1'), 'good', D, NOW));
    await db.put('reviewLog', { logId: 'l1', cardId: id('F1'), sessionId: 's', at: NOW, day: D, rating: 'good', repeat: false, intervalDays: 3, dueDay: '2026-11-05' });
    const s = createSession({ kind: 'node', nodeId: childNodeId(calc, 'theme', 'Fraction') }, 'Calcul › Fraction', { count: null, format: 'all', order: 'library' }, [id('F1'), id('F2')], NOW);
    await repo.startNewSession(db, s, NOW);
    const before = { states: await db.getAll('reviewStates'), log: await db.getAll('reviewLog'), sessions: await db.getAll('sessions'), cards: await db.getAll('cards') };

    const res = await repo.mergeLabels(db, { parentId: calc, level: 'theme', from: ['Fraction', 'Fractions'], to: 'Fractions', expectedCounts: { Fraction: 2, Fractions: 3 }, now: NOW });
    expect(res).toMatchObject({ status: 'merged', updated: 2 });
    const after = await db.getAll('cards');
    expect(after.map((c) => c.cardId).sort()).toEqual(before.cards.map((c) => c.cardId).sort());
    const f1 = after.find((c) => c.cardId === id('F1'))!;
    expect(f1).toMatchObject({ theme: 'Fractions', notion: 'Addition', pathKey: pathKeyOf({ matiere: 'Calcul', theme: 'Fractions', notion: 'Addition' }), editedAt: NOW });
    expect(f1.createdAt).toBe(before.cards.find((c) => c.cardId === id('F1'))!.createdAt);
    // Autre matière, même libellé : inchangée
    expect(after.find((c) => c.cardId === id('R1'))!.theme).toBe('Fraction');
    // Les notions « Addition » des deux thèmes sont désormais réunies
    const tax = buildTaxonomy(await repo.loadAllMeta(db));
    expect(tax.byId.get(childNodeId(childNodeId(calc, 'theme', 'Fractions'), 'notion', 'Addition'))!.total).toBe(3);
    expect(tax.byId.has(childNodeId(calc, 'theme', 'Fraction'))).toBe(false);
    expect(await db.getAll('reviewStates')).toEqual(before.states);
    expect(await db.getAll('reviewLog')).toEqual(before.log);
    expect(await db.getAll('sessions')).toEqual(before.sessions);
    expect(await repo.getLabelRules(db)).toEqual([rule('theme', calc, 'Fraction', 'Fractions')]);
  });

  it('revalidation : les cartes ont changé depuis l’aperçu (autre onglet) → rien n’est écrit', async () => {
    const { db, collectionId } = await library();
    const before = await db.getAll('cards');
    // Autre onglet : une carte « Fraction » de plus
    await repo.commitImport(db, { kind: 'existing', collectionId }, 'l2.csv', buildCards([...rows, ['F9', 'Calcul', 'Fraction', '', '', 'Q9', 'R']], M, {}).drafts, NOW);
    const res = await repo.mergeLabels(db, { parentId: calc, level: 'theme', from: ['Fraction', 'Fractions'], to: 'Fractions', expectedCounts: { Fraction: 2, Fractions: 3 } });
    expect(res).toEqual({ status: 'changed', counts: { Fraction: 3, Fractions: 3 } });
    expect((await db.getAll('cards')).filter((c) => c.theme === 'Fraction')).toHaveLength(4);
    expect((await db.getAll('cards')).length).toBe(before.length + 1);
    expect(await repo.getLabelRules(db)).toEqual([]);
  });

  it('opération atomique : un échec au milieu des écritures annule tout', async () => {
    const { db } = await library();
    const before = await db.getAll('cards');
    const proto = IDBObjectStore.prototype;
    const put = proto.put;
    let count = 0;
    proto.put = function (this: IDBObjectStore, ...a: Parameters<typeof put>) {
      if (this.name === 'cards' && ++count === 2) throw new DOMException('simulation', 'QuotaExceededError');
      return put.apply(this, a);
    };
    try {
      await expect(
        repo.mergeLabels(db, { parentId: calc, level: 'theme', from: ['Fraction', 'Fractions'], to: 'Fractions', expectedCounts: { Fraction: 2, Fractions: 3 } }),
      ).rejects.toThrow();
    } finally {
      proto.put = put;
    }
    expect(await db.getAll('cards')).toEqual(before);
    expect(await repo.getLabelRules(db)).toEqual([]);
  });

  it('matières et notions : fusion au bon niveau, nouveau libellé, parent précis (notion sous leçon distincte)', async () => {
    const { db, id } = await library();
    const fractions = childNodeId(calc, 'theme', 'Fractions');
    // Notion « Addition » directement sous le thème → « Additions » ; celle sous « Leçon 1 » n'est pas concernée
    const r1 = await repo.mergeLabels(db, { parentId: fractions, level: 'notion', from: ['Addition'], to: 'Additions', expectedCounts: { Addition: 1 } });
    expect(r1).toMatchObject({ status: 'merged', updated: 1 });
    expect((await repo.getCard(db, id('F4')))!.notion).toBe('Additions');
    expect((await repo.getCard(db, id('L1')))!.notion).toBe('Addition');
    // Matières : « Calcul » et « Raisonnement » → nouveau libellé « Mathématiques »
    const r2 = await repo.mergeLabels(db, { parentId: ROOT_ID, level: 'matiere', from: ['Calcul', 'Raisonnement'], to: 'Mathématiques', expectedCounts: { Calcul: 6, Raisonnement: 1 } });
    expect(r2).toMatchObject({ status: 'merged', updated: 7 });
    expect(new Set((await db.getAll('cards')).map((c) => c.matiere))).toEqual(new Set(['Mathématiques']));
    await expect(repo.mergeLabels(db, { parentId: calc, level: 'matiere', from: ['x'], to: 'y', expectedCounts: {} })).rejects.toThrow(/incohérent/);
    await expect(repo.mergeLabels(db, { parentId: ROOT_ID, level: 'matiere', from: ['x'], to: '  ', expectedCounts: {} })).rejects.toThrow(/vide/);
  });

  it('réimportation du fichier d’origine après fusion : reclassé dès l’aperçu, aucune carte modifiée ni ajoutée', async () => {
    const { db, collectionId } = await library();
    await repo.mergeLabels(db, { parentId: calc, level: 'theme', from: ['Fraction'], to: 'Fractions', expectedCounts: { Fraction: 2 } });
    await repo.mergeLabels(db, { parentId: ROOT_ID, level: 'matiere', from: ['Calcul'], to: 'Mathématiques', expectedCounts: { Calcul: 6 } });
    const parsed = parseCsvBytes(new TextEncoder().encode(csv));
    const analysis = await analyseFile(
      parsed,
      { targetKind: 'existing', existingId: collectionId, newName: '', mapping: M, fixed: {}, ambiguousAsOpen: false },
      (cid) => repo.getCardsOfCollection(db, cid),
      await repo.getLabelRules(db),
    );
    expect(analysis.remapped).toBe(6);
    expect(analysis.plan).toMatchObject({ toAdd: [], toUpdate: [], unchanged: 7 });
    const re = await repo.commitImport(db, { kind: 'existing', collectionId }, 'l.csv', buildCards(parseCsvBytes(new TextEncoder().encode(csv)).rows, M, {}).drafts, NOW);
    expect(re).toMatchObject({ added: 0, updated: 0, unchanged: 7 });
    expect((await db.getAll('cards')).some((c) => c.matiere === 'Calcul' || (c.matiere === 'Mathématiques' && c.theme === 'Fraction'))).toBe(false);
    // Fusion oubliée : les imports suivants ne sont plus reclassés (les cartes déjà fusionnées ne changent pas)
    await repo.forgetLabelRule(db, { level: 'matiere', parentId: ROOT_ID, from: 'Calcul' });
    const re2 = await repo.commitImport(db, { kind: 'existing', collectionId }, 'l.csv', buildCards(parseCsvBytes(new TextEncoder().encode(csv)).rows, M, {}).drafts, NOW);
    expect(re2.updated).toBe(6);
  });
});
