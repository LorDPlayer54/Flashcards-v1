// Transformation des lignes CSV en brouillons de cartes, avec relevé des anomalies.
// Aucune valeur n'est inventée : un champ absent reste absent.
import type { McqOption, QuestionFormat } from '../domain/types';
import { cleanLabel, cleanText, fnv1a, normalizeDifficulty } from '../domain/text';
import type { ColumnMapping, FixedValues, TargetField } from './columnMapping';
import {
  answerLooksLikeOptionLetter,
  buildOptionsFromColumns,
  findDuplicateOptions,
  looksLikeEmbeddedMcq,
  parseEmbeddedOptions,
  resolveAnswer,
} from './qcmParser';
import type { RejectedRecord } from './csvParse';
import { applyLabelRules, type LabelRule } from '../taxonomy/labelMerge';

export interface CardDraft {
  externalId?: string;
  matiere: string;
  theme?: string;
  lecon?: string;
  notion?: string;
  typePedagogique?: string;
  difficulte?: string;
  formatQuestion: QuestionFormat;
  question: string;
  rawQuestion: string;
  options?: McqOption[];
  correctOptionId?: string;
  reponse: string;
  explication?: string;
  astucePiege?: string;
  sourceRow: number;
  contentHash: string;
}

export interface RowIssue {
  /** Rang de l'enregistrement de données (1 = première carte du fichier) */
  row: number;
  externalId?: string;
  severity: 'error' | 'warning';
  message: string;
  /** Catégorie, pour les compteurs de l'aperçu */
  kind?: 'malformed' | 'missing-field' | 'duplicate-id' | 'ambiguous-mcq';
}

export interface BuildOptions {
  /** Rang d'origine de chaque ligne (fourni par parseCsv quand des lignes malformées ont été exclues) */
  rowNumbers?: number[];
  /**
   * v1.1 (I3) : par défaut, une carte qui ressemble à un QCM mais ne peut pas être analysée de façon fiable
   * est EXCLUE et signalée. Mettre à true seulement sur choix explicite de l'utilisatrice :
   * elle est alors importée comme question ouverte (jamais comme QCM).
   */
  ambiguousMcqAsOpen?: boolean;
}

/** Convertit les lignes CSV rejetées à la lecture en anomalies affichables. */
export function rejectedToIssues(rejected: RejectedRecord[]): RowIssue[] {
  return rejected.map((r) => ({ row: r.row, severity: 'error', message: r.reason, kind: 'malformed' }));
}

export interface BuildResult {
  drafts: CardDraft[];
  /** Erreurs (ligne ignorée) et avertissements (ligne importée) */
  issues: RowIssue[];
  /** Avertissements globaux au fichier */
  fileWarnings: string[];
}

/** Empreinte des champs de contenu ; toute modification change l'empreinte. */
export function computeContentHash(d: Omit<CardDraft, 'contentHash' | 'sourceRow'>): string {
  const parts = [
    d.matiere,
    d.theme ?? '',
    d.lecon ?? '',
    d.notion ?? '',
    d.typePedagogique ?? '',
    d.difficulte ?? '',
    d.rawQuestion,
    (d.options ?? []).map((o) => `${o.id}:${o.text}`).join('|'),
    d.reponse,
    d.explication ?? '',
    d.astucePiege ?? '',
  ];
  return fnv1a(parts.join('\u001f'));
}

export function buildCards(rows: string[][], mapping: ColumnMapping, fixed: FixedValues, opts: BuildOptions = {}): BuildResult {
  const drafts: CardDraft[] = [];
  const issues: RowIssue[] = [];
  const fileWarnings: string[] = [];
  const seenIds = new Map<string, number>();
  let withoutId = 0;

  const get = (row: string[], field: TargetField): string | undefined => {
    const idx = mapping[field];
    return idx === undefined ? undefined : row[idx];
  };

  rows.forEach((row, i) => {
    const rowNum = opts.rowNumbers?.[i] ?? i + 1;
    const externalId = cleanLabel(get(row, 'externalId'));
    const rawQuestion = cleanText(get(row, 'question'));
    const reponse = cleanText(get(row, 'reponse'));
    const base = { row: rowNum, externalId };

    if (row.every((cell) => cell.trim() === '')) return; // ligne entièrement vide : ignorée sans bruit

    if (!rawQuestion) {
      issues.push({ ...base, severity: 'error', kind: 'missing-field', message: 'Question vide : carte ignorée.' });
      return;
    }
    if (!reponse) {
      issues.push({ ...base, severity: 'error', kind: 'missing-field', message: 'Réponse vide : carte ignorée.' });
      return;
    }
    const matiere = cleanLabel(get(row, 'matiere')) ?? cleanLabel(fixed.matiere);
    if (!matiere) {
      issues.push({ ...base, severity: 'error', kind: 'missing-field', message: 'Matière absente : carte ignorée.' });
      return;
    }
    if (externalId) {
      const prev = seenIds.get(externalId);
      if (prev !== undefined) {
        issues.push({
          ...base,
          severity: 'error',
          kind: 'duplicate-id',
          message: `Identifiant « ${externalId} » déjà utilisé à la carte ${prev} du même fichier : carte ignorée.`,
        });
        return;
      }
      // Enregistré même si la carte est ensuite exclue : un même ID ne doit jamais désigner deux lignes du fichier
      seenIds.set(externalId, rowNum);
    }

    // ---------- Détection du format (v1.1, I3) ----------
    let formatQuestion: QuestionFormat = 'open';
    let question = rawQuestion;
    let options: McqOption[] | undefined;
    let correctOptionId: string | undefined;
    /** Raison pour laquelle une carte qui ressemble à un QCM ne peut pas être corrigée de façon fiable */
    let ambiguity: string | null = null;

    const columnOptionValues = (['optionA', 'optionB', 'optionC', 'optionD', 'optionE'] as const).map((f) => get(row, f));
    const hasColumnOptions = columnOptionValues.some((v) => v !== undefined && v.trim() !== '');

    let candidate: { stem: string; options: McqOption[] } | null = null;
    if (hasColumnOptions) {
      const opts2 = buildOptionsFromColumns(columnOptionValues);
      if (opts2) candidate = { stem: rawQuestion, options: opts2 };
      else ambiguity = 'colonnes d’options incomplètes ou discontinues (2 propositions consécutives au minimum, sans trou)';
    } else {
      candidate = parseEmbeddedOptions(rawQuestion);
      if (!candidate && looksLikeEmbeddedMcq(rawQuestion)) {
        ambiguity = 'des propositions A), B)… sont présentes mais ne peuvent pas être isolées de façon fiable';
      }
    }

    if (candidate) {
      const dups = findDuplicateOptions(candidate.options);
      if (dups.length > 0) {
        ambiguity = `propositions identiques : ${dups.map(([a, b]) => `${a}) et ${b})`).join(', ')}`;
      } else {
        const res = resolveAnswer(reponse, candidate.options);
        if (res.status === 'ok') {
          formatQuestion = 'mcq';
          question = candidate.stem;
          options = candidate.options;
          correctOptionId = res.correctOptionId;
        } else {
          ambiguity = res.reason;
        }
      }
    } else if (!ambiguity && answerLooksLikeOptionLetter(reponse)) {
      ambiguity = 'la réponse désigne une lettre d’option, mais la question ne contient pas de propositions identifiables';
    }

    if (ambiguity) {
      if (!opts.ambiguousMcqAsOpen) {
        issues.push({
          ...base,
          severity: 'error',
          kind: 'ambiguous-mcq',
          message: `QCM non analysable de façon fiable (${ambiguity}) : carte exclue. Corrigez-la dans le fichier, ou choisissez explicitement de l’importer comme question ouverte.`,
        });
        return;
      }
      issues.push({
        ...base,
        severity: 'warning',
        kind: 'ambiguous-mcq',
        message: `QCM non analysable de façon fiable (${ambiguity}) : importée comme question ouverte, à votre demande.`,
      });
    }

    if (!externalId) withoutId++;

    const draftBase = {
      externalId,
      matiere,
      theme: cleanLabel(get(row, 'theme')) ?? cleanLabel(fixed.theme),
      lecon: cleanLabel(get(row, 'lecon')) ?? cleanLabel(fixed.lecon),
      notion: cleanLabel(get(row, 'notion')),
      typePedagogique: cleanLabel(get(row, 'typePedagogique')),
      difficulte: normalizeDifficulty(get(row, 'difficulte')),
      formatQuestion,
      question,
      rawQuestion,
      options,
      correctOptionId,
      reponse,
      explication: cleanText(get(row, 'explication')),
      astucePiege: cleanText(get(row, 'astucePiege')),
    };
    drafts.push({ ...draftBase, sourceRow: rowNum, contentHash: computeContentHash(draftBase) });
  });

  if (withoutId > 0) {
    fileWarnings.push(
      `${withoutId} carte(s) sans identifiant. Elles sont importées, mais lors d’une réimportation une carte sans identifiant n’est reconnue que si son contenu est strictement identique : si vous la modifiez, elle sera ajoutée comme nouvelle carte (doublon possible). Ajoutez une colonne ID pour des mises à jour fiables.`,
    );
  }
  return { drafts, issues, fileWarnings };
}

/**
 * Lot 3B : applique aux brouillons les fusions de libellés mémorisées (empreinte recalculée).
 * Un fichier réimporté après une fusion retrouve ainsi les cartes fusionnées à l'identique.
 * Renvoie aussi le nombre de brouillons reclassés.
 */
export function applyRulesToDrafts(drafts: CardDraft[], rules: readonly LabelRule[]): { drafts: CardDraft[]; remapped: number } {
  if (rules.length === 0) return { drafts, remapped: 0 };
  let remapped = 0;
  const out = drafts.map((d) => {
    const m = applyLabelRules(d, rules);
    if (m === d) return d;
    remapped++;
    const { contentHash: _h, sourceRow, ...base } = m;
    return { ...m, sourceRow, contentHash: computeContentHash(base) };
  });
  return { drafts: out, remapped };
}
