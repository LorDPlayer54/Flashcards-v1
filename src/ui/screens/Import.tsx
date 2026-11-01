// Parcours d'import : fichiers → collection → correspondance des colonnes → aperçu → confirmation.
import { useMemo, useRef, useState } from 'react';
import type { CardDraft } from '../../imports/buildCards';
import {
  autoDetectMapping,
  TARGET_FIELDS,
  validateMapping,
  type ColumnMapping,
  type FixedValues,
  type TargetField,
} from '../../imports/columnMapping';
import { parseCsvBytes, type ParsedCsv } from '../../imports/csvParse';
import {
  analyseFile,
  analysisKey,
  draftsForConfirm,
  ImportCommitError,
  LatestOnly,
  runImport,
  type AnalysisParams,
  type AnalysisResult,
} from '../../imports/importFlow';
import { commitImport, getCardsOfCollection, getLabelRules, type ImportOutcome } from '../../storage/repo';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, formatLabel, plural, TopBar } from '../components/common';
import { RichText } from '../components/RichText';
import { href } from '../router';
import { useReviewData } from '../useReview';

interface QueuedFile {
  name: string;
  parsed?: ParsedCsv;
  readError?: string;
}

type Step = 'pick' | 'configure' | 'preview' | 'importing' | 'done';

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

export function Import() {
  const { db, collections, reload } = useApp();
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [current, setCurrent] = useState(0);
  // Refonte (CSV-MAP-01) : « Correspondance des colonnes » repliée par défaut, état d'affichage uniquement
  const [mapOpen, setMapOpen] = useState(false);
  const mapToggle = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<Step>('pick');

  // Configuration du fichier courant
  const [targetKind, setTargetKind] = useState<'new' | 'existing'>('new');
  const [newName, setNewName] = useState('');
  const [existingId, setExistingId] = useState('');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fixed, setFixed] = useState<FixedValues>({});

  // Résultats
  /** v1.1.1 : aperçu associé aux paramètres qui l'ont produit */
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const gate = useRef(new LatestOnly());
  /** Lot 2 (§3.4) : cartes modifiées dont l'utilisatrice choisit de réinitialiser la mémorisation (carte par carte) */
  const [resetIds, setResetIds] = useState<Set<string>>(new Set());
  const review = useReviewData();
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllIssues, setShowAllIssues] = useState(false);
  /** Choix explicite : importer les QCM non analysables comme questions ouvertes (désactivé par défaut) */
  const [ambiguousAsOpen, setAmbiguousAsOpen] = useState(false);

  const file = queue[current];

  const prepareFile = (f: QueuedFile | undefined) => {
    gate.current.invalidate();
    setMapOpen(false);
    setAnalysis(null);
    setAnalysing(false);
    setOutcome(null);
    setError(null);
    setRefreshError(null);
    setAmbiguousAsOpen(false);
    setShowAllIssues(false);
    setFixed({});
    setTargetKind('new');
    setExistingId(collections[0]?.collectionId ?? '');
    if (!f) return;
    setNewName(baseName(f.name));
    setMapping(f.parsed ? autoDetectMapping(f.parsed.headers) : {});
  };

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list: QueuedFile[] = [];
    for (const f of Array.from(files)) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        list.push({ name: f.name, parsed: parseCsvBytes(bytes) });
      } catch (e) {
        list.push({ name: f.name, readError: e instanceof Error ? e.message : String(e) });
      }
    }
    setQueue(list);
    setCurrent(0);
    prepareFile(list[0]);
    setStep('configure');
  };

  const problems = useMemo(() => validateMapping(mapping, fixed), [mapping, fixed]);

  const currentParams: AnalysisParams = { mapping, fixed, targetKind, newName, existingId, ambiguousAsOpen };
  const currentKey = analysisKey(currentParams);
  /** Aperçu importable : seulement s'il correspond exactement aux paramètres affichés et qu'aucune analyse n'est en cours */
  const ready = draftsForConfirm(analysis, currentKey, analysing);

  const analyse = async (params: AnalysisParams) => {
    if (!file?.parsed || validateMapping(params.mapping, params.fixed).length > 0) return;
    const token = gate.current.begin(); // toute analyse plus ancienne devient caduque
    setError(null);
    setAnalysis(null); // l'ancien aperçu est invalidé immédiatement
    setResetIds(new Set()); // par défaut, chaque carte modifiée garde son état de mémorisation
    setAnalysing(true);
    setShowAllIssues(false);
    setStep('preview');
    try {
      // Lot 3B : fusions de libellés mémorisées (en cas d'échec de lecture, la transaction d'import les appliquera)
      const rules = await getLabelRules(db).catch(() => []);
      const res = await analyseFile(file.parsed, params, (id) => getCardsOfCollection(db, id), rules);
      if (!gate.current.isCurrent(token)) return; // résultat arrivé après une demande plus récente : ignoré
      setAnalysis(res);
    } catch (e) {
      if (gate.current.isCurrent(token)) setError(`Analyse impossible : ${errorMessage(e)}`);
    } finally {
      if (gate.current.isCurrent(token)) setAnalysing(false);
    }
  };

  const toggleAmbiguous = (value: boolean) => {
    setAmbiguousAsOpen(value);
    void analyse({ ...currentParams, ambiguousAsOpen: value });
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await reload();
      setRefreshError(null);
    } catch (e) {
      setRefreshError(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  const confirm = async () => {
    // Relu au moment du clic : jamais les brouillons d'une analyse caduque
    const valid = draftsForConfirm(analysis, analysisKey(currentParams), analysing);
    if (!file || !valid) return;
    gate.current.invalidate();
    setStep('importing');
    setError(null);
    const p = valid.params; // cible et brouillons issus de la même analyse
    const target = p.targetKind === 'new' ? { kind: 'new' as const, name: p.newName } : { kind: 'existing' as const, collectionId: p.existingId };
    try {
      // I1 : la transaction et le rafraîchissement de l'écran sont deux étapes distinctes
      const resetReviewFor = [...resetIds];
      const res = await runImport(
        () => commitImport(db, target, file.name, valid.build.drafts, new Date().toISOString(), { resetReviewFor }),
        reload,
      );
      setOutcome(res.outcome);
      setRefreshError(res.refreshError ?? null);
      setStep('done');
      // Demande au navigateur de ne pas effacer les données en cas de manque d'espace (si supporté)
      void navigator.storage?.persist?.().catch(() => undefined);
    } catch (e) {
      const msg = e instanceof ImportCommitError ? e.message : errorMessage(e);
      setError(`Import annulé, aucune donnée modifiée : ${msg}`);
      setStep('preview');
    }
  };

  const nextFile = () => {
    const n = current + 1;
    setCurrent(n);
    prepareFile(queue[n]);
    setStep(n < queue.length ? 'configure' : 'pick');
    if (n >= queue.length) setQueue([]);
  };

  const reset = () => {
    setQueue([]);
    setCurrent(0);
    setStep('pick');
  };

  // ---------- Étape 1 : choix des fichiers ----------
  if (step === 'pick' || !file) {
    return (
      <div className="page">
        <TopBar title="Importer" />
        <section className="card-block">
          <p>Choisissez un ou plusieurs fichiers CSV. Les cartes et collections existantes ne sont jamais effacées.</p>
          <label className="btn primary block file-btn">
            Choisir des fichiers CSV
            <input
              type="file"
              accept=".csv,text/csv,text/plain,application/vnd.ms-excel"
              multiple
              onChange={(e) => {
                void onPick(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <p className="muted small">
            Colonnes reconnues automatiquement : ID, Matière, Thème (ou Sous-catégorie), Leçon, Notion, Type, Difficulté, Question, Réponse,
            Explication, Astuce / Piège. Séparateur « , » ou « ; », UTF-8 avec ou sans BOM.
          </p>
        </section>
      </div>
    );
  }

  const header = (
    <TopBar
      title={`Importer ${queue.length > 1 ? `(${current + 1}/${queue.length})` : ''}`}
      back={
        step === 'preview'
          ? () => {
              gate.current.invalidate();
              setAnalysing(false);
              setStep('configure');
            }
          : step === 'configure'
            ? reset
            : undefined
      }
    />
  );

  if (file.readError || !file.parsed || file.parsed.fatal) {
    return (
      <div className="page">
        {header}
        <p className="notice error" role="alert">
          {file.parsed?.fatal
            ? `Fichier « ${file.name} » refusé : ${file.parsed.fatal} Aucune donnée n'a été importée ; corrigez le fichier puis réessayez.`
            : `Lecture impossible de « ${file.name} » : ${file.readError}`}
        </p>
        <button type="button" className="btn primary block" onClick={nextFile}>
          {current + 1 < queue.length ? 'Fichier suivant' : 'Terminer'}
        </button>
      </div>
    );
  }
  const parsed = file.parsed;

  // ---------- Étape 2 : collection + correspondance ----------
  if (step === 'configure') {
    const sample = parsed.rows[0] ?? [];
    const fieldSelect = (field: TargetField, label: string, required?: boolean) => (
      <label key={field} className="map-row">
        <span className="map-label">
          {label}
          {required && <span className="req"> *</span>}
        </span>
        <select
          className="input"
          value={mapping[field] ?? ''}
          onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value === '' ? undefined : Number(e.target.value) }))}
        >
          <option value="">— aucune colonne —</option>
          {parsed.headers.map((h, i) => (
            <option key={i} value={i}>
              {h || `Colonne ${i + 1}`}
              {sample[i] ? ` (ex. ${sample[i]!.slice(0, 25).replace(/\s+/g, ' ')})` : ''}
            </option>
          ))}
        </select>
      </label>
    );

    return (
      <div className="page with-action-bar">
        {header}
        <section className="card-block">
          <p className="strong break">{file.name}</p>
          <p className="muted small">
            {plural(parsed.rows.length, 'ligne de données', 'lignes de données')} · séparateur « {parsed.delimiter === '\t' ? 'tabulation' : parsed.delimiter} » ·{' '}
            {parsed.encoding === 'utf-8' ? `UTF-8${parsed.hadBom ? ' (BOM)' : ''}` : 'Windows-1252'}
          </p>
          {parsed.warnings.map((w, i) => (
            <p key={i} className="notice small">
              {w}
            </p>
          ))}
        </section>

        <section className="field">
          <h3 className="label">Collection</h3>
          <label className="radio-row">
            <input type="radio" name="target" checked={targetKind === 'new'} onChange={() => setTargetKind('new')} />
            <span>Nouvelle collection</span>
          </label>
          {targetKind === 'new' && (
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Nom de la nouvelle collection" />
          )}
          <label className="radio-row">
            <input
              type="radio"
              name="target"
              checked={targetKind === 'existing'}
              disabled={collections.length === 0}
              onChange={() => setTargetKind('existing')}
            />
            <span>Mettre à jour une collection existante{collections.length === 0 ? ' (aucune)' : ''}</span>
          </label>
          {targetKind === 'existing' && (
            <select className="input" value={existingId} onChange={(e) => setExistingId(e.target.value)} aria-label="Collection à mettre à jour">
              {collections.map((c) => (
                <option key={c.collectionId} value={c.collectionId}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* CSV-MAP-01 : détail replié par défaut ; les champs restent montés (valeurs conservées), masqués par `hidden` */}
        <section className="disclosure">
          <button
            ref={mapToggle}
            type="button"
            className="disclosure-head"
            aria-expanded={mapOpen}
            aria-controls="column-mapping"
            onClick={() => setMapOpen((o) => !o)}
          >
            <span>
              <span className="disclosure-title">Correspondance des colonnes</span>
              <span className="disclosure-sub">
                {plural(parsed.headers.length, 'colonne détectée', 'colonnes détectées')} ·{' '}
                {plural(Object.values(mapping).filter((v) => v !== undefined).length, 'champ associé', 'champs associés')}
              </span>
            </span>
            <svg className="chev-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div id="column-mapping" className="disclosure-body" hidden={!mapOpen}>
            {TARGET_FIELDS.filter((f) => !f.advanced).map((f) => fieldSelect(f.field, f.label, f.required))}
            <details className="advanced">
              <summary>Options de QCM dans des colonnes séparées</summary>
              {TARGET_FIELDS.filter((f) => f.advanced).map((f) => fieldSelect(f.field, f.label))}
            </details>
            <h3 className="label">Valeurs pour tout le fichier (facultatif)</h3>
            <p className="muted small">Utilisées seulement quand la colonne est absente ou vide. Rien n'est déduit du texte des questions.</p>
            {(['matiere', 'theme', 'lecon'] as const).map((k) => (
              <label key={k} className="map-row">
                <span className="map-label">{k === 'matiere' ? 'Matière' : k === 'theme' ? 'Thème' : 'Leçon'}</span>
                <input className="input" value={fixed[k] ?? ''} onChange={(e) => setFixed((f) => ({ ...f, [k]: e.target.value }))} />
              </label>
            ))}
          </div>
        </section>

        {problems.length > 0 && (
          <section className="notice error" role="alert">
            {problems.map((p, i) => (
              <p key={i}>{p.message}</p>
            ))}
            {!mapOpen && (
              <button
                type="button"
                className="btn secondary small"
                onClick={() => {
                  setMapOpen(true);
                  mapToggle.current?.focus();
                }}
              >
                Vérifier les colonnes
              </button>
            )}
          </section>
        )}
        {error && <p className="notice error">{error}</p>}

        <div className="action-bar">
          <button
            type="button"
            className="btn primary block"
            disabled={problems.length > 0 || (targetKind === 'existing' && !existingId)}
            onClick={() => void analyse(currentParams)}
          >
            Analyser le fichier
          </button>
        </div>
      </div>
    );
  }

  // ---------- Étape 3 : aperçu ----------
  if (step === 'preview' && (!analysis || analysing)) {
    return (
      <div className="page">
        {header}
        {error ? (
          <ErrorNotice message={error} onRetry={() => void analyse(currentParams)} />
        ) : (
          <p className="muted center" aria-live="polite">
            Analyse en cours…
          </p>
        )}
      </div>
    );
  }

  if (step === 'preview' && analysis) {
    const { build, plan, issues } = analysis;
    const malformed = issues.filter((i) => i.kind === 'malformed');
    const ambiguous = issues.filter((i) => i.kind === 'ambiguous-mcq');
    const otherErrors = issues.filter((i) => i.severity === 'error' && i.kind !== 'malformed' && i.kind !== 'ambiguous-mcq');
    const warnings = issues.filter((i) => i.severity === 'warning');
    const shownIssues = showAllIssues ? issues : issues.slice(0, 20);
    const byMatiere = new Map<string, number>();
    for (const d of build.drafts) byMatiere.set(d.matiere, (byMatiere.get(d.matiere) ?? 0) + 1);
    const nMcq = build.drafts.filter((d) => d.formatQuestion === 'mcq').length;
    const majorChanges = plan.toUpdate.filter((u) => u.majorChange).length;
    // Cartes modifiées qui ont déjà un état de mémorisation : choix explicite, carte par carte
    const withMemory = plan.toUpdate.filter((u) => u.majorChange && review.data?.states.has(u.existing.cardId));
    const toggleReset = (id: string, on: boolean) =>
      setResetIds((prev) => {
        const nextSet = new Set(prev);
        if (on) nextSet.add(id);
        else nextSet.delete(id);
        return nextSet;
      });
    const nothing = plan.toAdd.length === 0 && plan.toUpdate.length === 0;
    const samples: CardDraft[] = [
      ...build.drafts.filter((d) => d.formatQuestion === 'mcq').slice(0, 1),
      ...build.drafts.filter((d) => d.formatQuestion === 'open').slice(0, 2),
    ];

    return (
      <div className="page with-action-bar">
        {header}
        <section className="card-block">
          <h3 className="label">Résultat de l'analyse</h3>
          <ul className="kv">
            <li>
              <span>Cartes valides</span>
              <strong>{build.drafts.length}</strong>
            </li>
            <li>
              <span>QCM / questions ouvertes</span>
              <strong>
                {nMcq} / {build.drafts.length - nMcq}
              </strong>
            </li>
            {[...byMatiere].map(([m, n]) => (
              <li key={m}>
                <span>Matière « {m} »</span>
                <strong>{n}</strong>
              </li>
            ))}
            <li>
              <span>Lignes CSV mal formées (exclues)</span>
              <strong>{malformed.length}</strong>
            </li>
            <li>
              <span>QCM non analysables {ambiguousAsOpen ? '(importés en questions ouvertes)' : '(exclus)'}</span>
              <strong>{ambiguous.length}</strong>
            </li>
            <li>
              <span>Autres lignes ignorées</span>
              <strong>{otherErrors.length}</strong>
            </li>
            <li>
              <span>Avertissements</span>
              <strong>{warnings.length}</strong>
            </li>
          </ul>
        </section>

        <section className="card-block">
          <h3 className="label">Effet sur la bibliothèque</h3>
          <ul className="kv">
            <li>
              <span>Nouvelles cartes</span>
              <strong>{plan.toAdd.length}</strong>
            </li>
            {targetKind === 'existing' && (
              <>
                <li>
                  <span>Cartes modifiées</span>
                  <strong>{plan.toUpdate.length}</strong>
                </li>
                <li>
                  <span>Cartes inchangées</span>
                  <strong>{plan.unchanged}</strong>
                </li>
                <li>
                  <span>Cartes absentes du fichier (conservées)</span>
                  <strong>{plan.keptAbsent}</strong>
                </li>
              </>
            )}
          </ul>
          {targetKind === 'existing' && (plan.addedWithoutId > 0 || plan.unmatchedExistingWithoutId > 0) && (
            <p className="notice">
              {plan.addedWithoutId} carte(s) sans identifiant n'ont pas de copie strictement identique dans la collection : elles seront
              ajoutées comme nouvelles. Une carte sans identifiant ne peut pas être reconnue de façon fiable après modification ; si ce sont
              des versions corrigées de cartes existantes, cela créera des doublons. {plan.unmatchedExistingWithoutId} carte(s) existante(s)
              sans identifiant restent inchangées.
            </p>
          )}
          {analysis.remapped > 0 && (
            <p className="notice small">
              {plural(analysis.remapped, 'carte du fichier est reclassée', 'cartes du fichier sont reclassées')} selon vos fusions de libellés (Plus ›
              Libellés).
            </p>
          )}
          {plan.toUpdate.some((u) => u.existing.editedAt) && (
            <p className="notice small">
              {plural(plan.toUpdate.filter((u) => u.existing.editedAt).length, 'carte modifiée', 'cartes modifiées')} dans l'application{' '}
              {plan.toUpdate.filter((u) => u.existing.editedAt).length > 1 ? 'seront remplacées' : 'sera remplacée'} par la version du fichier.
            </p>
          )}
          {majorChanges > 0 && (
            <p className="notice">
              {plural(majorChanges, 'carte existante a', 'cartes existantes ont')} une question ou une réponse modifiée. Leur identifiant interne est
              conservé{withMemory.length > 0 ? ', ainsi que leur état de mémorisation, sauf si vous choisissez ci-dessous de le réinitialiser.' : '.'}
            </p>
          )}
          {withMemory.length > 0 && (
            <details className="advanced" open={withMemory.length <= 10}>
              <summary>
                Mémorisation des cartes modifiées ({resetIds.size} réinitialisée{resetIds.size > 1 ? 's' : ''} sur {withMemory.length})
              </summary>
              <p className="muted small">
                Cochez une carte pour la faire repartir de zéro en révision (elle redeviendra « nouvelle »). Sans coche, ses échéances sont
                conservées. L'historique des révisions est toujours conservé.
              </p>
              {withMemory.map((u) => (
                <label key={u.existing.cardId} className="radio-row">
                  <input
                    type="checkbox"
                    checked={resetIds.has(u.existing.cardId)}
                    onChange={(e) => toggleReset(u.existing.cardId, e.target.checked)}
                  />
                  <span className="small">
                    {u.existing.externalId ? `${u.existing.externalId} — ` : ''}
                    {u.draft.question.slice(0, 80)}
                  </span>
                </label>
              ))}
            </details>
          )}
        </section>

        {build.fileWarnings.map((w, i) => (
          <p key={i} className="notice small">
            {w}
          </p>
        ))}

        {ambiguous.length > 0 && (
          <section className="card-block">
            <p className="small">
              {plural(ambiguous.length, 'carte ressemble', 'cartes ressemblent')} à un QCM mais ne peu{ambiguous.length > 1 ? 'vent' : 't'} pas être
              corrigée{ambiguous.length > 1 ? 's' : ''} de façon fiable. Par défaut elles sont exclues : corrigez-les dans le fichier puis
              réimportez-le dans la même collection.
            </p>
            <label className="radio-row">
              <input type="checkbox" checked={ambiguousAsOpen} onChange={(e) => toggleAmbiguous(e.target.checked)} />
              <span>Les importer quand même comme questions ouvertes (sans correction automatique)</span>
            </label>
          </section>
        )}

        {issues.length > 0 && (
          <section>
            <h3 className="section-title">Anomalies</h3>
            <ul className="issues">
              {shownIssues.map((i, k) => (
                <li key={k} className={i.severity}>
                  <strong>
                    Carte {i.row}
                    {i.externalId ? ` (${i.externalId})` : ''}
                  </strong>{' '}
                  — {i.message}
                </li>
              ))}
            </ul>
            {!showAllIssues && issues.length > shownIssues.length && (
              <button type="button" className="btn secondary block" onClick={() => setShowAllIssues(true)}>
                Afficher les {issues.length} anomalies
              </button>
            )}
          </section>
        )}

        {samples.length > 0 && (
          <section>
            <h3 className="section-title">Aperçu</h3>
            {samples.map((d, i) => (
              <article key={i} className="card-block small">
                <p className="crumbs small">
                  {[d.matiere, d.theme, d.lecon, d.notion].filter(Boolean).join(' › ')} · {formatLabel(d.formatQuestion)}
                </p>
                <RichText text={d.question} />
                {d.options && (
                  <ol className="options readonly">
                    {d.options.map((o) => (
                      <li key={o.id} className={o.id === d.correctOptionId ? 'option correct' : 'option'}>
                        <span className="opt-letter">{o.id}</span>
                        <RichText text={o.text} />
                      </li>
                    ))}
                  </ol>
                )}
                <p className="muted small">Réponse : {d.reponse}</p>
              </article>
            ))}
          </section>
        )}

        {error && <p className="notice error">{error}</p>}

        <div className="action-bar">
          {nothing ? (
            <button type="button" className="btn secondary block" onClick={nextFile}>
              Rien à importer — {current + 1 < queue.length ? 'fichier suivant' : 'terminer'}
            </button>
          ) : (
            <button type="button" className="btn primary block" disabled={!ready} onClick={() => void confirm()}>
              Confirmer l'import ({plural(plan.toAdd.length + plan.toUpdate.length, 'carte', 'cartes')})
            </button>
          )}
        </div>
      </div>
    );
  }

  if (step === 'importing') {
    return (
      <div className="page center">
        <p className="strong">Import en cours…</p>
        <p className="muted">Ne fermez pas la page.</p>
      </div>
    );
  }

  // ---------- Étape 4 : terminé ----------
  return (
    <div className="page">
      {header}
      <section className="card-block">
        <h3 className="label">Importation réussie</h3>
        <p className="small">Les cartes sont enregistrées sur cet appareil.</p>
        {outcome && (
          <ul className="kv">
            <li>
              <span>Ajoutées</span>
              <strong>{outcome.added}</strong>
            </li>
            <li>
              <span>Mises à jour</span>
              <strong>{outcome.updated}</strong>
            </li>
            <li>
              <span>Inchangées</span>
              <strong>{outcome.unchanged}</strong>
            </li>
            {outcome.keptAbsent > 0 && (
              <li>
                <span>Conservées (absentes du fichier)</span>
                <strong>{outcome.keptAbsent}</strong>
              </li>
            )}
            {outcome.reviewReset > 0 && (
              <li>
                <span>Mémorisations réinitialisées</span>
                <strong>{outcome.reviewReset}</strong>
              </li>
            )}
          </ul>
        )}
      </section>
      {refreshError && (
        <ErrorNotice
          message={`L'importation est bien enregistrée, mais l'affichage de la bibliothèque n'a pas pu être actualisé (${refreshError}). Inutile de réimporter le fichier.`}
          onRetry={() => void refresh()}
          retryLabel="Actualiser la bibliothèque"
          busy={refreshing}
        />
      )}
      <div className="button-stack">
        {current + 1 < queue.length ? (
          <button type="button" className="btn primary block" onClick={nextFile}>
            Fichier suivant ({queue[current + 1]!.name})
          </button>
        ) : (
          <a className="btn primary block" href={href('library')}>
            Voir la bibliothèque
          </a>
        )}
        <button type="button" className="btn secondary block" onClick={reset}>
          Importer d'autres fichiers
        </button>
      </div>
    </div>
  );
}
