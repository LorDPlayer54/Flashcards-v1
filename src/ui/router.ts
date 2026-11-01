// Routeur minimal par « hash » (#/library?n=…) : compatible GitHub Pages, sans dépendance.
import { useEffect, useState } from 'react';

export interface Route {
  /** Segments du chemin, ex. ['test', 'run', '<id>'] */
  path: string[];
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?', 2);
  return {
    path: pathPart.split('/').filter(Boolean).map((s) => decodeURIComponent(s)),
    query: new URLSearchParams(queryPart),
  };
}

/**
 * Pile de navigation interne (en mémoire) : permet de savoir d'où vient l'écran courant et de revenir sans boucle.
 * Un retour arrière du navigateur ramène à l'avant-dernière entrée ; navigate(..., replace) remplace le sommet.
 */
const stack: string[] = [];
let replacing = false;

export function trackHash(hash: string): void {
  const h = hash || '#/';
  if (replacing) {
    replacing = false;
    if (stack.length) stack[stack.length - 1] = h;
    else stack.push(h);
  } else if (stack.length >= 2 && stack[stack.length - 2] === h) stack.pop();
  else if (stack[stack.length - 1] !== h) stack.push(h);
}

/** Hash de l'écran précédent dans cette session, ou null (ouverture directe, rechargement). */
export function previousHash(): string | null {
  return stack.length >= 2 ? stack[stack.length - 2]! : null;
}

/** Revient à l'écran précédent s'il vaut `expected` (retour naturel), sinon remplace l'écran courant par `fallback`. */
export function goBackTo(fallback: string, accept: (prev: string) => boolean): void {
  const prev = previousHash();
  if (prev && accept(prev)) window.history.back();
  else replaceHash(fallback);
}

/** Remplace l'entrée d'historique courante par `target` (hash complet). */
export function replaceHash(target: string): void {
  if (target === window.location.hash) return;
  replacing = true;
  window.location.replace(target);
}

/**
 * Garde de navigation (formulaire modifié non enregistré). Tant qu'elle est active, tout changement d'écran par le
 * retour du navigateur ou du téléphone, un lien ou la barre de navigation est annulé et signalé : le formulaire reste
 * affiché avec ses valeurs, puis l'écran décide (abandonner ou continuer). L'historique est rétabli à l'identique :
 * - retour arrière : l'entrée du formulaire est remise au même rang (pushState, sans événement) ;
 * - lien : on revient sur l'entrée du formulaire (history.back), l'entrée ajoutée par le lien n'est plus active.
 */
export type BlockedNavigation = { kind: 'back' } | { kind: 'link'; hash: string };
interface NavigationGuard {
  hash: string;
  onBlocked: (b: BlockedNavigation) => void;
}
let guard: NavigationGuard | null = null;
let restoring = false;
let allowRender = true;

export function setNavigationGuard(hash: string, onBlocked: (b: BlockedNavigation) => void): () => void {
  const g = { hash, onBlocked };
  guard = g;
  return () => {
    if (guard === g) guard = null;
  };
}

export function clearNavigationGuard(): void {
  guard = null;
  restoring = false;
}

/** Poursuit une navigation bloquée, après confirmation de l'abandon. */
export function resumeNavigation(b: BlockedNavigation): void {
  clearNavigationGuard();
  if (b.kind === 'back') window.history.back();
  else window.location.hash = b.hash.slice(1);
}

/** Traite un changement de hash ; renvoie faux si l'écran affiché ne doit pas changer. */
export function handleHashChange(hash: string): boolean {
  const h = hash || '#/';
  if (restoring && guard && h === guard.hash) {
    restoring = false; // retour sur le formulaire après un lien bloqué : rien à afficher de nouveau
    return false;
  }
  if (guard && h !== guard.hash && !replacing) {
    const g = guard;
    if (stack.length >= 2 && stack[stack.length - 2] === h) {
      window.history.pushState(null, '', g.hash);
      g.onBlocked({ kind: 'back' });
    } else {
      restoring = true;
      window.history.back();
      g.onBlocked({ kind: 'link', hash: h });
    }
    return false;
  }
  trackHash(h);
  return true;
}

if (typeof window !== 'undefined') {
  trackHash(window.location.hash);
  // Enregistré avant celui de useRoute : décide si l'écran doit changer
  window.addEventListener('hashchange', () => {
    allowRender = handleHashChange(window.location.hash);
  });
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      if (!allowRender) return; // navigation bloquée par un formulaire modifié
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** Construit un lien interne. */
export function href(path: string, query?: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) q.set(k, v);
  const qs = q.toString();
  return `#/${path}${qs ? `?${qs}` : ''}`;
}

export function navigate(path: string, query?: Record<string, string | undefined>, replace = false): void {
  const target = href(path, query);
  if (replace) replaceHash(target);
  else window.location.hash = target.slice(1);
}

export function libraryHref(nodeId: string): string {
  return nodeId === 'root' ? href('library') : href('library', { n: nodeId });
}
