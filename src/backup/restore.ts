// Lot 4 : restauration complète d'une sauvegarde VALIDÉE (voir archive.ts), en UNE transaction :
// toutes les données actuelles sont remplacées, ou rien ne l'est. Après les écritures, les nombres d'éléments sont
// recomptés dans la même transaction ; s'ils diffèrent de la sauvegarde, la transaction est annulée.
import type { IDBPTransaction } from 'idb';
import type { DB, FlashcardsDB } from '../storage/db';
import { countsOf, type BackupCounts, type BackupData } from './archive';

const STORES = ['collections', 'cards', 'sessions', 'settings', 'reviewStates', 'reviewLog'] as const;

export class RestoreVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreVerificationError';
  }
}

/** Points d'injection réservés aux tests (simulation d'une écriture incomplète avant la vérification) */
export interface RestoreTestHooks {
  afterWrite?: (tx: IDBPTransaction<FlashcardsDB, (typeof STORES)[number][], 'readwrite'>) => Promise<unknown>;
}

export async function restoreBackup(db: DB, data: BackupData, hooks: RestoreTestHooks = {}): Promise<BackupCounts> {
  const expected = countsOf(data);
  const tx = db.transaction([...STORES], 'readwrite');
  // Une écriture refusée rejette sa promesse ET annule la transaction : on observe toutes les promesses
  const ops: Promise<unknown>[] = [];
  const watch = <T>(p: Promise<T>) => {
    ops.push(p);
    p.catch(() => undefined);
    return p;
  };
  try {
    for (const s of STORES) watch(tx.objectStore(s).clear());
    for (const c of data.collections) watch(tx.objectStore('collections').add(c));
    for (const c of data.cards) watch(tx.objectStore('cards').add(c));
    for (const s of data.sessions) watch(tx.objectStore('sessions').add(s));
    for (const r of data.settings) watch(tx.objectStore('settings').add(r));
    for (const st of data.reviewStates) watch(tx.objectStore('reviewStates').add(st));
    for (const l of data.reviewLog) watch(tx.objectStore('reviewLog').add(l));
    await Promise.all(ops);
    if (hooks.afterWrite) await hooks.afterWrite(tx);
    // Vérification dans la transaction, avant validation
    const actual = Object.fromEntries(await Promise.all(STORES.map(async (s) => [s, await tx.objectStore(s).count()] as const))) as BackupCounts;
    const wrong = STORES.filter((s) => actual[s] !== expected[s]);
    if (wrong.length) throw new RestoreVerificationError(`Vérification échouée (${wrong.join(', ')}) : restauration annulée.`);
    await tx.done;
    return actual;
  } catch (err) {
    tx.done.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // transaction déjà terminée ou annulée
    }
    throw err;
  }
}
