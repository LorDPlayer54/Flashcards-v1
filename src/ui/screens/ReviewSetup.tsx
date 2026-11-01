// « Réviser » (lot 2, v1.1.0) : deux parcours sur une même progression de mémorisation.
//  - Révision du jour (par défaut) : tout le programme étudié, sans sélection.
//  - Révision personnalisée : un ou plusieurs niveaux choisis parmi le programme étudié, toutes matières confondues.
// Dans les deux cas, l'algorithme existant (planReview) choisit les cartes : dues et nouvelles dans la limite du quota
// commun. Le programme étudié ne fait que restreindre les cartes candidates (src/program/studied.ts).
import { useMemo, useState } from 'react';
import type { ScopeSpec } from '../../domain/types';
import { planReview, splitDue } from '../../review/queue';
import { localDay } from '../../review/schedule';
import { getInProgressSessions, startReviewSession } from '../../storage/repo';
import { buildTaxonomy, ROOT_ID } from '../../taxonomy/tree';
import { resolveScope, scopeLabelOf } from '../../tests/selection';
import { useApp } from '../AppContext';
import { confirmReplace, ErrorNotice, errorMessage, Icon, TopBar } from '../components/common';
import { ScopePicker } from '../components/ScopePicker';
import { href, libraryHref, navigate, type Route } from '../router';
import { formatDay, useReviewData } from '../useReview';

type Mode = 'daily' | 'custom';
const DAILY_LABEL = 'Programme étudié';

export function ReviewSetup({ route }: { route: Route }) {
  const { db, studied, studiedUnits, reload: reloadLibrary } = useApp();
  const { data, error, reload } = useReviewData();
  const requested = route.query.get('n');
  // Taxonomie réduite au programme étudié : seuls ses niveaux peuvent être choisis en révision personnalisée
  const studiedTax = useMemo(() => buildTaxonomy(studied), [studied]);
  const [mode, setMode] = useState<Mode>(requested && requested !== ROOT_ID ? 'custom' : 'daily');
  const [picked, setPicked] = useState<string[]>(() => (requested && requested !== ROOT_ID ? [requested] : []));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  /** v0.2.1 : la sélection a changé entre l'affichage et le clic ; l'aperçu a été actualisé */
  const [changedNotice, setChangedNotice] = useState<string | null>(null);

  // Niveaux choisis encore présents dans le programme étudié
  const chosen = useMemo(() => picked.filter((id) => studiedTax.byId.has(id)), [picked, studiedTax]);
  const notStudied = picked.length > 0 && chosen.length < picked.length;
  const scope = useMemo<Extract<ScopeSpec, { kind: 'node' | 'multi' }> | null>(
    () =>
      mode === 'daily'
        ? { kind: 'node', nodeId: ROOT_ID }
        : chosen.length === 0
          ? null
          : chosen.length === 1
            ? { kind: 'node', nodeId: chosen[0]! }
            : { kind: 'multi', nodeIds: chosen },
    [mode, chosen],
  );
  const scopeLabel = mode === 'daily' ? DAILY_LABEL : scope ? scopeLabelOf(scope, studiedTax) : '';

  const scoped = useMemo(() => (scope ? (mode === 'daily' ? studied : resolveScope(scope, studiedTax, studied)) : []), [scope, mode, studied, studiedTax]);
  const remaining = data ? data.newRemaining : 0;
  const plan = useMemo(() => (data ? planReview(scoped, data.states, data.today, remaining) : null), [data, scoped, remaining]);
  const split = useMemo(() => (plan && data ? splitDue(plan.due, data.states, data.today) : { overdue: 0, today: 0 }), [plan, data]);

  const back = requested && requested !== ROOT_ID ? libraryHref(requested) : '#/';

  if (error) {
    return (
      <div className="page">
        <TopBar title="Réviser" back={back} />
        <ErrorNotice message={`Impossible de lire les échéances : ${error}`} onRetry={reload} />
      </div>
    );
  }
  if (!data || !plan) return <div className="page center muted">Chargement…</div>;

  const start = async () => {
    if (busy || !scope || plan.queue.length === 0) return;
    setBusy(true);
    setStartError(null);
    setChangedNotice(null);
    try {
      const running = await getInProgressSessions(db);
      if (running.length > 0 && !confirmReplace(running)) {
        setBusy(false);
        return;
      }
      // v0.2.2 (I2) : seules les séances effectivement présentées sont autorisées au remplacement
      let confirmed = running.map((s) => s.sessionId);
      // v0.2.1 / v0.2.2 (I1) : la file affichée est revalidée dans la transaction qui crée la séance
      // (périmètre relu en base, états, quota, date du jour, séances en cours)
      let res = await startReviewSession(db, { nodeId: ROOT_ID, scope, scopeLabel, expectedQueue: plan.queue, confirmedReplace: confirmed, today: localDay() });
      for (let attempt = 0; res.status === 'conflict' && attempt < 3; attempt++) {
        if (!confirmReplace(res.running, true)) {
          setBusy(false);
          setChangedNotice("Aucune séance n'a été lancée : la séance ouverte entre-temps est conservée.");
          return;
        }
        confirmed = res.running.map((r) => r.sessionId);
        res = await startReviewSession(db, { nodeId: ROOT_ID, scope, scopeLabel, expectedQueue: plan.queue, confirmedReplace: confirmed, today: localDay() });
      }
      if (res.status === 'started') {
        navigate(`test/run/${res.session.sessionId}`, undefined, true);
        return;
      }
      setBusy(false);
      if (res.status === 'conflict') {
        setStartError('Les séances en cours changent sans cesse (autre onglet ouvert ?). Fermez les autres onglets puis réessayez.');
        return;
      }
      // Aperçu recalculé sur l'état actuel (bibliothèque et échéances) ; un nouveau clic est nécessaire
      await reloadLibrary().catch(() => undefined);
      reload();
      setChangedNotice(
        res.status === 'empty'
          ? 'Il ne reste plus rien à réviser dans ce périmètre (révisions ou quota utilisés entre-temps, ou changement de jour).'
          : `La sélection a changé depuis son affichage (${res.reason}) : révisions faites ailleurs, cartes ajoutées, déplacées ou supprimées, quota de nouvelles cartes modifié ou changement de jour. Vérifiez l'aperçu actualisé puis touchez à nouveau « Commencer ».`,
      );
    } catch (e) {
      setBusy(false);
      setStartError(`La séance n'a pas pu être créée (${errorMessage(e)}). Aucune séance en cours n'a été modifiée. Vous pouvez réessayer.`);
    }
  };

  if (picking) {
    return (
      <div className="page">
        <TopBar title="Révision personnalisée" back={() => setPicking(false)} />
        <p className="muted small">Seules les notions de votre programme étudié sont proposées.</p>
        <ScopePicker
          tax={studiedTax}
          initial={chosen}
          onCancel={() => setPicking(false)}
          onConfirm={(ids) => {
            setPicked(ids);
            setPicking(false);
            setChangedNotice(null);
          }}
        />
      </div>
    );
  }

  const noProgram = studiedUnits.size === 0 || studied.length === 0;
  const empty = !noProgram && scope !== null && plan.queue.length === 0;
  const total = plan.queue.length;
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : '0%');

  return (
    <div className="page review-setup">
      <TopBar title="Réviser" back={back} backLabel={requested && requested !== ROOT_ID ? 'Bibliothèque' : 'Accueil'} lead="Retrouvez vos cartes au bon moment, selon les notions que vous avez étudiées." />
      {changedNotice && (
        <p className="notice" role="status">
          {changedNotice}
        </p>
      )}

      <div className="mode-tiles review-modes" role="radiogroup" aria-label="Parcours de révision">
        {(
          [
            ['daily', 'Révision du jour', 'Toutes vos notions étudiées'],
            ['custom', 'Personnalisée', 'Choisir plusieurs notions'],
          ] as const
        ).map(([m, title, sub]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={`mode-tile${mode === m ? ' on' : ''}`}
            onClick={() => {
              setMode(m);
              setChangedNotice(null);
            }}
          >
            <span className="mode-icon" aria-hidden="true">
              <Icon name={m === 'daily' ? 'review' : 'stats'} />
            </span>
            <span className="mode-title">{title}</span>
            <span className="mode-sub">{sub}</span>
          </button>
        ))}
      </div>
      <p className="mode-desc">
        {mode === 'daily'
          ? "Retrouvez automatiquement les cartes de vos notions étudiées qu'il est temps de revoir, ainsi que quelques nouvelles cartes à apprendre."
          : 'Concentrez la séance sur une partie de votre programme étudié : une ou plusieurs matières, thèmes ou notions.'}
      </p>

      {noProgram ? (
        <section className="card-block empty-state">
          <p className="strong">Aucune notion n'est encore déclarée étudiée.</p>
          <p className="muted small">Indiquez dans « Mon programme étudié » les matières, thèmes ou notions que vous avez déjà vus en cours.</p>
          <a className="btn primary block" href={href('program')}>
            Définir mon programme étudié
          </a>
          <a className="btn secondary block" href={href('test/setup', { n: requested ?? undefined })}>
            Faire un test libre
          </a>
        </section>
      ) : (
        <>
          {mode === 'custom' && (
            <section className="scope-pick">
              <p className="eyebrow">Périmètre</p>
              <p className="strong break">{scope ? scopeLabel : 'Aucune notion choisie'}</p>
              {notStudied && (
                <p className="notice small">
                  {chosen.length === 0 ? 'Ce niveau ne contient' : 'Une partie des niveaux demandés ne contient'} aucune notion de votre programme
                  étudié.{' '}
                  <a href={href('program', { n: picked.find((id) => !studiedTax.byId.has(id)) })}>Mon programme étudié</a>
                </p>
              )}
              <button type="button" className="btn secondary block" onClick={() => setPicking(true)}>
                {scope ? 'Modifier le périmètre' : 'Choisir des matières, thèmes ou notions'}
              </button>
            </section>
          )}

          {scope && (
            <section className="session-section">
              <h2 className="section-diamond">Votre séance</h2>
              {empty ? (
                <div className="card-block empty-state">
                  <p className="strong">{mode === 'daily' ? 'Vous êtes à jour.' : 'Aucune carte à réviser dans cette sélection.'}</p>
                  <p className="muted small">
                    {plan.nextDueDay
                      ? `Prochaine échéance : ${formatDay(plan.nextDueDay)}.`
                      : scoped.length === 0
                        ? 'Ce périmètre ne contient aucune carte du programme étudié.'
                        : 'Aucune échéance à venir pour l\u2019instant.'}
                    {remaining === 0 && plan.freshAvailable > 0 && ' Le quota de nouvelles cartes du jour est atteint.'}
                  </p>
                  <a className="btn secondary block" href={href('test/setup', { n: requested ?? undefined })}>
                    Faire un test libre
                  </a>
                </div>
              ) : (
                <div className="card-block session-card">
                  <div className="today-head">
                    <p className="today-total">
                      <strong>{total}</strong> {total > 1 ? 'cartes' : 'carte'}
                    </p>
                    <p className="today-origin">{mode === 'daily' ? 'Sur tout votre programme étudié' : scopeLabel}</p>
                  </div>
                  <dl className="today-split">
                    <div>
                      <dt>
                        <span className="split-dot overdue" aria-hidden="true" />
                        En retard
                      </dt>
                      <dd>{split.overdue}</dd>
                    </div>
                    <div>
                      <dt>
                        <span className="split-dot due" aria-hidden="true" />
                        À revoir aujourd'hui
                      </dt>
                      <dd>{split.today}</dd>
                    </div>
                    <div>
                      <dt>
                        <span className="split-dot fresh" aria-hidden="true" />
                        Nouvelles
                      </dt>
                      <dd>{plan.fresh.length}</dd>
                    </div>
                  </dl>
                  <div className="split-bar" aria-hidden="true">
                    {split.overdue > 0 && <span className="overdue" style={{ width: pct(split.overdue) }} />}
                    {split.today > 0 && <span className="due" style={{ width: pct(split.today) }} />}
                    {plan.fresh.length > 0 && <span className="fresh" style={{ width: pct(plan.fresh.length) }} />}
                  </div>
                  {startError && <ErrorNotice message={startError} />}
                  <button type="button" className="btn primary block start-review" disabled={busy} onClick={() => void start()}>
                    {busy ? 'Préparation…' : `Commencer la révision (${total})`}
                    <Icon name="arrow" />
                  </button>
                  <p className="muted small quota-line">
                    Nouvelles cartes du jour : {remaining} sur {data.newPerDay} encore disponibles.
                  </p>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
