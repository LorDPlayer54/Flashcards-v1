// Déroulement d'un test : une carte par écran.
// v1.1 (B1) : chaque transition passe par SessionController et n'est affichée qu'après enregistrement réussi.
import { useEffect, useRef, useState } from 'react';
import { SELF_EVAL_LABELS, type Card, type SelfEval, type TestSession } from '../../domain/types';
import { localDay } from '../../review/schedule';
import { getCard, getSession, saveRevisionTransition, saveSessionTransition } from '../../storage/repo';
import { SessionController, type ApplyOutcome } from '../../tests/sessionController';
import {
  applyUserTransition,
  elapsedAt,
  enforceTimeLimit,
  inQuestions,
  isTimeUpTransition,
  limitReached,
  prepareExit,
  timeLeft,
  type LimitOutcome,
  type TimeSource,
} from '../../tests/timeLimit';
import {
  advance,
  currentAnswer,
  currentCardId,
  deferAnswer,
  finishEarly,
  gradeMcq,
  isEndCorrection,
  isRepeatPosition,
  rateMcq,
  recordAnswer,
  selfEvaluate,
  canPause,
  pauseSession,
  resumeSession,
  sequence,
  withDeadline,
} from '../../tests/session';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, formatClock } from '../components/common';
import { RichText } from '../components/RichText';
import { navigate } from '../router';
import { useActiveClock } from '../useActiveClock';

const EVALS: SelfEval[] = ['again', 'hard', 'good', 'easy'];
const MCQ_RATINGS: Exclude<SelfEval, 'again'>[] = ['hard', 'good', 'easy'];

/**
 * Enregistrement selon le mode : un test libre n'écrit que la session ; une révision programmée met aussi à jour,
 * dans la même transaction, l'état de mémorisation et l'historique (lot 2).
 */
function saverFor(db: Parameters<typeof saveSessionTransition>[0], s: TestSession) {
  return s.mode === 'revision'
    ? (next: TestSession) => saveRevisionTransition(db, next, localDay())
    : (next: TestSession) => saveSessionTransition(db, next);
}

export function TestRun({ sessionId }: { sessionId: string }) {
  const { db } = useApp();
  const ctlRef = useRef<SessionController | null>(null);
  const [session, setSession] = useState<TestSession | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardAttempt, setCardAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** v1.1.1 : la session a été modifiée ailleurs ; seule action possible : recharger */
  const [staleError, setStaleError] = useState<string | null>(null);
  /** v0.3.0-a1 (B1) : une action est arrivée après la limite de temps et n'a pas été enregistrée */
  const [lateNotice, setLateNotice] = useState(false);
  /** v0.3.0-a1 (M2) : le temps écoulé n'a pas pu être enregistré en quittant */
  const [quitError, setQuitError] = useState<string | null>(null);
  const correctionRef = useRef<HTMLElement>(null);

  // Chargement de la session
  useEffect(() => {
    let alive = true;
    setLoadError(null);
    getSession(db, sessionId)
      .then((s) => {
        if (!alive) return;
        if (s && s.status === 'finished') {
          navigate(`test/summary/${s.sessionId}`, undefined, true);
          return;
        }
        if (s && s.status === 'in_progress' && s.phase === 'correction') {
          navigate(`test/correction/${s.sessionId}`, undefined, true);
          return;
        }
        // v0.3.0-a2 : un test limité créé en 0.3.0-a/a1 reçoit son échéance absolue (temps restant enregistré),
        // enregistrée avec sa première transition ; les autres séances sont inchangées
        const loaded = s ? withDeadline(s, new Date().toISOString()) : s;
        ctlRef.current = loaded ? new SessionController(loaded, saverFor(db, loaded)) : null;
        setSession(loaded ?? null);
      })
      .catch((e: unknown) => alive && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [db, sessionId, loadAttempt]);

  const cardId = session ? currentCardId(session) : undefined;
  const position = session?.currentIndex ?? -1;
  const answeredCurrent = Boolean(session && currentAnswer(session));

  // ---------- Lot 3A : temps actif ----------
  const timerMode = session?.config.timer?.mode ?? 'off';
  // v0.3.0-a1 (M1) : sans chronomètre (« Aucun »), aucun temps n'est mesuré ni enregistré
  const clockActive = Boolean(session && inQuestions(session) && timerMode !== 'off');
  // v0.3.0-a2 : le temps limité suit l'heure réelle (échéance) ; l'horloge active ne sert qu'au « temps écoulé »
  // Lot 3B : en pause, l'horloge active est arrêtée
  const clock = useActiveClock(clockActive && !session?.deadlineAt && !session?.pausedAt);
  const src: TimeSource = { now: () => Date.now(), peek: clock.peek, take: clock.take };
  /** Temps des questions à cet instant, y compris celui d'une écriture en cours ou en échec (l'affichage ne recule pas) */
  const elapsedNow = () => {
    const s = ctlRef.current?.latest ?? session;
    return s ? elapsedAt(s, src) : 0;
  };
  const cardStartRef = useRef(0);
  useEffect(() => {
    cardStartRef.current = elapsedNow();
    // nouvelle position : départ du temps de la question
  }, [position, session?.sessionId]);
  /** Temps de réponse de la question courante ; non renseigné sans chronomètre (M1) */
  const cardTime = (): { timeMs?: number } =>
    timerMode === 'off' ? {} : { timeMs: Math.max(0, Math.round(elapsedNow() - cardStartRef.current)) };
  const [, setTick] = useState(0);
  const limitCheck = useRef<(() => void) | null>(null);
  // Affichage du chronomètre (1 rafraîchissement par seconde) et vérification de la limite (B1, v0.3.0-a1) :
  // la vérification est refaite à chaque seconde tant que la fin n'est pas ENREGISTRÉE (voir tests/timeLimit.ts)
  useEffect(() => {
    if (!clockActive) return;
    limitCheck.current?.(); // reprise d'une séance dont la limite est déjà atteinte
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      limitCheck.current?.();
    }, 1000);
    return () => window.clearInterval(id);
  }, [clockActive]);

  // Chargement de la carte courante
  useEffect(() => {
    let alive = true;
    setCard(undefined);
    setCardError(null);
    setSelected(null);
    setRevealed(false);
    if (cardId)
      getCard(db, cardId)
        .then((c) => alive && setCard(c ?? null))
        .catch((e: unknown) => alive && setCardError(errorMessage(e)));
    return () => {
      alive = false;
    };
    // position : une reprise de fin de séance peut suivre immédiatement la même carte
  }, [db, cardId, position, cardAttempt]);

  // Après validation d'un QCM ou affichage de la réponse, rendre la correction visible sur petit écran
  useEffect(() => {
    if (answeredCurrent || revealed) correctionRef.current?.scrollIntoView({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'nearest',
      });
  }, [answeredCurrent, revealed]);

  if (loadError) {
    return (
      <div className="page">
        <ErrorNotice message={`Impossible de charger le test : ${loadError}`} onRetry={() => setLoadAttempt((n) => n + 1)} />
        <a className="btn secondary block" href="#/">
          Accueil
        </a>
      </div>
    );
  }
  if (session === undefined) return <div className="page center muted">Chargement…</div>;
  if (session === null || session.status === 'abandoned') {
    return (
      <div className="page">
        <p className="notice">Ce test n'est plus disponible.</p>
        <a className="btn primary block" href="#/">
          Accueil
        </a>
      </div>
    );
  }

  /** Traite le résultat d'une écriture : l'écran n'avance que si l'enregistrement a réussi. */
  const handle = (res: ApplyOutcome) => {
    if (res.status === 'saved') {
      setSaveError(null);
      setSession(res.session);
      if (res.session.status === 'finished') navigate(`test/summary/${res.session.sessionId}`, undefined, true);
      else if (res.session.phase === 'correction') navigate(`test/correction/${res.session.sessionId}`, undefined, true);
    } else if (res.status === 'failed') {
      if (res.stale) setStaleError(res.error);
      else setSaveError(res.error);
    }
  };

  const run = async (build: (confirmed: TestSession) => TestSession) => {
    const ctl = ctlRef.current;
    if (!ctl || ctl.busy || ctl.pending) return;
    setBusy(true);
    try {
      // Lot 3A : le temps actif écoulé depuis la dernière transition est confié à la séance (même écriture).
      // v0.3.0-a1 (B1) : si la limite est atteinte, l'action n'est pas enregistrée ; la fin du test l'est à sa place.
      const res = await applyUserTransition(ctl, src, build);
      if (res.status === 'expired') {
        setLateNotice(true);
        handle(res.outcome);
      } else handle(res);
    } catch (e) {
      // Erreur de logique (ex. réponse hors carte courante) : rien n'est enregistré
      setSaveError(errorMessage(e));
    } finally {
      setBusy(false);
    }
    limitCheck.current?.(); // la limite a pu être atteinte pendant l'écriture
  };

  /** v0.3.0-a1 (B1) : vérifie la limite et enregistre la fin ; sans effet si une écriture est en cours (revérifié ensuite). */
  limitCheck.current = () => {
    const ctl = ctlRef.current;
    if (!ctl || timerMode !== 'limit' || ctl.busy) return;
    if (!limitReached(ctl.latest, src)) return;
    setBusy(true);
    void enforceTimeLimit(ctl, src)
      .then((res: LimitOutcome) => {
        if (res.status === 'saved' || res.status === 'failed') handle(res);
      })
      .catch((e: unknown) => setSaveError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  const retry = async () => {
    const ctl = ctlRef.current;
    if (!ctl || ctl.busy) return;
    setBusy(true);
    try {
      handle(await ctl.retry());
    } finally {
      setBusy(false);
    }
    limitCheck.current?.();
  };

  const pending = ctlRef.current?.pending ?? null;
  const latest = ctlRef.current?.latest ?? session;
  const limitLeft = session.status === 'in_progress' ? timeLeft(latest, src) : null;
  /** v0.3.0-a1 (B1) : limite atteinte, fin pas encore enregistrée : aucune réponse n'est plus acceptée */
  const expired = timerMode === 'limit' && limitReached(latest, src);
  const timeUpFailed = isTimeUpTransition(pending);
  const locked = busy || pending !== null || staleError !== null || expired || quitError !== null;

  if (staleError) {
    return (
      <div className="page">
        <div className="notice error" role="alert">
          <p>
            {staleError} Pour éviter de mélanger deux versions du même test, cette page n'enregistre plus rien. Rechargez-la pour
            retrouver l'état à jour.
          </p>
          <button type="button" className="btn primary block" onClick={() => window.location.reload()}>
            Recharger
          </button>
          <a className="btn secondary block" href="#/">
            Accueil
          </a>
        </div>
      </div>
    );
  }

  // ---------- Lot 3B : pause ----------
  const paused = Boolean(latest.pausedAt);
  const pausable = canPause(session) && timerMode !== 'off';
  const pauseNow = () => void run((s) => pauseSession(s, new Date().toISOString()));
  const resumeNow = () => void run((s) => resumeSession(s, new Date().toISOString()));

  const isRevision = session.mode === 'revision';
  const endMode = isEndCorrection(session);
  const total = sequence(session).length;
  const index = session.currentIndex;
  const answer = currentAnswer(session);
  const repeat = isRepeatPosition(session);
  const isLast = index >= total - 1;

  const goNext = () => void run((s) => advance(s));

  const validateMcq = () => {
    if (!card || !selected || answer) return;
    const chosen = selected;
    const t = cardTime();
    const now = new Date().toISOString();
    // Correction en fin de test : réponse enregistrée sans être corrigée, question suivante dans la même écriture
    if (endMode) void run((s) => advance(recordAnswer(s, card.cardId, { ...gradeMcq(card, chosen, now, s.mode), ...t }), now));
    else void run((s) => recordAnswer(s, card.cardId, { ...gradeMcq(card, chosen, now, s.mode), ...t }));
  };

  const evaluate = (e: SelfEval) => {
    if (!card || answer) return;
    const t = cardTime();
    void run((s) => advance(recordAnswer(s, card.cardId, { ...selfEvaluate(e, new Date().toISOString()), ...t })));
  };

  /** Correction en fin de test : question ouverte traitée, autoévaluation reportée à la correction */
  const deferOpen = () => {
    if (!card || answer) return;
    const t = cardTime();
    const now = new Date().toISOString();
    void run((s) => advance(recordAnswer(s, card.cardId, deferAnswer(now, t.timeMs)), now));
  };

  /** Révision : QCM juste → note de maîtrise puis carte suivante, en une seule transition */
  const rate = (r: Exclude<SelfEval, 'again'>) => {
    if (!card) return;
    const now = new Date().toISOString();
    void run((s) => advance(rateMcq(s, card.cardId, r, now), now));
  };
  const mcqNeedsRating = isRevision && answer?.kind === 'mcq' && answer.correct && !answer.rating;

  /**
   * Quitter : la séance reste « en cours » et peut être reprise depuis l'accueil.
   * v0.3.0-a2 : la limite est vérifiée avant tout enregistrement ou navigation (voir prepareExit) : atteinte, la fin du
   * test est enregistrée et le bilan (ou la correction) s'affiche ; une séance expirée n'est jamais enregistrée « en cours ».
   * v0.3.0-a1 (M2) : un échec d'enregistrement du temps est signalé (réessayer, ou quitter sans l'enregistrer).
   */
  const quit = async () => {
    const ctl = ctlRef.current;
    if (!ctl || ctl.busy) return;
    if (ctl.pending && !quitError && !isTimeUpTransition(ctl.pending) && !limitReached(ctl.latest, src)) {
      if (!window.confirm("Votre dernière action n'a pas été enregistrée. Quitter quand même ?")) return;
    }
    setBusy(true);
    let res: Awaited<ReturnType<typeof prepareExit>>;
    try {
      res = await prepareExit(ctl, src);
    } finally {
      setBusy(false);
    }
    switch (res.status) {
      case 'leave':
        navigate('');
        return;
      case 'ended':
        setQuitError(null);
        handle({ status: 'saved', session: res.session }); // bilan ou correction
        return;
      case 'end-failed':
        setQuitError(null);
        if (res.error !== null) {
          // La fin vient d'échouer : bandeau « Réessayer de terminer le test », on reste sur la page
          handle({ status: 'failed', error: res.error, stale: res.stale });
        } else if (
          // La fin avait déjà échoué : rien n'est enregistré « en cours » ; l'échéance étant enregistrée,
          // le test sera clos à sa réouverture sans accepter de réponse
          ctl.current.deadlineAt &&
          window.confirm(
            "Le temps est écoulé mais la fin du test n'a pas pu être enregistrée. Quitter quand même ? Le test sera clôturé à sa prochaine ouverture, sans nouvelle réponse.",
          )
        ) {
          navigate('');
        }
        return;
      case 'save-failed':
        if (res.stale) setStaleError(res.error);
        else setQuitError(res.error);
        return;
      case 'busy':
        return;
    }
  };

  /** M2 : quitter sans enregistrer le temps (après un échec) ; l'expiration reste vérifiée d'abord (v0.3.0-a2). */
  const quitWithoutTime = () => {
    const ctl = ctlRef.current;
    if (ctl && limitReached(ctl.latest, src)) {
      setQuitError(null);
      void quit();
      return;
    }
    ctl?.discardPending();
    navigate('');
  };

  const finishNow = () => {
    if (!window.confirm('Terminer le test maintenant ? Les questions restantes seront comptées comme non traitées.')) return;
    void run((s) => finishEarly(s));
  };

  // ---------- Rendu ----------
  const progress = (
    <header className="run-bar">
      <button type="button" className="btn ghost small" onClick={() => void quit()} disabled={busy || quitError !== null}>
        Quitter
      </button>
      <div className="run-progress" aria-label={`Question ${index + 1} sur ${total}`}>
        <span className="run-count">
          {index + 1}/{total}
        </span>
        <div className="progress">
          <div className="progress-fill" style={{ width: `${((index + (answer ? 1 : 0)) / total) * 100}%` }} />
        </div>
        {timerMode !== 'off' && (
          <span
            className={`timer small${limitLeft !== null && limitLeft < 60_000 ? ' low' : ''}`}
            aria-label={limitLeft !== null ? 'Temps restant' : 'Temps écoulé'}
          >
            {limitLeft !== null ? `reste ${formatClock(limitLeft)}` : formatClock(elapsedNow())}
          </span>
        )}
      </div>
      {paused ? (
        <span className="icon-spacer" />
      ) : pausable ? (
        <button type="button" className="btn ghost small" onClick={pauseNow} disabled={locked} aria-label="Mettre le test en pause">
          Pause
        </button>
      ) : (
        <button type="button" className="btn ghost small" onClick={finishNow} disabled={locked}>
          Terminer
        </button>
      )}
    </header>
  );

  const saveBanner = (
    <>
      {quitError && (
        <div className="notice error" role="alert">
          <p>Le temps écoulé n'a pas pu être enregistré ({quitError}). Vos réponses précédentes restent enregistrées.</p>
          <button type="button" className="btn primary block" onClick={() => void quit()} disabled={busy}>
            Réessayer et quitter
          </button>
          <button type="button" className="btn secondary block" onClick={quitWithoutTime} disabled={busy}>
            Quitter sans enregistrer ce temps
          </button>
        </div>
      )}
      {!quitError && saveError && (
        <ErrorNotice
          message={
            timeUpFailed
              ? `Le temps est écoulé, mais la fin du test n'a pas pu être enregistrée : ${saveError}. Aucune réponse n'est plus acceptée.`
              : `Enregistrement impossible : ${saveError}. Votre réponse est conservée sur cet écran ; la progression n'a pas avancé.`
          }
          onRetry={pending ? () => void retry() : undefined}
          retryLabel={timeUpFailed ? 'Réessayer de terminer le test' : "Réessayer l'enregistrement"}
          busy={busy}
        />
      )}
      {expired && !timeUpFailed && !saveError && (
        <p className="notice" role="status">
          Temps écoulé : fin du test en cours d'enregistrement…
        </p>
      )}
      {lateNotice && <p className="notice small">La limite de temps était atteinte : votre dernière action n'a pas été prise en compte.</p>}
    </>
  );

  // Lot 3B : pendant la pause, la question et la réponse sont masquées ; seules « Reprendre » et « Quitter » restent
  if (paused) {
    return (
      <div className="page run with-action-bar">
        {progress}
        {saveBanner}
        <section className="card-block pause-panel" aria-live="polite">
          <h2>Test en pause</h2>
          <p>
            {limitLeft !== null
              ? `Le compte à rebours est arrêté : il reste ${formatClock(limitLeft)}.`
              : `Le chronomètre est arrêté à ${formatClock(elapsedNow())}.`}
          </p>
          <p className="muted small">La question est masquée pendant la pause. Vous pouvez quitter : le test restera en pause jusqu'à sa reprise.</p>
        </section>
        <div className="action-bar">
          <button type="button" className="btn primary block" onClick={resumeNow} disabled={busy || pending !== null || staleError !== null}>
            {busy ? 'Enregistrement…' : 'Reprendre le test'}
          </button>
          <button type="button" className="btn secondary block" onClick={finishNow} disabled={busy || pending !== null}>
            Terminer le test
          </button>
        </div>
      </div>
    );
  }

  if (cardError) {
    return (
      <div className="page run">
        {progress}
        <ErrorNotice message={`Impossible de charger la question : ${cardError}`} onRetry={() => setCardAttempt((n) => n + 1)} />
      </div>
    );
  }

  // Pendant le passage à la carte suivante, l'ancienne carte ne doit pas s'afficher
  if (card === undefined || (card !== null && card.cardId !== cardId)) {
    return (
      <div className="page run">
        {progress}
        <p className="muted center">Chargement…</p>
      </div>
    );
  }

  if (card === null) {
    return (
      <div className="page run with-action-bar">
        {progress}
        {saveBanner}
        <p className="notice">Cette carte a été supprimée depuis le lancement du test. Elle sera comptée comme non traitée.</p>
        <div className="action-bar">
          <button type="button" className="btn primary block" onClick={goNext} disabled={locked}>
            {isLast ? 'Voir le bilan' : 'Passer'}
          </button>
        </div>
      </div>
    );
  }

  const path = [card.matiere, card.theme, card.lecon, card.notion].filter(Boolean).join(' › ');
  const isMcq = card.formatQuestion === 'mcq' && card.options && card.correctOptionId;
  // Correction en fin de test : aucune correction pendant les questions
  const showCorrection = !endMode && (Boolean(answer) || (!isMcq && revealed));

  return (
    <div className="page run with-action-bar">
      {progress}
      {saveBanner}

      {(isRevision || repeat) && (
        <div className="chips">
          {isRevision && <span className="chip">Révision programmée</span>}
          {repeat && <span className="chip warn">Reprise : carte « À revoir »</span>}
        </div>
      )}
      <p className="crumbs small">{path}</p>
      <article className="card-block question-card">
        <RichText text={card.question} className="question" />
      </article>

      {isMcq && (
        <div className="options" role="radiogroup" aria-label="Propositions">
          {card.options!.map((o) => {
            const chosen = answer?.kind === 'mcq' ? answer.selectedOptionId === o.id : selected === o.id;
            let cls = 'option';
            if (answer) {
              if (o.id === card.correctOptionId) cls += ' correct';
              else if (chosen) cls += ' wrong';
            } else if (chosen) cls += ' selected';
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                className={cls}
                disabled={Boolean(answer) || locked}
                onClick={() => setSelected(o.id)}
              >
                <span className="opt-letter">{o.id}</span>
                <RichText text={o.text} />
              </button>
            );
          })}
        </div>
      )}

      {showCorrection && (
        <section ref={correctionRef} className="card-block correction" aria-live="polite">
          {answer?.kind === 'mcq' && (
            <p className={answer.correct ? 'verdict ok' : 'verdict ko'}>
              {answer.correct ? 'Bonne réponse' : `Réponse incorrecte — la bonne réponse est ${card.correctOptionId})`}
            </p>
          )}
          {!isMcq && <h3 className="label">Réponse</h3>}
          {!isMcq && <RichText text={card.reponse} className="answer" />}
          {card.explication && (
            <>
              <h3 className="label">Explication</h3>
              <RichText text={card.explication} />
            </>
          )}
          {card.astucePiege && (
            <>
              <h3 className="label">Astuce / Piège</h3>
              <RichText text={card.astucePiege} />
            </>
          )}
          {answer?.kind === 'open' && <p className="muted">Votre autoévaluation : {SELF_EVAL_LABELS[answer.selfEval]}</p>}
          {isRevision && answer?.kind === 'mcq' && !answer.correct && (
            <p className="muted small">
              {repeat ? 'La carte sera revue demain.' : 'Noté « À revoir » : la carte sera reproposée en fin de séance, puis revue demain.'}
            </p>
          )}
        </section>
      )}

      <div className="action-bar">
        {isMcq && !answer && (
          <button type="button" className="btn primary block" disabled={!selected || locked} onClick={validateMcq}>
            {busy ? 'Enregistrement…' : endMode ? (isLast ? 'Valider et passer à la correction' : 'Valider et continuer') : 'Valider'}
          </button>
        )}
        {endMode && !isMcq && !answer && (
          <>
            <p className="eval-hint">Réfléchissez à votre réponse : la correction et l'autoévaluation se feront à la fin.</p>
            <button type="button" className="btn primary block" disabled={locked} onClick={deferOpen}>
              {busy ? 'Enregistrement…' : isLast ? 'Passer à la correction' : 'Question suivante'}
            </button>
          </>
        )}
        {!endMode && !isMcq && !revealed && !answer && (
          <button type="button" className="btn primary block" disabled={locked} onClick={() => setRevealed(true)}>
            Voir la réponse
          </button>
        )}
        {!isMcq && revealed && !answer && (
          <>
            <p className="eval-hint">
              {isRevision
                ? 'Votre évaluation fixe la prochaine révision (ce n’est pas une correction objective)'
                : "Autoévaluation (ce n'est pas une correction objective)"}
            </p>
            <div className="eval-grid">
              {EVALS.map((e) => (
                <button key={e} type="button" className={`btn eval eval-${e}`} disabled={locked} onClick={() => evaluate(e)}>
                  {SELF_EVAL_LABELS[e]}
                </button>
              ))}
            </div>
          </>
        )}
        {mcqNeedsRating && (
          <>
            <p className="eval-hint">Bonne réponse : comment l'avez-vous trouvée ? (fixe la prochaine révision)</p>
            <div className="eval-grid three">
              {MCQ_RATINGS.map((r) => (
                <button key={r} type="button" className={`btn eval eval-${r}`} disabled={locked} onClick={() => rate(r)}>
                  {SELF_EVAL_LABELS[r]}
                </button>
              ))}
            </div>
          </>
        )}
        {answer && !mcqNeedsRating && (
          <button type="button" className="btn primary block" disabled={locked} onClick={goNext}>
            {busy ? 'Enregistrement…' : isLast ? 'Voir le bilan' : 'Suivant'}
          </button>
        )}
      </div>
    </div>
  );
}
