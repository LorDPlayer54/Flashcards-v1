import { describe, expect, it } from 'vitest';
import {
  answerLooksLikeOptionLetter,
  buildOptionsFromColumns,
  findDuplicateOptions,
  looksLikeEmbeddedMcq,
  parseEmbeddedOptions,
  resolveAnswer,
} from './qcmParser';

describe('parseEmbeddedOptions', () => {
  it('reconnaît 5 options sur une seule ligne (format du CSV de référence)', () => {
    const r = parseEmbeddedOptions('Quel est le carré de 13 ?\nA) 135  B) 169  C) 203  D) 152  E) 186');
    expect(r).not.toBeNull();
    expect(r!.stem).toBe('Quel est le carré de 13 ?');
    expect(r!.options.map((o) => o.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(r!.options[1]).toEqual({ id: 'B', text: '169' });
  });

  it('reconnaît des options sur plusieurs lignes', () => {
    const r = parseEmbeddedOptions('Variation ?\nA) 0 %\nB) −1 %\nC) +1 %');
    expect(r!.options).toEqual([
      { id: 'A', text: '0 %' },
      { id: 'B', text: '−1 %' },
      { id: 'C', text: '+1 %' },
    ]);
  });

  it('conserve les options contenant des phrases et de la ponctuation', () => {
    const r = parseEmbeddedOptions(
      'Comment retrouver un facteur manquant dans 8 × ? = 104 ?\nA) Multiplier 3 par 4 puis accoler 25 : 1 225.  B) Diviser 104 par 8.  C) Décaler la virgule.',
    );
    expect(r!.options[0]!.text).toBe('Multiplier 3 par 4 puis accoler 25 : 1 225.');
    expect(r!.options[1]!.text).toBe('Diviser 104 par 8.');
  });

  it("ne confond pas une lettre isolée de l'énoncé avec une option", () => {
    expect(parseEmbeddedOptions('Un tableau indique 13 personnes dans A et 4 dans A et B. Combien ?')).toBeNull();
  });

  it('refuse une seule option, un énoncé vide ou une option vide', () => {
    expect(parseEmbeddedOptions('Question ?\nA) seule')).toBeNull();
    expect(parseEmbeddedOptions('A) un  B) deux')).toBeNull();
    expect(parseEmbeddedOptions('Question ?\nA)  B) deux')).toBeNull();
  });

  it('refuse une suite de lettres non consécutive ou suivie de marqueurs parasites', () => {
    expect(parseEmbeddedOptions('Question ?\nA) un  C) trois')).toBeNull();
    expect(parseEmbeddedOptions('Question ?\nA) un  B) deux  A) encore')).toBeNull();
  });
});

describe('resolveAnswer', () => {
  const opts = [
    { id: 'A', text: '1722' },
    { id: 'B', text: '1550' },
    { id: 'C', text: 'Diviser 104 par 8.' },
  ];
  it('accepte « A) 1722 »', () => expect(resolveAnswer('A) 1722', opts)).toEqual({ status: 'ok', correctOptionId: 'A' }));
  it('accepte la lettre seule', () => expect(resolveAnswer('B', opts)).toEqual({ status: 'ok', correctOptionId: 'B' }));
  it('accepte « C. texte »', () => expect(resolveAnswer('C. Diviser 104 par 8', opts)).toEqual({ status: 'ok', correctOptionId: 'C' }));
  it('accepte le texte exact d’une option', () => expect(resolveAnswer('1550', opts)).toEqual({ status: 'ok', correctOptionId: 'B' }));
  it('signale une lettre et un texte discordants', () => expect(resolveAnswer('A) 1550', opts).status).toBe('ambiguous'));
  it('signale une lettre inexistante', () => expect(resolveAnswer('D) 12', opts).status).toBe('ambiguous'));
  it('ne prend pas un mot commençant par une lettre pour une lettre', () =>
    expect(resolveAnswer('Bien sûr', opts).status).toBe('ambiguous'));
  it('signale une réponse vide', () => expect(resolveAnswer('  ', opts).status).toBe('ambiguous'));
});

describe('buildOptionsFromColumns', () => {
  it('construit les options présentes', () =>
    expect(buildOptionsFromColumns(['x', 'y', '', undefined])).toEqual([
      { id: 'A', text: 'x' },
      { id: 'B', text: 'y' },
    ]));
  it('refuse un trou dans les options', () => expect(buildOptionsFromColumns(['x', '', 'z'])).toBeNull());
  it('refuse moins de deux options', () => expect(buildOptionsFromColumns(['x'])).toBeNull());
});

describe('contrôles v1.1', () => {
  it('détecte les propositions identiques après normalisation', () => {
    expect(
      findDuplicateOptions([
        { id: 'A', text: 'Été' },
        { id: 'B', text: 'autre' },
        { id: 'C', text: ' ete. ' },
        { id: 'D', text: 'AUTRE' },
      ]),
    ).toEqual([
      ['A', 'C'],
      ['B', 'D'],
    ]);
    expect(findDuplicateOptions([{ id: 'A', text: '1,5' }, { id: 'B', text: '15' }])).toEqual([]);
  });
  it('reconnaît un texte qui ressemble à un QCM', () => {
    expect(looksLikeEmbeddedMcq('Q ?\nA) un  C) trois')).toBe(true);
    expect(looksLikeEmbeddedMcq('Dans A et B, combien ?')).toBe(false);
    expect(looksLikeEmbeddedMcq('Voir B) seulement')).toBe(false);
  });
  it('reconnaît une réponse en forme de lettre', () => {
    expect(answerLooksLikeOptionLetter('B) 4')).toBe(true);
    expect(answerLooksLikeOptionLetter('Bien sûr')).toBe(false);
  });
});
