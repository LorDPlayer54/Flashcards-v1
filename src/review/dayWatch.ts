// Détection du changement de jour local (v0.2.1, Important 2).
// Un téléphone peut laisser l'application ouverte pendant la nuit : les échéances et le quota affichés doivent
// être recalculés dès que la date change. Mécanisme sans rafraîchissement continu :
//  - un minuteur unique programmé juste après le prochain minuit local ;
//  - une vérification à chaque retour au premier plan (visibilitychange, focus, pageshow), car un téléphone
//    en veille peut retarder ou suspendre les minuteurs.
import { localDay } from './schedule';

/** Délai jusqu'à 00:00:01 le lendemain (heure locale). */
export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

export interface DayWatchEnv {
  now: () => Date;
  /** Cibles écoutées : en pratique `document` (visibilitychange) et `window` (focus, pageshow) */
  targets: EventTarget[];
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

const EVENTS = ['visibilitychange', 'focus', 'pageshow'];

/**
 * Appelle `onChange(nouveauJour)` chaque fois que la date locale change par rapport à `initialDay`.
 * Renvoie une fonction d'arrêt (retire les écouteurs et le minuteur).
 */
export function watchLocalDay(initialDay: string, onChange: (day: string) => void, env: DayWatchEnv): () => void {
  let current = initialDay;
  let timer: unknown = null;
  let stopped = false;

  const schedule = () => {
    if (timer !== null) env.clearTimer(timer);
    timer = env.setTimer(check, msUntilNextDay(env.now()));
  };
  function check() {
    if (stopped) return;
    const d = localDay(env.now());
    if (d !== current) {
      current = d;
      onChange(d);
    }
    schedule();
  }

  for (const t of env.targets) for (const e of EVENTS) t.addEventListener(e, check);
  schedule();
  // Le jour a pu changer entre le calcul de initialDay et l'installation
  check();

  return () => {
    stopped = true;
    if (timer !== null) env.clearTimer(timer);
    for (const t of env.targets) for (const e of EVENTS) t.removeEventListener(e, check);
  };
}
