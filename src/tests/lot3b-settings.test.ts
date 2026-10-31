// Lot 3B : préférences d'affichage et de correction.
import { describe, expect, it } from 'vitest';
import { applyAppearance, DEFAULT_APPEARANCE, parseAppearance, parseCorrectionPref } from '../settings/preferences';

describe('préférences', () => {
  it('lecture tolérante : valeur absente ou inattendue → réglage par défaut', () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance({ theme: 'violet', text: 'énorme' })).toEqual({ theme: 'system', text: 'normal' });
    expect(parseAppearance({ theme: 'dark', text: 'large' })).toEqual({ theme: 'dark', text: 'large' });
    expect(parseCorrectionPref(undefined)).toBe('last');
    expect(parseCorrectionPref('end')).toBe('end');
    expect(parseCorrectionPref('autre')).toBe('last');
  });

  it('application : attributs lus par la feuille de style ; « automatique » retire le thème forcé', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyAppearance({ theme: 'dark', text: 'large' }, root);
    expect(root.dataset).toEqual({ theme: 'dark', text: 'large' });
    applyAppearance({ theme: 'system', text: 'normal' }, root);
    expect(root.dataset).toEqual({});
  });
});
