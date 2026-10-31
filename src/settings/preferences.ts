// Lot 3B : préférences d'affichage et de test (§7.4), enregistrées dans IndexedDB (magasin « settings »).
import type { CorrectionMode } from '../domain/types';

export type ThemePref = 'system' | 'light' | 'dark';
export type TextSizePref = 'normal' | 'large';

export interface Appearance {
  theme: ThemePref;
  text: TextSizePref;
}

export const APPEARANCE_KEY = 'appearance';
export const DEFAULT_APPEARANCE: Appearance = { theme: 'system', text: 'normal' };

/** Lecture tolérante : une valeur absente ou inattendue redonne le réglage par défaut. */
export function parseAppearance(v: unknown): Appearance {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof Appearance, unknown>>;
  return {
    theme: o.theme === 'light' || o.theme === 'dark' ? o.theme : 'system',
    text: o.text === 'large' ? 'large' : 'normal',
  };
}

/**
 * Lot 4 : copie locale du réglage d'affichage, lue AVANT l'ouverture de la base pour éviter un affichage bref du
 * thème du système au démarrage. La référence reste le réglage enregistré dans IndexedDB (copie resynchronisée à
 * chaque ouverture) ; aucune donnée de la bibliothèque n'est placée dans ce stockage.
 */
const LOCAL_KEY = 'flashcards-ena:appearance';

export function cacheAppearance(a: Appearance): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(a));
  } catch {
    // stockage local indisponible : sans conséquence (le réglage est appliqué à l'ouverture de la base)
  }
}

export function cachedAppearance(): Appearance | null {
  try {
    const v = localStorage.getItem(LOCAL_KEY);
    return v ? parseAppearance(JSON.parse(v)) : null;
  } catch {
    return null;
  }
}

/** Applique le thème et la taille du texte à la page (attributs lus par la feuille de style). */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  if (a.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = a.theme;
  if (a.text === 'large') root.dataset.text = 'large';
  else delete root.dataset.text;
}

/** Correction proposée par défaut à la création d'un test libre ; 'last' = derniers réglages utilisés (lot 3A). */
export type CorrectionPref = 'last' | CorrectionMode;
export const CORRECTION_PREF_KEY = 'defaultCorrection';

export function parseCorrectionPref(v: unknown): CorrectionPref {
  return v === 'immediate' || v === 'end' ? v : 'last';
}
