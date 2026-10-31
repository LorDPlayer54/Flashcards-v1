// Lot 4 : contrôle avant publication. Échoue si le dépôt contient des données personnelles :
//  - un fichier CSV hors du dossier fixtures/ (vrais fichiers de cartes) ;
//  - une sauvegarde de l'application (nom flashcards-sauvegarde-*.json, ou tout JSON au format de sauvegarde) ;
//  - un fichier .gitignore privé des règles de protection.
// Usage : npm run check:private (exécuté aussi par le déploiement automatique).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['node_modules', 'dist', '.git']);
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const rel = relative(root, path).split(sep).join('/');
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (/\.csv$/i.test(name) && !rel.startsWith('fixtures/')) problems.push(`${rel} : fichier CSV hors de fixtures/ (données réelles ?)`);
    if (/^flashcards-sauvegarde-.*\.json$/i.test(name)) problems.push(`${rel} : sauvegarde personnelle`);
    if (/\.json$/i.test(name) && statSync(path).size < 200_000_000) {
      const head = readFileSync(path, 'utf-8').slice(0, 200);
      if (head.includes('"flashcards-ena-backup"')) problems.push(`${rel} : fichier au format de sauvegarde`);
    }
  }
}

walk(root);
const ignore = readFileSync(join(root, '.gitignore'), 'utf-8');
for (const rule of ['*.csv', '!fixtures/*.csv', 'flashcards-sauvegarde-*.json']) {
  if (!ignore.split('\n').map((l) => l.trim()).includes(rule)) problems.push(`.gitignore : règle « ${rule} » absente`);
}

if (problems.length) {
  console.error('Publication refusée — données personnelles possibles :\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log('Contrôle des données privées : aucun CSV réel ni sauvegarde dans le projet.');
