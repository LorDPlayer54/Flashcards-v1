# Guide d'utilisation (version 1.1.0)

Ce guide s'adresse à l'utilisatrice de l'application publiée (par exemple sur GitHub Pages). Il ne demande aucune compétence technique.

## 1. Installer l'application sur le téléphone

Ouvrez l'adresse de l'application une première fois avec une connexion Internet. L'application se prépare alors pour fonctionner hors connexion (Plus › Application › « Hors connexion : prête »).

**Android (Chrome)**

1. Ouvrez l'adresse dans Chrome.
2. Plus › Application › « Installer l'application », ou menu ⋮ › « Installer l'application » (selon les versions : « Ajouter à l'écran d'accueil »).
3. Ouvrez ensuite l'application depuis son icône « Flashcard ».

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

1. Plus › « Télécharger une sauvegarde » › « Télécharger ma sauvegarde » : un fichier `flashcards-sauvegarde-AAAA-MM-JJ-HHMM.json` est créé.
2. Le nom du fichier est proposé automatiquement et peut être modifié avant le téléchargement ; l'interrupteur « Ajouter la date » ajoute ou retire la date et l'heure. L'extension `.json` est toujours conservée et les accents sont retirés du nom. Le contenu du fichier ne change pas.
3. Sur téléphone, « Partager / enregistrer dans Fichiers » permet de l'envoyer directement vers Fichiers, Google Drive, un courriel, etc. (avec le même nom).
4. Conservez ce fichier hors du téléphone (ordinateur, stockage en ligne personnel).

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

Plus › Application › Stockage local indique la place utilisée et si la protection contre l'effacement automatique est activée. Si elle ne l'est pas, « Demander la protection du stockage ». Le navigateur peut refuser ; la sauvegarde régulière reste la seule garantie.

## 7. En cas de problème

| Situation | Que faire |
|---|---|
| « Hors connexion : non disponible » | Ouvrir l'application une fois avec une connexion, attendre quelques secondes, puis vérifier Plus › Application. |
| Le bouton « Installer l'application » n'apparaît pas | Utiliser le menu du navigateur (Android) ou Partager › « Sur l'écran d'accueil » (iPhone). Le bouton n'apparaît pas si l'application est déjà installée. |
| Les données ont disparu après installation sur iPhone | Elles sont restées dans Safari : sauvegarder depuis Safari, restaurer dans l'application installée. |
| Une sauvegarde est refusée | Lire le motif affiché. Les données actuelles n'ont pas été modifiées. Essayer une autre sauvegarde. |
| L'affichage semble ancien après une publication | Plus › « Rechercher une mise à jour », puis « Mettre à jour ». |

## 8. Programme étudié et révisions (version 1.1.0)

**Définir son programme, une fois pour toutes.** Bibliothèque › « Mon programme étudié » (aussi dans Plus). Les matières s'affichent sous forme d'arbre : touchez la flèche d'une ligne pour la déplier, et cochez ce que vous avez déjà étudié en cours : une matière entière, un thème, ou des notions une à une. Une case marquée d'un trait (–) signale un niveau partiellement coché. Le champ de recherche retrouve une notion et déplie son chemin. Chaque case est enregistrée aussitôt. Revenez-y quand vous terminez de nouvelles notions ; vous n'avez rien à choisir au début de chaque séance.

- Une notion importée plus tard reste non étudiée, même si son thème était coché : cochez-la quand vous l'aurez vue.
- Décocher une notion n'efface rien : ses cartes ne sont plus proposées en révision, et reprennent leurs échéances si vous la cochez de nouveau.
- Les tests libres restent possibles sur toute la bibliothèque, y compris les notions non cochées. Ils ne modifient jamais le programme étudié.

**Réviser.** L'onglet Réviser propose deux parcours, sur la même progression :

- **Révision du jour** (par défaut) : toutes les cartes du programme étudié dont l'échéance est atteinte, plus les nouvelles cartes du jour (quota réglable dans Plus › « Nouvelles cartes par jour »). Touchez « Commencer la révision ».
- **Personnalisée** : choisissez une ou plusieurs matières, thèmes ou notions de votre programme pour concentrer la séance. Seules les cartes dont l'échéance est atteinte et les nouvelles cartes du quota sont proposées : ce parcours restreint le périmètre, il n'avance pas les révisions.

Avant de commencer, la carte « Votre séance » indique les cartes en retard, à revoir aujourd'hui, nouvelles, et le total. Une carte révisée dans un parcours n'est pas reproposée dans l'autre avant sa prochaine échéance, et les nouvelles cartes du jour sont comptées une seule fois pour les deux parcours.


## 9. Nouvelle présentation (refonte de l'interface)

- **Accueil** : la séance en cours à reprendre apparaît en premier, puis la révision du jour, la régularité de la semaine (un jour compte dès qu'au moins une carte a été évaluée en révision programmée ; les tests libres ne comptent pas) et les accès au test libre et à la bibliothèque. Le soleil ou les étoiles et la salutation suivent l'heure de l'appareil (jour de 6 h à 18 h), quel que soit le thème.
- **Bibliothèque** : le champ de recherche filtre les matières ; « Rechercher … dans les cartes » lance la recherche plein texte. Sur un niveau, « Lancer un test » et « Réviser » sont directement visibles ; statistiques, ajout de carte et fusion de libellés sont dans « Plus d'actions ».
- **Cartes** : pendant une révision ou un test, la carte indique sa catégorie issue de sa dernière évaluation prise en compte (Jamais révisée, À revoir, Difficile, Correct, Facile). Le message « Bonne réponse » ou « Réponse incorrecte » d'un QCM est temporaire.
- **Test libre** : le chronomètre s'active par un interrupteur, qui fait apparaître ses réglages ; « Ordre aléatoire » est un interrupteur ; les filtres (difficulté, type pédagogique, statut de maîtrise) sont dans « Filtres avancés ».
- **Statistiques** : un sélecteur choisit toute la bibliothèque ou une matière. La « Performance par matière » est un indicateur de performance aux exercices (taux de QCM justes et part des questions ouvertes notées « À revoir » ou « Difficile »), pas une mesure de mémorisation ; une matière n'est classée qu'à partir de 10 réponses, et le point fort et le point faible n'apparaissent qu'avec au moins deux matières classées.
- **Plus** : les réglages sont regroupés par rubrique (nouvelles cartes par jour, affichage, tests libres, import et collections, sauvegarde, application). Dans Affichage, « Mode automatique » suit l'apparence de l'appareil ; désactivé, il permet de choisir le mode clair ou sombre.

## 10. Tests libres et mémorisation

Les tests libres et les révisions programmées alimentent le même état de mémorisation. Les règles sont prudentes :

- **Échec** (QCM faux, question ouverte « À revoir » ou « Difficile ») : la carte est rapprochée (revue le lendemain), quelle que soit son échéance.
- **Question ouverte « Correct » ou « Facile »** : la carte progresse sur l'échelle correspondante si elle est proche de son échéance, c'est-à-dire due ou dans le dernier quart de son intervalle (par exemple 7 jours avant pour un intervalle de 30 jours). Plus tôt, la réussite est sans effet.
- **QCM juste** : la carte progresse d'un palier « Correct » seulement si son échéance est atteinte. Plus tôt, la réussite est sans effet.
- **Carte nouvelle** : un échec la fait revoir le lendemain ; une première réussite la programme à trois jours. Elle n'est plus « nouvelle » en révision et ne consomme pas le quota du jour.
- **Une seule évaluation compte par carte et par jour.** Répéter une question le même jour ne la fait pas progresser davantage ; un échec, en revanche, remplace une réussite du jour. Une révision programmée faite après un test libre le même jour remplace l'évaluation du test.
- Les évaluations antérieures à cette version ne sont pas recalculées. Les tests libres ne comptent pas dans la régularité de l'Accueil.

**Après une autoévaluation**, la carte reste affichée avec la réponse : touchez « Suivant » (ou « Voir le bilan » à la dernière question) pour continuer. Il en va de même en révision après la note d'un QCM juste.

**Chronomètre de la révision** : chaque séance de révision dispose d'un temps indicatif d'une minute par carte prévue. Il démarre seul, peut être mis en pause et n'interrompt jamais la séance : une fois le temps écoulé, le dépassement s'affiche (« +02:15 »). Le bilan indique la durée réelle et le temps prévu. Le temps est compté lorsque l'application est affichée et enregistré régulièrement : un rechargement n'en perd au plus que quelques secondes.

**Apparence** : en mode automatique, l'application suit le réglage clair ou sombre de l'appareil, sans tenir compte de l'heure. Si elle passe en sombre en journée, vérifiez le réglage d'apparence du téléphone (mode sombre programmé, économiseur de batterie) ou un mode sombre forcé du navigateur.
