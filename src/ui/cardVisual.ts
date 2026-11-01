// Refonte UX/UI (États visuels des cartes V1 figés) : apparence d'une carte. Fonction pure, testée.
// Source de vérité : la DERNIÈRE catégorie enregistrée par la révision programmée (reviewStates.lastRating), relue
// dans la base. Le retour d'un QCM (bonne réponse / réponse incorrecte) est transitoire et ne remplace jamais cette
// catégorie ; en test libre, rien n'est enregistré dans la révision : la carte garde sa catégorie de révision.
import type { SelfEval } from '../domain/types';

export type CardCategory = 'neutral' | SelfEval;
export type QcmFeedback = 'correct' | 'incorrect' | null;

export const CATEGORY_LABELS: Record<CardCategory, string> = {
  neutral: 'Jamais révisée',
  again: 'À revoir',
  hard: 'Difficile',
  good: 'Correct',
  easy: 'Facile',
};

export interface CardVisual {
  /** Classe de surface (fond, contour) : catégorie, ou retour QCM tant qu'il est affiché */
  surface: CardCategory | 'qcm-correct' | 'qcm-incorrect';
  /** Badge textuel (la couleur ne suffit jamais) */
  badge: string;
  /** Catégorie persistée, inchangée par le retour QCM */
  category: CardCategory;
}

export function cardVisual(latest: SelfEval | null | undefined, feedback: QcmFeedback): CardVisual {
  const category: CardCategory = latest ?? 'neutral';
  if (feedback === 'correct') return { surface: 'qcm-correct', badge: 'Bonne réponse', category };
  if (feedback === 'incorrect') return { surface: 'qcm-incorrect', badge: 'Réponse incorrecte', category };
  return { surface: category, badge: CATEGORY_LABELS[category], category };
}
