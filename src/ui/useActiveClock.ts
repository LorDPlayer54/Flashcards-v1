// Lot 3A : mesure du temps ACTIF d'un test (pages visible uniquement).
// Le temps passé application en arrière-plan ou téléphone verrouillé n'est pas compté.
import { useCallback, useEffect, useMemo, useRef } from 'react';

export function useActiveClock(active: boolean): { peek: () => number; take: () => number } {
  const since = useRef<number | null>(null);
  const accum = useRef(0);

  useEffect(() => {
    const now = () => performance.now();
    const visible = () => document.visibilityState === 'visible';
    if (active && visible()) since.current = now();
    const onVisibility = () => {
      if (!active) return;
      if (visible()) {
        if (since.current === null) since.current = now();
      } else if (since.current !== null) {
        accum.current += now() - since.current;
        since.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (since.current !== null) {
        accum.current += now() - since.current;
        since.current = null;
      }
    };
  }, [active]);

  /** Temps actif non encore enregistré (ms) */
  const peek = useCallback(() => accum.current + (since.current !== null ? performance.now() - since.current : 0), []);
  /** Renvoie le temps actif non enregistré et remet le compteur à zéro (il est alors confié à la séance) */
  const take = useCallback(() => {
    const v = accum.current + (since.current !== null ? performance.now() - since.current : 0);
    accum.current = 0;
    if (since.current !== null) since.current = performance.now();
    return v;
  }, []);
  return useMemo(() => ({ peek, take }), [peek, take]);
}
