// Paramètres et données : export, collections, stockage local.
import { useEffect, useState } from 'react';
import { APP_VERSION } from '../../appVersion';
import { checkForUpdate, promptInstall, usePwa } from '../../pwa/register';
import { backupFileName, buildBackup, downloadJson, shareJson } from '../../backup/export';
import { deleteCollection, getNewPerDay, getSetting, LAST_BACKUP_KEY, setNewPerDay, setSetting } from '../../storage/repo';
import { CORRECTION_PREF_KEY, parseCorrectionPref, type CorrectionPref } from '../../settings/preferences';
import { useApp } from '../AppContext';
import { errorMessage, plural, Segmented, TopBar } from '../components/common';
import { href } from '../router';

interface StorageInfo {
  usage?: number;
  quota?: number;
  persisted?: boolean;
}

const mb = (n?: number) =>
  n === undefined ? '?' : `${(n / 1024 / 1024).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mo`;

export function More() {
  const { db, metas, collections, reload, appearance, setAppearance } = useApp();
  const pwa = usePwa();
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const searchUpdate = async () => {
    try {
      setUpdateMsg((await checkForUpdate()) ? 'Recherche effectuée : si une nouvelle version existe, un bandeau vous proposera de mettre à jour.' : 'Recherche impossible ici (version de développement ou navigateur sans service worker).');
    } catch (e) {
      setUpdateMsg(`Recherche impossible (connexion nécessaire) : ${errorMessage(e)}`);
    }
  };
  const [correctionPref, setCorrectionPref] = useState<CorrectionPref | null>(null);
  const [storage, setStorage] = useState<StorageInfo>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newPerDay, setNewPerDayInput] = useState<string>('');

  useEffect(() => {
    getSetting<unknown>(db, CORRECTION_PREF_KEY, 'last')
      .then((v) => setCorrectionPref(parseCorrectionPref(v)))
      .catch(() => setCorrectionPref('last'));
  }, [db]);

  const saveAppearance = async (next: typeof appearance) => {
    try {
      await setAppearance(next);
    } catch (e) {
      setMessage(`Réglage d'affichage non enregistré : ${errorMessage(e)}`);
    }
  };

  const saveCorrectionPref = async (v: CorrectionPref) => {
    try {
      await setSetting(db, CORRECTION_PREF_KEY, v);
      setCorrectionPref(v);
    } catch (e) {
      setMessage(`Préférence non enregistrée : ${errorMessage(e)}`);
    }
  };

  useEffect(() => {
    getNewPerDay(db)
      .then((n) => setNewPerDayInput(String(n)))
      .catch((e: unknown) => setMessage(`Lecture du réglage impossible : ${errorMessage(e)}`));
  }, [db]);

  const saveNewPerDay = async () => {
    const n = Number(newPerDay);
    try {
      await setNewPerDay(db, n);
      setMessage(`Réglage enregistré : ${plural(n, 'nouvelle carte', 'nouvelles cartes')} par jour au maximum, toutes matières confondues.`);
    } catch (e) {
      setMessage(errorMessage(e));
    }
  };

  const refreshStorage = async () => {
    const info: StorageInfo = {};
    try {
      const est = await navigator.storage?.estimate?.();
      info.usage = est?.usage;
      info.quota = est?.quota;
      info.persisted = await navigator.storage?.persisted?.();
    } catch {
      // API non disponible sur ce navigateur
    }
    setStorage(info);
  };

  useEffect(() => {
    void refreshStorage();
  }, [metas.length]);

  const countByCollection = new Map<string, number>();
  for (const m of metas) countByCollection.set(m.collectionId, (countByCollection.get(m.collectionId) ?? 0) + 1);

  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  useEffect(() => {
    getSetting<string | null>(db, LAST_BACKUP_KEY, null)
      .then(setLastBackupAt)
      .catch(() => undefined);
  }, [db]);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /** Lot 4 : export par téléchargement ou par la feuille de partage du téléphone (« Enregistrer dans Fichiers »…) */
  const doExport = async (how: 'download' | 'share') => {
    setBusy(true);
    try {
      const backup = await buildBackup(db);
      const name = backupFileName();
      if (how === 'share') {
        if (!(await shareJson(backup, name))) downloadJson(backup, name);
      } else downloadJson(backup, name);
      await setSetting(db, LAST_BACKUP_KEY, backup.exportedAt).catch(() => undefined);
      setLastBackupAt(backup.exportedAt);
      setMessage(
        `Sauvegarde créée : ${plural(backup.counts.cards, 'carte', 'cartes')}, ${plural(backup.counts.sessions, 'séance', 'séances')}, ${plural(backup.counts.reviewLog, "ligne d'historique", "lignes d'historique")}.`,
      );
    } catch (e) {
      // Partage annulé par l'utilisatrice : pas une erreur
      if ((e as { name?: string } | null)?.name === 'AbortError') setMessage('Partage annulé : aucune sauvegarde envoyée.');
      else setMessage(`Échec de l'export (aucune donnée modifiée) : ${errorMessage(e)}. Vous pouvez réessayer.`);
    } finally {
      setBusy(false);
    }
  };

  const doDeleteCollection = async (id: string, name: string) => {
    const n = countByCollection.get(id) ?? 0;
    if (!window.confirm(`Supprimer la collection « ${name} » et ses ${n} cartes ? Cette action est irréversible.`)) return;
    setBusy(true);
    try {
      const removed = await deleteCollection(db, id);
      setMessage(`Collection supprimée (${plural(removed, 'carte', 'cartes')}).`);
    } catch (e) {
      setMessage(`La collection n'a pas été supprimée (aucune carte effacée) : ${errorMessage(e)}. Vous pouvez réessayer.`);
      setBusy(false);
      return;
    }
    try {
      await reload();
    } catch (e) {
      setMessage(`Collection supprimée, mais l'affichage n'a pas pu être actualisé : ${errorMessage(e)}. Rechargez la page.`);
    } finally {
      setBusy(false);
    }
  };

  const askPersist = async () => {
    try {
      const ok = await navigator.storage?.persist?.();
      await refreshStorage();
      setMessage(ok ? 'Stockage protégé : le navigateur ne devrait plus effacer vos données automatiquement.' : "Le navigateur n'a pas accordé la protection du stockage.");
    } catch (e) {
      setMessage(`Demande de protection impossible : ${errorMessage(e)}`);
    }
  };

  return (
    <div className="page">
      <TopBar title="Plus" />
      {message && <p className="notice">{message}</p>}

      <a className="btn primary block" href={href('import')}>
        Importer des flashcards (CSV)
      </a>
      <div className="link-grid">
        <a className="btn secondary" href={href('stats')}>
          Statistiques
        </a>
        <a className="btn secondary" href={href('card/new')}>
          Ajouter une carte
        </a>
        <a className="btn secondary" href={href('labels')}>
          Libellés (fusion)
        </a>
      </div>

      <section className="card-block">
        <h3 className="label">Affichage</h3>
        <p className="small" id="theme-label">
          Thème
        </p>
        <Segmented
          label="Thème"
          value={appearance.theme}
          onChange={(theme) => void saveAppearance({ ...appearance, theme })}
          options={[
            { value: 'system', label: 'Automatique' },
            { value: 'light', label: 'Clair' },
            { value: 'dark', label: 'Sombre' },
          ]}
        />
        <p className="small">Taille du texte</p>
        <Segmented
          label="Taille du texte"
          value={appearance.text}
          onChange={(text) => void saveAppearance({ ...appearance, text })}
          options={[
            { value: 'normal', label: 'Normale' },
            { value: 'large', label: 'Grande' },
          ]}
        />
        <p className="muted small">« Automatique » suit le réglage clair ou sombre du téléphone.</p>
      </section>

      <section className="card-block">
        <h3 className="label">Tests libres</h3>
        <p className="small">Correction proposée à la création d'un test</p>
        {correctionPref && (
          <Segmented
            label="Correction par défaut"
            value={correctionPref}
            onChange={(v) => void saveCorrectionPref(v)}
            options={[
              { value: 'last', label: 'Comme le dernier test' },
              { value: 'immediate', label: 'Après chaque question' },
              { value: 'end', label: 'En fin de test' },
            ]}
          />
        )}
      </section>

      <section className="card-block">
        <h3 className="label">Révision programmée</h3>
        <label className="small" htmlFor="new-per-day">
          Nombre maximal de nouvelles cartes par jour (toutes matières confondues)
        </label>
        <div className="inline-form">
          <input
            id="new-per-day"
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            max={999}
            value={newPerDay}
            onChange={(e) => setNewPerDayInput(e.target.value)}
          />
          <button type="button" className="btn secondary" onClick={() => void saveNewPerDay()}>
            Enregistrer
          </button>
        </div>
      </section>

      <section className="card-block">
        <h3 className="label">Sauvegarde</h3>
        <p className="small">
          Enregistrez régulièrement une sauvegarde (fichier JSON) : bibliothèque, collections, tests, états de mémorisation, historique des
          révisions et réglages. Conservez-la hors du téléphone (ordinateur, cloud, e-mail).
        </p>
        <p className="small">
          Dernière sauvegarde : {lastBackupAt ? new Date(lastBackupAt).toLocaleString('fr-FR') : 'aucune sur cet appareil'}
        </p>
        <button type="button" className="btn primary block" disabled={busy || metas.length === 0} onClick={() => void doExport('download')}>
          Télécharger une sauvegarde
        </button>
        {canShare && (
          <button type="button" className="btn secondary block" disabled={busy || metas.length === 0} onClick={() => void doExport('share')}>
            Partager / enregistrer dans Fichiers
          </button>
        )}
        <a className="btn secondary block" href={href('restore')}>
          Restaurer une sauvegarde
        </a>
      </section>

      <section>
        <h3 className="section-title">Collections</h3>
        {collections.length === 0 ? (
          <p className="muted">Aucune collection.</p>
        ) : (
          <ul className="list">
            {collections.map((c) => (
              <li key={c.collectionId} className="list-row static">
                <span className="row-main">
                  {c.name}
                  <span className="row-sub">
                    {plural(countByCollection.get(c.collectionId) ?? 0, 'carte', 'cartes')} · {c.sourceFiles.length} import(s) · dernier :{' '}
                    {new Date(c.updatedAt).toLocaleDateString('fr-FR')}
                  </span>
                </span>
                <button type="button" className="btn danger small" disabled={busy} onClick={() => void doDeleteCollection(c.collectionId, c.name)}>
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card-block small">
        <h3 className="label">Application</h3>
        <p>
          Version {APP_VERSION}
          {pwa.standalone ? ' · installée' : ''}
          <br />
          Hors connexion : {pwa.offlineReady ? 'prête (tous les écrans fonctionnent sans Internet)' : pwa.supported ? 'préparation…' : 'non disponible dans ce navigateur ou cette version'}
          <br />
          Connexion : {pwa.online ? 'en ligne' : 'hors ligne'}
        </p>
        {pwa.canInstall && (
          <button type="button" className="btn primary block" onClick={() => void promptInstall()}>
            Installer l'application
          </button>
        )}
        {!pwa.standalone && (
          <details>
            <summary>Installer sur le téléphone</summary>
            <p>
              <strong>Android (Chrome)</strong> : menu ⋮ › « Installer l'application » ou « Ajouter à l'écran d'accueil ».
              <br />
              <strong>iPhone (Safari)</strong> : bouton Partager › « Sur l'écran d'accueil ».
              <br />
              Ouvrez ensuite l'application depuis son icône : elle fonctionne sans connexion.
            </p>
          </details>
        )}
        <button type="button" className="btn secondary block" onClick={() => void searchUpdate()} disabled={!pwa.online}>
          Rechercher une mise à jour
        </button>
        {updateMsg && <p className="muted">{updateMsg}</p>}
      </section>

      <section className="card-block small">
        <h3 className="label">Stockage local</h3>
        <p>
          Utilisé : {mb(storage.usage)} sur {mb(storage.quota)} disponibles.
          <br />
          Protection contre l'effacement automatique : {storage.persisted === undefined ? 'inconnue' : storage.persisted ? 'activée' : 'non activée'}
        </p>
        {storage.persisted === false && (
          <button type="button" className="btn secondary block" onClick={() => void askPersist()}>
            Demander la protection du stockage
          </button>
        )}
        <p className="muted">
          Les données restent sur cet appareil, dans ce navigateur. Elles ne sont pas synchronisées entre téléphone et ordinateur : pour changer
          d'appareil, faites une sauvegarde sur l'ancien et restaurez-la sur le nouveau. Travailler sur deux copies en parallèle crée deux historiques divergents.
        </p>
      </section>

      <p className="muted small center">Flashcards ENA · version {APP_VERSION} · aucune donnée envoyée sur Internet</p>
    </div>
  );
}
