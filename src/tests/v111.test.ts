// Tests de non-régression v1.1.1 : sessions ouvertes dans deux onglets, analyses d'import concurrentes, en-tête CSV mal formé.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { autoDetectMapping } from '../imports/columnMapping';
import { parseCsvBytes, parseCsvText } from '../imports/csvParse';
import { analyseFile, analysisKey, draftsForConfirm, LatestOnly, type AnalysisParams, type AnalysisResult } from '../imports/importFlow';
import { describe, expect, it } from 'vitest';
import type { Card, TestSession } from '../domain/types';
import { openFlashcardsDb } from '../storage/db';
import * as repo from '../storage/repo';
import { buildTaxonomy, nearestExistingNode, nodeIdFor, ROOT_ID } from '../taxonomy/tree';
import { advance, createSession, finishEarly, recordAnswer, selfEvaluate } from './session';
import { SessionController } from './sessionController';

const T = 't';
const mk = (ids: string[]): TestSession =>
  createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: ids.length, format: 'all', order: 'library' }, ids, T);
let n = 0;

describe('Important 1 — concurrence entre onglets sur une session', () => {
  it('une session abandonnée par un autre onglet ne peut pas être réactivée par une copie périmée', async () => {
    const name = `tabs-${++n}`;
    const tabA = await openFlashcardsDb(name);
    const tabB = await openFlashcardsDb(name); // deux connexions = deux onglets
    const S = mk(['a', 'b']);
    await repo.startNewSession(tabA, S, T);

    // Onglet A : le test S est ouvert
    const loadedInA = (await repo.getSession(tabA, S.sessionId))!;
    const ctlA = new SessionController(loadedInA, (s) => repo.saveSessionTransition(tabA, s));
    // Onglet B : lance un autre test T, ce qui abandonne S
    const Tnew = mk(['c']);
    await repo.startNewSession(tabB, Tnew, T);
    // Onglet A répond avec sa copie périmée de S
    const res = await ctlA.apply(recordAnswer(loadedInA, 'a', selfEvaluate('good', T)));
    expect(res).toMatchObject({ status: 'failed', stale: true });
    expect(ctlA.current).toBe(loadedInA);

    const sNow = (await repo.getSession(tabA, S.sessionId))!;
    expect(sNow.status).toBe('abandoned'); // non réactivée
    expect(sNow.answers).toEqual({});
    expect((await repo.getInProgressSessions(tabA)).map((s) => s.sessionId)).toEqual([Tnew.sessionId]); // une seule session active
  });

  it('deux onglets sur le même test : la seconde écriture, fondée sur une version dépassée, est refusée', async () => {
    const name = `tabs-${++n}`;
    const tabA = await openFlashcardsDb(name);
    const tabB = await openFlashcardsDb(name);
    const S = mk(['a', 'b']);
    await repo.startNewSession(tabA, S, T);
    const inA = (await repo.getSession(tabA, S.sessionId))!;
    const inB = (await repo.getSession(tabB, S.sessionId))!;
    const ctlA = new SessionController(inA, (s) => repo.saveSessionTransition(tabA, s));
    const ctlB = new SessionController(inB, (s) => repo.saveSessionTransition(tabB, s));

    expect((await ctlA.apply(advance(recordAnswer(inA, 'a', selfEvaluate('easy', T)), T))).status).toBe('saved');
    const resB = await ctlB.apply(recordAnswer(inB, 'a', selfEvaluate('again', T)));
    expect(resB).toMatchObject({ status: 'failed', stale: true });
    const stored = (await repo.getSession(tabA, S.sessionId))!;
    expect(stored.answers['a']).toMatchObject({ selfEval: 'easy' }); // réponse de A conservée
    expect(stored.revision).toBe(1);
    expect(stored.currentIndex).toBe(1);
  });

  it('un test terminé ailleurs ne peut plus être modifié', async () => {
    const name = `tabs-${++n}`;
    const tabA = await openFlashcardsDb(name);
    const tabB = await openFlashcardsDb(name);
    const S = mk(['a']);
    await repo.startNewSession(tabA, S, T);
    const inA = (await repo.getSession(tabA, S.sessionId))!;
    const inB = (await repo.getSession(tabB, S.sessionId))!;
    const ctlB = new SessionController(inB, (s) => repo.saveSessionTransition(tabB, s));
    expect((await ctlB.apply(finishEarly(inB, T))).status).toBe('saved');
    const ctlA = new SessionController(inA, (s) => repo.saveSessionTransition(tabA, s));
    expect(await ctlA.apply(recordAnswer(inA, 'a', selfEvaluate('good', T)))).toMatchObject({ status: 'failed', stale: true });
    expect((await repo.getSession(tabA, S.sessionId))!.status).toBe('finished');
  });

  it('les sessions antérieures à la v1.1.1 (sans révision) restent reprenables', async () => {
    const db = await openFlashcardsDb(`tabs-${++n}`);
    const legacy = mk(['a', 'b']);
    delete (legacy as { revision?: number }).revision;
    await repo.saveSession(db, legacy);
    const ctl = new SessionController(legacy, (s) => repo.saveSessionTransition(db, s));
    const r = await ctl.apply(recordAnswer(legacy, 'a', selfEvaluate('hard', T)));
    expect(r.status).toBe('saved');
    expect((await repo.getSession(db, legacy.sessionId))!.revision).toBe(1);
  });

  it('une erreur technique ordinaire n’est pas confondue avec une copie périmée', async () => {
    const S = mk(['a']);
    const ctl = new SessionController(S, async () => {
      throw new Error('disque plein');
    });
    expect(await ctl.apply(recordAnswer(S, 'a', selfEvaluate('good', T)))).toMatchObject({ status: 'failed', stale: false });
  });
});

// ---------- Important 2 : analyses d'import qui se chevauchent ----------

describe('Important 2 — un aperçu périmé ne peut pas être importé', () => {
  it('analyses à résolutions inversées : seule la dernière demande compte, et c’est elle qui est importée', async () => {
    const db = await openFlashcardsDb(`analyse-${++n}`);
    const parsed = parseCsvBytes(new Uint8Array(readFileSync(new URL('../../fixtures/mini_reference_fictif.csv', import.meta.url))));
    const base = await repo.commitImport(db, { kind: 'new', name: 'Mini' }, 'mini.csv', []);
    const params = (ambiguousAsOpen: boolean): AnalysisParams => ({
      mapping: autoDetectMapping(parsed.headers),
      fixed: {},
      targetKind: 'existing',
      newName: '',
      existingId: base.collectionId,
      ambiguousAsOpen,
    });

    // Chargements contrôlés : la 1re analyse (option décochée) finira APRÈS la 2e (option cochée)
    const releases: (() => void)[] = [];
    const slowLoad = (id: string) =>
      new Promise<Card[]>((resolve) => releases.push(() => void repo.getCardsOfCollection(db, id).then(resolve)));

    const gate = new LatestOnly();
    let shown: AnalysisResult | null = null;
    const analyse = async (p: AnalysisParams) => {
      const token = gate.begin();
      shown = null;
      const res = await analyseFile(parsed, p, slowLoad);
      if (gate.isCurrent(token)) shown = res;
    };
    const first = analyse(params(false));
    const second = analyse(params(true)); // l'utilisatrice coche l'option avant la fin de la 1re analyse
    releases[1]!(); // la 2e se termine d'abord
    await second;
    releases[0]!(); // puis l'ancienne
    await first;

    const current = analysisKey(params(true));
    expect(shown!.params.ambiguousAsOpen).toBe(true); // l'ancienne n'a pas écrasé la nouvelle
    expect(draftsForConfirm(shown, current, false)).not.toBeNull();
    expect(draftsForConfirm(shown, analysisKey(params(false)), false)).toBeNull(); // paramètres affichés différents
    expect(draftsForConfirm(shown, current, true)).toBeNull(); // analyse en cours

    const valid = draftsForConfirm(shown, current, false)!;
    await repo.commitImport(db, { kind: 'existing', collectionId: base.collectionId }, 'mini.csv', valid.build.drafts);
    const imported = await repo.getCardsOfCollection(db, base.collectionId);
    expect(imported).toHaveLength(7); // FIC-006 incluse, conformément à l'option finale
    expect(imported.find((c) => c.externalId === 'FIC-006')!.formatQuestion).toBe('open');
  });

  it('la clé d’analyse change avec chaque paramètre visible', () => {
    const p: AnalysisParams = { mapping: { question: 0, reponse: 1 }, fixed: { matiere: 'M' }, targetKind: 'new', newName: 'A', existingId: '', ambiguousAsOpen: false };
    const k = analysisKey(p);
    expect(analysisKey({ ...p, mapping: { reponse: 1, question: 0 } })).toBe(k); // ordre indifférent
    for (const variant of [
      { ...p, ambiguousAsOpen: true },
      { ...p, mapping: { question: 1, reponse: 0 } },
      { ...p, fixed: { matiere: 'N' } },
      { ...p, newName: 'B' },
      { ...p, targetKind: 'existing' as const, existingId: 'x' },
    ]) {
      expect(analysisKey(variant)).not.toBe(k);
    }
  });
});

describe('Important 3 — en-tête CSV mal formé : fichier refusé', () => {
  it.each([
    ['guillemets mal placés', '"Question"x",Réponse\nQ1,R1\n'],
    ['guillemet non fermé', '"Question,Réponse\nQ1,R1\n'],
  ])('%s', (_label, text) => {
    const p = parseCsvText(text);
    expect(p.fatal).toBeTruthy();
    expect(p.rows).toEqual([]);
    expect(p.rowNumbers).toEqual([]);
  });

  it('un en-tête correct n’est pas bloquant', () => {
    const p = parseCsvText('"Question","Réponse"\nQ1,R1\n');
    expect(p.fatal).toBeUndefined();
    expect(p.rows).toEqual([['Q1', 'R1']]);
  });
});

// ---------- Mineur : retour après suppression de la dernière carte d'un niveau ----------

describe('Mineur — niveau existant le plus proche', () => {
  const metas = [
    { cardId: 'a', collectionId: 'c', matiere: 'Calcul', theme: 'Fractions', notion: 'Addition', formatQuestion: 'open' as const, sourceRow: 1 },
    { cardId: 'b', collectionId: 'c', matiere: 'Calcul', theme: 'Pourcentages', formatQuestion: 'open' as const, sourceRow: 2 },
  ];
  const tax = buildTaxonomy(metas);
  const m = { kind: 'matiere' as const, label: 'Calcul' };
  it('remonte à l’ancêtre encore présent', () => {
    // La notion « Simplification » n'existe plus (sa seule carte a été supprimée) ; le thème existe encore
    const gone = nodeIdFor([m, { kind: 'theme', label: 'Fractions' }, { kind: 'notion', label: 'Simplification' }]);
    expect(nearestExistingNode(tax, gone)).toBe(nodeIdFor([m, { kind: 'theme', label: 'Fractions' }]));
  });
  it('remonte jusqu’à la matière, puis à la bibliothèque', () => {
    expect(nearestExistingNode(tax, nodeIdFor([m, { kind: 'theme', label: 'Géométrie' }]))).toBe(nodeIdFor([m]));
    expect(nearestExistingNode(tax, nodeIdFor([{ kind: 'matiere', label: 'Anglais' }]))).toBe(ROOT_ID);
    expect(nearestExistingNode(tax, 'n’importe quoi')).toBe(ROOT_ID);
  });
  it('renvoie le nœud lui-même s’il existe', () => {
    const id = nodeIdFor([m, { kind: 'theme', label: 'Pourcentages' }]);
    expect(nearestExistingNode(tax, id)).toBe(id);
  });
});
