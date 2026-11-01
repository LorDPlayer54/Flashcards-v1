// Statistiques (refonte V6). Toutes les valeurs sont calculées à partir des données enregistrées sur l'appareil
// (voir statistics/stats.ts et statistics/performance.ts) ; aucune donnée nouvelle n'est stockée.
import { useEffect, useMemo, useState } from 'react';
import { SELF_EVAL_LABELS, type SelfEval, type SessionMode, type TestSession } from '../../domain/types';
import { dayDetail, highlights, MIN_ANSWERS, sortPerformance, subjectPerformance, type SubjectPerformance } from '../../statistics/performance';
import { activity, collectAnswers, levelCounts, resultStats, sessionHistory, weakSpots, type DayActivity } from '../../statistics/stats';
import { nodeProgress } from '../../program/studied';
import { listAllSessions } from '../../storage/repo';
import { currentScopeLabel } from '../../taxonomy/labelMerge';
import { cardsUnder, LEVEL_LABELS, nearestExistingNode, nodePathLabel, ROOT_ID, type TaxNode } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, Icon, Monogram, plural, Ring, TopBar } from '../components/common';
import { monogramsFor } from '../monogram';
import { href, libraryHref, navigate, type Route } from '../router';
import { useReviewData } from '../useReview';

const EVALS: SelfEval[] = ['again', 'hard', 'good', 'easy'];
const pctOf = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const rate = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)} %`);
export const statsHref = (nodeId: string) => href('stats', { n: nodeId === ROOT_ID ? undefined : nodeId });

function dateOf(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}
const fmtDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

/** Bouton de section repliable (chevron vers le haut lorsque déplié). */
function Toggle({ open, onClick, controls, children }: { open: boolean; onClick: () => void; controls: string; children: React.ReactNode }) {
  return (
    <button type="button" className="section-toggle" aria-expanded={open} aria-controls={controls} onClick={onClick}>
      <span>{children}</span>
      <Icon name="chevron" />
    </button>
  );
}

function MoreButton({ shown, total, step, onChange, more, less }: { shown: number; total: number; step: number; onChange: (n: number) => void; more: string; less: string }) {
  if (total <= 3) return null;
  const all = shown >= total;
  return (
    <button type="button" className="list-more" onClick={() => onChange(all ? 3 : Math.min(total, shown + step))}>
      {all ? less : more}
    </button>
  );
}

function PerfMeasures({ p }: { p: SubjectPerformance }) {
  return (
    <div className="perf-measures">
      <div>
        <p className="perf-m-label">
          QCM corrects <b>{rate(p.qcmRate)}</b>
        </p>
        <div className="perf-track">
          <span style={{ width: `${Math.round((p.qcmRate ?? 0) * 100)}%` }} />
        </div>
        <small>{p.mcqTotal ? `${p.mcqCorrect} / ${p.mcqTotal} réponses` : 'Aucun QCM'}</small>
      </div>
      <div>
        <p className="perf-m-label">
          Ouvertes « À revoir » / « Difficile » <b>{rate(p.difficultRate)}</b>
        </p>
        <div className="perf-track difficulty">
          <span style={{ width: `${Math.round((p.difficultRate ?? 0) * 100)}%` }} />
        </div>
        <small>{p.openTotal ? `${p.flagged} / ${p.openTotal} autoévaluations` : 'Aucune question ouverte'}</small>
      </div>
    </div>
  );
}

function PerformanceSection({ rows, monos, compare }: { rows: SubjectPerformance[]; monos: Map<string, string>; compare: boolean }) {
  const [card, setCard] = useState<'strong' | 'weak' | null>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(3);
  const hl = compare ? highlights(rows) : null;
  const ordered = sortPerformance(rows);
  const spot = hl && card ? (card === 'strong' ? hl.strong : hl.weak) : null;
  return (
    <section className="stats-section">
      <h2 className="section-diamond">Performance par matière</h2>
      <p className="section-sub">Indicateur de performance aux exercices : résultats des QCM et autoévaluations des questions ouvertes. Ce n'est pas une mesure de mémorisation.</p>
      {compare &&
        (hl ? (
          <>
            <div className="perf-highlights">
              {(['strong', 'weak'] as const).map((k) => {
                const p = k === 'strong' ? hl.strong : hl.weak;
                return (
                  <button key={k} type="button" className={`perf-feature ${k}`} aria-expanded={card === k} aria-controls="perf-spot" onClick={() => setCard((c) => (c === k ? null : k))}>
                    <span className="perf-top">
                      <span className="perf-kicker">
                        <span className="perf-symbol" aria-hidden="true">
                          {k === 'strong' ? '↗' : '↘'}
                        </span>
                        {k === 'strong' ? 'Point fort' : 'Point faible'}
                      </span>
                      <Icon name="chevron" />
                    </span>
                    <span className="perf-bottom">
                      <strong>{p.subject}</strong>
                      <span className="perf-score">
                        {p.score}
                        <small>/100</small>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {spot && (
              <div id="perf-spot" className="perf-spotlight" aria-live="polite">
                <p className="perf-spotlight-head">
                  <strong>
                    {card === 'strong' ? 'Point fort' : 'Point faible'} · {spot.subject}
                  </strong>
                  <span>Indice {spot.score}/100</span>
                </p>
                <PerfMeasures p={spot} />
              </div>
            )}
          </>
        ) : (
          <p className="perf-empty">La comparaison sera disponible lorsque au moins deux matières compteront {MIN_ANSWERS} réponses ou plus.</p>
        ))}
      {rows.length > 0 ? (
        <>
          <Toggle open={open} onClick={() => setOpen((o) => !o)} controls="perf-details">
            {open ? 'Masquer la liste des matières' : 'Voir les performances par matière'} <small>({rows.length})</small>
          </Toggle>
          {open && (
            <div id="perf-details" className="perf-details">
              {ordered.slice(0, shown).map((p) => (
                <div key={p.subject} className="perf-row">
                  <p className="perf-row-head">
                    <Monogram text={monos.get(p.subject) ?? '?'} size="sm" />
                    <span className="perf-row-name">{p.subject}</span>
                    <span className="perf-row-score">{p.score === null ? `Moins de ${MIN_ANSWERS} réponses` : `Indice ${p.score}/100`}</span>
                  </p>
                  <PerfMeasures p={p} />
                </div>
              ))}
              <MoreButton shown={shown} total={ordered.length} step={5} onChange={setShown} more={`Voir les autres matières (+${ordered.length - shown})`} less="Réduire à 3 matières" />
            </div>
          )}
        </>
      ) : (
        !compare && <p className="perf-empty">Aucune réponse enregistrée pour ce périmètre.</p>
      )}
    </section>
  );
}

function ActivitySection({ facts, today }: { facts: ReturnType<typeof collectAnswers>; today: string }) {
  const [period, setPeriod] = useState<7 | 30>(7);
  const [mode, setMode] = useState<SessionMode>('revision');
  const [selected, setSelected] = useState<string | null>(null);
  const rows: DayActivity[] = useMemo(() => activity(facts, today, period), [facts, today, period]);
  const max = Math.max(1, ...rows.map((r) => r[mode]));
  const sel = selected ? rows.find((r) => r.day === selected) : undefined;
  const detail = sel ? dayDetail(facts, sel.day, mode) : null;
  const what = mode === 'revision' ? 'révisées' : 'travaillées en test libre';
  return (
    <section className="stats-section">
      <div className="activity-top">
        <h2 className="section-diamond">Activité</h2>
        <div className="pills" role="group" aria-label="Période">
          {([7, 30] as const).map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => (setPeriod(p), setSelected(null))}>
              {p} j
            </button>
          ))}
        </div>
      </div>
      <div className="pills" role="group" aria-label="Type de séance">
        {(['revision', 'libre'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
            {m === 'revision' ? 'Révisions' : 'Tests libres'}
          </button>
        ))}
      </div>
      <p className="activity-caption">{mode === 'revision' ? 'Cartes révisées par jour.' : 'Cartes travaillées en test libre par jour.'}</p>
      <div className="day-chart-scroll">
        <div className={`day-chart days-${period}`} role="group" aria-label="Choisir un jour pour voir son activité">
          {rows.map((r, i) => {
            const n = r[mode];
            const h = n === 0 ? 0 : Math.max(3, Math.round((n / max) * 84));
            const d = dateOf(r.day);
            return (
              <button
                key={r.day}
                type="button"
                className="daybtn"
                aria-pressed={selected === r.day}
                aria-label={`${fmtDay.format(d)} : ${plural(n, 'carte', 'cartes')} ${what} ; toucher pour le détail`}
                onClick={() => setSelected((s) => (s === r.day ? null : r.day))}
              >
                <span className="bar-space">
                  <span className="bar-value">{n > 0 ? n : ''}</span>
                  <span className="bar" style={{ height: `${h}px` }} />
                </span>
                <span className="tick" aria-hidden="true">
                  {period === 7 ? LETTERS[d.getDay()] : i % 5 === 0 || r.day === today ? d.getDate() : ' '}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {sel && detail ? (
        <div className="day-detail" aria-live="polite">
          <p className="day-detail-title">
            <strong>{fmtDay.format(dateOf(sel.day))}</strong>
            <button type="button" className="icon-btn" aria-label="Fermer le détail" onClick={() => setSelected(null)}>
              ×
            </button>
          </p>
          <div className="day-detail-grid">
            <div>
              <strong>{detail.answers}</strong>
              <span>{mode === 'revision' ? 'Cartes révisées' : 'Cartes en test libre'}</span>
            </div>
            <div>
              <strong>{detail.sessions}</strong>
              <span>{detail.sessions > 1 ? 'Séances' : 'Séance'}</span>
            </div>
            <div>
              <strong>{detail.mcqTotal ? `${detail.mcqCorrect} / ${detail.mcqTotal}` : '—'}</strong>
              <span>QCM corrects</span>
            </div>
          </div>
          <p className="day-open-title">
            Questions ouvertes <strong>{detail.openTotal}</strong>
          </p>
          <p className="day-open-list">
            {EVALS.map((e) => (
              <span key={e}>
                {SELF_EVAL_LABELS[e]} <b>{detail.open[e]}</b>
              </span>
            ))}
          </p>
        </div>
      ) : (
        <p className="chart-hint">Touchez une barre pour voir les résultats et séances du jour.</p>
      )}
    </section>
  );
}

export function Stats({ route }: { route: Route }) {
  const { db, metas, tax, labelRules, studiedUnits } = useApp();
  const review = useReviewData();
  const nodeId = route.query.get('n') ?? ROOT_ID;
  const node = tax.byId.get(nodeId);
  const [sessions, setSessions] = useState<TestSession[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [weakOpen, setWeakOpen] = useState(true);
  const [weakShown, setWeakShown] = useState(3);
  const [progOpen, setProgOpen] = useState(false);
  const [progShown, setProgShown] = useState(3);
  const [histOpen, setHistOpen] = useState(false);
  const [histShown, setHistShown] = useState(3);

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
  const facts = useMemo(() => {
    const all = sessions ? collectAnswers(sessions) : [];
    return inScope ? all.filter((f) => inScope(f.cardId)) : all;
  }, [sessions, inScope]);
  const subjectOf = useMemo(() => {
    const m = new Map(metas.map((c) => [c.cardId, c.matiere]));
    return (id: string) => m.get(id);
  }, [metas]);
  const perf = useMemo(() => subjectPerformance(facts, subjectOf), [facts, subjectOf]);
  const monos = useMemo(() => monogramsFor(tax.root.children.map((c) => c.label)), [tax]);

  if (!node) return <div className="page center muted">Chargement…</div>;

  const isRoot = node.id === ROOT_ID;
  const scopeSelect = (
    <div className="scope-row">
      <label className="scope-row-label" htmlFor="stats-scope">
        Afficher les résultats de
      </label>
      <span className="scope-select">
        <select id="stats-scope" value={node.id} onChange={(e) => navigate('stats', { n: e.target.value === ROOT_ID ? undefined : e.target.value })}>
          <option value={ROOT_ID}>Toute la bibliothèque</option>
          {tax.root.children.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          {node.kind !== 'root' && node.kind !== 'matiere' && <option value={node.id}>{nodePathLabel(tax, node.id)}</option>}
        </select>
        <Icon name="chevron" />
      </span>
    </div>
  );
  const head = (
    <TopBar
      title="Statistiques"
      back={isRoot ? undefined : libraryHref(node.id)}
      backLabel="Bibliothèque"
      lead="Suivez votre progression au fil des révisions."
    />
  );

  if (metas.length === 0) {
    return (
      <div className="page stats">
        {head}
        <section className="empty-state">
          <h2>Votre bibliothèque est vide</h2>
          <p>Importez vos premières cartes pour commencer à suivre votre progression dans les statistiques.</p>
          <a className="btn secondary block" href="#/library">
            Ouvrir la Bibliothèque
            <Icon name="arrow" />
          </a>
        </section>
      </div>
    );
  }

  const states = review.data?.states;
  const today = review.data?.today;
  const counts = states && today ? levelCounts(scoped, states, today) : null;
  const progress = nodeProgress(tax, node.id, studiedUnits);
  const results = resultStats(facts);
  const weak = weakSpots(facts, tax, { limit: 50 });
  const history = sessions ? sessionHistory(sessions, { inScope, limit: 60 }) : [];
  const children = node.children;
  const childKind = children[0]?.kind;
  const childTitle = isRoot ? 'Progression par matière' : `Progression par ${childKind ? LEVEL_LABELS[childKind].toLowerCase() : 'niveau'}`;
  const noActivity = sessions !== null && facts.length === 0 && (counts?.studied ?? 0) === 0;

  const coverage = (
    <section className="stats-section">
      <h2 className="section-diamond">Programme étudié</h2>
      <div className="coverage">
        <div>
          <p className="coverage-label">Notions étudiées en cours</p>
          <p className="coverage-num">
            {progress.studiedUnits}
            <small> / {progress.totalUnits}</small>
          </p>
          <a className="coverage-link" href={href('program', { n: isRoot ? undefined : node.id })}>
            Mon programme étudié
          </a>
        </div>
        <span role="img" aria-label={`${pctOf(progress.studiedUnits, progress.totalUnits)} % des notions déclarées étudiées`}>
          <Ring ratio={progress.totalUnits ? progress.studiedUnits / progress.totalUnits : 0} />
        </span>
      </div>
    </section>
  );

  const progressList = (n: TaxNode) => {
    const p = nodeProgress(tax, n.id, studiedUnits);
    return (
      <li key={n.id}>
        <a className="progress-row" href={statsHref(n.id)}>
          {n.kind === 'matiere' && <Monogram text={monos.get(n.label) ?? '?'} size="sm" />}
          <span className="progress-main">
            <span className="progress-name">{n.label}</span>
            <span className="progress-caption">
              {p.studiedUnits} sur {p.totalUnits} {p.totalUnits > 1 ? 'notions étudiées' : 'notion étudiée'}
            </span>
            <span className="mini-track">
              <span style={{ width: `${pctOf(p.studiedUnits, p.totalUnits)}%` }} />
            </span>
          </span>
          <strong className="progress-pct">{pctOf(p.studiedUnits, p.totalUnits)} %</strong>
        </a>
      </li>
    );
  };

  return (
    <div className="page stats">
      {head}
      {scopeSelect}
      {coverage}

      {loadError && <ErrorNotice message={`L'historique des séances n'a pas pu être lu : ${loadError}`} onRetry={() => setAttempt((a) => a + 1)} />}
      {!sessions && !loadError && <p className="muted">Chargement…</p>}

      {noActivity && (
        <section className="empty-state">
          <h2>Votre activité commence ici</h2>
          <p>Aucune carte n'a encore été révisée. Les résultats de mémorisation, d'activité et des tests apparaîtront au fil de vos séances.</p>
          <a className="btn secondary block" href="#/review">
            Aller à Réviser
            <Icon name="arrow" />
          </a>
        </section>
      )}

      {sessions && !noActivity && (
        <>
          <PerformanceSection key={node.id} rows={perf} monos={monos} compare={isRoot} />

          <section className="stats-section">
            <div className="priority-head">
              <h2 className="section-diamond">Notions à renforcer</h2>
              {weak.length > 0 && <span className="priority-count">{weak.length > 1 ? `${weak.length} repérées` : '1 repérée'}</span>}
            </div>
            <div className="weak-panel">
              {weak.length === 0 ? (
                <p className="weak-sub">Pas encore assez de réponses : une notion apparaît ici à partir de 3 réponses, dont une erreur.</p>
              ) : (
                <>
                  <p className="weak-sub">Celles qui ont posé le plus de difficultés lors des exercices.</p>
                  {weakOpen && (
                    <ul id="weak-list" className="weak-list">
                      {weak.slice(0, weakShown).map((w) => {
                        const n = tax.byId.get(w.nodeId);
                        return (
                          <li key={w.nodeId}>
                            <a className="weak-item" href={libraryHref(w.nodeId)}>
                              <span className="weak-title">
                                {n?.label ?? w.label}
                                {n && n.label !== w.label && <small>{w.label.split(' › ').slice(0, -1).join(' › ')}</small>}
                              </span>
                              <span className="weak-detail">
                                {w.errors} erreur{w.errors > 1 ? 's' : ''} sur {plural(w.answered, 'réponse', 'réponses')}
                              </span>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {weakOpen && weak.length > 3 && (
                    <button type="button" className="weak-toggle" onClick={() => setWeakShown((s) => (s >= weak.length ? 3 : Math.min(weak.length, s + 5)))}>
                      {weakShown < weak.length ? 'Voir davantage' : 'Réduire la liste'}
                    </button>
                  )}
                  <Toggle open={weakOpen} onClick={() => setWeakOpen((o) => !o)} controls="weak-list">
                    {weakOpen ? 'Masquer les notions' : 'Afficher les notions'}
                  </Toggle>
                  <p className="help">Erreur : QCM faux ou question ouverte autoévaluée « À revoir ».</p>
                </>
              )}
            </div>
          </section>

          {today && <ActivitySection facts={facts} today={today} />}

          <section className="stats-section">
            <h2 className="section-diamond">Résultats des tests</h2>
            <div className="results">
              <div>
                <p className="results-main">QCM · bonnes réponses</p>
                <p className="results-info">
                  {results.mcq.answered ? `${results.mcq.correct} réponses correctes sur ${results.mcq.answered}` : 'Aucun QCM répondu'} · tests libres et révisions
                </p>
              </div>
              <strong className="results-num">{rate(results.mcq.rate)}</strong>
            </div>
            <div className="open-results">
              <p className="open-heading">
                <span className="results-main">Questions ouvertes</span>
                <span className="open-total">{plural(results.open.answered, 'autoévaluation', 'autoévaluations')}</span>
              </p>
              {results.open.answered > 0 && (
                <div
                  className="open-progress"
                  role="img"
                  aria-label={EVALS.map((e) => `${results.open.byEval[e]} ${SELF_EVAL_LABELS[e]}`).join(', ')}
                >
                  {EVALS.filter((e) => results.open.byEval[e] > 0).map((e) => (
                    <span key={e} className={`open-segment ${e}`} style={{ flexGrow: results.open.byEval[e] }} />
                  ))}
                </div>
              )}
              <div className="open-breakdown">
                {EVALS.map((e) => (
                  <div key={e} className="open-stat">
                    <p className="open-figure">
                      <i className={`open-dot ${e}`} aria-hidden="true" />
                      <strong>{results.open.byEval[e]}</strong>
                    </p>
                    <span>{SELF_EVAL_LABELS[e]}</span>
                  </div>
                ))}
              </div>
              <p className="help">Votre appréciation, pas une correction objective.</p>
            </div>
          </section>

          <section className="stats-section">
            <h2 className="section-diamond">Mémorisation</h2>
            {review.error ? (
              <ErrorNotice message={`Les états de mémorisation n'ont pas pu être lus : ${review.error}`} onRetry={review.reload} />
            ) : !counts ? (
              <p className="muted">Chargement…</p>
            ) : (
              <div className="memory">
                {[
                  ['Cartes déjà révisées', counts.studied],
                  ['Cartes maîtrisées', counts.mastered],
                ].map(([label, n]) => (
                  <div key={label} className="memory-row">
                    <div className="memory-main">
                      <p className="memory-label">{label}</p>
                      <p className="memory-detail">
                        {n} sur {plural(counts.cards, 'carte', 'cartes')} {isRoot ? 'de la bibliothèque' : 'de ce périmètre'}
                      </p>
                      <span className="mini-track">
                        <span style={{ width: `${pctOf(Number(n), counts.cards)}%` }} />
                      </span>
                    </div>
                    <strong className="memory-value">{pctOf(Number(n), counts.cards)} %</strong>
                  </div>
                ))}
                <p className="help">
                  {plural(counts.due, 'carte', 'cartes')} à revoir aujourd'hui. Maîtrisée : dernière note Correct ou Facile et intervalle d'au moins 14 jours.
                </p>
              </div>
            )}
          </section>
        </>
      )}

      {children.length > 0 && (
        <section className="stats-section">
          <Toggle open={progOpen} onClick={() => setProgOpen((o) => !o)} controls="progress-list">
            <strong>{childTitle}</strong>
            <small>
              {plural(children.length, childKind ? LEVEL_LABELS[childKind].toLowerCase() : 'niveau', `${childKind ? LEVEL_LABELS[childKind].toLowerCase() : 'niveau'}s`)} ·{' '}
              {progress.studiedUnits} notions étudiées sur {progress.totalUnits}
            </small>
          </Toggle>
          {progOpen && (
            <>
              <ul id="progress-list" className="progress-list">
                {children.slice(0, progShown).map(progressList)}
              </ul>
              <MoreButton
                shown={progShown}
                total={children.length}
                step={5}
                onChange={setProgShown}
                more={`Afficher ${children.length - progShown} autre${children.length - progShown > 1 ? 's' : ''}`}
                less="Réduire la liste"
              />
            </>
          )}
        </section>
      )}

      {sessions && history.length > 0 && (
        <section className="stats-section">
          <Toggle open={histOpen} onClick={() => setHistOpen((o) => !o)} controls="history-list">
            <strong>Historique des séances</strong>
            <small>Dernière séance · {fmtLong.format(new Date(history[0]!.at))}</small>
          </Toggle>
          {histOpen && (
            <>
              <ul id="history-list" className="history-list">
                {history.slice(0, histShown).map((h) => {
                  const target =
                    h.status === 'finished'
                      ? href(`test/summary/${h.sessionId}`)
                      : h.status === 'in_progress'
                        ? href(h.phase === 'correction' ? `test/correction/${h.sessionId}` : `test/run/${h.sessionId}`)
                        : undefined;
                  const status =
                    h.status === 'in_progress' ? 'En cours' : h.status === 'abandoned' ? 'Interrompue' : h.mode === 'revision' ? 'Terminée' : 'Terminé';
                  const body = (
                    <>
                      <span className="history-main">
                        <strong>
                          {fmtShort.format(new Date(h.at))} · {h.mode === 'revision' ? 'Révision' : 'Test libre'}
                        </strong>
                        <span>
                          {currentScopeLabel(h, tax, labelRules).replace(/^Révision — /, '')} · {status}
                          {h.mcqAnswered > 0 && ` · QCM ${h.mcqCorrect}/${h.mcqAnswered}`}
                        </span>
                      </span>
                      <span className="history-right">
                        {h.answered}/{plural(h.total, 'carte', 'cartes')}
                      </span>
                    </>
                  );
                  return <li key={h.sessionId}>{target ? <a className="history-row" href={target}>{body}</a> : <div className="history-row">{body}</div>}</li>;
                })}
              </ul>
              <MoreButton shown={histShown} total={history.length} step={5} onChange={setHistShown} more="Afficher les séances suivantes" less="Réduire la liste" />
            </>
          )}
        </section>
      )}
      <p className="muted small center">Calculé à partir des données enregistrées sur cet appareil.</p>
    </div>
  );
}
