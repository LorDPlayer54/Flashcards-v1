// Petites fonctions utilitaires pures (testées).

/** Nettoie un libellé de classement : espaces superflus retirés. Ne modifie ni la casse ni les accents. */
export function cleanLabel(value: string | undefined | null): string | undefined {
  if (value == null) return undefined;
  const v = value.replace(/\s+/g, ' ').trim();
  return v === '' ? undefined : v;
}

/** Nettoie un texte long : conserve les retours à la ligne, retire les espaces de début/fin. */
export function cleanText(value: string | undefined | null): string | undefined {
  if (value == null) return undefined;
  const v = value.replace(/\r\n?/g, '\n').trim();
  return v === '' ? undefined : v;
}

/** Forme de comparaison : minuscules, sans accents, sans espaces ni ponctuation finale. */
export function comparable(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s  ]+/g, '')
    .replace(/[.;:!]+$/, '');
}

/** Forme de recherche : minuscules, sans accents, espaces normalisés. */
export function searchable(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s  ]+/g, ' ');
}

/** Empreinte FNV-1a 32 bits (hexadécimal). Suffisante pour détecter un changement de contenu. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Identifiant unique (UUID v4 si disponible). */
export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Mélange de Fisher-Yates ; renvoie une copie. `rng` injectable pour les tests. */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

/** Normalise les libellés de difficulté usuels ; conserve tels quels les libellés inconnus. */
export function normalizeDifficulty(value: string | undefined): string | undefined {
  const v = cleanLabel(value);
  if (!v) return undefined;
  const c = comparable(v);
  if (c === 'facile' || c === 'easy') return 'Facile';
  if (c === 'moyen' || c === 'moyenne' || c === 'medium' || c === 'intermediaire') return 'Moyen';
  if (c === 'difficile' || c === 'hard' || c === 'difficult') return 'Difficile';
  return v;
}
