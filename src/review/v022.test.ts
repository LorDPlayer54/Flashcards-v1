// Tests de non-régression v0.2.2 : I1 (périmètre relu en base au lancement) et I2 (remplacement d'une séance
// uniquement sur confirmation valide, y compris entre onglets).
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CardMeta, TestSession } from '../domain/types';
import { buildCards } from '../imports/buildCards';
import { autoDetectMapping } from '../imports/columnMapping';
import { parseCsvBytes } from '../imports/csvParse';
import { openFlashcardsDb, type DB } from '../storage/db';
import * as repo from '../storage/repo';
import { buildTaxonomy, nodeIdFor, pathInScope, pathKeyOf, ROOT_ID } from '../taxonomy/tree';
import { resolveScope } from '../tests/selection';
import { createSession, recordAnswer, selfEvaluate } from '../tests/session';
import { newRemainingToday, planReview } from './queue';
import { startReviewAllStudied } from '../tests/studyAll';

const D = '2026-10-30';
const NOW = '2026-10-30T09:00:00.000Z';
let n = 0;
const M = { externalId: 0, matiere: 1, theme: 2, question: 3, reponse: 4 } as const;

/** Aperçu tel que l'écran le calcule, à partir des métadonnées chargées en mémoire */
async function preview(db: DB, nodeId: string) {
  const metas = await repo.loadAllMeta(db);
  const tax = buildTaxonomy(metas);
  const states = await repo.loadReviewStates(db);
  const remaining = newRemainingToday(await repo.countIntroducedOn(db, D), await repo.getNewPerDay(db));
  return planReview(resolveScope({ kind: 'node', nodeId }, tax, metas), states, D, remaining);
}
const launch = (db: DB, nodeId: string, expectedQueue: readonly string[], confirmedReplace: readonly string[] = []) =>
  startReviewAllStudied(db, { nodeId, scopeLabel: 'x', expectedQueue, confirmedReplace, today: D, now: NOW });
const libre = (ids: string[]) => createSession({ kind: 'node', nodeId: ROOT_ID }, 'Test', { count: ids.length, format: 'all', order: 'library' }, ids, NOW);
const macro = nodeIdFor([
  { kind: 'matiere', label: 'Économie' },
  { kind: 'theme', label: 'Macro' },
]);

async function library(name = `v022-${++n}`) {
  const db = await openFlashcardsDb(name);
  const rows = [
    ['E1', 'Économie', 'Macro', 'Q1', 'R'],
    ['E2', 'Économie', 'Macro', 'Q2', 'R'],
    ['E3', 'Économie', 'Macro', 'Q3', 'R'],
    ['E4', 'Économie', 'Micro', 'Q4', 'R'],
    ['C1', 'Calcul', 'Fractions', 'Qc', 'R'],
  ];
  const out = await repo.commitImport(db, { kind: 'new', name: 'Lib' }, 'lib.csv', buildCards(rows, M, {}).drafts);
  return { db, name, rows, collectionId: out.collectionId };
}
const ids = async (db: DB, collectionId: string) =>
  Object.fromEntries((await repo.getCardsOfCollection(db, collectionId)).map((c) => [c.externalId!, c.cardId]));

describe('I1 — le périmètre est reconstruit depuis la base au lancement', () => {
  it('carte reclassée hors du thème et carte ajoutée au thème : lancement refusé sans écriture, puis aperçu correct', async () => {
    const { db, name, rows, collectionId } = await library();
    const id = await ids(db, collectionId);
    const P = libre([id['C1']!]); // une séance est en cours et sa substitution a été confirmée
    await repo.startNewSession(db, P, NOW);
    const shown = await preview(db, macro);
    expect(shown.queue).toEqual([id['E1'], id['E2'], id['E3']]);

    // Autre onglet : réimportation qui déplace E2 vers Calcul (même cardId) et ajoute E5 au thème Macro
    const tabB = await openFlashcardsDb(name);
    const v2 = rows.map((r) => (r[0] === 'E2' ? ['E2', 'Calcul', 'Fractions', 'Q2', 'R'] : r)).concat([['E5', 'Économie', 'Macro', 'Q5', 'R']]);
    const re = await repo.commitImport(tabB, { kind: 'existing', collectionId }, 'lib-v2.csv', buildCards(v2, M, {}).drafts);
    expect(re).toMatchObject({ added: 1, updated: 1 });
    expect((await repo.getCard(db, id['E2']!))!.pathKey).toBe(pathKeyOf({ matiere: 'Calcul', theme: 'Fractions' }));

    const before = await db.getAll('sessions');
    const res = await launch(db, macro, shown.queue, [P.sessionId]);
    expect(res.status).toBe('changed');
    if (res.status !== 'changed') return;
    const e5 = (await ids(db, collectionId))['E5']!;
    expect(res.plan.queue).toEqual([id['E1'], id['E3'], e5]);
    expect(await db.getAll('sessions')).toEqual(before); // P ni abandonnée ni remplacée, aucune séance créée

    // Second aperçu, calculé sur les métadonnées rechargées : accepté
    const fresh = await preview(db, macro);
    expect(fresh.queue).toEqual(res.plan.queue);
    const ok = await launch(db, macro, fresh.queue, [P.sessionId]);
    expect(ok.status).toBe('started');
    if (ok.status === 'started') expect(ok.session.cardIds).not.toContain(id['E2']);
    expect((await repo.getSession(db, P.sessionId))!.status).toBe('abandoned');
  });

  it('« Calcul » n’englobe pas « Calcul avancé » ; une notion et une leçon homonymes restent distinctes', async () => {
    const db = await openFlashcardsDb(`v022-${++n}`);
    const rows = [
      ['A', 'Calcul', 'T', '', 'N', 'Q', 'R'],
      ['B', 'Calcul avancé', 'T', '', '', 'Q', 'R'],
      ['C', 'Calcul', 'T', 'X', '', 'Q', 'R'], // leçon « X »
      ['D', 'Calcul', 'T', '', 'X', 'Q', 'R'], // notion « X » directement sous le thème
    ];
    await repo.commitImport(db, { kind: 'new', name: 'L' }, 'l.csv', buildCards(rows, { externalId: 0, matiere: 1, theme: 2, lecon: 3, notion: 4, question: 5, reponse: 6 }, {}).drafts);
    const metas = await repo.loadAllMeta(db);
    const ext = new Map(metas.map((m) => [m.cardId, m.sourceRow]));
    const rowsOf = async (nodeId: string) => {
      const res = await launch(db, nodeId, ['force-un-écart']);
      return res.status === 'changed' ? res.plan.queue.map((i) => ext.get(i)) : [];
    };
    expect(await rowsOf(nodeIdFor([{ kind: 'matiere', label: 'Calcul' }]))).toEqual([1, 3, 4]);
    const T = [{ kind: 'matiere' as const, label: 'Calcul' }, { kind: 'theme' as const, label: 'T' }];
    expect(await rowsOf(nodeIdFor([...T, { kind: 'lecon', label: 'X' }]))).toEqual([3]);
    expect(await rowsOf(nodeIdFor([...T, { kind: 'notion', label: 'X' }]))).toEqual([4]);
    expect(pathInScope('m:Calcul avancé', 'm:Calcul')).toBe(false);
  });

  it('équivalence avec l’arbre affiché, pour chaque niveau d’une bibliothèque avec et sans leçons', async () => {
    const db = await openFlashcardsDb(`v022-${++n}`);
    await repo.setNewPerDay(db, 999);
    for (const f of ['anglais_fictif.csv', 'mini_reference_fictif.csv']) {
      const p = parseCsvBytes(new Uint8Array(readFileSync(new URL(`../../fixtures/${f}`, import.meta.url))));
      await repo.commitImport(db, { kind: 'new', name: f }, f, buildCards(p.rows, autoDetectMapping(p.headers), {}, { rowNumbers: p.rowNumbers }).drafts);
    }
    const metas = await repo.loadAllMeta(db);
    const tax = buildTaxonomy(metas);
    expect(tax.byId.size).toBeGreaterThan(30);
    for (const nodeId of tax.byId.keys()) {
      const expected = planReview(resolveScope({ kind: 'node', nodeId }, tax, metas), new Map(), D, 999).queue;
      const res = await launch(db, nodeId, [...expected, 'force-un-écart']);
      expect(res.status).toBe('changed');
      if (res.status === 'changed') expect(res.plan.queue).toEqual(expected);
    }
  });

  it('performance : lancement revalidé sur 10 000 cartes', async () => {
    const db = await openFlashcardsDb(`v022-perf-${++n}`);
    const rows = Array.from({ length: 10_000 }, (_, i) => [`P${i}`, `Matière ${i % 6}`, `Thème ${i % 25}`, `Question ${i}`, 'R']);
    await repo.commitImport(db, { kind: 'new', name: 'P' }, 'p.csv', buildCards(rows, M, {}).drafts);
    const plan = await preview(db, ROOT_ID);
    const t0 = performance.now();
    const res = await launch(db, ROOT_ID, plan.queue);
    const ms = performance.now() - t0;
    expect(res.status).toBe('started');
    console.info(`Lancement revalidé, 10 000 cartes (IndexedDB simulée) : ${Math.round(ms)} ms`);
  }, 60_000);
});

describe('I2 — remplacement uniquement sur confirmation valide', () => {
  it('deux onglets sans séance lancent simultanément : le second obtient « conflict », le premier reste intact', async () => {
    const { db, name } = await library();
    const tabB = await openFlashcardsDb(name);
    const plan = await preview(db, macro);
    const [a, b] = await Promise.all([launch(db, macro, plan.queue), launch(tabB, macro, plan.queue)]);
    const started = [a, b].find((r) => r.status === 'started') as { session: TestSession } | undefined;
    const conflict = [a, b].find((r) => r.status === 'conflict') as { running: repo.RunningSessionInfo[] } | undefined;
    expect(started && conflict).toBeTruthy();
    expect(conflict!.running.map((r) => r.sessionId)).toEqual([started!.session.sessionId]);
    expect((await repo.getSession(db, started!.session.sessionId))!.status).toBe('in_progress');
    expect((await db.getAll('sessions')).length).toBe(1);

    // Confirmation explicite sur l'état actuel → remplacement atomique
    const replaced = await launch(tabB, macro, plan.queue, conflict!.running.map((r) => r.sessionId));
    expect(replaced.status).toBe('started');
    expect((await repo.getSession(db, started!.session.sessionId))!.status).toBe('abandoned');
    expect(await repo.getInProgressSessions(db)).toHaveLength(1);
  });

  it('confirmation devenue périmée (la séance confirmée a été remplacée ailleurs) : « conflict », rien n’est écrit', async () => {
    const { db, collectionId } = await library();
    const id = await ids(db, collectionId);
    const P = recordAnswer(libre([id['C1']!, id['E4']!]), id['C1']!, selfEvaluate('good', NOW));
    await repo.startNewSession(db, P, NOW);
    const Q = libre([id['E4']!]);
    await repo.startNewSession(db, Q, NOW, [P.sessionId]); // autre onglet : P remplacée par Q après confirmation
    const before = await db.getAll('sessions');
    const res = await launch(db, macro, (await preview(db, macro)).queue, [P.sessionId]); // l'utilisatrice avait confirmé P
    expect(res).toEqual({ status: 'conflict', running: [{ sessionId: Q.sessionId, scopeLabel: 'Test', mode: 'libre' }] });
    expect(await db.getAll('sessions')).toEqual(before);
  });

  it('remplacement confirmé : l’ancienne séance est abandonnée avec ses réponses', async () => {
    const { db, collectionId } = await library();
    const id = await ids(db, collectionId);
    const P = recordAnswer(libre([id['C1']!, id['E4']!]), id['C1']!, selfEvaluate('hard', NOW));
    await repo.startNewSession(db, P, NOW);
    const res = await launch(db, macro, (await preview(db, macro)).queue, [P.sessionId]);
    expect(res.status).toBe('started');
    expect(await repo.getSession(db, P.sessionId)).toMatchObject({ status: 'abandoned', answers: P.answers });
  });

  it('test libre : même protection (SessionConflictError, aucune écriture), puis remplacement confirmé', async () => {
    const { db, collectionId } = await library();
    const id = await ids(db, collectionId);
    const A = libre([id['C1']!]);
    await repo.startNewSession(db, A, NOW, []); // aucun test en cours : accepté
    const B = libre([id['E1']!]);
    const before = await db.getAll('sessions');
    await expect(repo.startNewSession(db, B, NOW, [])).rejects.toBeInstanceOf(repo.SessionConflictError); // A n'avait pas été vue
    expect(await db.getAll('sessions')).toEqual(before);
    try {
      await repo.startNewSession(db, B, NOW, []);
    } catch (e) {
      expect((e as repo.SessionConflictError).running.map((r) => r.sessionId)).toEqual([A.sessionId]);
    }
    expect(await repo.startNewSession(db, B, NOW, [A.sessionId])).toBe(1);
    expect((await repo.getInProgressSessions(db)).map((s) => s.sessionId)).toEqual([B.sessionId]);
  });
});

// Garde-fou de typage
const _m: Pick<CardMeta, 'cardId'> = { cardId: 'x' };
void _m;
