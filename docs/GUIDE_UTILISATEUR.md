# Guide d'utilisation (version 1.0.0)

Ce guide s'adresse à l'utilisatrice de l'application publiée (par exemple sur GitHub Pages). Il ne demande aucune compétence technique.

## 1. Installer l'application sur le téléphone

Ouvrez l'adresse de l'application une première fois avec une connexion Internet. L'application se prépare alors pour fonctionner hors connexion (Plus › Application › « Hors connexion : prête »).

**Android (Chrome)**

1. Ouvrez l'adresse dans Chrome.
2. Plus › Application › « Installer l'application », ou menu ⋮ › « Installer l'application » (selon les versions : « Ajouter à l'écran d'accueil »).
3. Ouvrez ensuite l'application depuis son icône « Flashcards ENA ».

**iPhone (Safari)**

1. Ouvrez l'adresse dans Safari (l'installation n'est possible que depuis Safari).
2. Bouton Partager › « Sur l'écran d'accueil » › Ajouter.
3. Ouvrez ensuite l'application depuis son icône.

Important : sur iPhone, l'application installée sur l'écran d'accueil peut disposer de son propre espace de stockage, distinct de celui de Safari. Installez donc l'application **avant** d'importer vos fichiers. Si vous avez déjà travaillé dans Safari : Plus › « Télécharger une sauvegarde » dans Safari, puis Plus › « Restaurer une sauvegarde » dans l'application installée.

Les données restent toujours sur l'appareil et dans le navigateur où elles ont été créées. Un téléphone et un ordinateur ne partagent pas leurs données ; pour passer de l'un à l'autre, utilisez une sauvegarde.

## 2. Utilisation hors connexion

Une fois l'application ouverte une première fois en ligne, tout fonctionne sans connexion : bibliothèque, recherche, tests, révision programmée, statistiques, saisie de cartes, importation de CSV, sauvegarde et restauration. Un bandeau « Vous êtes hors connexion » le rappelle ; aucune action n'est bloquée.

Seule la recherche d'une mise à jour demande une connexion.

## 3. Sauvegarder ses données

Les données (cartes, classement, collections, tests, progression de révision, historique, réglages) ne sont stockées que sur l'appareil. Si le navigateur est réinitialisé, si l'application est désinstallée ou si le téléphone est perdu, elles sont perdues sans sauvegarde.

1. Plus › Sauvegarde › « Télécharger une sauvegarde » : un fichier `flashcards-sauvegarde-AAAA-MM-JJ-HHMM.json` est créé.
2. Sur téléphone, « Partager / enregistrer dans Fichiers » permet de l'envoyer directement vers Fichiers, Google Drive, un courriel, etc.
3. Conservez ce fichier hors du téléphone (ordinateur, stockage en ligne personnel).

L'accueil rappelle de sauvegarder si aucune sauvegarde n'a été faite depuis plus de 7 jours. Une sauvegarde par semaine, et avant tout changement de téléphone ou de navigateur, est recommandée.

Le fichier contient vos cartes et vos résultats : ne le publiez pas et ne le déposez pas dans un dépôt de code.

## 4. Restaurer une sauvegarde

Plus › « Restaurer une sauvegarde » (ou, sur une application vide, le bouton de l'accueil).

1. Choisissez le fichier `.json`. Il est entièrement vérifié **avant toute modification** : fichier tronqué, modifié à la main, endommagé, provenant d'une version plus récente de l'application ou d'une autre application : il est refusé avec la raison, et rien n'est changé.
2. Un tableau compare le contenu de la sauvegarde aux données actuelles de l'appareil. Les éventuelles corrections automatiques sans perte sont annoncées.
3. Si l'appareil contient déjà des données, l'application propose de les sauvegarder d'abord (« Sauvegarder mes données actuelles »), ou de cocher que vous n'en avez pas besoin. Après le téléchargement, vérifiez que le fichier est bien enregistré (Téléchargements, Fichiers, Drive) : l'application ne peut pas le contrôler elle-même. Cochez ensuite « J'ai vérifié que le fichier de sauvegarde de mes données actuelles est bien enregistré et que je sais où le retrouver ».
4. « Remplacer mes données par cette sauvegarde », puis confirmer. Le remplacement est complet et se fait en une seule opération : en cas d'incident, les données d'avant restent intactes. L'application redémarre ensuite et affiche « Sauvegarde restaurée ».

Les sauvegardes faites avec les versions précédentes (lot 1, lot 2, lot 3) sont acceptées. Une sauvegarde du lot 1 ne contient pas de progression de révision programmée (cette fonction n'existait pas) : l'application le signale.

Si l'application est ouverte dans d'autres onglets au moment d'une restauration, ces onglets sont bloqués par un écran « Page à recharger » dès le début de la restauration : rien ne peut y être modifié. Touchez « Recharger la page » pour retrouver les données à jour.

## 5. Mises à jour

Quand une nouvelle version est publiée, elle est téléchargée en arrière-plan à l'ouverture de l'application (ou via Plus › « Rechercher une mise à jour »). Un bandeau propose alors « Mettre à jour » ou « Plus tard ».

- Le bandeau n'apparaît pas pendant un test ou une correction ; il s'affiche à la fin.
- La mise à jour ne touche pas aux données : cartes, tests en cours et progression sont conservés.
- « Plus tard » : la nouvelle version s'installera à la prochaine fermeture complète de l'application.

La version utilisée est indiquée dans Plus › Application et en bas de l'écran Plus.

## 6. Protection du stockage

Plus › Stockage local indique la place utilisée et si la protection contre l'effacement automatique est activée. Si elle ne l'est pas, « Demander la protection du stockage ». Le navigateur peut refuser ; la sauvegarde régulière reste la seule garantie.

## 7. En cas de problème

| Situation | Que faire |
|---|---|
| « Hors connexion : non disponible » | Ouvrir l'application une fois avec une connexion, attendre quelques secondes, puis vérifier Plus › Application. |
| Le bouton « Installer l'application » n'apparaît pas | Utiliser le menu du navigateur (Android) ou Partager › « Sur l'écran d'accueil » (iPhone). Le bouton n'apparaît pas si l'application est déjà installée. |
| Les données ont disparu après installation sur iPhone | Elles sont restées dans Safari : sauvegarder depuis Safari, restaurer dans l'application installée. |
| Une sauvegarde est refusée | Lire le motif affiché. Les données actuelles n'ont pas été modifiées. Essayer une autre sauvegarde. |
| L'affichage semble ancien après une publication | Plus › « Rechercher une mise à jour », puis « Mettre à jour ». |
