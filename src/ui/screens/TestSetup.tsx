// Configuration d'un test libre.
// Lot 1 : périmètre prérempli, format, nombre de questions, ordre.
// Lot 3A : périmètre multiple modifiable, filtres de difficulté / type pédagogique / statut de maîtrise,
// explication des résultats vides, correction immédiate ou en fin de test, chronomètre.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  UNSET,
  type CorrectionMode,
  type FormatFilter,
  type MasteryBucket,
  type OrderMode,
  type ScopeSpec,
  type TestConfig,
  type TestFilters,
} from '../../domain/types';
import { loadCorrectionPref } from '../../settings/preferences';
import { getInProgressSessions, getSetting, setSetting, startTestSession } from '../../storage/repo';
import { pathKeyOf, ROOT_ID } from '../../taxonomy/tree';
import {
  activeDimensions,
  applyTestFilters,
  drawCards,
  effectiveCount,
  filterOptions,
  MASTERY_LABELS,
  NO_FILTERS,
  resolveScope,
  scopeLabelOf,
  statesViewOf,
} from '../../tests/selection';
import { createSession } from '../../tests/session';
import { useApp } from '../AppContext';
import { ChipGroup, confirmReplace, ErrorNotice, Icon, plural, Segmented, Switch, TopBar } from '../components/common';
import { monogramOf, monogramsFor } from '../monogram';
import { ScopePicker } from '../components/ScopePicker';
import { libraryHref, navigate, type Route } from '../router';
import { previewRefreshPhase, type LibraryReload } from '../previewRefresh';
import { useReviewData } from '../useReview';

type CountChoice = '10' | '20' | '30' | 'all' | 'custom';
type TimerChoice = 'off' | 'elapsed' | 'limit';
type LimitChoice = '5' | '10' | '15' | '30' | 'custom';

const LAST_CONFIG_KEY = 'lastTestConfig';
/** Monogrammes visibles avant le bouton « +N » (maquette Test libre V3) */
const CHIP_LIMIT = 5;

function countChoiceOf(count: number | null): { choice: CountChoice; custom: string } {
  if (count === null) return { choice: 'all', custom: '15' };
  if (count === 10 || count === 20 || count === 30) return { choice: String(count) as CountChoice, custom: '15' };
  return { choice: 'custom', custom: String(count) };
}

export function TestSetup({ route }: { route: Route }) {
  const { db, metas, tax, pendingScope, pendingConfig, setPendingConfig, reload } = useApp();
  const review = useReviewData();
  // v0.3.0-a1 (I1) : des états non chargés ou illisibles ne sont jamais assimilés à « aucun état » (cartes nouvelles)
  const states = statesViewOf(review);
  const statesStatus: 'ready' | 'loading' | 'error' = states ? 'ready' : review.error ? 'error' : 'loading';

  // Périmètre initial : niveau consulté, sélection (recherche, erreurs) ou périmètre d'un test à refaire
  const initialScope: ScopeSpec | null = useMemo(() => {
    if (route.query.get('from') === 'selection') return pendingScope;
    return { kind: 'node', nodeId: route.query.get('n') ?? ROOT_ID };
  }, [route, pendingScope]);
  const [scope, setScope] = useState<ScopeSpec | null>(initialScope);
  const [picking, setPicking] = useState(false);

  // Réglages : ceux d'un test à refaire, sinon valeurs par défaut (puis préférences enregistrées, voir plus bas)
  const pre = pendingConfig;
  const [format, setFormat] = useState<FormatFilter>(pre?.format ?? 'all');
  const [filters, setFilters] = useState<TestFilters>(pre?.filters ?? NO_FILTERS);
  const [countChoice, setCountChoice] = useState<CountChoice>(countChoiceOf(pre ? pre.count : 20).choice);
  const [custom, setCustom] = useState(countChoiceOf(pre ? pre.count : 20).custom);
  const [order, setOrder] = useState<OrderMode>(pre?.order ?? 'random');
  const [correction, setCorrection] = useState<CorrectionMode>(pre?.correction ?? 'immediate');
  const correctionTouched = useRef(false);
  const [timerMode, setTimerMode] = useState<TimerChoice>(pre?.timer?.mode ?? 'off');
  const initialLimit = pre?.timer?.limitSec ? String(Math.round(pre.timer.limitSec / 60)) : '10';
  const [limitChoice, setLimitChoice] = useState<LimitChoice>(['5', '10', '15', '30'].includes(initialLimit) ? (initialLimit as LimitChoice) : 'custom');
  const [limitCustom, setLimitCustom] = useState(initialLimit);
  /** Lot 3B : temps limité en entraînement (pause possible) ou en simulation d'examen (sans pause) */
  const [limitUsage, setLimitUsage] = useState<'training' | 'exam'>(pre?.timer?.pausable ? 'training' : 'exam');
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  /** v0.3.0-a2 : lancement refusé car la sélection a changé ; actualisation de l'aperçu en cours, réussie ou en échec */
  const [refresh, setRefresh] = useState<{ reason: string; library: LibraryReload } | null>(null);

  // Le périmètre « à refaire » n'est utilisé qu'une fois
  useEffect(() => {
    if (pendingConfig) setPendingConfig(null);
    // une seule fois, au montage
  }, []);

  // Sans test à refaire : reprise des derniers réglages de déroulement (nombre, ordre, correction, chronomètre)
  useEffect(() => {
    if (pre) return;
    let alive = true;
    Promise.all([getSetting<TestConfig | null>(db, LAST_CONFIG_KEY, null).catch(() => null), loadCorrectionPref(db).catch(() => 'immediate' as const)])
      .then(([last, pref]) => {
        if (!alive) return;
        // Switch V3 : la préférence explicite de Plus › Tests libres est toujours appliquée, jamais la correction du dernier test
        if (!correctionTouched.current) setCorrection(pref);
        if (!last) return;
        const c = countChoiceOf(last.count);
        setCountChoice(c.choice);
        setCustom(c.custom);
        setOrder(last.order);
        setTimerMode(last.timer?.mode ?? 'off');
        setLimitUsage(last.timer?.pausable ? 'training' : 'exam');
        if (last.timer?.limitSec) {
          const m = String(Math.round(last.timer.limitSec / 60));
          setLimitChoice(['5', '10', '15', '30'].includes(m) ? (m as LimitChoice) : 'custom');
          setLimitCustom(m);
        }
      })
      .catch(() => undefined); // simple confort : les valeurs par défaut restent valables
    return () => {
      alive = false;
    };
  }, [db]);

  const scopeLabel = scope ? scopeLabelOf(scope, tax) : '';
  const scoped = useMemo(() => (scope ? resolveScope(scope, tax, metas) : []), [scope, tax, metas]);
  const options = useMemo(() => filterOptions(scoped, states), [scoped, states]);
  const filterSet = { format, filters };
  const { eligible, emptyReason, culprits, statesUnavailable } = applyTestFilters(scoped, filterSet, states);
  const nMcq = scoped.filter((m) => m.formatQuestion === 'mcq').length;
  const nOpen = scoped.length - nMcq;
  const advancedActive = filters.difficulties.length + filters.types.length + filters.statuses.length > 0;
  // Refonte (Test libre V3) : matières et notions de la sélection, monogrammes cohérents avec la bibliothèque
  const monos = useMemo(() => monogramsFor(tax.root.children.map((c) => c.label)), [tax]);
  const subjects = useMemo(() => {
    const set = new Set(scoped.map((m) => m.matiere));
    const ordered = tax.root.children.map((c) => c.label).filter((l) => set.has(l));
    return [...ordered, ...[...set].filter((l) => !ordered.includes(l))];
  }, [scoped, tax]);
  const notionCount = useMemo(() => new Set(scoped.map((m) => pathKeyOf(m))).size, [scoped]);
  const [showAllSubjects, setShowAllSubjects] = useState(false);
  const [lastTimerMode, setLastTimerMode] = useState<'elapsed' | 'limit'>(timerMode === 'limit' ? 'limit' : 'elapsed');
  useEffect(() => {
    if (timerMode !== 'off') setLastTimerMode(timerMode);
  }, [timerMode]);
  const isRootScope = scope?.kind === 'node' && scope.nodeId === ROOT_ID;

  const requested: number | null =
    countChoice === 'all' ? null : countChoice === 'custom' ? Math.max(1, Math.floor(Number(custom) || 0)) : Number(countChoice);
  const finalCount = effectiveCount(requested, eligible.length);
  const customInvalid = countChoice === 'custom' && !(Number(custom) >= 1);
  const limitMinutes = limitChoice === 'custom' ? Number(limitCustom) : Number(limitChoice);
  const limitInvalid = timerMode === 'limit' && !(limitMinutes >= 1 && limitMinutes <= 600);

  const fromHome = scope?.kind === 'node' && scope.nodeId === ROOT_ID && !route.query.get('from');
  const back = fromHome ? '#/' : scope?.kind === 'node' ? libraryHref(scope.nodeId) : () => window.history.back();
  const backLabel = fromHome ? 'Accueil' : scope?.kind === 'node' ? 'Bibliothèque' : 'Retour';

  if (!scope) {
    return (
      <div className="page">
        <TopBar title="Lancer un test" back="#/" />
        <p className="notice">La sélection a expiré (page rechargée). Relancez-la depuis la recherche ou le bilan du test.</p>
      </div>
    );
  }

  const toggle = <K extends keyof TestFilters>(key: K, value: TestFilters[K][number]) =>
    setFilters((f) => {
      const list = f[key] as string[];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      return { ...f, [key]: next };
    });

  const clearDimension = (dim: (typeof culprits)[number]['dimension']) => {
    if (dim === 'format') setFormat('all');
    else setFilters((f) => ({ ...f, [dim]: [] }));
  };

  const config: TestConfig = {
    count: requested,
    format,
    order,
    filters,
    correction,
    timer:
      timerMode === 'limit'
        ? { mode: 'limit', limitSec: Math.round(limitMinutes * 60), ...(limitUsage === 'training' ? { pausable: true } : {}) }
        : { mode: timerMode },
  };

  /** Recharge la bibliothèque (et, par conséquent, les statuts de maîtrise) ; voir previewRefreshPhase. */
  const refreshPreview = (reason: string) => {
    setRefresh({ reason, library: { status: 'loading' } });
    review.reload();
    reload().then(
      () => setRefresh((r) => r && { ...r, library: { status: 'done' } }),
      (e: unknown) => setRefresh((r) => r && { ...r, library: { status: 'failed', error: e instanceof Error ? e.message || e.name : String(e) } }),
    );
  };
  const refreshState = refresh ? previewRefreshPhase(refresh.library, review, metas) : null;
  const refreshPending = refreshState !== null && refreshState.phase !== 'done';

  const start = async () => {
    if (eligible.length === 0 || customInvalid || limitInvalid || busy || refreshPending) return;
    setRefresh(null);
    setBusy(true);
    setStartError(null);
    try {
      const running = await getInProgressSessions(db);
      if (running.length > 0 && !confirmReplace(running)) {
        setBusy(false);
        return;
      }
      const ids = drawCards(eligible, config);
      const session = createSession(scope, scopeLabel, config, ids);
      const expectedEligible = eligible.map((m) => m.cardId);
      // Une seule transaction : revalidation de la sélection (v0.3.0-a1, I2), abandon des séances confirmées
      // et création du test (B2) ; si une autre séance est apparue entre-temps, nouvelle confirmation (v0.2.2)
      let confirmed = running.map((s) => s.sessionId);
      for (let attempt = 0; ; attempt++) {
        const res = await startTestSession(db, { session, expectedEligible, confirmedReplace: confirmed });
        if (res.status === 'started') break;
        if (res.status === 'changed') {
          // Rien n'a été écrit. L'aperçu est actualisé d'après la base ; l'actualisation n'est annoncée qu'une fois
          // réussie (v0.3.0-a2), l'utilisatrice relance ensuite en connaissance de cause
          setBusy(false);
          refreshPreview(res.reason);
          return;
        }
        if (attempt >= 3) throw new Error('les séances en cours changent sans cesse');
        if (!confirmReplace(res.running, true)) {
          setBusy(false);
          setStartError("Aucun test n'a été lancé : la séance ouverte entre-temps est conservée.");
          return;
        }
        confirmed = res.running.map((r) => r.sessionId);
      }
      // Confort : derniers réglages de déroulement et dernier niveau (accueil) ; un échec ici ne bloque pas le test
      await setSetting(db, LAST_CONFIG_KEY, { count: requested, format: 'all', order, correction, timer: config.timer }).catch(() => undefined);
      if (scope.kind === 'node') await setSetting(db, 'lastScope', { nodeId: scope.nodeId, label: scopeLabel }).catch(() => undefined);
      navigate(`test/run/${session.sessionId}`, undefined, true);
    } catch (e) {
      setBusy(false);
      setStartError(
        `Le test n'a pas pu être créé (${e instanceof Error ? e.message || e.name : String(e)}). Aucun test en cours n'a été modifié. Vous pouvez réessayer.`,
      );
    }
  };

  if (picking) {
    const initialIds = scope.kind === 'node' ? [scope.nodeId] : scope.kind === 'multi' ? scope.nodeIds : [];
    return (
      <div className="page">
        <TopBar title="Périmètre du test" back={() => setPicking(false)} />
        <ScopePicker
          tax={tax}
          initial={initialIds}
          onCancel={() => setPicking(false)}
          onConfirm={(ids) => {
            setScope(ids.length === 1 ? { kind: 'node', nodeId: ids[0]! } : { kind: 'multi', nodeIds: ids });
            setPicking(false);
          }}
        />
      </div>
    );
  }

  const diffLabel = (v: string) => (v === UNSET ? 'Non renseignée' : v);
  const typeLabel = (v: string) => (v === UNSET ? 'Non renseigné' : v);
  const timerOn = timerMode !== 'off';
  const formatSummary = format === 'all' ? 'QCM et ouvertes' : format === 'mcq' ? 'QCM' : 'Questions ouvertes';
  const timerSummary =
    timerMode === 'off'
      ? 'Sans chronomètre'
      : timerMode === 'elapsed'
        ? 'Temps écoulé'
        : `${limitInvalid ? '?' : limitMinutes} min · ${limitUsage === 'exam' ? 'Examen' : 'Entraînement'}`;
  const shownSubjects = subjects.slice(0, CHIP_LIMIT);
  const hiddenCount = subjects.length - shownSubjects.length;

  if (metas.length === 0) {
    return (
      <div className="page">
        <TopBar title="Test libre" back={back} backLabel={backLabel} lead="Entraînez-vous sur les cartes de votre choix." />
        <section className="card-block empty-panel">
          <h2 className="section-title">Votre bibliothèque est vide</h2>
          <p className="muted">Importez vos premières cartes pour préparer un test libre.</p>
          <a className="btn secondary block" href="#/import">
            Accéder à l'import
          </a>
        </section>
      </div>
    );
  }

  return (
    <div className="page with-action-bar test-setup">
      <TopBar title="Test libre" back={back} backLabel={backLabel} lead="Entraînez-vous sur les cartes de votre choix." />

      <div className="section-top">
        <h2>Votre sélection</h2>
        {scope.kind !== 'cards' && (
          <button type="button" className="link-btn" onClick={() => setPicking(true)}>
            Modifier
            <Icon name="arrow" />
          </button>
        )}
      </div>
      <section className="scope-card" aria-live="polite">
        <p className="scope-eyebrow">Cartes pour votre test</p>
        <p className="scope-figure">
          <strong className={eligible.length === 0 ? 'scope-number empty' : 'scope-number'}>{eligible.length}</strong>
          <span className="scope-unit">{eligible.length > 1 ? 'cartes disponibles' : 'carte disponible'}</span>
        </p>
        {!isRootScope && <p className="scope-label break">{scopeLabel}</p>}
        <p className="scope-meta">
          <span>
            <b>{subjects.length}</b> {subjects.length > 1 ? 'matières' : 'matière'}
          </span>
          <span>
            <b>{notionCount}</b> {notionCount > 1 ? 'notions' : 'notion'}
          </span>
          {eligible.length < scoped.length && !statesUnavailable && (
            <span>
              <b>{scoped.length}</b> dans la sélection
            </span>
          )}
        </p>
        {subjects.length > 0 && (
          <div className="monowrap">
            {shownSubjects.map((m) => (
              <span key={m} className="mono-chip" title={m}>
                <span aria-hidden="true">{monos.get(m) ?? monogramOf(m)}</span>
                <span className="sr-only">{m}</span>
              </span>
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                className="mono-chip more"
                aria-expanded={showAllSubjects}
                aria-controls="scope-subjects"
                aria-label={showAllSubjects ? 'Masquer les matières' : `Afficher les ${subjects.length} matières`}
                onClick={() => setShowAllSubjects((v) => !v)}
              >
                +{hiddenCount}
              </button>
            )}
          </div>
        )}
        {showAllSubjects && (
          <ul id="scope-subjects" className="subject-reveal">
            {subjects.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        {statesUnavailable ? (
          <div className="scope-problem">
            <p className="notice" role="status">
              {statesStatus === 'error'
                ? 'Les statuts de maîtrise sont illisibles : impossible de sélectionner les cartes selon ce critère.'
                : 'Chargement des statuts de maîtrise… La sélection sera disponible dans un instant.'}
            </p>
            <button type="button" className="btn secondary block" onClick={() => setFilters((f) => ({ ...f, statuses: [] }))}>
              Retirer le filtre « statut de maîtrise »
            </button>
          </div>
        ) : (
          eligible.length === 0 && (
            <div className="scope-problem">
              <p className="notice error">{emptyReason}</p>
              {culprits.length > 0 && (
                <div className="culprit-list">
                  {culprits.map((c) => (
                    <button key={c.dimension} type="button" className="btn secondary block" onClick={() => clearDimension(c.dimension)}>
                      Retirer le filtre « {c.label} » ({plural(c.countWithout, 'carte', 'cartes')})
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </section>

      <div className="section-top">
        <h2>Type de questions</h2>
      </div>
      <div className="seg-grid cols-3">
        <Segmented
          label="Type de questions"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'all', label: 'Mélange' },
            { value: 'mcq', label: 'QCM', disabled: nMcq === 0 && format !== 'mcq' },
            { value: 'open', label: 'Ouvertes', disabled: nOpen === 0 && format !== 'open' },
          ]}
        />
      </div>

      <div className="section-top">
        <h2>Nombre de cartes</h2>
      </div>
      <div className="seg-grid cols-4">
        <Segmented
          label="Nombre de cartes"
          value={countChoice}
          onChange={setCountChoice}
          options={[
            { value: '10', label: '10' },
            { value: '20', label: '20' },
            { value: '30', label: '30' },
            { value: 'all', label: 'Toutes' },
          ]}
        />
      </div>
      <div className={countChoice === 'custom' ? 'custom-row selected' : 'custom-row'}>
        <label htmlFor="custom-count">Choisir un autre nombre</label>
        <input
          id="custom-count"
          className="input"
          type="number"
          inputMode="numeric"
          min={1}
          value={custom}
          aria-invalid={customInvalid}
          onFocus={() => setCountChoice('custom')}
          onChange={(e) => {
            setCountChoice('custom');
            setCustom(e.target.value);
          }}
        />
      </div>
      <p className="help">
        {customInvalid
          ? 'Indiquez un nombre de cartes supérieur ou égal à 1.'
          : eligible.length === 0
            ? 'Aucune carte disponible avec ces choix.'
            : `${plural(finalCount, 'carte prévue', 'cartes prévues')} pour cette séance.`}
      </p>
      {requested !== null && requested > eligible.length && eligible.length > 0 && (
        <p className="notice slim">
          Vous avez demandé {requested} questions mais seules {eligible.length} sont disponibles : le test en contiendra {eligible.length}.
        </p>
      )}

      <div className="section-top">
        <h2>Chronomètre</h2>
      </div>
      <div className="setting-line">
        <div>
          <b>Activer le chronomètre</b>
          <small>Suivre le temps ou fixer une limite</small>
        </div>
        <Switch label="Activer le chronomètre" checked={timerOn} onChange={(on) => setTimerMode(on ? lastTimerMode : 'off')} />
      </div>
      {timerOn && (
        <div className="time-reveal">
          <h3 className="sub-label">Mode de chronométrage</h3>
          <div className="seg-grid cols-2">
            <Segmented
              label="Mode de chronométrage"
              value={timerMode}
              onChange={setTimerMode}
              options={[
                { value: 'elapsed', label: 'Temps écoulé' },
                { value: 'limit', label: 'Temps limité' },
              ]}
            />
          </div>
          {timerMode === 'elapsed' && <p className="help">Vous pourrez mettre le test en pause ; seul le temps où l'application est affichée est compté.</p>}
          {timerMode === 'limit' && (
            <>
              <h3 className="sub-label">Durée du test</h3>
              <div className="seg-grid cols-5">
                <Segmented
                  label="Durée du test"
                  value={limitChoice}
                  onChange={setLimitChoice}
                  options={[
                    { value: '5', label: '5 min' },
                    { value: '10', label: '10 min' },
                    { value: '15', label: '15 min' },
                    { value: '30', label: '30 min' },
                    { value: 'custom', label: 'Autre' },
                  ]}
                />
              </div>
              {limitChoice === 'custom' && (
                <div className="custom-row selected">
                  <label htmlFor="custom-duration">Durée en minutes</label>
                  <input
                    id="custom-duration"
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={600}
                    value={limitCustom}
                    aria-invalid={limitInvalid}
                    onChange={(e) => setLimitCustom(e.target.value)}
                  />
                </div>
              )}
              <h3 className="sub-label">Conditions du test</h3>
              <div className="seg-grid cols-2">
                <Segmented
                  label="Conditions du test"
                  value={limitUsage}
                  onChange={setLimitUsage}
                  options={[
                    { value: 'training', label: 'Entraînement (pause possible)' },
                    { value: 'exam', label: "Simulation d'examen" },
                  ]}
                />
              </div>
              <p className="help">
                {limitUsage === 'exam'
                  ? "Temps continu, aucune pause pendant l'épreuve : le compte à rebours continue même si l'application est fermée ou le téléphone verrouillé."
                  : 'Le temps s’arrête pendant la pause (la question est alors masquée). Hors pause, le compte à rebours continue même application fermée.'}{' '}
                À la fin du temps, le test s'arrête ; les questions restantes sont comptées comme non traitées.
              </p>
            </>
          )}
        </div>
      )}

      <div className="section-top">
        <h2>Déroulement</h2>
      </div>
      <div className="setting-line">
        <div>
          <b>Ordre aléatoire</b>
          <small>{order === 'random' ? 'Mélanger les questions' : 'Questions dans l’ordre de la bibliothèque'}</small>
        </div>
        <Switch label="Ordre aléatoire" checked={order === 'random'} onChange={(on) => setOrder(on ? 'random' : 'library')} />
      </div>
      <div className="correction-setting">
        <b>Correction des réponses</b>
        <small>Choisissez quand voir les bonnes réponses.</small>
        <div className="seg-grid cols-2">
          <Segmented
            label="Correction des réponses"
            value={correction}
            onChange={(v) => {
              correctionTouched.current = true; // choix ponctuel pour ce test, la préférence de Plus ne change pas
              setCorrection(v);
            }}
            options={[
              { value: 'immediate', label: 'Après chaque question' },
              { value: 'end', label: 'À la fin du test' },
            ]}
          />
        </div>
        {correction === 'end' && (
          <p className="help">Les réponses des QCM sont enregistrées sans être corrigées ; les questions ouvertes s'autoévaluent à la fin.</p>
        )}
      </div>

      <details className="advanced-filters" open={advancedActive}>
        <summary>
          <span>
            <b>
              Filtres avancés
              {advancedActive &&
                (() => {
                  const n = activeDimensions(filterSet).filter((d) => d !== 'format').length;
                  return ` (${n} ${n > 1 ? 'actifs' : 'actif'})`;
                })()}
            </b>
            <small>Difficulté, type pédagogique et maîtrise</small>
          </span>
          <Icon name="chevron" />
        </summary>
        <div className="facets">
          <p className="help">Plusieurs choix d'un même filtre s'additionnent ; des filtres différents se cumulent. Aucun choix = pas de filtre.</p>
          <h4 className="sub-label">Difficulté</h4>
          <ChipGroup
            label="Difficulté"
            options={options.difficulties.map((o) => ({ value: o.value, label: diffLabel(o.value), count: o.count }))}
            selected={filters.difficulties}
            onToggle={(v) => toggle('difficulties', v)}
          />
          <h4 className="sub-label">Type pédagogique</h4>
          <ChipGroup
            label="Type pédagogique"
            options={options.types.map((o) => ({ value: o.value, label: typeLabel(o.value), count: o.count }))}
            selected={filters.types}
            onToggle={(v) => toggle('types', v)}
          />
          <h4 className="sub-label">Statut de maîtrise</h4>
          {options.statuses ? (
            <ChipGroup<MasteryBucket>
              label="Statut de maîtrise"
              options={options.statuses.map((o) => ({ value: o.value, label: MASTERY_LABELS[o.value], count: o.count }))}
              selected={filters.statuses}
              onToggle={(v) => toggle('statuses', v)}
            />
          ) : statesStatus === 'error' ? (
            <ErrorNotice
              message={`Les statuts de maîtrise n'ont pas pu être lus (${review.error}). Ce filtre est indisponible ; les autres restent utilisables.`}
              onRetry={review.reload}
            />
          ) : (
            <p className="muted small" role="status">
              Chargement des statuts de maîtrise…
            </p>
          )}
          {advancedActive && (
            <button type="button" className="btn ghost block" onClick={() => setFilters(NO_FILTERS)}>
              Retirer ces filtres
            </button>
          )}
        </div>
      </details>

      <section className="summary-inline" aria-label="Résumé des réglages">
        <span className="summary-label">Votre séance</span>
        <span>
          <strong>{plural(eligible.length === 0 ? 0 : finalCount, 'carte', 'cartes')}</strong> · {formatSummary} · {timerSummary} ·{' '}
          {correction === 'end' ? 'Correction à la fin' : 'Correction immédiate'}
        </span>
        <span>Vos réponses mettent à jour la mémorisation des cartes, selon leur échéance.</span>
      </section>

      {startError && <ErrorNotice message={startError} />}
      {refresh && refreshState && (
        refreshState.phase === 'failed' ? (
          <ErrorNotice
            message={`Les cartes ont été modifiées depuis l'affichage de cet écran (${refresh.reason}). Aucun test n'a été lancé. L'aperçu n'a pas pu être actualisé (${refreshState.error}) : réessayez avant de relancer.`}
            onRetry={() => refreshPreview(refresh.reason)}
            retryLabel="Actualiser l'aperçu"
          />
        ) : (
          <p className="notice" role="status">
            Les cartes ont été modifiées depuis l'affichage de cet écran ({refresh.reason}). Aucun test n'a été lancé.{' '}
            {refreshState.phase === 'loading' ? "Actualisation de l'aperçu…" : "L'aperçu a été actualisé : vérifiez-le puis relancez."}
          </p>
        )
      )}

      <div className="action-bar">
        <button
          type="button"
          className="btn primary block start-test"
          disabled={eligible.length === 0 || customInvalid || limitInvalid || busy || refreshPending}
          onClick={() => void start()}
        >
          <span>{busy ? 'Préparation…' : 'Commencer le test'}</span>
          {!busy && (
            <span className="start-count">
              {plural(eligible.length === 0 ? 0 : finalCount, 'carte', 'cartes')}
              <Icon name="arrow" />
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
