// Lot 4 : restauration d'une sauvegarde.
// 1. choix du fichier ; 2. lecture et validation complètes (aucune écriture) ; 3. aperçu : contenu de la sauvegarde
// comparé aux données actuelles, corrections et éléments écartés annoncés ; 4. sauvegarde préalable des données
// actuelles proposée, avec attestation par l'utilisatrice que le fichier est bien conservé (v0.4.1) ; 5. confirmation explicite
// du remplacement ; 6. remplacement atomique, puis rechargement de l'application et blocage des autres onglets.
// Une sauvegarde invalide ou une restauration interrompue ne modifie jamais les données existantes.
import { useEffect, useRef, useState } from 'react';
import { countsOf, parseBackup, withBackupMark, type BackupCounts, type ParseResult } from '../../backup/archive';
import { backupFileName, buildBackup, downloadJson, readAllData } from '../../backup/export';
import { restoreBackup } from '../../backup/restore';
import { announceRestore, BLOCK_GRACE_MS } from '../../backup/channel';
import { LAST_BACKUP_KEY, setSetting } from '../../storage/repo';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, plural, TopBar } from '../components/common';
import { href } from '../router';

const LABELS: Record<keyof BackupCounts, string> = {
  cards: 'Cartes',
  collections: 'Collections',
  sessions: 'Tests et révisions (séances)',
  reviewStates: 'États de mémorisation',
  reviewLog: "Lignes d'historique des révisions",
  settings: 'Réglages',
};
const ORDER: (keyof BackupCounts)[] = ['cards', 'collections', 'sessions', 'reviewStates', 'reviewLog', 'settings'];
export const RESTORED_FLAG = 'flashcards-ena:restored';

export function Restore() {
  const { db } = useApp();
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [current, setCurrent] = useState<{ counts: BackupCounts; running: number } | null>(null);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [savedCurrent, setSavedCurrent] = useState(false);
  // v0.4.1 : le téléchargement ne prouve pas que le fichier a été enregistré ; l'utilisatrice l'atteste elle-même.
  const [keptConfirmed, setKeptConfirmed] = useState(false);
  const [noNeed, setNoNeed] = useState(false);
  // v0.4.1 : seul le dernier fichier choisi peut afficher son résultat (une lecture plus lente ne l'écrase pas).
  const choice = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readAllData(db)
      .then((d) => setCurrent({ counts: countsOf(d), running: d.sessions.filter((s) => s.status === 'in_progress').length }))
      .catch((e: unknown) => setCurrentError(errorMessage(e)));
  }, [db]);

  const choose = async (file: File | undefined) => {
    const id = ++choice.current;
    setResult(null);
    setError(null);
    if (!file) {
      setReading(false);
      return;
    }
    setFileName(file.name);
    setReading(true);
    let parsed: ParseResult;
    try {
      parsed = parseBackup(await file.text());
    } catch (e) {
      parsed = { ok: false, errors: [`Lecture du fichier impossible : ${errorMessage(e)}`] };
    }
    if (id !== choice.current) return; // un autre fichier a été choisi entre-temps
    setResult(parsed);
    setReading(false);
  };

  const exportCurrent = async () => {
    try {
      const backup = await buildBackup(db);
      downloadJson(backup, backupFileName());
      await setSetting(db, LAST_BACKUP_KEY, backup.exportedAt).catch(() => undefined);
      setSavedCurrent(true);
      setKeptConfirmed(false);
    } catch (e) {
      setError(`Export des données actuelles impossible : ${errorMessage(e)}. Aucune donnée n'a été modifiée.`);
    }
  };

  const currentEmpty = current !== null && current.counts.cards === 0 && current.counts.sessions === 0 && current.counts.reviewLog === 0;
  const safetyOk = (savedCurrent && keptConfirmed) || noNeed || currentEmpty;

  const restore = async () => {
    if (!result?.ok || !safetyOk || reading) return;
    const c = result.summary.counts;
    if (
      !window.confirm(
        `Remplacer toutes les données de cet appareil par la sauvegarde (${plural(c.cards, 'carte', 'cartes')}, ${plural(c.sessions, 'séance', 'séances')}) ? Les données actuelles seront effacées.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    // v0.4.1 : les autres onglets sont bloqués (et cessent d'écrire) avant la première écriture de la restauration.
    announceRestore('restore-started');
    await new Promise((r) => setTimeout(r, BLOCK_GRACE_MS));
    try {
      await restoreBackup(db, withBackupMark(result.data, result.summary.exportedAt, LAST_BACKUP_KEY));
    } catch (e) {
      announceRestore('restore-aborted');
      setBusy(false);
      setError(`Restauration annulée, aucune donnée n'a été modifiée : ${errorMessage(e)}.`);
      return;
    }
    announceRestore('data-replaced');
    try {
      sessionStorage.setItem(RESTORED_FLAG, JSON.stringify(c));
    } catch {
      // stockage de session indisponible : le message de confirmation ne sera simplement pas affiché
    }
    // Rechargement complet : bibliothèque, réglages d'affichage et écrans repartent des données restaurées.
    // L'adresse est changée sans navigation (sinon l'accueil lirait le message avant le rechargement).
    window.history.replaceState(null, '', href(''));
    window.location.reload();
  };

  return (
    <div className="page with-action-bar">
      <TopBar title="Restauration" back={href('more')} />
      <p className="small">
        La restauration <strong>remplace toutes les données de cet appareil</strong> (cartes, collections, tests, progression de révision et réglages)
        par celles de la sauvegarde. Le fichier est entièrement vérifié avant toute modification ; en cas de problème, rien n'est changé.
      </p>

      <section className="card-block">
        <h3 className="label">1. Fichier de sauvegarde</h3>
        <input
          type="file"
          accept=".json,application/json"
          aria-label="Fichier de sauvegarde"
          onChange={(e) => void choose(e.target.files?.[0])}
          disabled={busy || reading}
        />
        {reading && <p className="muted small">Vérification de « {fileName} »…</p>}
      </section>

      {result && !result.ok && (
        <section className="card-block">
          <p className="notice error" role="alert">
            Cette sauvegarde ne peut pas être restaurée. Aucune donnée n'a été modifiée.
          </p>
          <ul className="issues">
            {result.errors.map((e, i) => (
              <li key={i} className="error">
                {e}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result?.ok && (
        <>
          <section className="card-block">
            <h3 className="label">2. Contenu de la sauvegarde</h3>
            <p className="small">
              Créée le {new Date(result.summary.exportedAt).toLocaleString('fr-FR')}
              {result.summary.appVersion ? ` par la version ${result.summary.appVersion}` : ''} · format {result.summary.version}
            </p>
            <div className="table-scroll">
              <table className="result-table">
                <thead>
                  <tr>
                    <th>Élément</th>
                    <th className="num">Sauvegarde</th>
                    <th className="num">Actuellement</th>
                  </tr>
                </thead>
                <tbody>
                  {ORDER.map((k) => (
                    <tr key={k}>
                      <td>{LABELS[k]}</td>
                      <td className="num">{result.summary.counts[k].toLocaleString('fr-FR')}</td>
                      <td className="num">{current ? current.counts[k].toLocaleString('fr-FR') : '…'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {currentError && <ErrorNotice message={`Données actuelles illisibles : ${currentError}`} />}
            {result.summary.warnings.length > 0 && (
              <>
                <h4 className="label">À savoir avant de restaurer</h4>
                <ul className="issues">
                  {result.summary.warnings.map((w, i) => (
                    <li key={i} className="warning">
                      {w}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {current && current.running > 0 && (
              <p className="notice small">Un test ou une révision en cours sur cet appareil sera remplacé par les séances de la sauvegarde.</p>
            )}
          </section>

          {!currentEmpty && (
            <section className="card-block">
              <h3 className="label">3. Données actuelles</h3>
              <p className="small">Avant de les remplacer, vous pouvez les enregistrer dans un fichier.</p>
              <button type="button" className="btn secondary block" onClick={() => void exportCurrent()} disabled={busy}>
                {savedCurrent ? 'Télécharger à nouveau la sauvegarde' : 'Sauvegarder mes données actuelles'}
              </button>
              {savedCurrent && (
                <>
                  <p className="small">
                    Le téléchargement de la sauvegarde a été lancé. L'application ne peut pas vérifier que le fichier a bien été enregistré
                    sur votre appareil : contrôlez-le (dossier Téléchargements, Fichiers ou Drive) avant de continuer.
                  </p>
                  <label className="radio-row">
                    <input type="checkbox" checked={keptConfirmed} onChange={(e) => setKeptConfirmed(e.target.checked)} />
                    <span className="small">J'ai vérifié que le fichier de sauvegarde de mes données actuelles est bien enregistré et que je sais où le retrouver.</span>
                  </label>
                </>
              )}
              {!savedCurrent && (
                <label className="radio-row">
                  <input type="checkbox" checked={noNeed} onChange={(e) => setNoNeed(e.target.checked)} />
                  <span className="small">Je n'ai pas besoin de conserver les données actuelles de cet appareil.</span>
                </label>
              )}
            </section>
          )}
        </>
      )}

      {error && <ErrorNotice message={error} />}

      <div className="action-bar">
        <button type="button" className="btn danger block" disabled={!result?.ok || !safetyOk || busy || reading} onClick={() => void restore()}>
          {busy ? 'Restauration…' : 'Remplacer mes données par cette sauvegarde'}
        </button>
      </div>
    </div>
  );
}
