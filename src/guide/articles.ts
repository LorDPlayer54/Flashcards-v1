// Guide embarqué (Plus › Aide › Guide) : dix articles, contenu local, sans réseau ni stockage.
// Registre typé : une mise à jour du fonctionnement (chronomètre, mode examen, règles de mémorisation) se fait ici.
// Les affirmations sur la mémorisation reflètent src/review/schedule.ts (voir aussi docs/GUIDE_UTILISATEUR.md, section 10).

export type ToolTarget = 'library' | 'program' | 'review' | 'test' | 'import';

export type Block =
  | { t: 'p'; text: string }
  | { t: 'note'; text: string }
  | { t: 'section'; title: string; blocks: Block[] }
  | { t: 'steps'; items: { title: string; text: string }[] }
  | { t: 'grades'; items: { cat: 'again' | 'hard' | 'good' | 'easy'; title: string; text: string }[] }
  | { t: 'tools'; items: { title: string; target: ToolTarget }[] }
  | { t: 'list'; items: string[] };

export interface GuideArticle {
  id: string;
  group: 'Premiers pas' | 'Séances et apprentissage' | 'Suivre et protéger ses progrès';
  title: string;
  desc: string;
  intro: string;
  icon: 'book' | 'layers' | 'review' | 'sliders' | 'stats' | 'import' | 'download' | 'app' | 'edit' | 'protect';
  blocks: Block[];
  related?: string[];
  /** Bouton principal : ouvre la PRÉPARATION de l'écran (jamais le lancement d'une séance) */
  cta?: { label: string; target: ToolTarget };
}

const p = (text: string): Block => ({ t: 'p', text });
const note = (text: string): Block => ({ t: 'note', text });
const section = (title: string, ...blocks: Block[]): Block => ({ t: 'section', title, blocks });

export const GUIDE: GuideArticle[] = [
  {
    id: 'start',
    group: 'Premiers pas',
    title: 'Bien démarrer',
    desc: 'Les trois premières étapes',
    intro: 'De votre bibliothèque à votre première révision.',
    icon: 'book',
    blocks: [
      {
        t: 'steps',
        items: [
          { title: 'Importer vos cartes', text: 'Ajoutez un fichier CSV. Vos matières, thèmes et notions apparaissent dans la Bibliothèque.' },
          { title: 'Déclarer les notions étudiées', text: 'Dans « Mon programme étudié », cochez ce que vous avez déjà vu en cours.' },
          { title: 'Lancer « Révision du jour »', text: "L'application vous propose les cartes éligibles selon vos échéances et la limite quotidienne de nouvelles cartes." },
        ],
      },
      note("Vous souhaitez simplement vous entraîner ? Le test libre est accessible même sans notion cochée."),
      section('Où trouver ces outils ?', {
        t: 'tools',
        items: [
          { title: 'Bibliothèque', target: 'library' },
          { title: 'Mon programme étudié', target: 'program' },
          { title: 'Réviser', target: 'review' },
          { title: 'Démarrer un test libre', target: 'test' },
          { title: 'Importer un CSV', target: 'import' },
        ],
      }),
    ],
    related: ['review', 'test'],
  },
  {
    id: 'program',
    group: 'Premiers pas',
    title: 'Mon programme étudié',
    desc: 'Choisir les notions vues en cours',
    intro: 'Indiquez les notions que vous avez réellement vues en cours.',
    icon: 'layers',
    blocks: [
      section('À quoi sert ce programme ?', p('La révision programmée travaille à partir des notions déclarées étudiées. Cela évite de vous proposer des notions encore inconnues.')),
      section('Comment le remplir ?', p('Ouvrez « Mon programme étudié », dépliez une matière, un thème ou une leçon, puis cochez les notions déjà vues. Une case marquée d’un trait signale un niveau partiellement coché. Chaque case est enregistrée aussitôt.')),
      section('Que se passe-t-il après un import ?', p("Une nouvelle notion importée reste non étudiée, même si son thème était déjà coché. En revanche, de nouvelles cartes ajoutées à une notion déjà étudiée peuvent entrer dans le quota quotidien.")),
      note("Décocher une notion ne supprime ni son historique ni ses échéances : ses cartes ne sont simplement plus proposées en révision. Les tests libres n'ajoutent jamais une notion au programme."),
    ],
    related: ['review', 'import'],
  },
  {
    id: 'review',
    group: 'Séances et apprentissage',
    title: 'Révision programmée',
    desc: 'Quelles cartes, à quel moment ?',
    intro: 'Les cartes à revoir au bon moment.',
    icon: 'review',
    blocks: [
      section('Révision du jour', p("Elle rassemble les cartes de votre programme étudié dont l'échéance est arrivée, celles qui sont en retard et les nouvelles cartes autorisées par votre quota quotidien.")),
      section('Révision personnalisée', p("Vous choisissez les matières, thèmes ou notions sur lesquels vous concentrer. Les mêmes échéances et le même quota s'appliquent : ce parcours ne fait pas passer une carte avant sa date.")),
      section('Après une réponse', p("Votre évaluation détermine la prochaine révision de la carte. Une carte déjà travaillée n'est plus considérée comme nouvelle, quel que soit le parcours ou le test qui l'a évaluée.")),
      section('Temps de la séance', p("Un chronomètre démarre avec la séance, à raison d'une minute par carte prévue. Il est indicatif : vous pouvez le mettre en pause, et la séance continue normalement si le temps est dépassé.")),
      note('La révision du jour et la révision personnalisée partagent une seule progression.'),
    ],
    related: ['algorithm', 'test'],
    cta: { label: 'Démarrer une révision', target: 'review' },
  },
  {
    id: 'test',
    group: 'Séances et apprentissage',
    title: 'Test libre',
    desc: "S'entraîner quand vous voulez",
    intro: 'Un entraînement sur les contenus de votre choix.',
    icon: 'sliders',
    blocks: [
      section('Ce que vous choisissez', p('Les matières et notions du test, le type de questions, le nombre de cartes, l’ordre, la correction, le chronomètre éventuel et des filtres avancés.')),
      section('Correction', p("La correction peut être immédiate ou donnée à la fin du test. Dans le mode « simulation d'examen », la pause n'est pas possible.")),
      section('Chronomètre', p("Le test libre peut se faire sans chronomètre, avec un temps écoulé ou avec une limite de temps. Les questions restées sans réponse à la fin du temps sont comptées comme non traitées, pas comme fausses.")),
      section(
        'Effet sur la mémorisation',
        p('Vos réponses alimentent la même mémorisation que la révision programmée, avec prudence :'),
        {
          t: 'list',
          items: [
            'un échec rapproche la carte, même si son échéance est lointaine ;',
            'une réussite ne fait progresser la carte que si elle est proche de son échéance ;',
            "une carte ne compte qu'une fois par jour, et un test libre n'ajoute pas de notion au programme étudié.",
          ],
        },
      ),
    ],
    related: ['review', 'stats'],
    cta: { label: 'Démarrer un test libre', target: 'test' },
  },
  {
    id: 'algorithm',
    group: 'Séances et apprentissage',
    title: "Comment fonctionne l'algorithme ?",
    desc: 'Échéances, évaluations et quota',
    intro: 'La répétition espacée, expliquée simplement.',
    icon: 'edit',
    blocks: [
      {
        t: 'steps',
        items: [
          { title: 'Une carte devient éligible', text: "Elle appartient à une notion étudiée et sa date de révision est arrivée, ou c'est une nouvelle carte autorisée par le quota." },
          { title: 'Vous répondez et vous évaluez', text: 'Sur une question ouverte, quatre évaluations traduisent votre ressenti. Un QCM est corrigé automatiquement.' },
          { title: 'La prochaine échéance est calculée', text: "L'intervalle s'allonge à chaque réussite successive et se raccourcit après une difficulté ou un échec." },
        ],
      },
      section('Les quatre évaluations', {
        t: 'grades',
        items: [
          { cat: 'again', title: 'À revoir', text: 'Je ne connaissais pas la réponse : retour rapide.' },
          { cat: 'hard', title: 'Difficile', text: "Je m'en suis souvenu avec peine : retour rapide, progression ralentie." },
          { cat: 'good', title: 'Correct', text: 'Je connaissais la réponse : intervalle suivant.' },
          { cat: 'easy', title: 'Facile', text: "La réponse est venue sans effort : intervalle plus long." },
        ],
      }),
      section('Et les QCM ?', p("Une mauvaise réponse équivaut à « À revoir ». Après une bonne réponse en révision, vous indiquez si elle était Difficile, Correct ou Facile. En test libre, une bonne réponse ne fait progresser la carte que lorsque son échéance est atteinte.")),
      section('Le quota', p("Le nombre de nouvelles cartes proposées par jour est limité (réglable dans Plus). Les cartes déjà évaluées, y compris en test libre, ne comptent pas dans ce quota.")),
    ],
    related: ['review', 'answers'],
  },
  {
    id: 'answers',
    group: 'Séances et apprentissage',
    title: 'Répondre à une carte',
    desc: 'QCM, réponses ouvertes et correction',
    intro: 'Ce qui se passe à chaque question.',
    icon: 'edit',
    blocks: [
      section('Question ouverte', p("Touchez « Voir la réponse », relisez la réponse et l'explication, puis choisissez votre évaluation. Elle est enregistrée aussitôt ; touchez « Suivant » quand vous êtes prêt.")),
      section('QCM', p("Choisissez une proposition (jusqu'à cinq, de A à E) puis validez. La correction s'affiche, avec l'explication si elle existe. En révision, une bonne réponse est ensuite évaluée avant de continuer.")),
      section('La couleur de la carte', p("Le badge et la couleur d'une carte indiquent sa dernière évaluation prise en compte : Jamais évaluée, À revoir, Difficile, Correct ou Facile. Le message « Bonne réponse » ou « Réponse incorrecte » d'un QCM est temporaire.")),
      note('Quitter une séance ne la perd pas : vous la retrouvez depuis l’Accueil, sans que vos réponses déjà enregistrées soient comptées deux fois.'),
    ],
    related: ['algorithm', 'test'],
  },
  {
    id: 'stats',
    group: 'Suivre et protéger ses progrès',
    title: 'Comprendre les statistiques',
    desc: 'Lire les indicateurs sans les confondre',
    intro: 'Trois mesures différentes, à ne pas mélanger.',
    icon: 'stats',
    blocks: [
      section('Notions étudiées en cours', p('Les notions que vous avez cochées dans votre programme. Cela ne dit rien de votre niveau.')),
      section('Cartes déjà révisées', p('Les cartes qui ont reçu au moins une évaluation, en révision ou en test libre.')),
      section('Cartes maîtrisées', p('Les cartes dont la dernière évaluation est Correct ou Facile avec un intervalle d’au moins deux semaines.')),
      section('Performance par matière', p("Un indicateur calculé sur vos exercices : part de QCM justes et part de questions ouvertes évaluées « À revoir » ou « Difficile ». Il apparaît à partir de 10 réponses par matière et ne mesure pas la mémorisation. Le point fort et le point faible n'apparaissent qu'avec au moins deux matières classées.")),
      note('Une question non traitée n’est jamais comptée comme fausse.'),
    ],
    related: ['review', 'test'],
  },
  {
    id: 'import',
    group: 'Suivre et protéger ses progrès',
    title: 'Importer un fichier CSV',
    desc: 'Ajouter des cartes à sa bibliothèque',
    intro: 'Ajoutez des cartes sans perdre celles que vous avez déjà.',
    icon: 'import',
    blocks: [
      section('Étapes', {
        t: 'steps',
        items: [
          { title: 'Choisir un ou plusieurs fichiers', text: "Les fichiers sont traités l'un après l'autre." },
          { title: 'Vérifier les colonnes', text: "La « Correspondance des colonnes » est repliée par défaut. Dépliez-la pour corriger l'association des champs." },
          { title: "Lire l'analyse puis confirmer", text: "L'analyse indique les cartes valides, mises à jour ou exclues. Rien n'est ajouté avant votre confirmation." },
        ],
      }),
      section('Les erreurs', p("Les lignes problématiques restent visibles avec un accès direct aux colonnes concernées. Une carte exclue peut être corrigée dans le fichier puis réimportée.")),
      note('Réimporter un fichier met à jour les cartes existantes sans effacer leur historique.'),
    ],
    related: ['program', 'backup'],
  },
  {
    id: 'backup',
    group: 'Suivre et protéger ses progrès',
    title: 'Sauvegarder et restaurer',
    desc: 'Garder une copie de ses données',
    intro: 'Vos données sont sur cet appareil : gardez-en une copie.',
    icon: 'protect',
    blocks: [
      section('Sauvegarder', p("Plus › Télécharger une sauvegarde crée un fichier JSON : bibliothèque, programme, séances, mémorisation, historique et réglages. Vous pouvez en choisir le nom. Conservez-le hors du téléphone.")),
      section('Restaurer', p("La restauration remplace les données de l'appareil par celles du fichier, après vérification de celui-ci et confirmation de votre part. Vous pouvez enregistrer vos données actuelles avant de confirmer.")),
      note("Il n'y a aucune synchronisation automatique : travailler sur deux appareils en parallèle crée deux historiques distincts."),
    ],
    related: ['offline', 'import'],
  },
  {
    id: 'offline',
    group: 'Suivre et protéger ses progrès',
    title: 'Utiliser hors connexion',
    desc: "Ce qui fonctionne sans Internet",
    intro: "L'application fonctionne sans réseau une fois préparée.",
    icon: 'app',
    blocks: [
      section('Préparation', p("Ouvrez l'application une première fois avec une connexion. Elle se prépare ensuite pour fonctionner sans Internet, ce que vous pouvez vérifier dans Plus › Application.")),
      section('Installation', p("Sur téléphone, installez l'application depuis le menu du navigateur pour l'ouvrir comme une application. Les mises à jour se proposent à l'ouverture et ne touchent pas à vos données.")),
      section("Changer d'appareil", p('Les données restent sur l’appareil : faites une sauvegarde sur l’ancien, puis restaurez-la sur le nouveau.')),
    ],
    related: ['backup'],
  },
];

export const GUIDE_GROUPS = ['Premiers pas', 'Séances et apprentissage', 'Suivre et protéger ses progrès'] as const;

export function articleById(id: string | undefined): GuideArticle | undefined {
  return GUIDE.find((a) => a.id === id);
}
