// Schéma IndexedDB.
// v1 (lot 1)   : magasins cards, collections, sessions, settings.
// v2 (v1.1, I2) : l'index (collectionId, externalId) devient UNIQUE. La migration conserve toutes les cartes :
//                 en cas de doublon préexistant, la première carte garde son identifiant source et les suivantes
//                 le conservent dans `duplicateExternalId` (rien n'est supprimé, aucun cardId ne change).
// v3 (lot 2)  : ajout des magasins « reviewStates » (état de mémorisation par carte) et « reviewLog » (historique).
//                 Migration purement additive : aucune donnée existante n'est lue, modifiée ou supprimée.
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import type { Card, Collection, TestSession } from '../domain/types';
import type { ReviewLogEntry, ReviewState } from '../review/schedule';

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface FlashcardsDB extends DBSchema {
  cards: {
    key: string;
    value: Card;
    indexes: {
      byCollection: string;
      byCollectionExternal: [string, string];
      byMatiere: string;
      byPath: string;
    };
  };
  collections: { key: string; value: Collection };
  sessions: { key: string; value: TestSession; indexes: { byStatus: string } };
  settings: { key: string; value: SettingRecord };
  reviewStates: { key: string; value: ReviewState; indexes: { byDue: string } };
  reviewLog: { key: string; value: ReviewLogEntry; indexes: { byCard: string; bySession: string; byDay: string } };
}

export const DB_NAME = 'flashcards-ena';
export const DB_VERSION = 3;
export const MIGRATION_NOTE_KEY = 'migrationNotes';

export type DB = IDBPDatabase<FlashcardsDB>;
type UpgradeTx = IDBPTransaction<FlashcardsDB, StoreNames<FlashcardsDB>[], 'versionchange'>;

export interface MigrationNote {
  at: string;
  version: number;
  message: string;
  cardIds: string[];
}

/** Migration v1 → v2 : neutralise les doublons (collectionId, externalId) puis crée l'index unique. */
async function migrateToV2(tx: UpgradeTx): Promise<void> {
  const store = tx.objectStore('cards');
  const seen = new Set<string>();
  const neutralised: string[] = [];
  // Parcours par date de création : la carte la plus ancienne garde son identifiant source
  const all = await store.getAll();
  all.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.sourceRow - b.sourceRow));
  for (const card of all) {
    if (!card.externalId) continue;
    const key = `${card.collectionId}\u001f${card.externalId}`;
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    const { externalId, ...rest } = card;
    await store.put({ ...rest, duplicateExternalId: externalId });
    neutralised.push(card.cardId);
  }
  store.deleteIndex('byCollectionExternal');
  store.createIndex('byCollectionExternal', ['collectionId', 'externalId'], { unique: true });
  if (neutralised.length > 0) {
    const note: MigrationNote = {
      at: new Date().toISOString(),
      version: 2,
      message: `${neutralised.length} carte(s) en double sur le même identifiant source ont été conservées sans cet identifiant (champ duplicateExternalId).`,
      cardIds: neutralised,
    };
    await tx.objectStore('settings').put({ key: MIGRATION_NOTE_KEY, value: [note] });
  }
}

export function openFlashcardsDb(name: string = DB_NAME): Promise<DB> {
  return openDB<FlashcardsDB>(name, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        // Base neuve : schéma v1 directement avec l'index unique de la v2
        const cards = db.createObjectStore('cards', { keyPath: 'cardId' });
        cards.createIndex('byCollection', 'collectionId');
        // Unicité du couple (collection, ID source). Les cartes sans externalId ne figurent pas dans l'index.
        cards.createIndex('byCollectionExternal', ['collectionId', 'externalId'], { unique: true });
        cards.createIndex('byMatiere', 'matiere');
        cards.createIndex('byPath', 'pathKey');
        db.createObjectStore('collections', { keyPath: 'collectionId' });
        const sessions = db.createObjectStore('sessions', { keyPath: 'sessionId' });
        sessions.createIndex('byStatus', 'status');
        db.createObjectStore('settings', { keyPath: 'key' });
      } else if (oldVersion < 2) {
        await migrateToV2(tx);
      }
      if (oldVersion < 3) {
        const states = db.createObjectStore('reviewStates', { keyPath: 'cardId' });
        states.createIndex('byDue', 'dueDay');
        const log = db.createObjectStore('reviewLog', { keyPath: 'logId' });
        log.createIndex('byCard', 'cardId');
        log.createIndex('bySession', 'sessionId');
        log.createIndex('byDay', 'day');
      }
    },
    // Si un autre onglet ouvre une version plus récente, on libère la base pour ne pas bloquer la mise à jour.
    blocking(_currentVersion, _blockedVersion, event) {
      (event.target as IDBDatabase).close();
    },
  });
}
