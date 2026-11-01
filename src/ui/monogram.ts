// Refonte UX/UI : monogrammes des matières (deux lettres, forme et couleur uniformes). Fonctions pures, testées.
// Les matières viennent des CSV : aucune liste fixe. Règles : accents retirés, mots-outils ignorés,
// deux mots significatifs → initiales (« Droit public » → DP) ; un seul mot → deux premières lettres
// (« Économie » → EC) ; en cas de doublon, variantes déterministes, puis chiffre.
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'en', 'a', 'au', 'aux', 'pour', 'sur', 'par', 'un', 'une', 'the', 'of', 'and']);

function words(label: string): string[] {
  const plain = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return plain.split(/[^A-Z0-9]+/).filter(Boolean);
}

function significant(label: string): string[] {
  const all = words(label);
  const sig = all.filter((w) => !STOP.has(w.toLowerCase()));
  return sig.length ? sig : all;
}

/** Candidats par ordre de préférence. */
function candidates(label: string): string[] {
  const w = significant(label);
  if (w.length === 0) return ['?'];
  const out: string[] = [];
  const push = (c: string) => c.length === 2 && !out.includes(c) && out.push(c);
  if (w.length >= 2) {
    push(w[0]![0]! + w[1]![0]!);
    for (let i = 2; i < w.length; i++) push(w[0]![0]! + w[i]![0]!);
    for (let k = 1; k < w[1]!.length; k++) push(w[0]![0]! + w[1]![k]!);
  }
  for (let k = 1; k < w[0]!.length; k++) push(w[0]![0]! + w[0]![k]!);
  if (out.length === 0) out.push(w[0]!.slice(0, 2));
  return out;
}

export function monogramOf(label: string): string {
  return candidates(label)[0]!;
}

/** Monogrammes distincts pour une liste de matières (ordre donné = priorité). */
export function monogramsFor(labels: readonly string[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const label of labels) {
    if (out.has(label)) continue;
    const pick = candidates(label).find((c) => !used.has(c));
    let mono = pick;
    if (!mono) {
      const base = candidates(label)[0]!.slice(0, 1);
      for (let n = 2; !mono; n++) if (!used.has(`${base}${n}`)) mono = `${base}${n}`;
    }
    used.add(mono);
    out.set(label, mono);
  }
  return out;
}
