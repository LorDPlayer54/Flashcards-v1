import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles.css';
import { initPwa } from './pwa/register';
import { applyAppearance, cachedAppearance } from './settings/preferences';
import { App } from './ui/App';

// Lot 4 : application installable et hors connexion (service worker dans la version construite uniquement)
initPwa();
// Lot 4 : thème et taille du texte appliqués avant le premier affichage
const look = cachedAppearance();
if (look) applyAppearance(look);

const root = document.getElementById('root');
if (!root) throw new Error('Élément #root introuvable');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
