import { describe, expect, it } from 'vitest';
import type { Card } from '../domain/types';
import { highlight, snippetFor } from './snippet';
import { queryTerms } from './search';

const card = (o: Partial<Card>): Card => ({ cardId: 'c', question: 'Quel est le rôle du Conseil ?', rawQuestion: 'Quel est le rôle du Conseil ?', reponse: '', ...o }) as Card;

describe('snippet', () => {
  it('surligne sans tenir compte des accents ni de la casse, en conservant le texte original', () => {
    const s = highlight('Le CONSEIL d’État décide', queryTerms('etat conseil'));
    expect(s.map((x) => x.text).join('')).toBe('Le CONSEIL d’État décide');
    expect(s.filter((x) => x.hit).map((x) => x.text)).toEqual(['CONSEIL', 'État']);
  });
  it('donne un extrait de la réponse quand le terme est hors question', () => {
    const sn = snippetFor(card({ reponse: 'Il contrôle la constitutionnalité des lois organiques.' }), queryTerms('constitutionnalite'));
    expect(sn?.label).toBe('Réponse');
    expect(sn?.segments.some((x) => x.hit && x.text === 'constitutionnalité')).toBe(true);
  });
  it('pas d’extrait si tous les termes sont dans la question', () => {
    expect(snippetFor(card({ reponse: 'conseil' }), queryTerms('conseil'))).toBeNull();
  });
  it('le contenu balisé reste du texte', () => {
    const s = highlight('<img src=x onerror=alert(1)> conseil', ['conseil']);
    expect(s[0]!.text).toBe('<img src=x onerror=alert(1)> ');
  });
});
