// Tests d'intégration du stockage avec une IndexedDB simulée (fake-indexeddb).
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../backup/export';
import { buildCards } from '../imports/buildCards';
import { autoDetectMapping } from '../imports/columnMapping';
import { parseCsvBytes } from '../imports/csvParse';
import { searchCardIds } from '../library/search';
import { buildTaxonomy, nodeIdFor, ROOT_ID } from '../taxonomy/tree';
import { drawCards, resolveScope } from '../tests/selection';
import { createSession } from '../tests/session';
import { openFlashcardsDb, type DB } from './db';
import * as repo from './repo';

let dbCounter = 0;
let db: DB;
beforeEach(async () => {
  db = await openFlashcardsDb(`test-${++dbCounter}`);
});

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url)));

async function importFixture(name: string, target: repo.ImportTarget) {
  const p = parseCsvBytes(fixture(name));
  const { drafts } = buildCards(p.rows, autoDetectMapping(p.headers), {}, { rowNumbers: p.rowNumbers });
  return repo.commitImport(db, target, name, drafts);
}

describe('import et persistance', () => {
  it('importe plusieurs CSV successifs (> 2 500 cartes au total avec le CSV de référence) sans rien écraser', async () => {
    const a = await importFixture('anglais_fictif.csv', { kind: 'new', name: 'Anglais fictif' });
    const e = await importFixture('economie_fictif.csv', { kind: 'new', name: 'Économie fictive' });
    const m = await importFixture('mini_reference_fictif.csv', { kind: 'new', name: 'Mini' });
    expect(a.added + e.added + m.added).toBe(2106);
    expect(await repo.countCards(db)).toBe(2106);
    const metas = await repo.loadAllMeta(db, 500); // lots de 500 pour éprouver la pagination
    expect(metas).toHaveLength(2106);
    expect(new Set(metas.map((x) => x.matiere))).toEqual(new Set(['Anglais', 'Économie', 'Calcul', 'Raisonnement']));
    // Ordre de la bibliothèque : collection puis rang dans le fichier
    expect(metas[0]!.matiere).toBe('Anglais');
    expect(metas[0]!.sourceRow).toBe(1);
    expect(metas[2105]!.matiere).toBe('Raisonnement');
  });

  it('réimporter un fichier dans sa collection ne duplique rien et ne touche pas aux autres collections', async () => {
    const first = await importFixture('mini_reference_fictif.csv', { kind: 'new', name: 'Mini' });
    await importFixture('anglais_fictif.csv', { kind: 'new', name: 'Anglais' });
    const idsBefore = (await repo.getCardsOfCollection(db, first.collectionId)).map((c) => c.cardId).sort();

    const again = await importFixture('mini_reference_fictif.csv', { kind: 'existing', collectionId: first.collectionId });
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: 6 });
    expect(await repo.countCards(db)).toBe(1006);
    const idsAfter = (await repo.getCardsOfCollection(db, first.collectionId)).map((c) => c.cardId).sort();
    expect(idsAfter).toEqual(idsBefore);
  });

  it('importer le même fichier dans une NOUVELLE collection ajoute des cartes', async () => {
    await importFixture('mini_reference_fictif.csv', { kind: 'new', name: 'Mini 1' });
    await importFixture('mini_reference_fictif.csv', { kind: 'new', name: 'Mini 2' });
    expect(await repo.countCards(db)).toBe(12);
  });

  it('une mise à jour conserve le cardId et la date de création', async () => {
    const out = await repo.commitImport(
      db,
      { kind: 'new', name: 'C' },
      'v1.csv',
      buildCards([['X1', 'Q', 'R']], { externalId: 0, question: 1, reponse: 2 }, { matiere: 'M' }).drafts,
      't1',
    );
    const [before] = await repo.getCardsOfCollection(db, out.collectionId);
    const v2 = buildCards([['X1', 'Q', 'R2']], { externalId: 0, question: 1, reponse: 2 }, { matiere: 'M' }).drafts;
    const res = await repo.commitImport(db, { kind: 'existing', collectionId: out.collectionId }, 'v2.csv', v2, 't2');
    expect(res.plan.toUpdate[0]!.majorChange).toBe(true);
    const [after] = await repo.getCardsOfCollection(db, out.collectionId);
    expect(after!.cardId).toBe(before!.cardId);
    expect(after!.createdAt).toBe('t1');
    expect(after!.updatedAt).toBe('t2');
    expect(after!.reponse).toBe('R2');
    const col = (await repo.listCollections(db))[0]!;
    expect(col.sourceFiles).toEqual(['v1.csv', 'v2.csv']);
  });

  it('un import en échec ne laisse aucune trace (transaction annulée)', async () => {
    const out = await importFixture('mini_reference_fictif.csv', { kind: 'new', name: 'Mini' });
    const [existing] = await repo.getCardsOfCollection(db, out.collectionId);
    // Plan piégé : on tente d'AJOUTER une carte avec un cardId déjà présent → erreur de contrainte
    const drafts = buildCards([['N1', 'Q', 'R']], { externalId: 0, question: 1, reponse: 2 }, { matiere: 'M' }).drafts;
    const tx = db.transaction('cards', 'readwrite');
    const { externalId: _ignored, ...withoutExternal } = existing!; // sinon l'index unique refuserait la copie
    await tx.store.put({ ...withoutExternal, cardId: 'fixe' });
    await tx.done;
    const originalNewId = globalThis.crypto.randomUUID.bind(globalThis.crypto);
    let calls = 0;
    // Le 2e identifiant généré (celui de la carte) entre en collision avec « fixe »
    globalThis.crypto.randomUUID = (() => (++calls === 2 ? 'fixe' : originalNewId())) as typeof globalThis.crypto.randomUUID;
    try {
      await expect(repo.commitImport(db, { kind: 'new', name: 'Echec' }, 'x.csv', drafts)).rejects.toBeTruthy();
    } finally {
      globalThis.crypto.randomUUID = originalNewId;
    }
    expect((await repo.listCollections(db)).map((c) => c.name)).toEqual(['Mini']);
    expect(await repo.countCards(db)).toBe(7);
  });

  it('supprime une collection et ses cartes uniquement', async () => {
    const a = await importFixture('mini_reference_fictif.csv', { kind: 'new', name: 'Mini' });
    await importFixture('economie_fictif.csv', { kind: 'new', name: 'Eco' });
    expect(await repo.deleteCollection(db, a.collectionId)).toBe(6);
    expect(await repo.countCards(db)).toBe(1100);
    expect((await repo.listCollections(db)).map((c) => c.name)).toEqual(['Eco']);
  });
});

describe('tests depuis chaque niveau, sur données persistées', () => {
  it('chaque test ne contient que les cartes descendantes, sans doublon', async () => {
    await importFixture('mini_reference_fictif.csv', { kind: 'new', name: 'Mini' });
    await importFixture('anglais_fictif.csv', { kind: 'new', name: 'Anglais' });
    await importFixture('economie_fictif.csv', { kind: 'new', name: 'Eco' });
    const metas = await repo.loadAllMeta(db);
    const tax = buildTaxonomy(metas);

    const scopes = [
      ROOT_ID,
      nodeIdFor([{ kind: 'matiere', label: 'Calcul' }]),
      nodeIdFor([{ kind: 'matiere', label: 'Calcul' }, { kind: 'theme', label: 'Fractions' }]),
      nodeIdFor([{ kind: 'matiere', label: 'Calcul' }, { kind: 'theme', label: 'Fractions' }, { kind: 'notion', label: 'Addition' }]),
      nodeIdFor([{ kind: 'matiere', label: 'Anglais' }, { kind: 'theme', label: 'Grammaire' }, { kind: 'lecon', label: 'Temps verbaux' }]),
    ];
    for (const nodeId of scopes) {
      expect(tax.byId.has(nodeId)).toBe(true);
      const scoped = resolveScope({ kind: 'node', nodeId }, tax, metas);
      const ids = drawCards(scoped, { count: 20, format: 'all', order: 'random' });
      expect(new Set(ids).size).toBe(ids.length);
      const cards = await repo.getCards(db, ids);
      for (const c of cards) expect(tax.pathOf.get(c.cardId)!.concat(ROOT_ID)).toContain(nodeId);
    }
    // Arborescence AVEC leçons (Anglais) et SANS leçon (Calcul)
    const calcul = tax.byId.get(scopes[1]!)!;
    expect(calcul.children.every((t) => t.children.every((c) => c.kind === 'notion'))).toBe(true);
    const anglais = tax.byId.get(nodeIdFor([{ kind: 'matiere', label: 'Anglais' }]))!;
    expect(anglais.children.some((t) => t.children.some((c) => c.kind === 'lecon'))).toBe(true);
  });

  it('sauvegarde et reprend une session', async () => {
    const s = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: 2, format: 'all', order: 'random' }, ['a', 'b']);
    await repo.saveSession(db, s);
    expect((await repo.getInProgressSessions(db)).map((x) => x.sessionId)).toEqual([s.sessionId]);
    const s2 = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: 1, format: 'all', order: 'random' }, ['c']);
    expect(await repo.startNewSession(db, s2)).toBe(1);
    expect((await repo.getInProgressSessions(db)).map((x) => x.sessionId)).toEqual([s2.sessionId]);
    expect((await repo.getSession(db, s.sessionId))!.status).toBe('abandoned');
  });
});

describe('recherche et export', () => {
  it('recherche sans accents dans question/réponse/explication, avec filtres', async () => {
    await importFixture('mini_reference_fictif.csv', { kind: 'new', name: 'Mini' });
    expect(await searchCardIds(db, 'negation', { format: 'all' })).toHaveLength(1);
    expect(await searchCardIds(db, 'pgcd', { format: 'all' })).toHaveLength(1); // dans l'explication / astuce
    expect(await searchCardIds(db, '', { format: 'mcq' })).toHaveLength(3);
    expect(await searchCardIds(db, '', { format: 'all', matiere: 'Calcul' })).toHaveLength(3);
  });

  it('exporte un JSON versionné et complet', async () => {
    await importFixture('mini_reference_fictif.csv', { kind: 'new', name: 'Mini' });
    const b = await buildBackup(db, 'now');
    expect(b).toMatchObject({ format: 'flashcards-ena-backup', version: 3, exportedAt: 'now', counts: { cards: 6, collections: 1 } }); // lot 4 : format 3
    expect(JSON.parse(JSON.stringify(b)).cards).toHaveLength(6);
  });
});
