// Refonte UX/UI (Accueil V5) : régularité de la semaine et série. Fonctions pures, testées.
// Règle validée : un jour compte comme « révisé » dès qu'au moins une évaluation de révision programmée est
// enregistrée ce jour-là (historique reviewLog, jour local). Les tests libres n'écrivent pas dans cet historique.
// La série part d'aujourd'hui si le jour est révisé, sinon d'hier. Aucune donnée nouvelle n'est stockée.
import { addDays } from '../review/schedule';

export type DayState = 'done' | 'none' | 'future';

export interface WeekDay {
  day: string;
  /** Initiale du jour (L, M, M, J, V, S, D) */
  letter: string;
  date: number;
  state: DayState;
  isToday: boolean;
}

const LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

function weekdayIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // lundi = 0
}

/** Semaine locale courante, du lundi au dimanche. */
export function weekOf(today: string, reviewed: ReadonlySet<string>): WeekDay[] {
  const monday = addDays(today, -weekdayIndex(today));
  return LETTERS.map((letter, i) => {
    const day = addDays(monday, i);
    const state: DayState = day > today ? 'future' : reviewed.has(day) ? 'done' : 'none';
    return { day, letter, date: Number(day.slice(8)), state, isToday: day === today };
  });
}

export function dayLabel(d: WeekDay): string {
  const name = LONG[weekdayIndex(d.day)]!;
  const what = d.state === 'done' ? 'révisé' : d.state === 'future' ? 'à venir' : 'sans révision';
  return `${name} ${d.date}${d.isToday ? " (aujourd'hui)" : ''} : ${what}`;
}

/** Nombre de jours révisés consécutifs, en partant d'aujourd'hui s'il est révisé, sinon d'hier. */
export function streakOf(today: string, reviewed: ReadonlySet<string>): number {
  let day = reviewed.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (reviewed.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}
