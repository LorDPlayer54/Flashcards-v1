// Bilan : justesse des QCM, autoévaluations séparées, erreurs avec explications.
// Lot 3A : bilan approfondi (temps, résultats par matière, thème et difficulté, points faibles du test).
import { useEffect, useMemo, useState } from 'react';
import { SELF_EVAL_LABELS, type Card, type CardMeta, type SelfEval, type TestSession } from '../../domain/types';
import { getCards, getSession } from '../../storage/repo';
import { currentScope, currentScopeLabel } from '../../taxonomy/labelMerge';
import { breakdown, partitionAvailable, summarize, type BreakdownRow } from '../../tests/session';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, formatDuration, Icon, Monogram, plural, TopBar } from '../components/common';
import { monogramOf, monogramsFor } from '../monogram';
import { ROOT_ID } from '../../taxonomy/tree';
import { RichText } from '../components/RichText';
import { href, navigate } from '../router';

export function TestSummary({ sessionId }: { sessionId: string }) {
  const { db, setPendingScope, setPendingConfig, tax, metas, labelRules } = useApp();
  const [session, setSession] = useState<TestSession | null | undefined>(undefined);
  const [errorCards, setErrorCards] = useState<Map<string, Card>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [showWeak, setShowWeak] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    (async () => {
      try {
        const s = await getSession(db, sessionId);
        if (!alive) return;
        setSession(s ?? null);
        if (s) {
          const c = await getCards(db, summarize(s).errorIds);
          if (alive) setErrorCards(new Map(c.map((x) => [x.cardId, x])));
        }
      } catch (e) {
        if (alive) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [db, sessionId, attempt]);

  // I5 : cartes encore présentes dans la bibliothèque (les résultats historiques restent inchangés)
  const existing = useMemo(() => new Set(metas.map((m) => m.cardId)), [metas]);
  const metaById = useMemo(() => new Map(metas.map((m) => [m.cardId, m])), [metas]);

  if (loadError)
    return (
      <div className="page">
        <TopBar title="Bilan du test" back="#/" />
        <ErrorNotice message={`Impossible de charger le bilan : ${loadError}`} onRetry={() => setAttempt((a) => a + 1)} />
      </div>
    );
  if (session === undefined) return <div className="page center muted">Chargement…</div>;
  if (session === null)
    return (
      <div className="page">
        <TopBar title="Bilan" back="#/" />
        <p className="notice">Bilan introuvable.</p>
      </div>
    );

  const sum = summarize(session);
  const errorsSplit = partitionAvailable(sum.errorIds, existing);
  const deletedInTest = partitionAvailable(session.cardIds, existing).missing.length;
  const pct = sum.mcq.answered > 0 ? Math.round((sum.mcq.correct / sum.mcq.answered) * 100) : null;

  const retryErrors = () => {
    if (errorsSplit.available.length === 0) return;
    setPendingScope({ kind: 'cards', cardIds: errorsSplit.available, label: `Erreurs — ${session.scopeLabel}` });
    navigate('test/setup', { from: 'selection' });
  };

  const isRevision = session.mode === 'revision';

  // Lot 4 : niveaux renommés ou fusionnés depuis le test → périmètre actuel correspondant
  const scopeNow = currentScope(session.scope, tax, labelRules);
  const labelNow = currentScopeLabel(session, tax, labelRules);

  const retryScope = () => {
    if (isRevision && scopeNow.kind === 'node') {
      navigate('review', { n: tax.byId.has(scopeNow.nodeId) ? scopeNow.nodeId : undefined });
      return;
    }
    // Lot 3A : mêmes réglages (filtres, nombre, ordre, correction, chronomètre) sur le même périmètre
    if (scopeNow.kind === 'node') {
      if (!tax.byId.has(scopeNow.nodeId)) {
        window.alert("Ce niveau n'existe plus dans la bibliothèque (ses cartes ont été supprimées ou reclassées). Lancez le test depuis la bibliothèque.");
        return;
      }
      if (!isRevision) setPendingConfig(session.config);
      navigate('test/setup', { n: scopeNow.nodeId });
    } else {
      if (!isRevision) setPendingConfig(session.config);
      setPendingScope(scopeNow);
      navigate('test/setup', { from: 'selection' });
    }
  };

  // Bilan V2 : synthèse, résultats QCM, évaluations, points à renforcer, détails repliés, actions
  const EVALS: SelfEval[] = ['again', 'hard', 'good', 'easy'];
  const timed = isRevision || Boolean(session.config.timer && session.config.timer.mode !== 'off');
  const notTreated = Math.max(0, sum.total - sum.answered);
  const mcqWrong = sum.mcq.answered - sum.mcq.correct;
  const openCounts = isRevision ? sum.ratings : sum.open.byEval;
  const evalTotal = EVALS.reduce((n, k) => n + openCounts[k], 0);
  const consolidate = sum.ratings.again + sum.ratings.hard;
  const byTheme = breakdown(session, metaById, (m) => [`${m.matiere}\u001f${m.theme ?? ''}`, m.theme ? `${m.matiere} › ${m.theme}` : m.matiere]);
  const weakAll = byTheme.filter((r) => r.errorRate > 0);
  const weakShown = showWeak ? weakAll : weakAll.slice(0, 2);
  const monos = monogramsFor(tax.root.children.map((c) => c.label));
  const backHref = isRevision ? href('review') : href('test/setup', { n: ROOT_ID });

  return (
    <div className="page with-action-bar summary-v2">
      <TopBar title={isRevision ? 'Bilan des révisions' : 'Bilan du test'} eyebrow="Votre séance" back={backHref} backLabel={isRevision ? 'Réviser' : 'Test libre'} lead={isRevision ? 'Votre séance, en un regard.' : "L'essentiel pour savoir où vous en êtes et quoi retravailler."} />
      {labelNow !== session.scopeLabel && <p className="muted small">Lancé sur « {session.scopeLabel} » (niveau renommé depuis).</p>}

      <section className="sum-hero" aria-label="Synthèse de la séance">
        {isRevision && (
          <p className="sum-status">
            <span className="sum-check" aria-hidden="true">✓</span>
            {session.timedOut ? 'Temps écoulé' : sum.answered === 0 ? 'Aucune carte traitée' : 'Séance terminée'}
          </p>
        )}
        {!isRevision && <p className="sum-eyebrow">Cartes traitées</p>}
        <p className="sum-figure">
          <strong>{sum.answered}</strong>
          <span> / {sum.total}</span>
        </p>
        {isRevision && <p className="sum-unit">{sum.answered > 1 ? 'cartes travaillées' : 'carte travaillée'}</p>}
        {isRevision && (
          <div className="sum-track" aria-hidden="true">
            <span style={{ width: `${sum.total ? (sum.answered / sum.total) * 100 : 0}%` }} />
          </div>
        )}
        <p className="sum-foot">
          <span>
            {isRevision ? <b>{notTreated}</b> : <>{notTreated} </>}
            {plural(notTreated, isRevision ? 'carte non traitée' : 'question non traitée', isRevision ? 'cartes non traitées' : 'questions non traitées').replace(/^\d+ /, isRevision ? ' ' : '')}
          </span>
          {timed && sum.timing.elapsedMs > 0 && (
            <b>
              <span className="sr-only">Durée : </span>
              {formatDuration(sum.timing.elapsedMs)}
            </b>
          )}
        </p>
      </section>
      {!isRevision && session.timedOut && <p className="notice slim">Le test s'est arrêté à la fin du temps imparti.</p>}
      {isRevision && sum.answered === 0 && <p className="notice slim">Aucune réponse n'a été enregistrée : les échéances de vos cartes sont inchangées.</p>}

      {sum.mcq.answered > 0 && (
        <section className="sum-section">
          <div className="sum-head">
            <h2>Résultats QCM</h2>
            <span>{plural(sum.mcq.answered, 'réponse', 'réponses')}</span>
          </div>
          <p className="sum-qcm">
            <strong>{pct}</strong>
            <span className="sum-pct"> % corrects</span>
            <span className="sum-qcm-note">
              {plural(sum.mcq.correct, 'bonne réponse', 'bonnes réponses')} sur {sum.mcq.answered} QCM
            </span>
          </p>
          <div className="sum-bar" role="img" aria-label={`${sum.mcq.correct} corrects, ${mcqWrong} incorrects`}>
            {sum.mcq.correct > 0 && <span className="ok" style={{ flexGrow: sum.mcq.correct }} />}
            {mcqWrong > 0 && <span className="ko" style={{ flexGrow: mcqWrong }} />}
          </div>
          <p className="sum-legend">
            <span><i className="dot ok" aria-hidden="true" /> {sum.mcq.correct} corrects</span>
            <span><i className="dot ko" aria-hidden="true" /> {mcqWrong} incorrects</span>
          </p>
        </section>
      )}

      {evalTotal > 0 && (
        <section className="sum-section">
          <div className="sum-head">
            <h2>{isRevision ? 'Vos évaluations' : 'Questions ouvertes'}</h2>
            <span>{isRevision ? 'Premier passage' : plural(sum.open.answered, 'autoévaluation', 'autoévaluations')}</span>
          </div>
          {!isRevision && <p className="sum-sub">Votre appréciation après avoir consulté la réponse attendue.</p>}
          <div className="sum-bar" role="img" aria-label={EVALS.map((k) => `${openCounts[k]} ${SELF_EVAL_LABELS[k]}`).join(', ')}>
            {EVALS.filter((k) => openCounts[k] > 0).map((k) => (
              <span key={k} className={`ev-${k}`} style={{ flexGrow: openCounts[k] }} />
            ))}
          </div>
          <ul className="sum-evals">
            {EVALS.map((k) => (
              <li key={k}>
                <i className={`dot ev-${k}`} aria-hidden="true" />
                <span>{SELF_EVAL_LABELS[k]}</span>
                <strong>{openCounts[k]}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      {isRevision && consolidate > 0 && (
        <p className="sum-consolidate">
          <b>{plural(consolidate, 'carte à consolider', 'cartes à consolider')}</b>
          <span>Évaluées « À revoir » ou « Difficile »</span>
        </p>
      )}
      {sum.pendingSelfEval > 0 && (
        <p className="muted small">{plural(sum.pendingSelfEval, 'question ouverte n’a', 'questions ouvertes n’ont')} pas été autoévaluée(s).</p>
      )}

      {!isRevision && weakAll.length > 0 && (
        <section className="sum-section">
          <div className="sum-head">
            <h2>Points à renforcer</h2>
            <span>Par thème</span>
          </div>
          <ul className="sum-weak">
            {weakShown.map((w) => {
              const matiere = w.label.split(' › ')[0]!;
              return (
                <li key={w.key}>
                  <Monogram text={monos.get(matiere) ?? monogramOf(matiere)} size="sm" />
                  <span className="sum-weak-main">
                    <b>{w.label.includes(' › ') ? w.label.split(' › ').slice(1).join(' › ') : w.label}</b>
                    <small>{w.label.includes(' › ') ? matiere : ''}</small>
                  </span>
                  <span className="sum-weak-n">{plural(Math.round(w.errorRate * w.answered), 'réponse à retravailler', 'réponses à retravailler')}</span>
                </li>
              );
            })}
          </ul>
          {weakAll.length > 2 && (
            <button type="button" className="text-button" aria-expanded={showWeak} onClick={() => setShowWeak((v) => !v)}>
              {showWeak ? 'Réduire' : `Voir tous les thèmes (${weakAll.length})`}
            </button>
          )}
        </section>
      )}

      <SummaryDetails session={session} metaById={metaById} timing={sum.timing} timed={timed} />
      {deletedInTest > 0 && (
        <p className="notice small">
          {plural(deletedInTest, 'carte de ce test a', 'cartes de ce test ont')} été supprimée{deletedInTest > 1 ? 's' : ''} de la bibliothèque
          depuis. Les résultats ci-dessus restent ceux du test ; ces cartes sont exclues des nouvelles relances.
        </p>
      )}

      {sum.errorIds.length > 0 && (
        <section>
          <h3 className="section-title">Erreurs et cartes « À revoir »</h3>
          <ul className="list">
            {sum.errorIds.map((id) => {
              const c = errorCards.get(id);
              const a = session.answers[id];
              if (!c || !existing.has(id)) {
                return (
                  <li key={id} className="list-row static">
                    <span className="row-main">
                      <span className="muted">Carte supprimée de la bibliothèque</span>
                      <span className="row-sub">
                        {a?.kind === 'mcq' ? `Votre choix : ${a.selectedOptionId})` : 'Autoévaluation : À revoir'} · résultat conservé dans
                        l'historique
                      </span>
                    </span>
                  </li>
                );
              }
              const expanded = open === c.cardId;
              return (
                <li key={c.cardId} className="error-item">
                  <button type="button" className="list-row card-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : c.cardId)}>
                    <span className="row-main">
                      <span className={expanded ? '' : 'clamp'}>{c.question}</span>
                      <span className="row-sub">
                        {a?.kind === 'mcq'
                          ? `Votre choix : ${a.selectedOptionId}) · Bonne réponse : ${c.correctOptionId})`
                          : 'Autoévaluation : À revoir'}
                      </span>
                    </span>
                    <span className="chev" aria-hidden="true">
                      {expanded ? '˄' : '˅'}
                    </span>
                  </button>
                  {expanded && (
                    <div className="error-detail">
                      <h4 className="label">Réponse</h4>
                      <RichText text={c.reponse} />
                      {c.explication && (
                        <>
                          <h4 className="label">Explication</h4>
                          <RichText text={c.explication} />
                        </>
                      )}
                      {c.astucePiege && (
                        <>
                          <h4 className="label">Astuce / Piège</h4>
                          <RichText text={c.astucePiege} />
                        </>
                      )}
                      <a className="link" href={href(`card/${encodeURIComponent(c.cardId)}`)}>
                        Ouvrir la fiche complète
                      </a>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="action-bar summary-actions">
        {isRevision ? (
          <>
            <button type="button" className="btn primary block" onClick={retryScope}>
              Retourner à Réviser
              <Icon name="arrow" />
            </button>
            {sum.errorIds.length > 0 && errorsSplit.available.length > 0 && (
              <button type="button" className="text-button center-link" onClick={retryErrors}>
                {`S'entraîner sur les erreurs, en test libre (${errorsSplit.available.length})`}
              </button>
            )}
          </>
        ) : (
          <>
            {sum.errorIds.length > 0 && errorsSplit.available.length > 0 ? (
              <button type="button" className="btn primary block" onClick={retryErrors}>
                {`Refaire les erreurs (${errorsSplit.available.length})`}
                <Icon name="arrow" />
              </button>
            ) : null}
            <button type="button" className={sum.errorIds.length > 0 && errorsSplit.available.length > 0 ? 'text-button center-link' : 'btn primary block'} onClick={retryScope}>
              Préparer un autre test
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Lot 3A : bilan approfondi ----------

function ResultTable({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  if (rows.length < 2) return null; // un seul groupe : rien à comparer
  return (
    <section className="card-block small">
      <h3 className="label">{title}</h3>
      <table className="result-table">
        <thead>
          <tr>
            <th scope="col">Groupe</th>
            <th scope="col" className="num">
              Traitées
            </th>
            <th scope="col" className="num">
              QCM justes
            </th>
            <th scope="col" className="num">
              « À revoir »
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="num">{r.answered}</td>
              <td className="num">{r.mcqAnswered ? `${r.mcqCorrect}/${r.mcqAnswered}` : '—'}</td>
              <td className="num">{r.openAnswered ? `${r.openAgain}/${r.openAnswered}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SummaryDetails({
  session,
  metaById,
  timing,
  timed,
}: {
  session: TestSession;
  metaById: ReadonlyMap<string, CardMeta>;
  timing: ReturnType<typeof summarize>['timing'];
  timed: boolean;
}) {
  const byMatiere = breakdown(session, metaById, (m) => [m.matiere, m.matiere]);
  const byDifficulty = breakdown(session, metaById, (m) => (m.difficulte ? [m.difficulte, m.difficulte] : null));
  const hasTime = timed && timing.elapsedMs > 0;
  const hasTables = byMatiere.length >= 2 || byDifficulty.length >= 2;
  const [open, setOpen] = useState(false);
  if (!hasTime && !hasTables) return null;
  return (
    <section className="sum-section">
      <button type="button" className="section-toggle" aria-expanded={open} aria-controls="sum-details" onClick={() => setOpen((v) => !v)}>
        <span>
          <strong>Pour aller plus loin</strong>
          <small>{[hasTables && 'Résultats par matière et difficulté', hasTime && 'Temps de la séance'].filter(Boolean).join(' · ')}</small>
        </span>
        <Icon name="chevron" />
      </button>
      {open && (
        <div id="sum-details">
          <ResultTable title="Par matière" rows={byMatiere} />
          <ResultTable title="Par difficulté" rows={byDifficulty} />
          {hasTime && (
            <div className="card-block small">
              <h3 className="label">Temps de la séance</h3>
              <p>
                Temps total : {formatDuration(timing.elapsedMs)}
                {session.config.timer?.budgetSec ? ` (temps prévu : ${Math.round(session.config.timer.budgetSec / 60)} min)` : ''}.{' '}
                {timing.avgMs !== null && <>Temps moyen de réponse : {formatDuration(timing.avgMs)}.</>}
              </p>
              {timing.slowest.length > 0 && (
                <p className="muted">
                  Réponses les plus longues :{' '}
                  {timing.slowest.map((t) => `n° ${session.cardIds.indexOf(t.cardId) + 1} (${formatDuration(t.timeMs)})`).join(', ')}.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
