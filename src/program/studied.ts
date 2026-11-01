// v1.1.0 : « Mon programme étudié ». Fonctions pures, testées.
//
// Le programme étudié dit quelles parties de la bibliothèque l'utilisatrice a déjà étudiées. Il ne dit rien de la
// maîtrise des cartes, qui reste l'affaire de la répétition espacée (review/schedule.ts, inchangé).
//
// Unité du programme (« notion ») : le niveau le plus précis de chaque carte, c'est-à-dire le nœud de la taxonomie
// auquel la carte est rattachée directement (sa clé de chemin, `pathKeyOf`). Pour une carte sans notion, c'est sa
// leçon, son thème ou sa matière ; l'écran l'affiche comme « Cartes sans notion ».
// On enregistre les unités étudiées, jamais les niveaux supérieurs : cocher un thème coche les notions présentes à
// ce moment-là ; une notion créée plus tard sous ce thème (import, saisie) reste non étudiée.
//
// Seule la révision programmée est filtrée. Une carte d'une notion non étudiée garde son état de mémorisation et son
// historique ; elle n'est simplement plus proposée.
import type { CardMeta } from '../domain/types';
import { mapNodeId, type LabelRule } from '../taxonomy/labelMerge';
import { pathKeyOf, type TaxNode, type Taxonomy } from '../taxonomy/tree';

export const STUDIED_KEY = 'studiedProgram';

export interface StudiedProgram {
  /** Unités étudiées (identifiants de nœuds, libellés en vigueur à l'enregistrement) */
  units: string[];
  updatedAt: string;
  /** 'history' : initialisé automatiquement d'après l'historique de révision (bibliothèque antérieure à la v1.1.0) */
  origin: 'user' | 'history';
}

export function unitOf(m: Pick<CardMeta, 'matiere' | 'theme' | 'lecon' | 'notion'>): string {
  return pathKeyOf(m);
}

/** Lit la valeur enregistrée ; null si absente, une valeur mal formée étant traitée comme absente. */
export function parseStudied(value: unknown): StudiedProgram | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<StudiedProgram>;
  if (!Array.isArray(v.units) || !v.units.every((u) => typeof u === 'string' && u.length > 0)) return null;
  return { units: v.units, updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : '', origin: v.origin === 'history' ? 'history' : 'user' };
}

/** Message d'erreur si la valeur ne peut pas être enregistrée telle quelle (contrôle des sauvegardes). */
export function studiedValueError(value: unknown): string | null {
  return parseStudied(value) ? null : 'Paramètre « programme étudié » invalide (liste de notions attendue).';
}

/**
 * Unités étudiées avec les libellés actuels : une unité dont le libellé a été fusionné ou renommé depuis est
 * reportée sur le nouveau libellé (règles de fusion du lot 3B). Une fusion de notions de statuts différents
 * donne donc une notion étudiée dès que l'une d'elles l'était.
 * v1.1.0 (correctif) : l'ancien identifiant est REMPLACÉ par le nouveau, jamais conservé à côté. Sinon, décocher la
 * notion renommée retirait seulement le nouvel identifiant, et l'ancien la réactivait au rechargement suivant.
 * Le programme enregistré ne contient donc plus que des identifiants actuels dès qu'il est réenregistré.
 */
export function normalizeUnits(units: Iterable<string>, rules: readonly LabelRule[]): Set<string> {
  const out = new Set<string>();
  for (const u of units) out.add(rules.length ? mapNodeId(u, rules) : u);
  return out;
}

/**
 * Bibliothèque antérieure à la v1.1.0 (aucun programme enregistré) : sont étudiées les unités qui contiennent au moins
 * une carte ayant un historique réel de révision (état de mémorisation ou ligne d'historique).
 */
export function unitsFromHistory(metas: readonly CardMeta[], reviewed: (cardId: string) => boolean): string[] {
  const units = new Set<string>();
  for (const m of metas) if (reviewed(m.cardId)) units.add(unitOf(m));
  return [...units].sort();
}

/** Ensemble effectif : programme enregistré, ou à défaut celui déduit de l'historique. */
export function effectiveStudied(
  raw: unknown,
  metas: readonly CardMeta[],
  reviewed: (cardId: string) => boolean,
  rules: readonly LabelRule[],
): Set<string> {
  const p = parseStudied(raw);
  return normalizeUnits(p ? p.units : unitsFromHistory(metas, reviewed), rules);
}

/** Cartes appartenant au programme étudié (ordre conservé). */
export function studiedMetas<T extends Pick<CardMeta, 'matiere' | 'theme' | 'lecon' | 'notion'>>(metas: readonly T[], studied: ReadonlySet<string>): T[] {
  if (studied.size === 0) return [];
  return metas.filter((m) => studied.has(unitOf(m)));
}

// ---------- Arbre de l'écran « Mon programme étudié » ----------

/** Unités d'un niveau : le niveau lui-même s'il porte des cartes directement, et toutes celles de ses sous-niveaux. */
export function unitsUnder(tax: Taxonomy, nodeId: string): string[] {
  const start = tax.byId.get(nodeId);
  if (!start) return [];
  const out: string[] = [];
  const walk = (n: TaxNode) => {
    if (n.direct > 0) out.push(n.id);
    for (const c of n.children) walk(c);
  };
  walk(start);
  return out;
}

export type CheckState = 'all' | 'some' | 'none';

export interface NodeProgress {
  state: CheckState;
  studiedUnits: number;
  totalUnits: number;
  studiedCards: number;
  totalCards: number;
}

export function progressOf(tax: Taxonomy, units: readonly string[], studied: ReadonlySet<string>): NodeProgress {
  let studiedUnits = 0;
  let studiedCards = 0;
  let totalCards = 0;
  for (const u of units) {
    const direct = tax.byId.get(u)?.direct ?? 0;
    totalCards += direct;
    if (studied.has(u)) {
      studiedUnits++;
      studiedCards += direct;
    }
  }
  const state: CheckState = studiedUnits === 0 ? 'none' : studiedUnits === units.length ? 'all' : 'some';
  return { state, studiedUnits, totalUnits: units.length, studiedCards, totalCards };
}

export function nodeProgress(tax: Taxonomy, nodeId: string, studied: ReadonlySet<string>): NodeProgress {
  return progressOf(tax, unitsUnder(tax, nodeId), studied);
}

/** Coche (on) ou décoche toutes les unités données ; renvoie un nouvel ensemble. */
export function setUnits(studied: ReadonlySet<string>, units: readonly string[], on: boolean): Set<string> {
  const next = new Set(studied);
  for (const u of units) {
    if (on) next.add(u);
    else next.delete(u);
  }
  return next;
}

/** Valeur à enregistrer : seules les unités étudiées, triées. */
export function toStored(studied: ReadonlySet<string>, now: string, origin: StudiedProgram['origin'] = 'user'): StudiedProgram {
  return { units: [...studied].sort(), updatedAt: now, origin };
}
