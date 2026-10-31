import { readdirSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { precacheList, serviceWorkerSource } from './src/pwa/serviceWorker';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };
/** Version construite : celle de package.json (APP_VERSION permet de produire une version de test, ex. scénario de mise à jour) */
const version = process.env.APP_VERSION || pkg.version;

/**
 * Lot 4 : génère dist/sw.js avec la liste exacte des fichiers produits par le build (précache versionné).
 * Rien n'est généré en développement : le service worker n'est enregistré que dans la version construite.
 */
function serviceWorkerPlugin(version: string): Plugin {
  return {
    name: 'flashcards-service-worker',
    apply: 'build',
    enforce: 'post', // après la production de index.html
    generateBundle(_options, bundle) {
      const publicDir = new URL('./public/', import.meta.url);
      const publicFiles = readdirSync(publicDir);
      // index.html est toujours produit ; il est ajouté explicitement quel que soit l'ordre des greffons
      const precache = precacheList(['index.html', ...Object.keys(bundle)], publicFiles);
      // Contenu de chaque fichier précaché (empreinte du cache)
      const contents = precache.map((p) => {
        const name = p.slice(2);
        const out = bundle[name];
        if (out) return out.type === 'chunk' ? out.code : typeof out.source === 'string' ? out.source : Buffer.from(out.source).toString('base64');
        return publicFiles.includes(name) ? readFileSync(new URL(name, publicDir)).toString('base64') : '';
      });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(version, precache, contents) });
    },
  };
}

// base './' : chemins relatifs, compatibles avec GitHub Pages (lot 4)
export default defineConfig({
  base: './',
  // Lot 4 : version de l'application (affichée, inscrite dans les sauvegardes)
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), serviceWorkerPlugin(version)],
  // React + KaTeX (polices incluses) dépassent 500 ko non compressés ; acceptable pour une application locale.
  build: { chunkSizeWarningLimit: 900 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
