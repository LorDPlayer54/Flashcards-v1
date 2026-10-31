// Recette intégrée du lot 3 (lots 1, 2, 3A, 3B) : une même bibliothèque traverse toute la chaîne.
//  révision programmée → modification de cartes révisées (conserver / réinitialiser) → fusion de libellés →
//  réimportation du fichier d'origine → test libre après reclassement (aperçu périmé refusé) →
//  pause, fermeture, réouverture, reprise, expiration → statistiques le jour même et le lendemain.
// À chaque étape : identifiants, échéances et historique contrôlés.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Card, SelfEval, TestConfig, TestSession } from '../domain/types';
import { buildCards } from '../imports/buildCards';
import { analyseFile } from '../imports/importFlow';
import { parseCsvBytes } from '../imports/csvParse';
import { contentFromForm, formFromCard } from '../library/cardForm';
import { newRemainingToday, planReview } from '../review/queue';
import { addDays } from '../review/schedule';
import { activity, collectAnswers, levelCounts, resultStats, sessionHistory, weakSpots } from '../statistics/stats';
import { openFlashcardsDb, type DB } from '../storage/db';
import * as repo from '../storage/repo';
import { buildTaxonomy, cardsUnder, childNodeId, nodeIdFor, ROOT_ID } from '../taxonomy/tree';
import { applyTestFilters, NO_FILTERS, resolveScope } from './selection';
import { advance, createSession, currentCardId, gradeMcq, isRepeatPosition, pauseSession, rateMcq, recordAnswer, resumeSession, selfEvaluate } from './session';
import { SessionController } from './sessionController';
import { applyUserTransition, enforceTimeLimit, timeLeft, type TimeSource } from './timeLimit';

const D0 = '2026-11-02';
const T0 = Date.parse(`${D0}T09:00:00.000Z`);
const iso = (ms: number) => new Date(ms).toISOString();
const dayOf = (s: string) => s.slice(0, 10);

const HEADER = 'ID;Matière;Thème;Notion;Difficulté;Question;Réponse';
const ROWS = [
  ['F1', 'Calcul', 'Fraction', 'Addition', 'Facile', 'Combien font 1/4 + 1/4 ?', '1/2'],
  ['F2', 'Calcul', 'Fraction', 'Addition', 'Moyen', 'Combien font 1/2 + 1/2 ?\nA) 1  B) 2', 'A) 1'],
  ['G1', 'Calcul', 'Fractions', 'Simplification', 'Facile', 'Simplifier 2/4.', '1/2'],
  ['G2', 'Calcul', 'Fractions', 'Simplification', 'Difficile', 'Simplifier 12/18.', '2/3'],
  ['G3', 'Calcul', 'Fractions', 'Comparaison', 'Moyen', 'La plus grande ?\nA) 2/3  B) 3/5', 'A) 2/3'],
  ['G4', 'Calcul', 'Fractions', 'Comparaison', 'Facile', '1/3 ou 1/4 ?', '1/3'],
  ['P1', 'Calcul', 'Pourcentages', '', 'Moyen', '10 % de 50 ?', '5'],
  ['P2', 'Calcul', 'Pourcentages', '', 'Facile', '50 % de 8 ?', '4'],
  ['A1', 'Anglais', 'Grammaire', '', 'Facile', 'Past of go?', 'went'],
  ['A2', 'Anglais', 'Grammaire', '', 'Moyen', 'Past of see?', 'saw'],
];
const CSV = [HEADER, ...ROWS.map((r) => r.map((c) => (c.includes('\n') ? `"${c}"` : c)).join(';'))].join('\n');
const M = { externalId: 0, matiere: 1, theme: 2, notion: 3, difficulte: 4, question: 5, reponse: 6 };
const parsed = () => parseCsvBytes(new TextEncoder().encode(CSV));
const drafts = () => buildCards(parsed().rows, M, {}, { rowNumbers: parsed().rowNumbers }).drafts;

const calcul = nodeIdFor([{ kind: 'matiere', label: 'Calcul' }]);
const fraction = childNodeId(calcul, 'theme', 'Fraction');
const fractions = childNodeId(calcul, 'theme', 'Fractions');

async function byExt(db: DB): Promise<Record<string, Card>> {
  const all = await db.getAll('cards');
  return Object.fromEntries(all.map((c) => [c.externalId!, c]));
}

/** Révision programmée pilotée carte par carte (premier passage, puis reprise des « À revoir ») */
type Decision = SelfEval | 'wrong';
async function runRevision(db: DB, nodeId: string, plan: Record<string, { first: Decision; repeat?: Decision }>, now: string) {
  const metas = await repo.loadAllMeta(db);
  const states = await repo.loadReviewStates(db);
  const remaining = newRemainingToday(await repo.countIntroducedOn(db, D0), await repo.getNewPerDay(db));
  const preview = planReview(resolveScope({ kind: 'node', nodeId }, buildTaxonomy(metas), metas), states, D0, remaining);
  const res = await repo.startReviewSession(db, { nodeId, scopeLabel: 'Calcul', expectedQueue: preview.queue, confirmedReplace: [], today: D0, now });
  if (res.status !== 'started') throw new Error(res.status);
  const cards = Object.fromEntries((await db.getAll('cards')).map((c) => [c.cardId, c]));
  const ctl = new SessionController(res.session, (x) => repo.saveRevisionTransition(db, x, D0, now));
  while (ctl.current.status === 'in_progress') {
    const s = ctl.current;
    const card = cards[currentCardId(s)!]!;
    const step = plan[card.externalId!]!;
    const d = (isRepeatPosition(s) ? step.repeat : step.first) ?? 'good';
    let next: TestSession;
    if (card.formatQuestion === 'mcq') {
      const wrong = card.options!.find((o) => o.id !== card.correctOptionId)!.id;
      next =
        d === 'wrong' || d === 'again'
          ? recordAnswer(s, card.cardId, gradeMcq(card, wrong, now, 'revision'))
          : rateMcq(recordAnswer(s, card.cardId, gradeMcq(card, card.correctOptionId!, now, 'revision')), card.cardId, d, now);
    } else next = recordAnswer(s, card.cardId, selfEvaluate(d === 'wrong' ? 'again' : d, now));
    const out = await ctl.apply(advance(next, now));
    if (out.status !== 'saved') throw new Error(out.status);
  }
  return ctl.current;
}

const src = (atMs: number): TimeSource => ({ now: () => atMs, peek: () => 0, take: () => 0 });

describe('recette intégrée du lot 3', () => {
  it('révision → modification → fusion → réimportation → test après reclassement → pause/fermeture → statistiques', async () => {
    const name = `lot3-integration-${Date.now()}`;
    let db = await openFlashcardsDb(name);
    const imp = await repo.commitImport(db, { kind: 'new', name: 'Banque' }, 'banque.csv', drafts(), iso(T0));
    const collectionId = imp.collectionId;
    const ids0 = Object.fromEntries(Object.entries(await byExt(db)).map(([k, c]) => [k, c.cardId]));
    expect(Object.keys(ids0)).toHaveLength(10);

    // ---------- 1. Révision programmée de Calcul (lot 2) ----------
    const revision = await runRevision(
      db,
      calcul,
      {
        F1: { first: 'good' },
        F2: { first: 'wrong', repeat: 'good' },
        G1: { first: 'hard' },
        G2: { first: 'easy' },
        G3: { first: 'easy' },
        G4: { first: 'again', repeat: 'good' },
        P1: { first: 'good' },
        P2: { first: 'easy' },
      },
      iso(T0),
    );
    expect(revision).toMatchObject({ status: 'finished', repeatIds: [ids0.F2, ids0.G4] });
    const states1 = await repo.loadReviewStates(db);
    expect(states1.size).toBe(8);
    expect(states1.get(ids0.F2!)).toMatchObject({ status: 'learning', dueDay: addDays(D0, 1), lapses: 1 });
    expect(states1.get(ids0.G2!)).toMatchObject({ status: 'review', dueDay: addDays(D0, 7) });
    const log1 = await db.getAll('reviewLog');
    expect(log1).toHaveLength(10); // 8 premiers passages + 2 reprises

    // ---------- 2. Modification de cartes déjà révisées (3B) ----------
    let cards = await byExt(db);
    const keep = contentFromForm({ ...formFromCard(cards.F1!), reponse: '2/4, soit 1/2' }, cards.F1!);
    const reset = contentFromForm({ ...formFromCard(cards.G1!), question: 'Simplifier 2/4 (forme irréductible).' }, cards.G1!);
    if (!keep.ok || !reset.ok) throw new Error('formulaire');
    expect([keep.majorChange, reset.majorChange]).toEqual([true, true]);
    await repo.updateCard(db, { cardId: ids0.F1!, expectedUpdatedAt: cards.F1!.updatedAt, content: keep.content, resetReview: false, now: iso(T0 + 1000) });
    await repo.updateCard(db, { cardId: ids0.G1!, expectedUpdatedAt: cards.G1!.updatedAt, content: reset.content, resetReview: true, now: iso(T0 + 1000) });
    const states2 = await repo.loadReviewStates(db);
    expect(states2.get(ids0.F1!)).toEqual(states1.get(ids0.F1!)); // conservé
    expect(states2.has(ids0.G1!)).toBe(false); // réinitialisé
    expect(await db.getAll('reviewLog')).toEqual(log1); // historique intact

    // ---------- 3. Fusion « Fraction » + « Fractions » → « Fractions » (3B) ----------
    // Aperçu d'un test libre préparé AVANT la fusion, sur l'ancien thème (sera périmé)
    const metasBefore = await repo.loadAllMeta(db);
    const stalePreview = resolveScope({ kind: 'node', nodeId: fraction }, buildTaxonomy(metasBefore), metasBefore).map((m) => m.cardId);
    expect(stalePreview.sort()).toEqual([ids0.F1, ids0.F2].sort());
    const merge = await repo.mergeLabels(db, { parentId: calcul, level: 'theme', from: ['Fraction', 'Fractions'], to: 'Fractions', expectedCounts: { Fraction: 2, Fractions: 4 }, now: iso(T0 + 2000) });
    expect(merge).toMatchObject({ status: 'merged', updated: 2 });
    cards = await byExt(db);
    expect(Object.fromEntries(Object.entries(cards).map(([k, c]) => [k, c.cardId]))).toEqual(ids0);
    expect(cards.F1).toMatchObject({ theme: 'Fractions', reponse: '2/4, soit 1/2' });
    expect(await repo.loadReviewStates(db)).toEqual(states2);
    expect(await db.getAll('reviewLog')).toEqual(log1);

    // ---------- 4. Réimportation du fichier d'origine (lot 1 + règles de fusion) ----------
    const analysis = await analyseFile(
      parsed(),
      { targetKind: 'existing', existingId: collectionId, newName: '', mapping: M, fixed: {}, ambiguousAsOpen: false },
      (cid) => repo.getCardsOfCollection(db, cid),
      await repo.getLabelRules(db),
    );
    expect(analysis.remapped).toBe(2);
    // Seules les deux cartes modifiées dans l'application diffèrent du fichier
    expect(analysis.plan.toUpdate.map((u) => u.existing.externalId).sort()).toEqual(['F1', 'G1']);
    expect(analysis.plan.toUpdate.every((u) => u.majorChange && u.existing.editedAt)).toBe(true);
    expect(analysis.plan).toMatchObject({ toAdd: [], unchanged: 8 });
    const re = await repo.commitImport(db, { kind: 'existing', collectionId }, 'banque.csv', drafts(), iso(T0 + 3000), { resetReviewFor: [] });
    expect(re).toMatchObject({ added: 0, updated: 2, unchanged: 8, reviewReset: 0 });
    cards = await byExt(db);
    expect(Object.values(cards).filter((c) => c.theme === 'Fraction')).toEqual([]); // la fusion tient
    expect(cards.F1).toMatchObject({ theme: 'Fractions', reponse: '1/2', cardId: ids0.F1 }); // version du fichier
    expect(cards.F1!.editedAt).toBeUndefined();
    const states4 = await repo.loadReviewStates(db);
    expect(states4).toEqual(states2);
    expect(await db.getAll('reviewLog')).toEqual(log1);

    // ---------- 5. Test libre après reclassement (3A, revalidé) ----------
    const learningCfg: TestConfig = {
      count: null,
      format: 'all',
      order: 'library',
      filters: { ...NO_FILTERS, statuses: ['learning'] },
      timer: { mode: 'limit', limitSec: 600, pausable: true },
    };
    // L'aperçu préparé sur l'ancien thème est refusé, rien n'est écrit
    const stale = createSession({ kind: 'node', nodeId: fraction }, 'Calcul › Fraction', { ...learningCfg, filters: NO_FILTERS }, stalePreview, iso(T0));
    expect(await repo.startTestSession(db, { session: stale, expectedEligible: stalePreview, confirmedReplace: [], now: iso(T0 + 4000) })).toMatchObject({
      status: 'changed',
      eligibleCount: 0,
    });
    // Nouvel aperçu sur le thème fusionné, statut « En apprentissage »
    const metas5 = await repo.loadAllMeta(db);
    const tax5 = buildTaxonomy(metas5);
    const scoped = resolveScope({ kind: 'node', nodeId: fractions }, tax5, metas5);
    expect(scoped).toHaveLength(6);
    const eligible = applyTestFilters(scoped, { format: 'all', filters: learningCfg.filters! }, states4).eligible.map((m) => m.cardId);
    expect(eligible).toEqual([ids0.F2, ids0.G4]); // G1 réinitialisée : « Nouvelle »
    const TL = T0 + 10_000;
    const launched = await repo.startTestSession(db, {
      session: createSession({ kind: 'node', nodeId: fractions }, 'Calcul › Fractions', learningCfg, eligible, iso(TL)),
      expectedEligible: eligible,
      confirmedReplace: [],
      now: iso(TL),
    });
    if (launched.status !== 'started') throw new Error(launched.status);
    expect(launched.session.deadlineAt).toBe(iso(TL + 600_000));

    // ---------- 6. Pause, fermeture, réouverture, reprise, expiration (3A/3B) ----------
    let ctl = new SessionController(launched.session, (x) => repo.saveSessionTransition(db, x));
    const f2 = cards.F2!;
    expect((await applyUserTransition(ctl, src(TL + 60_000), (s) => advance(recordAnswer(s, f2.cardId, gradeMcq(f2, 'A', iso(TL + 60_000))), iso(TL + 60_000)))).status).toBe('saved');
    expect((await applyUserTransition(ctl, src(TL + 90_000), (s) => pauseSession(s, iso(TL + 90_000)))).status).toBe('saved');
    db.close();
    db = await openFlashcardsDb(name); // trois heures plus tard
    const T3 = TL + 3 * 3_600_000;
    let s6 = (await repo.getSession(db, launched.session.sessionId))!;
    expect(s6).toMatchObject({ status: 'in_progress', pausedAt: iso(TL + 90_000), elapsedMs: 90_000, currentIndex: 1 });
    ctl = new SessionController(s6, (x) => repo.saveSessionTransition(db, x));
    expect(timeLeft(s6, src(T3))).toBe(510_000);
    expect(await enforceTimeLimit(ctl, src(T3))).toEqual({ status: 'none' });
    await expect(applyUserTransition(ctl, src(T3), (s) => recordAnswer(s, ids0.G4!, selfEvaluate('good', iso(T3))))).rejects.toThrow(/pause/);
    expect((await applyUserTransition(ctl, src(T3), (s) => resumeSession(s, iso(T3)))).status).toBe('saved');
    expect(ctl.current.deadlineAt).toBe(iso(T3 + 510_000));
    db.close();
    db = await openFlashcardsDb(name); // fermeture brutale, réouverture après la nouvelle échéance
    s6 = (await repo.getSession(db, launched.session.sessionId))!;
    ctl = new SessionController(s6, (x) => repo.saveSessionTransition(db, x));
    const late = await applyUserTransition(ctl, src(T3 + 600_000), (s) => recordAnswer(s, ids0.G4!, selfEvaluate('good', iso(T3 + 600_000))));
    expect(late.status).toBe('expired');
    const ended = (await repo.getSession(db, launched.session.sessionId))!;
    expect(ended).toMatchObject({ status: 'finished', timedOut: true, elapsedMs: 600_000 });
    expect(Object.keys(ended.answers)).toEqual([ids0.F2]);
    expect(ended.pausedAt).toBeUndefined();
    // Le test libre n'a touché ni aux échéances ni à l'historique
    expect(await repo.loadReviewStates(db)).toEqual(states4);
    expect(await db.getAll('reviewLog')).toEqual(log1);

    // ---------- 7. Statistiques après ces opérations (3B) ----------
    const metas7 = await repo.loadAllMeta(db);
    const tax7 = buildTaxonomy(metas7);
    const states7 = await repo.loadReviewStates(db);
    const sessions = await repo.listAllSessions(db);
    const facts = collectAnswers(sessions, dayOf);
    // Jour même : 7 cartes étudiées (G1 réinitialisée), aucune due
    expect(levelCounts(metas7, states7, D0)).toEqual({ cards: 10, studied: 7, fresh: 3, due: 0, mastered: 0 });
    // Lendemain : F2 et G4 (À revoir) dues ; G1 n'est pas due (nouvelle)
    expect(levelCounts(metas7, states7, addDays(D0, 1))).toEqual({ cards: 10, studied: 7, fresh: 3, due: 2, mastered: 0 });
    expect(levelCounts(cardsUnder(tax7, metas7, fractions), states7, addDays(D0, 1))).toEqual({ cards: 6, studied: 5, fresh: 1, due: 2, mastered: 0 });
    expect(tax7.byId.has(fraction)).toBe(false);
    // Réponses : 8 premiers passages de la révision + 1 réponse du test libre (la réponse tardive n'existe pas)
    expect(resultStats(facts)).toEqual({
      mcq: { answered: 3, correct: 2, rate: 2 / 3 },
      open: { answered: 6, byEval: { again: 1, hard: 1, good: 2, easy: 2 } },
      byMode: { libre: { answers: 1, mcqAnswered: 1, mcqCorrect: 1 }, revision: { answers: 8, mcqAnswered: 2, mcqCorrect: 1 } },
    });
    // Les réponses enregistrées avant la fusion sont rattachées au thème fusionné
    const inFractions = new Set(cardsUnder(tax7, metas7, fractions).map((m) => m.cardId));
    expect(resultStats(facts.filter((f) => inFractions.has(f.cardId))).mcq).toEqual({ answered: 3, correct: 2, rate: 2 / 3 });
    expect(weakSpots(facts, tax7).map((w) => [w.label, w.answered, w.errors])).toEqual([['Calcul › Fractions › Addition', 3, 1]]);
    expect(activity(facts, D0, 7).at(-1)).toEqual({ day: D0, libre: 1, revision: 8 });
    expect(sessionHistory(sessions).map((h) => [h.mode, h.status, h.answered, h.total])).toEqual([
      ['libre', 'finished', 1, 2],
      ['revision', 'finished', 8, 8],
    ]);
    // Révision du lendemain sur le thème fusionné : exactement les cartes dues + la nouvelle
    const plan = planReview(cardsUnder(tax7, metas7, fractions), states7, addDays(D0, 1), 20);
    expect([...plan.due].sort()).toEqual([ids0.F2, ids0.G4].sort());
    expect(plan.fresh).toEqual([ids0.G1]);
    // Racine : un seul nœud racine, et les identifiants de départ n'ont jamais changé
    expect(tax7.root.id).toBe(ROOT_ID);
    expect(Object.fromEntries(Object.entries(await byExt(db)).map(([k, c]) => [k, c.cardId]))).toEqual(ids0);
  });
});
