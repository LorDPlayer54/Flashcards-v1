// Sélection des cartes d'un test : périmètre → filtres → tirage. Fonctions pures, testées.
import {
  UNSET,
  type CardMeta,
  type FormatFilter,
  type MasteryBucket,
  type ScopeSpec,
  type TestConfig,
  type TestFilters,
} from '../domain/types';
import { shuffle } from '../domain/text';
import { isMastered, type ReviewState } from '../review/schedule';
import { cardsUnder, nodePathLabel, ROOT_ID, type Taxonomy } from '../taxonomy/tree';

/** Cartes du périmètre, sans doublon, dans l'ordre de la bibliothèque. */
export function resolveScope(scope: ScopeSpec, tax: Taxonomy, metas: readonly CardMeta[]): CardMeta[] {
  if (scope.kind === 'node') {
    if (!tax.byId.has(scope.nodeId)) return [];
    return cardsUnder(tax, metas, scope.nodeId);
  }
  if (scope.kind === 'multi') {
    // Union des niveaux encore existants ; une carte présente dans plusieurs niveaux choisis n'apparaît qu'une fois
    const nodes = new Set(scope.nodeIds.filter((id) => tax.byId.has(id)));
    if (nodes.has(ROOT_ID)) return metas.slice();
    return metas.filter((m) => tax.pathOf.get(m.cardId)?.some((id) => nodes.has(id)));
  }
  const wanted = new Set(scope.cardIds);
  return metas.filter((m) => wanted.has(m.cardId));
}

export interface Eligibility {
  eligible: CardMeta[];
  /** Explication lorsqu'aucune carte n'est éligible */
  emptyReason?: string;
}

export function applyFilters(scoped: readonly CardMeta[], config: Pick<TestConfig, 'format'>): Eligibility {
  if (scoped.length === 0) return { eligible: [], emptyReason: 'Ce périmètre ne contient aucune carte.' };
  const eligible = config.format === 'all' ? scoped.slice() : scoped.filter((m) => m.formatQuestion === config.format);
  if (eligible.length === 0) {
    const other = scoped.length;
    const what = config.format === 'mcq' ? 'aucun QCM' : 'aucune question ouverte';
    return {
      eligible,
      emptyReason: `Le filtre « format » exclut toutes les cartes : ce périmètre contient ${what} (${other} carte(s) d'un autre format).`,
    };
  }
  return { eligible };
}

/** Nombre effectivement tiré : borne le nombre demandé au stock disponible. */
export function effectiveCount(requested: number | null, available: number): number {
  if (requested === null) return available;
  if (!Number.isFinite(requested) || requested < 1) return Math.min(1, available);
  return Math.min(Math.floor(requested), available);
}

/** Tire les cartes : aléatoire (par défaut) ou ordre de la bibliothèque. Aucune carte en double. */
export function drawCards(eligible: readonly CardMeta[], config: TestConfig, rng: () => number = Math.random): string[] {
  const unique: CardMeta[] = [];
  const seen = new Set<string>();
  for (const m of eligible) {
    if (!seen.has(m.cardId)) {
      seen.add(m.cardId);
      unique.push(m);
    }
  }
  const n = effectiveCount(config.count, unique.length);
  const ordered = config.order === 'random' ? shuffle(unique, rng) : unique;
  return ordered.slice(0, n).map((m) => m.cardId);
}

// ---------- Lot 3A : filtres multicritères ----------

export const NO_FILTERS: TestFilters = { difficulties: [], types: [], statuses: [] };

export const MASTERY_LABELS: Record<MasteryBucket, string> = {
  new: 'Nouvelle',
  learning: 'En apprentissage',
  review: 'En révision',
  mastered: 'Maîtrisée',
};

/**
 * Statut de maîtrise en catégories exclusives : une carte maîtrisée n'est pas aussi « en révision ».
 * `undefined` signifie « aucun état dans une table d'états effectivement chargée » (carte nouvelle).
 * v0.3.0-a1 (I1) : une table non chargée ou illisible n'est jamais passée ici ; elle est représentée par `null`
 * (voir `StatesView`) et rend le filtre de maîtrise indisponible.
 */
export function masteryBucket(state: ReviewState | undefined): MasteryBucket {
  if (!state) return 'new';
  if (isMastered(state)) return 'mastered';
  return state.status === 'learning' ? 'learning' : 'review';
}

/**
 * v0.3.0-a1 (I1) : états de mémorisation tels que connus de l'écran.
 * `null` = non chargés ou illisibles : aucune carte n'est alors classée, le filtre de maîtrise est indisponible.
 */
export type StatesView = ReadonlyMap<string, ReviewState> | null;

/**
 * États exploitables d'après le résultat d'un chargement : la table seulement si elle a été lue sans erreur.
 * En cours de chargement (`data` absent) ou après un échec (`error`), `null` — jamais une table vide.
 */
export function statesViewOf(r: { data: { states: ReadonlyMap<string, ReviewState> } | null; error: string | null }): StatesView {
  return r.data && !r.error ? r.data.states : null;
}

type Dimension = 'format' | 'difficulties' | 'types' | 'statuses';

export const DIMENSION_LABELS: Record<Dimension, string> = {
  format: 'format',
  difficulties: 'difficulté',
  types: 'type pédagogique',
  statuses: 'statut de maîtrise',
};

export interface FilterSet {
  format: FormatFilter;
  filters: TestFilters;
}

const valueOrUnset = (v: string | undefined) => v ?? UNSET;

function passes(m: CardMeta, dim: Dimension, f: FilterSet, states: ReadonlyMap<string, ReviewState>): boolean {
  // `states` est toujours une table chargée ici (applyTestFilters refuse le filtre de maîtrise sans états)
  switch (dim) {
    case 'format':
      return f.format === 'all' || m.formatQuestion === f.format;
    case 'difficulties':
      return f.filters.difficulties.length === 0 || f.filters.difficulties.includes(valueOrUnset(m.difficulte));
    case 'types':
      return f.filters.types.length === 0 || f.filters.types.includes(valueOrUnset(m.typePedagogique));
    case 'statuses':
      return f.filters.statuses.length === 0 || f.filters.statuses.includes(masteryBucket(states.get(m.cardId)));
  }
}

/** Dimensions effectivement filtrées */
export function activeDimensions(f: FilterSet): Dimension[] {
  const out: Dimension[] = [];
  if (f.format !== 'all') out.push('format');
  if (f.filters.difficulties.length) out.push('difficulties');
  if (f.filters.types.length) out.push('types');
  if (f.filters.statuses.length) out.push('statuses');
  return out;
}

export interface MultiEligibility {
  eligible: CardMeta[];
  /** Explication lorsqu'aucune carte n'est éligible */
  emptyReason?: string;
  /** Filtres dont le retrait, à lui seul, rendrait des cartes éligibles (avec le nombre obtenu) */
  culprits: { dimension: Dimension; label: string; countWithout: number }[];
  /** v0.3.0-a1 (I1) : le filtre de maîtrise est actif mais les états ne sont pas disponibles ; rien n'est sélectionné */
  statesUnavailable?: boolean;
}

/**
 * Applique tous les filtres : dimensions cumulées (ET), choix d'une même dimension additionnés (OU).
 * Sans doublon, ordre conservé. Si rien n'est éligible, explique quels filtres en sont responsables.
 */
export function applyTestFilters(scoped: readonly CardMeta[], f: FilterSet, statesView: StatesView): MultiEligibility {
  const seen = new Set<string>();
  const unique = scoped.filter((m) => (seen.has(m.cardId) ? false : (seen.add(m.cardId), true)));
  if (unique.length === 0) return { eligible: [], emptyReason: 'Ce périmètre ne contient aucune carte.', culprits: [] };
  const dims = activeDimensions(f);
  // v0.3.0-a1 (I1) : sans états fiables, aucune sélection ne repose sur le statut de maîtrise
  if (statesView === null && dims.includes('statuses')) {
    return {
      eligible: [],
      emptyReason: 'Les statuts de maîtrise ne sont pas disponibles : le filtre « statut de maîtrise » ne peut pas être appliqué.',
      culprits: [],
      statesUnavailable: true,
    };
  }
  const states: ReadonlyMap<string, ReviewState> = statesView ?? new Map();
  const eligible = unique.filter((m) => dims.every((d) => passes(m, d, f, states)));
  if (eligible.length > 0) return { eligible, culprits: [] };

  const culprits = dims
    .map((d) => ({
      dimension: d,
      label: DIMENSION_LABELS[d],
      countWithout: unique.filter((m) => dims.every((o) => o === d || passes(m, o, f, states))).length,
    }))
    .filter((c) => c.countWithout > 0);
  const alone = dims.map((d) => `${DIMENSION_LABELS[d]} : ${unique.filter((m) => passes(m, d, f, states)).length}`).join(' ; ');
  const emptyReason =
    culprits.length > 0
      ? `Aucune carte ne remplit tous les critères. ${culprits
          .map((c) => `Sans le filtre « ${c.label} », ${c.countWithout} carte(s) seraient éligibles.`)
          .join(' ')}`
      : `Aucune carte ne remplit tous les critères : c'est la combinaison des filtres qui exclut tout (cartes du périmètre retenues par chaque filtre seul — ${alone}).`;
  return { eligible, emptyReason, culprits };
}

export interface FilterOption {
  value: string;
  count: number;
}

/**
 * Valeurs disponibles dans le périmètre pour chaque dimension, avec leur nombre de cartes.
 * v0.3.0-a1 (I1) : `statuses` vaut null tant que les états de mémorisation ne sont pas disponibles.
 */
export function filterOptions(
  scoped: readonly CardMeta[],
  states: StatesView,
): { difficulties: FilterOption[]; types: FilterOption[]; statuses: { value: MasteryBucket; count: number }[] | null } {
  const count = (values: string[]) => {
    const m = new Map<string, number>();
    for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  };
  const order = ['Facile', 'Moyen', 'Difficile'];
  const sortDiff = (a: FilterOption, b: FilterOption) => {
    const ia = a.value === UNSET ? 99 : order.indexOf(a.value) === -1 ? 50 : order.indexOf(a.value);
    const ib = b.value === UNSET ? 99 : order.indexOf(b.value) === -1 ? 50 : order.indexOf(b.value);
    return ia - ib || a.value.localeCompare(b.value, 'fr');
  };
  const diff = [...count(scoped.map((m) => valueOrUnset(m.difficulte)))].map(([value, c]) => ({ value, count: c })).sort(sortDiff);
  const types = [...count(scoped.map((m) => valueOrUnset(m.typePedagogique)))]
    .map(([value, c]) => ({ value, count: c }))
    .sort((a, b) => (a.value === UNSET ? 1 : b.value === UNSET ? -1 : a.value.localeCompare(b.value, 'fr')));
  if (states === null) return { difficulties: diff, types, statuses: null };
  const st = count(scoped.map((m) => masteryBucket(states.get(m.cardId))));
  const statuses = (['new', 'learning', 'review', 'mastered'] as MasteryBucket[]).map((value) => ({ value, count: st.get(value) ?? 0 }));
  return { difficulties: diff, types, statuses };
}

/** Libellé lisible d'un périmètre. */
export function scopeLabelOf(scope: ScopeSpec, tax: Taxonomy): string {
  if (scope.kind === 'node') return nodePathLabel(tax, scope.nodeId);
  if (scope.kind === 'cards') return scope.label;
  const labels = scope.nodeIds.filter((id) => tax.byId.has(id)).map((id) => nodePathLabel(tax, id));
  if (labels.length === 0) return 'Aucun niveau';
  if (labels.length <= 3) return labels.join(' + ');
  return `${labels.length} niveaux : ${labels.slice(0, 2).join(' + ')}…`;
}
