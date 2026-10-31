// Lot 3B : saisie et modification manuelles d'une carte. Fonctions pures, testées.
//
// Règles :
//  - tous les champs pédagogiques sont modifiables : matière (obligatoire), thème, leçon, notion, type, difficulté,
//    format, question, propositions et bonne réponse (QCM), réponse (question ouverte), explication, astuce/piège ;
//  - aucun champ n'est inventé : un champ vide reste absent ;
//  - QCM : 2 à 5 propositions A–E consécutives, distinctes, et une bonne réponse désignée ; la réponse affichée est
//    « B) texte », comme dans les fichiers importés ;
//  - le texte importé est conservé tel quel tant que la question (ou les propositions) n'est pas modifiée, afin qu'une
//    réimportation du même fichier reconnaisse la carte comme inchangée ;
//  - `majorChange` : question, propositions, bonne réponse ou réponse modifiée → choix explicite de conserver ou de
//    réinitialiser l'état de mémorisation de cette carte (comme lors d'une réimportation).
import type { Card, McqOption, QuestionFormat } from '../domain/types';
import { cleanLabel, cleanText, comparable, normalizeDifficulty } from '../domain/text';

export const OPTION_IDS = ['A', 'B', 'C', 'D', 'E'] as const;

export interface CardForm {
  matiere: string;
  theme: string;
  lecon: string;
  notion: string;
  typePedagogique: string;
  difficulte: string;
  formatQuestion: QuestionFormat;
  question: string;
  /** Cinq emplacements A–E ; les emplacements vides en fin de liste sont ignorés */
  options: string[];
  /** Indice de la bonne proposition (QCM) */
  correctIndex: number | null;
  reponse: string;
  explication: string;
  astucePiege: string;
}

/** Contenu pédagogique d'une carte, sans identité ni provenance */
export type CardContent = Pick<
  Card,
  | 'matiere'
  | 'theme'
  | 'lecon'
  | 'notion'
  | 'typePedagogique'
  | 'difficulte'
  | 'formatQuestion'
  | 'question'
  | 'rawQuestion'
  | 'options'
  | 'correctOptionId'
  | 'reponse'
  | 'explication'
  | 'astucePiege'
>;

export type FormField = keyof CardForm | 'form';
export type FormResult = { ok: true; content: CardContent; majorChange: boolean } | { ok: false; errors: Partial<Record<FormField, string>> };

const pad = (opts: string[]) => [...opts, '', '', '', '', ''].slice(0, 5);

/** Formulaire initial : carte existante, ou carte nouvelle préremplie d'après le niveau consulté. */
export function formFromCard(card?: Card, prefill: Partial<Pick<Card, 'matiere' | 'theme' | 'lecon' | 'notion'>> = {}): CardForm {
  if (!card) {
    return {
      matiere: prefill.matiere ?? '',
      theme: prefill.theme ?? '',
      lecon: prefill.lecon ?? '',
      notion: prefill.notion ?? '',
      typePedagogique: '',
      difficulte: '',
      formatQuestion: 'open',
      question: '',
      options: pad([]),
      correctIndex: null,
      reponse: '',
      explication: '',
      astucePiege: '',
    };
  }
  const options = card.options ?? [];
  const idx = options.findIndex((o) => o.id === card.correctOptionId);
  return {
    matiere: card.matiere,
    theme: card.theme ?? '',
    lecon: card.lecon ?? '',
    notion: card.notion ?? '',
    typePedagogique: card.typePedagogique ?? '',
    difficulte: card.difficulte ?? '',
    formatQuestion: card.formatQuestion,
    question: card.question,
    options: pad(options.map((o) => o.text)),
    correctIndex: idx >= 0 ? idx : null,
    reponse: card.formatQuestion === 'open' ? card.reponse : '',
    explication: card.explication ?? '',
    astucePiege: card.astucePiege ?? '',
  };
}

/** Réponse affichée d'un QCM, au format des fichiers importés */
export const mcqAnswerText = (o: McqOption) => `${o.id}) ${o.text}`;

const sameOptions = (a: McqOption[] | undefined, b: McqOption[]) =>
  Boolean(a) && a!.length === b.length && a!.every((o, i) => o.id === b[i]!.id && o.text === b[i]!.text);

/** Valide le formulaire et construit le contenu de la carte. `existing` : carte modifiée (absente à la création). */
export function contentFromForm(form: CardForm, existing?: Card): FormResult {
  const errors: Partial<Record<FormField, string>> = {};
  const matiere = cleanLabel(form.matiere);
  if (!matiere) errors.matiere = 'La matière est obligatoire.';
  const question = cleanText(form.question);
  if (!question) errors.question = 'La question est obligatoire.';

  let options: McqOption[] | undefined;
  let correctOptionId: string | undefined;
  let reponse: string | undefined;
  let rawQuestion = question ?? '';

  if (form.formatQuestion === 'mcq') {
    const texts = form.options.map((t) => cleanText(t) ?? '');
    let last = -1;
    texts.forEach((t, i) => {
      if (t) last = i;
    });
    const used = texts.slice(0, last + 1);
    if (used.length < 2) errors.options = 'Un QCM comporte au moins deux propositions (A et B).';
    else if (used.some((t) => !t)) errors.options = 'Les propositions doivent se suivre sans emplacement vide (A, B, C…).';
    else {
      const seen = new Map<string, string>();
      for (const [i, t] of used.entries()) {
        const k = comparable(t);
        if (seen.has(k)) {
          errors.options = `Les propositions ${seen.get(k)} et ${OPTION_IDS[i]} sont identiques.`;
          break;
        }
        seen.set(k, OPTION_IDS[i]!);
      }
    }
    if (!errors.options) {
      options = used.map((text, i) => ({ id: OPTION_IDS[i]!, text }));
      const chosen = form.correctIndex !== null ? options[form.correctIndex] : undefined;
      if (!chosen) errors.correctIndex = 'Indiquez la bonne réponse.';
      else {
        correctOptionId = chosen.id;
        const before = existing?.formatQuestion === 'mcq' ? existing.options?.find((o) => o.id === existing.correctOptionId) : undefined;
        // Réponse importée conservée tant que la bonne proposition est inchangée
        reponse = before && before.id === chosen.id && before.text === chosen.text ? existing!.reponse : mcqAnswerText(chosen);
      }
      if (question) {
        rawQuestion =
          existing?.formatQuestion === 'mcq' && existing.question === question && sameOptions(existing.options, options)
            ? existing.rawQuestion
            : `${question}\n${options.map(mcqAnswerText).join('\n')}`;
      }
    }
  } else {
    reponse = cleanText(form.reponse);
    if (!reponse) errors.reponse = 'La réponse est obligatoire.';
    if (question) rawQuestion = existing?.formatQuestion === 'open' && existing.question === question ? existing.rawQuestion : question;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const content: CardContent = {
    matiere: matiere!,
    theme: cleanLabel(form.theme),
    lecon: cleanLabel(form.lecon),
    notion: cleanLabel(form.notion),
    typePedagogique: cleanLabel(form.typePedagogique),
    difficulte: normalizeDifficulty(form.difficulte),
    formatQuestion: form.formatQuestion,
    question: question!,
    rawQuestion,
    options,
    correctOptionId,
    reponse: reponse!,
    explication: cleanText(form.explication),
    astucePiege: cleanText(form.astucePiege),
  };
  const majorChange = existing
    ? existing.rawQuestion !== content.rawQuestion || existing.reponse !== content.reponse || existing.correctOptionId !== content.correctOptionId
    : false;
  return { ok: true, content, majorChange };
}

/** Vrai si le contenu diffère de la carte (pour ne pas enregistrer une modification vide). */
export function contentChanged(existing: Card, content: CardContent): boolean {
  const keys = Object.keys(content) as (keyof CardContent)[];
  const all = new Set<keyof CardContent>([...keys, 'theme', 'lecon', 'notion', 'typePedagogique', 'difficulte', 'options', 'correctOptionId', 'explication', 'astucePiege']);
  return [...all].some((k) => JSON.stringify(existing[k] ?? null) !== JSON.stringify(content[k] ?? null));
}
