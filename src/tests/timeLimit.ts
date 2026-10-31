// Chronomètre d'un test : temps enregistré, limite de temps, sortie.
//
// v0.3.0-a1 (B1) : « limite atteinte » (constat) et « fin enregistrée » (effet) sont distincts.
//  - Le constat est refait à chaque vérification, à partir de l'état le plus récent ; il ne peut pas être
//    « consommé » sans écriture réussie.
//  - Si une écriture est en cours, la fin attend qu'elle se termine (l'écran revérifie aussitôt après).
//  - Si une transition a échoué (ex. réponse validée juste avant la limite), la fin la remplace en la conservant.
//  - Si l'écriture de la fin échoue, elle reste en attente : pas de nouvel essai automatique en boucle,
//    l'utilisatrice dispose du bouton « Réessayer » ; aucune réponse n'est acceptée entre-temps.
//  - Toute action de l'utilisatrice vérifie d'abord la limite.
//
// v0.3.0-a2 :
//  - Temps limité : échéance ABSOLUE enregistrée au lancement (`deadlineAt`) ; le temps restant se calcule sur
//    l'heure réelle et continue application en arrière-plan, téléphone verrouillé ou navigateur fermé.
//    Une séance rouverte après son échéance se termine (ou passe en correction) sans accepter de réponse.
//  - Chronomètre « temps écoulé » : inchangé, temps actif (application affichée).
//  - Sortie (`prepareExit`) : la limite est vérifiée avant tout enregistrement ou toute navigation.
//
// Pause (prévue au lot 3B, non développée ici) : tout le calcul du temps passe par `TimeSource`, `remainingMs`
// (session.ts) et `stampTime`. Une pause d'entraînement s'y ajoutera en suspendant l'horloge active (temps écoulé)
// ou en reportant l'échéance de la durée de la pause (temps limité) ; une simulation d'examen n'y aura pas droit.
import type { TestSession } from '../domain/types';
import { addElapsed, limitMsOf, remainingMs, timeUp } from './session';
import type { ApplyOutcome, SessionController } from './sessionController';

/**
 * Sources de temps de l'écran : heure réelle (`now`, ms) et temps ACTIF non encore confié à la séance
 * (lecture seule `peek`, prélèvement `take`), utilisé par le chronomètre « temps écoulé ».
 */
export interface TimeSource {
  now(): number;
  peek(): number;
  take(): number;
}

/** Vrai si la séance est encore dans sa phase de questions. */
export function inQuestions(s: TestSession): boolean {
  return s.status === 'in_progress' && s.phase !== 'correction';
}

/** Temps restant (ms) d'une séance à temps limité ; null sans limite. */
export function timeLeft(s: TestSession, src: Pick<TimeSource, 'now' | 'peek'>): number | null {
  return remainingMs(s, src.peek(), src.now());
}

/** Vrai si la limite de temps est atteinte pour une séance encore dans sa phase de questions. */
export function limitReached(s: TestSession, src: Pick<TimeSource, 'now' | 'peek'>): boolean {
  if (!inQuestions(s)) return false;
  const left = timeLeft(s, src);
  return left !== null && left <= 0;
}

/** Temps des questions à cet instant (ms) : affichage et temps de réponse. */
export function elapsedAt(s: TestSession, src: Pick<TimeSource, 'now' | 'peek'>): number {
  const limit = limitMsOf(s);
  if (s.deadlineAt && limit !== null) return Math.min(limit, Math.max(0, limit - (remainingMs(s, 0, src.now()) ?? 0)));
  return (s.elapsedMs ?? 0) + src.peek();
}

/**
 * Confie le temps écoulé à la séance, dans l'écriture de la transition :
 * temps limité → temps réel depuis le lancement (déduit de l'échéance) ; temps écoulé → temps actif prélevé
 * (+ `carriedMs`, temps d'une transition abandonnée) ; sans chronomètre → rien (l'horloge active est arrêtée).
 */
export function stampTime(s: TestSession, src: TimeSource, carriedMs = 0): TestSession {
  if (!inQuestions(s)) return s;
  if (s.deadlineAt && limitMsOf(s) !== null) {
    src.take(); // l'horloge active n'est pas utilisée en temps limité
    return { ...s, elapsedMs: Math.round(elapsedAt(s, src)) };
  }
  return addElapsed(s, src.take() + carriedMs);
}

/** Fin pour limite atteinte, transition en échec non comprise. */
export function isTimeUpTransition(s: TestSession | null): boolean {
  return Boolean(s && s.timedOut && !inQuestions(s));
}

const iso = (src: Pick<TimeSource, 'now'>) => new Date(src.now()).toISOString();

export type LimitOutcome =
  /** Limite non atteinte (ou pas de limite, ou séance déjà hors questions) : rien à faire */
  | { status: 'none' }
  /** Écriture en cours : la fin sera tentée dès qu'elle sera terminée */
  | { status: 'waiting' }
  /** La fin a déjà échoué : elle attend un nouvel essai explicite (bouton « Réessayer ») */
  | { status: 'awaiting-retry' }
  | ApplyOutcome;

/**
 * Vérifie la limite et, si elle est atteinte, enregistre la fin du test via le contrôleur.
 * Idempotent : appelé chaque seconde, à l'ouverture, après chaque écriture et avant toute sortie ;
 * une seule transition de fin est enregistrée.
 */
export async function enforceTimeLimit(ctl: SessionController, src: TimeSource): Promise<LimitOutcome> {
  if (ctl.busy) return limitReached(ctl.latest, src) ? { status: 'waiting' } : { status: 'none' };
  const failed = ctl.pending;
  if (isTimeUpTransition(failed)) return { status: 'awaiting-retry' };
  if (!limitReached(failed ?? ctl.current, src)) return { status: 'none' };
  return ctl.supersede((b) => timeUp(stampTime(b, src), iso(src)));
}

export type UserOutcome = ApplyOutcome | { status: 'expired'; outcome: ApplyOutcome };

/**
 * Applique une action de l'utilisatrice (réponse, question suivante, fin anticipée…) en vérifiant d'abord la limite.
 * Si la limite est atteinte, l'action n'est pas enregistrée : la fin du test l'est à sa place.
 */
export async function applyUserTransition(
  ctl: SessionController,
  src: TimeSource,
  build: (confirmed: TestSession) => TestSession,
): Promise<UserOutcome> {
  if (ctl.busy) return { status: 'busy' };
  if (ctl.pending) return { status: 'blocked' };
  if (limitReached(ctl.current, src)) {
    const o = await enforceTimeLimit(ctl, src);
    return { status: 'expired', outcome: o.status === 'saved' || o.status === 'failed' ? o : { status: 'busy' } };
  }
  return ctl.apply(build(stampTime(ctl.current, src)));
}

export type ExitOutcome =
  /** La séance peut être quittée : elle reste « en cours » et sera reprise depuis l'accueil */
  | { status: 'leave' }
  /** Limite atteinte : la fin du test vient d'être enregistrée (bilan ou correction à afficher) */
  | { status: 'ended'; session: TestSession }
  /** Limite atteinte mais la fin n'a pas pu être enregistrée (maintenant ou auparavant) : rien n'est enregistré « en cours » */
  | { status: 'end-failed'; error: string | null; stale: boolean }
  /** Limite non atteinte : l'enregistrement du temps a échoué */
  | { status: 'save-failed'; error: string; stale: boolean }
  | { status: 'busy' };

/**
 * v0.3.0-a2 : sortie de la séance (« Quitter »). La limite est vérifiée AVANT tout enregistrement :
 *  - atteinte → la fin du test est enregistrée (jamais un état « en cours ») ;
 *  - non atteinte → le temps est enregistré (chronomètre actif) ; une transition en échec est abandonnée,
 *    son temps actif conservé ;
 *  - sans chronomètre → rien à enregistrer.
 */
export async function prepareExit(ctl: SessionController, src: TimeSource): Promise<ExitOutcome> {
  if (ctl.busy) return { status: 'busy' };
  const lim = await enforceTimeLimit(ctl, src);
  if (lim.status === 'saved') return { status: 'ended', session: lim.session };
  if (lim.status === 'failed') return { status: 'end-failed', error: lim.error, stale: lim.stale };
  if (lim.status === 'awaiting-retry') return { status: 'end-failed', error: null, stale: false };
  if (lim.status !== 'none') return { status: 'busy' };

  const s = ctl.current;
  const timed = (s.config.timer?.mode ?? 'off') !== 'off';
  const failed = ctl.pending;
  ctl.discardPending();
  if (!timed || !inQuestions(s)) return { status: 'leave' };
  const carried = failed ? Math.max(0, (failed.elapsedMs ?? 0) - (s.elapsedMs ?? 0)) : 0;
  const res = await ctl.apply(stampTime(s, src, carried));
  if (res.status === 'saved') return { status: 'leave' };
  if (res.status === 'failed') return { status: 'save-failed', error: res.error, stale: res.stale };
  return { status: 'busy' };
}
