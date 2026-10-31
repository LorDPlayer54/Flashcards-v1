// Lot 3B : statistiques globales et par niveau (matière, thème, leçon, notion).
// Toutes les valeurs sont calculées à partir des données enregistrées sur l'appareil (voir statistics/stats.ts).
import { useEffect, useMemo, useState } from 'react';
import { SELF_EVAL_LABELS, type SelfEval, type TestSession } from '../../domain/types';
import { activity, childRows, collectAnswers, levelCounts, resultStats, sessionHistory, summarizeActivity, weakSpots, type DayActivity } from '../../statistics/stats';
import { listAllSessions } from '../../storage/repo';
import { currentScopeLabel } from '../../taxonomy/labelMerge';
import { breadcrumb, cardsUnder, LEVEL_LABELS, nearestExistingNode, ROOT_ID } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, plural, TopBar } from '../components/common';
import { href, libraryHref, navigate, type Route } from '../router';
import { useReviewData } from '../useReview';

const EVALS: SelfEval[] = ['again', 'hard', 'good', 'easy'];
const pct = (x: number) => `${Math.round(x * 100)} %`;
export const statsHref = (nodeId: string) => href('stats', { n: nodeId === ROOT_ID ? undefined : nodeId });

function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
}
function weekdayShort(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
}
function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Activité des 7 derniers jours : barres empilées (tests libres / révisions), légende, détail au toucher et tableau. */
function ActivityChart({ rows }: { rows: DayActivity[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.libre + r.revision));
  const sel = rows.find((r) => r.day === selected);
  const describe = (r: DayActivity) =>
    `${longDay(r.day)} : ${plural(r.libre, 'réponse', 'réponses')} en test libre, ${plural(r.revision, 'réponse', 'réponses')} en révision`;
  return (
    <figure className="chart">
      <div className="chart-legend" aria-hidden="true">
        <span>
          <i className="swatch s-libre" /> Tests libres
        </span>
        <span>
          <i className="swatch s-revision" /> Révisions
        </span>
      </div>
      <div className="bars" role="group" aria-label="Réponses par jour, 7 derniers jours">
        {rows.map((r) => {
          const total = r.libre + r.revision;
          return (
            <button
              key={r.day}
              type="button"
              className={`bar-col${selected === r.day ? ' on' : ''}`}
              onClick={() => setSelected((s) => (s === r.day ? null : r.day))}
              title={describe(r)}
              aria-label={describe(r)}
            >
              <span className="bar-area">
                <span className="bar-value">{total > 0 ? total : ''}</span>
                <span className="bar-stack" style={{ height: `${(total / max) * 82}%` }}>
                  {r.revision > 0 && <span className="seg s-revision" style={{ flexGrow: r.revision }} />}
                  {r.libre > 0 && <span className="seg s-libre" style={{ flexGrow: r.libre }} />}
                </span>
              </span>
              <span className="bar-label" aria-hidden="true">
                <span>{weekdayShort(r.day)}</span>
                <span>{Number(r.day.slice(8))}</span>
              </span>
            </button>
          );
        })}
      </div>
      <figcaption className="small" aria-live="polite">
        {sel ? describe(sel) : 'Touchez une barre pour le détail du jour.'}
      </figcaption>
      <details className="small">
        <summary>Voir les chiffres</summary>
        <table className="result-table">
          <thead>
            <tr>
              <th>Jour</th>
              <th>Tests libres</th>
              <th>Révisions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <td>{shortDay(r.day)}</td>
                <td>{r.libre}</td>
                <td>{r.revision}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function Stats({ route }: { route: Route }) {
  const { db, metas, tax, labelRules } = useApp();
  const review = useReviewData();
  const nodeId = route.query.get('n') ?? ROOT_ID;
  const node = tax.byId.get(nodeId);
  const [sessions, setSessions] = useState<TestSession[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    listAllSessions(db)
      .then((s) => alive && setSessions(s))
      .catch((e: unknown) => alive && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [db, attempt]);

  // Niveau disparu (fusion, suppression) : niveau existant le plus proche
  const fallback = node ? null : nearestExistingNode(tax, nodeId);
  useEffect(() => {
    if (fallback !== null) navigate('stats', { n: fallback === ROOT_ID ? undefined : fallback }, true);
  }, [fallback]);

  const scoped = useMemo(() => (node ? cardsUnder(tax, metas, node.id) : []), [tax, metas, node]);
  const inScope = useMemo(() => {
    if (!node || node.id === ROOT_ID) return undefined;
    const ids = new Set(scoped.map((m) => m.cardId));
    return (id: string) => ids.has(id);
  }, [node, scoped]);
  const today = review.data?.today;
  const facts = useMemo(() => {
    const all = sessions ? collectAnswers(sessions) : [];
    return inScope ? all.filter((f) => inScope(f.cardId)) : all;
  }, [sessions, inScope]);

  if (!node) return <div className="page center muted">Chargement…</div>;

  const crumbs = breadcrumb(tax, node.id);
  const states = review.data?.states;
  const counts = states && today ? levelCounts(scoped, states, today) : null;
  const children = states && today ? childRows(node, scoped, tax, states, today) : [];
  const results = resultStats(facts);
  const week = today ? activity(facts, today, 7) : [];
  const month = today ? activity(facts, today, 30) : [];
  const weekSum = summarizeActivity(week, facts);
  const monthSum = summarizeActivity(month, facts);
  const weak = weakSpots(facts, tax);
  const history = sessions ? sessionHistory(sessions, { inScope, limit: 15 }) : [];

  return (
    <div className="page stats">
      <TopBar title="Statistiques" back={node.id === ROOT_ID ? '#/' : libraryHref(node.id)} />
      {crumbs.length > 1 && (
        <nav className="crumbs" aria-label="Fil d'Ariane">
          {crumbs.map((c, i) => (
            <span key={c.id}>
              {i > 0 && <span className="crumb-sep">›</span>}
              {i < crumbs.length - 1 ? <a href={statsHref(c.id)}>{c.id === ROOT_ID ? 'Tout' : c.label}</a> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <section className="level-head">
        <h2>{node.label}</h2>
        <p className="muted">
          {node.id === ROOT_ID ? 'Vue globale' : LEVEL_LABELS[node.kind]} · {plural(scoped.length, 'carte', 'cartes')}
        </p>
      </section>

      <section className="card-block">
        <h3 className="label">Mémorisation (révision programmée)</h3>
        {review.error ? (
          <ErrorNotice message={`Les états de mémorisation n'ont pas pu être lus : ${review.error}`} onRetry={review.reload} />
        ) : !counts ? (
          <p className="muted">Chargement…</p>
        ) : (
          <>
            <div className="stat-tiles">
              <div>
                <strong>{counts.studied}</strong>
                <span>étudiées</span>
              </div>
              <div>
                <strong>{counts.fresh}</strong>
                <span>nouvelles</span>
              </div>
              <div>
                <strong>{counts.due}</strong>
                <span>à revoir aujourd'hui</span>
              </div>
              <div>
                <strong>{counts.mastered}</strong>
                <span>maîtrisées</span>
              </div>
            </div>
            {counts.cards > 0 && (
              <div className="meter" role="img" aria-label={`${pct(counts.mastered / counts.cards)} des cartes maîtrisées, ${pct(counts.studied / counts.cards)} étudiées`}>
                <span className="meter-studied" style={{ width: `${(counts.studied / counts.cards) * 100}%` }} />
                <span className="meter-mastered" style={{ width: `${(counts.mastered / counts.cards) * 100}%` }} />
              </div>
            )}
            {counts.cards > 0 && (
              <p className="muted small">
                {pct(counts.studied / counts.cards)} étudiées · {pct(counts.mastered / counts.cards)} maîtrisées (dernière note Correct ou Facile et
                intervalle d'au moins 14 jours).
              </p>
            )}
          </>
        )}
      </section>

      {children.length > 0 && (
        <section className="card-block">
          <h3 className="label">Par sous-niveau</h3>
          <div className="table-scroll">
            <table className="result-table stats-table">
              <thead>
                <tr>
                  <th>Niveau</th>
                  <th>Cartes</th>
                  <th>
                    <abbr title="Étudiées">Étud.</abbr>
                  </th>
                  <th>
                    <abbr title="À revoir aujourd'hui">Dues</abbr>
                  </th>
                  <th>
                    <abbr title="Maîtrisées">Maîtr.</abbr>
                  </th>
                </tr>
              </thead>
              <tbody>
                {children.map((r) => (
                  <tr key={r.node.id}>
                    <td>
                      <a href={statsHref(r.node.id)}>{r.node.label}</a>
                    </td>
                    <td>{r.counts.cards}</td>
                    <td>{r.counts.studied}</td>
                    <td>{r.counts.due}</td>
                    <td>{r.counts.mastered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {loadError && <ErrorNotice message={`L'historique des séances n'a pas pu être lu : ${loadError}`} onRetry={() => setAttempt((a) => a + 1)} />}
      {sessions && (
        <>
          <section className="card-block">
            <h3 className="label">Résultats (tests libres et révisions)</h3>
            {facts.length === 0 ? (
              <p className="muted">Aucune réponse enregistrée{node.id === ROOT_ID ? '' : ' pour ce niveau'}.</p>
            ) : (
              <>
                <p>
                  <strong>QCM : {results.mcq.rate === null ? '—' : pct(results.mcq.rate)}</strong> de bonnes réponses{' '}
                  <span className="muted">
                    ({results.mcq.correct}/{results.mcq.answered}) · taux objectif
                  </span>
                </p>
                <p className="muted small">
                  Tests libres : {results.byMode.libre.mcqCorrect}/{results.byMode.libre.mcqAnswered} · Révisions : {results.byMode.revision.mcqCorrect}/
                  {results.byMode.revision.mcqAnswered}
                </p>
                <p className="small">
                  <strong>Questions ouvertes</strong> : {plural(results.open.answered, 'autoévaluation', 'autoévaluations')}{' '}
                  <span className="muted">(votre appréciation, pas une correction objective)</span>
                </p>
                <ul className="kv">
                  {EVALS.map((e) => (
                    <li key={e}>
                      <span>{SELF_EVAL_LABELS[e]}</span>
                      <strong>{results.open.byEval[e]}</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="card-block">
            <h3 className="label">Activité</h3>
            {today && <ActivityChart rows={week} />}
            <ul className="kv">
              <li>
                <span>7 derniers jours</span>
                <strong>
                  {plural(weekSum.answers, 'réponse', 'réponses')} · {plural(weekSum.activeDays, 'jour actif', 'jours actifs')}
                </strong>
              </li>
              <li>
                <span>30 derniers jours</span>
                <strong>
                  {plural(monthSum.answers, 'réponse', 'réponses')} · {plural(monthSum.activeDays, 'jour actif', 'jours actifs')} ·{' '}
                  {plural(monthSum.sessions, 'séance', 'séances')}
                </strong>
              </li>
            </ul>
          </section>

          <section className="card-block">
            <h3 className="label">Notions difficiles</h3>
            {weak.length === 0 ? (
              <p className="muted small">Pas encore assez de réponses (au moins 3 par notion, dont une erreur).</p>
            ) : (
              <>
                <ul className="list">
                  {weak.map((w) => (
                    <li key={w.nodeId}>
                      <a className="list-row" href={libraryHref(w.nodeId)}>
                        <span className="row-main">
                          {w.label}
                          <span className="row-sub">
                            {w.errors} erreur{w.errors > 1 ? 's' : ''} sur {plural(w.answered, 'réponse', 'réponses')}
                          </span>
                        </span>
                        <span className="row-count">{pct(w.errorRate)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="muted small">Erreur : QCM faux ou question ouverte autoévaluée « À revoir ». Niveau le plus précis renseigné de chaque carte.</p>
              </>
            )}
          </section>

          <section>
            <h3 className="section-title">Historique des séances</h3>
            {history.length === 0 ? (
              <p className="muted">Aucune séance.</p>
            ) : (
              <ul className="list">
                {history.map((h) => {
                  const target =
                    h.status === 'finished'
                      ? href(`test/summary/${h.sessionId}`)
                      : h.status === 'in_progress'
                        ? href(h.phase === 'correction' ? `test/correction/${h.sessionId}` : `test/run/${h.sessionId}`)
                        : undefined;
                  const body = (
                    <span className="row-main">
                      {h.mode === 'revision' ? 'Révision' : 'Test'} · {currentScopeLabel(h, tax, labelRules).replace(/^Révision — /, '')}
                      <span className="row-sub">
                        {new Date(h.at).toLocaleDateString('fr-FR')} · {h.answered}/{h.total} traitées
                        {h.mcqAnswered > 0 && ` · QCM ${h.mcqCorrect}/${h.mcqAnswered}`}
                        {h.openAnswered > 0 && ` · ${h.again} « À revoir »`}
                        {h.status === 'in_progress' ? ' · en cours' : h.status === 'abandoned' ? ' · interrompue' : ''}
                      </span>
                    </span>
                  );
                  return (
                    <li key={h.sessionId}>
                      {target ? (
                        <a className="list-row" href={target}>
                          {body}
                          <span className="chev" aria-hidden="true">
                            ›
                          </span>
                        </a>
                      ) : (
                        <div className="list-row static">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
      <p className="muted small center">Calculé à partir des données enregistrées sur cet appareil.</p>
    </div>
  );
}
