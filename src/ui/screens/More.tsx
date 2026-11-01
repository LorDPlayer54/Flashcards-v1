// Plus (refonte V2) : rubriques et sous-écrans. Paramètres et données : quota, affichage, tests libres, imports,
// collections, sauvegarde, application et stockage local. Aucune nouvelle donnée n'est enregistrée.
import { useEffect, useState, type ReactNode } from 'react';
import { APP_VERSION } from '../../appVersion';
import { checkForUpdate, promptInstall, usePwa } from '../../pwa/register';
import { buildBackup, customBackupName, DEFAULT_BACKUP_BASE, downloadJson, shareJson } from '../../backup/export';
import { getNewPerDay, getSetting, LAST_BACKUP_KEY, setNewPerDay, setSetting } from '../../storage/repo';
import { CORRECTION_PREF_KEY, loadCorrectionPref } from '../../settings/preferences';
import type { CorrectionMode } from '../../domain/types';
import { useApp } from '../AppContext';
import { CollectionsManager } from '../components/CollectionsManager';
import { errorMessage, Icon, plural, Segmented, Switch, TopBar } from '../components/common';
import { href, type Route } from '../router';

interface StorageInfo {
  usage?: number;
  quota?: number;
  persisted?: boolean;
}

type Page = 'home' | 'quota' | 'appearance' | 'testing' | 'import' | 'backup' | 'app';
const PAGES: Page[] = ['home', 'quota', 'appearance', 'testing', 'import', 'backup', 'app'];
const CORRECTION_LABELS: Record<CorrectionMode, string> = { immediate: 'Immédiate', end: 'À la fin' };
const THEME_LABELS = { system: 'Auto', light: 'Clair', dark: 'Sombre' } as const;

const mb = (n?: number) =>
  n === undefined ? '?' : `${(n / 1024 / 1024).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mo`;

type IconName = Parameters<typeof Icon>[0]['name'];

function SettingRow({ title, sub, icon, value, to }: { title: string; sub: string; icon: IconName; value?: string; to: string }) {
  return (
    <li>
      <a className="setting-row" href={to}>
        <span className="setting-icon">
          <Icon name={icon} />
        </span>
        <span className="setting-txt">
          <span className="setting-title">{title}</span>
          <span className="setting-sub">{sub}</span>
        </span>
        <span className="setting-end">
          {value && <span>{value}</span>}
          <Icon name="chevron" />
        </span>
      </a>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="setting-group">
      <h2 className="setting-group-title">{title}</h2>
      <ul className="setting-list">{children}</ul>
    </section>
  );
}

export function More({ route }: { route: Route }) {
  const { db, metas, collections, appearance, setAppearance } = useApp();
  const requested = route.query.get('p') as Page | null;
  const page: Page = requested && PAGES.includes(requested) ? requested : 'home';
  const pwa = usePwa();
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [correctionPref, setCorrectionPref] = useState<CorrectionMode | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [storage, setStorage] = useState<StorageInfo>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [quota, setQuota] = useState<number | null>(null);
  const [quotaInput, setQuotaInput] = useState('');
  const [quotaStatus, setQuotaStatus] = useState<string | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [backupBase, setBackupBase] = useState(DEFAULT_BACKUP_BASE);
  const [backupDate, setBackupDate] = useState(true);
  const [recentAll, setRecentAll] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Message propre à chaque sous-écran
  useEffect(() => {
    setMessage(null);
    setQuotaStatus(null);
    setNow(new Date());
  }, [page]);

  useEffect(() => {
    loadCorrectionPref(db)
      .then(setCorrectionPref)
      .catch((e: unknown) => setCorrectionError(`Lecture de la préférence impossible : ${errorMessage(e)}`));
    getNewPerDay(db)
      .then((n) => {
        setQuota(n);
        setQuotaInput(String(n));
      })
      .catch((e: unknown) => setMessage(`Lecture du réglage impossible : ${errorMessage(e)}`));
    getSetting<string | null>(db, LAST_BACKUP_KEY, null)
      .then(setLastBackupAt)
      .catch(() => undefined);
  }, [db]);

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

  const saveAppearance = async (next: typeof appearance) => {
    try {
      await setAppearance(next);
    } catch (e) {
      setMessage(`Réglage d'affichage non enregistré : ${errorMessage(e)}`);
    }
  };

  /** Le switch n'affiche la nouvelle valeur qu'une fois l'écriture confirmée. */
  const saveCorrectionPref = async (v: CorrectionMode) => {
    setCorrectionSaving(true);
    setCorrectionError(null);
    try {
      await setSetting(db, CORRECTION_PREF_KEY, v);
      setCorrectionPref(v);
    } catch (e) {
      setCorrectionError(`Préférence non enregistrée, le réglage précédent reste appliqué : ${errorMessage(e)}`);
    } finally {
      setCorrectionSaving(false);
    }
  };

  /** Quota : enregistré à chaque changement valide (boutons, suggestions, saisie libre) */
  const saveQuota = async (n: number) => {
    setQuotaInput(String(n));
    if (!Number.isInteger(n) || n < 0 || n > 999) {
      setQuotaStatus('Saisissez un nombre entier entre 0 et 999.');
      return;
    }
    try {
      await setNewPerDay(db, n);
      setQuota(n);
      setQuotaStatus(`Enregistré : ${plural(n, 'nouvelle carte', 'nouvelles cartes')} par jour au maximum, toutes matières confondues.`);
    } catch (e) {
      setQuotaStatus(`Réglage non enregistré : ${errorMessage(e)}`);
    }
  };

  const countByCollection = new Map<string, number>();
  for (const m of metas) countByCollection.set(m.collectionId, (countByCollection.get(m.collectionId) ?? 0) + 1);
  // Imports récents : noms de fichiers déjà enregistrés dans les collections (sans date : elle n'est pas conservée)
  const recentFiles = [...collections]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .flatMap((c) => [...c.sourceFiles].reverse().map((f, i) => ({ key: `${c.collectionId}:${i}`, file: f, collection: c.name })));

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const fileName = customBackupName(backupBase, backupDate, now);

  /** Export par téléchargement ou par la feuille de partage du téléphone (« Enregistrer dans Fichiers »…) */
  const doExport = async (how: 'download' | 'share') => {
    setBusy(true);
    try {
      const backup = await buildBackup(db);
      const name = customBackupName(backupBase, backupDate, new Date());
      if (how === 'share') {
        if (!(await shareJson(backup, name))) downloadJson(backup, name);
      } else downloadJson(backup, name);
      await setSetting(db, LAST_BACKUP_KEY, backup.exportedAt).catch(() => undefined);
      setLastBackupAt(backup.exportedAt);
      setMessage(
        `Sauvegarde « ${name} » créée : ${plural(backup.counts.cards, 'carte', 'cartes')}, ${plural(backup.counts.sessions, 'séance', 'séances')}, ${plural(backup.counts.reviewLog, "ligne d'historique", "lignes d'historique")}.`,
      );
    } catch (e) {
      // Partage annulé par l'utilisatrice : pas une erreur
      if ((e as { name?: string } | null)?.name === 'AbortError') setMessage('Partage annulé : aucune sauvegarde envoyée.');
      else setMessage(`Échec de l'export (aucune donnée modifiée) : ${errorMessage(e)}. Vous pouvez réessayer.`);
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

  const searchUpdate = async () => {
    try {
      setUpdateMsg((await checkForUpdate()) ? 'Recherche effectuée : si une nouvelle version existe, un bandeau vous proposera de mettre à jour.' : 'Recherche impossible ici (version de développement ou navigateur sans service worker).');
    } catch (e) {
      setUpdateMsg(`Recherche impossible (connexion nécessaire) : ${errorMessage(e)}`);
    }
  };

  const notice = message && (
    <p className="notice" role="status">
      {message}
    </p>
  );
  const sub = (title: string, lead: string, body: ReactNode) => (
    <div className={`page more-sub${selecting ? ' with-action-bar' : ''}`}>
      <TopBar title={title} back={href('more')} backLabel="Plus" lead={lead} />
      {notice}
      {body}
    </div>
  );

  if (page === 'quota') {
    const step = (d: number) => void saveQuota(Math.max(0, Math.min(999, (quota ?? 0) + d)));
    return sub(
      'Nouvelles cartes',
      'Définissez la quantité de nouvelles cartes proposées chaque jour dans les révisions programmées.',
      <section className="panel">
        <h2 className="panel-title">Nouvelles cartes par jour</h2>
        <div className="quota-row">
          <button type="button" className="quota-step" aria-label="Diminuer le quota" disabled={quota === null || quota <= 0} onClick={() => step(-1)}>
            −
          </button>
          <div className="quota-control">
            <label htmlFor="new-per-day">Saisir librement un nombre</label>
            <input
              id="new-per-day"
              className="input"
              type="number"
              inputMode="numeric"
              min={0}
              max={999}
              value={quotaInput}
              aria-invalid={quota !== null && quotaInput !== String(quota)}
              onChange={(e) => setQuotaInput(e.target.value)}
              onBlur={() => quotaInput.trim() !== String(quota) && void saveQuota(Number(quotaInput.trim() === '' ? NaN : quotaInput))}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            />
          </div>
          <button type="button" className="quota-step" aria-label="Augmenter le quota" disabled={quota === null || quota >= 999} onClick={() => step(1)}>
            +
          </button>
        </div>
        <div className="quickset" role="group" aria-label="Suggestions de quota">
          {[5, 10, 20, 30].map((n) => (
            <button key={n} type="button" aria-pressed={quota === n} onClick={() => void saveQuota(n)}>
              {n}
            </button>
          ))}
        </div>
        <p className="help" role="status">
          {quotaStatus ?? 'Entre 0 et 999. Même limite pour la révision du jour et la révision personnalisée, toutes matières confondues.'}
        </p>
      </section>,
    );
  }

  if (page === 'appearance') {
    const auto = appearance.theme === 'system';
    const deviceDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return sub(
      'Affichage',
      'Adaptez le confort de lecture à votre appareil.',
      <section className="panel">
        <div className="setting-line">
          <div>
            <b>Mode automatique</b>
            <small>Adapte le thème à l'apparence de l'appareil.</small>
          </div>
          <Switch
            label="Mode automatique"
            checked={auto}
            onChange={(on) => void saveAppearance({ ...appearance, theme: on ? 'system' : deviceDark ? 'dark' : 'light' })}
          />
        </div>
        {auto ? (
          <p className="help">Le thème suit actuellement l'appareil ({deviceDark ? 'sombre' : 'clair'}).</p>
        ) : (
          <>
            <h3 className="sub-label">Choisir une apparence</h3>
            <div className="seg-grid cols-2">
              <Segmented
                label="Thème"
                value={appearance.theme}
                onChange={(theme) => void saveAppearance({ ...appearance, theme })}
                options={[
                  { value: 'light', label: 'Mode clair' },
                  { value: 'dark', label: 'Mode sombre' },
                ]}
              />
            </div>
          </>
        )}
        <h3 className="sub-label">Taille du texte</h3>
        <div className="seg-grid cols-2">
          <Segmented
            label="Taille du texte"
            value={appearance.text}
            onChange={(text) => void saveAppearance({ ...appearance, text })}
            options={[
              { value: 'normal', label: 'Normale' },
              { value: 'large', label: 'Grande' },
            ]}
          />
        </div>
        <p className="help">La salutation et le décor de l'Accueil suivent l'heure locale, quel que soit le thème.</p>
      </section>,
    );
  }

  if (page === 'testing') {
    return sub(
      'Tests libres',
      'Choisissez la correction proposée à la création d’un test.',
      <section className="panel">
        <div className="setting-line">
          <div>
            <b>Corriger après chaque question</b>
            <small>{correctionPref === 'end' ? 'Les corrections apparaissent à la fin du test.' : 'La correction apparaît après chaque question.'}</small>
          </div>
          {correctionPref && (
            <Switch label="Corriger après chaque question" checked={correctionPref === 'immediate'} disabled={correctionSaving} onChange={(on) => void saveCorrectionPref(on ? 'immediate' : 'end')} />
          )}
        </div>
        <p className="help">Vous pourrez changer ce choix avant de commencer un test. Cette préférence n'affecte pas les révisions programmées.</p>
        {correctionError && (
          <p className="notice error" role="alert">
            {correctionError}
          </p>
        )}
      </section>,
    );
  }

  if (page === 'import') {
    const shown = recentAll ? recentFiles : recentFiles.slice(0, 3);
    return sub(
      'Importer des CSV',
      'Ajoutez des cartes à votre bibliothèque.',
      <>
        <a className="compact-picker" href={href('import')}>
          <span className="setting-icon">
            <Icon name="import" />
          </span>
          <span className="setting-txt">
            <span className="setting-title">Fichiers CSV</span>
            <span className="setting-sub">Choisir un ou plusieurs fichiers, vérifier les colonnes puis importer</span>
          </span>
          <span className="picker-button">Choisir</span>
        </a>
        <section className="more-block">
          <div className="simple-head">
            <h2>Imports récents</h2>
            {recentFiles.length > 3 && (
              <button type="button" className="text-button" aria-expanded={recentAll} onClick={() => setRecentAll((v) => !v)}>
                {recentAll ? 'Réduire' : `Voir tout (${recentFiles.length})`}
              </button>
            )}
          </div>
          {recentFiles.length === 0 ? (
            <p className="recent-empty">Aucun fichier importé.</p>
          ) : (
            <ul className="recent-list">
              {shown.map((f) => (
                <li key={f.key} className="recent-row">
                  <span className="csv-mark" aria-hidden="true">
                    CSV
                  </span>
                  <span className="recent-name">
                    <span title={f.file}>{f.file}</span>
                    <small>{f.collection}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <CollectionsManager collections={collections} onSelecting={setSelecting} />
      </>,
    );
  }

  if (page === 'backup') {
    return sub(
      'Télécharger une sauvegarde',
      'Conservez une copie de votre bibliothèque, de votre progression et de vos réglages.',
      <>
        <section className="panel">
          <h2 className="panel-title">Sauvegarde complète</h2>
          <p className="panel-copy">
            Fichier JSON : bibliothèque, collections, tests, états de mémorisation, historique des révisions et réglages. Conservez-le hors du téléphone
            (ordinateur, cloud, e-mail) ; il se restaure sur un autre navigateur ou téléphone.
          </p>
          <p className="entry">
            <span>Dernière sauvegarde</span>
            <b>{lastBackupAt ? new Date(lastBackupAt).toLocaleString('fr-FR') : 'Aucune sur cet appareil'}</b>
          </p>
        </section>
        <section className="panel">
          <h2 className="panel-title">Nom du fichier</h2>
          <label className="sr-only" htmlFor="backup-name">
            Nom du fichier de sauvegarde
          </label>
          <div className="name-field">
            <input
              id="backup-name"
              className="input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={backupBase}
              onChange={(e) => setBackupBase(e.target.value)}
            />
            <span className="name-ext" aria-hidden="true">
              .json
            </span>
          </div>
          <div className="setting-line">
            <div>
              <b>Ajouter la date</b>
              <small>Date et heure de la sauvegarde à la fin du nom</small>
            </div>
            <Switch label="Ajouter la date au nom du fichier" checked={backupDate} onChange={setBackupDate} />
          </div>
          <p className="help">
            Fichier : <strong className="break">{fileName}</strong>
            {backupBase !== DEFAULT_BACKUP_BASE && (
              <>
                {' · '}
                <button type="button" className="text-button inline" onClick={() => setBackupBase(DEFAULT_BACKUP_BASE)}>
                  Nom proposé
                </button>
              </>
            )}
          </p>
        </section>
        <button type="button" className="btn primary block" disabled={busy || metas.length === 0} onClick={() => void doExport('download')}>
          Télécharger ma sauvegarde
          <Icon name="download" />
        </button>
        {canShare && (
          <button type="button" className="btn secondary block" disabled={busy || metas.length === 0} onClick={() => void doExport('share')}>
            Partager / enregistrer dans Fichiers
          </button>
        )}
        {metas.length === 0 && <p className="help">La bibliothèque est vide : rien à sauvegarder pour l'instant.</p>}
      </>,
    );
  }

  if (page === 'app') {
    return sub(
      'Application',
      "Retrouvez les informations d'installation et de fonctionnement hors connexion.",
      <>
        <section className="panel tight">
          <p className="entry">
            <span>Version</span>
            <b>
              {APP_VERSION}
              {pwa.standalone ? ' · installée' : ''}
            </b>
          </p>
          <p className="entry">
            <span>Hors connexion</span>
            <b>{pwa.offlineReady ? 'Prête' : pwa.supported ? 'Préparation…' : 'Non disponible ici'}</b>
          </p>
          <p className="entry">
            <span>Connexion</span>
            <b>{pwa.online ? 'En ligne' : 'Hors ligne'}</b>
          </p>
        </section>
        {pwa.canInstall && (
          <button type="button" className="btn primary block" onClick={() => void promptInstall()}>
            Installer l'application
          </button>
        )}
        {!pwa.standalone && (
          <details className="panel install-help">
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
        {updateMsg && <p className="help">{updateMsg}</p>}

        <section className="panel">
          <h2 className="panel-title">Stockage local</h2>
          <p className="entry">
            <span>Utilisé</span>
            <b>
              {mb(storage.usage)} sur {mb(storage.quota)}
            </b>
          </p>
          <p className="entry">
            <span>Protection contre l'effacement</span>
            <b>{storage.persisted === undefined ? 'Inconnue' : storage.persisted ? 'Activée' : 'Non activée'}</b>
          </p>
          {storage.persisted === false && (
            <button type="button" className="btn secondary block" onClick={() => void askPersist()}>
              Demander la protection du stockage
            </button>
          )}
          <p className="panel-copy">
            Les données restent sur cet appareil, dans ce navigateur. Elles ne sont pas synchronisées entre téléphone et ordinateur : pour changer
            d'appareil, faites une sauvegarde sur l'ancien et restaurez-la sur le nouveau. Travailler sur deux copies en parallèle crée deux historiques
            divergents.
          </p>
        </section>
        <p className="muted small center">Flashcard · version {APP_VERSION} · aucune donnée envoyée sur Internet</p>
      </>,
    );
  }

  return (
    <div className="page more-home">
      <TopBar title="Plus" eyebrow="Flashcard" lead="Vos outils, vos préférences et vos données, au même endroit." />
      {notice}
      <div className="safeguard">
        <span className="setting-icon">
          <Icon name="protect" />
        </span>
        <span>
          <strong>Vos données restent sur cet appareil</strong>
          <small>
            Une sauvegarde permet de les transférer ou de les conserver.
            {lastBackupAt ? ` Dernière : ${new Date(lastBackupAt).toLocaleDateString('fr-FR')}.` : ''}
          </small>
        </span>
      </div>
      <Group title="Votre apprentissage">
        <SettingRow title="Mon programme étudié" sub="Gérer les notions déjà vues en cours" icon="book" to={href('program')} />
        <SettingRow title="Nouvelles cartes par jour" sub="Définir la limite des nouvelles cartes" icon="layers" value={quota === null ? undefined : String(quota)} to={href('more', { p: 'quota' })} />
      </Group>
      <Group title="Bibliothèque et contenus">
        <SettingRow title="Importer des CSV" sub="Ajouter des cartes, imports récents et collections" icon="import" to={href('more', { p: 'import' })} />
        <SettingRow title="Ajouter une carte" sub="Créer une carte manuellement" icon="edit" to={href('card/new')} />
        <SettingRow title="Gérer les libellés" sub="Renommer ou fusionner des libellés" icon="merge" to={href('labels')} />
      </Group>
      <Group title="Préférences">
        <SettingRow title="Affichage" sub="Thème et taille du texte" icon="palette" value={THEME_LABELS[appearance.theme]} to={href('more', { p: 'appearance' })} />
        <SettingRow
          title="Tests libres"
          sub="Correction proposée par défaut"
          icon="sliders"
          value={correctionPref ? CORRECTION_LABELS[correctionPref] : undefined}
          to={href('more', { p: 'testing' })}
        />
      </Group>
      <Group title="Mes données">
        <SettingRow title="Télécharger une sauvegarde" sub="Conserver une copie de vos données" icon="download" to={href('more', { p: 'backup' })} />
        <SettingRow title="Restaurer une sauvegarde" sub="Remplacer les données après vérification" icon="restore" to={href('restore')} />
      </Group>
      <Group title="Aide">
        <SettingRow title="Guide" sub="Dix articles pour tout comprendre" icon="book" to={href('guide')} />
      </Group>
      <Group title="À propos">
        <SettingRow title="Application" sub="Installation, hors ligne, mises à jour et stockage" icon="app" to={href('more', { p: 'app' })} />
      </Group>
      <p className="muted small center">Les informations et réglages sont conservés localement dans l'application.</p>
    </div>
  );
}
