// Comparaison d'un fichier avec une collection existante : nouvelles, modifiées, inchangées.
// L'unicité repose sur (collectionId, externalId). Rien n'est supprimé par une réimportation.
import type { Card } from '../domain/types';
import type { CardDraft } from './buildCards';

export interface PlannedUpdate {
  existing: Card;
  draft: CardDraft;
  /** Vrai si la question ou la réponse a changé (avertissement spécifique) */
  majorChange: boolean;
}

export interface ImportPlan {
  toAdd: CardDraft[];
  toUpdate: PlannedUpdate[];
  unchanged: number;
  /** Cartes de la collection absentes du fichier : conservées telles quelles */
  keptAbsent: number;
  /** v1.1 : cartes SANS identifiant ajoutées faute de correspondance exacte (doublon possible si modifiées) */
  addedWithoutId: number;
  /** v1.1 : cartes existantes sans identifiant qui n'ont pas été retrouvées à l'identique dans le fichier */
  unmatchedExistingWithoutId: number;
}

export function planImport(drafts: CardDraft[], existingInCollection: Card[]): ImportPlan {
  const byExternal = new Map<string, Card>();
  const noIdByHash = new Map<string, Card[]>();
  for (const c of existingInCollection) {
    if (c.externalId) byExternal.set(c.externalId, c);
    else {
      const list = noIdByHash.get(c.contentHash) ?? [];
      list.push(c);
      noIdByHash.set(c.contentHash, list);
    }
  }

  const matched = new Set<string>();
  const plan: ImportPlan = { toAdd: [], toUpdate: [], unchanged: 0, keptAbsent: 0, addedWithoutId: 0, unmatchedExistingWithoutId: 0 };

  for (const d of drafts) {
    if (d.externalId) {
      const ex = byExternal.get(d.externalId);
      if (!ex) {
        plan.toAdd.push(d);
        continue;
      }
      matched.add(ex.cardId);
      if (ex.contentHash === d.contentHash) plan.unchanged++;
      else
        plan.toUpdate.push({
          existing: ex,
          draft: d,
          majorChange: ex.rawQuestion !== d.rawQuestion || ex.reponse !== d.reponse,
        });
    } else {
      // Sans identifiant : reconnaissance uniquement si le contenu est strictement identique
      const list = noIdByHash.get(d.contentHash);
      const ex = list?.shift();
      if (ex) {
        matched.add(ex.cardId);
        plan.unchanged++;
      } else {
        // Aucune correspondance approximative : une carte modifiée sans identifiant devient une nouvelle carte
        plan.toAdd.push(d);
        plan.addedWithoutId++;
      }
    }
  }
  const absent = existingInCollection.filter((c) => !matched.has(c.cardId));
  plan.keptAbsent = absent.length;
  plan.unmatchedExistingWithoutId = absent.filter((c) => !c.externalId).length;
  return plan;
}
