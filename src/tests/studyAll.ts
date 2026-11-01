// v1.1.0, tests uniquement : marque comme étudiées toutes les notions présentes dans la bibliothèque.
// Les tests de révision antérieurs à la v1.1.0 supposent une bibliothèque entièrement révisable : ils appellent ce
// réglage juste avant chaque lancement, ce qui reproduit exactement leur hypothèse sans modifier leurs vérifications.
import { unitOf } from '../program/studied';
import * as repo from '../storage/repo';
import type { DB } from '../storage/db';

export async function studyAll(db: DB): Promise<void> {
  const metas = await repo.loadAllMeta(db);
  await repo.saveStudiedProgram(db, new Set(metas.map(unitOf)));
}

/** startReviewSession sur une bibliothèque entièrement étudiée (comportement des versions antérieures). */
export async function startReviewAllStudied(db: DB, req: Parameters<typeof repo.startReviewSession>[1]) {
  await studyAll(db);
  return repo.startReviewSession(db, req);
}
