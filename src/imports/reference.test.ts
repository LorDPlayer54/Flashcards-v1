// Recette sur le VRAI fichier de 500 cartes. Le fichier n'est jamais versionné :
// il faut indiquer son chemin dans la variable REF_CSV (voir README). Sans elle, le test est ignoré.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCards } from './buildCards';
import { autoDetectMapping } from './columnMapping';
import { parseCsvBytes } from './csvParse';

const path = process.env.REF_CSV;

describe.skipIf(!path)('CSV de référence (REF_CSV)', () => {
  it('importe exactement 500 cartes : 300 Calcul, 200 Raisonnement, 178 QCM, 322 ouvertes', () => {
    const parsed = parseCsvBytes(new Uint8Array(readFileSync(path!)));
    const mapping = autoDetectMapping(parsed.headers);
    const { drafts, issues } = buildCards(parsed.rows, mapping, {}, { rowNumbers: parsed.rowNumbers });

    expect(parsed.rejected).toEqual([]); // v1.1 : aucune ligne mal formée
    expect(parsed.rows).toHaveLength(500);
    expect(drafts).toHaveLength(500);
    expect(issues).toEqual([]);
    expect(drafts.filter((d) => d.matiere === 'Calcul')).toHaveLength(300);
    expect(drafts.filter((d) => d.matiere === 'Raisonnement')).toHaveLength(200);
    expect(drafts.filter((d) => d.formatQuestion === 'mcq')).toHaveLength(178);
    expect(drafts.filter((d) => d.formatQuestion === 'open')).toHaveLength(322);
    expect(new Set(drafts.map((d) => `${d.matiere}/${d.theme}`)).size).toBe(25);
    expect(drafts.every((d) => d.lecon === undefined)).toBe(true);

    // Réponses, explications et énoncés restent intacts (au retrait des espaces de bord près)
    parsed.rows.forEach((row, i) => {
      const d = drafts[i]!;
      expect(d.rawQuestion).toBe(row[mapping.question!]!.replace(/\r\n?/g, '\n').trim());
      expect(d.reponse).toBe(row[mapping.reponse!]!.replace(/\r\n?/g, '\n').trim());
      expect(d.explication ?? '').toBe(row[mapping.explication!]!.replace(/\r\n?/g, '\n').trim());
    });

    // Chaque QCM : 5 options A–E et la bonne option correspond au texte de la réponse
    for (const d of drafts.filter((x) => x.formatQuestion === 'mcq')) {
      expect(d.options!.map((o) => o.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
      const good = d.options!.find((o) => o.id === d.correctOptionId)!;
      expect(d.reponse.startsWith(`${good.id})`)).toBe(true);
    }
  });
});
