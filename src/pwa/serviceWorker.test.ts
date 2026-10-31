// Lot 4 : génération du service worker (précache versionné, mise à jour contrôlée).
import { describe, expect, it } from 'vitest';
import { cacheName, precacheList, serviceWorkerSource } from './serviceWorker';

describe('service worker', () => {
  const bundle = ['index.html', 'assets/index-abc.js', 'assets/index-abc.css', 'assets/index-abc.js.map', 'assets/KaTeX_Main-Regular-x.woff2', 'assets/KaTeX_Main-Regular-x.woff', 'assets/KaTeX_Main-Regular-x.ttf'];
  const pub = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'sw.js'];

  it('précache : page, JavaScript, CSS, polices woff2, icônes et manifeste ; ni cartes sources ni sw.js', () => {
    expect(precacheList(bundle, pub)).toEqual([
      './apple-touch-icon.png',
      './assets/KaTeX_Main-Regular-x.woff2',
      './assets/index-abc.css',
      './assets/index-abc.js',
      './icon-192.png',
      './icon-512.png',
      './index.html',
      './manifest.webmanifest',
    ]);
  });

  it('nom du cache : change avec la version et avec le contenu de n’importe quel fichier', () => {
    const list = precacheList(bundle, pub);
    const a = cacheName('0.4.0', list, ['x', 'y']);
    expect(a).toMatch(/^flashcards-ena-0\.4\.0-[0-9a-f]{8}$/);
    expect(cacheName('0.4.0', list, ['x', 'y'])).toBe(a);
    expect(cacheName('0.4.1', list, ['x', 'y'])).not.toBe(a);
    expect(cacheName('0.4.0', list, ['x', 'z'])).not.toBe(a);
    expect(cacheName('0.4.0', [...list, './autre.png'], ['x', 'y'])).not.toBe(a);
  });

  it('source : précache à l’installation, ancien cache supprimé à l’activation, mise à jour seulement sur demande', () => {
    const src = serviceWorkerSource('0.4.0', precacheList(bundle, pub), ['x']);
    expect(src).toContain('const PRECACHE = ["./apple-touch-icon.png"');
    expect(src).toMatch(/addEventListener\('install'[\s\S]*caches\.open\(CACHE\)[\s\S]*addAll/);
    expect(src).toMatch(/addEventListener\('activate'[\s\S]*caches\.delete/);
    // skipWaiting uniquement sur message explicite (bouton « Mettre à jour »), jamais à l'installation
    const install = src.slice(src.indexOf("addEventListener('install'"), src.indexOf("addEventListener('activate'"));
    expect(install).not.toContain('skipWaiting');
    expect(src).toMatch(/SKIP_WAITING'\) self\.skipWaiting\(\)/);
    // Les requêtes vers d'autres origines et les écritures ne sont jamais interceptées
    expect(src).toContain("if (req.method !== 'GET') return;");
    expect(src).toContain('if (url.origin !== self.location.origin) return;');
    // Syntaxe valide
    expect(() => new Function(src)).not.toThrow();
  });
});
