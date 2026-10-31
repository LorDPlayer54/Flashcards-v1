// Lot 3B : statistiques. Fonctions pures, testées. Elles ne lisent que les données enregistrées :
//  - cartes (projection en mémoire) et arbre des niveaux ;
//  - états de mémorisation (répétition espacée) : étudiées, nouvelles, dues, maîtrisées ;
//  - séances (tests libres et révisions programmées) : réponses, justesse des QCM, autoévaluations, activité.
//
// Conventions :
//  - une réponse = le premier passage d'une carte dans une séance (les reprises de fin de révision ne sont pas
//    recomptées) ; une question ouverte dont l'autoévaluation est restée en attente n'est pas comptée ;
//  - taux de réussite OBJECTIF : QCM seulement ; questions ouvertes : répartition des autoévaluations, à part ;
//  - « difficulté » d'un niveau : (QCM faux + questions ouvertes « À revoir ») / réponses, à partir de 3 réponses ;
//  - jour d'une réponse : date locale de l'appareil ;
//  - vue globale : toutes les réponses enregistrées, y compris celles de cartes supprimées depuis ; vue d'un niveau :
//    réponses des cartes actuellement classées dans ce niveau.
import type { CardMeta, SelfEval, SessionMode, TestSession } from '../domain/types';
import { addDays, isDue, isMastered, localDay, type ReviewState } from '../review/schedule';
import { summarize } from '../tests/session';
import { nodePathLabel, ROOT_ID, type Taxonomy, type TaxNode } from '../taxonomy/tree';

export interface LevelCounts {
  cards: number;
  /** Cartes ayant un état de mémorisation (déjà notées en révision programmée) */
  studied: number;
  /** Cartes jamais notées en révision programmée */
  fresh: number;
  /** Cartes dont l'échéance est aujourd'hui ou passée */
  due: number;
  mastered: number;
}

export function levelCounts(metas: readonly CardMeta[], states: ReadonlyMap<string, ReviewState>, today: string): LevelCounts {
  const c: LevelCounts = { cards: metas.length, studied: 0, fresh: 0, due: 0, mastered: 0 };
  for (const m of metas) {
    const st = states.get(m.cardId);
    if (!st) {
      c.fresh++;
      continue;
    }
    c.studied++;
    if (isDue(st, today)) c.due++;
    if (isMastered(st)) c.mastered++;
  }
  return c;
}

export interface ChildRow {
  node: TaxNode;
  counts: LevelCounts;
}

/** Compteurs de chaque sous-niveau direct d'un nœud. */
export function childRows(node: TaxNode, metas: readonly CardMeta[], tax: Taxonomy, states: ReadonlyMap<string, ReviewState>, today: string): ChildRow[] {
  const byChild = new Map<string, CardMeta[]>(node.children.map((c) => [c.id, []]));
  for (const m of metas) {
    const chain = tax.pathOf.get(m.cardId);
    if (!chain) continue;
    const at = node.id === ROOT_ID ? 0 : chain.indexOf(node.id) + 1;
    if (node.id !== ROOT_ID && at === 0) continue;
    const child = chain[at];
    if (child) byChild.get(child)?.push(m);
  }
  return node.children.map((c) => ({ node: c, counts: levelCounts(byChild.get(c.id) ?? [], states, today) }));
}

export interface AnswerFact {
  cardId: string;
  sessionId: string;
  mode: SessionMode;
  kind: 'mcq' | 'open';
  correct?: boolean;
  selfEval?: SelfEval;
  day: string;
}

/** Réponses enregistrées (premier passage), toutes séances confondues, quel que soit leur statut. */
export function collectAnswers(sessions: readonly TestSession[], dayOf: (iso: string) => string = (iso) => localDay(new Date(iso))): AnswerFact[] {
  const out: AnswerFact[] = [];
  for (const s of sessions) {
    for (const [cardId, a] of Object.entries(s.answers)) {
      if (a.kind === 'deferred') continue;
      const base = { cardId, sessionId: s.sessionId, mode: s.mode, day: dayOf(a.answeredAt) };
      out.push(a.kind === 'mcq' ? { ...base, kind: 'mcq', correct: a.correct } : { ...base, kind: 'open', selfEval: a.selfEval });
    }
  }
  return out;
}

export const isError = (f: AnswerFact) => (f.kind === 'mcq' ? !f.correct : f.selfEval === 'again');

export interface ResultStats {
  /** Taux de réussite objectif : QCM uniquement */
  mcq: { answered: number; correct: number; rate: number | null };
  /** Questions ouvertes : appréciation personnelle, présentée séparément */
  open: { answered: number; byEval: Record<SelfEval, number> };
  byMode: Record<SessionMode, { answers: number; mcqAnswered: number; mcqCorrect: number }>;
}

export function resultStats(facts: readonly AnswerFact[]): ResultStats {
  const r: ResultStats = {
    mcq: { answered: 0, correct: 0, rate: null },
    open: { answered: 0, byEval: { again: 0, hard: 0, good: 0, easy: 0 } },
    byMode: { libre: { answers: 0, mcqAnswered: 0, mcqCorrect: 0 }, revision: { answers: 0, mcqAnswered: 0, mcqCorrect: 0 } },
  };
  for (const f of facts) {
    const m = r.byMode[f.mode];
    m.answers++;
    if (f.kind === 'mcq') {
      r.mcq.answered++;
      m.mcqAnswered++;
      if (f.correct) {
        r.mcq.correct++;
        m.mcqCorrect++;
      }
    } else if (f.selfEval) {
      r.open.answered++;
      r.open.byEval[f.selfEval]++;
    }
  }
  r.mcq.rate = r.mcq.answered ? r.mcq.correct / r.mcq.answered : null;
  return r;
}

export interface DayActivity {
  day: string;
  libre: number;
  revision: number;
}

/** Réponses par jour sur les `days` derniers jours (du plus ancien à aujourd'hui inclus). */
export function activity(facts: readonly AnswerFact[], today: string, days: number): DayActivity[] {
  const first = addDays(today, -(days - 1));
  const rows = Array.from({ length: days }, (_, i) => ({ day: addDays(first, i), libre: 0, revision: 0 }));
  const byDay = new Map(rows.map((r) => [r.day, r]));
  for (const f of facts) {
    const row = byDay.get(f.day);
    if (row) row[f.mode]++;
  }
  return rows;
}

export interface ActivitySummary {
  answers: number;
  activeDays: number;
  sessions: number;
}

export function summarizeActivity(rows: readonly DayActivity[], facts: readonly AnswerFact[]): ActivitySummary {
  const days = new Set(rows.map((r) => r.day));
  const inWindow = facts.filter((f) => days.has(f.day));
  return {
    answers: inWindow.length,
    activeDays: rows.filter((r) => r.libre + r.revision > 0).length,
    sessions: new Set(inWindow.map((f) => f.sessionId)).size,
  };
}

export interface WeakSpot {
  nodeId: string;
  label: string;
  answered: number;
  errors: number;
  errorRate: number;
}

/**
 * Niveaux les plus difficiles : regroupement par niveau le plus précis de la carte (la notion, ou à défaut la leçon,
 * le thème ou la matière), au moins `minAnswers` réponses et une erreur ; tri par taux d'erreur puis par volume.
 */
export function weakSpots(facts: readonly AnswerFact[], tax: Taxonomy, opts: { minAnswers?: number; limit?: number } = {}): WeakSpot[] {
  const min = opts.minAnswers ?? 3;
  const acc = new Map<string, { answered: number; errors: number }>();
  for (const f of facts) {
    const chain = tax.pathOf.get(f.cardId);
    const leaf = chain?.[chain.length - 1];
    if (!leaf) continue; // carte supprimée depuis
    const a = acc.get(leaf) ?? { answered: 0, errors: 0 };
    a.answered++;
    if (isError(f)) a.errors++;
    acc.set(leaf, a);
  }
  return [...acc.entries()]
    .filter(([, a]) => a.answered >= min && a.errors > 0)
    .map(([nodeId, a]) => ({ nodeId, label: nodePathLabel(tax, nodeId), answered: a.answered, errors: a.errors, errorRate: a.errors / a.answered }))
    .sort((x, y) => y.errorRate - x.errorRate || y.answered - x.answered || x.label.localeCompare(y.label, 'fr'))
    .slice(0, opts.limit ?? 5);
}

export interface SessionRow {
  sessionId: string;
  mode: SessionMode;
  scopeLabel: string;
  /** Lot 4 : périmètre (pour afficher son libellé actuel après un renommage) */
  scope: TestSession['scope'];
  status: TestSession['status'];
  phase?: TestSession['phase'];
  /** Date de fin, ou de dernière activité */
  at: string;
  answered: number;
  total: number;
  mcqAnswered: number;
  mcqCorrect: number;
  openAnswered: number;
  again: number;
}

/** Historique des séances, de la plus récente à la plus ancienne ; filtré sur celles qui comportent une carte du niveau. */
export function sessionHistory(sessions: readonly TestSession[], opts: { inScope?: (cardId: string) => boolean; limit?: number } = {}): SessionRow[] {
  return sessions
    .filter((s) => !opts.inScope || s.cardIds.some(opts.inScope))
    .map((s) => {
      const sum = summarize(s);
      return {
        sessionId: s.sessionId,
        mode: s.mode,
        scopeLabel: s.scopeLabel,
        scope: s.scope,
        status: s.status,
        phase: s.phase,
        at: s.finishedAt ?? s.updatedAt,
        answered: sum.answered,
        total: sum.total,
        mcqAnswered: sum.mcq.answered,
        mcqCorrect: sum.mcq.correct,
        openAnswered: sum.open.answered,
        again: sum.open.byEval.again,
      };
    })
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, opts.limit ?? 20);
}
