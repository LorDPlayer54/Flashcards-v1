// Déroulement d'un test libre ou d'une révision programmée : fonctions pures (immutables), testées.
// Un test libre ne modifie jamais un calendrier de répétition espacée (seul le stockage de la révision le fait).
import type { AnswerRecord, Card, CardMeta, ScopeSpec, SelfEval, SessionMode, TestConfig, TestSession } from '../domain/types';
import { newId } from '../domain/text';

export function createSession(
  scope: ScopeSpec,
  scopeLabel: string,
  config: TestConfig,
  cardIds: string[],
  now: string = new Date().toISOString(),
  mode: SessionMode = 'libre',
): TestSession {
  if (cardIds.length === 0) throw new Error('Impossible de créer un test sans carte.');
  if (new Set(cardIds).size !== cardIds.length) throw new Error('La sélection contient des doublons.');
  return {
    sessionId: newId(),
    mode,
    scope,
    scopeLabel,
    config,
    cardIds: cardIds.slice(),
    currentIndex: 0,
    answers: {},
    status: 'in_progress',
    createdAt: now,
    updatedAt: now,
  };
}

/** Séquence complète de la séance : premier passage puis reprises (révision). */
export function sequence(s: TestSession): string[] {
  return s.repeatIds && s.repeatIds.length > 0 ? s.cardIds.concat(s.repeatIds) : s.cardIds;
}

export function currentCardId(s: TestSession): string | undefined {
  return sequence(s)[s.currentIndex];
}

/** Vrai si la position courante est une reprise de fin de séance (« À revoir »). */
export function isRepeatPosition(s: TestSession): boolean {
  return s.currentIndex >= s.cardIds.length;
}

/** Réponse enregistrée pour la position courante (premier passage ou reprise). */
export function currentAnswer(s: TestSession): AnswerRecord | undefined {
  const id = currentCardId(s);
  if (!id) return undefined;
  return isRepeatPosition(s) ? s.repeatAnswers?.[id] : s.answers[id];
}

/** Évaluation de maîtrise portée par une réponse (undefined tant qu'un QCM juste n'a pas été noté). */
export function ratingOf(a: AnswerRecord | undefined): SelfEval | undefined {
  if (!a || a.kind === 'deferred') return undefined;
  return a.kind === 'open' ? a.selfEval : a.rating;
}

/** Ajoute une reprise de fin de séance si besoin (révision, premier passage noté « À revoir », pas déjà reprise). */
function withRepeatIfNeeded(s: TestSession, cardId: string, rec: AnswerRecord): TestSession {
  if (s.mode !== 'revision' || isRepeatPosition(s) || ratingOf(rec) !== 'again') return s;
  if (s.repeatIds?.includes(cardId)) return s;
  return { ...s, repeatIds: [...(s.repeatIds ?? []), cardId] };
}

/** Évalue une réponse de QCM (justesse objective). */
export function gradeMcq(
  card: Pick<Card, 'formatQuestion' | 'correctOptionId'>,
  selectedOptionId: string,
  now: string,
  mode: SessionMode = 'libre',
): AnswerRecord {
  if (card.formatQuestion !== 'mcq' || !card.correctOptionId) throw new Error("Cette carte n'est pas un QCM corrigeable.");
  const correct = selectedOptionId === card.correctOptionId;
  // Révision : une réponse fausse vaut automatiquement « À revoir » ; une réponse juste sera notée ensuite (rateMcq)
  if (mode === 'revision' && !correct) return { kind: 'mcq', selectedOptionId, correct, rating: 'again', answeredAt: now };
  return { kind: 'mcq', selectedOptionId, correct, answeredAt: now };
}

export function selfEvaluate(selfEval: SelfEval, now: string): AnswerRecord {
  return { kind: 'open', selfEval, answeredAt: now };
}

/** Enregistre la réponse de la position courante (une seule réponse par position : la première est conservée). */
export function recordAnswer(s: TestSession, cardId: string, rec: AnswerRecord, now: string = rec.answeredAt): TestSession {
  if (s.status !== 'in_progress') return s;
  if (currentCardId(s) !== cardId) throw new Error("La réponse ne concerne pas la carte en cours.");
  if (currentAnswer(s)) return s;
  if (s.phase === 'correction') return s; // plus de réponse pendant la phase de correction
  if (s.pausedAt) throw new Error('Le test est en pause.');
  if (s.mode === 'libre' && rec.kind === 'mcq' && rec.rating) throw new Error('Un test libre ne note pas la maîtrise des QCM.');
  if (rec.kind === 'deferred' && !isEndCorrection(s)) throw new Error('Report de l’autoévaluation réservé à la correction en fin de test.');
  const updated: TestSession = isRepeatPosition(s)
    ? { ...s, repeatAnswers: { ...(s.repeatAnswers ?? {}), [cardId]: rec }, updatedAt: now }
    : { ...s, answers: { ...s.answers, [cardId]: rec }, updatedAt: now };
  return withRepeatIfNeeded(updated, cardId, rec);
}

/**
 * Révision : note la maîtrise d'un QCM répondu JUSTE (Difficile / Correct / Facile).
 * Sans effet si la réponse est fausse (déjà « À revoir ») ou déjà notée.
 */
export function rateMcq(s: TestSession, cardId: string, rating: Exclude<SelfEval, 'again'>, now: string): TestSession {
  if (s.status !== 'in_progress' || s.mode !== 'revision') return s;
  if (currentCardId(s) !== cardId) throw new Error("La note ne concerne pas la carte en cours.");
  const a = currentAnswer(s);
  if (!a || a.kind !== 'mcq' || !a.correct || a.rating) return s;
  const rated = { ...a, rating };
  return isRepeatPosition(s)
    ? { ...s, repeatAnswers: { ...(s.repeatAnswers ?? {}), [cardId]: rated }, updatedAt: now }
    : { ...s, answers: { ...s.answers, [cardId]: rated }, updatedAt: now };
}

/** Passe à la position suivante ; termine la session après la dernière (reprises comprises). */
export function advance(s: TestSession, now: string = new Date().toISOString()): TestSession {
  if (s.status !== 'in_progress') return s;
  if (s.phase === 'correction') return s;
  const total = sequence(s).length;
  const next = s.currentIndex + 1;
  if (next >= total) {
    // Lot 3A : en correction de fin de test, la dernière question ouvre la phase de correction (séance toujours en cours)
    if (isEndCorrection(s)) return { ...s, currentIndex: total - 1, phase: 'correction', updatedAt: now };
    return { ...s, currentIndex: total - 1, status: 'finished', finishedAt: now, updatedAt: now };
  }
  return { ...s, currentIndex: next, updatedAt: now };
}

/** Termine la session immédiatement (cartes non traitées comptées comme « non traitées »). */
export function finishEarly(s: TestSession, now: string = new Date().toISOString()): TestSession {
  if (s.status !== 'in_progress') return s;
  // Lot 3B : terminer pendant une pause met fin à la pause (le temps de la pause n'est pas compté)
  if (s.pausedAt) {
    const { pausedAt: _p, ...rest } = s;
    s = rest;
  }
  // Lot 3A : en correction de fin de test, terminer les questions ouvre d'abord la phase de correction
  if (isEndCorrection(s) && s.phase !== 'correction') return { ...s, phase: 'correction', updatedAt: now };
  return { ...s, status: 'finished', finishedAt: now, updatedAt: now };
}

// ---------- Lot 3A : correction en fin de test et chronomètre ----------

/** Correction en fin de test : test libre seulement (la révision programmée corrige toujours immédiatement). */
export function isEndCorrection(s: Pick<TestSession, 'mode' | 'config'>): boolean {
  return s.mode === 'libre' && s.config.correction === 'end';
}

/** Question ouverte traitée sans autoévaluation immédiate (correction en fin de test). */
export function deferAnswer(now: string, timeMs?: number): AnswerRecord {
  return timeMs === undefined ? { kind: 'deferred', answeredAt: now } : { kind: 'deferred', answeredAt: now, timeMs };
}

/** Phase de correction : autoévaluation d'une question ouverte reportée (une seule fois). */
export function evaluateDeferred(s: TestSession, cardId: string, selfEval: SelfEval, now: string): TestSession {
  if (s.status !== 'in_progress' || s.phase !== 'correction') return s;
  const a = s.answers[cardId];
  if (!a || a.kind !== 'deferred') return s;
  const rec: AnswerRecord =
    a.timeMs === undefined ? { kind: 'open', selfEval, answeredAt: a.answeredAt } : { kind: 'open', selfEval, answeredAt: a.answeredAt, timeMs: a.timeMs };
  return { ...s, answers: { ...s.answers, [cardId]: rec }, updatedAt: now };
}

/** Fin de la phase de correction : la séance est terminée (les questions non autoévaluées le restent). */
export function finishCorrection(s: TestSession, now: string): TestSession {
  if (s.status !== 'in_progress' || s.phase !== 'correction') return s;
  return { ...s, status: 'finished', finishedAt: now, updatedAt: now };
}

/** Ajoute du temps actif (pendant les questions uniquement). */
export function addElapsed(s: TestSession, ms: number): TestSession {
  if (s.status !== 'in_progress' || s.phase === 'correction' || !(ms > 0)) return s;
  return { ...s, elapsedMs: (s.elapsedMs ?? 0) + Math.round(ms) };
}

/** Durée de la limite (ms) d'un test libre à temps limité ; null sinon. */
export function limitMsOf(s: Pick<TestSession, 'config'>): number | null {
  const t = s.config.timer;
  return t && t.mode === 'limit' && t.limitSec ? t.limitSec * 1000 : null;
}

/**
 * v0.3.0-a2 : fixe l'échéance absolue d'un test à temps limité qui n'en a pas encore :
 *  - au lancement (elapsedMs absent) : lancement + limite ;
 *  - séance créée en 0.3.0-a/a1 (décompte en temps actif) : maintenant + temps restant enregistré ; l'échéance est
 *    enregistrée avec la première transition.
 * Sans effet hors phase de questions, sans limite ou si l'échéance existe déjà.
 *
 * Préparation de la pause (lot 3B) : une pause d'entraînement pourra enregistrer `pausedAt` et, à la reprise,
 * reporter `deadlineAt` de la durée de la pause ; `remainingMs` est le seul calcul à adapter.
 */
export function withDeadline(s: TestSession, now: string): TestSession {
  const limit = limitMsOf(s);
  if (limit === null || s.deadlineAt || s.mode !== 'libre' || s.status !== 'in_progress' || s.phase === 'correction') return s;
  const left = Math.max(0, limit - (s.elapsedMs ?? 0));
  return { ...s, deadlineAt: new Date(Date.parse(now) + left).toISOString() };
}

/**
 * Temps restant (ms) en mode limite ; null sans limite.
 * Avec échéance (v0.3.0-a2) : échéance − maintenant (`nowMs`), indépendamment de l'activité de l'application.
 * Sans échéance (séances antérieures) : limite − temps actif enregistré − temps actif non enregistré (`extraMs`).
 */
export function remainingMs(s: TestSession, extraMs = 0, nowMs: number = Date.now()): number | null {
  const limit = limitMsOf(s);
  if (limit === null) return null;
  // Lot 3B : en pause, le temps restant est figé au moment de la pause
  if (s.deadlineAt) return Math.max(0, Date.parse(s.deadlineAt) - (s.pausedAt ? Date.parse(s.pausedAt) : nowMs));
  return Math.max(0, limit - (s.elapsedMs ?? 0) - extraMs);
}

// ---------- Lot 3B : pause d'un entraînement chronométré ----------

/**
 * Vrai si la séance peut être mise en pause : test libre en phase de questions, chronomètre « temps écoulé », ou
 * temps limité en mode entraînement (`timer.pausable`). Jamais en simulation d'examen ni en révision programmée.
 */
export function canPause(s: TestSession): boolean {
  if (s.mode !== 'libre' || s.status !== 'in_progress' || s.phase === 'correction' || s.pausedAt) return false;
  const t = s.config.timer;
  if (!t) return false;
  return t.mode === 'elapsed' || (t.mode === 'limit' && t.pausable === true && Boolean(s.deadlineAt));
}

/** Met la séance en pause (à enregistrer comme toute transition). */
export function pauseSession(s: TestSession, now: string): TestSession {
  if (!canPause(s)) throw new Error('Ce test ne peut pas être mis en pause.');
  return { ...s, pausedAt: now, updatedAt: now };
}

/** Reprend la séance : l'échéance d'un test limité est reportée de la durée de la pause. */
export function resumeSession(s: TestSession, now: string): TestSession {
  if (!s.pausedAt) return s;
  const { pausedAt, ...rest } = s;
  const pauseMs = Math.max(0, Date.parse(now) - Date.parse(pausedAt));
  const deadlineAt = rest.deadlineAt ? new Date(Date.parse(rest.deadlineAt) + pauseMs).toISOString() : undefined;
  return { ...rest, ...(deadlineAt ? { deadlineAt } : {}), updatedAt: now };
}

/** Limite de temps atteinte : fin des questions (correction si correction en fin de test, sinon séance terminée). */
export function timeUp(s: TestSession, now: string): TestSession {
  if (s.status !== 'in_progress' || s.phase === 'correction') return s;
  // v0.3.0-a1 : le temps enregistré est borné à la limite (la vérification a lieu au plus une seconde après)
  const limitMs = s.config.timer?.mode === 'limit' && s.config.timer.limitSec ? s.config.timer.limitSec * 1000 : null;
  const elapsedMs = limitMs !== null && s.elapsedMs !== undefined ? Math.min(s.elapsedMs, limitMs) : s.elapsedMs;
  return finishEarly({ ...s, timedOut: true, ...(elapsedMs !== undefined ? { elapsedMs } : {}) }, now);
}

export interface SessionSummary {
  total: number;
  answered: number;
  notAnswered: number;
  mcq: { answered: number; correct: number };
  open: { answered: number; byEval: Record<SelfEval, number> };
  /** QCM faux et questions ouvertes « À revoir », dans l'ordre du test */
  errorIds: string[];
  /** Lot 2 : évaluations de maîtrise du premier passage (QCM et questions ouvertes) */
  ratings: Record<SelfEval, number>;
  /** Lot 2 : reprises de fin de séance prévues / effectuées */
  repeats: { planned: number; done: number };
  /** Lot 3A : questions ouvertes traitées dont l'autoévaluation (correction en fin de test) n'a pas été faite */
  pendingSelfEval: number;
  /** Lot 3A : temps */
  timing: { elapsedMs: number; timedAnswers: number; avgMs: number | null; slowest: { cardId: string; timeMs: number }[] };
}

export function summarize(s: TestSession): SessionSummary {
  const sum: SessionSummary = {
    total: s.cardIds.length,
    answered: 0,
    notAnswered: 0,
    mcq: { answered: 0, correct: 0 },
    open: { answered: 0, byEval: { again: 0, hard: 0, good: 0, easy: 0 } },
    errorIds: [],
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
    repeats: { planned: s.repeatIds?.length ?? 0, done: Object.keys(s.repeatAnswers ?? {}).length },
    pendingSelfEval: 0,
    timing: { elapsedMs: s.elapsedMs ?? 0, timedAnswers: 0, avgMs: null, slowest: [] },
  };
  const times: { cardId: string; timeMs: number }[] = [];
  for (const id of s.cardIds) {
    const a = s.answers[id];
    if (!a) {
      sum.notAnswered++;
      continue;
    }
    sum.answered++;
    if (typeof a.timeMs === 'number') times.push({ cardId: id, timeMs: a.timeMs });
    const r = ratingOf(a);
    if (r) sum.ratings[r]++;
    if (a.kind === 'mcq') {
      sum.mcq.answered++;
      if (a.correct) sum.mcq.correct++;
      else sum.errorIds.push(id);
    } else if (a.kind === 'deferred') {
      sum.pendingSelfEval++;
    } else {
      sum.open.answered++;
      sum.open.byEval[a.selfEval]++;
      if (a.selfEval === 'again') sum.errorIds.push(id);
    }
  }
  sum.timing.timedAnswers = times.length;
  sum.timing.avgMs = times.length ? Math.round(times.reduce((t, x) => t + x.timeMs, 0) / times.length) : null;
  sum.timing.slowest = times.sort((x, y) => y.timeMs - x.timeMs).slice(0, 3);
  return sum;
}

/**
 * Sépare les cartes encore présentes dans la bibliothèque de celles supprimées depuis (v1.1, I5).
 * Sert aux relances (« Refaire les erreurs ») : l'historique de la session n'est jamais modifié.
 */
export function partitionAvailable(ids: readonly string[], existing: ReadonlySet<string>): { available: string[]; missing: string[] } {
  const available: string[] = [];
  const missing: string[] = [];
  for (const id of ids) (existing.has(id) ? available : missing).push(id);
  return { available, missing };
}

/**
 * Position affichée (v0.2.1) : « position / total » sur la séquence complète, reprises de fin de séance comprises
 * (ex. 21/23 pendant les reprises d'une révision de 20 cartes, et non 20/20).
 */
export function progressOf(s: TestSession): { position: number; total: number; repeat: boolean } {
  const total = sequence(s).length;
  return { position: Math.min(s.currentIndex + 1, total), total, repeat: isRepeatPosition(s) };
}

// ---------- Lot 3A : bilan approfondi ----------

export interface BreakdownRow {
  key: string;
  label: string;
  answered: number;
  mcqAnswered: number;
  mcqCorrect: number;
  /** Questions ouvertes autoévaluées « À revoir » */
  openAgain: number;
  openAnswered: number;
  /** Part d'erreurs parmi les réponses évaluées (QCM faux + « À revoir »), de 0 à 1 */
  errorRate: number;
}

/**
 * Résultats par regroupement (matière, thème, difficulté…) pour le bilan approfondi et les points faibles du test.
 * `keyOf` renvoie [clé, libellé] du groupe d'une carte, ou null pour l'ignorer.
 */
export function breakdown(
  s: TestSession,
  metaById: ReadonlyMap<string, CardMeta>,
  keyOf: (m: CardMeta) => [string, string] | null,
): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>();
  for (const id of s.cardIds) {
    const a = s.answers[id];
    const m = metaById.get(id);
    if (!a || !m) continue;
    const k = keyOf(m);
    if (!k) continue;
    const row = rows.get(k[0]) ?? { key: k[0], label: k[1], answered: 0, mcqAnswered: 0, mcqCorrect: 0, openAgain: 0, openAnswered: 0, errorRate: 0 };
    row.answered++;
    if (a.kind === 'mcq') {
      row.mcqAnswered++;
      if (a.correct) row.mcqCorrect++;
    } else if (a.kind === 'open') {
      row.openAnswered++;
      if (a.selfEval === 'again') row.openAgain++;
    }
    rows.set(k[0], row);
  }
  for (const r of rows.values()) {
    const evaluated = r.mcqAnswered + r.openAnswered;
    r.errorRate = evaluated ? (r.mcqAnswered - r.mcqCorrect + r.openAgain) / evaluated : 0;
  }
  return [...rows.values()].sort((a, b) => b.errorRate - a.errorRate || b.answered - a.answered || a.label.localeCompare(b.label, 'fr'));
}
