// Enchaînement « enregistrer l'import » puis « rafraîchir l'interface » (correctif I1, v1.1).
// Les deux étapes sont distinctes : un échec du rafraîchissement ne doit jamais faire croire que l'import a été annulé.
import type { Card } from '../domain/types';
import { applyRulesToDrafts, buildCards, rejectedToIssues, type BuildResult, type RowIssue } from './buildCards';
import type { ColumnMapping, FixedValues } from './columnMapping';
import type { ParsedCsv } from './csvParse';
import { planImport, type ImportPlan } from './importPlan';
import type { LabelRule } from '../taxonomy/labelMerge';

export type ImportRunResult<T> =
  /** Transaction confirmée ; refreshError est renseigné si seul le rafraîchissement a échoué */
  { status: 'committed'; outcome: T; refreshError?: string };

export class ImportCommitError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message || cause.name : String(cause));
    this.name = 'ImportCommitError';
  }
}

/**
 * Exécute l'import. Si la transaction échoue → ImportCommitError (rien n'a été modifié).
 * Si elle réussit → résultat « committed », même si le rafraîchissement échoue ensuite.
 */
export async function runImport<T>(commit: () => Promise<T>, refresh: () => Promise<void>): Promise<ImportRunResult<T>> {
  let outcome: T;
  try {
    outcome = await commit();
  } catch (e) {
    throw new ImportCommitError(e);
  }
  try {
    await refresh();
    return { status: 'committed', outcome };
  } catch (e) {
    return { status: 'committed', outcome, refreshError: e instanceof Error ? e.message || e.name : String(e) };
  }
}

// ---------- v1.1.1 (Important 2) : un aperçu ne vaut que pour les paramètres qui l'ont produit ----------


export interface AnalysisParams {
  mapping: ColumnMapping;
  fixed: FixedValues;
  targetKind: 'new' | 'existing';
  newName: string;
  existingId: string;
  ambiguousAsOpen: boolean;
}

/** Clé stable des paramètres d'analyse (ordre des propriétés normalisé). */
export function analysisKey(p: AnalysisParams): string {
  const sorted = (o: object) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '').sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify([sorted(p.mapping), sorted(p.fixed), p.targetKind, p.targetKind === 'new' ? p.newName : p.existingId, p.ambiguousAsOpen]);
}

export interface AnalysisResult {
  key: string;
  params: AnalysisParams;
  build: BuildResult;
  /** Lignes CSV mal formées + anomalies de construction, triées par ligne */
  issues: RowIssue[];
  /** Aperçu : la comparaison définitive est refaite dans la transaction d'import */
  plan: ImportPlan;
  /** Lot 3B : cartes du fichier reclassées selon les fusions de libellés mémorisées */
  remapped: number;
}

export async function analyseFile(
  parsed: ParsedCsv,
  params: AnalysisParams,
  loadExisting: (collectionId: string) => Promise<Card[]>,
  rules: readonly LabelRule[] = [],
): Promise<AnalysisResult> {
  const raw = buildCards(parsed.rows, params.mapping, params.fixed, {
    rowNumbers: parsed.rowNumbers,
    ambiguousMcqAsOpen: params.ambiguousAsOpen,
  });
  // Lot 3B : fusions de libellés mémorisées appliquées dès l'aperçu (et de nouveau dans la transaction d'import)
  const mapped = applyRulesToDrafts(raw.drafts, rules);
  const build = { ...raw, drafts: mapped.drafts };
  const existing = params.targetKind === 'existing' && params.existingId ? await loadExisting(params.existingId) : [];
  return {
    key: analysisKey(params),
    params,
    build,
    issues: [...rejectedToIssues(parsed.rejected), ...build.issues].sort((x, y) => x.row - y.row),
    plan: planImport(build.drafts, existing),
    remapped: mapped.remapped,
  };
}

/** Jeton « dernière demande seulement » : une analyse plus ancienne terminée plus tard est ignorée. */
export class LatestOnly {
  private seq = 0;
  begin(): number {
    return ++this.seq;
  }
  isCurrent(token: number): boolean {
    return token === this.seq;
  }
  invalidate(): void {
    this.seq++;
  }
}

/** Les brouillons ne sont importables que si l'analyse correspond exactement aux paramètres affichés. */
export function draftsForConfirm(analysis: AnalysisResult | null, currentKey: string, analysing: boolean): AnalysisResult | null {
  if (analysing || !analysis || analysis.key !== currentKey) return null;
  return analysis;
}
