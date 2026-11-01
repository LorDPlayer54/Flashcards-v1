# Flashcard — version 1.2.0

## Évolutions fonctionnelles après la refonte (branche `refonte-uxui`)

Les tests libres alimentent désormais la répétition espacée, avec des règles prudentes (échecs pris en compte immédiatement, réussites seulement près de l'échéance, une évaluation par carte et par jour) ; chronomètre automatique et non bloquant en révision (1 minute par carte) ; bouton « Suivant » après l'autoévaluation ; barre du navigateur accordée au thème effectif. Règles détaillées dans `src/review/schedule.ts` et `docs/GUIDE_UTILISATEUR.md`, section 10.

## Nouveautés de la version 1.2.0

- Nom affiché : **Flashcard** (interface, onglet, manifeste PWA, messages, guide). Les identifiants techniques sont inchangés : base IndexedDB `flashcards-ena`, clés de stockage, cache du service worker, `id`/`scope`/`start_url` du manifeste, format des sauvegardes. Une installation existante est mise à jour sans perte de données ; le nom sous l'icône peut ne changer qu'après réinstallation selon le système.
- Recherche V1 : présentation compacte, extraits contextuels et surlignage des termes (rendu en texte, sans HTML injecté).
- Libellés V1 : recherche dans les suggestions et les règles, fusion en trois étapes avec confirmation, oubli d'une règle confirmé.
- Plus › Tests libres : un interrupteur « Corriger après chaque question » ; l'ancien choix « Comme le dernier test » est converti une fois en préférence explicite.
- Édition d'une carte : bouton « Annuler », confirmation d'abandon si des modifications existent, retour stable sans boucle vers le formulaire.
- Suppression ciblée : refus si une carte a été reclassée entre la sélection et la confirmation.

## Publication (GitHub Pages)

Le workflow `.github/workflows/deploy.yml` publie à chaque envoi sur la branche **`main`** (ou à la demande depuis l'onglet Actions). Le dépôt local livré n'a pas de dépôt distant et contient `master` (1.1.0) et `refonte-uxui` (1.2.0) : procédure complète dans `docs/PASSATION_FINALE_1.2.0.md`. Rien n'est publié tant que cet envoi n'a pas été fait.

## Refonte de l'interface (branche `refonte-uxui`)

Nouvelle présentation de tous les écrans selon les maquettes validées (Accueil V5, Bibliothèque V1, Mon programme étudié V2, Réviser V3, états des cartes V1, Test libre V3, Statistiques V6, Plus V2, import CSV avec correspondance des colonnes repliable), police Manrope intégrée (licence OFL, `src/assets/fonts/`). Les mécanismes métier, les données enregistrées et le format des sauvegardes sont inchangés ; seul ajout fonctionnel : le nom du fichier de sauvegarde est personnalisable. Voir `docs/GUIDE_UTILISATEUR.md`, section 9.


Version 1.1.0 : programme étudié et deux parcours de révision programmée. Elle s'appuie sur la v1.0.0 (lots 1 à 4 et corrections de la v0.4.1). L'historique des versions figure plus bas.

## Nouveautés de la version 1.1.0

- **Mon programme étudié** (Bibliothèque › « Mon programme étudié », ou Plus) : l'utilisatrice coche une fois les matières, thèmes, leçons et notions déjà étudiés en cours, puis met la liste à jour au fil de l'année. Seules ces notions alimentent la révision programmée. Étudié ne veut pas dire maîtrisé : les cartes jamais vues d'une notion cochée entrent progressivement en révision, selon le quota de nouvelles cartes du jour. Décocher une notion n'efface aucune progression : ses cartes ne sont simplement plus proposées.
- **Deux parcours dans Réviser** : « Révision du jour » (par défaut), sur tout le programme étudié, sans sélection ; « Personnalisée », sur un ou plusieurs niveaux choisis parmi le programme étudié, toutes matières confondues. Aperçu : cartes en retard, à revoir aujourd'hui, nouvelles, total. Les deux parcours partagent la même progression et le même quota de nouvelles cartes ; l'algorithme de répétition espacée est inchangé.
- **Statistiques** : bloc « Programme étudié » (cartes de la bibliothèque, du programme, déjà révisées, à réviser aujourd'hui). La tuile « étudiées » devient « déjà révisées », pour ne pas la confondre avec le programme étudié.
- **Inchangés** : tests libres (toute la bibliothèque, sans effet sur les échéances), import CSV, bibliothèque, sauvegardes (le programme y est inclus automatiquement).

Règles retenues :

1. Unité du programme : le niveau le plus précis de chaque carte. Les cartes sans notion forment une ligne « Cartes sans notion » sous leur thème ou leur leçon.
2. Cocher un niveau coche les notions présentes à ce moment-là. Une notion importée ensuite reste non étudiée, même sous un niveau coché. Une carte ajoutée à une notion déjà étudiée suit le statut de la notion.
3. Bibliothèque antérieure à la v1.1.0, ou restauration d'une sauvegarde antérieure : à la première ouverture, les notions qui contiennent au moins une carte déjà révisée sont cochées automatiquement, une seule fois. Les autres restent à cocher.
4. Fusion ou renommage de libellés : les choix suivent le nouveau libellé. Une notion issue de la fusion de notions de statuts différents est étudiée dès que l'une d'elles l'était.
5. Notion décochée pendant une révision en cours ou en pause : la séance se poursuit telle quelle, sans perte de réponse. Le changement vaut pour les séances suivantes.
6. Aucune notion cochée : la révision programmée est vide, et l'écran Réviser renvoie vers « Mon programme étudié ».

Stockage : nouvelle clé de réglage `studiedProgram` (`{ units, updatedAt, origin }`). Le schéma IndexedDB reste en version 3 et le format de sauvegarde en version 3. La valeur est contrôlée à la restauration.

## Pour commencer

| Besoin | Où regarder |
|---|---|
| Lancer l'application sur l'ordinateur | « Installation pas à pas », étapes 1 à 5 (ci-dessous) |
| Ouvrir l'application depuis un téléphone | Étape 6 (essai sur le même Wi-Fi) ; pour l'installer et l'utiliser hors connexion : après publication, `docs/GUIDE_UTILISATEUR.md` § 1 |
| Publier sur GitHub Pages | `docs/DEPLOIEMENT.md` § 3 |
| Installer l'application sur iPhone ou Android | `docs/GUIDE_UTILISATEUR.md` § 1 |
| Sauvegarder et restaurer les données | `docs/GUIDE_UTILISATEUR.md` § 3 et § 4 |
| Définir son programme étudié, réviser | `docs/GUIDE_UTILISATEUR.md` § 8 |

L'archive de livraison contient aussi `dist/`, la version de production déjà compilée : ce dossier peut être copié tel quel sur un hébergement statique HTTPS (`docs/DEPLOIEMENT.md` § 4). Pour GitHub Pages, la publication automatique reconstruit `dist/` elle-même.

---

# Lot 4 (PWA, hors connexion, sauvegarde et restauration, déploiement)

Version 0.4.1, validée. Documentation de livraison :

- `docs/GUIDE_UTILISATEUR.md` : installation sur Android et iPhone, hors connexion, sauvegarde, restauration, mises à jour, dépannage ;
- `docs/DEPLOIEMENT.md` : contrôles avant publication, GitHub Pages, autres hébergements, publication d'une nouvelle version, évolution des formats.

### Corrections de la version 0.4.1 (après contre-audit)

1. **Plusieurs onglets ouverts** : l'onglet qui restaure prévient les autres **avant** sa première écriture (« restauration en cours »), puis à la fin (« données remplacées » ou « restauration annulée »). Chaque autre onglet affiche aussitôt un écran bloquant « Page à recharger » : le reste de l'application devient inerte (ni clic, ni clavier) et sa connexion à la base est fermée, si bien qu'aucune écriture, même automatique (fin de chronomètre), ne peut plus en partir. Seul « Recharger la page » reste possible. Transport : le canal entre onglets déjà utilisé (BroadcastChannel), doublé d'une marque dans `localStorage` pour les navigateurs sans BroadcastChannel et pour un onglet suspendu par le téléphone (vérification au retour au premier plan).
2. **Sauvegarde préalable** : après « Sauvegarder mes données actuelles », l'application indique qu'elle ne peut pas vérifier l'enregistrement du fichier et demande de cocher « J'ai vérifié que le fichier de sauvegarde de mes données actuelles est bien enregistré et que je sais où le retrouver. » Cette attestation est distincte de la confirmation du remplacement, qui reste demandée ensuite. Un nouveau téléchargement remet l'attestation à zéro.
3. **Test de restauration renforcé** : la recette de 2 600 cartes compare désormais récursivement chaque enregistrement des six magasins (58 501 valeurs, champs imbriqués compris). Les tests automatiques de restauration utilisent une égalité stricte ; 5 tests unitaires couvrent l’annonce entre onglets (`src/backup/channel.test.ts`).
4. **Sélections successives de fichiers** : la vérification demandée a montré que le sélecteur n'était désactivé que pendant l'écriture (`disabled={busy}`), pas pendant la lecture ; un second choix pendant la lecture d'un gros fichier pouvait afficher le résultat du premier. Correction minimale : sélecteur et bouton « Remplacer » désactivés pendant la lecture (`busy || reading`), et seul le dernier fichier choisi peut afficher son résultat.

## Ce que fait le lot 4

- **Application installable** : manifeste (`public/manifest.webmanifest`), icônes 192, 512, 512 « maskable », icône Apple 180 et favicon ; Plus › Application : version, état d'installation, état hors connexion, bouton « Installer l'application » quand le navigateur le propose, instructions Android et iPhone.
- **Hors connexion** : un service worker généré à la construction met en cache tous les fichiers de l'application (y compris les polices KaTeX). Après une première ouverture en ligne, l'application s'ouvre et fonctionne entièrement sans réseau, y compris après fermeture complète du navigateur. Bandeau « hors connexion » informatif.
- **Mises à jour maîtrisées** : la nouvelle version est téléchargée en arrière-plan ; elle ne s'applique que lorsque l'utilisatrice touche « Mettre à jour », jamais pendant un test ou une correction. L'ancien cache est supprimé ; IndexedDB n'est jamais touchée par une mise à jour.
- **Sauvegarde complète (format 3)** : cartes, collections, séances (tests, révisions, pauses), réglages (fusions de libellés, affichage, préférences), états de mémorisation et historique des révisions ; en-tête avec version de l'application, nombre d'éléments par catégorie et somme de contrôle. Lecture en une seule transaction (instantané cohérent). Partage direct vers Fichiers / Drive sur téléphone. Date de la dernière sauvegarde affichée, rappel sur l'accueil au-delà de 7 jours.
- **Restauration** (Plus › « Restaurer une sauvegarde », ou accueil d'une application vide) : validation complète avant toute écriture (fichier tronqué, altéré, d'une autre application ou d'une version plus récente : refusé, rien n'est modifié) ; aperçu comparatif sauvegarde / données actuelles ; sauvegarde préalable des données actuelles proposée, avec attestation de conservation (0.4.1) ; remplacement atomique en une transaction, avec recomptage avant validation ; redémarrage de l'application ; autres onglets ouverts bloqués jusqu'à leur rechargement (0.4.1). Sauvegardes des lots 1, 2 et 3 acceptées (compatibilité ascendante).
- **Finitions du lot 3** : anomalies mineures n° 3 et 4 corrigées (voir plus bas).
- **Déploiement** : flux GitHub Actions vers GitHub Pages (contrôle des données privées, types, tests, construction) ; script `npm run check:private`.

Schéma IndexedDB inchangé (version 3, aucune migration). Algorithme de révision et format CSV inchangés. Aucune nouvelle dépendance.

### Recette manuelle du lot 4 (sur téléphone)

1. Publier (`docs/DEPLOIEMENT.md`) et ouvrir l'adresse sur le téléphone, en ligne. Plus › Application : « Hors connexion : prête ».
2. Installer l'application (Android : « Installer l'application » ; iPhone : Partager › « Sur l'écran d'accueil »). L'ouvrir depuis l'icône : plein écran, sans barre d'adresse ; Plus › Application : « installée ».
3. Importer le CSV de 500 cartes, faire quelques révisions et commencer un test.
4. Mode avion, fermer complètement l'application, la rouvrir : accueil, « Reprendre le test », bibliothèque, révision, statistiques fonctionnent.
5. Plus › « Télécharger une sauvegarde » (ou « Partager / enregistrer dans Fichiers ») : le fichier est enregistré.
6. Sur un autre navigateur ou appareil : « Restaurer une sauvegarde » avec ce fichier (si l'appareil contient déjà des données : « Sauvegarder mes données actuelles », vérifier le fichier, cocher l'attestation) : aperçu identique aux compteurs de l'appareil d'origine ; après restauration, même bibliothèque, même test en cours, mêmes cartes à réviser.
7. Ouvrir la sauvegarde dans un éditeur de texte, modifier une réponse, enregistrer, tenter de la restaurer : refusée (« Somme de contrôle incorrecte »), données inchangées.
8. Ouvrir l'application dans deux onglets ; restaurer dans le premier : le second affiche « Page à recharger » et ne permet plus rien d'autre que le rechargement.
9. Publier une nouvelle version (version augmentée) ; rouvrir l'application pendant un test : pas de bandeau ; terminer le test : bandeau « Mettre à jour » ; après mise à jour, Plus › Application affiche la nouvelle version et les données sont intactes.

### Anomalies mineures (registre)

1. `prepareExit()` (sortie d'un test chronométré) : cas limite signalé au contre-audit de la v0.3.0-a2, sans incidence sur l'intégrité des données. **Maintenue** (pas de correctif demandé).
2. Seconde anomalie mineure relevée à l'audit du 3B : libellé exact à reporter ici. **Maintenue** en attente de son libellé.
3. « Refaire un test sur ce périmètre » après fusion ou renommage du niveau : affichait « Ce niveau n'existe plus ». **Corrigée en 0.4.0** : le périmètre est retrouvé à partir des fusions mémorisées ; le bilan indique « Lancé sur « … » (niveau renommé depuis) ». Si les cartes du niveau ont été supprimées, le message est conservé.
4. Libellé du périmètre d'une séance figé à son lancement après un renommage. **Corrigée en 0.4.0** : accueil, bilan, correction et historique des statistiques affichent le libellé actuel (préfixe « Révision » conservé). Le libellé d'origine reste enregistré dans la séance.

Restent indispensables avant la mise en service : recette sur Android/Chrome et iPhone/Safari réels (installation, hors connexion, sauvegarde et restauration, mise à jour), publication effective sur GitHub Pages, mesures de performance sur téléphone.

---

# Lot 3B (statistiques, gestion des cartes, ergonomie)

Version 0.3.0-b, validée.

## Ce que fait le lot 3B

- **Statistiques** (accueil › « Statistiques et activité », Plus › Statistiques, ou « Statistiques » sur chaque niveau de la bibliothèque) : cartes étudiées, nouvelles, à revoir aujourd'hui et maîtrisées ; tableau par sous-niveau (matières, thèmes, leçons, notions) ; taux de réussite **objectif des QCM** et, à part, répartition des **autoévaluations** des questions ouvertes ; activité des 7 derniers jours (graphique, détail au toucher, tableau des chiffres) et des 30 derniers jours ; notions difficiles ; historique des séances. Vue globale ou par niveau, calculée uniquement sur les données enregistrées.
- **Ajouter une carte** (bibliothèque, à n'importe quel niveau : classement prérempli ; ou Plus) et **modifier une carte** (fiche › « Modifier cette carte ») : matière, thème, leçon, notion, type, difficulté, question ouverte ou QCM (2 à 5 propositions, bonne réponse), réponse, explication, astuce/piège. Si la question ou la réponse change, choix explicite : conserver ou réinitialiser la mémorisation de la carte. Identifiant, provenance et historique des révisions sont toujours conservés. Les cartes ajoutées vont dans la collection « Cartes saisies dans l'application » (ou une collection existante, au choix). Suppression : inchangée (fiche › « Supprimer », avec confirmation).
- **Fusion des libellés** (« Fusionner des libellés » sur un niveau de la bibliothèque ; Plus › Libellés pour les libellés semblables détectés) : choisir des matières, thèmes, leçons ou notions frères, le libellé à conserver (ou un nouveau), voir les libellés et le nombre de cartes concernées, puis confirmer. Jamais de fusion automatique. Identifiants, échéances et historiques inchangés. La fusion est mémorisée et appliquée aux importations suivantes.
- **Pause / Reprendre** pour l'entraînement chronométré : chronomètre « Temps écoulé », ou « Temps limité » en usage « Entraînement (pause possible) ». Pendant la pause, la question et la réponse sont masquées et le temps est arrêté (même application fermée) ; un test limité voit son échéance reportée de la durée de la pause. En « Simulation d'examen », pas de pause : le compte à rebours est continu (comportement validé en 0.3.0-a2).
- **Paramètres** (Plus) : thème Automatique / Clair / Sombre, taille du texte Normale / Grande, correction proposée par défaut pour les tests libres.
- **Ergonomie et accessibilité** : focus visible au clavier, animations réduites si le téléphone le demande, textes longs et tableaux sans débordement horizontal.

### Recette manuelle du lot 3B

1. Bibliothèque › Calcul › Fractions › « Ajouter une carte » : matière et thème déjà remplis. Enregistrer sans question : messages d'erreur. Remplir et enregistrer : la fiche s'ouvre, Fractions compte une carte de plus.
2. Ajouter un QCM sans cocher la bonne réponse : refusé ; cocher B : « Réponse affichée : B) … ».
3. Réviser une carte, puis la modifier (réponse) : choisir « Réinitialiser » ; la fiche indique « Nouvelle » et l'historique des révisions reste affiché.
4. Ouvrir la même carte en modification dans deux onglets, enregistrer dans le premier puis dans le second : le second est refusé (« modifiée ailleurs »).
5. Ajouter une carte dans Calcul avec le thème « Fraction » ; Plus › Libellés : la paire « Fractions » / « Fraction » est proposée ; l'ouvrir, vérifier l'aperçu (1 carte), confirmer.
6. Raisonnement › « Fusionner des libellés » : renommer « Calendrier » en « Dates et calendriers ». Réimporter le CSV de 500 cartes dans sa collection : « 10 cartes du fichier sont reclassées », aucune nouvelle carte, « Calendrier » ne réapparaît pas.
7. Test « Temps limité » 1 min, usage « Entraînement » : « Pause » masque la question ; attendre, recharger : toujours en pause, même temps restant ; « Reprendre le test ». En « Simulation d'examen » : pas de bouton « Pause ».
8. Après quelques tests : Statistiques (globales, puis Calcul) ; toucher une barre du graphique.
9. Plus › Affichage : Sombre et Grande, recharger : réglages conservés.

### Recette intégrée du lot 3

Le 3B a été validé. La recette intégrée des lots 1, 2, 3A et 3B est automatisée dans `src/tests/lot3-integration.test.ts` : une même bibliothèque traverse la révision programmée, la modification de cartes déjà révisées (conserver / réinitialiser), une fusion de libellés, la réimportation du fichier d'origine, un test libre après reclassement (aperçu périmé refusé), une pause suivie de fermetures et réouvertures, puis les statistiques du jour et du lendemain. Identifiants, échéances et historique sont contrôlés à chaque étape. Le même enchaînement a été rejoué dans le navigateur sur deux jours simulés, avec comparaison des écrans aux valeurs recalculées depuis la base.

Anomalies mineures consignées à l'issue du lot 3 : voir le registre dans la section du lot 4.

---

# Lot 3A (tests personnalisés avancés)

Version 0.3.0-a2, validée et figée.

### Corrections de la version 0.3.0-a2 (après contre-audit)

- **Temps limité en temps réel** : l'échéance est enregistrée au lancement du test ; le compte à rebours continue application en arrière-plan, téléphone verrouillé ou navigateur fermé. Un test rouvert après son échéance se termine (ou passe à la correction) sans accepter de réponse. Le chronomètre « Temps écoulé » compte toujours le seul temps où l'application est affichée ; « Aucun » ne mesure rien.
- **Quitter** : la limite est vérifiée avant tout enregistrement ; si elle est atteinte, la fin du test est enregistrée et le bilan s'affiche (jamais un test « en cours » expiré).
- **Aperçu après un lancement refusé** : « l'aperçu a été actualisé » n'est affiché qu'une fois la bibliothèque et les statuts relus ; en cas d'échec, message et bouton « Actualiser l'aperçu », « Commencer » reste désactivé.

### Corrections de la version 0.3.0-a1 (après audit du lot 3A)

- **Fin automatique garantie (temps limité)** : la limite atteinte n'est considérée comme traitée qu'une fois la fin du test enregistrée. Si une écriture est en cours, la fin attend qu'elle se termine ; si une réponse n'a pas pu être enregistrée, la fin la conserve et l'enregistre avec elle ; si la fin elle-même échoue, l'écran l'indique, refuse toute nouvelle réponse et propose « Réessayer de terminer le test ». Une réponse donnée après la limite n'est pas enregistrée.
- **Statuts de maîtrise fiables** : tant qu'ils ne sont pas lus (chargement ou erreur), aucune carte n'est classée « Nouvelle » ; le filtre « statut de maîtrise » est indisponible (message et bouton « Réessayer ») et un test qui en dépend ne peut pas être lancé. Les autres filtres restent utilisables.
- **Sélection revalidée au lancement** : au clic sur « Commencer », les cartes éligibles sont recalculées dans la même opération que la création du test (cartes et statuts actuels). Si elles ont changé depuis l'affichage (autre onglet, import, suppression), rien n'est lancé, la séance en cours n'est pas remplacée et l'aperçu est actualisé.
- **Sans chronomètre (« Aucun »)** : aucun temps n'est mesuré, enregistré ni affiché dans le bilan.
- **Quitter avec chronomètre** : si le temps écoulé ne peut pas être enregistré, l'écran le signale et propose « Réessayer et quitter » ou « Quitter sans enregistrer ce temps ».
- Bilan : « Temps moyen de réponse » (de l'affichage de la question à la validation).

## Ce que fait le lot 3A

- **Périmètre modifiable** : depuis « Lancer un test », bouton « Modifier le périmètre » ; arborescence dépliable avec cases à cocher (matières, thèmes, leçons, notions), plusieurs niveaux et plusieurs matières à la fois. Une carte n'est jamais posée deux fois.
- **Filtres** : format (QCM, ouvertes, mélange), difficulté, type pédagogique et statut de maîtrise (nouvelle, en apprentissage, en révision, maîtrisée). Plusieurs choix d'un même filtre s'additionnent ; des filtres différents se cumulent. Chaque choix affiche son nombre de cartes ; les valeurs non renseignées sont filtrables.
- **Cartes éligibles** affichées avant le lancement. Si aucune ne convient, l'écran explique quel filtre est responsable (« sans le filtre « statut de maîtrise », 66 cartes ») et propose de le retirer d'un geste.
- **Correction** après chaque question (comme avant) ou **en fin de test** : les QCM sont enregistrés sans correction, les questions ouvertes passent à la suivante ; à la fin, écran de correction (QCM corrigés, réponses et explications) avec autoévaluation des questions ouvertes. La révision programmée corrige toujours immédiatement.
- **Chronomètre** : aucun, temps écoulé, ou temps limité (5, 10, 15, 30 min ou autre) avec arrêt automatique. Seul le temps où l'application est affichée compte ; il est enregistré à chaque réponse et repris après fermeture.
- **Bilan approfondi** : temps total, temps moyen et questions les plus longues, points faibles du test par thème, résultats par matière et par difficulté, en plus du score QCM, des autoévaluations et des erreurs.
- **Refaire un test sur ce périmètre** reprend le même périmètre et les mêmes réglages ; les derniers réglages de déroulement (nombre, ordre, correction, chronomètre) sont proposés au test suivant.
- Le test libre ne modifie toujours aucune échéance de révision.

### Recette manuelle du lot 3A

1. Bibliothèque > Calcul > Lancer un test > Modifier le périmètre : décocher Calcul, cocher Calcul › Fractions et Anglais › Grammaire, valider.
2. Filtres : cocher Facile et Difficile ; le nombre de cartes éligibles baisse. Choisir QCM et « Maîtrisée » : l'écran explique le blocage et propose « Retirer le filtre « statut de maîtrise » ».
3. Correction « En fin de test », chronomètre « Temps limité 5 min », 10 questions ; répondre à quelques questions, recharger la page : le test reprend à la même question avec le même temps restant.
4. Laisser le temps s'écouler : le test passe à l'écran de correction ; autoévaluer, terminer : bilan approfondi.
5. « Refaire un test sur ce périmètre » : même périmètre, mêmes filtres, mêmes réglages.
6. (0.3.0-a1) Deux onglets : dans A, préparer un test « Nouvelle » sur une notion ; dans B, réviser une carte de cette notion puis « Quitter » ; dans A, « Commencer » : refus expliqué, aperçu actualisé (une carte de moins), la révision de B n'est pas remplacée. Toucher à nouveau « Commencer » : confirmation de remplacement puis lancement.
7. (0.3.0-a1) Test « Aucun » chronomètre : pas de chronomètre pendant le test, pas de rubrique « Temps » dans le bilan.
8. (0.3.0-a2) Test « Temps limité » 1 min : répondre à une question, fermer l'onglet, attendre une minute, rouvrir l'application et « Reprendre le test » : le bilan s'affiche (« arrêté à la fin du temps imparti »). Recommencer en rouvrant après 15 s : le temps restant tient compte du temps passé application fermée.

---

# Lot 2 (révision programmée)

Version 0.2.2 (corrective). Le lot 1 (version 1.1.1, validée après audit) est la base figée sur laquelle le lot 2 a été construit.

### Corrections de la version 0.2.2 (après contre-audit)

- **Périmètre relu en base au lancement** : la séance est recalculée à partir du classement actuel des cartes. Une carte déplacée hors du niveau depuis l'affichage en sort, une carte ajoutée y entre ; si la sélection change, rien n'est créé et l'aperçu (bibliothèque comprise) est actualisé.
- **Remplacement d'une séance uniquement sur confirmation valide** : si une séance a été lancée ailleurs (autre onglet) après l'affichage de la confirmation, ou si aucune séance n'était en cours au moment de la vérification, l'application redemande l'accord sur la séance réellement en cours. En cas de refus, rien n'est lancé et la séance existante est conservée. S'applique aux révisions et aux tests libres.

### Corrections de la version 0.2.1 (après audit du lot 2)

- **Lancement revalidé** : au clic sur « Commencer », la sélection est recalculée dans la même opération que la création de la séance (échéances, quota du jour, réglage, date). Si elle a changé depuis l'affichage, rien n'est créé : l'aperçu est actualisé et il faut toucher à nouveau « Commencer ».
- **Changement de jour** : les écrans de révision se mettent à jour à minuit et au retour de l'application au premier plan (téléphone sorti de veille), sans navigation.
- **Annulation intégrale** : nouveaux tests provoquant un échec au milieu d'une écriture (session, état, historique) ; rien n'est modifié, et le réessai n'applique l'évaluation qu'une fois.
- **Compteur** : « Révision en cours — Question 21 / 23 » pendant les reprises de fin de séance.
- **Quota du jour** : il est compté d'après l'historique des révisions, qui n'est jamais effacé. Une carte étudiée aujourd'hui puis réinitialisée (réimportation) ou supprimée continue de compter : aucune place n'est libérée. Une même carte ne compte qu'une fois par jour ; les reprises de fin de séance et les cartes déjà connues ne comptent pas.

## Ce que fait le lot 2

- **Réviser aujourd'hui** : onglet « Réviser », bouton sur l'accueil et bouton « Réviser » à chaque niveau de la bibliothèque (matière, thème, leçon, notion). La séance contient toutes les cartes dues du périmètre et des nouvelles cartes dans la limite d'un **plafond global par jour** (20 par défaut, modifiable dans « Plus » ; décompte expliqué ci-dessus).
- **Quatre évaluations** : À revoir / Difficile / Correct / Facile. Question ouverte : on affiche la réponse puis on choisit. QCM : réponse fausse → « À revoir » automatiquement ; réponse juste → Difficile / Correct / Facile au choix. La justesse objective du QCM et le sentiment de maîtrise sont enregistrés séparément.
- **Reprise en fin de séance** : une carte « À revoir » est reproposée une fois à la fin de la séance, puis revue le lendemain.
- **Équité entre matières** : les cartes dues et les nouvelles cartes sont alternées matière par matière ; aucune matière n'est repoussée systématiquement en fin de séance.
- **Reprise de séance** : chaque évaluation est enregistrée immédiatement (avec l'état de la carte et l'historique, dans une seule opération) ; une séance interrompue se reprend depuis l'accueil.
- **Test libre inchangé** : il ne crée ni ne modifie jamais une échéance.
- **Réimportation** : pour une carte dont la question ou la réponse a changé, l'aperçu propose, carte par carte, de conserver (par défaut) ou de réinitialiser sa mémorisation.
- **Fiche de carte** : statut, prochaine révision, intervalle, dernières évaluations.
- **Export** : la sauvegarde JSON (format 2) inclut les états de mémorisation et l'historique des révisions.
- Navigation : Accueil, Bibliothèque, Réviser, Recherche, Plus. « Importer » est dans « Plus » (et sur l'accueil et la bibliothèque).

### Algorithme de répétition espacée (V1)

Échéances au jour près, en date locale de l'appareil. Une carte est due si son échéance est aujourd'hui ou passée.

| Évaluation | Effet |
|---|---|
| À revoir | Série de réussites remise à 0, statut « en apprentissage », échéance demain (J+1). Une reprise en fin de séance, qui ne change pas l'échéance. |
| Difficile | Statut « en apprentissage », échéance J+1 ; la série redescend d'un cran (la réussite suivante reprend l'échelle un palier plus bas). |
| Correct | Série + 1 ; intervalle selon la série : 3, 7, 14, 30, 60 jours (puis 60). |
| Facile | Série + 1 ; intervalle selon la série : 7, 14, 30, 60, 120 jours (puis 120). |

Une carte est **maîtrisée** si sa dernière évaluation est Correct ou Facile et que son intervalle atteint au moins 14 jours. Le code est dans `src/review/schedule.ts`, testé dans `src/review/review.test.ts`.

### Recette manuelle du lot 2

1. Importer votre CSV puis `anglais_fictif.csv` et `economie_fictif.csv` (4 matières). Dans « Plus », régler 8 nouvelles cartes par jour.
2. Accueil : « Réviser aujourd'hui (8) ». Onglet Réviser : la répartition montre 2 nouvelles cartes par matière.
3. Faire la séance (QCM faux → « À revoir » + reprise en fin de séance ; QCM juste → choisir Difficile / Correct / Facile). Bilan : évaluations de maîtrise.
4. Fermer et rouvrir le navigateur : accueil « Rien à réviser aujourd'hui », avec la date de prochaine échéance.
5. Faire un test libre puis importer un nouveau CSV : ouvrir la fiche d'une carte révisée, l'échéance n'a pas changé.
6. Le lendemain : les cartes « À revoir » et « Difficile » apparaissent dans « Réviser aujourd'hui ».

---

# Lot 1 (version corrective 1.1.1)

Application web de révision, conçue d'abord pour smartphone. Les données restent dans le navigateur (IndexedDB) : pas de compte, pas de serveur, coût nul.

## Ce que fait le lot 1

- Import de plusieurs CSV successifs : détection UTF-8 (avec ou sans BOM) / Windows-1252, séparateur `,` `;` ou tabulation, champs multilignes, correspondance des colonnes, valeurs fixes (matière, thème, leçon), aperçu, anomalies par carte, confirmation.
- Collections : nouvelle collection ou mise à jour d'une collection existante. L'unicité repose sur (collection, ID source) : une réimportation repère les cartes nouvelles, modifiées et inchangées, ne duplique rien et n'efface rien.
- QCM : options A) à E) intégrées dans la question (format du CSV de référence, sur une ou plusieurs lignes) ou dans des colonnes séparées. En cas de doute (lettre absente, texte discordant), la carte est importée comme question ouverte et signalée : jamais de QCM faussement corrigé.
- Hiérarchie souple Matière → Thème → Leçon → Notion. Les niveaux absents sont omis, jamais inventés. Les cartes rattachées à un niveau intermédiaire restent visibles.
- « Lancer un test » depuis la bibliothèque entière, une matière, un thème, une leçon, une notion ou les résultats d'une recherche.
- Test simple : format (mélange / QCM / ouvertes), nombre (10, 20, 30, toutes, autre), ordre aléatoire ou de la bibliothèque, nombre de cartes éligibles affiché avant le lancement, explication si zéro carte. Une question par écran, correction immédiate, autoévaluation des questions ouvertes (présentée comme telle), progression enregistrée à chaque réponse (reprise après fermeture), bilan, « Refaire les erreurs », « Refaire un test sur ce périmètre ».
- Recherche sans accents dans question, réponse, explication, astuce ; filtres matière et format.
- Fiche de carte avec provenance (collection, fichier, rang, ID source) et suppression confirmée ; suppression d'une collection.
- Premier export : sauvegarde JSON versionnée (bibliothèque, collections, tests, paramètres).

### Corrections de la version 1.1 (après audit)

- Une réponse, un passage à la question suivante ou la fin d'un test ne s'affichent qu'après leur enregistrement. En cas d'échec, la réponse reste à l'écran avec un bouton « Réessayer l'enregistrement ».
- Lancer un nouveau test abandonne l'ancien et crée le nouveau en une seule opération : si la création échoue, l'ancien test reste disponible.
- Un import réussi est toujours annoncé comme réussi, même si l'actualisation de l'écran échoue ensuite (bouton « Actualiser la bibliothèque »).
- Les lignes CSV mal formées (colonnes manquantes, valeurs en trop, guillemets incorrects) sont exclues et listées, jamais tronquées.
- La base garantit qu'un même ID source n'existe qu'une fois par collection ; la comparaison avec la collection est refaite au moment de l'écriture (pas de doublon même avec deux imports simultanés). Migration automatique de la base en version 2, sans perte.
- Une carte qui ressemble à un QCM mais ne peut pas être corrigée de façon fiable (réponse introuvable, lettre incohérente, propositions identiques ou mal formées) est exclue et signalée. Elle n'est importée comme question ouverte que si vous cochez explicitement cette option.
- « Lancer un test sur ces résultats » est désactivé tant que la recherche ne correspond pas exactement aux critères affichés.
- Les cartes supprimées sont signalées dans les bilans et exclues de « Refaire les erreurs », sans modifier les résultats passés.
- Les erreurs de lecture ou d'écriture affichent un message clair et, si possible, un bouton « Réessayer ».

### Corrections de la version 1.1.1 (après contre-audit)

- Un même test ouvert dans deux onglets ne peut plus être réactivé ni écrasé par une copie périmée : chaque enregistrement vérifie la version en base. L'onglet périmé affiche un message et propose de recharger.
- L'aperçu d'import est recalculé à chaque changement d'option ; un ancien calcul terminé en retard est ignoré, et « Confirmer l'import » reste désactivé tant que l'aperçu ne correspond pas aux réglages affichés.
- Un fichier dont la ligne d'en-tête est mal formée est refusé entièrement, sans rien importer.
- Après suppression de la dernière carte d'un niveau, l'application ouvre le niveau existant le plus proche.

Prévu ensuite : filtres multiples, chronomètre, correction en fin de test, statistiques détaillées, édition de cartes, fusion de libellés (lot 3) ; restauration, PWA hors ligne, GitHub Pages (lot 4).

---

## Installation pas à pas (sans compétence en programmation)

### 1. Installer Node.js (une seule fois)

1. Ouvrez https://nodejs.org et téléchargez la version **LTS** (bouton de gauche).
2. Installez-la avec les options par défaut.
3. Ouvrez un terminal :
   - Windows : touche Windows, tapez `PowerShell`, Entrée.
   - Mac : Cmd + Espace, tapez `Terminal`, Entrée.
4. Tapez `node -v` puis Entrée. **Résultat attendu** : un numéro du type `v22.x.x` (20 ou plus).

### 2. Ouvrir le projet

1. Décompressez l'archive du projet (ou clonez le dépôt), par exemple dans `Documents`.
2. Dans le terminal, placez-vous dans le dossier (adaptez le chemin) :
   - Windows : `cd $HOME\Documents\flashcards-ena`
   - Mac : `cd ~/Documents/flashcards-ena`

### 3. Installer les dépendances (une seule fois)

```
npm install
```

**Résultat attendu** : après une à deux minutes, une ligne `added … packages` et aucune ligne `ERR!`.

### 4. Lancer les tests automatiques

```
npm test
```

**Résultat attendu** : `Tests  306 passed | 1 skipped (307)`. Le test ignoré est celui du vrai CSV (voir étape 4 bis).

#### 4 bis. Tester avec votre vrai fichier de 500 cartes (facultatif)

Remplacez le chemin par celui de votre fichier :

- Windows (PowerShell) :
  ```
  $env:REF_CSV="C:\Users\VOUS\Documents\mon_fichier_de_reference.csv"; npm test
  ```
- Mac :
  ```
  REF_CSV="$HOME/Documents/mon_fichier_de_reference.csv" npm test
  ```

**Résultat attendu** : `Tests  307 passed (307)` — ce test vérifie 500 cartes, 300 Calcul, 200 Raisonnement, 178 QCM, 322 ouvertes, 25 thèmes et des réponses intactes.

### 5. Ouvrir l'application sur l'ordinateur

```
npm run dev
```

**Résultat attendu** : une ligne `Local: http://localhost:5173/`. Ouvrez cette adresse dans Chrome, Safari ou Firefox. Pour arrêter : Ctrl + C dans le terminal.

### 6. Ouvrir l'application sur le téléphone (même Wi-Fi)

```
npm run dev -- --host
```

Le terminal affiche une ligne `Network: http://192.168.x.x:5173/`. Tapez cette adresse dans le navigateur du téléphone. Si la page ne s'ouvre pas, autorisez Node.js dans le pare-feu de l'ordinateur.

Attention : les données sont rattachées à l'adresse et au navigateur. Ce que vous importez sur le téléphone n'apparaît pas sur l'ordinateur, et inversement.

Cette adresse locale (`http://…`) suffit pour essayer l'application. L'installation sur l'écran d'accueil et le fonctionnement hors connexion demandent une adresse HTTPS : utilisez pour cela la version publiée (`docs/DEPLOIEMENT.md`).

### 7. Version optimisée, hors connexion et installation (facultatif)

```
npm run build
npm run preview
```

**Résultat attendu** : `✓ built`, puis une adresse `http://localhost:4173/`. Seule cette version (construite) active le service worker : hors connexion et installation se testent ici, sur `localhost`, ou après publication en HTTPS. `npm run dev` ne l'active pas, pour ne pas mettre en cache le code en cours de modification.

### 8. Publier l'application

Voir `docs/DEPLOIEMENT.md` (GitHub Pages en quelques étapes, ou tout hébergement statique HTTPS). Avant toute publication : `npm run check:private`.

---

## Recette manuelle du lot 1

Fichiers fictifs fournis dans `fixtures/` (régénérables avec `npm run fixtures`) : `anglais_fictif.csv` (1 000 cartes, séparateur `;`, avec leçons), `economie_fictif.csv` (1 100 cartes, options en colonnes séparées, thème sans leçon), `mini_reference_fictif.csv` (7 lignes dont un QCM volontairement incohérent, exclu à l'import : 6 cartes importées).

1. Importer > choisir votre CSV de 500 cartes > Analyser. Attendu : 500 valides, 178 / 322, Calcul 300, Raisonnement 200, 0 erreur. Confirmer.
2. Importer `anglais_fictif.csv` puis `economie_fictif.csv` (vous pouvez les sélectionner ensemble). Accueil : **2 600 cartes, 4 matières**.
3. Réimporter le CSV de 500 cartes en choisissant « Mettre à jour une collection existante ». Attendu : 0 nouvelle, 0 modifiée, 500 inchangées, bouton « Rien à importer ».
4. Bibliothèque > Calcul : thèmes sans niveau « Leçon ». Bibliothèque > Anglais > Grammaire : des leçons et quelques notions rattachées directement au thème.
5. Lancer un test depuis Toutes les matières, Calcul, un thème, une notion : vérifier le fil (ex. `Calcul › Fractions › …`) au-dessus de chaque question.
6. Pendant un test, recharger la page ou fermer l'onglet puis revenir : l'accueil propose « Reprendre le test » au bon numéro.
7. Fermer le navigateur, le rouvrir : la bibliothèque est intacte.
8. Plus > Exporter une sauvegarde : un fichier `flashcards-sauvegarde-AAAA-MM-JJ-HHMM.json` est téléchargé.
9. Sur téléphone (360–390 px) : pas de défilement horizontal, boutons atteignables au pouce, QCM lisibles.

---

## Architecture

```
src/
  domain/      types.ts (modèle de données), text.ts (normalisation, empreinte, mélange)
  imports/     csvParse.ts (encodage, séparateur), columnMapping.ts, qcmParser.ts,
               buildCards.ts (lignes → cartes + anomalies), importPlan.ts (nouvelles / modifiées / inchangées),
               importFlow.ts (import puis actualisation, v1.1)
  storage/     db.ts (schéma IndexedDB v1), repo.ts (lecture/écriture, import atomique)
  taxonomy/    tree.ts (hiérarchie souple, compteurs, périmètres), labelMerge.ts (fusion des libellés, règles, suggestions) — lot 3B
  statistics/  stats.ts (compteurs, résultats, activité, notions difficiles, historique) — lot 3B
  settings/    preferences.ts (thème, taille du texte, correction par défaut) — lot 3B
  review/      schedule.ts (algorithme, dates), queue.ts (composition d'une séance : dues, plafond, équité) — lot 2
  tests/       selection.ts (périmètre, filtres, tirage), session.ts (déroulement, bilan, reprises de fin de séance),
               sessionController.ts (enregistrement confirmé des réponses, v1.1), timeLimit.ts (chronomètre, limite, pause)
  library/     search.ts, cardForm.ts (saisie et modification d'une carte) — lot 3B
  backup/      archive.ts (format, validation, compatibilité 1/2/3), export.ts, restore.ts (remplacement atomique),
               channel.ts (avertissement des autres onglets) — lot 4
  pwa/         serviceWorker.ts (liste et code du service worker, générés à la construction), register.ts (installation,
               mises à jour, état hors connexion) — lot 4
  ui/          App.tsx, router.ts (routes par #), AppContext.tsx, components/, screens/
public/        manifeste et icônes de l'application installable — lot 4
docs/          GUIDE_UTILISATEUR.md, DEPLOIEMENT.md — lot 4
fixtures/      CSV fictifs (seuls CSV autorisés dans le dépôt)
scripts/       generate-fixtures.mjs, generate-icons.py, check-private.mjs
.github/       workflows/deploy.yml (publication GitHub Pages) — lot 4
```

### Modèle de données (IndexedDB `flashcards-ena`, version 3)

| Magasin | Clé | Index | Contenu |
|---|---|---|---|
| `cards` | `cardId` (UUID stable) | `byCollection`, `byCollectionExternal` [collectionId, externalId] **unique** (v2), `byMatiere`, `byPath` | carte complète : classement, format, énoncé, `rawQuestion` (texte source intact), options, bonne option, réponse, explication, astuce, provenance, empreinte |
| `collections` | `collectionId` | — | nom, fichiers importés, dates, ordre |
| `sessions` | `sessionId` | `byStatus` | test libre : périmètre, sélection figée, réponses, statut, `revision` (v1.1.1, contrôle de version des écritures) |
| `settings` | `key` | — | dernier périmètre utilisé, nouvelles cartes par jour (`newCardsPerDay`), derniers réglages de test, fusions de libellés (`labelRules`), affichage (`appearance`), correction par défaut (`defaultCorrection`) |
| `reviewStates` (v3) | `cardId` | `byDue` | état de mémorisation : statut, révisions, « À revoir » reçus, série, dernière note, intervalle, première/dernière révision, échéance |
| `reviewLog` (v3) | `logId` | `byCard`, `bySession`, `byDay` | historique : une ligne par évaluation (note, justesse QCM, reprise, échéance avant/après) ; jamais supprimé |

Lots 3 et 4 : aucune migration (schéma toujours en version 3). Lot 4 : nouvelle clé de réglage `lastBackupAt` (date de la dernière sauvegarde), sans effet sur les données existantes.

Format de sauvegarde (lot 4, format 3) : `{ format: "flashcards-ena-backup", version: 3, exportedAt, appVersion, schemaVersion, counts, checksum, collections, cards, sessions, settings, reviewStates, reviewLog }`. `counts` donne le nombre d'éléments de chaque catégorie, `checksum` une empreinte FNV-1a des six tableaux : un fichier tronqué ou modifié est refusé. Les formats 1 (lot 1, sans progression de révision) et 2 (lots 2 et 3) restent lisibles ; seules des corrections sans perte sont appliquées et annoncées (empreinte recalculée, ID source en double neutralisé comme lors de la migration v1 → v2, état de mémorisation d'une carte absente écarté).

Lot 3 : champs facultatifs ajoutés : `cards.editedAt`, `collections.manual`, `sessions.deadlineAt` (0.3.0-a2), `sessions.pausedAt`, `config.timer.pausable` (3B). Les données antérieures restent valides telles quelles.

Migration v2 → v3 (lot 2, automatique) : création des magasins `reviewStates` et `reviewLog`, sans lire ni modifier les données existantes. Une base v1 passe successivement en v2 puis en v3.

Migration v1 → v2 (automatique à la première ouverture de la version 1.1) : l'index (collection, ID source) devient unique. Toutes les cartes, sessions et collections sont conservées, avec les mêmes identifiants. Si deux cartes d'une même collection portaient déjà le même ID source (cas impossible en usage normal du lot 1), la plus ancienne garde l'ID ; l'autre est conservée intacte, son ID étant déplacé dans `duplicateExternalId` et noté dans `settings.migrationNotes`.

Choix notables :

- `Type` du CSV = type pédagogique ; le format (QCM / ouverte) est détecté séparément.
- L'interface garde en mémoire une projection légère de chaque carte (classement, format) pour l'arbre et les compteurs ; les textes sont chargés page par page.
- Un import s'écrit en une seule transaction, qui refait la comparaison avec la collection sur l'état réel de la base : en cas d'erreur, rien n'est modifié.
- Un test libre n'écrit que dans `sessions` : il ne touchera jamais aux échéances du lot 2.
- Aucun HTML de carte n'est interprété. Les formules LaTeX explicites `\( … \)`, `\[ … \]`, `$$ … $$` sont rendues par KaTeX (`trust: false`). Le `$` simple est volontairement ignoré (montants en dollars).

### Protocole de performance (lot 4)

Chromium sans interface, écran 375 × 740, processeur ralenti 4 fois (émulation d'un téléphone milieu de gamme), version construite. 10 100 cartes : le vrai CSV de 500 cartes, les deux CSV fictifs (2 100) et 7 500 cartes fictives générées ; 20 révisions et un test en cours. Chaque mesure est la médiane de 3 essais.

| Opération | Médiane |
|---|---|
| Import des 4 fichiers (10 100 cartes, sans ralentissement) | ≈ 3,0 s |
| Ouverture à froid jusqu'à l'accueil | 1,69 s |
| Bibliothèque › matière › thème | 0,22 s |
| Recherche plein texte | 1,77 s |
| Lancement d'un test sur toute la bibliothèque | 1,06 s |
| Aperçu de révision | 0,02 s (0,07 s au premier affichage) |
| Statistiques globales | 0,02 s (0,20 s au premier affichage) |
| Sauvegarde (fichier de 11,1 Mo) | 1,28 s |
| Lecture et vérification d'une sauvegarde avant restauration | 1,21 s |
| Restauration complète et redémarrage (1 essai) | 3,87 s |

Ces mesures restent une émulation : la validation sur téléphones réels est à faire (recette manuelle du lot 4).

## Confidentialité

Le fichier `.gitignore` exclut tous les `*.csv` sauf `fixtures/`, ainsi que les sauvegardes `flashcards-sauvegarde-*.json`. Ne publiez jamais votre vrai CSV ni vos sauvegardes. `npm run check:private` le vérifie (il est aussi exécuté avant chaque publication automatique).

L'application n'envoie aucune donnée : l'hébergement ne sert que les fichiers de l'application, sans compte ni mesure d'audience. Seule la préférence d'affichage (thème, taille du texte) est recopiée dans le `localStorage` du navigateur, pour appliquer le bon thème dès le démarrage.
