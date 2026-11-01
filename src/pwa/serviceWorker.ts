// Lot 4 : génération du service worker au moment du build (voir vite.config.ts). Fonctions pures, testées.
//
// Stratégie :
//  - précache versionné : tous les fichiers de l'application (page, JavaScript, CSS, polices KaTeX woff2, icônes,
//    manifeste) sont enregistrés à l'installation, dans un cache dont le nom dépend de la version et du contenu ;
//  - « cache d'abord » : l'application s'ouvre et fonctionne sans connexion ; une navigation sert la page
//    précachée ; une ressource absente du précache (police de repli) est cherchée sur le réseau puis mise en cache ;
//  - les données (IndexedDB) ne passent jamais par le service worker ni par le réseau ;
//  - mise à jour CONTRÔLÉE : une nouvelle version s'installe en arrière-plan puis attend ; l'application propose
//    « Mettre à jour » et ne recharge qu'avec l'accord de l'utilisatrice (message SKIP_WAITING) ; l'ancien cache
//    est supprimé à l'activation de la nouvelle version ;
//  - première installation : activation immédiate (aucune version précédente à remplacer).
import { fnv1a } from '../domain/text';

export const CACHE_PREFIX = 'flashcards-ena-';

/** Fichiers à précacher, à partir des fichiers produits par le build et du dossier public. */
export function precacheList(bundleFiles: readonly string[], publicFiles: readonly string[]): string[] {
  const keep = (f: string) =>
    f === 'index.html' ||
    /\.(js|css|webmanifest|png|svg|ico)$/.test(f) ||
    // Polices KaTeX : seul le format woff2 (utilisé par tous les navigateurs récents) est précaché
    /\.woff2$/.test(f);
  const files = [...new Set([...bundleFiles, ...publicFiles])].filter((f) => keep(f) && !f.endsWith('.map') && f !== 'sw.js');
  return files.sort().map((f) => `./${f}`);
}

/**
 * Nom du cache : version de l'application + empreinte du CONTENU des fichiers précachés (`contents`, dans l'ordre de
 * `precache`). Toute modification d'un fichier change le nom du cache, donc le service worker : le navigateur
 * détecte la mise à jour.
 */
export function cacheName(appVersion: string, precache: readonly string[], contents: readonly string[] = []): string {
  return `${CACHE_PREFIX}${appVersion}-${fnv1a(precache.join('\n') + '\u0000' + contents.map((c) => fnv1a(c)).join(''))}`;
}

export function serviceWorkerSource(appVersion: string, precache: readonly string[], contents: readonly string[] = []): string {
  const cache = cacheName(appVersion, precache, contents);
  return `// Service worker Flashcard ${appVersion} — généré au build (src/pwa/serviceWorker.ts). Ne pas modifier.
const CACHE = ${JSON.stringify(cache)};
const PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const PRECACHE = ${JSON.stringify(precache)};
const INDEX = new URL('./index.html', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(new URL(u, self.location).href, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION' && event.ports[0]) event.ports[0].postMessage({ version: ${JSON.stringify(appVersion)}, cache: CACHE });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Page de l'application : version précachée (fonctionne hors connexion, cohérente avec ses fichiers)
    event.respondWith(caches.match(INDEX).then((r) => r || fetch(req)));
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`;
}
