import { useEffect, useRef, useState } from 'react';
import { useDataReplaced, type ReplacePhase } from '../backup/channel';
import { applyUpdate, usePwa } from '../pwa/register';
import { AppProvider } from './AppContext';
import { BottomNav, errorMessage } from './components/common';
import { useRoute } from './router';
import { CardDetail } from './screens/CardDetail';
import { CardEdit } from './screens/CardEdit';
import { Home } from './screens/Home';
import { Import } from './screens/Import';
import { Labels } from './screens/Labels';
import { Library } from './screens/Library';
import { Guide } from './screens/Guide';
import { More } from './screens/More';
import { Program } from './screens/Program';
import { ReviewSetup } from './screens/ReviewSetup';
import { Restore } from './screens/Restore';
import { Search } from './screens/Search';
import { Stats } from './screens/Stats';
import { TestCorrection } from './screens/TestCorrection';
import { TestRun } from './screens/TestRun';
import { TestSetup } from './screens/TestSetup';
import { TestSummary } from './screens/TestSummary';

/** Filet de sécurité (I6) : toute erreur asynchrone non interceptée est signalée au lieu de passer inaperçue. */
function GlobalErrorBanner() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => setMessage(errorMessage(e.reason));
    const onError = (e: ErrorEvent) => setMessage(e.message || 'erreur inconnue');
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);
  if (!message) return null;
  return (
    <div className="notice error global-error" role="alert">
      <p>Une erreur inattendue est survenue : {message}</p>
      <button type="button" className="btn secondary small" onClick={() => window.location.reload()}>
        Recharger la page
      </button>{' '}
      <button type="button" className="btn ghost small" onClick={() => setMessage(null)}>
        Fermer
      </button>
    </div>
  );
}

const REPLACED_TEXT: Record<ReplacePhase, string> = {
  'restore-started':
    "Une restauration de sauvegarde est en cours dans un autre onglet. Cette page est bloquée pour protéger les données : rechargez-la une fois la restauration terminée.",
  'data-replaced':
    "Les données ont été remplacées par une restauration dans un autre onglet. Cette page n'est plus à jour : rechargez-la pour continuer.",
  'restore-aborted':
    "La restauration lancée dans un autre onglet a été annulée ; les données n'ont pas été modifiées. Rechargez cette page pour continuer.",
};

/**
 * v0.4.1 : écran bloquant affiché quand une restauration a lieu dans un autre onglet. Le reste de l'application est
 * rendu inerte (ni clic, ni clavier, ni lecteur d'écran) et la connexion à la base est fermée (AppContext) :
 * seul le rechargement est possible.
 */
function ReplacedOverlay({ phase }: { phase: ReplacePhase }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
    // Le focus clavier reste sur le seul bouton disponible.
    const keep = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        button.current?.focus();
      }
    };
    document.addEventListener('keydown', keep, true);
    return () => document.removeEventListener('keydown', keep, true);
  }, []);
  return (
    <div className="blocking-overlay" role="alertdialog" aria-modal="true" aria-labelledby="blocking-title" aria-describedby="blocking-text">
      <div className="blocking-card">
        <h2 id="blocking-title">Page à recharger</h2>
        <p id="blocking-text">{REPLACED_TEXT[phase]}</p>
        <button ref={button} type="button" className="btn primary block" onClick={() => window.location.reload()}>
          Recharger la page
        </button>
      </div>
    </div>
  );
}

/**
 * Lot 4 : bandeaux système. Nouvelle version prête (mise à jour seulement à la demande, jamais pendant un test),
 * passage hors connexion. (Restauration dans un autre onglet : écran bloquant, v0.4.1.)
 */
function SystemBanners({ inTest }: { inTest: boolean }) {
  const pwa = usePwa();
  const [later, setLater] = useState(false);
  const [offlineSeen, setOfflineSeen] = useState(false);
  useEffect(() => {
    if (pwa.online) setOfflineSeen(false);
  }, [pwa.online]);
  return (
    <>
      {pwa.updateReady && !later && !inTest && (
        <div className="notice system-banner" role="status">
          <p>Une nouvelle version de l'application est disponible. Vos données sont conservées.</p>
          <button type="button" className="btn primary small" onClick={applyUpdate}>
            Mettre à jour
          </button>{' '}
          <button type="button" className="btn ghost small" onClick={() => setLater(true)}>
            Plus tard
          </button>
        </div>
      )}
      {!pwa.online && !offlineSeen && (
        <div className="notice small system-banner" role="status">
          Hors connexion : l'application fonctionne normalement, vos données restent sur l'appareil.{' '}
          <button type="button" className="btn ghost small" onClick={() => setOfflineSeen(true)}>
            OK
          </button>
        </div>
      )}
    </>
  );
}

function Screen() {
  const route = useRoute();
  const [a, b, c] = route.path;
  let screen;
  let showNav = true;

  if (!a) screen = <Home />;
  else if (a === 'library') screen = <Library route={route} key={route.query.get('n') ?? 'root'} />;
  else if (a === 'card' && b === 'new') screen = <CardEdit nodeId={route.query.get('n') ?? undefined} key={`new-${route.query.toString()}`} />;
  else if (a === 'card' && b && c === 'edit') screen = <CardEdit cardId={b} key={`edit-${b}`} />;
  else if (a === 'card' && b) screen = <CardDetail cardId={b} key={b} />;
  else if (a === 'search') screen = <Search />;
  else if (a === 'import') screen = <Import />;
  else if (a === 'more') screen = <More route={route} />;
  else if (a === 'guide') screen = <Guide route={route} key={route.path.join('/')} />;
  else if (a === 'restore') screen = <Restore />;
  else if (a === 'stats') screen = <Stats route={route} key={route.query.toString()} />;
  else if (a === 'labels') screen = <Labels route={route} key={route.query.toString()} />;
  else if (a === 'program') screen = <Program route={route} key={route.query.toString()} />;
  else if (a === 'review') screen = <ReviewSetup route={route} key={route.query.toString()} />;
  else if (a === 'test' && b === 'setup') screen = <TestSetup route={route} key={route.query.toString()} />;
  else if (a === 'test' && b === 'run' && c) {
    screen = <TestRun sessionId={c} key={c} />;
    showNav = false; // plein écran pendant un test
  } else if (a === 'test' && b === 'correction' && c) screen = <TestCorrection sessionId={c} key={c} />;
  else if (a === 'test' && b === 'summary' && c) screen = <TestSummary sessionId={c} key={c} />;
  else
    screen = (
      <div className="page">
        <p className="notice">Page introuvable.</p>
        <a className="btn primary block" href="#/">
          Accueil
        </a>
      </div>
    );

  return (
    <div className={showNav ? 'app has-nav' : 'app'}>
      <GlobalErrorBanner />
      <SystemBanners inTest={!showNav || (a === 'test' && b === 'correction')} />
      <main>{screen}</main>
      {showNav && <BottomNav route={route} />}
    </div>
  );
}

export function App() {
  const replaced = useDataReplaced();
  return (
    <>
      <div className="app-root" inert={replaced !== null}>
        <AppProvider>
          <Screen />
        </AppProvider>
      </div>
      {replaced && <ReplacedOverlay phase={replaced} />}
    </>
  );
}
