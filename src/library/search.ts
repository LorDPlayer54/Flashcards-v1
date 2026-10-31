// Recherche textuelle dans question, réponse, explication et astuce (sans accents, insensible à la casse).
import type { Card, FormatFilter } from '../domain/types';
import { searchable } from '../domain/text';
import type { DB } from '../storage/db';

export interface SearchFilters {
  matiere?: string;
  format: FormatFilter;
  difficulte?: string;
}

export function queryTerms(query: string): string[] {
  return searchable(query)
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Vrai si chaque terme figure dans au moins un des champs textuels de la carte. */
export function cardMatches(card: Card, terms: string[], filters: SearchFilters): boolean {
  if (filters.matiere && card.matiere !== filters.matiere) return false;
  if (filters.format !== 'all' && card.formatQuestion !== filters.format) return false;
  if (filters.difficulte && card.difficulte !== filters.difficulte) return false;
  if (terms.length === 0) return true;
  const haystack = searchable(
    [card.rawQuestion, card.reponse, card.explication ?? '', card.astucePiege ?? '', card.notion ?? '', card.externalId ?? ''].join(' \u0000 '),
  );
  return terms.every((t) => haystack.includes(t));
}

/**
 * Parcourt la base par curseur et renvoie les identifiants des cartes trouvées.
 * Les cartes complètes ne sont pas gardées en mémoire ; l'interface charge ensuite la page à afficher.
 */
export async function searchCardIds(db: DB, query: string, filters: SearchFilters): Promise<string[]> {
  const terms = queryTerms(query);
  const ids: string[] = [];
  let cursor = await db.transaction('cards').store.openCursor();
  while (cursor) {
    if (cardMatches(cursor.value, terms, filters)) ids.push(cursor.value.cardId);
    cursor = await cursor.continue();
  }
  return ids;
}

/** Clé unique des critères de recherche (v1.1, I4) : un résultat n'est utilisable que pour la clé qui l'a produit. */
export function searchCriteriaKey(query: string, filters: SearchFilters): string {
  return JSON.stringify([queryTerms(query), filters.matiere ?? '', filters.format, filters.difficulte ?? '']);
}

export interface KeyedSearchResult {
  key: string;
  ids: string[];
}

/** Renvoie les identifiants seulement s'ils correspondent exactement aux critères affichés ; sinon null. */
export function idsForCriteria(result: KeyedSearchResult | null, currentKey: string): string[] | null {
  return result && result.key === currentKey ? result.ids : null;
}
