// v1.1.0 : « Mon programme étudié » et les deux parcours de révision. Critères d'acceptation du cahier des charges
// (section 8), sur la vraie base (fake-indexeddb) et les vraies fonctions de lancement.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { CardMeta, ScopeSpec, TestSession } from '../domain/types';
import { buildCards } from '../imports/buildCards';
import { buildBackup } from '../backup/export';
import { parseBackup } from '../backup/archive';
import { restoreBackup } from '../backup/restore';
import { newRemainingToday, planReview, splitDue } from '../review/queue';
import { openFlashcardsDb, type DB } from '../storage/db';
import * as repo from '../storage/repo';
import { mapNodeId } from '../taxonomy/labelMerge';
import { buildTaxonomy, childNodeId, nodeIdFor, ROOT_ID, type Taxonomy } from '../taxonomy/tree';
import { resolveScope } from '../tests/selection';
import { advance, createSession, recordAnswer, selfEvaluate } from '../tests/session';
import { SessionController } from '../tests/sessionController';
import {
  effectiveStudied,
  nodeProgress,
  normalizeUnits,
  parseStudied,
  setUnits,
  STUDIED_KEY,
  studiedMetas,
  studiedValueError,
  unitOf,
  unitsFromHistory,
  unitsUnder,
} from './studied';

const D = '2026-11-02';
const NOW = '2026-11-02T09:00:00.000Z';
const M = { externalId: 0, matiere: 1, theme: 2, notion: 3, question: 4, reponse: 5 } as const;
let n = 0;

const mat = (m: string) => nodeIdFor([{ kind: 'matiere', label: m }]);
const th = (m: string, t: string) => childNodeId(mat(m), 'theme', t);
const no = (m: string, t: string, x: string) => childNodeId(th(m, t), 'notion', x);

/** 1 000 cartes : 2 matières × 5 thèmes × 4 notions × 25 cartes. */
function bigRows(): string[][] {
  const rows: string[][] = [];
  for (const m of ['Calcul', 'Droit'])
    for (let t = 1; t <= 5; t++) for (let x = 1; x <= 4; x++) for (let k = 1; k <= 25; k++) rows.push([`${m}-${t}-${x}-${k}`, m, `T${t}`, `N${x}`, `Q ${m} ${t} ${x} ${k}`, 'R']);
  return rows;
}

async function library(rows: string[][]) {
  const db = await openFlashcardsDb(`studied-${++n}`);
  const out = await repo.commitImport(db, { kind: 'new', name: 'Lib' }, 'lib.csv', buildCards(rows, M, {}).drafts, NOW);
  return { db, collectionId: out.collectionId };
}

async function view(db: DB) {
  const metas = await repo.loadAllMeta(db);
  const tax = buildTaxonomy(metas);
  const rules = await repo.getLabelRules(db);
  const program = await repo.getStudiedProgram(db);
  const units = normalizeUnits(program?.units ?? [], rules);
  return { metas, tax, units, studied: studiedMetas(metas, units) };
}

/** Aperçu tel que l'écran « Réviser » le calcule (révision du jour, ou personnalisée sur `nodeIds`) */
async function preview(db: DB, nodeIds?: string[], today = D) {
  const v = await view(db);
  const states = await repo.loadReviewStates(db);
  const remaining = newRemainingToday(await repo.countIntroducedOn(db, today), await repo.getNewPerDay(db));
  const scoped = nodeIds ? resolveScope({ kind: 'multi', nodeIds }, buildTaxonomy(v.studied), v.studied) : v.studied;
  return { plan: planReview(scoped, states, today, remaining), states, ...v };
}

const scopeOf = (nodeIds?: string[]): Extract<ScopeSpec, { kind: 'node' | 'multi' }> =>
  !nodeIds ? { kind: 'node', nodeId: ROOT_ID } : nodeIds.length === 1 ? { kind: 'node', nodeId: nodeIds[0]! } : { kind: 'multi', nodeIds };

const launch = (db: DB, expectedQueue: readonly string[], nodeIds?: string[], today = D) =>
  repo.startReviewSession(db, { nodeId: ROOT_ID, scope: scopeOf(nodeIds), scopeLabel: 'x', expectedQueue, confirmedReplace: [], today, now: NOW });

/** Joue une séance de révision jusqu'au bout (toutes les cartes « Correct ») */
async function play(db: DB, session: TestSession, today = D) {
  const ctl = new SessionController(session, (x) => repo.saveRevisionTransition(db, x, today, `${today}T10:00:00.000Z`));
  let s = session;
  for (const id of session.cardIds) s = ((await ctl.apply(advance(recordAnswer(s, id, selfEvaluate('good', NOW)), NOW))) as { session: TestSession }).session;
  return s;
}

const cardIdsByExt = async (db: DB) => Object.fromEntries((await db.getAll('cards')).map((c) => [c.externalId!, c.cardId]));

describe('modèle du programme étudié (fonctions pures)', () => {
  const metas: CardMeta[] = [
    { cardId: 'a', collectionId: 'c', matiere: 'Calcul', theme: 'Fractions', notion: 'Addition', formatQuestion: 'open', sourceRow: 1 },
    { cardId: 'b', collectionId: 'c', matiere: 'Calcul', theme: 'Fractions', notion: 'Produit', formatQuestion: 'open', sourceRow: 2 },
    { cardId: 'c', collectionId: 'c', matiere: 'Calcul', theme: 'Fractions', formatQuestion: 'open', sourceRow: 3 }, // sans notion
    { cardId: 'd', collectionId: 'c', matiere: 'Anglais', theme: 'Grammaire', lecon: 'Temps', notion: 'Présent', formatQuestion: 'open', sourceRow: 4 },
    { cardId: 'e', collectionId: 'c', matiere: 'Anglais', theme: 'Grammaire', lecon: 'Temps', formatQuestion: 'open', sourceRow: 5 }, // leçon sans notion
  ];
  const tax: Taxonomy = buildTaxonomy(metas);

  it('unité = niveau le plus précis de la carte ; cartes sans notion = unité propre de leur thème ou leçon', () => {
    expect(unitOf(metas[0]!)).toBe(no('Calcul', 'Fractions', 'Addition'));
    expect(unitOf(metas[2]!)).toBe(th('Calcul', 'Fractions'));
    expect(unitsUnder(tax, th('Calcul', 'Fractions')).sort()).toEqual([th('Calcul', 'Fractions'), no('Calcul', 'Fractions', 'Addition'), no('Calcul', 'Fractions', 'Produit')].sort());
    expect(unitsUnder(tax, ROOT_ID)).toHaveLength(5);
  });

  it('cases à trois états et compteurs ; cocher une matière ne coche que ses notions présentes', () => {
    let s = setUnits(new Set(), [no('Calcul', 'Fractions', 'Addition')], true);
    expect(nodeProgress(tax, th('Calcul', 'Fractions'), s)).toMatchObject({ state: 'some', studiedUnits: 1, totalUnits: 3, studiedCards: 1, totalCards: 3 });
    expect(nodeProgress(tax, mat('Anglais'), s).state).toBe('none');
    s = setUnits(s, unitsUnder(tax, mat('Calcul')), true);
    expect(nodeProgress(tax, mat('Calcul'), s).state).toBe('all');
    expect(studiedMetas(metas, s).map((m) => m.cardId)).toEqual(['a', 'b', 'c']);
    // Une notion apparue ensuite sous « Calcul » (import) n'est pas étudiée
    const later = buildTaxonomy([...metas, { cardId: 'f', collectionId: 'c', matiere: 'Calcul', theme: 'Fractions', notion: 'Quotient', formatQuestion: 'open', sourceRow: 6 }]);
    expect(nodeProgress(later, mat('Calcul'), s)).toMatchObject({ state: 'some', studiedUnits: 3, totalUnits: 4 });
    // Décocher
    s = setUnits(s, [th('Calcul', 'Fractions')], false);
    expect(studiedMetas(metas, s).map((m) => m.cardId)).toEqual(['a', 'b']);
  });

  it('valeur enregistrée : lecture tolérante, contrôle strict pour les sauvegardes', () => {
    expect(parseStudied(null)).toBeNull();
    expect(parseStudied({ units: 'x' })).toBeNull();
    expect(parseStudied({ units: ['a', ''] })).toBeNull();
    expect(parseStudied({ units: ['a'], updatedAt: NOW, origin: 'history' })).toEqual({ units: ['a'], updatedAt: NOW, origin: 'history' });
    expect(studiedValueError({ units: [1] })).toMatch(/programme étudié/);
    expect(studiedValueError({ units: [] })).toBeNull();
  });

  it('historique : unités contenant au moins une carte déjà révisée', () => {
    expect(unitsFromHistory(metas, (id) => id === 'b' || id === 'e')).toEqual([no('Calcul', 'Fractions', 'Produit'), childNodeId(childNodeId(mat('Anglais'), 'theme', 'Grammaire'), 'lecon', 'Temps')].sort());
    expect([...effectiveStudied(undefined, metas, (id) => id === 'a', [])]).toEqual([no('Calcul', 'Fractions', 'Addition')]);
    expect([...effectiveStudied({ units: [] }, metas, (id) => id === 'a', [])]).toEqual([]); // programme enregistré, même vide
  });

  it('aperçu : cartes en retard et à revoir aujourd’hui distinguées sans changer la file', () => {
    const states = new Map([
      ['a', { dueDay: '2026-11-01' }],
      ['b', { dueDay: D }],
    ]);
    expect(splitDue(['a', 'b'], states, D)).toEqual({ overdue: 1, today: 1 });
  });
});

describe('critères d’acceptation (base réelle)', () => {
  it('1 000 cartes, aucune notion activée : aucune carte proposée, et le lancement ne peut pas être contourné', async () => {
    const { db } = await library(bigRows());
    expect(await repo.ensureStudiedProgram(db, NOW)).toMatchObject({ units: [], origin: 'history' });
    const { plan } = await preview(db);
    expect(plan.queue).toEqual([]);
    expect((await launch(db, [])).status).toBe('empty');
    // Une file calculée sur toute la bibliothèque (sans le programme) est refusée : rien n'est écrit
    const metas = await repo.loadAllMeta(db);
    const bypass = planReview(metas, new Map(), D, 20);
    const res = await launch(db, bypass.queue);
    expect(res.status).toBe('changed');
    expect(await db.count('sessions')).toBe(0);
  });

  it('30 % des notions activées : la révision du jour ne porte que sur elles, quota respecté', async () => {
    const { db } = await library(bigRows());
    const { tax } = await view(db);
    const units = unitsUnder(tax, ROOT_ID);
    expect(units).toHaveLength(40);
    const chosen = units.slice(0, 12); // 30 %
    await repo.saveStudiedProgram(db, new Set(chosen), NOW);
    await repo.setNewPerDay(db, 500);
    const { plan, metas } = await preview(db);
    const unitOfId = new Map(metas.map((m) => [m.cardId, unitOf(m)]));
    expect(plan.queue).toHaveLength(300);
    expect(plan.queue.every((id) => chosen.includes(unitOfId.get(id)!))).toBe(true);
    const res = await launch(db, plan.queue);
    expect(res.status).toBe('started');
    if (res.status === 'started') expect(res.session.cardIds).toEqual(plan.queue);
  });

  it('activation d’une matière entière ; nouvelle notion importée non étudiée ; nouvelle carte d’une notion étudiée éligible', async () => {
    const { db, collectionId } = await library(bigRows().filter((r) => r[1] === 'Calcul' && r[2] === 'T1'));
    const { tax } = await view(db);
    await repo.saveStudiedProgram(db, new Set(unitsUnder(tax, mat('Calcul'))), NOW);
    expect((await view(db)).studied).toHaveLength(100);
    // Import d'une nouvelle notion sous Calcul › T1, et d'une carte supplémentaire dans la notion N1 déjà étudiée
    const more = [...bigRows().filter((r) => r[1] === 'Calcul' && r[2] === 'T1'), ['NEW-1', 'Calcul', 'T1', 'N9', 'Q nouvelle notion', 'R'], ['NEW-2', 'Calcul', 'T1', 'N1', 'Q carte ajoutée', 'R']];
    await repo.commitImport(db, { kind: 'existing', collectionId }, 'lib.csv', buildCards(more, M, {}).drafts, NOW);
    const v = await view(db);
    const ids = await cardIdsByExt(db);
    expect(v.studied.some((m) => m.cardId === ids['NEW-1'])).toBe(false);
    expect(v.studied.some((m) => m.cardId === ids['NEW-2'])).toBe(true);
    expect(nodeProgress(v.tax, mat('Calcul'), v.units)).toMatchObject({ state: 'some', studiedUnits: 4, totalUnits: 5 });
  });

  it('désactivation d’une notion : cartes exclues, progression et historique conservés ; réactivation : échéances reprises', async () => {
    const { db } = await library(bigRows().filter((r) => r[1] === 'Calcul' && r[2] === 'T1'));
    const { tax } = await view(db);
    await repo.saveStudiedProgram(db, new Set(unitsUnder(tax, th('Calcul', 'T1'))), NOW);
    const p1 = await preview(db, [no('Calcul', 'T1', 'N1')]);
    const r = await launch(db, p1.plan.queue, [no('Calcul', 'T1', 'N1')]);
    if (r.status !== 'started') throw new Error(r.status);
    await play(db, r.session);
    const statesBefore = await db.getAll('reviewStates');
    const logBefore = await db.getAll('reviewLog');
    expect(statesBefore).toHaveLength(20);
    // Désactivation de N1
    const { units } = await view(db);
    await repo.saveStudiedProgram(db, setUnits(units, [no('Calcul', 'T1', 'N1')], false), NOW);
    const v = await view(db);
    expect(v.studied.some((m) => unitOf(m) === no('Calcul', 'T1', 'N1'))).toBe(false);
    expect(await db.getAll('reviewStates')).toEqual(statesBefore);
    expect(await db.getAll('reviewLog')).toEqual(logBefore);
    // Trois jours plus tard, les cartes de N1 sont dues mais exclues ; réactivées, elles reviennent avec leur échéance
    const later = '2026-11-20';
    expect((await preview(db, undefined, later)).plan.due).toEqual([]);
    await repo.saveStudiedProgram(db, setUnits(v.units, [no('Calcul', 'T1', 'N1')], true), NOW);
    const back = await preview(db, undefined, later);
    expect(back.plan.due).toHaveLength(20);
    expect(splitDue(back.plan.due, back.states, later).overdue).toBe(20); // échéance d'origine conservée, aucune pénalité ajoutée
  });

  it('révision personnalisée sur plusieurs matières : limitée aux notions étudiées et aux cartes éligibles', async () => {
    const { db } = await library(bigRows());
    await repo.saveStudiedProgram(db, new Set([no('Calcul', 'T1', 'N1'), no('Droit', 'T2', 'N3')]), NOW);
    await repo.setNewPerDay(db, 100);
    // Choix : Calcul (entier) + Droit › T2 ; seule une notion étudiée de chaque côté
    const sel = [mat('Calcul'), th('Droit', 'T2')];
    const { plan, metas } = await preview(db, sel);
    const unitOfId = new Map(metas.map((m) => [m.cardId, unitOf(m)]));
    expect(new Set(plan.queue.map((id) => unitOfId.get(id)))).toEqual(new Set([no('Calcul', 'T1', 'N1'), no('Droit', 'T2', 'N3')]));
    expect(plan.queue).toHaveLength(50);
    // Une notion non étudiée demandée directement : aucune carte ne peut être lancée
    const forced = await launch(db, [], [no('Droit', 'T5', 'N4')]);
    expect(forced.status).toBe('empty');
    const res = await launch(db, plan.queue, sel);
    expect(res.status).toBe('started');
    if (res.status === 'started') expect(res.session.scope).toEqual({ kind: 'multi', nodeIds: sel });
  });

  it('progression commune : une carte révisée en personnalisé est à jour en révision du jour, quota partagé, aucune reproposition', async () => {
    const { db } = await library(bigRows().filter((r) => r[2] === 'T1'));
    const { tax } = await view(db);
    await repo.saveStudiedProgram(db, new Set(unitsUnder(tax, ROOT_ID)), NOW);
    await repo.setNewPerDay(db, 10);
    const custom = await preview(db, [no('Droit', 'T1', 'N2')]);
    expect(custom.plan.queue).toHaveLength(10);
    const r = await launch(db, custom.plan.queue, [no('Droit', 'T1', 'N2')]);
    if (r.status !== 'started') throw new Error(r.status);
    await play(db, r.session);
    const states = await repo.loadReviewStates(db);
    for (const id of custom.plan.queue) expect(states.get(id)!.dueDay > D).toBe(true);
    // Révision du jour, même jour : quota épuisé par la séance personnalisée, rien de révisé n'est reproposé
    const daily = await preview(db);
    expect(daily.plan.queue).toEqual([]);
    expect(daily.plan.freshAvailable).toBeGreaterThan(0);
    // Le lendemain : quota disponible, cartes révisées non dues (intervalle > 1 jour) donc absentes
    const next = await preview(db, undefined, '2026-11-03');
    expect(next.plan.fresh).toHaveLength(10);
    expect(next.plan.queue.some((id) => custom.plan.queue.includes(id))).toBe(false);
  });

  it('test libre sur une notion non étudiée (v1.2) : état de mémorisation créé, programme inchangé, réutilisé une fois la notion cochée', async () => {
    const { db } = await library(bigRows().filter((r) => r[2] === 'T1'));
    expect((await view(db)).studied).toEqual([]);
    const metas = await repo.loadAllMeta(db);
    const scoped = resolveScope({ kind: 'node', nodeId: no('Calcul', 'T1', 'N1') }, buildTaxonomy(metas), metas);
    expect(scoped).toHaveLength(25);
    const s = createSession({ kind: 'node', nodeId: no('Calcul', 'T1', 'N1') }, 'Test', { count: 25, format: 'all', order: 'library' }, scoped.map((m) => m.cardId), NOW);
    await repo.startNewSession(db, s, NOW);
    expect(await db.count('reviewStates')).toBe(0);
    const first = s.cardIds[0]!;
    const answered = { ...recordAnswer(s, first, selfEvaluate('again', NOW)), revision: (s.revision ?? 0) + 1 };
    await repo.saveEvaluatedTransition(db, answered, D, NOW);
    expect(await repo.getReviewState(db, first)).toMatchObject({ status: 'learning', lastSource: 'libre' });
    expect((await view(db)).studied).toEqual([]);
    expect((await repo.getStudiedProgram(db))?.units ?? []).toEqual([]);
    // Notion cochée : la carte reprend son état (due le lendemain), elle n'est plus « nouvelle »
    await repo.saveStudiedProgram(db, new Set([no('Calcul', 'T1', 'N1')]), NOW);
    const next = await preview(db, undefined, '2026-11-03');
    expect(next.plan.due).toEqual([first]);
    expect(next.plan.fresh).not.toContain(first);
  });

  it('fermeture et réouverture : le programme est conservé', async () => {
    const { db } = await library(bigRows().filter((r) => r[2] === 'T1'));
    await repo.saveStudiedProgram(db, new Set([no('Calcul', 'T1', 'N2')]), NOW);
    const name = db.name;
    db.close();
    const again = await openFlashcardsDb(name);
    expect(await repo.getStudiedProgram(again)).toEqual({ units: [no('Calcul', 'T1', 'N2')], updatedAt: NOW, origin: 'user' });
    expect(await repo.ensureStudiedProgram(again)).toEqual({ units: [no('Calcul', 'T1', 'N2')], updatedAt: NOW, origin: 'user' });
  });

  it('sauvegarde puis restauration : programme et états de mémorisation conservés ; valeur invalide refusée', async () => {
    const { db } = await library(bigRows().filter((r) => r[2] === 'T1'));
    await repo.saveStudiedProgram(db, new Set([no('Calcul', 'T1', 'N1')]), NOW);
    const p = await preview(db);
    const r = await launch(db, p.plan.queue);
    if (r.status !== 'started') throw new Error(r.status);
    await play(db, r.session);
    const backup = await buildBackup(db, NOW);
    expect(backup.settings.find((s) => s.key === STUDIED_KEY)?.value).toMatchObject({ units: [no('Calcul', 'T1', 'N1')] });
    const parsed = parseBackup(JSON.stringify(backup));
    if (!parsed.ok) throw new Error(parsed.errors.join());
    const fresh = await openFlashcardsDb(`studied-fresh-${++n}`);
    await restoreBackup(fresh, parsed.data);
    expect(await repo.getStudiedProgram(fresh)).toEqual(await repo.getStudiedProgram(db));
    expect(await fresh.getAll('reviewStates')).toEqual(await db.getAll('reviewStates'));
    // Valeur altérée (somme de contrôle recalculée) : sauvegarde refusée
    const { backupChecksum } = await import('../backup/archive');
    const bad = { ...backup, settings: backup.settings.map((s) => (s.key === STUDIED_KEY ? { ...s, value: { units: 42 } } : s)) };
    const badDoc = { ...bad, checksum: backupChecksum(bad) };
    const refused = parseBackup(JSON.stringify(badDoc));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors.join()).toMatch(/programme étudié/);
  });

  it('ancienne sauvegarde (sans programme) : données intactes, programme déduit de l’historique à l’ouverture', async () => {
    const { db } = await library(bigRows().filter((r) => r[2] === 'T1'));
    await repo.saveStudiedProgram(db, new Set([no('Droit', 'T1', 'N3')]), NOW);
    const p = await preview(db);
    const r = await launch(db, p.plan.queue);
    if (r.status !== 'started') throw new Error(r.status);
    await play(db, r.session);
    // Sauvegarde « version 1.0 » : même contenu, sans la clé du programme
    const backup = await buildBackup(db, NOW);
    const old = { ...backup, settings: backup.settings.filter((s) => s.key !== STUDIED_KEY) };
    const { backupChecksum, countsOf } = await import('../backup/archive');
    const doc = { ...old, counts: countsOf(old), checksum: backupChecksum(old), appVersion: '1.0.0' };
    const parsed = parseBackup(JSON.stringify(doc));
    if (!parsed.ok) throw new Error(parsed.errors.join());
    const fresh = await openFlashcardsDb(`studied-old-${++n}`);
    await restoreBackup(fresh, parsed.data);
    expect(await fresh.getAll('cards')).toEqual(await db.getAll('cards'));
    expect(await fresh.getAll('sessions')).toEqual(await db.getAll('sessions'));
    expect(await fresh.getAll('reviewLog')).toEqual(await db.getAll('reviewLog'));
    expect(await repo.getStudiedProgram(fresh)).toBeNull();
    expect((await repo.ensureStudiedProgram(fresh, NOW)).units).toEqual([no('Droit', 'T1', 'N3')]);
  });

  it('bibliothèque antérieure : initialisation unique d’après l’historique réel, sans réactivation ultérieure', async () => {
    const { db } = await library(bigRows().filter((r) => r[2] === 'T1'));
    const ids = await cardIdsByExt(db);
    // Révision faite « en v1.0 » (aucun programme enregistré) sur une carte de Calcul › T1 › N4
    const s0 = createSession({ kind: 'node', nodeId: ROOT_ID }, 'x', { count: null, format: 'all', order: 'library' }, [ids['Calcul-1-4-1']!], NOW, 'revision');
    await repo.startNewSession(db, s0, NOW);
    await play(db, s0);
    await db.delete('settings', STUDIED_KEY);
    const first = await repo.ensureStudiedProgram(db, NOW);
    expect(first).toMatchObject({ units: [no('Calcul', 'T1', 'N4')], origin: 'history' });
    // La notion entière est accessible : la carte révisée garde son état, ses 24 voisines entrent comme nouvelles
    const v = await view(db);
    expect(v.studied).toHaveLength(25);
    const states = await repo.loadReviewStates(db);
    expect(states.get(ids['Calcul-1-4-1']!)).toBeDefined();
    // Initialisation unique : décocher puis rouvrir ne la refait pas
    await repo.saveStudiedProgram(db, new Set(), NOW);
    expect((await repo.ensureStudiedProgram(db, NOW)).units).toEqual([]);
  });

  it('renommage et fusion : les choix du programme suivent les libellés actuels', async () => {
    const { db } = await library([
      ['A1', 'Calcul', 'Fractions', 'Addition', 'Q1', 'R'],
      ['A2', 'Calcul', 'Fraction', 'Addition', 'Q2', 'R'],
      ['B1', 'Calcul', 'Fractions', 'Produit', 'Q3', 'R'],
      ['C1', 'Calcul', 'Pourcentages', 'Taux', 'Q4', 'R'],
    ]);
    // Étudiés : Fractions › Addition et Fraction › Addition ; pas Fractions › Produit
    await repo.saveStudiedProgram(db, new Set([no('Calcul', 'Fractions', 'Addition'), no('Calcul', 'Fraction', 'Addition')]), NOW);
    // Fusion du thème « Fraction » dans « Fractions »
    const merged = await repo.mergeLabels(db, { parentId: mat('Calcul'), level: 'theme', from: ['Fraction'], to: 'Fractions', expectedCounts: { Fraction: 1 }, now: NOW });
    expect(merged.status).toBe('merged');
    let v = await view(db);
    expect(v.studied.map((m) => m.notion).sort()).toEqual(['Addition', 'Addition']);
    // Renommage de la notion « Addition » en « Somme » (fusion vers un nouveau libellé)
    await repo.mergeLabels(db, { parentId: th('Calcul', 'Fractions'), level: 'notion', from: ['Addition'], to: 'Somme', expectedCounts: { Addition: 2 }, now: NOW });
    v = await view(db);
    expect(v.studied).toHaveLength(2);
    expect(v.studied.every((m) => m.notion === 'Somme')).toBe(true);
    expect(nodeProgress(v.tax, th('Calcul', 'Fractions'), v.units)).toMatchObject({ studiedUnits: 1, totalUnits: 2 });
    // Fusion de notions de statuts différents : la notion obtenue est étudiée
    await repo.mergeLabels(db, { parentId: th('Calcul', 'Fractions'), level: 'notion', from: ['Produit'], to: 'Somme', expectedCounts: { Produit: 1 }, now: NOW });
    v = await view(db);
    expect(v.studied).toHaveLength(3);
    // Le lancement (transaction) applique les mêmes règles
    const p = await preview(db);
    expect((await launch(db, p.plan.queue)).status).toBe('started');
    expect(mapNodeId(no('Calcul', 'Fraction', 'Addition'), await repo.getLabelRules(db))).toBe(no('Calcul', 'Fractions', 'Somme'));
  });

  it('séance en cours quand une notion est désactivée : séance intacte, réponses enregistrées, historique conservé', async () => {
    const { db } = await library(bigRows().filter((r) => r[2] === 'T1' && r[1] === 'Calcul'));
    const { tax } = await view(db);
    await repo.saveStudiedProgram(db, new Set(unitsUnder(tax, ROOT_ID)), NOW);
    const p = await preview(db);
    const r = await launch(db, p.plan.queue);
    if (r.status !== 'started') throw new Error(r.status);
    const ctl = new SessionController(r.session, (x) => repo.saveRevisionTransition(db, x, D, NOW));
    let s = r.session;
    s = ((await ctl.apply(advance(recordAnswer(s, s.cardIds[0]!, selfEvaluate('good', NOW)), NOW))) as { session: TestSession }).session;
    // L'utilisatrice désactive tout le programme pendant la séance (mise en pause comprise)
    await repo.saveStudiedProgram(db, new Set(), NOW);
    const stored = await repo.getSession(db, s.sessionId);
    expect(stored).toEqual(s);
    // La séance se poursuit normalement
    s = ((await ctl.apply(advance(recordAnswer(s, s.cardIds[1]!, selfEvaluate('good', NOW)), NOW))) as { session: TestSession }).session;
    expect(Object.keys((await repo.getSession(db, s.sessionId))!.answers)).toHaveLength(2);
    expect(await db.count('reviewLog')).toBe(2);
    expect((await preview(db)).plan.queue).toEqual([]);
  });
});

describe('v1.1.0 (contre-revue) : désactivation manuelle après renommage ou fusion', () => {
  // Rechargement de l'application : programme relu en base et règles de fusion appliquées, exactement comme AppContext
  const reloadApp = async (db: DB) => view(db);
  const notionCards = (studied: CardMeta[], notion: string) => studied.filter((m) => m.notion === notion).length;

  async function setupRenamed() {
    const { db } = await library([
      ['A1', 'Calcul', 'Fractions', 'Addition', 'Q1', 'R'],
      ['A2', 'Calcul', 'Fractions', 'Addition', 'Q2', 'R'],
      ['P1', 'Calcul', 'Fractions', 'Produit', 'Q3', 'R'],
    ]);
    return db;
  }

  it('renommage : statut conservé, puis décoché, il reste décoché après rechargement et exclu des révisions ; recochage effectif', async () => {
    const db = await setupRenamed();
    // 1. notion étudiée, révisée une fois (pour contrôler états et historique)
    await repo.saveStudiedProgram(db, new Set([no('Calcul', 'Fractions', 'Addition')]), NOW);
    const p0 = await preview(db);
    const r0 = await launch(db, p0.plan.queue);
    if (r0.status !== 'started') throw new Error(r0.status);
    await play(db, r0.session);
    const states = await db.getAll('reviewStates');
    const log = await db.getAll('reviewLog');
    // 2. renommage « Addition » → « Somme »
    await repo.mergeLabels(db, { parentId: th('Calcul', 'Fractions'), level: 'notion', from: ['Addition'], to: 'Somme', expectedCounts: { Addition: 2 }, now: NOW });
    // 3. statut conservé
    let v = await reloadApp(db);
    expect(notionCards(v.studied, 'Somme')).toBe(2);
    // 4. décochage manuel (écran : setUnits sur les unités affichées, puis enregistrement)
    await repo.saveStudiedProgram(db, setUnits(v.units, [no('Calcul', 'Fractions', 'Somme')], false), NOW);
    // 5. rechargement : toujours non étudiée, exclue de la révision du jour et du lancement
    v = await reloadApp(db);
    expect(notionCards(v.studied, 'Somme')).toBe(0);
    expect(nodeProgress(v.tax, no('Calcul', 'Fractions', 'Somme'), v.units).state).toBe('none');
    const later = '2026-11-20'; // les deux cartes révisées sont dues à cette date
    expect((await preview(db, undefined, later)).plan.queue).toEqual([]);
    const ids = await cardIdsByExt(db);
    expect((await launch(db, [ids['A1']!, ids['A2']!], undefined, later)).status).toBe('changed');
    // Recochage volontaire : la notion revient, avec ses échéances d'origine
    await repo.saveStudiedProgram(db, setUnits(v.units, [no('Calcul', 'Fractions', 'Somme')], true), NOW);
    v = await reloadApp(db);
    expect(notionCards(v.studied, 'Somme')).toBe(2);
    expect((await preview(db, undefined, later)).plan.due).toHaveLength(2);
    // États de mémorisation et historique inchangés de bout en bout
    expect(await db.getAll('reviewStates')).toEqual(states);
    expect(await db.getAll('reviewLog')).toEqual(log);
  });

  it('fusion de deux notions de statuts différents : étudiée, puis décochée durablement, puis recochée', async () => {
    const db = await setupRenamed();
    await repo.saveStudiedProgram(db, new Set([no('Calcul', 'Fractions', 'Addition')]), NOW); // Produit non étudiée
    await repo.mergeLabels(db, { parentId: th('Calcul', 'Fractions'), level: 'notion', from: ['Addition'], to: 'Produit', expectedCounts: { Addition: 2 }, now: NOW });
    let v = await reloadApp(db);
    expect(notionCards(v.studied, 'Produit')).toBe(3); // règle annoncée : étudiée dès que l'une l'était
    await repo.saveStudiedProgram(db, setUnits(v.units, [no('Calcul', 'Fractions', 'Produit')], false), NOW);
    v = await reloadApp(db);
    expect(notionCards(v.studied, 'Produit')).toBe(0);
    expect((await preview(db)).plan.queue).toEqual([]);
    await repo.saveStudiedProgram(db, setUnits(v.units, [no('Calcul', 'Fractions', 'Produit')], true), NOW);
    v = await reloadApp(db);
    expect(notionCards(v.studied, 'Produit')).toBe(3);
  });

  it('thème renommé : décocher une notion du thème renommé reste effectif après rechargement', async () => {
    const db = await setupRenamed();
    await repo.saveStudiedProgram(db, new Set([no('Calcul', 'Fractions', 'Addition'), no('Calcul', 'Fractions', 'Produit')]), NOW);
    await repo.mergeLabels(db, { parentId: mat('Calcul'), level: 'theme', from: ['Fractions'], to: 'Rapports', expectedCounts: { Fractions: 3 }, now: NOW });
    let v = await reloadApp(db);
    expect(v.studied).toHaveLength(3);
    await repo.saveStudiedProgram(db, setUnits(v.units, [no('Calcul', 'Rapports', 'Addition')], false), NOW);
    v = await reloadApp(db);
    expect(v.studied.map((m) => m.notion)).toEqual(['Produit']);
  });
});
