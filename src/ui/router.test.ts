import { describe, expect, it } from 'vitest';
import { previousHash, trackHash } from './router';

describe('pile de navigation (retour sans boucle)', () => {
  it('bibliothèque → fiche → édition → retour : la fiche précède de nouveau la bibliothèque', () => {
    trackHash('#/library');
    trackHash('#/card/c1');
    trackHash('#/card/c1/edit');
    expect(previousHash()).toBe('#/card/c1');
    trackHash('#/card/c1'); // retour arrière du navigateur ou annulation
    expect(previousHash()).toBe('#/library');
    trackHash('#/library');
    expect(previousHash()).not.toBe('#/card/c1/edit');
  });
});
