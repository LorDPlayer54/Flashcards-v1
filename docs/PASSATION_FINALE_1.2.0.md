# Flashcard 1.2.0 : note de validation et de publication

Date : 01/11/2026. Branche : `refonte-uxui`. Commit : celui indiqué dans le nom des archives (identique à `git log -1` et au commentaire du ZIP des sources). Aucun déploiement effectué.

## Contenu de la version

- **Nom affiché « Flashcard »** : écrans, titre d'onglet, métadonnées, manifeste (`name`, `short_name`), titre iOS, messages, guide, README. Logo A inchangé.
- **Recherche V1**, **Libellés V1** et **réglage « Corriger après chaque question »** (switch V3, avec conversion de l'ancien choix « dernier test »).
- **Édition d'une carte** : bouton « Annuler », retour stable sans boucle.
- **Suppression ciblée** : refus sans suppression si une carte a été reclassée entre la sélection et la confirmation.
- Version **1.2.0** (`package.json`, `package-lock.json`, affichée dans Plus › À propos).

## Corrections de la phase finale

1. **Retour depuis un formulaire modifié** (`src/ui/router.ts`, `src/ui/screens/CardEdit.tsx`). Une garde de navigation est active tant que le formulaire contient des modifications non enregistrées. Elle couvre le bouton « Annuler », le retour de l'écran, le bouton Retour du navigateur, le retour matériel Android (même événement d'historique), les liens et la barre de navigation. La confirmation propose « Abandonner les modifications » ou « Continuer l'édition » ; continuer conserve toutes les valeurs. L'historique est rétabli au même rang (aucune entrée supplémentaire) ; l'abandon poursuit la navigation demandée. Sans modification, ou après un enregistrement réussi, aucune confirmation. Seul l'écran d'édition utilise la garde. Une fermeture de l'application par le système n'est pas interceptée.
2. **Scénarios `perf.mjs` et `retry.mjs`** : scénarios obsolètes, aucune régression de l'application.
   - `perf.mjs` : le fichier de volume contient des QCM sans propositions analysables. Depuis la 1.1, ils sont exclus par défaut et doivent être importés explicitement comme questions ouvertes ; le script ne cochait pas ce choix (le bouton d'import n'existait donc pas). Il utilisait aussi des sélecteurs de l'ancien Accueil. Adapté comme son successeur `perf4.mjs`.
   - `retry.mjs` : après une autoévaluation, le bouton « Suivant » (fonction validée) doit être touché ; le script ne le faisait pas. Sélecteurs de l'ancien bilan, de l'ancien Accueil et de l'ancien export mis à jour ; attente de la question suivante pour éviter un effet de transition.
   - `lot3b.mjs` : après le conflit entre deux onglets, le formulaire reste modifié ; la nouvelle confirmation de sortie apparaît donc, comme attendu. Le script l'accepte désormais.
3. **Séparateur de milliers** dans la suppression ciblée (compteurs, aperçu « 1 100 sur 1 100 », libellés d'accessibilité) et dans l'aperçu de fusion : fonction d'affichage `num()` (`toLocaleString('fr-FR')`). Aucun calcul modifié.

## Résultats des vérifications

Réussies :
- `npx tsc --noEmit` : aucune erreur.
- `npx vitest run` : 346 tests passés, 1 ignoré (36 fichiers). Nouveaux : `src/ui/navigationGuard.test.ts` (retour bloqué, historique rétabli, lien bloqué, abandon sans boucle, retour normal sans modification).
- `npm run build` : réussi. `npm run check:private` : aucun CSV réel ni sauvegarde.
- Version affichée : 1.2.0 (vérifiée dans le navigateur).
- `docs/e2e/final12.mjs` (Chromium automatisé, viewport mobile) : 36 vérifications passées, aucune erreur JavaScript. Ajouts : retour navigateur avec modifications (confirmation, valeurs conservées), continuer, barre de navigation bloquée, abandon depuis le retour, retour sans modification.
- `docs/e2e/upgrade110.mjs` : mise à jour réelle du service worker 1.1.0 → 1.2.0 sur la même origine, dans un profil persistant. 20 vérifications passées : bandeau de mise à jour, titre et version, base IndexedDB identique (nom, version 3, magasins), cartes, collections, états de mémorisation, historique et séances identiques, un seul cache `flashcards-ena-1.2.0-…`, préférence « dernier test » convertie en « fin de test », bibliothèque et recherche hors connexion, restauration d'une sauvegarde 1.1.0 dans la 1.2.0 à l'identique, manifeste (nom Flashcard, `id`/`scope`/`start_url` inchangés).
- `docs/e2e/shot_suppr.mjs` : « 1 100 cartes », « (1 100 sur 1 100) », suppression partielle puis entière.
- Non-régression (scripts de `/home/claude/e2e`, hors dépôt) : 18 sur 18 réussis après adaptation : lot3b, recette3, backup4, backup2600, smoke, selection, v11, v111, perf4, perf, retry (3 passages), migration, migration2, program11, lot3a, lot2, subpath (hors connexion sous sous-dossier), overflow11.

Échouées : aucune à la date de livraison.

Non réalisées :
- Appareils physiques Android et iOS (installation, nom sous l'icône, retour matériel réel) : impossible dans cet environnement. Le retour matériel Android a été simulé par le retour du navigateur, qui déclenche le même événement d'historique.
- Lecteurs d'écran réels.
- Campagne complète des 167 scénarios : non rejouée ; seuls les parcours concernés ci-dessus.

## Limites résiduelles

- Sur une PWA déjà installée, le nom sous l'icône peut rester « Flashcards ENA » jusqu'à ce que le système relise le manifeste ou jusqu'à réinstallation.
- Si le formulaire a été ouvert directement (sans écran précédent dans l'application), le retour du navigateur quitte l'application sans confirmation : le navigateur ne permet pas de l'intercepter.

## Publication sur GitHub Pages

Situation vérifiée : le workflow `.github/workflows/deploy.yml` se déclenche sur un envoi (`push`) vers **`main`**, ou manuellement (`workflow_dispatch`). Le dépôt local livré n'a **aucun dépôt distant configuré** et ne contient que `master` (1.1.0) et `refonte-uxui` (1.2.0) : la branche par défaut du dépôt GitHub n'a pas pu être vérifiée.

Procédure, depuis une copie du dépôt reliée à GitHub :

1. Sauvegarder ses données dans l'application en ligne actuelle (Plus › Télécharger une sauvegarde).
2. Vérifier la branche par défaut du dépôt GitHub : `git ls-remote --symref origin HEAD`.
3. Vérifier GitHub › Settings › Pages › Source : « GitHub Actions ».
4. Placer la 1.2.0 sur la branche publiée :
   - si elle s'appelle `main` : `git checkout main && git merge --ff-only refonte-uxui` (ou `git merge refonte-uxui`), puis `git push origin main` ;
   - si elle s'appelle `master` : soit fusionner dans `master` puis lancer le workflow à la main (Actions › Publier sur GitHub Pages › Run workflow, branche `master`), soit ajouter `master` à `on.push.branches` du workflow avant l'envoi.
5. Le workflow refait le contrôle des données privées, les types, les tests et le build, puis publie `dist/`. L'archive `dist/` livrée sert de référence ou de publication manuelle (`base: './'`, chemins relatifs).
6. Ouvrir l'application installée : le bandeau « nouvelle version » propose la mise à jour ; les données restent en place.

## Précautions pour les données des utilisateurs

- Ne pas modifier : base IndexedDB `flashcards-ena` (version 3), clés `flashcards-ena:*`, canal `flashcards-ena`, préfixe de cache `flashcards-ena-`, `id`/`scope`/`start_url` du manifeste, format de sauvegarde `flashcards-ena-backup`.
- Publier à la même adresse (même origine et même chemin) : une autre adresse crée une application distincte, sans les données.
- Conseiller une sauvegarde avant la mise à jour.

## Reprise

- `npm ci`, `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`, `npm run preview`, `npm run check:private`.
- Scénarios navigateur : `docs/e2e/*.mjs` (Playwright ; `upgrade110.mjs` attend les builds 1.1.0 et 1.2.0 dans `/tmp/up-a` et `/tmp/up-b` ; `perf.mjs` et `retry.mjs` attendent le lanceur et les fichiers de l'environnement de recette).
