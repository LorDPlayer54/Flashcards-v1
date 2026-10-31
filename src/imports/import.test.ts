import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Card } from '../domain/types';
import { buildCards, rejectedToIssues } from './buildCards';
import { autoDetectMapping, validateMapping } from './columnMapping';
import { decodeBytes, guessDelimiter, parseCsvBytes, parseCsvText } from './csvParse';
import { planImport } from './importPlan';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url)));

describe('lecture CSV', () => {
  it('retire le BOM UTF-8 et détecte la virgule', () => {
    const p = parseCsvBytes(fixture('mini_reference_fictif.csv'));
    expect(p.hadBom).toBe(true);
    expect(p.encoding).toBe('utf-8');
    expect(p.delimiter).toBe(',');
    expect(p.headers[0]).toBe('ID');
    expect(p.rows).toHaveLength(7);
  });

  it('détecte le point-virgule et les champs multilignes', () => {
    const p = parseCsvBytes(fixture('anglais_fictif.csv'));
    expect(p.delimiter).toBe(';');
    expect(p.rows).toHaveLength(1000);
    expect(p.rows[2]![7]).toContain('\nA) ');
  });

  it('se replie sur Windows-1252 si le fichier n’est pas en UTF-8', () => {
    const bytes = new Uint8Array([0x4d, 0x61, 0x74, 0x69, 0xe8, 0x72, 0x65]); // « Matière » en Windows-1252
    const d = decodeBytes(bytes);
    expect(d.encoding).toBe('windows-1252');
    expect(d.text).toBe('Matière');
  });

  // ---- v1.1, I2 : jamais de troncature ni de complément silencieux ----
  it('rejette une ligne trop courte (au lieu de la compléter)', () => {
    const p = parseCsvText('Question,Réponse,Matière\n"Q1","R1"\n"Q2","R2","M"\n');
    expect(p.rows).toEqual([['Q2', 'R2', 'M']]);
    expect(p.rowNumbers).toEqual([2]);
    expect(p.rejected).toEqual([{ row: 1, reason: expect.stringContaining('2 colonne(s) au lieu de 3') }]);
  });

  it('rejette une ligne trop longue contenant des valeurs hors en-tête (au lieu de les tronquer)', () => {
    const p = parseCsvText('Question,Réponse\nQ1,R1,valeur perdue\nQ2,R2\n');
    expect(p.rows).toEqual([['Q2', 'R2']]);
    expect(p.rejected[0]).toMatchObject({ row: 1 });
    expect(p.rejected[0]!.reason).toContain('seraient perdues');
  });

  it('accepte une ligne trop longue dont les colonnes en trop sont vides (aucune perte)', () => {
    const p = parseCsvText('Question,Réponse\nQ1,R1,,\n');
    expect(p.rows).toEqual([['Q1', 'R1']]);
    expect(p.rejected).toEqual([]);
    expect(p.warnings.join(' ')).toContain('aucune donnée perdue');
  });

  it('rejette les guillemets mal placés et non fermés', () => {
    const invalid = parseCsvText('Question,Réponse\n"x"y",z\nQ2,R2\n');
    expect(invalid.rejected[0]).toMatchObject({ row: 1, reason: expect.stringContaining('guillemets mal placés') });
    expect(invalid.rows).toEqual([['Q2', 'R2']]);
    const missing = parseCsvText('Question;Réponse\nQ1;R1\n"x;y\nQ3;R3\n');
    expect(missing.rows).toEqual([['Q1', 'R1']]);
    expect(missing.rejected[0]).toMatchObject({ row: 2, reason: expect.stringContaining('guillemet non fermé') });
  });

  it('déduit le séparateur de la ligne d’en-tête, en ignorant les virgules entre guillemets', () => {
    expect(guessDelimiter('"Astuce, piège";Question;Réponse\n')).toBe(';');
    expect(guessDelimiter('Question\tRéponse')).toBe('\t');
    expect(guessDelimiter('Question')).toBe(',');
  });

  it('accepte un champ multiligne légitime', () => {
    const p = parseCsvText('Question,Réponse\n"Ligne 1\nA) x  B) y",B\n');
    expect(p.rejected).toEqual([]);
    expect(p.rows[0]![0]).toBe('Ligne 1\nA) x  B) y');
  });

  it('conserve le rang d’origine des cartes après exclusion d’une ligne', () => {
    const p = parseCsvText('ID,Question,Réponse\nX1,Q1\nX2,Q2,R2\n');
    const r = buildCards(p.rows, { externalId: 0, question: 1, reponse: 2 }, { matiere: 'M' }, { rowNumbers: p.rowNumbers });
    expect(r.drafts[0]!.sourceRow).toBe(2);
    expect(rejectedToIssues(p.rejected)[0]).toMatchObject({ row: 1, severity: 'error', kind: 'malformed' });
  });
});

describe('correspondance des colonnes', () => {
  it('reconnaît les colonnes du format de référence', () => {
    const m = autoDetectMapping(['ID', 'Matière', 'Sous-catégorie', 'Notion', 'Type', 'Difficulté', 'Question', 'Réponse', 'Explication', 'Astuce / Piège']);
    expect(m).toEqual({
      externalId: 0,
      matiere: 1,
      theme: 2,
      notion: 3,
      typePedagogique: 4,
      difficulte: 5,
      question: 6,
      reponse: 7,
      explication: 8,
      astucePiege: 9,
    });
    expect(m.lecon).toBeUndefined();
  });

  it('exige question, réponse et matière (colonne ou valeur fixe)', () => {
    expect(validateMapping({}, {}).length).toBe(3);
    expect(validateMapping({ question: 0, reponse: 1 }, { matiere: 'Anglais' })).toEqual([]);
  });
});

describe('construction des cartes', () => {
  it('importe le mini-fichier : QCM reconnus, carte ambiguë exclue et signalée', () => {
    const p = parseCsvBytes(fixture('mini_reference_fictif.csv'));
    const r = buildCards(p.rows, autoDetectMapping(p.headers), {});
    expect(r.drafts).toHaveLength(6);
    const byId = Object.fromEntries(r.drafts.map((d) => [d.externalId, d]));
    expect(byId['FIC-002']!.formatQuestion).toBe('mcq');
    expect(byId['FIC-002']!.correctOptionId).toBe('A');
    expect(byId['FIC-002']!.question).toBe('Calcule 1/2 + 1/4.');
    expect(byId['FIC-003']!.correctOptionId).toBe('B');
    expect(byId['FIC-005']!.correctOptionId).toBe('B');
    // FIC-006 : réponse « C) » absente des options → exclue par défaut (v1.1, I3), jamais un QCM faussement corrigé
    expect(byId['FIC-006']).toBeUndefined();
    expect(r.issues).toEqual([expect.objectContaining({ externalId: 'FIC-006', severity: 'error', kind: 'ambiguous-mcq' })]);
    // Sur choix explicite seulement : importée comme question ouverte
    const asOpen = buildCards(p.rows, autoDetectMapping(p.headers), {}, { ambiguousMcqAsOpen: true });
    expect(asOpen.drafts.find((d) => d.externalId === 'FIC-006')!.formatQuestion).toBe('open');
    expect(asOpen.issues[0]).toMatchObject({ severity: 'warning', kind: 'ambiguous-mcq' });
    // FIC-007 : pas de thème ni de notion → aucun niveau inventé
    expect(byId['FIC-007']!.theme).toBeUndefined();
    expect(byId['FIC-007']!.notion).toBeUndefined();
    // Texte source intact
    expect(byId['FIC-003']!.rawQuestion).toBe(p.rows[2]![6]!.trim());
  });

  it('lit les options en colonnes séparées', () => {
    const p = parseCsvBytes(fixture('economie_fictif.csv'));
    const r = buildCards(p.rows, autoDetectMapping(p.headers), {});
    expect(r.drafts).toHaveLength(1100);
    expect(r.drafts.filter((d) => d.formatQuestion === 'mcq')).toHaveLength(550);
    expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    // Thème « Finances publiques » sans leçon
    expect(r.drafts.filter((d) => d.theme === 'Finances publiques').every((d) => d.lecon === undefined)).toBe(true);
  });

  it('ignore les lignes sans question/réponse et les ID en double, en le signalant', () => {
    const rows = [
      ['X1', 'Q1', 'R1'],
      ['X2', '', 'R2'],
      ['X3', 'Q3', ''],
      ['X1', 'Q4', 'R4'],
    ];
    const r = buildCards(rows, { externalId: 0, question: 1, reponse: 2 }, { matiere: 'Test' });
    expect(r.drafts.map((d) => d.externalId)).toEqual(['X1']);
    expect(r.issues.filter((i) => i.severity === 'error').map((i) => i.row)).toEqual([2, 3, 4]);
  });

  it('applique une valeur fixe de matière/thème sans écraser une valeur de colonne', () => {
    const rows = [
      ['Q1', 'R1', 'Anglais'],
      ['Q2', 'R2', ''],
    ];
    const r = buildCards(rows, { question: 0, reponse: 1, matiere: 2 }, { matiere: 'Économie', theme: 'Général' });
    expect(r.drafts.map((d) => d.matiere)).toEqual(['Anglais', 'Économie']);
    expect(r.drafts.every((d) => d.theme === 'Général')).toBe(true);
    expect(r.fileWarnings[0]).toContain('sans identifiant');
  });
});

describe('réimportation', () => {
  const toCard = (d: ReturnType<typeof buildCards>['drafts'][number], i: number): Card => ({
    ...d,
    cardId: `c${i}`,
    collectionId: 'col1',
    pathKey: '',
    sourceFile: 'f.csv',
    createdAt: 't0',
    updatedAt: 't0',
  });

  it('repère nouvelles, modifiées et inchangées sans rien supprimer', () => {
    const v1 = buildCards(
      [
        ['A1', 'Q1', 'R1'],
        ['A2', 'Q2', 'R2'],
        ['A3', 'Q3', 'R3'],
      ],
      { externalId: 0, question: 1, reponse: 2 },
      { matiere: 'M' },
    ).drafts;
    const existing = v1.map(toCard);
    const v2 = buildCards(
      [
        ['A1', 'Q1', 'R1'],
        ['A2', 'Q2', 'R2 modifiée'],
        ['A4', 'Q4', 'R4'],
      ],
      { externalId: 0, question: 1, reponse: 2 },
      { matiere: 'M' },
    ).drafts;
    const plan = planImport(v2, existing);
    expect(plan.unchanged).toBe(1);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0]!.existing.cardId).toBe('c1');
    expect(plan.toUpdate[0]!.majorChange).toBe(true);
    expect(plan.toAdd.map((d) => d.externalId)).toEqual(['A4']);
    expect(plan.keptAbsent).toBe(1); // A3 conservée
  });

  it('reconnaît les cartes sans ID uniquement si leur contenu est identique', () => {
    const v1 = buildCards([['Q1', 'R1'], ['Q1', 'R1']], { question: 0, reponse: 1 }, { matiere: 'M' }).drafts;
    const existing = v1.map(toCard);
    const plan = planImport(
      buildCards([['Q1', 'R1'], ['Q1', 'R1'], ['Q1', 'R1'], ['Q2', 'R2']], { question: 0, reponse: 1 }, { matiere: 'M' }).drafts,
      existing,
    );
    expect(plan.unchanged).toBe(2);
    expect(plan.toAdd).toHaveLength(2);
    expect(plan.addedWithoutId).toBe(2);
  });

  it('une carte sans ID modifiée n’est jamais assimilée à l’ancienne : ajoutée et signalée, l’ancienne conservée', () => {
    const existing = buildCards([['Q1', 'R1']], { question: 0, reponse: 1 }, { matiere: 'M' }).drafts.map(toCard);
    const plan = planImport(buildCards([['Q1', 'R1 corrigée']], { question: 0, reponse: 1 }, { matiere: 'M' }).drafts, existing);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toAdd).toHaveLength(1);
    expect(plan).toMatchObject({ addedWithoutId: 1, unmatchedExistingWithoutId: 1, keptAbsent: 1 });
  });

  it('un import identique ne produit aucun ajout', () => {
    const p = parseCsvBytes(fixture('mini_reference_fictif.csv'));
    const drafts = buildCards(p.rows, autoDetectMapping(p.headers), {}).drafts;
    const plan = planImport(drafts, drafts.map(toCard));
    expect(plan).toMatchObject({ unchanged: 6, keptAbsent: 0 });
    expect(plan.toAdd).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
  });
});

describe('QCM ambigus (v1.1, I3) — jamais de correction attribuée arbitrairement', () => {
  const m = { externalId: 0, question: 1, reponse: 2 } as const;
  const one = (q: string, r: string) => buildCards([['X', q, r]], m, { matiere: 'M' });

  it('QCM valide à 2 propositions', () => {
    const r = one('Vrai ou faux ?\nA) Vrai  B) Faux', 'B) Faux');
    expect(r.drafts[0]).toMatchObject({ formatQuestion: 'mcq', correctOptionId: 'B' });
    expect(r.issues).toEqual([]);
  });

  it.each([
    ['réponse inexistante', 'Q ?\nA) un  B) deux', 'C) trois'],
    ['lettre incohérente avec le texte', 'Q ?\nA) un  B) deux', 'A) deux'],
    ['réponse sans correspondance', 'Q ?\nA) un  B) deux', 'quatre'],
    ['propositions identiques', 'Q ?\nA) Été  B) ete.  C) autre', 'C) autre'],
    ['propositions identiques (espaces)', 'Q ?\nA) 1 225  B) 1225  C) 12', 'A'],
    ['marqueurs non consécutifs', 'Q ?\nA) un  C) trois', 'A'],
    ['proposition vide', 'Q ?\nA)  B) deux', 'B'],
    ['lettre de réponse sans propositions', 'Combien font 2 + 2 ?', 'B) 4'],
  ])('%s → carte exclue et signalée', (_label, q, r) => {
    const res = one(q, r);
    expect(res.drafts).toEqual([]);
    expect(res.issues).toEqual([expect.objectContaining({ severity: 'error', kind: 'ambiguous-mcq', row: 1, externalId: 'X' })]);
  });

  it('options en colonnes incomplètes → exclue', () => {
    const r = buildCards(
      [['Q ?', 'un', '', 'trois', 'A']],
      { question: 0, optionA: 1, optionB: 2, optionC: 3, reponse: 4 },
      { matiere: 'M' },
    );
    expect(r.drafts).toEqual([]);
    expect(r.issues[0]).toMatchObject({ kind: 'ambiguous-mcq', severity: 'error' });
  });

  it('options en colonnes identiques → exclue', () => {
    const r = buildCards([['Q ?', 'Oui', 'oui', 'B']], { question: 0, optionA: 1, optionB: 2, reponse: 3 }, { matiere: 'M' });
    expect(r.issues[0]!.message).toContain('propositions identiques');
  });

  it('une question ouverte ordinaire n’est pas concernée', () => {
    const r = one('Un tableau indique 13 personnes dans A et 4 dans A et B. Combien ?', '9');
    expect(r.drafts[0]!.formatQuestion).toBe('open');
    expect(r.issues).toEqual([]);
  });

  it('un ID déjà vu reste réservé même si sa première ligne est exclue', () => {
    const r = buildCards(
      [
        ['X', 'Q ?\nA) un  B) deux', 'C'],
        ['X', 'Autre question', 'R'],
      ],
      m,
      { matiere: 'M' },
    );
    expect(r.drafts).toEqual([]);
    expect(r.issues.map((i) => i.kind)).toEqual(['ambiguous-mcq', 'duplicate-id']);
  });
});
