// Hiérarchie souple : Bibliothèque → Matière → Thème → Leçon → Notion.
// Les niveaux absents sont omis (jamais inventés) : une notion sans leçon est rattachée directement au thème.
import type { CardMeta } from '../domain/types';

export type LevelKind = 'root' | 'matiere' | 'theme' | 'lecon' | 'notion';

export const LEVEL_LABELS: Record<LevelKind, string> = {
  root: 'Bibliothèque',
  matiere: 'Matière',
  theme: 'Thème',
  lecon: 'Leçon',
  notion: 'Notion',
};

export interface TaxNode {
  id: string;
  kind: LevelKind;
  label: string;
  parentId?: string;
  children: TaxNode[];
  /** Cartes de ce niveau et de tous ses descendants */
  total: number;
  /** Cartes dont ce niveau est le plus profond renseigné */
  direct: number;
}

export interface Taxonomy {
  root: TaxNode;
  byId: Map<string, TaxNode>;
  /** Pour chaque carte : chaîne des nœuds (sans la racine), du plus général au plus précis */
  pathOf: Map<string, string[]>;
}

export const ROOT_ID = 'root';
const SEP = '\u001f';
const KIND_CODE: Record<Exclude<LevelKind, 'root'>, string> = { matiere: 'm', theme: 't', lecon: 'l', notion: 'n' };

type Segment = { kind: Exclude<LevelKind, 'root'>; label: string };

export function segmentsOf(c: Pick<CardMeta, 'matiere' | 'theme' | 'lecon' | 'notion'>): Segment[] {
  const segs: Segment[] = [{ kind: 'matiere', label: c.matiere }];
  if (c.theme) segs.push({ kind: 'theme', label: c.theme });
  if (c.lecon) segs.push({ kind: 'lecon', label: c.lecon });
  if (c.notion) segs.push({ kind: 'notion', label: c.notion });
  return segs;
}

/** Identifiant de nœud stable, construit à partir du type et du libellé de chaque niveau. */
export function nodeIdFor(segs: Segment[]): string {
  return segs.map((s) => `${KIND_CODE[s.kind]}:${s.label}`).join(SEP);
}

/** Lot 4 : libellés et types des niveaux d'un identifiant de nœud (inverse de nodeIdFor). Racine : liste vide. */
export function segmentsOfNodeId(nodeId: string): Segment[] {
  if (nodeId === ROOT_ID) return [];
  const byCode: Record<string, Segment['kind']> = { m: 'matiere', t: 'theme', l: 'lecon', n: 'notion' };
  return nodeId.split(SEP).flatMap((part) => {
    const kind = byCode[part.slice(0, 1)];
    return kind && part[1] === ':' ? [{ kind, label: part.slice(2) }] : [];
  });
}

/** Identifiant de l'enfant `label` (de type `kind`) d'un nœud. */
export function childNodeId(parentId: string, kind: Exclude<LevelKind, 'root'>, label: string): string {
  const own = nodeIdFor([{ kind, label }]);
  return parentId === ROOT_ID ? own : parentId + SEP + own;
}

/** Nombre de niveaux d'un identifiant de nœud (0 pour la racine). */
export function nodeDepth(nodeId: string): number {
  return nodeId === ROOT_ID ? 0 : nodeId.split(SEP).length;
}

/** Clé de chemin indexée en base (même forme que l'identifiant du nœud le plus profond). */
export function pathKeyOf(c: Pick<CardMeta, 'matiere' | 'theme' | 'lecon' | 'notion'>): string {
  return nodeIdFor(segmentsOf(c));
}

/**
 * Construit l'arbre. Les cartes doivent être fournies dans l'ordre de la bibliothèque :
 * les sous-niveaux apparaissent dans l'ordre de leur première carte.
 */
export function buildTaxonomy(metas: readonly CardMeta[]): Taxonomy {
  const root: TaxNode = { id: ROOT_ID, kind: 'root', label: 'Toutes les matières', children: [], total: 0, direct: 0 };
  const byId = new Map<string, TaxNode>([[ROOT_ID, root]]);
  const pathOf = new Map<string, string[]>();

  for (const m of metas) {
    const segs = segmentsOf(m);
    const chain: string[] = [];
    let parent = root;
    root.total++;
    for (let i = 0; i < segs.length; i++) {
      const id = nodeIdFor(segs.slice(0, i + 1));
      let node = byId.get(id);
      if (!node) {
        node = { id, kind: segs[i]!.kind, label: segs[i]!.label, parentId: parent.id, children: [], total: 0, direct: 0 };
        byId.set(id, node);
        parent.children.push(node);
      }
      node.total++;
      chain.push(id);
      parent = node;
    }
    parent.direct++;
    pathOf.set(m.cardId, chain);
  }
  return { root, byId, pathOf };
}

/** Ancêtres d'un nœud, de la racine (incluse) au nœud (inclus). */
export function breadcrumb(tax: Taxonomy, nodeId: string): TaxNode[] {
  const out: TaxNode[] = [];
  let cur = tax.byId.get(nodeId);
  while (cur) {
    out.unshift(cur);
    cur = cur.parentId ? tax.byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** Cartes appartenant au nœud ou à ses descendants (sans doublon, ordre conservé). */
export function cardsUnder(tax: Taxonomy, metas: readonly CardMeta[], nodeId: string): CardMeta[] {
  if (nodeId === ROOT_ID) return metas.slice();
  return metas.filter((m) => tax.pathOf.get(m.cardId)?.includes(nodeId));
}

/** Cartes dont le nœud est le niveau le plus précis renseigné. */
export function cardsDirectlyAt(tax: Taxonomy, metas: readonly CardMeta[], nodeId: string): CardMeta[] {
  if (nodeId === ROOT_ID) return [];
  return metas.filter((m) => {
    const p = tax.pathOf.get(m.cardId);
    return p !== undefined && p[p.length - 1] === nodeId;
  });
}

/** Libellé lisible d'un nœud avec son chemin, ex. « Calcul › Fractions ». */
export function nodePathLabel(tax: Taxonomy, nodeId: string): string {
  if (nodeId === ROOT_ID) return 'Toutes les matières';
  return breadcrumb(tax, nodeId)
    .filter((n) => n.kind !== 'root')
    .map((n) => n.label)
    .join(' › ');
}

/**
 * Nœud existant le plus proche (v1.1.1) : le nœud lui-même, sinon son ancêtre le plus profond encore présent,
 * sinon la racine. Sert après la suppression de la dernière carte d'un niveau.
 */
export function nearestExistingNode(tax: Taxonomy, nodeId: string): string {
  if (tax.byId.has(nodeId)) return nodeId;
  const parts = nodeId.split(SEP);
  while (parts.length > 1) {
    parts.pop();
    const id = parts.join(SEP);
    if (tax.byId.has(id)) return id;
  }
  return ROOT_ID;
}

/**
 * v0.2.2 : appartenance d'une carte à un niveau, à partir de sa clé de chemin indexée en base (`pathKey`).
 * La clé d'une carte est l'identifiant de son nœud le plus précis ; elle appartient au niveau `nodeId`
 * si elle lui est égale ou commence par `nodeId` suivi du séparateur. Équivalent à cardsUnder sur l'arbre.
 */
export function pathInScope(pathKey: string, nodeId: string): boolean {
  if (nodeId === ROOT_ID) return true;
  return pathKey === nodeId || pathKey.startsWith(nodeId + SEP);
}

/** Bornes de l'index `byPath` couvrant un niveau : la clé exacte et l'intervalle de ses descendants. */
export function scopeKeyBounds(nodeId: string): { exact: string; lower: string; upper: string } {
  return { exact: nodeId, lower: nodeId + SEP, upper: nodeId + SEP + '￿' };
}
