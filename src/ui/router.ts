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

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
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
  if (replace) window.location.replace(target);
  else window.location.hash = target.slice(1);
}

export function libraryHref(nodeId: string): string {
  return nodeId === 'root' ? href('library') : href('library', { n: nodeId });
}
