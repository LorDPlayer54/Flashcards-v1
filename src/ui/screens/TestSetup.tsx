// Configuration d'un test libre.
// Lot 1 : périmètre prérempli, format, nombre de questions, ordre.
// Lot 3A : périmètre multiple modifiable, filtres de difficulté / type pédagogique / statut de maîtrise,
// explication des résultats vides, correction immédiate ou en fin de test, chronomètre.
import { useEffect, useMemo, useState } from 'react';
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
import { CORRECTION_PREF_KEY, parseCorrectionPref } from '../../settings/preferences';
import { getInProgressSessions, getSetting, setSetting, startTestSession } from '../../storage/repo';
import { ROOT_ID } from '../../taxonomy/tree';
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
import { ChipGroup, confirmReplace, ErrorNotice, plural, Segmented, TopBar } from '../components/common';
import { ScopePicker } from '../components/ScopePicker';
import { libraryHref, navigate, type Route } from '../router';
import { previewRefreshPhase, type LibraryReload } from '../previewRefresh';
import { useReviewData } from '../useReview';

type CountChoice = '10' | '20' | '30' | 'all' | 'custom';
type TimerChoice = 'off' | 'elapsed' | 'limit';
type LimitChoice = '5' | '10' | '15' | '30' | 'custom';

const LAST_CONFIG_KEY = 'lastTestConfig';

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
    Promise.all([getSetting<TestConfig | null>(db, LAST_CONFIG_KEY, null), getSetting<unknown>(db, CORRECTION_PREF_KEY, 'last').catch(() => 'last')])
      .then(([last, prefRaw]) => {
        if (!alive) return;
        // Lot 3B : la préférence de correction (Plus › Tests libres) l'emporte sur le dernier test, sauf « Comme le dernier test »
        const pref = parseCorrectionPref(prefRaw);
        if (pref !== 'last') setCorrection(pref);
        if (!last) return;
        const c = countChoiceOf(last.count);
        setCountChoice(c.choice);
        setCustom(c.custom);
        setOrder(last.order);
        setCorrection(pref !== 'last' ? pref : (last.correction ?? 'immediate'));
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

  const requested: number | null =
    countChoice === 'all' ? null : countChoice === 'custom' ? Math.max(1, Math.floor(Number(custom) || 0)) : Number(countChoice);
  const finalCount = effectiveCount(requested, eligible.length);
  const customInvalid = countChoice === 'custom' && !(Number(custom) >= 1);
  const limitMinutes = limitChoice === 'custom' ? Number(limitCustom) : Number(limitChoice);
  const limitInvalid = timerMode === 'limit' && !(limitMinutes >= 1 && limitMinutes <= 600);

  const back = scope?.kind === 'node' ? libraryHref(scope.nodeId) : () => window.history.back();

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

  return (
    <div className="page with-action-bar">
      <TopBar title="Lancer un test" back={back} />

      <section className="card-block">
        <p className="eyebrow">Périmètre</p>
        <p className="strong break">{scopeLabel}</p>
        <p className="muted">
          {plural(scoped.length, 'carte', 'cartes')} · {nMcq} QCM · {nOpen} ouvertes
        </p>
        {scope.kind !== 'cards' && (
          <button type="button" className="btn secondary block" onClick={() => setPicking(true)}>
            Modifier le périmètre (plusieurs matières ou thèmes possibles)
          </button>
        )}
      </section>

      <section className="field">
        <h3 className="label">Format</h3>
        <Segmented
          label="Format"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'all', label: `Mélange (${scoped.length})` },
            { value: 'mcq', label: `QCM (${nMcq})` },
            { value: 'open', label: `Ouvertes (${nOpen})` },
          ]}
        />
      </section>

      <details className="advanced field" open={advancedActive}>
        <summary>
          Filtres : difficulté, type, statut
          {advancedActive &&
            (() => {
              const n = activeDimensions(filterSet).filter((d) => d !== 'format').length;
              return ` (${n} ${n > 1 ? 'actifs' : 'actif'})`;
            })()}
        </summary>
        <p className="muted small">Plusieurs choix d'un même filtre s'additionnent ; des filtres différents se cumulent. Aucun choix = pas de filtre.</p>
        <h4 className="label">Difficulté</h4>
        <ChipGroup
          label="Difficulté"
          options={options.difficulties.map((o) => ({ value: o.value, label: diffLabel(o.value), count: o.count }))}
          selected={filters.difficulties}
          onToggle={(v) => toggle('difficulties', v)}
        />
        <h4 className="label">Type pédagogique</h4>
        <ChipGroup
          label="Type pédagogique"
          options={options.types.map((o) => ({ value: o.value, label: typeLabel(o.value), count: o.count }))}
          selected={filters.types}
          onToggle={(v) => toggle('types', v)}
        />
        <h4 className="label">Statut de maîtrise</h4>
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
      </details>

      <section className="field">
        <h3 className="label">Nombre de questions</h3>
        <Segmented
          label="Nombre de questions"
          value={countChoice}
          onChange={setCountChoice}
          options={[
            { value: '10', label: '10' },
            { value: '20', label: '20' },
            { value: '30', label: '30' },
            { value: 'all', label: 'Toutes' },
            { value: 'custom', label: 'Autre' },
          ]}
        />
        {countChoice === 'custom' && (
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={1}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-label="Nombre de questions personnalisé"
          />
        )}
      </section>

      <section className="field">
        <h3 className="label">Ordre</h3>
        <Segmented
          label="Ordre"
          value={order}
          onChange={setOrder}
          options={[
            { value: 'random', label: 'Aléatoire' },
            { value: 'library', label: 'Ordre de la bibliothèque' },
          ]}
        />
      </section>

      <section className="field">
        <h3 className="label">Correction</h3>
        <Segmented
          label="Correction"
          value={correction}
          onChange={setCorrection}
          options={[
            { value: 'immediate', label: 'Après chaque question' },
            { value: 'end', label: 'En fin de test' },
          ]}
        />
        {correction === 'end' && (
          <p className="muted small">Les réponses des QCM sont enregistrées sans être corrigées ; les questions ouvertes s'autoévaluent à la fin.</p>
        )}
      </section>

      <section className="field">
        <h3 className="label">Chronomètre</h3>
        <Segmented
          label="Chronomètre"
          value={timerMode}
          onChange={setTimerMode}
          options={[
            { value: 'off', label: 'Aucun' },
            { value: 'elapsed', label: 'Temps écoulé' },
            { value: 'limit', label: 'Temps limité' },
          ]}
        />
        {timerMode === 'elapsed' && <p className="muted small">Vous pourrez mettre le test en pause ; seul le temps où l'application est affichée est compté.</p>}
        {timerMode === 'limit' && (
          <>
            <Segmented
              label="Durée maximale"
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
            {limitChoice === 'custom' && (
              <input
                className="input"
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                value={limitCustom}
                onChange={(e) => setLimitCustom(e.target.value)}
                aria-label="Durée maximale en minutes"
              />
            )}
            <Segmented
              label="Usage du temps limité"
              value={limitUsage}
              onChange={setLimitUsage}
              options={[
                { value: 'training', label: 'Entraînement (pause possible)' },
                { value: 'exam', label: "Simulation d'examen" },
              ]}
            />
            <p className="muted small">
              {limitUsage === 'exam'
                ? "Simulation d'examen : pas de pause ; le compte à rebours continue même si l'application est fermée ou le téléphone verrouillé."
                : "Entraînement : vous pouvez mettre le test en pause (la question est alors masquée). Hors pause, le compte à rebours continue même application fermée."}{' '}
              À la fin du temps, le test s'arrête ; les questions restantes sont comptées comme non traitées.
            </p>
          </>
        )}
      </section>

      <section className="card-block summary-line" aria-live="polite">
        {statesUnavailable ? (
          <>
            <p className="notice" role="status">
              {statesStatus === 'error'
                ? 'Les statuts de maîtrise sont illisibles : impossible de sélectionner les cartes selon ce critère.'
                : 'Chargement des statuts de maîtrise… La sélection sera disponible dans un instant.'}
            </p>
            <button type="button" className="btn secondary block" onClick={() => setFilters((f) => ({ ...f, statuses: [] }))}>
              Retirer le filtre « statut de maîtrise »
            </button>
          </>
        ) : eligible.length === 0 ? (
          <>
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
          </>
        ) : (
          <>
            <p>
              <strong>{plural(eligible.length, 'carte éligible', 'cartes éligibles')}</strong>
              {eligible.length < scoped.length && <span className="muted"> sur {scoped.length} dans le périmètre</span>}
            </p>
            {requested !== null && requested > eligible.length && (
              <p className="notice">
                Vous avez demandé {requested} questions mais seules {eligible.length} sont disponibles : le test en contiendra {eligible.length}.
              </p>
            )}
            <p className="muted">Ce test libre ne modifie aucune échéance de révision.</p>
          </>
        )}
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
          className="btn primary block"
          disabled={eligible.length === 0 || customInvalid || limitInvalid || busy || refreshPending}
          onClick={() => void start()}
        >
          {busy ? 'Préparation…' : `Commencer (${finalCount} ${finalCount > 1 ? 'questions' : 'question'})`}
        </button>
      </div>
    </div>
  );
}
