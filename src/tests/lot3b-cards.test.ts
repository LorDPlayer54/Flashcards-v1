// Lot 3B : ajout, modification et suppression manuelles des cartes.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Card } from '../domain/types';
import { buildCards } from '../imports/buildCards';
import { contentChanged, contentFromForm, formFromCard, type CardForm } from '../library/cardForm';
import { applyRating } from '../review/schedule';
import { openFlashcardsDb } from '../storage/db';
import * as repo from '../storage/repo';
import { pathKeyOf } from '../taxonomy/tree';

const NOW = '2026-11-02T09:00:00.000Z';
const D = '2026-11-02';
let n = 0;
const M = { externalId: 0, matiere: 1, theme: 2, notion: 3, difficulte: 4, question: 5, reponse: 6, explication: 7 };
const rows = [
  ['CAL-1', 'Calcul', 'Fractions', 'Addition', 'Facile', 'Combien font 1/2 + 1/4 ?\nA) 3/4  B) 2/6  C) 1/8  D) 2/4  E) 1', 'A) 3/4', 'Même dénominateur.'],
  ['CAL-2', 'Calcul', 'Fractions', 'Simplification', 'Moyen', 'Simplifier 6/8.', '3/4', 'Diviser par 2.'],
];

async function library() {
  const db = await openFlashcardsDb(`lot3b-cards-${++n}`);
  const out = await repo.commitImport(db, { kind: 'new', name: 'Calcul' }, 'calcul.csv', buildCards(rows, M, {}).drafts, NOW);
  const cards = await repo.getCardsOfCollection(db, out.collectionId);
  const byExt = (id: string) => cards.find((c) => c.externalId === id)!;
  return { db, collectionId: out.collectionId, qcm: byExt('CAL-1'), open: byExt('CAL-2') };
}

const blank = (over: Partial<CardForm> = {}): CardForm => ({ ...formFromCard(undefined, { matiere: 'Anglais', theme: 'Grammaire' }), ...over });

describe('formulaire : validation et contenu', () => {
  it('question ouverte : champs obligatoires, aucun champ inventé', () => {
    const r = contentFromForm(blank({ matiere: ' ', question: '', reponse: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['matiere', 'question', 'reponse']);
    const ok = contentFromForm(blank({ question: '  What is the past of « go » ?  ', reponse: 'went', lecon: '', difficulte: 'facile' }));
    expect(ok.ok && ok.content).toEqual({
      matiere: 'Anglais',
      theme: 'Grammaire',
      lecon: undefined,
      notion: undefined,
      typePedagogique: undefined,
      difficulte: 'Facile',
      formatQuestion: 'open',
      question: 'What is the past of « go » ?',
      rawQuestion: 'What is the past of « go » ?',
      options: undefined,
      correctOptionId: undefined,
      reponse: 'went',
      explication: undefined,
      astucePiege: undefined,
    });
  });

  it('QCM : 2 à 5 propositions consécutives, distinctes, bonne réponse obligatoire ; réponse au format des imports', () => {
    const q = (options: string[], correctIndex: number | null) => contentFromForm(blank({ formatQuestion: 'mcq', question: 'Choisir', options, correctIndex }));
    expect(q(['seule', '', '', '', ''], 0)).toMatchObject({ ok: false, errors: { options: expect.stringMatching(/au moins deux/) } });
    expect(q(['a', '', 'c', '', ''], 0)).toMatchObject({ ok: false, errors: { options: expect.stringMatching(/sans emplacement vide/) } });
    expect(q(['Paris', 'paris ', '', '', ''], 0)).toMatchObject({ ok: false, errors: { options: expect.stringMatching(/A et B/) } });
    expect(q(['a', 'b', '', '', ''], null)).toMatchObject({ ok: false, errors: { correctIndex: expect.any(String) } });
    expect(q(['a', 'b', '', '', ''], 3)).toMatchObject({ ok: false, errors: { correctIndex: expect.any(String) } });
    const ok = q(['went', 'goed', 'gone', '', ''], 0);
    expect(ok.ok && ok.content).toMatchObject({
      formatQuestion: 'mcq',
      options: [
        { id: 'A', text: 'went' },
        { id: 'B', text: 'goed' },
        { id: 'C', text: 'gone' },
      ],
      correctOptionId: 'A',
      reponse: 'A) went',
      rawQuestion: 'Choisir\nA) went\nB) goed\nC) gone',
    });
  });

  it('carte importée ouverte sans changement : contenu identique, texte importé conservé', async () => {
    const { qcm, open } = await library();
    for (const c of [qcm, open]) {
      const r = contentFromForm(formFromCard(c), c);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.majorChange).toBe(false);
      expect(contentChanged(c, r.content)).toBe(false);
      expect(r.content.rawQuestion).toBe(c.rawQuestion);
      expect(r.content.reponse).toBe(c.reponse);
    }
  });

  it('modification majeure (question, propositions, bonne réponse, réponse) détectée ; classement et explication : non', async () => {
    const { qcm, open } = await library();
    const major = (c: Card, over: Partial<CardForm>) => {
      const r = contentFromForm({ ...formFromCard(c), ...over }, c);
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      return r.majorChange;
    };
    expect(major(open, { theme: 'Nombres', notion: '', explication: 'Autre', difficulte: 'Difficile', typePedagogique: 'Méthode' })).toBe(false);
    expect(major(open, { question: 'Simplifier 6/8 (forme irréductible).' })).toBe(true);
    expect(major(open, { reponse: '0,75' })).toBe(true);
    expect(major(qcm, { correctIndex: 3 })).toBe(true);
    const opts = formFromCard(qcm).options.slice();
    opts[1] = '3/6';
    expect(major(qcm, { options: opts })).toBe(true);
    expect(major(qcm, { explication: 'Réduire au même dénominateur.' })).toBe(false);
    // Changement de format : ouverte → QCM
    expect(major(open, { formatQuestion: 'mcq', question: 'Simplifier 6/8.', options: ['3/4', '2/3', '', '', ''], correctIndex: 0 })).toBe(true);
  });
});

describe('enregistrement', () => {
  it('ajout : collection « saisie » créée une seule fois, carte en fin de collection, visible dans la bibliothèque', async () => {
    const { db, collectionId } = await library();
    const c1 = contentFromForm(blank({ question: 'Q1', reponse: 'R1' }));
    const c2 = contentFromForm(blank({ question: 'Q2', reponse: 'R2', theme: 'Vocabulaire' }));
    if (!c1.ok || !c2.ok) throw new Error();
    const a = await repo.createCard(db, { content: c1.content, collection: { kind: 'manual' }, now: NOW });
    const b = await repo.createCard(db, { content: c2.content, collection: { kind: 'manual' }, now: NOW });
    const cols = await repo.listCollections(db);
    const manual = cols.filter((c) => c.manual);
    expect(manual).toHaveLength(1);
    expect(manual[0]!.name).toBe(repo.MANUAL_COLLECTION_NAME);
    expect([a.collectionId, b.collectionId]).toEqual([manual[0]!.collectionId, manual[0]!.collectionId]);
    expect([a.sourceRow, b.sourceRow]).toEqual([1, 2]);
    expect(a).toMatchObject({ sourceFile: repo.MANUAL_SOURCE, pathKey: pathKeyOf({ matiere: 'Anglais', theme: 'Grammaire' }) });
    expect(a.externalId).toBeUndefined();
    const inImported = await repo.createCard(db, { content: c1.content, collection: { kind: 'existing', collectionId }, now: NOW });
    expect(inImported).toMatchObject({ collectionId, sourceRow: 3 });
    const metas = await repo.loadAllMeta(db);
    expect(metas).toHaveLength(5);
    await expect(repo.createCard(db, { content: c1.content, collection: { kind: 'existing', collectionId: 'absente' } })).rejects.toThrow(/introuvable/);
    expect(await repo.loadAllMeta(db)).toHaveLength(5);
  });

  it('modification : identité, provenance et historique conservés ; mémorisation conservée ou réinitialisée au choix', async () => {
    const { db, open, qcm } = await library();
    const state = applyRating(undefined, open.cardId, 'good', D, NOW);
    await db.put('reviewStates', state);
    await db.put('reviewStates', applyRating(undefined, qcm.cardId, 'easy', D, NOW));
    await db.put('reviewLog', { logId: 'l1', cardId: open.cardId, sessionId: 's', at: NOW, day: D, rating: 'good', repeat: false, intervalDays: 3, dueDay: '2026-11-05' });

    const r = contentFromForm({ ...formFromCard(open), reponse: '0,75', theme: 'Nombres' }, open);
    if (!r.ok) throw new Error();
    const kept = await repo.updateCard(db, { cardId: open.cardId, expectedUpdatedAt: open.updatedAt, content: r.content, resetReview: false, now: '2026-11-03T10:00:00.000Z' });
    expect(kept).toMatchObject({
      cardId: open.cardId,
      collectionId: open.collectionId,
      externalId: 'CAL-2',
      sourceRow: open.sourceRow,
      sourceFile: open.sourceFile,
      createdAt: open.createdAt,
      reponse: '0,75',
      theme: 'Nombres',
      editedAt: '2026-11-03T10:00:00.000Z',
      pathKey: pathKeyOf({ matiere: 'Calcul', theme: 'Nombres', notion: 'Simplification' }),
    });
    expect(kept.contentHash).not.toBe(open.contentHash);
    expect(await repo.getReviewState(db, open.cardId)).toEqual(state);

    const r2 = contentFromForm({ ...formFromCard(qcm), correctIndex: 1 }, qcm);
    if (!r2.ok) throw new Error();
    await repo.updateCard(db, { cardId: qcm.cardId, expectedUpdatedAt: qcm.updatedAt, content: r2.content, resetReview: true });
    expect(await repo.getReviewState(db, qcm.cardId)).toBeUndefined();
    expect(await db.getAll('reviewLog')).toHaveLength(1); // l'historique n'est jamais modifié
    expect(await repo.loadAllMeta(db)).toHaveLength(2);
  });

  it('modification concurrente (autre onglet) ou carte supprimée : refus, rien n’est écrit', async () => {
    const { db, open } = await library();
    const r = contentFromForm({ ...formFromCard(open), explication: 'Version A' }, open);
    const r2 = contentFromForm({ ...formFromCard(open), explication: 'Version B' }, open);
    if (!r.ok || !r2.ok) throw new Error();
    await repo.updateCard(db, { cardId: open.cardId, expectedUpdatedAt: open.updatedAt, content: r.content, resetReview: false, now: '2026-11-03T10:00:00.000Z' });
    await expect(repo.updateCard(db, { cardId: open.cardId, expectedUpdatedAt: open.updatedAt, content: r2.content, resetReview: false })).rejects.toBeInstanceOf(
      repo.CardConflictError,
    );
    expect((await repo.getCard(db, open.cardId))!.explication).toBe('Version A');
    await repo.deleteCard(db, open.cardId);
    await expect(repo.updateCard(db, { cardId: open.cardId, expectedUpdatedAt: open.updatedAt, content: r2.content, resetReview: false })).rejects.toThrow(/supprimée/);
    expect(await repo.getCard(db, open.cardId)).toBeUndefined();
  });

  it('réimportation : carte modifiée signalée comme modifiée ; enregistrement sans changement : carte inchangée', async () => {
    const { db, collectionId, open, qcm } = await library();
    const same = contentFromForm(formFromCard(qcm), qcm);
    const edited = contentFromForm({ ...formFromCard(open), reponse: '0,75' }, open);
    if (!same.ok || !edited.ok) throw new Error();
    await repo.updateCard(db, { cardId: qcm.cardId, expectedUpdatedAt: qcm.updatedAt, content: same.content, resetReview: false });
    await repo.updateCard(db, { cardId: open.cardId, expectedUpdatedAt: open.updatedAt, content: edited.content, resetReview: false });
    const re = await repo.commitImport(db, { kind: 'existing', collectionId }, 'calcul.csv', buildCards(rows, M, {}).drafts, NOW);
    expect(re).toMatchObject({ added: 0, updated: 1, unchanged: 1 });
    expect(re.plan.toUpdate[0]!.existing.cardId).toBe(open.cardId);
    expect(re.plan.toUpdate[0]!.majorChange).toBe(true);
  });
});
