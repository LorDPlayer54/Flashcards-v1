# Déploiement (version 1.1.0)

L'application est un site statique : un dossier `dist/` (HTML, JavaScript, CSS, icônes, manifeste, service worker) sans serveur applicatif ni base de données distante. Toutes les données restent dans le navigateur de l'utilisatrice.

## 1. Prérequis

- Node.js 22 (LTS) ou plus récent (`node -v`).
- Les dépendances installées une fois : `npm install` (ou `npm ci`, qui suit exactement `package-lock.json`).
- Un hébergement en **HTTPS** : le service worker (hors connexion, installation) ne fonctionne qu'en HTTPS, ou sur `http://localhost` pour les essais.

## 2. Contrôles avant publication

```
npm run check:private   # aucun CSV réel ni sauvegarde personnelle dans le projet
npm run typecheck       # 0 erreur
npm test                # tous les tests passent (1 ignoré sans vrai CSV)
npm run build           # construit dist/
```

`check:private` échoue si le projet contient un CSV hors de `fixtures/`, un fichier `flashcards-sauvegarde-*.json`, un fichier JSON qui est une sauvegarde de l'application, ou si les règles correspondantes manquent dans `.gitignore`.

## 3. Publication sur GitHub Pages (recommandé, gratuit)

Le fichier `.github/workflows/deploy.yml` publie automatiquement l'application à chaque envoi sur la branche `main`, après les contrôles de la section 2. Une publication échoue, et rien n'est mis en ligne, si l'un d'eux échoue.

Première mise en place :

1. Créer un dépôt sur GitHub (il peut être privé si votre abonnement le permet pour Pages ; sinon public : seuls le code et les CSV fictifs de `fixtures/` y figurent).
2. Envoyer le projet sur la branche `main` (sans `node_modules/` ni `dist/`, déjà exclus par `.gitignore`).
3. Dans le dépôt : Settings › Pages › Build and deployment › Source : **GitHub Actions**.
4. Onglet Actions : le flux « Publier sur GitHub Pages » s'exécute (relancer avec « Run workflow » si besoin). À la fin, l'adresse est affichée, de la forme `https://<compte>.github.io/<dépôt>/`.
5. Ouvrir cette adresse sur le téléphone et suivre `docs/GUIDE_UTILISATEUR.md`.

L'application utilise des chemins relatifs (`base: './'`) et un routage par `#` : elle fonctionne dans un sous-dossier comme `/<dépôt>/` sans configuration, et le rechargement d'un écran interne ne produit jamais d'erreur 404.

## 4. Autres hébergements statiques

Copier le contenu de `dist/` (après `npm run build`) à la racine ou dans un sous-dossier de n'importe quel hébergement HTTPS (Netlify, Cloudflare Pages, serveur web). Recommandations :

- servir `sw.js` et `index.html` sans cache long (`Cache-Control: no-cache`), afin que les mises à jour soient détectées ; les fichiers de `assets/` portent une empreinte dans leur nom et peuvent être mis en cache longtemps ;
- servir `manifest.webmanifest` avec le type `application/manifest+json` (GitHub Pages le fait).

## 5. Publier une nouvelle version

1. Modifier le code, puis augmenter `version` dans `package.json` (affichée dans Plus › Application).
2. Contrôles de la section 2, puis envoi sur `main`.
3. Sur les appareils : le nouveau service worker est téléchargé à l'ouverture suivante (ou au retour sur l'application, ou toutes les heures si elle reste ouverte). Le bandeau « Mettre à jour » apparaît hors des tests ; les données ne sont pas modifiées.

Le nom du cache hors connexion dépend de la version et du contenu exact des fichiers : toute modification publiée est détectée, même si la version n'a pas été augmentée. L'ancien cache est supprimé à l'activation de la nouvelle version.

## 6. Évolution du format des données (pour les versions futures)

- Base IndexedDB `flashcards-ena`, schéma version 3, inchangé depuis le lot 2. Un changement de schéma doit passer par une migration dans `src/storage/db.ts`, testée sur une base réelle des versions précédentes.
- Sauvegardes : format 3 (lot 4). L'application lit les formats 1, 2 et 3 et refuse un format plus récent qu'elle ne connaît pas, sans rien modifier. Toute évolution du format doit garder la lecture des anciens formats (`src/backup/archive.ts`) et ses tests (`src/backup/backup.test.ts`).

## 7. Icônes

Les icônes de `public/` sont générées par `npm run icons` (Python 3 et Pillow). Pour les remplacer, garder les mêmes noms et tailles : `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (motif dans le cercle central de 80 %), `apple-touch-icon.png` (180 px), `favicon-32.png`.
