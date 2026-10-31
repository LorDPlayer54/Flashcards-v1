// Détection des QCM dont les options A) à E) sont intégrées dans le texte de la question.
// Règle de sécurité : en cas de doute, on ne produit PAS de QCM (la carte reste une question ouverte).

import type { McqOption } from '../domain/types';
import { comparable } from '../domain/text';

const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

interface Marker {
  letter: string;
  /** Position du début du marqueur « A) » */
  start: number;
  /** Position juste après le marqueur et ses espaces */
  end: number;
}

export interface EmbeddedMcq {
  stem: string;
  options: McqOption[];
}

/**
 * Repère les options « A) … B) … » dans un énoncé.
 * Un marqueur est une lettre A–E suivie de « ) », en début de texte ou précédée d'un espace / retour ligne.
 * On retient la suite strictement consécutive de marqueurs (A, B, C…) qui se termine sur le dernier marqueur du texte.
 * Renvoie null si moins de 2 options, énoncé vide ou option vide.
 */
export function parseEmbeddedOptions(text: string): EmbeddedMcq | null {
  const re = /(^|[\s])([A-E])\)[ \t ]*/g;
  const markers: Marker[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + (m[1] ?? '').length;
    markers.push({ letter: m[2] as string, start, end: re.lastIndex });
  }

  let best: Marker[] | null = null;
  for (let i = 0; i < markers.length; i++) {
    if (markers[i]!.letter !== 'A') continue;
    const run: Marker[] = [markers[i]!];
    let expected = 1;
    // Les marqueurs doivent se suivre sans marqueur étranger intercalé (A, B, C… strictement)
    for (let j = i + 1; j < markers.length && expected < LETTERS.length; j++) {
      if (markers[j]!.letter !== LETTERS[expected]) break;
      run.push(markers[j]!);
      expected++;
    }
    // La série doit se terminer sur le dernier marqueur du texte (aucun « X) » parasite après)
    const endsOnLastMarker = i + run.length - 1 === markers.length - 1;
    if (run.length >= 2 && endsOnLastMarker) best = run;
  }
  if (!best) return null;

  const stem = text.slice(0, best[0]!.start).trim();
  if (!stem) return null;

  const options: McqOption[] = [];
  for (let k = 0; k < best.length; k++) {
    const cur = best[k]!;
    const next = best[k + 1];
    const optText = text.slice(cur.end, next ? next.start : text.length).replace(/\s+/g, ' ').trim();
    if (!optText) return null;
    options.push({ id: cur.letter, text: optText });
  }
  return { stem, options };
}

export type AnswerResolution =
  | { status: 'ok'; correctOptionId: string }
  | { status: 'ambiguous'; reason: string };

/**
 * Détermine la bonne option à partir de la colonne Réponse.
 * Formes acceptées : « B) 169 », « B », « B. 169 », ou le texte exact d'une seule option.
 * Si la lettre et le texte ne concordent pas, ou si rien ne correspond, renvoie « ambiguous ».
 */
export function resolveAnswer(answer: string, options: McqOption[]): AnswerResolution {
  const a = answer.trim();
  if (!a) return { status: 'ambiguous', reason: 'Réponse vide' };

  const letterMatch = /^\(?([A-E])(?:\s*\)|\s*\.|\s*:|\s+-|\s*$)\s*([\s\S]*)$/.exec(a);
  if (letterMatch) {
    const letter = letterMatch[1] as string;
    const rest = (letterMatch[2] ?? '').trim();
    const opt = options.find((o) => o.id === letter);
    if (!opt) return { status: 'ambiguous', reason: `La réponse indique ${letter}) mais cette option n'existe pas` };
    if (rest && comparable(rest) !== comparable(opt.text)) {
      return {
        status: 'ambiguous',
        reason: `La réponse « ${a} » ne concorde pas avec le texte de l'option ${letter}) « ${opt.text} »`,
      };
    }
    return { status: 'ok', correctOptionId: letter };
  }

  const target = comparable(a);
  const matches = options.filter((o) => comparable(o.text) === target);
  if (matches.length === 1) return { status: 'ok', correctOptionId: matches[0]!.id };
  if (matches.length > 1) return { status: 'ambiguous', reason: 'Plusieurs options correspondent au texte de la réponse' };
  return { status: 'ambiguous', reason: 'La réponse ne désigne aucune option identifiable' };
}

/** Vérifie la cohérence d'un QCM construit à partir de colonnes d'options séparées. */
export function buildOptionsFromColumns(values: (string | undefined)[]): McqOption[] | null {
  const options: McqOption[] = [];
  let ended = false;
  for (let i = 0; i < values.length && i < LETTERS.length; i++) {
    const v = values[i]?.replace(/\s+/g, ' ').trim();
    if (!v) {
      ended = true;
      continue;
    }
    if (ended) return null; // trou dans les options (ex. A, B, D)
    options.push({ id: LETTERS[i] as string, text: v });
  }
  return options.length >= 2 ? options : null;
}

/** Paires de propositions identiques après normalisation (casse, accents, espaces, ponctuation finale). */
export function findDuplicateOptions(options: McqOption[]): [string, string][] {
  const pairs: [string, string][] = [];
  const firstByText = new Map<string, string>();
  for (const o of options) {
    const key = comparable(o.text);
    const first = firstByText.get(key);
    if (first) pairs.push([first, o.id]);
    else firstByText.set(key, o.id);
  }
  return pairs;
}

/**
 * Vrai si le texte contient au moins deux marqueurs « X) » dont un « A) » :
 * il ressemble à un QCM, même si ses propositions n'ont pas pu être analysées de façon fiable.
 */
export function looksLikeEmbeddedMcq(text: string): boolean {
  const letters = [...text.matchAll(/(?:^|\s)([A-E])\)/g)].map((m) => m[1]);
  return letters.length >= 2 && letters.includes('A');
}

/** Vrai si la réponse commence par une lettre d'option, ex. « B) … ». */
export function answerLooksLikeOptionLetter(answer: string): boolean {
  return /^\(?[A-E]\s*\)/.test(answer.trim());
}
