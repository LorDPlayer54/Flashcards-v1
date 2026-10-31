// Export JSON versionné : bibliothèque, collections, séances, paramètres, états de mémorisation et historique.
// Lot 4 : format 3 (version de l'application, schéma, somme de contrôle). La lecture et la validation des
// formats 1 à 3 sont dans archive.ts ; la restauration atomique dans restore.ts.
import { APP_VERSION } from '../appVersion';
import type { DB } from '../storage/db';
import { BACKUP_FORMAT, BACKUP_VERSION, backupChecksum, countsOf, SCHEMA_VERSION, type BackupCounts, type BackupData, type BackupFile } from './archive';

/** Sauvegarde écrite par cette version : tous les champs du format 3 sont présents */
export type ExportedBackup = BackupFile & { counts: BackupCounts; checksum: string; appVersion: string; schemaVersion: number };

export { BACKUP_FORMAT, BACKUP_VERSION, type BackupFile } from './archive';

/** Lit toutes les données dans une seule transaction en lecture (instantané cohérent). */
export async function readAllData(db: DB): Promise<BackupData> {
  const tx = db.transaction(['cards', 'collections', 'sessions', 'settings', 'reviewStates', 'reviewLog'], 'readonly');
  const [cards, collections, sessions, settings, reviewStates, reviewLog] = await Promise.all([
    tx.objectStore('cards').getAll(),
    tx.objectStore('collections').getAll(),
    tx.objectStore('sessions').getAll(),
    tx.objectStore('settings').getAll(),
    tx.objectStore('reviewStates').getAll(),
    tx.objectStore('reviewLog').getAll(),
  ]);
  await tx.done;
  return { collections, cards, sessions, settings, reviewStates, reviewLog };
}

export async function buildBackup(db: DB, now: string = new Date().toISOString()): Promise<ExportedBackup> {
  const data = await readAllData(db);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    counts: countsOf(data),
    checksum: backupChecksum(data),
    ...data,
  };
}

export function backupFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `flashcards-sauvegarde-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

/** Fichier de sauvegarde prêt à être téléchargé ou partagé. */
export function backupBlob(data: unknown): Blob {
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

/** Déclenche le téléchargement dans le navigateur (téléphone ou ordinateur). */
export function downloadJson(data: unknown, fileName: string): void {
  const url = URL.createObjectURL(backupBlob(data));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Lot 4 : partage du fichier (feuille de partage du téléphone : « Enregistrer dans Fichiers », e-mail…), utile
 * notamment sur iPhone en mode application installée. Renvoie false si le partage de fichiers n'est pas disponible.
 */
export async function shareJson(data: unknown, fileName: string): Promise<boolean> {
  const file = new File([backupBlob(data)], fileName, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (!nav.canShare?.({ files: [file] }) || !nav.share) return false;
  await nav.share({ files: [file], title: fileName });
  return true;
}
