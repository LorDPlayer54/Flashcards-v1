// Suppression ciblée multi-collections : intégrité, concurrence, annulation, rollback (annexe technique du 01/11).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildBackup } from '../backup/export';
import { buildCards } from '../imports/buildCards';
import { applyRating } from '../review/schedule';
import { openFlashcardsDb, type DB } from './db';
import { pathKeyOf } from '../taxonomy/tree';
import * as repo from './repo';

let n = 0;
const M = { externalId: 0, matiere: 1, theme: 2, question: 3, reponse: 4 } as const;
const NOW = '2026-11-02T09:00:00.000Z';

function rows(prefix: string, spec: [string, string, number][]): string[][] {
  const out: string[][] = [];
  let k = 0;
  for (const [matiere, theme, count] of spec) for (let i = 0; i < count; i++) out.push([`${prefix}${++k}`, matiere, theme, `Q ${prefix}${k} ?`, `R ${prefix}${k}`]);
  return out;
}

/** A : Droit/Constitution 10 ; B : mêmes noms, 7 cartes dont 4 en Constitution ; C : autres thèmes, 8 cartes */
async function setup() {
  const db = await openFlashcardsDb(`del-${++n}`);
  const imp = (name: string, r: string[][]) => repo.commitImport(db, { kind: 'new', name }, `${name}.csv`, buildCards(r, M, {}).drafts);
  const A = await imp('A', rows('a', [['Droit', 'Constitution', 10]]));
  const B = await imp('B', rows('b', [['Droit', 'Constitution', 4], ['Droit', 'Contentieux', 3]]));
  const C = await imp('C', rows('c', [['Économie', 'Marchés', 8]]));
  const ids = async (c: { collectionId: string }) => (await repo.getCardsOfCollection(db, c.collectionId)).map((x) => x.cardId);
  const idsA = await ids(A), idsB = await ids(B), idsC = await ids(C);
  // états de mémorisation pour toutes les cartes, historique et séance pour certaines
  for (const id of [...idsA, ...idsB, ...idsC]) await db.put('reviewStates', applyRating(undefined, id, 'good', '2026-11-02', NOW));
  await db.put('reviewLog', { logId: 'l1', cardId: idsA[0]!, sessionId: 's', at: NOW, day: '2026-11-02', rating: 'good', repeat: false, intervalDays: 3, dueDay: '2026-11-05' });
  return { db, A: A.collectionId, B: B.collectionId, C: C.collectionId, idsA, idsB, idsC };
}
const target = (collectionId: string, snapshot: string[], opts: { whole?: boolean; cardIds?: string[] } = {}) => ({ collectionId, snapshot, whole: opts.whole ?? false, cardIds: opts.cardIds ?? [] });
const countAll = async (db: DB) => ({ cards: await db.count('cards'), states: await db.count('reviewStates'), collections: await db.count('collections'), log: await db.count('reviewLog') });

describe('suppression ciblée', () => {
  it('collection entière + sous-partie d’une autre : seules les cartes désignées disparaissent, avec leurs états', async () => {
    const f = await setup();
    const bConstitution = (await repo.getCardsOfCollection(f.db, f.B)).filter((c) => c.theme === 'Constitution').map((c) => c.cardId);
    expect(bConstitution).toHaveLength(4);
    const r = await repo.deleteSelection(f.db, [target(f.A, f.idsA, { whole: true }), target(f.B, f.idsB, { cardIds: bConstitution })]);
    expect(r).toEqual({ status: 'deleted', cards: 14, collections: 2, wholeCollections: 1 });
    expect(await f.db.count('cards')).toBe(3 + 8);
    expect(await f.db.count('reviewStates')).toBe(3 + 8);
    expect(await f.db.get('collections', f.A)).toBeUndefined();
    expect(await f.db.get('collections', f.B)).toBeDefined(); // partielle : identité conservée
    expect(await f.db.get('collections', f.C)).toBeDefined();
    for (const id of [...f.idsA, ...bConstitution]) expect(await f.db.get('reviewStates', id)).toBeUndefined();
    const restB = f.idsB.filter((id) => !bConstitution.includes(id));
    for (const id of [...restB, ...f.idsC]) {
      expect(await f.db.get('cards', id)).toBeDefined();
      expect(await f.db.get('reviewStates', id)).toBeDefined();
    }
    expect(await f.db.count('reviewLog')).toBe(1); // historique conservé
  });

  it('sélection partielle couvrant toutes les cartes : cartes supprimées, identité de la collection conservée', async () => {
    const f = await setup();
    const r = await repo.deleteSelection(f.db, [target(f.C, f.idsC, { cardIds: f.idsC })]);
    expect(r).toMatchObject({ status: 'deleted', cards: 8, wholeCollections: 0 });
    expect(await f.db.get('collections', f.C)).toBeDefined();
    expect((await repo.getCardsOfCollection(f.db, f.C))).toHaveLength(0);
  });

  it('lot vide choisi en entier : registre supprimé ; doublons de sélection : chaque carte une seule fois', async () => {
    const f = await setup();
    await repo.deleteSelection(f.db, [target(f.C, f.idsC, { cardIds: f.idsC })]);
    expect(await repo.deleteSelection(f.db, [target(f.C, [], { whole: true })])).toMatchObject({ status: 'deleted', cards: 0, wholeCollections: 1 });
    expect(await f.db.get('collections', f.C)).toBeUndefined();
    const dup = [...f.idsA.slice(0, 3), ...f.idsA.slice(0, 3)];
    expect(await repo.deleteSelection(f.db, [target(f.A, f.idsA, { cardIds: dup })])).toMatchObject({ cards: 3 });
    await expect(repo.deleteSelection(f.db, [target(f.A, f.idsA), target(f.A, f.idsA)])).rejects.toThrow();
    await expect(repo.deleteSelection(f.db, [])).rejects.toThrow();
  });

  it('concurrence : carte ajoutée, supprimée ou collection disparue → refus global sans écriture', async () => {
    const f = await setup();
    const before = await countAll(f.db);
    // carte ajoutée dans A après l'aperçu
    await repo.commitImport(f.db, { kind: 'existing', collectionId: f.A }, 'a2.csv', buildCards(rows('z', [['Droit', 'Constitution', 1]]), M, {}).drafts);
    const r1 = await repo.deleteSelection(f.db, [target(f.A, f.idsA, { whole: true }), target(f.C, f.idsC, { cardIds: f.idsC.slice(0, 2) })]);
    expect(r1.status).toBe('changed');
    expect(await f.db.count('cards')).toBe(before.cards + 1);
    // carte supprimée de B après l'aperçu
    await repo.deleteCard(f.db, f.idsB[0]!);
    const r2 = await repo.deleteSelection(f.db, [target(f.C, f.idsC, { cardIds: f.idsC.slice(0, 2) }), target(f.B, f.idsB, { cardIds: f.idsB.slice(1, 3) })]);
    expect(r2.status).toBe('changed');
    expect(await repo.getCardsOfCollection(f.db, f.C)).toHaveLength(8);
    // collection supprimée
    await repo.deleteCollection(f.db, f.C);
    expect((await repo.deleteSelection(f.db, [target(f.C, f.idsC, { whole: true })])).status).toBe('changed');
  });

  it('carte sélectionnée absente de la collection (déplacée) → refus', async () => {
    const f = await setup();
    const r = await repo.deleteSelection(f.db, [target(f.A, f.idsA, { cardIds: [f.idsB[0]!] })]);
    expect(r.status).toBe('changed');
    expect(await f.db.get('cards', f.idsB[0]!)).toBeDefined();
  });

  it('carte reclassée dans un autre thème de la même collection entre sélection et confirmation → refus, rien supprimé', async () => {
    const f = await setup();
    const cards = await repo.getCardsOfCollection(f.db, f.B);
    const paths = Object.fromEntries(cards.map((c) => [c.cardId, pathKeyOf(c)]));
    // Sélection : tout le thème « Constitution » de B (4 cartes)
    const constitution = cards.filter((c) => c.theme === 'Constitution').map((c) => c.cardId);
    // Pendant ce temps, une carte de « Contentieux » est reclassée en « Constitution » (même collection, mêmes identifiants)
    const moved = cards.find((c) => c.theme === 'Contentieux')!;
    await f.db.put('cards', { ...moved, theme: 'Constitution' });
    const before = await countAll(f.db);
    const r = await repo.deleteSelection(f.db, [{ ...target(f.B, f.idsB, { cardIds: constitution }), paths }]);
    expect(r).toEqual({ status: 'changed', reason: 'le classement d’une carte a changé' });
    expect(await countAll(f.db)).toEqual(before);
    // Une carte sélectionnée reclassée hors du thème choisi : refus également
    await f.db.put('cards', { ...moved });
    const out = cards.find((c) => c.cardId === constitution[0])!;
    await f.db.put('cards', { ...out, theme: 'Contentieux' });
    const r2 = await repo.deleteSelection(f.db, [{ ...target(f.B, f.idsB, { cardIds: constitution }), paths }]);
    expect(r2.status).toBe('changed');
    expect(await countAll(f.db)).toEqual(before);
    // Classement revenu identique à l'aperçu : la suppression a lieu
    await f.db.put('cards', { ...out });
    const r3 = await repo.deleteSelection(f.db, [{ ...target(f.B, f.idsB, { cardIds: constitution }), paths }]);
    expect(r3).toMatchObject({ status: 'deleted', cards: 4 });
  });

  it('échec en cours de transaction : rollback complet', async () => {
    const f = await setup();
    const before = await countAll(f.db);
    await expect(
      repo.deleteSelection(f.db, [target(f.A, f.idsA, { whole: true }), target(f.C, f.idsC, { cardIds: f.idsC })], (k) => {
        if (k === 5) throw new Error('panne simulée');
      }),
    ).rejects.toThrow('panne simulée');
    expect(await countAll(f.db)).toEqual(before);
    expect(await f.db.get('collections', f.A)).toBeDefined();
  });

  it('sauvegarde après suppression : restauration de la sauvegarde et réimportation possibles', async () => {
    const f = await setup();
    const full = await buildBackup(f.db, NOW);
    await repo.deleteSelection(f.db, [target(f.A, f.idsA, { whole: true })]);
    const after = await buildBackup(f.db, NOW);
    expect(after.cards).toHaveLength(full.cards.length - 10);
    expect(after.reviewLog).toHaveLength(full.reviewLog.length);
    await repo.commitImport(f.db, { kind: 'new', name: 'A' }, 'A.csv', buildCards(rows('a', [['Droit', 'Constitution', 10]]), M, {}).drafts);
    expect(await f.db.count('cards')).toBe(full.cards.length);
  });
});
