// Tests de non-régression v1.1 : unicité (collection, ID source), imports concurrents, migration v1 → v2, I1.
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Card } from '../domain/types';
import { buildCards } from '../imports/buildCards';
import { ImportCommitError, runImport } from '../imports/importFlow';
import { MIGRATION_NOTE_KEY, openFlashcardsDb, type DB, type MigrationNote } from './db';
import * as repo from './repo';

let n = 0;
let db: DB;
beforeEach(async () => {
  db = await openFlashcardsDb(`integrity-${++n}`);
});

const M = { externalId: 0, question: 1, reponse: 2 } as const;
const drafts = (rows: string[][]) => buildCards(rows, M, { matiere: 'M' }).drafts;
const ROWS = Array.from({ length: 50 }, (_, i) => [`X${i}`, `Q${i}`, `R${i}`]);

describe('unicité (collectionId, externalId)', () => {
  it('la base refuse une seconde carte avec le même ID source dans la même collection', async () => {
    const out = await repo.commitImport(db, { kind: 'new', name: 'C' }, 'f.csv', drafts([['X1', 'Q', 'R']]));
    const [card] = await repo.getCardsOfCollection(db, out.collectionId);
    await expect(db.add('cards', { ...card!, cardId: 'autre' })).rejects.toMatchObject({ name: 'ConstraintError' });
    // …mais l'accepte sans ID source, ou dans une autre collection
    const { externalId: _id, ...noId } = card!;
    await db.add('cards', { ...noId, cardId: 'sans-id' });
    await db.add('cards', { ...card!, cardId: 'ailleurs', collectionId: 'autre-collection' });
    expect(await repo.countCards(db)).toBe(3);
  });

  it('deux imports simultanés du même fichier dans la même collection ne créent aucun doublon', async () => {
    const base = await repo.commitImport(db, { kind: 'new', name: 'C' }, 'v0.csv', drafts([['X0', 'Q0', 'R0']]));
    const target = { kind: 'existing' as const, collectionId: base.collectionId };
    const [a, b] = await Promise.all([
      repo.commitImport(db, target, 'v1.csv', drafts(ROWS)),
      repo.commitImport(db, target, 'v1.csv', drafts(ROWS)),
    ]);
    expect(await repo.countCards(db)).toBe(50);
    expect(a.added + b.added).toBe(49);
    expect(a.unchanged + b.unchanged).toBe(51);
    const ids = (await repo.getCardsOfCollection(db, base.collectionId)).map((c) => c.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('réimportation modifiée : mise à jour en place, sans doublon', async () => {
    const out = await repo.commitImport(db, { kind: 'new', name: 'C' }, 'v1.csv', drafts(ROWS));
    const modified = ROWS.map((r, i) => (i === 3 ? [r[0]!, r[1]!, 'R3 corrigée'] : r));
    const res = await repo.commitImport(db, { kind: 'existing', collectionId: out.collectionId }, 'v2.csv', drafts(modified));
    expect(res).toMatchObject({ added: 0, updated: 1, unchanged: 49 });
    expect(await repo.countCards(db)).toBe(50);
  });
});

describe('migration IndexedDB v1 → v3', () => {
  /** Recrée une base au schéma exact de la v1.0 (index non unique) */
  async function createV1(name: string, cards: Card[]) {
    const v1 = await openDB(name, 1, {
      upgrade(d) {
        const s = d.createObjectStore('cards', { keyPath: 'cardId' });
        s.createIndex('byCollection', 'collectionId');
        s.createIndex('byCollectionExternal', ['collectionId', 'externalId']);
        s.createIndex('byMatiere', 'matiere');
        s.createIndex('byPath', 'pathKey');
        d.createObjectStore('collections', { keyPath: 'collectionId' });
        d.createObjectStore('sessions', { keyPath: 'sessionId' }).createIndex('byStatus', 'status');
        d.createObjectStore('settings', { keyPath: 'key' });
      },
    });
    for (const c of cards) await v1.put('cards', c);
    await v1.put('collections', { collectionId: 'col', name: 'C', sourceFiles: ['f.csv'], createdAt: 't', updatedAt: 't', seq: 1 });
    await v1.put('sessions', {
      sessionId: 's1',
      mode: 'libre',
      scope: { kind: 'node', nodeId: 'root' },
      scopeLabel: 'Tout',
      config: { count: 2, format: 'all', order: 'random' },
      cardIds: ['c1', 'c2'],
      currentIndex: 1,
      answers: { c1: { kind: 'open', selfEval: 'good', answeredAt: 't' } },
      status: 'in_progress',
      createdAt: 't',
      updatedAt: 't',
    });
    v1.close();
  }
  const card = (cardId: string, externalId: string | undefined, createdAt: string): Card => ({
    cardId,
    collectionId: 'col',
    ...(externalId ? { externalId } : {}),
    matiere: 'M',
    formatQuestion: 'open',
    question: `Q ${cardId}`,
    rawQuestion: `Q ${cardId}`,
    reponse: 'R',
    sourceRow: 1,
    pathKey: 'm:M',
    sourceFile: 'f.csv',
    contentHash: cardId,
    createdAt,
    updatedAt: createdAt,
  });

  it('préserve toutes les cartes, les identifiants et les sessions ; neutralise les doublons préexistants', async () => {
    const name = `migr-${++n}`;
    await createV1(name, [card('c1', 'X1', '2026-01-01'), card('c2', 'X1', '2026-01-02'), card('c3', 'X2', '2026-01-01'), card('c4', undefined, '2026-01-01')]);
    const migrated = await openFlashcardsDb(name);
    expect(migrated.version).toBe(3); // v1 → v2 (index unique) → v3 (magasins de révision)
    expect([...migrated.objectStoreNames].sort()).toEqual(['cards', 'collections', 'reviewLog', 'reviewStates', 'sessions', 'settings']);
    const all = await migrated.getAll('cards');
    expect(all.map((c) => c.cardId).sort()).toEqual(['c1', 'c2', 'c3', 'c4']); // rien de supprimé
    const byId = Object.fromEntries(all.map((c) => [c.cardId, c]));
    expect(byId['c1']!.externalId).toBe('X1'); // la plus ancienne garde l'ID
    expect(byId['c2']!.externalId).toBeUndefined();
    expect(byId['c2']!.duplicateExternalId).toBe('X1');
    expect(byId['c2']!.question).toBe('Q c2'); // contenu intact
    expect(migrated.transaction('cards').store.index('byCollectionExternal').unique).toBe(true);
    const s = (await migrated.get('sessions', 's1'))!;
    expect(s).toMatchObject({ status: 'in_progress', currentIndex: 1 });
    expect(s.answers['c1']).toMatchObject({ selfEval: 'good' });
    const note = (await migrated.get('settings', MIGRATION_NOTE_KEY))!.value as MigrationNote[];
    expect(note[0]!.cardIds).toEqual(['c2']);
    // L'unicité est désormais garantie
    await expect(migrated.add('cards', { ...byId['c1']!, cardId: 'c5' })).rejects.toMatchObject({ name: 'ConstraintError' });
    migrated.close();
  });

  it('sans doublon, la migration ne laisse aucune note', async () => {
    const name = `migr-${++n}`;
    await createV1(name, [card('c1', 'X1', 't'), card('c2', 'X2', 't')]);
    const migrated = await openFlashcardsDb(name);
    expect(await migrated.count('cards')).toBe(2);
    expect(await migrated.get('settings', MIGRATION_NOTE_KEY)).toBeUndefined();
    migrated.close();
  });
});

describe('I1 — import confirmé puis échec du rafraîchissement', () => {
  it('annonce une importation réussie et propose seulement d’actualiser', async () => {
    const res = await runImport(
      () => repo.commitImport(db, { kind: 'new', name: 'C' }, 'f.csv', drafts(ROWS)),
      async () => {
        throw new Error('lecture impossible');
      },
    );
    expect(res.status).toBe('committed');
    expect(res.refreshError).toBe('lecture impossible');
    expect(res.outcome.added).toBe(50);
    expect(await repo.countCards(db)).toBe(50); // les cartes sont bien enregistrées
  });

  it('un échec de la transaction est signalé comme import annulé, sans rafraîchissement', async () => {
    let refreshed = false;
    await expect(
      runImport(
        () => repo.commitImport(db, { kind: 'existing', collectionId: 'inconnue' }, 'f.csv', drafts(ROWS)),
        async () => {
          refreshed = true;
        },
      ),
    ).rejects.toBeInstanceOf(ImportCommitError);
    expect(refreshed).toBe(false);
    expect(await repo.countCards(db)).toBe(0);
  });
});
