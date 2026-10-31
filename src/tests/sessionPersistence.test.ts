// Tests de non-régression B1 (sauvegarde des réponses) et B2 (remplacement atomique d'un test).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TestSession } from '../domain/types';
import { openFlashcardsDb, type DB } from '../storage/db';
import * as repo from '../storage/repo';
import { ROOT_ID } from '../taxonomy/tree';
import { advance, createSession, finishEarly, gradeMcq, recordAnswer, selfEvaluate } from './session';
import { SessionController } from './sessionController';

let n = 0;
let dbName: string;
let db: DB;
beforeEach(async () => {
  dbName = `persist-${++n}`;
  db = await openFlashcardsDb(dbName);
});

const T = '2026-10-30T10:00:00.000Z';
const mk = (ids = ['a', 'b']): TestSession =>
  createSession({ kind: 'node', nodeId: ROOT_ID }, 'Tout', { count: ids.length, format: 'all', order: 'library' }, ids, T);
const mcq = { formatQuestion: 'mcq' as const, correctOptionId: 'B' };

describe('B1 — une transition n’est confirmée qu’après enregistrement', () => {
  it('échec d’écriture : la progression n’avance pas, la réponse est conservée, puis réessai réussi', async () => {
    const s0 = mk();
    await repo.saveSession(db, s0);
    let failNext = true;
    const ctl = new SessionController(s0, async (s) => {
      if (failNext) {
        failNext = false;
        throw new Error('QuotaExceededError simulée');
      }
      await repo.saveSession(db, s);
    });

    const withAnswer = recordAnswer(s0, 'a', gradeMcq(mcq, 'B', T));
    const r1 = await ctl.apply(withAnswer);
    expect(r1).toEqual({ status: 'failed', error: 'QuotaExceededError simulée', stale: false });
    expect(ctl.current).toBe(s0); // état confirmé inchangé
    expect(ctl.current.answers['a']).toBeUndefined();
    expect(ctl.pending?.answers['a']).toEqual({ kind: 'mcq', selectedOptionId: 'B', correct: true, answeredAt: T }); // réponse conservée
    expect((await repo.getSession(db, s0.sessionId))!.answers).toEqual({}); // rien en base

    // Aucune autre transition (ex. « Suivant ») tant que l'échec n'est pas réglé
    expect(await ctl.apply(advance(s0))).toEqual({ status: 'blocked' });
    expect(ctl.current.currentIndex).toBe(0);

    const r2 = await ctl.retry();
    expect(r2.status).toBe('saved');
    expect(ctl.pending).toBeNull();
    // « Rechargement » : relecture depuis la base
    const reloaded = (await repo.getSession(db, s0.sessionId))!;
    expect(reloaded.answers['a']).toMatchObject({ selectedOptionId: 'B', correct: true });
    expect(reloaded.currentIndex).toBe(0);
  });

  it('échec réel d’IndexedDB (base fermée) : rien n’est confirmé, réessai après réouverture', async () => {
    const s0 = mk();
    await repo.saveSession(db, s0);
    let conn = db;
    const ctl = new SessionController(s0, (s) => repo.saveSession(conn, s));
    conn.close();
    const next = advance(recordAnswer(s0, 'a', selfEvaluate('good', T)), T);
    const r1 = await ctl.apply(next);
    expect(r1.status).toBe('failed');
    expect(ctl.current.currentIndex).toBe(0);

    conn = await openFlashcardsDb(dbName);
    expect((await ctl.retry()).status).toBe('saved');
    const reloaded = (await repo.getSession(conn, s0.sessionId))!;
    expect(reloaded.currentIndex).toBe(1);
    expect(reloaded.answers['a']).toMatchObject({ kind: 'open', selfEval: 'good' });
  });

  it('la fin du test n’est pas confirmée si son enregistrement échoue (pas de bilan)', async () => {
    const s0 = advance(recordAnswer(mk(['a']), 'a', selfEvaluate('easy', T)), T);
    expect(s0.status).toBe('finished'); // transition calculée…
    const base = mk(['a']);
    const ctl = new SessionController(base, async () => {
      throw new Error('écriture refusée');
    });
    expect((await ctl.apply(finishEarly(base, T))).status).toBe('failed');
    expect(ctl.current.status).toBe('in_progress'); // …mais jamais confirmée
  });

  it('bloque les doubles validations pendant une écriture', async () => {
    const s0 = mk();
    let release!: () => void;
    const ctl = new SessionController(s0, () => new Promise<void>((res) => (release = res)));
    const first = ctl.apply(recordAnswer(s0, 'a', selfEvaluate('good', T)));
    expect(ctl.busy).toBe(true);
    expect(await ctl.apply(recordAnswer(s0, 'a', selfEvaluate('again', T)))).toEqual({ status: 'busy' });
    release();
    const r = await first;
    expect(r.status).toBe('saved');
    expect(ctl.current.answers['a']).toMatchObject({ selfEval: 'good' });
  });

  it('abandonner une transition en échec revient au dernier état enregistré', async () => {
    const s0 = mk();
    const ctl = new SessionController(s0, async () => {
      throw new Error('x');
    });
    await ctl.apply(recordAnswer(s0, 'a', selfEvaluate('good', T)));
    ctl.discardPending();
    expect(ctl.pending).toBeNull();
    expect(ctl.current).toBe(s0);
  });
});

describe('B2 — remplacement atomique d’un test en cours', () => {
  it('abandonne l’ancien et crée le nouveau dans une même transaction', async () => {
    const old = recordAnswer(mk(), 'a', selfEvaluate('hard', T));
    await repo.saveSession(db, old);
    const fresh = mk(['x']);
    expect(await repo.startNewSession(db, fresh, T)).toBe(1);
    expect((await repo.getSession(db, old.sessionId))!.status).toBe('abandoned');
    expect((await repo.getInProgressSessions(db)).map((s) => s.sessionId)).toEqual([fresh.sessionId]);
  });

  it('si la création échoue, l’ancien test reste en cours avec ses réponses et sa position', async () => {
    const old = advance(recordAnswer(mk(['a', 'b', 'c']), 'a', gradeMcq(mcq, 'C', T)), T);
    await repo.saveSession(db, old);
    const finished = finishEarly(mk(['z']), T);
    await repo.saveSession(db, finished);

    // Échec provoqué : identifiant déjà utilisé par une autre session → erreur de contrainte
    const clash: TestSession = { ...mk(['y']), sessionId: finished.sessionId };
    await expect(repo.startNewSession(db, clash, T)).rejects.toBeTruthy();

    const after = (await repo.getSession(db, old.sessionId))!;
    expect(after.status).toBe('in_progress');
    expect(after.currentIndex).toBe(1);
    expect(after.answers).toEqual(old.answers);
    expect((await repo.getSession(db, finished.sessionId))!.status).toBe('finished'); // non écrasée
    expect((await repo.getInProgressSessions(db)).map((s) => s.sessionId)).toEqual([old.sessionId]);
  });
});
