// Lecture d'un fichier CSV : encodage, séparateur, guillemets et champs multilignes.
import Papa from 'papaparse';

export interface RejectedRecord {
  /** Rang de l'enregistrement de données (1 = première ligne après l'en-tête) */
  row: number;
  reason: string;
}

export interface ParsedCsv {
  headers: string[];
  /** Enregistrements de données VALIDES (hors en-tête), alignés sur les en-têtes */
  rows: string[][];
  /** Rang d'origine de chaque enregistrement valide (même longueur que `rows`) */
  rowNumbers: number[];
  /** Enregistrements malformés, exclus de l'import (v1.1, I2) */
  rejected: RejectedRecord[];
  /**
   * v1.1.1 : défaut bloquant pour tout le fichier (en-tête mal formé). Le fichier est alors refusé :
   * `rows` est vide, aucune correspondance de colonnes n'est proposée, la bibliothèque n'est pas modifiée.
   */
  fatal?: string;
  delimiter: string;
  encoding: 'utf-8' | 'windows-1252';
  hadBom: boolean;
  warnings: string[];
}

/** Décode des octets : UTF-8 strict (avec ou sans BOM), sinon repli Windows-1252 (CSV Excel). */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: ParsedCsv['encoding']; hadBom: boolean } {
  const hadBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hadBom ? bytes.subarray(3) : bytes;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    return { text, encoding: 'utf-8', hadBom };
  } catch {
    const text = new TextDecoder('windows-1252').decode(body);
    return { text, encoding: 'windows-1252', hadBom };
  }
}

/**
 * Séparateur déduit de la ligne d'en-tête (hors passages entre guillemets) : le plus fréquent parmi « , », « ; », tabulation.
 * Plus robuste que la détection sur tout le fichier, qui échoue si un guillemet non fermé plus loin perturbe l'analyse.
 */
export function guessDelimiter(text: string): string {
  const firstLine = (text.split(/\r?\n/, 1)[0] ?? '').replace(/"[^"]*"/g, '');
  let best = ',';
  let bestCount = 0;
  for (const d of [',', ';', '\t']) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function quoteErrorReason(code: string, message: string): string {
  if (code === 'MissingQuotes') return 'guillemet non fermé : la suite du fichier a pu être absorbée dans ce champ';
  if (code === 'InvalidQuotes') return 'guillemets mal placés dans un champ';
  return message;
}

/**
 * Analyse le texte CSV. Le séparateur (« , », « ; » ou tabulation) est détecté automatiquement.
 * v1.1 (I2) : un enregistrement n'est jamais tronqué ni complété en silence.
 *  - trop de colonnes : accepté seulement si les colonnes en trop sont vides (aucune perte), sinon rejeté ;
 *  - pas assez de colonnes : rejeté (valeurs manquantes ou décalées) ;
 *  - erreur de guillemets signalée par l'analyseur : rejeté.
 */
export function parseCsvText(rawText: string): Omit<ParsedCsv, 'encoding' | 'hadBom'> {
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const warnings: string[] = [];
  const delimiter = guessDelimiter(text);
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: 'greedy',
    delimiter,
  });
  const data = result.data;
  if (data.length === 0) {
    return { headers: [], rows: [], rowNumbers: [], rejected: [], delimiter, warnings: ['Fichier vide'] };
  }

  // Erreurs de guillemets, rattachées à leur enregistrement (index Papa : 0 = en-tête)
  const quoteErrors = new Map<number, string>();
  for (const err of result.errors) {
    if (typeof err.row === 'number') {
      if (!quoteErrors.has(err.row)) quoteErrors.set(err.row, quoteErrorReason(err.code, err.message));
    } else {
      warnings.push(`Lecture CSV : ${err.message}`);
    }
  }

  const headers = (data[0] ?? []).map((h) => h.trim());
  // v1.1.1 : un en-tête mal formé rend l'appariement des colonnes incertain → fichier refusé
  const headerQuote = quoteErrors.get(0);
  const fatal = headerQuote ? `ligne d'en-tête mal formée (${headerQuote}).` : undefined;
  if (fatal) {
    return { headers, rows: [], rowNumbers: [], rejected: [], delimiter, warnings, fatal };
  }

  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  const rejected: RejectedRecord[] = [];
  let paddedExtra = 0;
  for (let i = 1; i < data.length; i++) {
    const r = data[i] ?? [];
    const quoteReason = quoteErrors.get(i);
    if (quoteReason) {
      rejected.push({ row: i, reason: `Ligne CSV mal formée : ${quoteReason}.` });
      continue;
    }
    if (r.length < headers.length) {
      rejected.push({
        row: i,
        reason: `Ligne CSV mal formée : ${r.length} colonne(s) au lieu de ${headers.length} (valeurs manquantes ou décalées).`,
      });
      continue;
    }
    if (r.length > headers.length) {
      const extra = r.slice(headers.length);
      if (extra.some((v) => v.trim() !== '')) {
        rejected.push({
          row: i,
          reason: `Ligne CSV mal formée : ${r.length} colonnes au lieu de ${headers.length}, dont des valeurs hors en-tête qui seraient perdues.`,
        });
        continue;
      }
      paddedExtra++;
    }
    rows.push(r.slice(0, headers.length));
    rowNumbers.push(i);
  }
  if (paddedExtra > 0) {
    warnings.push(`${paddedExtra} ligne(s) se terminent par des colonnes vides sans en-tête : ignorées (aucune donnée perdue).`);
  }
  if (rejected.length > 0) {
    warnings.push(`${rejected.length} ligne(s) CSV mal formée(s) exclue(s) de l'import : corrigez-les dans le fichier puis réimportez-le.`);
  }
  return { headers, rows, rowNumbers, rejected, delimiter, warnings };
}

export function parseCsvBytes(bytes: Uint8Array): ParsedCsv {
  const decoded = decodeBytes(bytes);
  const parsed = parseCsvText(decoded.text);
  const warnings = [...parsed.warnings];
  if (decoded.encoding === 'windows-1252') {
    warnings.unshift("Le fichier n'est pas en UTF-8 : il a été lu en Windows-1252. Vérifiez les accents dans l'aperçu.");
  }
  return { ...parsed, encoding: decoded.encoding, hadBom: decoded.hadBom, warnings };
}
