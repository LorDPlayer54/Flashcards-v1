// Lot 3A : phase de correction d'un test « correction en fin de test ».
// La séance reste « en cours » : corrections des QCM, réponses des questions ouvertes et autoévaluation de chacune,
// enregistrées une par une (mêmes garanties que pendant le test : SessionController + écriture conditionnelle).
import { useEffect, useRef, useState } from 'react';
import { SELF_EVAL_LABELS, type Card, type SelfEval, type TestSession } from '../../domain/types';
import { getCards, getSession, saveEvaluatedTransition } from '../../storage/repo';
import { localDay } from '../../review/schedule';
import { SessionController, type ApplyOutcome } from '../../tests/sessionController';
import { evaluateDeferred, finishCorrection, summarize } from '../../tests/session';
import { currentScopeLabel } from '../../taxonomy/labelMerge';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, plural, TopBar } from '../components/common';
import { RichText } from '../components/RichText';
import { navigate } from '../router';

const EVALS: SelfEval[] = ['again', 'hard', 'good', 'easy'];
const PAGE = 20;

export function TestCorrection({ sessionId }: { sessionId: string }) {
  const { db, tax, labelRules } = useApp();
  const ctlRef = useRef<SessionController | null>(null);
  const [session, setSession] = useState<TestSession | null | undefined>(undefined);
  const [cards, setCards] = useState<Map<string, Card>>(new Map());
  const [shown, setShown] = useState(PAGE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [staleError, setStaleError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    getSession(db, sessionId)
      .then((s) => {
        if (!alive) return;
        if (s && s.status === 'finished') return navigate(`test/summary/${s.sessionId}`, undefined, true);
        if (s && s.status === 'in_progress' && s.phase !== 'correction') return navigate(`test/run/${s.sessionId}`, undefined, true);
        ctlRef.current = s ? new SessionController(s, (next) => saveEvaluatedTransition(db, next, localDay())) : null;
        setSession(s ?? null);
      })
      .catch((e: unknown) => alive && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [db, sessionId, attempt]);

  // Chargement progressif des cartes affichées
  useEffect(() => {
    if (!session) return;
    let alive = true;
    const ids = session.cardIds.slice(0, shown).filter((id) => !cards.has(id));
    if (ids.length === 0) return;
    getCards(db, ids)
      .then((list) => alive && setCards((prev) => new Map([...prev, ...list.map((c) => [c.cardId, c] as const)])))
      .catch((e: unknown) => alive && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [db, session, shown]);

  if (loadError) {
    return (
      <div className="page">
        <TopBar title="Correction" back="#/" />
        <ErrorNotice message={`Impossible de charger la correction : ${loadError}`} onRetry={() => setAttempt((a) => a + 1)} />
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
  if (staleError) {
    return (
      <div className="page">
        <div className="notice error" role="alert">
          <p>{staleError} Rechargez la page pour retrouver l'état à jour.</p>
          <button type="button" className="btn primary block" onClick={() => window.location.reload()}>
            Recharger
          </button>
        </div>
      </div>
    );
  }

  const handle = (res: ApplyOutcome) => {
    if (res.status === 'saved') {
      setSaveError(null);
      setSession(res.session);
      if (res.session.status === 'finished') navigate(`test/summary/${res.session.sessionId}`, undefined, true);
    } else if (res.status === 'failed') {
      if (res.stale) setStaleError(res.error);
      else setSaveError(res.error);
    }
  };
  const run = async (build: (s: TestSession) => TestSession) => {
    const ctl = ctlRef.current;
    if (!ctl || ctl.busy || ctl.pending) return;
    setBusy(true);
    try {
      handle(await ctl.apply(build(ctl.current)));
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    const ctl = ctlRef.current;
    if (!ctl) return;
    setBusy(true);
    try {
      handle(await ctl.retry());
    } finally {
      setBusy(false);
    }
  };
  const pending = ctlRef.current?.pending ?? null;
  const locked = busy || pending !== null;
  const sum = summarize(session);

  const finish = () => {
    if (sum.pendingSelfEval > 0 && !window.confirm(`${plural(sum.pendingSelfEval, 'question ouverte reste', 'questions ouvertes restent')} à autoévaluer. Terminer quand même ?`)) return;
    void run((s) => finishCorrection(s, new Date().toISOString()));
  };

  return (
    <div className="page with-action-bar">
      <TopBar title="Correction du test" back="#/" />
      <p className="strong break">{currentScopeLabel(session, tax, labelRules)}</p>
      {session.timedOut && <p className="notice small">Temps écoulé : les questions restantes sont comptées comme non traitées.</p>}
      <p className="muted small" aria-live="polite">
        QCM : {sum.mcq.correct}/{sum.mcq.answered} justes · {plural(sum.pendingSelfEval, 'question ouverte', 'questions ouvertes')} à autoévaluer
      </p>
      {saveError && (
        <ErrorNotice
          message={`Enregistrement impossible : ${saveError}. Votre choix n'est pas perdu : réessayez.`}
          onRetry={pending ? () => void retry() : undefined}
          busy={busy}
        />
      )}

      {session.cardIds.slice(0, shown).map((id, i) => {
        const c = cards.get(id);
        const a = session.answers[id];
        return (
          <article key={id} className="card-block correction-item">
            <p className="qnum">
              Question {i + 1}
              {!a && ' · non traitée'}
            </p>
            {!c ? (
              <p className="muted">Chargement… (ou carte supprimée depuis le test)</p>
            ) : (
              <>
                <RichText text={c.question} className="question" />
                {c.options && (
                  <ol className="options readonly">
                    {c.options.map((o) => {
                      const chosen = a?.kind === 'mcq' && a.selectedOptionId === o.id;
                      const cls = o.id === c.correctOptionId ? 'option correct' : chosen ? 'option wrong' : 'option';
                      return (
                        <li key={o.id} className={cls}>
                          <span className="opt-letter">{o.id}</span>
                          <RichText text={o.text} />
                        </li>
                      );
                    })}
                  </ol>
                )}
                {a?.kind === 'mcq' && (
                  <p className={a.correct ? 'verdict ok' : 'verdict ko'}>
                    {a.correct ? 'Bonne réponse' : `Réponse incorrecte — la bonne réponse est ${c.correctOptionId})`}
                  </p>
                )}
                {c.formatQuestion !== 'mcq' && (
                  <>
                    <h3 className="label">Réponse</h3>
                    <RichText text={c.reponse} className="answer" />
                  </>
                )}
                {c.explication && (
                  <>
                    <h3 className="label">Explication</h3>
                    <RichText text={c.explication} />
                  </>
                )}
                {c.astucePiege && (
                  <>
                    <h3 className="label">Astuce / Piège</h3>
                    <RichText text={c.astucePiege} />
                  </>
                )}
                {a?.kind === 'deferred' && (
                  <>
                    <p className="eval-hint">Autoévaluation (ce n'est pas une correction objective)</p>
                    <div className="eval-grid">
                      {EVALS.map((e) => (
                        <button
                          key={e}
                          type="button"
                          className={`btn eval eval-${e}`}
                          disabled={locked}
                          onClick={() => void run((s) => evaluateDeferred(s, id, e, new Date().toISOString()))}
                        >
                          {SELF_EVAL_LABELS[e]}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {a?.kind === 'open' && <p className="muted">Votre autoévaluation : {SELF_EVAL_LABELS[a.selfEval]}</p>}
              </>
            )}
          </article>
        );
      })}
      {shown < session.cardIds.length && (
        <button type="button" className="btn secondary block" onClick={() => setShown((n) => n + PAGE)}>
          Afficher la suite ({session.cardIds.length - shown} questions)
        </button>
      )}

      <div className="action-bar">
        <button type="button" className="btn primary block" disabled={locked} onClick={finish}>
          {busy ? 'Enregistrement…' : 'Terminer et voir le bilan'}
        </button>
      </div>
    </div>
  );
}
