// Composition d'une séance « Réviser aujourd'hui ». Fonctions pures, testées.
//  - Cartes dues : toutes celles du périmètre dont l'échéance ≤ aujourd'hui (aucun plafond).
//  - Nouvelles cartes : plafond GLOBAL par jour (toutes matières confondues) ; on retire celles déjà
//    introduites aujourd'hui, dans n'importe quel périmètre (décompte fondé sur l'historique, voir introducedFromLog).
//  - Équité entre matières : dues et nouvelles sont alternées matière par matière (tourniquet), pour qu'une séance
//    multimatière ne repousse jamais systématiquement une matière en fin de file.
import type { CardMeta } from '../domain/types';
import { isDue, type ReviewLogEntry, type ReviewState } from './schedule';

/**
 * Quota quotidien (v0.2.1) — règle retenue :
 * une carte « consomme » une place du quota du jour lorsqu'elle reçoit sa PREMIÈRE évaluation de la journée
 * en révision programmée ALORS QU'ELLE ÉTAIT NOUVELLE (aucun état de mémorisation à ce moment-là).
 * Le décompte s'appuie sur l'HISTORIQUE (reviewLog), qui n'est jamais effacé : réinitialiser ou supprimer une carte
 * déjà étudiée aujourd'hui ne libère donc aucune place. Une même carte ne compte qu'une fois par jour.
 * Les reprises de fin de séance et les révisions de cartes déjà connues ne comptent pas.
 */
export function introducedFromLog(entries: Iterable<Pick<ReviewLogEntry, 'cardId' | 'day' | 'repeat' | 'previousDueDay' | 'mode'>>, today: string): number {
  const ids = new Set<string>();
  // v1.2 : une carte introduite par un test libre ne consomme pas le quota de la révision programmée
  for (const e of entries) if (e.day === today && !e.repeat && e.previousDueDay === undefined && e.mode !== 'libre') ids.add(e.cardId);
  return ids.size;
}

export function newRemainingToday(introducedToday: number, newPerDay: number): number {
  return Math.max(0, Math.floor(newPerDay) - introducedToday);
}

/**
 * Alterne les éléments par matière : 1re de la matière A, 1re de B, 1re de C, 2e de A…
 * L'ordre interne de chaque matière et l'ordre de première apparition des matières sont conservés.
 */
export function roundRobinByMatiere<T extends Pick<CardMeta, 'matiere'>>(items: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const g = groups.get(it.matiere);
    if (g) g.push(it);
    else groups.set(it.matiere, [it]);
  }
  const lists = [...groups.values()];
  const out: T[] = [];
  for (let i = 0; out.length < items.length; i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]!);
  }
  return out;
}

export interface ReviewPlan {
  /** Cartes dues, par ancienneté d'échéance puis ordre de la bibliothèque, alternées par matière */
  due: string[];
  /** Nouvelles cartes retenues (dans la limite du plafond restant), alternées par matière */
  fresh: string[];
  /** Nouvelles cartes du périmètre non retenues à cause du plafond */
  freshAvailable: number;
  /** File de la séance : dues puis nouvelles */
  queue: string[];
  /** Prochaine échéance future du périmètre (pour un message « rien à réviser ») */
  nextDueDay?: string;
}

export function planReview(
  scoped: readonly CardMeta[],
  states: ReadonlyMap<string, ReviewState>,
  today: string,
  newRemaining: number,
): ReviewPlan {
  const dueMetas: { m: CardMeta; s: ReviewState; i: number }[] = [];
  const freshMetas: CardMeta[] = [];
  let nextDueDay: string | undefined;
  const seen = new Set<string>();
  scoped.forEach((m, i) => {
    if (seen.has(m.cardId)) return;
    seen.add(m.cardId);
    const s = states.get(m.cardId);
    if (!s) freshMetas.push(m);
    else if (isDue(s, today)) dueMetas.push({ m, s, i });
    else if (!nextDueDay || s.dueDay < nextDueDay) nextDueDay = s.dueDay;
  });
  dueMetas.sort((a, b) => (a.s.dueDay < b.s.dueDay ? -1 : a.s.dueDay > b.s.dueDay ? 1 : a.i - b.i));
  const due = roundRobinByMatiere(dueMetas.map((d) => d.m)).map((m) => m.cardId);
  // Le plafond est appliqué APRÈS l'alternance : chaque matière reçoit sa part de nouvelles cartes
  const fresh = roundRobinByMatiere(freshMetas)
    .slice(0, Math.max(0, newRemaining))
    .map((m) => m.cardId);
  return { due, fresh, freshAvailable: freshMetas.length, queue: [...due, ...fresh], nextDueDay };
}

/** Deux files identiques (mêmes cartes, même ordre) ? Sert à revalider une séance au moment du lancement. */
export function sameQueue(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * v1.1.0 : aperçu d'une séance. Répartit les cartes dues entre « en retard » (échéance antérieure à aujourd'hui)
 * et « à revoir aujourd'hui » (échéance aujourd'hui). Ne change ni la file ni son ordre.
 */
export function splitDue(due: readonly string[], states: ReadonlyMap<string, Pick<ReviewState, 'dueDay'>>, today: string): { overdue: number; today: number } {
  let overdue = 0;
  for (const id of due) {
    const s = states.get(id);
    if (s && s.dueDay < today) overdue++;
  }
  return { overdue, today: due.length - overdue };
}
