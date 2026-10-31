// Correspondance entre les colonnes d'un CSV et les champs de l'application.
import { comparable } from '../domain/text';

export type TargetField =
  | 'externalId'
  | 'matiere'
  | 'theme'
  | 'lecon'
  | 'notion'
  | 'typePedagogique'
  | 'difficulte'
  | 'question'
  | 'reponse'
  | 'explication'
  | 'astucePiege'
  | 'optionA'
  | 'optionB'
  | 'optionC'
  | 'optionD'
  | 'optionE';

export const TARGET_FIELDS: { field: TargetField; label: string; required?: boolean; advanced?: boolean }[] = [
  { field: 'question', label: 'Question', required: true },
  { field: 'reponse', label: 'Réponse', required: true },
  { field: 'matiere', label: 'Matière' },
  { field: 'theme', label: 'Thème' },
  { field: 'lecon', label: 'Leçon' },
  { field: 'notion', label: 'Notion' },
  { field: 'externalId', label: 'Identifiant (ID)' },
  { field: 'typePedagogique', label: 'Type pédagogique' },
  { field: 'difficulte', label: 'Difficulté' },
  { field: 'explication', label: 'Explication' },
  { field: 'astucePiege', label: 'Astuce / Piège' },
  { field: 'optionA', label: 'Option A (colonne séparée)', advanced: true },
  { field: 'optionB', label: 'Option B (colonne séparée)', advanced: true },
  { field: 'optionC', label: 'Option C (colonne séparée)', advanced: true },
  { field: 'optionD', label: 'Option D (colonne séparée)', advanced: true },
  { field: 'optionE', label: 'Option E (colonne séparée)', advanced: true },
];

/** Synonymes reconnus (comparés sans accents, espaces ni ponctuation). */
const SYNONYMS: Record<TargetField, string[]> = {
  externalId: ['id', 'identifiant', 'ref', 'reference', 'code', 'cardid'],
  matiere: ['matiere', 'subject', 'discipline'],
  theme: ['theme', 'souscategorie', 'categorie', 'domaine', 'topic'],
  lecon: ['lecon', 'lesson', 'souschapitre', 'soustheme'],
  notion: ['notion', 'concept'],
  typePedagogique: ['type', 'typepedagogique', 'nature'],
  difficulte: ['difficulte', 'niveau', 'difficulty'],
  question: ['question', 'enonce', 'recto', 'front'],
  reponse: ['reponse', 'answer', 'verso', 'back', 'solution', 'bonnereponse'],
  explication: ['explication', 'explanation', 'justification', 'commentaire'],
  astucePiege: ['astucepiege', 'astuce', 'piege', 'astuceoupiege', 'tip', 'astucespieges'],
  optionA: ['optiona', 'propositiona', 'choixa'],
  optionB: ['optionb', 'propositionb', 'choixb'],
  optionC: ['optionc', 'propositionc', 'choixc'],
  optionD: ['optiond', 'propositiond', 'choixd'],
  optionE: ['optione', 'propositione', 'choixe'],
};

function headerKey(h: string): string {
  return comparable(h).replace(/[^a-z0-9]/g, '');
}

/** Mapping : champ → index de colonne (ou absent). */
export type ColumnMapping = Partial<Record<TargetField, number>>;

/** Valeurs fixes appliquées à tout le fichier quand la colonne est absente ou vide. */
export type FixedValues = Partial<Record<'matiere' | 'theme' | 'lecon', string>>;

/** Détection automatique ; chaque colonne n'est utilisée qu'une fois. */
export function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const keys = headers.map(headerKey);
  for (const { field } of TARGET_FIELDS) {
    const syns = SYNONYMS[field];
    // On parcourt les synonymes par ordre de priorité
    for (const syn of syns) {
      const idx = keys.findIndex((k, i) => !used.has(i) && k === syn);
      if (idx >= 0) {
        mapping[field] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return mapping;
}

export interface MappingProblem {
  field?: TargetField;
  message: string;
}

export function validateMapping(mapping: ColumnMapping, fixed: FixedValues): MappingProblem[] {
  const problems: MappingProblem[] = [];
  if (mapping.question === undefined) problems.push({ field: 'question', message: 'Choisissez la colonne « Question ».' });
  if (mapping.reponse === undefined) problems.push({ field: 'reponse', message: 'Choisissez la colonne « Réponse ».' });
  if (mapping.matiere === undefined && !fixed.matiere?.trim()) {
    problems.push({ field: 'matiere', message: 'Choisissez la colonne « Matière » ou saisissez une matière pour tout le fichier.' });
  }
  const label = (f: TargetField) => TARGET_FIELDS.find((t) => t.field === f)?.label ?? f;
  const seen = new Map<number, TargetField>();
  for (const [field, idx] of Object.entries(mapping) as [TargetField, number | undefined][]) {
    if (idx === undefined) continue;
    const prev = seen.get(idx);
    if (prev) problems.push({ field, message: `La même colonne est utilisée pour « ${label(prev)} » et « ${label(field)} ».` });
    seen.set(idx, field);
  }
  return problems;
}
