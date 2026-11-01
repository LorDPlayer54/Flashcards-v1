// Algorithme de répétition espacée V1 (lot 2). Fonctions pures, testées.
//
// Règles (cahier des charges §5.2), précisées ici :
//  - Échéances au JOUR près, en date locale (« AAAA-MM-JJ »). Une carte est due si son échéance ≤ aujourd'hui.
//  - « À revoir »   : série de réussites remise à 0, statut « learning », échéance J+1.
//                     Pendant la séance, la carte est reproposée UNE fois en fin de séance (voir tests/session.ts) ;
//                     cette reprise est historisée mais ne modifie pas l'échéance (J+1 reste acquis).
//  - « Difficile »  : statut « learning », échéance J+1, la série redescend d'un cran (minimum 0) :
//                     la prochaine réussite reprend l'échelle un palier plus bas.
//  - « Correct »    : série + 1, intervalle = palier de la série sur l'échelle 3, 7, 14, 30, 60 jours (puis 60).
//  - « Facile »     : série + 1, intervalle = palier de la série sur l'échelle 7, 14, 30, 60, 120 jours (puis 120).
//    L'intervalle dépend donc de l'historique individuel de la carte (sa série de réussites).
//  - Carte « maîtrisée » : dernière note Correct/Facile ET intervalle ≥ 14 jours.
import type { SelfEval } from '../domain/types';

export type Rating = SelfEval; // 'again' | 'hard' | 'good' | 'easy'
export type ReviewStatus = 'new' | 'learning' | 'review';

export const GOOD_LADDER = [3, 7, 14, 30, 60] as const;
export const EASY_LADDER = [7, 14, 30, 60, 120] as const;
export const MASTERED_MIN_INTERVAL = 14;
export const DEFAULT_NEW_PER_DAY = 20;

export interface ReviewState {
  cardId: string;
  status: Exclude<ReviewStatus, 'new'>;
  reviewCount: number;
  /** Nombre de « À revoir » reçus */
  lapses: number;
  /** Série de réussites courante (sert à choisir le palier) */
  successStreak: number;
  lastRating: Rating;
  intervalDays: number;
  /** Date locale de la première révision (sert au plafond de nouvelles cartes par jour) */
  firstReviewedDay: string;
  lastReviewedAt: string;
  lastReviewedDay: string;
  /** Prochaine échéance, date locale AAAA-MM-JJ */
  dueDay: string;
  /**
   * Tests libres (v1.2) : 'libre' si la dernière évaluation effective vient d'un test libre ; absent pour la
   * révision programmée (et pour les états antérieurs).
   */
  lastSource?: 'libre';
  /**
   * Tests libres (v1.2) : état AVANT la première évaluation effective du jour `lastReviewedDay` (null : carte
   * nouvelle). Sert à remplacer, le même jour, une évaluation par une autre plus informative (révision après test
   * libre) ou plus défavorable, sans cumuler deux progressions. Absent pour les états antérieurs.
   */
  dayBase?: DayBase | null;
}

/** Copie d'un état de mémorisation, sans identifiant ni base du jour */
export type DayBase = Omit<ReviewState, 'cardId' | 'dayBase'>;

// ---------- Dates locales ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Date locale du jour (fuseau de l'appareil), au format AAAA-MM-JJ. */
export function localDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Ajoute des jours à une date AAAA-MM-JJ (calcul en UTC : insensible aux changements d'heure). */
export function addDays(day: string, n: number): string {
  if (!DAY_RE.test(day)) throw new Error(`Date invalide : ${day}`);
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  const p = (v: number) => String(v).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/** Écart en jours entre deux dates AAAA-MM-JJ (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

// ---------- Algorithme ----------

function ladderValue(ladder: readonly number[], streak: number): number {
  return ladder[Math.min(Math.max(streak, 1), ladder.length) - 1]!;
}

/**
 * Applique une évaluation à l'état d'une carte (undefined = carte nouvelle) et renvoie le nouvel état.
 * `today` = date locale de la révision ; `nowIso` = horodatage exact.
 */
export function applyRating(prev: ReviewState | undefined, cardId: string, rating: Rating, today: string, nowIso: string): ReviewState {
  const base = {
    cardId,
    reviewCount: (prev?.reviewCount ?? 0) + 1,
    lapses: prev?.lapses ?? 0,
    firstReviewedDay: prev?.firstReviewedDay ?? today,
    lastReviewedAt: nowIso,
    lastReviewedDay: today,
    lastRating: rating,
  };
  const streak = prev?.successStreak ?? 0;
  switch (rating) {
    case 'again':
      return { ...base, status: 'learning', lapses: base.lapses + 1, successStreak: 0, intervalDays: 1, dueDay: addDays(today, 1) };
    case 'hard':
      return { ...base, status: 'learning', successStreak: Math.max(0, streak - 1), intervalDays: 1, dueDay: addDays(today, 1) };
    case 'good': {
      const s = streak + 1;
      const interval = ladderValue(GOOD_LADDER, s);
      return { ...base, status: 'review', successStreak: s, intervalDays: interval, dueDay: addDays(today, interval) };
    }
    case 'easy': {
      const s = streak + 1;
      const interval = ladderValue(EASY_LADDER, s);
      return { ...base, status: 'review', successStreak: s, intervalDays: interval, dueDay: addDays(today, interval) };
    }
  }
}

// ---------- Tests libres et évaluations du même jour (v1.2) ----------
//
// Révision programmée : règles ci-dessus, inchangées (applyRating). Seule exception : si la carte a déjà reçu
// aujourd'hui une évaluation effective en test libre, l'évaluation de révision la REMPLACE (calcul à partir de
// l'état d'avant cette évaluation) au lieu de s'y ajouter.
//
// Test libre (applyFreeTest) :
//  - échec (QCM faux = « À revoir », question ouverte « À revoir » ou « Difficile ») : règle de révision
//    correspondante, quelle que soit l'échéance ;
//  - question ouverte « Correct » ou « Facile » : règle de révision correspondante si la carte est dans sa
//    fenêtre d'échéance (voir inDueWindow), sinon sans effet ;
//  - QCM juste : règle « Correct » si la carte est due (échéance atteinte ou dépassée), sinon sans effet ;
//  - carte nouvelle : un échec la fait entrer en apprentissage (J+1) ; une première réussite (QCM juste, « Correct »
//    ou « Facile ») donne J+3 et compte comme première réussite de la série : chaque réussite suivante, faite au bon
//    moment, monte d'un palier (QCM juste : 3 → 7 → 14 → 30 → 60 jours, comme « Correct ») ;
//  - une seule évaluation effective par carte et par jour : une nouvelle évaluation du même jour n'est prise en
//    compte que si elle est plus défavorable, et elle remplace alors la précédente.
// Une évaluation « sans effet » ne modifie rien (ni état, ni historique).

const RANK: Record<Rating, number> = { again: 0, hard: 1, good: 2, easy: 2 };

/** Signal d'une réponse de test libre */
export type FreeSignal = { kind: 'mcq'; correct: boolean } | { kind: 'open'; rating: Rating };

/**
 * Fenêtre d'échéance : la carte est due, en retard, ou dans le dernier quart de son intervalle
 * (1 à 3 j : l'échéance ; 7 j : 1 jour avant ; 14 j : 3 ; 30 j : 7 ; 60 j : 15 ; 120 j : 30).
 */
export function inDueWindow(state: Pick<ReviewState, 'dueDay' | 'intervalDays'>, today: string): boolean {
  return today >= addDays(state.dueDay, -Math.floor(Math.max(0, state.intervalDays) / 4));
}

function snapshot(s: ReviewState): DayBase {
  const { cardId: _id, dayBase: _base, ...rest } = s;
  return rest;
}

function fromBase(base: DayBase | null | undefined, cardId: string): ReviewState | undefined {
  return base ? { ...base, cardId } : undefined;
}

/** Ajoute la base du jour et la source ; aucune propriété indéfinie (sauvegarde JSON fidèle). */
function finish(next: ReviewState, base: DayBase | null, source: 'revision' | 'libre'): ReviewState {
  const { lastSource: _s, dayBase: _b, ...rest } = next;
  return source === 'libre' ? { ...rest, lastSource: 'libre', dayBase: base } : { ...rest, dayBase: base };
}

/** Base du jour : état d'avant la première évaluation effective d'aujourd'hui. */
function baseFor(prev: ReviewState | undefined, today: string): DayBase | null {
  if (!prev) return null;
  if (prev.lastReviewedDay === today && prev.dayBase !== undefined) return prev.dayBase;
  return snapshot(prev);
}

/** Évaluation de révision programmée (règles du lot 2), qui remplace une évaluation de test libre du même jour. */
export function applyRevision(prev: ReviewState | undefined, cardId: string, rating: Rating, today: string, nowIso: string): ReviewState {
  const base = baseFor(prev, today);
  const replacesFree = prev !== undefined && prev.lastReviewedDay === today && prev.lastSource === 'libre' && prev.dayBase !== undefined;
  const from = replacesFree ? fromBase(base, cardId) : prev;
  return finish(applyRating(from, cardId, rating, today, nowIso), base, 'revision');
}

/** Évaluation de test libre ; undefined = sans effet sur la mémorisation. */
export function applyFreeTest(prev: ReviewState | undefined, cardId: string, signal: FreeSignal, today: string, nowIso: string): ReviewState | undefined {
  const rating: Rating = signal.kind === 'mcq' ? (signal.correct ? 'good' : 'again') : signal.rating;
  const success = rating === 'good' || rating === 'easy';
  const base = baseFor(prev, today);
  let from = prev;
  if (prev && prev.lastReviewedDay === today) {
    // Même jour : seule une évaluation plus défavorable compte, et elle remplace la précédente
    if (RANK[rating] >= RANK[prev.lastRating]) return undefined;
    from = prev.dayBase !== undefined ? fromBase(prev.dayBase, cardId) : prev;
  }
  if (!success) return finish(applyRating(from, cardId, rating, today, nowIso), base, 'libre');
  if (!from) {
    // Carte nouvelle : première réussite prudente (J+3)
    const first = applyRating(undefined, cardId, 'good', today, nowIso);
    return finish({ ...first, lastRating: rating }, base, 'libre');
  }
  const counts = signal.kind === 'mcq' ? from.dueDay <= today : inDueWindow(from, today);
  return counts ? finish(applyRating(from, cardId, rating, today, nowIso), base, 'libre') : undefined;
}

export function isDue(state: ReviewState | undefined, today: string): boolean {
  return state !== undefined && state.dueDay <= today;
}

export function isMastered(state: ReviewState | undefined): boolean {
  return state !== undefined && (state.lastRating === 'good' || state.lastRating === 'easy') && state.intervalDays >= MASTERED_MIN_INTERVAL;
}

export function statusOf(state: ReviewState | undefined): ReviewStatus {
  return state ? state.status : 'new';
}

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  new: 'Nouvelle',
  learning: 'En apprentissage',
  review: 'En révision',
};

/** Historique : une ligne par évaluation enregistrée (jamais modifiée ni supprimée, même si la carte l'est). */
export interface ReviewLogEntry {
  logId: string;
  cardId: string;
  sessionId: string;
  /** Horodatage exact et date locale de l'évaluation */
  at: string;
  day: string;
  rating: Rating;
  /** Justesse objective, pour les QCM seulement */
  correct?: boolean;
  /** Vrai pour la reprise de fin de séance d'une carte « À revoir » (sans effet sur l'échéance) */
  repeat: boolean;
  /** Tests libres (v1.2) : 'libre' pour une évaluation de test libre ; absent pour la révision programmée */
  mode?: 'libre';
  /** Échéance avant / après cette évaluation */
  previousDueDay?: string;
  intervalDays: number;
  dueDay: string;
}
