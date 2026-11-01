// Accueil (refonte UX/UI, référence Accueil V5 figée).
// Bandeau : salutation et décor (soleil ou étoiles) selon l'HEURE LOCALE uniquement, jamais selon le thème.
// Révision du jour : en retard / dues aujourd'hui / nouvelles, calculées par l'algorithme existant sur le programme
// étudié. Régularité : semaine en cours et série, d'après l'historique des révisions (aucune donnée nouvelle).
// Conservés de la v1.1.0 : reprise d'une séance en cours (prioritaire), rappel de sauvegarde, message de restauration.
import { useEffect, useMemo, useState } from 'react';
import { planReview, splitDue } from '../../review/queue';
import type { TestSession } from '../../domain/types';
import { getInProgressSessions, getSetting, LAST_BACKUP_KEY, listReviewDays } from '../../storage/repo';
import { RESTORED_FLAG } from './Restore';
import { progressOf } from '../../tests/session';
import { currentScopeLabel } from '../../taxonomy/labelMerge';
import { ROOT_ID } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, Icon, plural } from '../components/common';
import { href } from '../router';
import { dayLabel, streakOf, weekOf } from '../regularity';
import { greeting, timeOfDay, type TimeOfDay } from '../timeOfDay';
import { formatDay, useReviewData } from '../useReview';

export interface LastScope {
  nodeId: string;
  label: string;
}

/** Heure locale, recalculée chaque minute et au retour au premier plan */
function useTimeOfDay(): TimeOfDay {
  const [t, setT] = useState(() => timeOfDay(new Date()));
  useEffect(() => {
    const update = () => setT(timeOfDay(new Date()));
    const id = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return t;
}

const STARS: [number, number, number][] = [
  [8, 22, 1.6], [19, 64, 1.2], [31, 30, 1.8], [44, 78, 1.2], [53, 16, 1.4], [62, 52, 1.9], [71, 26, 1.2], [79, 70, 1.5],
  [86, 40, 1.8], [93, 18, 1.3], [96, 60, 1.2], [38, 54, 1.1], [24, 88, 1.3], [66, 86, 1.2],
];

function HeroDecor({ time }: { time: TimeOfDay }) {
  if (time === 'day') {
    return (
      <svg className="hero-decor sun" viewBox="0 0 160 160" aria-hidden="true">
        <circle cx="120" cy="40" r="78" className="sun-halo" />
        <circle cx="120" cy="40" r="54" className="sun-ring" />
        <circle cx="120" cy="40" r="34" className="sun-core" />
      </svg>
    );
  }
  return (
    <svg className="hero-decor stars" viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {STARS.map(([x, y, r], i) => (
        <circle key={i} cx={x * 2} cy={y} r={r * 0.75} />
      ))}
    </svg>
  );
}

export function Home() {
  const { db, metas, tax, labelRules, studied } = useApp();
  const time = useTimeOfDay();
  const [inProgress, setInProgress] = useState<TestSession | null>(null);
  const [reviewDays, setReviewDays] = useState<Set<string> | null>(null);
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
    // v1.1.0 : révision du jour = programme étudié uniquement
    return planReview(studied, d.states, d.today, d.newRemaining);
  }, [review.data, studied]);
  const split = plan && review.data ? splitDue(plan.due, review.data.states, review.data.today) : null;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ip, backupAt, days] = await Promise.all([
          getInProgressSessions(db),
          getSetting<string | null>(db, LAST_BACKUP_KEY, null).catch(() => null),
          listReviewDays(db),
        ]);
        if (!alive) return;
        setLastBackupAt(backupAt);
        setInProgress(ip[0] ?? null);
        setReviewDays(days);
        setLoadError(null);
      } catch (e) {
        if (alive) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [db, tax, attempt]);

  const hero = (
    <header className={`home-hero ${time}`}>
      <HeroDecor time={time} />
      <p className="pretitle">
        <span className="brand-mark" aria-hidden="true" />
        Flashcard
      </p>
      <h1 className="hero-title">{greeting(time)}</h1>
      <p className="lead">Chaque révision vous rapproche de votre objectif.</p>
    </header>
  );

  if (metas.length === 0) {
    return (
      <div className="page home">
        {hero}
        <section className="home-section">
          <h2 className="home-title">Bienvenue</h2>
          <div className="card-block">
            <p>Votre bibliothèque est vide. Importez un ou plusieurs fichiers CSV pour commencer.</p>
            <a className="btn primary block" href={href('import')}>
              Importer des flashcards
            </a>
            <a className="btn secondary block" href={href('restore')}>
              Restaurer une sauvegarde
            </a>
          </div>
        </section>
      </div>
    );
  }

  const today = review.data?.today;
  const week = today && reviewDays ? weekOf(today, reviewDays) : null;
  const streak = today && reviewDays ? streakOf(today, reviewDays) : 0;
  const backupDays = lastBackupAt ? Math.floor((Date.now() - Date.parse(lastBackupAt)) / 86_400_000) : null;

  return (
    <div className="page home">
      {hero}

      {restored && (
        <p className="notice slim" role="status">
          Sauvegarde restaurée : {plural(restored.cards, 'carte', 'cartes')}, {plural(restored.sessions, 'séance', 'séances')}.
          <button type="button" className="btn ghost small" onClick={() => setRestored(null)}>
            OK
          </button>
        </p>
      )}
      {lastBackupAt !== undefined && (lastBackupAt === null || backupDays! > 7) && (
        <p className="notice slim">
          {lastBackupAt === null ? 'Aucune sauvegarde de vos données sur cet appareil.' : `Dernière sauvegarde il y a ${backupDays} jours.`}
          <a className="notice-link" href={href('more')}>
            Sauvegarder
          </a>
        </p>
      )}
      {loadError && <ErrorNotice message={`Impossible de lire les séances enregistrées : ${loadError}`} onRetry={() => setAttempt((a) => a + 1)} />}

      {inProgress && (
        <section className="card-block resume">
          <p className="eyebrow">
            {inProgress.mode === 'revision'
              ? 'Révision en cours'
              : inProgress.phase === 'correction'
                ? 'Correction en cours'
                : inProgress.pausedAt
                  ? 'Test en pause'
                  : 'Test en cours'}
          </p>
          <p className="strong">{currentScopeLabel(inProgress, tax, labelRules)}</p>
          <p className="muted small">
            {inProgress.phase === 'correction'
              ? 'Questions terminées : correction et autoévaluation à faire'
              : `Question ${progressOf(inProgress).position} / ${progressOf(inProgress).total}`}
            {inProgress.phase !== 'correction' && progressOf(inProgress).repeat && ' (reprises de fin de séance)'}
          </p>
          <a className="btn primary block" href={href(inProgress.phase === 'correction' ? `test/correction/${inProgress.sessionId}` : `test/run/${inProgress.sessionId}`)}>
            {inProgress.mode === 'revision' ? 'Reprendre la révision' : inProgress.phase === 'correction' ? 'Reprendre la correction' : 'Reprendre le test'}
            <Icon name="arrow" />
          </a>
        </section>
      )}

      <section className="home-section">
        <h2 className="home-title">Révision du jour</h2>
        {review.error && <ErrorNotice message={`Impossible de lire les échéances : ${review.error}`} onRetry={review.reload} />}
        {plan && split && (
          <div className="card-block today-card">
            {studied.length === 0 ? (
              <>
                <p className="strong">Aucune notion n'est encore déclarée étudiée.</p>
                <p className="muted small">La révision du jour porte sur les notions que vous avez vues en cours.</p>
                <a className="btn primary block" href={href('program')}>
                  Définir mon programme étudié
                  <Icon name="arrow" />
                </a>
              </>
            ) : plan.queue.length === 0 ? (
              <>
                <p className="strong">Vous êtes à jour.</p>
                <p className="muted small">
                  Aucune carte à réviser aujourd'hui{plan.nextDueDay ? ` ; prochaine échéance : ${formatDay(plan.nextDueDay)}` : ''}.
                </p>
                <a className="btn secondary block" href={href('test/setup', { n: ROOT_ID })}>
                  Faire un test libre
                </a>
              </>
            ) : (
              <>
                <div className="today-head">
                  <p className="today-total">
                    <strong>{plan.queue.length}</strong> {plan.queue.length > 1 ? 'cartes à réviser' : 'carte à réviser'}
                  </p>
                  <p className="today-origin">Issues de votre programme étudié</p>
                </div>
                <dl className="today-split">
                  <div>
                    <dt>En retard</dt>
                    <dd>{split.overdue}</dd>
                  </div>
                  <div>
                    <dt>Dues ce jour</dt>
                    <dd>{split.today}</dd>
                  </div>
                  <div>
                    <dt>Nouvelles</dt>
                    <dd>{plan.fresh.length}</dd>
                  </div>
                </dl>
                <a className="btn primary block" href={href('review')}>
                  Commencer ma révision
                  <Icon name="arrow" />
                </a>
              </>
            )}
          </div>
        )}
      </section>

      {week && (
        <section className="home-section">
          <div className="section-head">
            <h2 className="home-subtitle">Ma régularité</h2>
            {streak > 0 && (
              <span className="streak-chip">
                <strong>{plural(streak, 'jour', 'jours')}</strong> de suite
              </span>
            )}
          </div>
          <ol className="week-row" aria-label="Régularité de la semaine">
            {week.map((d) => (
              <li key={d.day} className={`week-day ${d.state}${d.isToday ? ' today' : ''}`} aria-label={dayLabel(d)}>
                <span className="week-letter" aria-hidden="true">
                  {d.letter}
                </span>
                <span className="week-date" aria-hidden="true">
                  {d.date}
                </span>
              </li>
            ))}
          </ol>
          <div className="week-foot">
            <span className="legend">
              <span className="swatch done" aria-hidden="true" /> Révisé
              <span className="swatch none" aria-hidden="true" /> Sans révision
            </span>
            <a className="text-link" href={href('stats')}>
              Voir l'activité <Icon name="arrow" />
            </a>
          </div>
        </section>
      )}

      <section className="home-section">
        <h2 className="home-subtitle">Explorer autrement</h2>
        <div className="tile-grid">
          <a className="tile" href={href('test/setup', { n: ROOT_ID })}>
            <span>Test libre</span>
            <Icon name="arrow" />
          </a>
          <a className="tile" href={href('library')}>
            <span>Bibliothèque</span>
            <Icon name="arrow" />
          </a>
        </div>
        <a className="row-link" href={href('program')}>
          <span>
            <span className="strong">Mon programme étudié</span>
            <span className="row-sub">Indiquer les notions vues en cours</span>
          </span>
          <Icon name="chevron" />
        </a>
      </section>
    </div>
  );
}
