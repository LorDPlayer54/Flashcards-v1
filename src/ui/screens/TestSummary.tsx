// Bilan : justesse des QCM, autoévaluations séparées, erreurs avec explications.
// Lot 3A : bilan approfondi (temps, résultats par matière, thème et difficulté, points faibles du test).
import { useEffect, useMemo, useState } from 'react';
import { SELF_EVAL_LABELS, type Card, type CardMeta, type SelfEval, type TestSession } from '../../domain/types';
import { getCards, getSession } from '../../storage/repo';
import { currentScope, currentScopeLabel } from '../../taxonomy/labelMerge';
import { breakdown, partitionAvailable, summarize, type BreakdownRow } from '../../tests/session';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, formatDuration, plural, TopBar } from '../components/common';
import { RichText } from '../components/RichText';
import { href, navigate } from '../router';

export function TestSummary({ sessionId }: { sessionId: string }) {
  const { db, setPendingScope, setPendingConfig, tax, metas, labelRules } = useApp();
  const [session, setSession] = useState<TestSession | null | undefined>(undefined);
  const [errorCards, setErrorCards] = useState<Map<string, Card>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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

  return (
    <div className="page">
      <TopBar title={isRevision ? 'Bilan de la révision' : 'Bilan du test'} back="#/" />
      <p className="strong">{labelNow}</p>
      {labelNow !== session.scopeLabel && <p className="muted small">Lancé sur « {session.scopeLabel} » (niveau renommé depuis).</p>}
      {isRevision && (
        <p className="muted small">
          Les prochaines échéances ont été mises à jour à chaque évaluation.
          {sum.repeats.planned > 0 && ` ${plural(sum.repeats.done, 'reprise effectuée', 'reprises effectuées')} sur ${sum.repeats.planned} en fin de séance.`}
        </p>
      )}

      <section className="stats-row">
        <div className="stat">
          <span className="stat-value">
            {sum.answered}/{sum.total}
          </span>
          <span className="stat-label">traitées</span>
        </div>
        <div className="stat">
          <span className="stat-value">{pct === null ? '—' : `${pct} %`}</span>
          <span className="stat-label">
            QCM justes{sum.mcq.answered > 0 ? ` (${sum.mcq.correct}/${sum.mcq.answered})` : ''}
          </span>
        </div>
        <div className="stat">
          <span className="stat-value">{sum.errorIds.length}</span>
          <span className="stat-label">à retravailler</span>
        </div>
      </section>

      {isRevision && sum.answered > 0 && (
        <section className="card-block">
          <h3 className="label">Évaluations de maîtrise (premier passage)</h3>
          <p className="muted small">QCM et questions ouvertes ; elles déterminent les prochaines révisions.</p>
          <ul className="eval-dist">
            {(Object.keys(SELF_EVAL_LABELS) as SelfEval[]).map((k) => (
              <li key={k}>
                <span>{SELF_EVAL_LABELS[k]}</span>
                <strong>{sum.ratings[k]}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isRevision && sum.open.answered > 0 && (
        <section className="card-block">
          <h3 className="label">Questions ouvertes — autoévaluation</h3>
          <p className="muted small">Votre propre appréciation, distincte du score objectif des QCM.</p>
          <ul className="eval-dist">
            {(Object.keys(SELF_EVAL_LABELS) as SelfEval[]).map((k) => (
              <li key={k}>
                <span>{SELF_EVAL_LABELS[k]}</span>
                <strong>{sum.open.byEval[k]}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sum.notAnswered > 0 && <p className="muted">{plural(sum.notAnswered, 'question non traitée', 'questions non traitées')}.</p>}
      {session.timedOut && <p className="notice small">Le test s'est arrêté à la fin du temps imparti.</p>}
      {sum.pendingSelfEval > 0 && (
        <p className="muted small">{plural(sum.pendingSelfEval, 'question ouverte n’a', 'questions ouvertes n’ont')} pas été autoévaluée(s).</p>
      )}

      {!isRevision && <DeepSummary session={session} metaById={metaById} timing={sum.timing} />}
      {deletedInTest > 0 && (
        <p className="notice small">
          {plural(deletedInTest, 'carte de ce test a', 'cartes de ce test ont')} été supprimée{deletedInTest > 1 ? 's' : ''} de la bibliothèque
          depuis. Les résultats ci-dessus restent ceux du test ; ces cartes sont exclues des nouvelles relances.
        </p>
      )}

      <div className="button-stack">
        {sum.errorIds.length > 0 && (
          <button type="button" className="btn primary block" onClick={retryErrors} disabled={errorsSplit.available.length === 0}>
            {errorsSplit.available.length === 0
              ? 'Refaire les erreurs (cartes supprimées)'
              : isRevision
                ? `S'entraîner sur les erreurs, en test libre (${errorsSplit.available.length})`
                : `Refaire les erreurs (${errorsSplit.available.length})`}
          </button>
        )}
        <button type="button" className="btn secondary block" onClick={retryScope}>
          {isRevision ? 'Retour à la révision de ce périmètre' : 'Refaire un test sur ce périmètre'}
        </button>
      </div>

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

function DeepSummary({
  session,
  metaById,
  timing,
}: {
  session: TestSession;
  metaById: ReadonlyMap<string, CardMeta>;
  timing: ReturnType<typeof summarize>['timing'];
}) {
  const byMatiere = breakdown(session, metaById, (m) => [m.matiere, m.matiere]);
  const byTheme = breakdown(session, metaById, (m) => [`${m.matiere}\u001f${m.theme ?? ''}`, m.theme ? `${m.matiere} › ${m.theme}` : m.matiere]);
  const byDifficulty = breakdown(session, metaById, (m) => (m.difficulte ? [m.difficulte, m.difficulte] : null));
  const weak = byTheme.filter((r) => r.errorRate > 0).slice(0, 3);
  // v0.3.0-a1 (M1) : aucune durée n'est présentée si l'utilisatrice a choisi « Aucun » chronomètre
  // (y compris pour les tests de la v0.3.0-a qui enregistraient des durées dans ce mode)
  const timed = Boolean(session.config.timer && session.config.timer.mode !== 'off');
  return (
    <>
      {timed && (
        <section className="card-block small">
          <h3 className="label">Temps</h3>
          <p>
            Temps total : {formatDuration(timing.elapsedMs)}.{' '}
            {timing.avgMs !== null && <>Temps moyen de réponse : {formatDuration(timing.avgMs)}.</>}
          </p>
          {timing.avgMs !== null && (
            <p className="muted">Temps de réponse : de l'affichage de la question à la validation (lecture de la correction non comprise).</p>
          )}
          {timing.slowest.length > 0 && (
            <p className="muted">
              Réponses les plus longues :{' '}
              {timing.slowest.map((t) => `n° ${session.cardIds.indexOf(t.cardId) + 1} (${formatDuration(t.timeMs)})`).join(', ')}.
            </p>
          )}
        </section>
      )}
      {weak.length > 0 && (
        <section className="card-block small">
          <h3 className="label">Points faibles de ce test</h3>
          <ul className="kv">
            {weak.map((w) => (
              <li key={w.key}>
                <span>{w.label}</span>
                <strong>{Math.round(w.errorRate * 100)} % d'erreurs</strong>
              </li>
            ))}
          </ul>
          <p className="muted">QCM faux et questions ouvertes autoévaluées « À revoir », par thème.</p>
        </section>
      )}
      <ResultTable title="Par matière" rows={byMatiere} />
      <ResultTable title="Par difficulté" rows={byDifficulty} />
    </>
  );
}
