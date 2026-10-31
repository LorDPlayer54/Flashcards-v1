// Génère des CSV FICTIFS pour les tests (aucune donnée réelle).
// Usage : npm run fixtures
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
mkdirSync(outDir, { recursive: true });

// Générateur pseudo-aléatoire déterministe (mêmes fichiers à chaque exécution)
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const toCsv = (rows, sep) => rows.map((r) => r.map(q).join(sep)).join('\r\n') + '\r\n';
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

// ---------- 1. Mini-fichier au format du CSV de référence (10 colonnes, QCM intégrés) ----------
const mini = [
  ['ID', 'Matière', 'Sous-catégorie', 'Notion', 'Type', 'Difficulté', 'Question', 'Réponse', 'Explication', 'Astuce / Piège'],
  ['FIC-001', 'Calcul', 'Fractions', 'Simplification', 'Connaissance', 'Facile', 'Comment simplifier 6/8 ?', 'Diviser par 2 : 3/4.', 'On divise numérateur et dénominateur par leur PGCD.', 'Chercher le PGCD.'],
  ['FIC-002', 'Calcul', 'Fractions', 'Addition', 'Application', 'Moyen', 'Calcule 1/2 + 1/4.\nA) 3/4  B) 2/6  C) 1/8  D) 2/4  E) 1', 'A) 3/4', '1/2 = 2/4, donc 2/4 + 1/4 = 3/4.', 'Mettre au même dénominateur.'],
  ['FIC-003', 'Calcul', 'Pourcentages', 'Hausse', 'Piège', 'Difficile', 'Un prix augmente de 10 % puis baisse de 10 %. Variation ?\nA) 0 %\nB) −1 %\nC) +1 %\nD) −10 %', 'B) −1 %', '1,1 × 0,9 = 0,99.', 'Les pourcentages successifs se multiplient.'],
  ['FIC-004', 'Raisonnement', 'Suites', 'Suite arithmétique', 'Méthode', 'Facile', 'Quel nombre suit 2, 5, 8, 11 ?', '14', 'On ajoute 3 à chaque terme.', ''],
  ['FIC-005', 'Raisonnement', 'Logique', 'Négation', 'Connaissance', 'Moyen', 'Quelle est la négation de « tous les A sont B » ?\nA) Aucun A n’est B  B) Au moins un A n’est pas B  C) Tous les B sont A', 'B', 'La négation d’un « tous » est « il existe au moins un … qui ne … pas ».', ''],
  ['FIC-006', 'Raisonnement', 'Logique', 'Négation', 'Piège', 'Difficile', 'Réponse incohérente (test d’ambiguïté)\nA) Oui  B) Non', 'C) Peut-être', 'Carte volontairement incohérente pour vérifier l’import prudent.', ''],
  ['FIC-007', 'Raisonnement', '', '', 'Connaissance', 'Facile', 'Carte rattachée directement à la matière (sans thème).', 'Réponse fictive.', '', ''],
];
writeFileSync(join(outDir, 'mini_reference_fictif.csv'), '﻿' + toCsv(mini, ','));

// ---------- 2. Anglais fictif : séparateur « ; », avec leçons, options sur plusieurs lignes ----------
const anglaisThemes = {
  Grammaire: { 'Temps verbaux': ['Present perfect', 'Past simple', 'Future forms'], Modaux: ['Can / could', 'Must / have to'] },
  Vocabulaire: { 'Faux amis': ['Actually', 'Eventually'], 'Économie et institutions': ['Budget', 'Policy'] },
  Compréhension: { 'Textes longs': ['Idée principale', 'Inférence'] },
};
const ang = [['Identifiant', 'Matière', 'Thème', 'Leçon', 'Notion', 'Type', 'Difficulté', 'Question', 'Réponse', 'Explication']];
let n = 0;
while (n < 1000) {
  const theme = pick(Object.keys(anglaisThemes));
  const lecons = anglaisThemes[theme];
  const lecon = pick(Object.keys(lecons));
  const notion = pick(lecons[lecon]);
  n++;
  const id = `ANG-${String(n).padStart(4, '0')}`;
  // 10 % des cartes sans leçon (notion rattachée directement au thème)
  const leconVal = n % 10 === 0 ? '' : lecon;
  if (n % 3 === 0) {
    const opts = ['option fictive alpha', 'option fictive beta', 'option fictive gamma', 'option fictive delta'].map((o) => `${o} ${n}`);
    const good = Math.floor(rnd() * opts.length);
    const question = `Question fictive ${n} (${notion}) : choisissez la bonne forme.\n` + opts.map((o, i) => `${LETTERS[i]}) ${o}`).join('\n');
    ang.push([id, 'Anglais', theme, leconVal, notion, pick(['Connaissance', 'Application']), pick(['Facile', 'Moyen', 'Difficile']), question, `${LETTERS[good]}) ${opts[good]}`, `Explication fictive ${n}.`]);
  } else {
    const long = n % 7 === 0 ? ' ' + 'Lorem ipsum dolor sit amet, texte long fictif. '.repeat(12) : '';
    ang.push([id, 'Anglais', theme, leconVal, notion, pick(['Connaissance', 'Méthode']), pick(['Facile', 'Moyen', 'Difficile']), `Question ouverte fictive ${n} sur « ${notion} ».${long}`, `Réponse fictive ${n}.`, '']);
  }
}
writeFileSync(join(outDir, 'anglais_fictif.csv'), toCsv(ang, ';'));

// ---------- 3. Économie fictive : options dans des colonnes séparées ----------
const ecoThemes = {
  Macroéconomie: { 'Politique monétaire': ['Instruments', 'Taux directeur'], Croissance: ['PIB', 'Productivité'] },
  Microéconomie: { Marchés: ['Offre et demande', 'Élasticité'] },
  'Finances publiques': { '': ['Déficit', 'Dette publique'] }, // thème sans leçon
};
const eco = [['ID', 'Matière', 'Thème', 'Leçon', 'Notion', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Bonne réponse', 'Explication']];
n = 0;
while (n < 1100) {
  const theme = pick(Object.keys(ecoThemes));
  const lecons = ecoThemes[theme];
  const lecon = pick(Object.keys(lecons));
  const notion = pick(lecons[lecon]);
  n++;
  const id = `ECO-${String(n).padStart(4, '0')}`;
  if (n % 2 === 0) {
    const opts = ['réponse fictive un', 'réponse fictive deux', 'réponse fictive trois', 'réponse fictive quatre'].map((o) => `${o} (${n})`);
    const good = Math.floor(rnd() * 4);
    eco.push([id, 'Économie', theme, lecon, notion, `QCM fictif ${n} sur ${notion} ?`, ...opts, LETTERS[good], `Explication fictive ${n}.`]);
  } else {
    eco.push([id, 'Économie', theme, lecon, notion, `Définissez la notion fictive ${n} : ${notion}.`, '', '', '', '', `Définition fictive ${n}.`, '']);
  }
}
writeFileSync(join(outDir, 'economie_fictif.csv'), '﻿' + toCsv(eco, ','));

console.log('Fichiers fictifs générés dans', outDir);
console.log('  mini_reference_fictif.csv :', mini.length - 1, 'cartes');
console.log('  anglais_fictif.csv        :', ang.length - 1, 'cartes');
console.log('  economie_fictif.csv       :', eco.length - 1, 'cartes');
