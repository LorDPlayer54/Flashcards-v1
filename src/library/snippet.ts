// Extraits contextuels et surlignage des termes recherchés (Recherche V1).
// Calcul en texte brut : le rendu se fait par segments React, sans HTML injecté.
import type { Card } from '../domain/types';
import { searchable } from '../domain/text';

export interface Segment {
  text: string;
  hit: boolean;
}

/** Forme normalisée caractère par caractère, avec la position d'origine de chaque caractère normalisé. */
function folded(text: string): { norm: string; pos: number[] } {
  let norm = '';
  const pos: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = searchable(text[i]!);
    for (let k = 0; k < f.length; k++) {
      norm += f[k];
      pos.push(i);
    }
  }
  return { norm, pos };
}

/** Intervalles [début, fin[ (positions d'origine) de toutes les occurrences des termes, fusionnés. */
function ranges(text: string, terms: readonly string[]): Array<[number, number]> {
  const { norm, pos } = folded(text);
  const out: Array<[number, number]> = [];
  for (const t of terms) {
    if (!t) continue;
    let from = 0;
    for (let at = norm.indexOf(t, from); at >= 0; at = norm.indexOf(t, from)) {
      out.push([pos[at]!, pos[at + t.length - 1]! + 1]);
      from = at + t.length;
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

export function highlight(text: string, terms: readonly string[]): Segment[] {
  const rs = ranges(text, terms);
  if (rs.length === 0) return [{ text, hit: false }];
  const out: Segment[] = [];
  let i = 0;
  for (const [a, b] of rs) {
    if (a > i) out.push({ text: text.slice(i, a), hit: false });
    out.push({ text: text.slice(a, b), hit: true });
    i = b;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out;
}

const FIELDS: Array<{ key: 'reponse' | 'explication' | 'astucePiege' | 'notion'; label: string }> = [
  { key: 'reponse', label: 'Réponse' },
  { key: 'explication', label: 'Explication' },
  { key: 'astucePiege', label: 'Astuce' },
  { key: 'notion', label: 'Notion' },
];

export interface Snippet {
  label: string;
  segments: Segment[];
}

/**
 * Extrait du premier champ hors question contenant un terme absent de la question.
 * Null si tous les termes figurent déjà dans la question (le surlignage de la question suffit).
 */
export function snippetFor(card: Card, terms: readonly string[], width = 110): Snippet | null {
  if (terms.length === 0) return null;
  const q = searchable(card.question + ' ' + card.rawQuestion);
  const missing = terms.filter((t) => !q.includes(t));
  if (missing.length === 0) return null;
  for (const f of FIELDS) {
    const raw = (card[f.key] ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    const rs = ranges(raw, missing);
    if (rs.length === 0) continue;
    const [a, b] = rs[0]!;
    let start = Math.max(0, a - Math.floor((width - (b - a)) / 2));
    let end = Math.min(raw.length, start + width);
    start = Math.max(0, end - width);
    if (start > 0) {
      const sp = raw.indexOf(' ', start);
      if (sp >= 0 && sp < a) start = sp + 1;
    }
    if (end < raw.length) {
      const sp = raw.lastIndexOf(' ', end);
      if (sp > b) end = sp;
    }
    const text = (start > 0 ? '… ' : '') + raw.slice(start, end) + (end < raw.length ? ' …' : '');
    return { label: f.label, segments: highlight(text, terms) };
  }
  return null;
}
