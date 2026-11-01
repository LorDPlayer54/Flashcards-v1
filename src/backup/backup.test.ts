// Lot 4 : sauvegarde (format 3), lecture des formats 1 à 3, validation avant écriture et restauration atomique.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Card, TestSession } from '../domain/types';
import { buildCards } from '../imports/buildCards';
import { applyRating } from '../review/schedule';
import { openFlashcardsDb, type DB } from '../storage/db';
import * as repo from '../storage/repo';
import { nodeIdFor, ROOT_ID } from '../taxonomy/tree';
import { advance, createSession, recordAnswer, selfEvaluate, withDeadline, pauseSession } from '../tests/session';
import { SessionController } from '../tests/sessionController';
import { backupChecksum, BACKUP_FORMAT, countsOf, parseBackup, withBackupMark, type BackupData } from './archive';
import { backupFileName, buildBackup, customBackupName, readAllData } from './export';
import { restoreBackup, RestoreVerificationError } from './restore';

const D = '2026-11-02';
const NOW = '2026-11-02T09:00:00.000Z';
let n = 0;
const M = { externalId: 0, matiere: 1, theme: 2, notion: 3, question: 4, reponse: 5 };

/** Instantané comparable (ordre des enregistrements indifférent) */
async function snapshot(db: DB) {
  const d = await readAllData(db);
  const sortBy = <T>(arr: T[], key: keyof T) => [...arr].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  return {
    collections: sortBy(d.collections, 'collectionId'),
    cards: sortBy(d.cards, 'cardId'),
    sessions: sortBy(d.sessions, 'sessionId'),
    settings: sortBy(d.settings, 'key'),
    reviewStates: sortBy(d.reviewStates, 'cardId'),
    reviewLog: sortBy(d.reviewLog, 'logId'),
  };
}

/** Bibliothèque représentative : import, carte saisie, fusion, révision, test libre en pause, réglages */
async function richLibrary(name = `backup-${++n}`) {
  const db = await openFlashcardsDb(name);
  const rows = [
    ['C1', 'Calcul', 'Fraction', 'Addition', 'Combien font 1/2 + 1/2 ?\nA) 1  B) 2', 'A) 1'],
    ['C2', 'Calcul', 'Fractions', 'Simplification', 'Simplifier 2/4.', '1/2'],
    ['C3', 'Calcul', 'Pourcentages', '', '10 % de 50 ?', '5'],
    ['A1', 'Anglais', 'Grammaire', '', 'Past of go?', 'went'],
  ];
  const imp = await repo.commitImport(db, { kind: 'new', name: 'Banque' }, 'banque.csv', buildCards(rows, M, {}).drafts, NOW);
  await repo.createCard(db, {
    content: { matiere: 'Anglais', theme: 'Vocabulaire', formatQuestion: 'open', question: 'Cat?', rawQuestion: 'Cat?', reponse: 'chat' },
    collection: { kind: 'manual' },
    now: NOW,
  });
  await repo.mergeLabels(db, {
    parentId: nodeIdFor([{ kind: 'matiere', label: 'Calcul' }]),
    level: 'theme',
    from: ['Fraction'],
    to: 'Fractions',
    expectedCounts: { Fraction: 1 },
    now: NOW,
  });
  const cards = await repo.getCardsOfCollection(db, imp.collectionId);
  const id = (ext: string) => cards.find((c) => c.externalId === ext)!.cardId;
  // Révision programmée
  const r = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Révision', { count: null, format: 'all', order: 'library' }, [id('C2')], NOW, 'revision');
  await repo.startNewSession(db, r, NOW);
  await new SessionController(r, (x) => repo.saveRevisionTransition(db, x, D, NOW)).apply(advance(recordAnswer(r, id('C2'), selfEvaluate('good', NOW)), NOW));
  // Test libre chronométré, en pause
  let s = withDeadline(createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: null, format: 'all', order: 'library', timer: { mode: 'limit', limitSec: 600, pausable: true } }, [id('C3'), id('A1')], NOW), NOW);
  await repo.startNewSession(db, s, NOW);
  s = pauseSession(advance(recordAnswer(s, id('C3'), selfEvaluate('hard', NOW)), NOW), NOW);
  await repo.saveSessionTransition(db, { ...s, revision: 1 });
  await repo.setNewPerDay(db, 15);
  await repo.setSetting(db, 'appearance', { theme: 'dark', text: 'large' });
  return { db, collectionId: imp.collectionId, id };
}

const text = (o: unknown) => JSON.stringify(o);

describe('sauvegarde et restauration : aller-retour', () => {
  it('format 3 complet : contenu, nombres, somme de contrôle, version de l’application', async () => {
    const { db } = await richLibrary();
    const b = await buildBackup(db, NOW);
    expect(b).toMatchObject({ format: BACKUP_FORMAT, version: 3, schemaVersion: 3, exportedAt: NOW });
    expect(typeof b.appVersion).toBe('string');
    expect(b.counts).toEqual({ collections: 2, cards: 5, sessions: 2, settings: 3, reviewStates: 1, reviewLog: 1 });
    expect(b.checksum).toBe(backupChecksum(b));
  });

  it('restauration sur un navigateur vierge : toutes les données identiques, application utilisable', async () => {
    const { db, id } = await richLibrary();
    const before = await snapshot(db);
    const parsed = parseBackup(text(await buildBackup(db, NOW)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.summary.warnings).toEqual([]);
    const fresh = await openFlashcardsDb(`backup-fresh-${++n}`);
    expect(await restoreBackup(fresh, parsed.data)).toEqual(parsed.summary.counts);
    expect(await snapshot(fresh)).toStrictEqual(before);
    // L'application fonctionne sur les données restaurées : bibliothèque, test en pause, fusions, réglages
    expect(await repo.loadAllMeta(fresh)).toHaveLength(5);
    const paused = (await repo.getInProgressSessions(fresh))[0]!;
    expect(paused).toMatchObject({ pausedAt: NOW, currentIndex: 1 });
    expect(await repo.getLabelRules(fresh)).toHaveLength(1);
    expect(await repo.getNewPerDay(fresh)).toBe(15);
    expect((await repo.getReviewState(fresh, id('C2')))!.intervalDays).toBe(3);
  });

  it('restauration sur un appareil déjà utilisé : les anciennes données sont entièrement remplacées', async () => {
    const { db } = await richLibrary();
    const archive = parseBackup(text(await buildBackup(db, NOW)));
    if (!archive.ok) throw new Error();
    const other = await openFlashcardsDb(`backup-other-${++n}`);
    await repo.commitImport(other, { kind: 'new', name: 'Autre' }, 'autre.csv', buildCards([['X1', 'Économie', 'Macro', '', 'Q', 'R']], M, {}).drafts, NOW);
    await repo.setSetting(other, 'lastBackupAt', NOW);
    await restoreBackup(other, archive.data);
    expect(await snapshot(other)).toStrictEqual(await snapshot(db));
    expect((await other.getAll('cards')).some((c) => c.matiere === 'Économie')).toBe(false);
  });
});

describe('archives refusées : rien n’est écrit', () => {
  async function base() {
    const { db } = await richLibrary();
    return { db, b: await buildBackup(db, NOW) };
  }

  it('fichier tronqué, autre fichier JSON, version plus récente', async () => {
    const { b } = await base();
    const t = text(b);
    expect(parseBackup(t.slice(0, Math.floor(t.length / 2)))).toEqual({ ok: false, errors: [expect.stringMatching(/illisible ou incomplet/)] });
    expect(parseBackup('{"hello": 1}')).toEqual({ ok: false, errors: [expect.stringMatching(/pas une sauvegarde/)] });
    expect(parseBackup(text({ ...b, version: 4 }))).toEqual({ ok: false, errors: [expect.stringMatching(/version plus récente/)] });
    expect(parseBackup(text({ ...b, version: 'x' })).ok).toBe(false);
  });

  it('modification ou altération du contenu : somme de contrôle incorrecte', async () => {
    const { b } = await base();
    const altered = text(b).replace('"reponse":"1/2"', '"reponse":"0,5"');
    expect(altered).not.toBe(text(b));
    expect(parseBackup(altered)).toEqual({ ok: false, errors: [expect.stringMatching(/Somme de contrôle incorrecte/)] });
    const { checksum: _c, ...noChecksum } = b;
    expect(parseBackup(text(noChecksum))).toEqual({ ok: false, errors: [expect.stringMatching(/Somme de contrôle absente/)] });
  });

  it('éléments manquants (nombres annoncés différents)', async () => {
    const { b } = await base();
    const cut = { ...b, cards: b.cards.slice(1) };
    const r = parseBackup(text({ ...cut, checksum: backupChecksum(cut) }));
    expect(r).toEqual({ ok: false, errors: [expect.stringMatching(/5 élément\(s\) « cards » annoncé\(s\), 4 présent\(s\)/)] });
  });

  it('anomalies de structure : toutes signalées, sauvegarde refusée', async () => {
    const { b } = await base();
    const broken: BackupData = {
      ...b,
      cards: [{ ...b.cards[0]!, collectionId: 'inconnue' }, { ...b.cards[1]!, cardId: b.cards[2]!.cardId }, ...b.cards.slice(2)],
      sessions: [{ ...b.sessions[0]!, status: 'perdue' as TestSession['status'] }, b.sessions[1]!],
      reviewStates: [{ ...b.reviewStates[0]!, lastRating: 'parfait' as 'good' }],
    };
    const doc = { ...b, ...broken, counts: countsOf(broken), checksum: backupChecksum(broken) };
    const r = parseBackup(text(doc));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' | ')).toMatch(/collection inexistante/);
    expect(r.errors.join(' | ')).toMatch(/identifiant en double/);
    expect(r.errors.join(' | ')).toMatch(/statut inconnu/);
    expect(r.errors.join(' | ')).toMatch(/État de mémorisation n° 1 : contenu invalide/);
    const qcm = b.cards.find((c) => c.formatQuestion === 'mcq')!;
    const badQcm = { ...b, cards: b.cards.map((c) => (c === qcm ? { ...c, correctOptionId: 'Z' } : c)) };
    expect(parseBackup(text({ ...badQcm, checksum: backupChecksum(badQcm) })).ok).toBe(false);
  });

  it('restauration interrompue par une écriture refusée : données existantes intactes', async () => {
    const { db, b } = await base();
    const parsed = parseBackup(text(b));
    if (!parsed.ok) throw new Error();
    const target = await openFlashcardsDb(`backup-target-${++n}`);
    await repo.commitImport(target, { kind: 'new', name: 'Autre' }, 'autre.csv', buildCards([['X1', 'Économie', 'Macro', '', 'Q', 'R']], M, {}).drafts, NOW);
    const before = await snapshot(target);
    const proto = IDBObjectStore.prototype;
    const add = proto.add;
    let k = 0;
    proto.add = function (this: IDBObjectStore, ...a: Parameters<typeof add>) {
      if (this.name === 'cards' && ++k === 3) throw new DOMException('simulation', 'QuotaExceededError');
      return add.apply(this, a);
    };
    try {
      await expect(restoreBackup(target, parsed.data)).rejects.toThrow();
    } finally {
      proto.add = add;
    }
    expect(await snapshot(target)).toStrictEqual(before);
    void db;
  });

  it('vérification après écriture en échec : restauration annulée', async () => {
    const { b } = await base();
    const parsed = parseBackup(text(b));
    if (!parsed.ok) throw new Error();
    const target = await openFlashcardsDb(`backup-verify-${++n}`);
    await repo.setSetting(target, 'témoin', 1);
    const before = await snapshot(target);
    // Écriture incomplète simulée : une carte disparaît avant la vérification
    await expect(
      restoreBackup(target, parsed.data, { afterWrite: async (tx) => tx.objectStore('cards').delete(parsed.data.cards[0]!.cardId) }),
    ).rejects.toBeInstanceOf(RestoreVerificationError);
    expect(await snapshot(target)).toStrictEqual(before);
  });
});

describe('compatibilité ascendante et corrections annoncées', () => {
  it('format 1 (lot 1) : restauré, sans progression de révision, avec avertissement', async () => {
    const { db } = await richLibrary();
    const b = await buildBackup(db, NOW);
    const v1 = {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: NOW,
      counts: { cards: b.cards.length, collections: b.collections.length, sessions: 1 },
      collections: b.collections,
      cards: b.cards.map(({ editedAt: _e, ...c }) => c),
      // Séance du lot 1 : test libre, sans champs des lots suivants
      sessions: [{ ...b.sessions.find((s) => s.mode === 'libre')!, mode: undefined, deadlineAt: undefined, pausedAt: undefined, elapsedMs: undefined, config: { count: 2, format: 'all', order: 'library' } }],
      settings: [{ key: 'lastScope', value: { nodeId: ROOT_ID, label: 'Toutes les matières' } }],
    };
    const r = parseBackup(text(v1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.counts).toMatchObject({ cards: 5, sessions: 1, reviewStates: 0, reviewLog: 0 });
    expect(r.summary.warnings).toEqual([
      "1 séance(s) d'une version antérieure enregistrée(s) comme tests libres.",
      'Sauvegarde du lot 1 : elle ne contient pas de progression de révision programmée (aucun état de mémorisation ni historique).',
    ]);
    const fresh = await openFlashcardsDb(`backup-v1-${++n}`);
    await restoreBackup(fresh, r.data);
    expect((await repo.getInProgressSessions(fresh))[0]!.mode).toBe('libre');
    expect(await fresh.getAll('reviewStates')).toEqual([]);
  });

  it('format 2 (lots 2 et 3) : restauré à l’identique', async () => {
    const { db } = await richLibrary();
    const { checksum: _c, appVersion: _a, schemaVersion: _s, ...rest } = await buildBackup(db, NOW);
    const v2 = { ...rest, version: 2, counts: { cards: rest.cards.length, collections: rest.collections.length, sessions: rest.sessions.length, reviewStates: 1, reviewLog: 1 } };
    const r = parseBackup(text(v2));
    expect(r.ok && r.summary.warnings).toEqual([]);
    if (!r.ok) return;
    const fresh = await openFlashcardsDb(`backup-v2-${++n}`);
    await restoreBackup(fresh, r.data);
    expect(await snapshot(fresh)).toStrictEqual(await snapshot(db));
  });

  it('corrections sans perte : identifiant source en double, chemin incohérent, état orphelin — annoncées', async () => {
    const { db } = await richLibrary();
    const b = await buildBackup(db, NOW);
    const c1 = b.cards.find((c) => c.externalId === 'C1')!;
    const c3 = b.cards.find((c) => c.externalId === 'C3')!;
    const data: BackupData = {
      ...b,
      cards: b.cards.map((c): Card => (c === c3 ? { ...c, externalId: 'C1', createdAt: '2026-11-03T00:00:00.000Z', pathKey: 'faux' } : c)),
      reviewStates: [...b.reviewStates, applyRating(undefined, 'carte-absente', 'good', D, NOW)],
    };
    const r = parseBackup(text({ ...b, ...data, counts: countsOf(data), checksum: backupChecksum(data) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.warnings).toEqual([
      "1 chemin(s) de classement recalculé(s) d'après les libellés des cartes (sans effet sur leur contenu).",
      "1 carte(s) partageaient l'identifiant source d'une autre carte de la même collection : elles sont conservées, sans cet identifiant (comme lors de la migration v2).",
      '1 état(s) de mémorisation sans carte correspondante seront ignorés.',
    ]);
    const kept = r.data.cards.find((c) => c.cardId === c3.cardId)!;
    expect(kept).toMatchObject({ duplicateExternalId: 'C1', pathKey: c3.pathKey });
    expect(kept.externalId).toBeUndefined();
    expect(r.data.cards.find((c) => c.cardId === c1.cardId)!.externalId).toBe('C1');
    expect(r.summary.counts).toMatchObject({ cards: 5, reviewStates: 1 });
    const fresh = await openFlashcardsDb(`backup-fix-${++n}`);
    await restoreBackup(fresh, r.data); // l'index unique (collection, identifiant source) est respecté
    expect(await fresh.count('cards')).toBe(5);
  });
});

describe('date de dernière sauvegarde après restauration', () => {
  it('prend la date du fichier restauré, sauf date plus récente déjà présente', async () => {
    const { db } = await richLibrary();
    const b = await buildBackup(db, NOW);
    const marked = withBackupMark(b, NOW);
    expect(marked.settings.find((s) => s.key === 'lastBackupAt')).toEqual({ key: 'lastBackupAt', value: NOW });
    expect(marked.settings).toHaveLength(b.settings.length + 1);
    const later = { ...b, settings: [...b.settings, { key: 'lastBackupAt', value: '2027-01-01T00:00:00.000Z' }] };
    expect(withBackupMark(later, NOW)).toBe(later);
    const fresh = await openFlashcardsDb(`backup-mark-${++n}`);
    expect((await restoreBackup(fresh, marked)).settings).toBe(b.settings.length + 1);
    expect(await repo.getSetting(fresh, 'lastBackupAt', null)).toBe(NOW);
  });
});

describe('volume', () => {
  it('10 000 cartes et 20 000 lignes d’historique : sauvegarde, validation et restauration', async () => {
    const db = await openFlashcardsDb(`backup-big-${++n}`);
    const rows = Array.from({ length: 10_000 }, (_, i) => [`B${i}`, `Matière ${i % 4}`, `Thème ${i % 40}`, `Notion ${i % 400}`, `Question fictive ${i} ?`, `Réponse ${i}`]);
    await repo.commitImport(db, { kind: 'new', name: 'Volume' }, 'volume.csv', buildCards(rows, M, {}).drafts, NOW);
    const ids = (await db.getAll('cards')).map((c) => c.cardId);
    const tx = db.transaction('reviewLog', 'readwrite');
    for (let i = 0; i < 20_000; i++)
      void tx.store.add({ logId: `L${i}`, cardId: ids[i % ids.length]!, sessionId: 's', at: NOW, day: D, rating: 'good', repeat: false, intervalDays: 3, dueDay: '2026-11-05' });
    await tx.done;
    const t0 = performance.now();
    const t = text(await buildBackup(db, NOW));
    const parsed = parseBackup(t);
    if (!parsed.ok) throw new Error(parsed.errors.join());
    const fresh = await openFlashcardsDb(`backup-big-fresh-${++n}`);
    await restoreBackup(fresh, parsed.data);
    const ms = performance.now() - t0;
    expect(await fresh.count('cards')).toBe(10_000);
    expect(await fresh.count('reviewLog')).toBe(20_000);
    console.log(`Volume : ${(t.length / 1e6).toFixed(1)} Mo, export + validation + restauration en ${Math.round(ms)} ms (IndexedDB simulée)`);
  }, 120_000);
});

describe('nom du fichier de sauvegarde (refonte Plus V2)', () => {
  const now = new Date(2026, 10, 4, 9, 5);
  it('nom par défaut inchangé', () => {
    expect(backupFileName(now)).toBe('flashcards-sauvegarde-2026-11-04-0905.json');
  });
  it('nom personnalisé, date facultative, extension unique', () => {
    expect(customBackupName('Révisions ENA', true, now)).toBe('Revisions ENA-2026-11-04-0905.json');
    expect(customBackupName('Sœur ①', false, now)).toBe('Soeur.json');
    expect(customBackupName('mon/fichier:test.JSON', false, now)).toBe('mon-fichier-test.json');
    expect(customBackupName('copie.json.json', false, now)).toBe('copie.json');
    expect(customBackupName('   ', false, now)).toBe('flashcards-sauvegarde.json');
    expect(customBackupName('..', true, now)).toBe('flashcards-sauvegarde-2026-11-04-0905.json');
  });
});
