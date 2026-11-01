// Lot 3B : préférences d'affichage et de test (§7.4), enregistrées dans IndexedDB (magasin « settings »).
import type { CorrectionMode } from '../domain/types';
import type { DB } from '../storage/db';
import { getSetting, setSetting } from '../storage/repo';

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

/** Couleur de la barre du navigateur, identique au fond de chaque palette (styles.css, --bg). */
export const THEME_COLORS = { light: '#f8f7f3', dark: '#171f1c' } as const;

/**
 * v1.2 : la barre du navigateur suit le thème EFFECTIF. En mode automatique, chaque balise garde sa condition
 * (prefers-color-scheme) ; en mode forcé, les deux balises prennent la couleur du thème choisi.
 */
function applyThemeColor(theme: ThemePref, doc: Document): void {
  doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const scheme = (m.media ?? '').includes('dark') ? 'dark' : 'light';
    m.content = THEME_COLORS[theme === 'system' ? scheme : theme];
  });
}

/** Applique le thème et la taille du texte à la page (attributs lus par la feuille de style). */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  if (a.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = a.theme;
  if (a.text === 'large') root.dataset.text = 'large';
  else delete root.dataset.text;
  if (root.ownerDocument) applyThemeColor(a.theme, root.ownerDocument);
}

/**
 * Valeur brute historique de la préférence de correction (lot 3A/3B). 'last' n'est plus proposé depuis le switch V3 :
 * il n'est lu que pour la migration.
 */
export type CorrectionPref = 'last' | CorrectionMode;
export const CORRECTION_PREF_KEY = 'defaultCorrection';
export const LAST_TEST_CONFIG_KEY = 'lastTestConfig';

export function parseCorrectionPref(v: unknown): CorrectionPref {
  return v === 'immediate' || v === 'end' ? v : 'last';
}

/**
 * Switch V3 : préférence explicite à deux états.
 * immediate/end conservés ; ancien 'last' converti depuis la correction du dernier test si valide, sinon immediate ;
 * absence de préférence : immediate (indépendant du dernier test).
 */
export function resolveCorrectionPref(raw: unknown, lastCorrection: unknown): { mode: CorrectionMode; migrate: boolean } {
  if (raw === 'immediate' || raw === 'end') return { mode: raw, migrate: false };
  if (raw === 'last') return { mode: lastCorrection === 'end' || lastCorrection === 'immediate' ? lastCorrection : 'immediate', migrate: true };
  return { mode: 'immediate', migrate: false };
}

/** Lit la préférence (et migre une fois l'ancien 'last', sans bloquer si l'écriture échoue). */
export async function loadCorrectionPref(db: DB): Promise<CorrectionMode> {
  const raw = await getSetting<unknown>(db, CORRECTION_PREF_KEY, null);
  let last: unknown = null;
  if (raw === 'last') last = (await getSetting<{ correction?: unknown } | null>(db, LAST_TEST_CONFIG_KEY, null).catch(() => null))?.correction;
  const { mode, migrate } = resolveCorrectionPref(raw, last);
  if (migrate) await setSetting(db, CORRECTION_PREF_KEY, mode).catch(() => undefined);
  return mode;
}
