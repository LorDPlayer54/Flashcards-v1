import { useEffect, useMemo, useState } from 'react';
import { planReview } from '../../review/queue';
import { isMastered } from '../../review/schedule';
import type { TestSession } from '../../domain/types';
import { getInProgressSessions, getSetting, LAST_BACKUP_KEY, listFinishedSessions } from '../../storage/repo';
import { RESTORED_FLAG } from './Restore';
import { progressOf, summarize } from '../../tests/session';
import { currentScopeLabel } from '../../taxonomy/labelMerge';
import { ROOT_ID } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, plural, TopBar } from '../components/common';
import { href, libraryHref } from '../router';
import { formatDay, useReviewData } from '../useReview';

export interface LastScope {
  nodeId: string;
  label: string;
}

export function Home() {
  const { db, metas, tax, labelRules } = useApp();
  const [inProgress, setInProgress] = useState<TestSession | null>(null);
  const [recent, setRecent] = useState<TestSession[]>([]);
  const [lastScope, setLastScope] = useState<LastScope | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Lot 4 : rappel de sauvegarde (aucune, ou plus de 7 jours) et confirmation après une restauration */
  const [lastBackupAt, setLastBackupAt] = useState<string | null | undefined>(undefined);
  const [restored, setRestored] = useState<{ cards: number; sessions: number } | null>(() => {
    try {
      const v = sessionStorage.getItem(RESTORED_FLAG);
      if (v) sessionStorage.removeItem(RESTORED_FLAG);
      return v ? (JSON.parse(v) as { cards: number; sessions: number }) : null;
    } catch {
      return null;
    }
  });
  const [attempt, setAttempt] = useState(0);
  const review = useReviewData();
  const plan = useMemo(() => {
    const d = review.data;
    if (!d) return null;
    return planReview(metas, d.states, d.today, d.newRemaining);
  }, [review.data, metas]);
  const mastered = useMemo(() => {
    const d = review.data;
    if (!d) return 0;
    let n = 0;
    for (const st of d.states.values()) if (isMastered(st)) n++;
    return n;
  }, [review.data]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ip, fin, last, backupAt] = await Promise.all([
          getInProgressSessions(db),
          listFinishedSessions(db, 3),
          getSetting<LastScope | null>(db, 'lastScope', null),
          getSetting<string | null>(db, LAST_BACKUP_KEY, null).catch(() => null),
        ]);
        if (alive) setLastBackupAt(backupAt);
        if (!alive) return;
        setInProgress(ip[0] ?? null);
        setRecent(fin);
        setLastScope(last && last.nodeId !== ROOT_ID && tax.byId.has(last.nodeId) ? last : null);
        setLoadError(null);
      } catch (e) {
        if (alive) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [db, tax, attempt]);

  if (metas.length === 0) {
    return (
      <div className="page">
        <TopBar title="Flashcards ENA" />
        <section className="card-block hero">
          <h2>Bienvenue</h2>
          <p>Votre bibliothèque est vide. Importez un ou plusieurs fichiers CSV pour commencer.</p>
          <a className="btn primary block" href={href('import')}>
            Importer des flashcards
          </a>
          <a className="btn secondary block" href={href('restore')}>
            Restaurer une sauvegarde
          </a>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <TopBar title="Flashcards ENA" />

      {restored && (
        <p className="notice" role="status">
          Sauvegarde restaurée : {plural(restored.cards, 'carte', 'cartes')}, {plural(restored.sessions, 'séance', 'séances')}.{' '}
          <button type="button" className="btn ghost small" onClick={() => setRestored(null)}>
            OK
          </button>
        </p>
      )}
      {lastBackupAt !== undefined && (lastBackupAt === null || Date.now() - Date.parse(lastBackupAt) > 7 * 86_400_000) && (
        <p className="notice small">
          {lastBackupAt === null
            ? 'Aucune sauvegarde de vos données sur cet appareil.'
            : `Dernière sauvegarde il y a ${Math.floor((Date.now() - Date.parse(lastBackupAt)) / 86_400_000)} jours.`}{' '}
          <a href={href('more')}>Sauvegarder</a>
        </p>
      )}
      {loadError && (
        <ErrorNotice message={`Impossible de lire les tests enregistrés : ${loadError}`} onRetry={() => setAttempt((a) => a + 1)} />
      )}

      {inProgress && (
        <section className="card-block resume">
          <p className="eyebrow">
            {inProgress.mode === 'revision' ? 'Révision en cours' : inProgress.phase === 'correction' ? 'Correction en cours' : inProgress.pausedAt ? 'Test en pause' : 'Test en cours'}
          </p>
          <p className="strong">{currentScopeLabel(inProgress, tax, labelRules)}</p>
          <p className="muted">
            {inProgress.phase === 'correction'
              ? 'Questions terminées : correction et autoévaluation à faire'
              : `Question ${progressOf(inProgress).position} / ${progressOf(inProgress).total}`}
            {inProgress.phase !== 'correction' && progressOf(inProgress).repeat && ' (reprises de fin de séance)'}
          </p>
          <a
            className="btn primary block"
            href={href(inProgress.phase === 'correction' ? `test/correction/${inProgress.sessionId}` : `test/run/${inProgress.sessionId}`)}
          >
            {inProgress.mode === 'revision' ? 'Reprendre la révision' : inProgress.phase === 'correction' ? 'Reprendre la correction' : 'Reprendre le test'}
          </a>
        </section>
      )}

      {review.error && <ErrorNotice message={`Impossible de lire les échéances : ${review.error}`} onRetry={review.reload} />}
      {plan && (
        <section className="card-block">
          <p className="eyebrow">Aujourd'hui</p>
          {plan.queue.length > 0 ? (
            <>
              <p className="strong">
                {plural(plan.due.length, 'carte à revoir', 'cartes à revoir')} · {plural(plan.fresh.length, 'nouvelle', 'nouvelles')}
              </p>
              <a className="btn primary block" href={href('review')}>
                Réviser aujourd'hui ({plan.queue.length})
              </a>
            </>
          ) : (
            <>
              <p className="strong">Rien à réviser aujourd'hui.</p>
              {plan.nextDueDay && <p className="muted small">Prochaine échéance : {formatDay(plan.nextDueDay)}.</p>}
            </>
          )}
        </section>
      )}

      <section className="card-block">
        <a className="btn secondary block" href={href('test/setup', { n: ROOT_ID })}>
          Lancer un test sur toutes les matières
        </a>
        {lastScope && (
          <a className="btn secondary block" href={href('test/setup', { n: lastScope.nodeId })}>
            Nouveau test : {lastScope.label}
          </a>
        )}
      </section>

      <section className="stats-row">
        <div className="stat">
          <span className="stat-value">{metas.length.toLocaleString('fr-FR')}</span>
          <span className="stat-label">cartes</span>
        </div>
        <div className="stat">
          <span className="stat-value">{tax.root.children.length}</span>
          <span className="stat-label">matières</span>
        </div>
        <div className="stat">
          <span className="stat-value">{mastered.toLocaleString('fr-FR')}</span>
          <span className="stat-label">maîtrisées</span>
        </div>
      </section>
      <a className="btn ghost block" href={href('stats')}>
        Statistiques et activité
      </a>

      <section>
        <h2 className="section-title">Matières</h2>
        <ul className="list">
          {tax.root.children.map((m) => (
            <li key={m.id}>
              <a className="list-row" href={libraryHref(m.id)}>
                <span className="row-main">{m.label}</span>
                <span className="row-count">{m.total}</span>
                <span className="chev" aria-hidden="true">
                  ›
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {recent.length > 0 && (
        <section>
          <h2 className="section-title">Derniers tests</h2>
          <ul className="list">
            {recent.map((s) => {
              const sum = summarize(s);
              return (
                <li key={s.sessionId}>
                  <a className="list-row" href={href(`test/summary/${s.sessionId}`)}>
                    <span className="row-main">
                      {currentScopeLabel(s, tax, labelRules)}
                      <span className="row-sub">
                        {plural(sum.answered, 'carte traitée', 'cartes traitées')}
                        {sum.mcq.answered > 0 && ` · QCM ${sum.mcq.correct}/${sum.mcq.answered}`}
                      </span>
                    </span>
                    <span className="chev" aria-hidden="true">
                      ›
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
