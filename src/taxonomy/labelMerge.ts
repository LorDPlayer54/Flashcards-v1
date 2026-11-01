// Lot 3B : fusion explicite des libellés (matière, thème, leçon, notion). Fonctions pures, testées.
//
// Une fusion remplace, sous un même niveau parent, un ou plusieurs libellés de même type par un libellé cible.
// Elle n'est jamais automatique : l'écran présente les libellés et le nombre de cartes concernées, puis
// l'utilisatrice confirme. Les cartes gardent leur identifiant, leurs échéances et leur historique.
//
// Les fusions sont mémorisées sous forme de règles (« sous tel parent, le libellé X devient Y ») et appliquées aux
// importations suivantes : réimporter le fichier d'origine ne recrée pas l'ancien libellé et ne signale pas les
// cartes fusionnées comme modifiées. Les règles sont tenues « à plat » : aucune cible n'est elle-même la source d'une
// autre règle au même endroit, si bien qu'une seule application suffit (application idempotente).
import { comparable } from '../domain/text';
import type { ScopeSpec, TestSession } from '../domain/types';
import { childNodeId, nodePathLabel, nodeIdFor, ROOT_ID, segmentsOf, segmentsOfNodeId, type LevelKind, type Taxonomy } from './tree';

export type LabelLevel = Exclude<LevelKind, 'root'>;

export interface LabelRule {
  level: LabelLevel;
  /** Nœud parent, exprimé avec les libellés en vigueur (ROOT_ID pour une matière) */
  parentId: string;
  from: string;
  to: string;
  /** Date de la fusion */
  at: string;
}

export const LABEL_RULES_KEY = 'labelRules';

export interface Classified {
  matiere: string;
  theme?: string;
  lecon?: string;
  notion?: string;
}

const key = (level: LabelLevel, parentId: string, from: string) => `${level}\u0000${parentId}\u0000${from}`;

/** Applique les règles à un classement, du niveau le plus général au plus précis. */
export function applyLabelRules<T extends Classified>(c: T, rules: readonly LabelRule[]): T {
  if (rules.length === 0) return c;
  const index = new Map(rules.map((r) => [key(r.level, r.parentId, r.from), r.to]));
  const segs = segmentsOf(c).map((s) => ({ ...s }));
  let changed = false;
  for (let i = 0; i < segs.length; i++) {
    const parent = i === 0 ? ROOT_ID : nodeIdFor(segs.slice(0, i));
    const to = index.get(key(segs[i]!.kind, parent, segs[i]!.label));
    if (to !== undefined && to !== segs[i]!.label) {
      segs[i]!.label = to;
      changed = true;
    }
  }
  if (!changed) return c;
  const out: T = { ...c };
  for (const s of segs) (out as Classified)[s.kind] = s.label;
  return out;
}

export interface MergeRequest {
  level: LabelLevel;
  parentId: string;
  /** Libellés remplacés (au moins un) */
  from: string[];
  /** Libellé cible */
  to: string;
  at: string;
}

/**
 * Ajoute les règles d'une fusion à celles déjà mémorisées, en gardant l'ensemble « à plat » :
 *  - une règle qui menait vers un libellé fusionné mène désormais vers la cible ;
 *  - une règle qui faisait disparaître la cible est retirée (la cible redevient le libellé de référence) ;
 *  - les règles des sous-niveaux des libellés fusionnés sont rattachées au parent cible ;
 *  - en cas de doublon, la règle la plus récente l'emporte.
 */
export function addMergeRules(rules: readonly LabelRule[], m: MergeRequest): LabelRule[] {
  const from = new Set(m.from.filter((f) => f !== m.to));
  const targetId = childNodeId(m.parentId, m.level, m.to);
  const movedPrefixes = [...from].map((f) => childNodeId(m.parentId, m.level, f));
  const SEP = '\u001f';
  const rewriteParent = (parentId: string) => {
    for (const p of movedPrefixes) {
      if (parentId === p) return targetId;
      if (parentId.startsWith(p + SEP)) return targetId + parentId.slice(p.length);
    }
    return parentId;
  };
  const next: LabelRule[] = [];
  for (const r of rules) {
    const sameSpot = r.level === m.level && r.parentId === m.parentId;
    if (sameSpot && r.from === m.to) continue; // la cible redevient la référence
    if (sameSpot && from.has(r.from)) continue; // remplacée par la nouvelle règle
    next.push({ ...r, to: sameSpot && from.has(r.to) ? m.to : r.to, parentId: rewriteParent(r.parentId) });
  }
  for (const f of from) next.push({ level: m.level, parentId: m.parentId, from: f, to: m.to, at: m.at });
  // Doublons (même endroit, même source) : la plus récente (la dernière) l'emporte
  const byKey = new Map<string, LabelRule>();
  for (const r of next) {
    const k = key(r.level, r.parentId, r.from);
    byKey.delete(k);
    byKey.set(k, r);
  }
  return [...byKey.values()].filter((r) => r.from !== r.to);
}

/** Distance d'édition (Levenshtein), bornée : sert seulement à suggérer des libellés semblables. */
function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Vrai si deux libellés semblent désigner la même chose (casse, accents, espaces, une lettre d'écart). */
export function similarLabels(a: string, b: string): boolean {
  const x = comparable(a);
  const y = comparable(b);
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 5 && editDistance(x, y, 1) <= 1;
}

export interface SimilarGroup {
  parentId: string;
  level: LabelLevel;
  labels: { label: string; nodeId: string; total: number }[];
}

/** Groupes de libellés semblables entre niveaux frères de même type : simples suggestions, jamais appliquées seules. */
export function similarLabelGroups(tax: Taxonomy): SimilarGroup[] {
  const out: SimilarGroup[] = [];
  for (const node of tax.byId.values()) {
    const byKind = new Map<LabelLevel, typeof node.children>();
    for (const c of node.children) {
      const k = c.kind as LabelLevel;
      byKind.set(k, [...(byKind.get(k) ?? []), c]);
    }
    for (const [level, kids] of byKind) {
      // Regroupement transitif (union-find simple)
      const parent = kids.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
      for (let i = 0; i < kids.length; i++)
        for (let j = i + 1; j < kids.length; j++) if (similarLabels(kids[i]!.label, kids[j]!.label)) parent[find(i)] = find(j);
      const groups = new Map<number, typeof kids>();
      kids.forEach((k, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), k]));
      for (const g of groups.values())
        if (g.length > 1) out.push({ parentId: node.id, level, labels: g.map((k) => ({ label: k.label, nodeId: k.id, total: k.total })) });
    }
  }
  return out;
}

// ---------- Lot 4 : niveaux renommés ou fusionnés depuis le lancement d'une séance ----------

/** Identifiant actuel d'un niveau, après application des fusions mémorisées (inchangé si aucune ne s'applique). */
export function mapNodeId(nodeId: string, rules: readonly LabelRule[]): string {
  const segs = segmentsOfNodeId(nodeId);
  if (segs.length === 0 || rules.length === 0) return nodeId;
  const c: Classified = { matiere: '' };
  for (const s of segs) c[s.kind] = s.label;
  const mapped = applyLabelRules(c, rules);
  if (mapped === c) return nodeId;
  return nodeIdFor(segs.map((s) => ({ kind: s.kind, label: mapped[s.kind]! })));
}

/** Périmètre d'une séance exprimé avec les niveaux actuels (fusions et renommages appliqués). */
export function currentScope(scope: ScopeSpec, tax: Taxonomy, rules: readonly LabelRule[]): ScopeSpec {
  const map = (id: string) => (tax.byId.has(id) ? id : mapNodeId(id, rules));
  if (scope.kind === 'node') return { kind: 'node', nodeId: map(scope.nodeId) };
  if (scope.kind === 'multi') return { kind: 'multi', nodeIds: [...new Set(scope.nodeIds.map(map))] };
  return scope;
}

/** Libellé actuel du périmètre d'une séance (le libellé enregistré au lancement si le niveau n'existe plus). */
export function currentScopeLabel(session: Pick<TestSession, 'scope' | 'scopeLabel' | 'mode'>, tax: Taxonomy, rules: readonly LabelRule[]): string {
  const scope = currentScope(session.scope, tax, rules);
  const prefix = session.mode === 'revision' ? 'Révision — ' : '';
  // v1.1.0 : la révision du jour porte sur le programme étudié (périmètre racine) : libellé enregistré au lancement
  if (session.mode === 'revision' && scope.kind === 'node' && scope.nodeId === ROOT_ID && session.scopeLabel) return session.scopeLabel;
  if (scope.kind === 'node' && tax.byId.has(scope.nodeId)) return prefix + nodePathLabel(tax, scope.nodeId);
  if (scope.kind === 'multi' && scope.nodeIds.every((id) => tax.byId.has(id))) {
    const labels = scope.nodeIds.map((id) => nodePathLabel(tax, id));
    return labels.length <= 3 ? labels.join(' + ') : `${labels.length} niveaux : ${labels.slice(0, 2).join(' + ')}…`;
  }
  return session.scopeLabel;
}
