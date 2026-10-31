// Modèle de données central (lot 1). Aucune matière n'est codée en dur.

export type QuestionFormat = 'open' | 'mcq';

export interface McqOption {
  /** Lettre affichée : 'A' à 'E' */
  id: string;
  text: string;
}

export interface Card {
  /** Identifiant interne unique et stable (utilisé pour la progression) */
  cardId: string;
  collectionId: string;
  /** Identifiant présent dans le fichier source, s'il existe */
  externalId?: string;
  /**
   * v1.1 : identifiant source retiré lors de la migration v2 parce qu'une autre carte de la même collection
   * le portait déjà (cas de doublon antérieur). Conservé pour information, jamais utilisé pour la correspondance.
   */
  duplicateExternalId?: string;

  // Classement pédagogique (niveaux facultatifs sauf la matière)
  matiere: string;
  theme?: string;
  lecon?: string;
  notion?: string;

  typePedagogique?: string;
  difficulte?: string;

  formatQuestion: QuestionFormat;
  /** Énoncé affiché (pour un QCM : sans les options) */
  question: string;
  /** Texte de la colonne Question tel qu'importé, conservé intact */
  rawQuestion: string;
  options?: McqOption[];
  correctOptionId?: string;
  reponse: string;
  explication?: string;
  astucePiege?: string;

  /** Rang de l'enregistrement dans le fichier source (1 = première ligne de données) */
  sourceRow: number;
  /** Chemin hiérarchique indexé (matière␟thème␟leçon␟notion), voir taxonomy/tree.ts */
  pathKey: string;
  /** Fichier d'où provient la dernière version de la carte */
  sourceFile: string;
  /** Empreinte du contenu, pour détecter les modifications à la réimportation */
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  /** Lot 3B : date de la dernière modification faite dans l'application (formulaire ou fusion de libellés) */
  editedAt?: string;
}

export interface Collection {
  collectionId: string;
  name: string;
  /** Noms des fichiers importés dans cette collection, du plus ancien au plus récent */
  sourceFiles: string[];
  createdAt: string;
  updatedAt: string;
  /** Ordre de création, pour l'« ordre de la bibliothèque » */
  seq: number;
  /** Lot 3B : collection des cartes saisies dans l'application (créée à la première carte ajoutée) */
  manual?: boolean;
}

/** Projection légère d'une carte, gardée en mémoire pour l'arbre, les compteurs et la sélection. */
export interface CardMeta {
  cardId: string;
  collectionId: string;
  matiere: string;
  theme?: string;
  lecon?: string;
  notion?: string;
  formatQuestion: QuestionFormat;
  difficulte?: string;
  typePedagogique?: string;
  sourceRow: number;
}

export type ScopeSpec =
  | { kind: 'node'; nodeId: string }
  /** Lot 3A : union de plusieurs niveaux (matières, thèmes, leçons, notions), sans doublon */
  | { kind: 'multi'; nodeIds: string[] }
  | { kind: 'cards'; cardIds: string[]; label: string };

export type FormatFilter = 'all' | 'mcq' | 'open';
export type OrderMode = 'random' | 'library';

/** Lot 3A : statut de maîtrise d'une carte, en catégories exclusives */
export type MasteryBucket = 'new' | 'learning' | 'review' | 'mastered';

/** Valeur utilisée pour filtrer les cartes dont la difficulté ou le type n'est pas renseigné */
export const UNSET = '__non_renseigne__';

/**
 * Lot 3A : filtres d'un test libre. Dimensions différentes : cumulées (ET).
 * Plusieurs choix dans une même dimension : additionnés (OU). Liste vide = pas de filtre sur la dimension.
 */
export interface TestFilters {
  difficulties: string[];
  types: string[];
  statuses: MasteryBucket[];
}

export type CorrectionMode = 'immediate' | 'end';

export interface TimerConfig {
  /** 'off' : pas de chronomètre ; 'elapsed' : temps écoulé affiché ; 'limit' : compte à rebours, fin automatique */
  mode: 'off' | 'elapsed' | 'limit';
  /** Durée maximale en secondes (mode 'limit') */
  limitSec?: number;
  /**
   * Lot 3B, temps limité : true = entraînement chronométré (pause possible) ; absent ou false = simulation d'examen
   * (compte à rebours continu, sans pause). Le chronomètre « temps écoulé » peut toujours être mis en pause.
   */
  pausable?: boolean;
}

export interface TestConfig {
  /** Nombre demandé ; null = toutes les cartes éligibles */
  count: number | null;
  format: FormatFilter;
  order: OrderMode;
  /** Lot 3A (facultatif : absent sur les séances antérieures = aucun filtre) */
  filters?: TestFilters;
  /** Lot 3A : correction immédiate (défaut) ou en fin de test (test libre seulement) */
  correction?: CorrectionMode;
  /** Lot 3A : chronomètre (défaut : aucun) */
  timer?: TimerConfig;
}

/** Autoévaluation d'une question ouverte (mêmes libellés que la révision programmée du lot 2) */
export type SelfEval = 'again' | 'hard' | 'good' | 'easy';

export type AnswerRecord =
  /**
   * QCM : justesse objective (`correct`) et, en révision programmée seulement, sentiment de maîtrise (`rating`).
   * Lot 2 : réponse fausse → rating « again » automatique ; réponse juste → Difficile / Correct / Facile au choix.
   */
  | { kind: 'mcq'; selectedOptionId: string; correct: boolean; rating?: SelfEval; answeredAt: string; timeMs?: number }
  | { kind: 'open'; selfEval: SelfEval; answeredAt: string; timeMs?: number }
  /**
   * Lot 3A, correction en fin de test : question ouverte traitée, autoévaluation reportée à la phase de correction
   * (elle y est remplacée par un enregistrement 'open').
   */
  | { kind: 'deferred'; answeredAt: string; timeMs?: number };

export type SessionMode = 'libre' | 'revision';

export type SessionStatus = 'in_progress' | 'finished' | 'abandoned';

export interface TestSession {
  sessionId: string;
  /**
   * 'libre' : test libre, ne modifie JAMAIS les échéances.
   * 'revision' (lot 2) : révision programmée ; chaque évaluation met à jour l'état de mémorisation de la carte.
   */
  mode: SessionMode;
  scope: ScopeSpec;
  scopeLabel: string;
  config: TestConfig;
  /** Sélection figée pour la session (ordre de passage) */
  cardIds: string[];
  /** Position dans la séquence cardIds puis repeatIds */
  currentIndex: number;
  answers: Record<string, AnswerRecord>;
  /**
   * Lot 2 (révision) : cartes notées « À revoir » au premier passage, reproposées UNE fois en fin de séance,
   * dans l'ordre. Leurs réponses de reprise sont dans repeatAnswers (le premier passage n'est jamais écrasé).
   */
  repeatIds?: string[];
  repeatAnswers?: Record<string, AnswerRecord>;
  status: SessionStatus;
  /**
   * Lot 3A, correction en fin de test : 'questions' pendant le test, puis 'correction' (séance toujours en cours)
   * le temps de consulter les corrections et d'autoévaluer les questions ouvertes. Absent = 'questions'.
   */
  phase?: 'questions' | 'correction';
  /**
   * Lot 3A : temps des questions (ms), enregistré à chaque transition. Chronomètre « temps écoulé » : temps actif
   * (application affichée). Temps limité (v0.3.0-a2) : temps réel écoulé depuis le lancement, déduit de `deadlineAt`.
   */
  elapsedMs?: number;
  /**
   * v0.3.0-a2 : temps limité, échéance ABSOLUE (date ISO) enregistrée avec la séance au lancement. Le compte à rebours
   * continue application en arrière-plan, téléphone verrouillé ou navigateur fermé. Absent : pas de limite, ou séance
   * créée en 0.3.0-a/a1 (voir `withDeadline`).
   */
  deadlineAt?: string;
  /** Lot 3A : vrai si la limite de temps a mis fin aux questions */
  timedOut?: boolean;
  /**
   * Lot 3B : test en pause depuis cette date (ISO). Pendant la pause, le chronomètre est arrêté, la question et la
   * réponse sont masquées et aucune réponse n'est acceptée. À la reprise, l'échéance d'un test limité est reportée
   * de la durée de la pause.
   */
  pausedAt?: string;
  /**
   * v1.1.1 : numéro de version, incrémenté à chaque enregistrement d'une transition.
   * Absent sur les sessions plus anciennes (équivaut à 0). Sert à refuser l'écriture d'une copie périmée
   * (même test ouvert dans deux onglets).
   */
  revision?: number;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export const SELF_EVAL_LABELS: Record<SelfEval, string> = {
  again: 'À revoir',
  hard: 'Difficile',
  good: 'Correct',
  easy: 'Facile',
};
