// v0.3.0-a2 : actualisation de l'aperçu d'un test libre après un lancement refusé (sélection modifiée ailleurs).
// L'aperçu n'est déclaré « actualisé » qu'une fois la bibliothèque rechargée ET les statuts de maîtrise relus pour
// cette bibliothèque, sans erreur. Fonction pure, testée (src/tests/v030a2.test.ts).
import type { CardMeta } from '../domain/types';

export type LibraryReload = { status: 'loading' } | { status: 'done' } | { status: 'failed'; error: string };

export type RefreshPhase = { phase: 'loading' } | { phase: 'done' } | { phase: 'failed'; error: string };

export function previewRefreshPhase(
  library: LibraryReload,
  states: { loadedFor: readonly CardMeta[] | null; error: string | null },
  currentMetas: readonly CardMeta[],
): RefreshPhase {
  if (library.status === 'failed') return { phase: 'failed', error: library.error };
  if (library.status === 'loading') return { phase: 'loading' };
  // Statuts pas encore relus pour la bibliothèque rechargée
  if (states.loadedFor !== currentMetas) return { phase: 'loading' };
  if (states.error) return { phase: 'failed', error: states.error };
  return { phase: 'done' };
}
