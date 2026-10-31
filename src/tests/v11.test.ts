// Tests de non-régression v1.1 : I4 (recherche ↔ test) et I5 (cartes supprimées dans les sessions).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildCards } from '../imports/buildCards';
import { idsForCriteria, searchCardIds, searchCriteriaKey } from '../library/search';
import { openFlashcardsDb } from '../storage/db';
import * as repo from '../storage/repo';
import { buildTaxonomy, ROOT_ID } from '../taxonomy/tree';
import { resolveScope } from './selection';
import { advance, createSession, gradeMcq, partitionAvailable, recordAnswer, selfEvaluate, summarize } from './session';

describe('I4 — un test ne part que sur les résultats des critères affichés', () => {
  it('des résultats produits par d’anciens critères sont inutilisables', () => {
    const k1 = searchCriteriaKey('pourcentage', { format: 'all' });
    const result = { key: k1, ids: ['a', 'b'] };
    expect(idsForCriteria(result, k1)).toEqual(['a', 'b']);
    expect(idsForCriteria(result, searchCriteriaKey('pourcentages', { format: 'all' }))).toBeNull();
    expect(idsForCriteria(result, searchCriteriaKey('pourcentage', { format: 'mcq' }))).toBeNull();
    expect(idsForCriteria(result, searchCriteriaKey('pourcentage', { format: 'all', matiere: 'Calcul' }))).toBeNull();
    expect(idsForCriteria(null, k1)).toBeNull();
  });

  it('la clé ignore la casse, les accents et les espaces superflus (mêmes résultats)', () => {
    expect(searchCriteriaKey('  Négation ', { format: 'all' })).toBe(searchCriteriaKey('negation', { format: 'all' }));
  });

  it('enchaînement rapide de critères : seuls les identifiants des derniers critères sont retenus', async () => {
    const db = await openFlashcardsDb('v11-search');
    const rows = [
      ['A1', 'Calcul', 'Question sur les fractions', 'R'],
      ['A2', 'Calcul', 'Question sur les pourcentages', 'R'],
      ['A3', 'Anglais', 'Question about percentages', 'R'],
    ];
    await repo.commitImport(
      db,
      { kind: 'new', name: 'C' },
      'f.csv',
      buildCards(rows, { externalId: 0, matiere: 1, question: 2, reponse: 3 }, {}).drafts,
    );
    // Critère 1 (résultat arrivé), puis l'utilisatrice change de critère avant la fin de la nouvelle recherche
    const f1 = { format: 'all' as const };
    const r1 = { key: searchCriteriaKey('question', f1), ids: await searchCardIds(db, 'question', f1) };
    const f2 = { format: 'all' as const, matiere: 'Anglais' };
    const current = searchCriteriaKey('question', f2);
    expect(r1.ids).toHaveLength(3);
    expect(idsForCriteria(r1, current)).toBeNull(); // bouton désactivé : aucun test sur l'ancien résultat
    const r2 = { key: current, ids: await searchCardIds(db, 'question', f2) };
    const launched = idsForCriteria(r2, current)!;
    const cards = await repo.getCards(db, launched);
    expect(cards.map((c) => c.matiere)).toEqual(['Anglais']);
  });
});

describe('I5 — cartes supprimées et historique des sessions', () => {
  const T = 't';
  it('l’historique est conservé, les cartes supprimées sont signalées et exclues des relances', async () => {
    const db = await openFlashcardsDb('v11-deleted');
    const out = await repo.commitImport(
      db,
      { kind: 'new', name: 'C' },
      'f.csv',
      buildCards(
        [
          ['X1', 'Q1 ?\nA) un  B) deux', 'B'],
          ['X2', 'Q2', 'R2'],
          ['X3', 'Q3', 'R3'],
        ],
        { externalId: 0, question: 1, reponse: 2 },
        { matiere: 'M' },
      ).drafts,
    );
    const cards = await repo.getCardsOfCollection(db, out.collectionId);
    const byExt = Object.fromEntries(cards.map((c) => [c.externalId!, c]));
    const [c1, c2, c3] = [byExt['X1']!, byExt['X2']!, byExt['X3']!];

    // Test terminé : 1 QCM faux, 1 « À revoir », 1 correct
    let done = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: 3, format: 'all', order: 'library' }, [c1.cardId, c2.cardId, c3.cardId], T);
    done = advance(recordAnswer(done, c1.cardId, gradeMcq(c1, 'A', T)), T);
    done = advance(recordAnswer(done, c2.cardId, selfEvaluate('again', T)), T);
    done = advance(recordAnswer(done, c3.cardId, selfEvaluate('good', T)), T);
    await repo.saveSession(db, done);
    // Session en cours sur la carte qui va être supprimée
    const running = createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: 2, format: 'all', order: 'library' }, [c1.cardId, c3.cardId], T);
    await repo.startNewSession(db, running, T);

    await repo.deleteCard(db, c1.cardId);

    // Historique intact
    const reloaded = (await repo.getSession(db, done.sessionId))!;
    expect(summarize(reloaded)).toMatchObject({ answered: 3, mcq: { answered: 1, correct: 0 }, errorIds: [c1.cardId, c2.cardId] });
    // Relance « Refaire les erreurs » : la carte supprimée est exclue, sans toucher au bilan
    const metas = await repo.loadAllMeta(db);
    const existing = new Set(metas.map((m) => m.cardId));
    const split = partitionAvailable(summarize(reloaded).errorIds, existing);
    expect(split).toEqual({ available: [c2.cardId], missing: [c1.cardId] });
    const tax = buildTaxonomy(metas);
    expect(resolveScope({ kind: 'cards', cardIds: split.available, label: 'x' }, tax, metas).map((m) => m.cardId)).toEqual([c2.cardId]);

    // Reprise de la session en cours : la carte absente est détectée (getCard → undefined), la suivante reste accessible
    const resumed = (await repo.getSession(db, running.sessionId))!;
    expect(resumed.status).toBe('in_progress');
    expect(await repo.getCard(db, resumed.cardIds[0]!)).toBeUndefined();
    const skipped = advance(resumed, T); // « Passer » : comptée non traitée
    expect((await repo.getCard(db, skipped.cardIds[skipped.currentIndex]!))!.cardId).toBe(c3.cardId);
    expect(summarize(advance(skipped, T))).toMatchObject({ answered: 0, notAnswered: 2 });
  });
});
