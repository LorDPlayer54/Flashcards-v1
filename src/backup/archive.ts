// Lot 4 : lecture et validation d'une sauvegarde, AVANT toute écriture. Fonctions pures, testées.
//
// Formats acceptés (compatibilité ascendante) :
//  - version 1 (lot 1)  : collections, cartes, séances, paramètres ;
//  - version 2 (lot 2)  : + états de mémorisation et historique des révisions ;
//  - version 3 (lot 4)  : + version de l'application, schéma, nombre de paramètres et somme de contrôle.
// Une sauvegarde d'une version plus récente que l'application est refusée (champs inconnus possibles).
//
// Règles :
//  - toute anomalie de structure (champ obligatoire absent ou mal typé, identifiant en double, référence vers une
//    collection inexistante, nombres annoncés différents des contenus, somme de contrôle fausse) est une ERREUR :
//    la sauvegarde est refusée et rien n'est écrit ;
//  - les corrections sans perte sont appliquées et SIGNALÉES dans l'aperçu (avertissements) : chemin de classement
//    recalculé, séance sans mode (lot 1) traitée en test libre, identifiant source en double neutralisé comme lors
//    de la migration v2 (la carte est conservée) ;
//  - les états de mémorisation sans carte correspondante (incohérence impossible en usage normal) sont écartés et
//    SIGNALÉS avec leur nombre : aucune donnée n'est écartée sans être annoncée.
import type { Card, Collection, TestSession } from '../domain/types';
import { fnv1a } from '../domain/text';
import { computeContentHash } from '../imports/buildCards';
import type { ReviewLogEntry, ReviewState } from '../review/schedule';
import type { SettingRecord } from '../storage/db';
import { pathKeyOf } from '../taxonomy/tree';

export const BACKUP_FORMAT = 'flashcards-ena-backup';
/** Version du format écrit par cette application */
export const BACKUP_VERSION = 3;
/** Version du schéma IndexedDB décrit par la sauvegarde */
export const SCHEMA_VERSION = 3;

export interface BackupData {
  collections: Collection[];
  cards: Card[];
  sessions: TestSession[];
  settings: SettingRecord[];
  reviewStates: ReviewState[];
  reviewLog: ReviewLogEntry[];
}

export type BackupCounts = { [K in keyof BackupData]: number };

export interface BackupFile extends BackupData {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  /** Version 3 */
  appVersion?: string;
  schemaVersion?: number;
  counts: Partial<BackupCounts>;
  /** Version 3 : empreinte FNV-1a du contenu (détecte une altération ou une troncature accidentelle) */
  checksum?: string;
}

const KEYS: (keyof BackupData)[] = ['collections', 'cards', 'sessions', 'settings', 'reviewStates', 'reviewLog'];

/** Empreinte du contenu, dans un ordre fixe. */
export function backupChecksum(d: BackupData): string {
  return fnv1a(JSON.stringify(KEYS.map((k) => d[k])));
}

export function countsOf(d: BackupData): BackupCounts {
  return Object.fromEntries(KEYS.map((k) => [k, d[k].length])) as BackupCounts;
}

export interface BackupSummary {
  version: number;
  exportedAt: string;
  appVersion?: string;
  counts: BackupCounts;
  /** Corrections appliquées ou données écartées, toutes annoncées avant confirmation */
  warnings: string[];
}

export type ParseResult = { ok: true; data: BackupData; summary: BackupSummary } | { ok: false; errors: string[] };

const MAX_ERRORS = 12;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const RATINGS = new Set(['again', 'hard', 'good', 'easy']);

/**
 * Après restauration, les données de l'appareil sont exactement celles du fichier : sa date d'export devient la
 * « dernière sauvegarde » (sauf si la sauvegarde contient déjà une date plus récente).
 */
export function withBackupMark(data: BackupData, exportedAt: string, key = 'lastBackupAt'): BackupData {
  const current = data.settings.find((s) => s.key === key);
  if (typeof current?.value === 'string' && current.value >= exportedAt) return data;
  return { ...data, settings: [...data.settings.filter((s) => s.key !== key), { key, value: exportedAt }] };
}

/** Lit et valide le texte d'un fichier de sauvegarde. Aucune écriture. */
export function parseBackup(text: string, supportedVersion: number = BACKUP_VERSION): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Le fichier est illisible ou incomplet (JSON invalide). Il a peut-être été tronqué pendant le transfert.'] };
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) return { ok: false, errors: ["Ce fichier n'est pas une sauvegarde Flashcards ENA."] };
  const version = raw.version;
  if (!isNum(version) || !Number.isInteger(version) || version < 1) return { ok: false, errors: ['Version de sauvegarde absente ou invalide.'] };
  if (version > supportedVersion) {
    return {
      ok: false,
      errors: [`Cette sauvegarde a été créée par une version plus récente de l'application (format ${version}). Mettez l'application à jour avant de la restaurer.`],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (m: string) => {
    if (errors.length < MAX_ERRORS) errors.push(m);
    else if (errors.length === MAX_ERRORS) errors.push('… (autres anomalies non détaillées)');
  };

  const arr = (k: keyof BackupData): unknown[] => {
    const v = raw[k];
    if (v === undefined && version < 2 && (k === 'reviewStates' || k === 'reviewLog')) return [];
    if (!Array.isArray(v)) {
      err(`Contenu « ${k} » absent ou invalide.`);
      return [];
    }
    return v;
  };
  const input = Object.fromEntries(KEYS.map((k) => [k, arr(k)])) as Record<keyof BackupData, unknown[]>;
  if (!isStr(raw.exportedAt)) err("Date d'export absente.");
  if (errors.length) return { ok: false, errors };

  // Nombres annoncés : une sauvegarde tronquée ou modifiée à la main est détectée
  if (isObj(raw.counts)) {
    for (const k of KEYS) {
      const announced = raw.counts[k];
      if (announced !== undefined && announced !== input[k].length) err(`Sauvegarde incomplète : ${announced} élément(s) « ${k} » annoncé(s), ${input[k].length} présent(s).`);
    }
  } else err('Récapitulatif (counts) absent.');
  if (version >= 3) {
    if (!isStr(raw.checksum)) err('Somme de contrôle absente.');
    else if (backupChecksum(input as unknown as BackupData) !== raw.checksum) err('Somme de contrôle incorrecte : le fichier a été altéré ou endommagé.');
  }
  if (errors.length) return { ok: false, errors };

  // ---------- Collections ----------
  const collections: Collection[] = [];
  const colIds = new Set<string>();
  input.collections.forEach((c, i) => {
    if (!isObj(c) || !isNonEmpty(c.collectionId) || !isStr(c.name) || !Array.isArray(c.sourceFiles) || !isStr(c.createdAt) || !isStr(c.updatedAt) || !isNum(c.seq))
      return err(`Collection n° ${i + 1} incomplète.`);
    if (colIds.has(c.collectionId)) return err(`Collection en double : ${c.collectionId}.`);
    colIds.add(c.collectionId);
    collections.push(c as unknown as Collection);
  });

  // ---------- Cartes ----------
  const cards: Card[] = [];
  const cardIds = new Set<string>();
  const external = new Set<string>();
  let pathFixed = 0;
  let hashAdded = 0;
  let dupNeutralised = 0;
  // Ordre de création : la carte la plus ancienne garde son identifiant source (même règle que la migration v2)
  const sortedCards = input.cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ca = isObj(a.c) && isStr(a.c.createdAt) ? a.c.createdAt : '';
      const cb = isObj(b.c) && isStr(b.c.createdAt) ? b.c.createdAt : '';
      return ca < cb ? -1 : ca > cb ? 1 : a.i - b.i;
    });
  for (const { c, i } of sortedCards) {
    const where = `Carte n° ${i + 1}`;
    if (!isObj(c) || !isNonEmpty(c.cardId)) {
      err(`${where} : identifiant absent.`);
      continue;
    }
    if (cardIds.has(c.cardId)) {
      err(`${where} : identifiant en double (${c.cardId}).`);
      continue;
    }
    if (!isNonEmpty(c.collectionId) || !colIds.has(c.collectionId)) {
      err(`${where} : collection inexistante.`);
      continue;
    }
    if (!isNonEmpty(c.matiere) || !isStr(c.question) || !isStr(c.rawQuestion) || !isStr(c.reponse) || !isNum(c.sourceRow) || !isStr(c.sourceFile) || !isStr(c.createdAt) || !isStr(c.updatedAt)) {
      err(`${where} : champ obligatoire absent ou invalide.`);
      continue;
    }
    for (const k of ['theme', 'lecon', 'notion', 'typePedagogique', 'difficulte', 'explication', 'astucePiege', 'externalId'] as const) {
      if (c[k] !== undefined && !isStr(c[k])) err(`${where} : champ « ${k} » invalide.`);
    }
    if (c.formatQuestion === 'mcq') {
      const opts = c.options;
      if (!Array.isArray(opts) || opts.length < 2 || opts.length > 5 || !opts.every((o) => isObj(o) && isNonEmpty(o.id) && isStr(o.text)) || !opts.some((o) => (o as { id: string }).id === c.correctOptionId)) {
        err(`${where} : QCM invalide (propositions ou bonne réponse).`);
        continue;
      }
    } else if (c.formatQuestion !== 'open') {
      err(`${where} : format de question inconnu.`);
      continue;
    }
    cardIds.add(c.cardId);
    let card = { ...c } as unknown as Card;
    const pk = pathKeyOf(card);
    if (card.pathKey !== pk) {
      card = { ...card, pathKey: pk };
      pathFixed++;
    }
    if (!isStr(card.contentHash)) {
      card = { ...card, contentHash: computeContentHash(card) };
      hashAdded++;
    }
    if (card.externalId) {
      const key = `${card.collectionId}\u001f${card.externalId}`;
      if (external.has(key)) {
        const { externalId, ...rest } = card;
        card = { ...rest, duplicateExternalId: externalId };
        dupNeutralised++;
      } else external.add(key);
    }
    cards.push(card);
  }

  // ---------- Séances ----------
  const sessions: TestSession[] = [];
  const sessionIds = new Set<string>();
  let modeAdded = 0;
  input.sessions.forEach((s, i) => {
    const where = `Séance n° ${i + 1}`;
    if (!isObj(s) || !isNonEmpty(s.sessionId)) return err(`${where} : identifiant absent.`);
    if (sessionIds.has(s.sessionId)) return err(`${where} : identifiant en double.`);
    if (!Array.isArray(s.cardIds) || !s.cardIds.every(isStr) || !isObj(s.answers) || !isNum(s.currentIndex) || !isObj(s.config) || !isObj(s.scope) || !isStr(s.createdAt))
      return err(`${where} : contenu invalide.`);
    if (s.status !== 'in_progress' && s.status !== 'finished' && s.status !== 'abandoned') return err(`${where} : statut inconnu.`);
    if (s.mode !== undefined && s.mode !== 'libre' && s.mode !== 'revision') return err(`${where} : mode inconnu.`);
    sessionIds.add(s.sessionId);
    if (s.mode === undefined) modeAdded++;
    // Les séances peuvent citer des cartes supprimées depuis : c'est leur historique, conservé tel quel
    sessions.push({ ...s, mode: s.mode ?? 'libre', scopeLabel: isStr(s.scopeLabel) ? s.scopeLabel : '', updatedAt: isStr(s.updatedAt) ? s.updatedAt : s.createdAt } as unknown as TestSession);
  });

  // ---------- Paramètres ----------
  const settings: SettingRecord[] = [];
  const keys = new Set<string>();
  input.settings.forEach((r, i) => {
    if (!isObj(r) || !isNonEmpty(r.key) || !('value' in r)) return err(`Paramètre n° ${i + 1} invalide.`);
    if (keys.has(r.key)) return err(`Paramètre en double : ${r.key}.`);
    keys.add(r.key);
    settings.push({ key: r.key, value: r.value });
  });

  // ---------- États de mémorisation ----------
  const reviewStates: ReviewState[] = [];
  const stateIds = new Set<string>();
  let orphanStates = 0;
  input.reviewStates.forEach((st, i) => {
    const where = `État de mémorisation n° ${i + 1}`;
    if (!isObj(st) || !isNonEmpty(st.cardId) || !isStr(st.dueDay) || !isNum(st.intervalDays) || !RATINGS.has(st.lastRating as string) || (st.status !== 'learning' && st.status !== 'review'))
      return err(`${where} : contenu invalide.`);
    if (stateIds.has(st.cardId)) return err(`${where} : carte en double.`);
    stateIds.add(st.cardId);
    if (!cardIds.has(st.cardId)) {
      orphanStates++;
      return;
    }
    reviewStates.push(st as unknown as ReviewState);
  });

  // ---------- Historique ----------
  const reviewLog: ReviewLogEntry[] = [];
  const logIds = new Set<string>();
  input.reviewLog.forEach((l, i) => {
    const where = `Ligne d'historique n° ${i + 1}`;
    if (!isObj(l) || !isNonEmpty(l.logId) || !isNonEmpty(l.cardId) || !isStr(l.day) || !RATINGS.has(l.rating as string)) return err(`${where} : contenu invalide.`);
    if (logIds.has(l.logId)) return err(`${where} : identifiant en double.`);
    logIds.add(l.logId);
    // L'historique d'une carte supprimée est conservé (règle du lot 2)
    reviewLog.push(l as unknown as ReviewLogEntry);
  });

  if (errors.length) return { ok: false, errors };

  if (pathFixed) warnings.push(`${pathFixed} chemin(s) de classement recalculé(s) d'après les libellés des cartes (sans effet sur leur contenu).`);
  if (hashAdded) warnings.push(`${hashAdded} empreinte(s) de contenu recalculée(s).`);
  if (dupNeutralised)
    warnings.push(`${dupNeutralised} carte(s) partageaient l'identifiant source d'une autre carte de la même collection : elles sont conservées, sans cet identifiant (comme lors de la migration v2).`);
  if (modeAdded) warnings.push(`${modeAdded} séance(s) d'une version antérieure enregistrée(s) comme tests libres.`);
  if (orphanStates) warnings.push(`${orphanStates} état(s) de mémorisation sans carte correspondante seront ignorés.`);
  if (version < 2) warnings.push('Sauvegarde du lot 1 : elle ne contient pas de progression de révision programmée (aucun état de mémorisation ni historique).');

  const data: BackupData = { collections, cards, sessions, settings, reviewStates, reviewLog };
  return {
    ok: true,
    data,
    summary: { version, exportedAt: raw.exportedAt as string, appVersion: isStr(raw.appVersion) ? raw.appVersion : undefined, counts: countsOf(data), warnings },
  };
}
