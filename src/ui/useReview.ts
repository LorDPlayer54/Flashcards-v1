// Lecture des états de mémorisation et du quota de nouvelles cartes pour les écrans (lot 2).
// v0.2.1 : la date de référence suit le jour local (changement de jour détecté, voir review/dayWatch.ts)
// et le quota du jour est compté d'après l'historique (voir review/queue.ts, introducedFromLog).
import { useCallback, useEffect, useState } from 'react';
import type { CardMeta } from '../domain/types';
import { watchLocalDay } from '../review/dayWatch';
import { newRemainingToday } from '../review/queue';
import { localDay, type ReviewState } from '../review/schedule';
import { countIntroducedOn, getNewPerDay, loadReviewStates } from '../storage/repo';
import { useApp } from './AppContext';
import { errorMessage } from './components/common';

export interface ReviewData {
  states: Map<string, ReviewState>;
  newPerDay: number;
  /** Cartes déjà introduites aujourd'hui (historique) */
  introducedToday: number;
  /** Places restantes dans le quota de nouvelles cartes du jour */
  newRemaining: number;
  /** Date locale utilisée pour les calculs d'échéance */
  today: string;
}

/** Jour local courant, mis à jour au passage de minuit et au retour au premier plan. */
export function useLocalDay(): string {
  const [day, setDay] = useState(() => localDay());
  useEffect(
    () =>
      watchLocalDay(localDay(), setDay, {
        now: () => new Date(),
        targets: [document, window],
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (h) => window.clearTimeout(h as number),
      }),
    [],
  );
  return day;
}

export function useReviewData(): {
  data: ReviewData | null;
  error: string | null;
  reload: () => void;
  /** v0.3.0-a2 : bibliothèque (projection `metas`) pour laquelle la dernière lecture s'est terminée, avec ou sans erreur */
  loadedFor: readonly CardMeta[] | null;
} {
  const { db, metas } = useApp();
  const today = useLocalDay();
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadedFor, setLoadedFor] = useState<readonly CardMeta[] | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    Promise.all([loadReviewStates(db), getNewPerDay(db), countIntroducedOn(db, today)])
      .then(([states, newPerDay, introducedToday]) => {
        if (!alive) return;
        setData({ states, newPerDay, introducedToday, newRemaining: newRemainingToday(introducedToday, newPerDay), today });
        setLoadedFor(metas);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(errorMessage(e));
        setLoadedFor(metas);
      });
    return () => {
      alive = false;
    };
    // metas : relecture après un import ou une suppression ; today : changement de jour
  }, [db, metas, today, attempt]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  // Après un changement de jour, les données de la veille ne sont jamais affichées pendant le rechargement
  return { data: data && data.today === today ? data : null, error, reload, loadedFor };
}

/** Date AAAA-MM-JJ lisible en français, ex. « lundi 2 novembre 2026 ». */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
