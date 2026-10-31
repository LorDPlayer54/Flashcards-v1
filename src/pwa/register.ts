// Lot 4 : enregistrement du service worker et état de l'application installable.
// - enregistré seulement dans la version construite (pas en développement) ;
// - mise à jour : la nouvelle version attend ; l'application le signale et ne recharge qu'à la demande
//   (« Mettre à jour ») ; les autres onglets ouverts se rechargent aussi pour rester cohérents ;
// - première installation : aucun rechargement ;
// - recherche de mise à jour au retour au premier plan et toutes les heures.
import { useSyncExternalStore } from 'react';

export interface PwaState {
  /** Service worker pris en charge et enregistré (version construite) */
  supported: boolean;
  /** Application disponible hors connexion (service worker actif) */
  offlineReady: boolean;
  /** Une nouvelle version est prête et attend l'accord de l'utilisatrice */
  updateReady: boolean;
  online: boolean;
  /** Installation proposée par le navigateur (Chrome, Edge sur Android et ordinateur) */
  canInstall: boolean;
  /** Application ouverte en mode installé */
  standalone: boolean;
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let state: PwaState = {
  supported: false,
  offlineReady: false,
  updateReady: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  canInstall: false,
  standalone: false,
};
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | null = null;
let installEvent: InstallPromptEvent | null = null;

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

function watchWorker(worker: ServiceWorker | null, hadController: boolean) {
  if (!worker) return;
  const check = () => {
    if (worker.state === 'installed') set(hadController ? { updateReady: true } : { offlineReady: true });
    if (worker.state === 'activated') set({ offlineReady: true });
  };
  check();
  worker.addEventListener('statechange', check);
}

export function initPwa(): void {
  if (typeof window === 'undefined') return;
  set({
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
  });
  window.addEventListener('online', () => set({ online: true }));
  window.addEventListener('offline', () => set({ online: false }));
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as InstallPromptEvent;
    set({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    set({ canInstall: false });
  });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const hadController = Boolean(sw.controller);
  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    // Une nouvelle version vient de prendre le relais (accord donné ici ou dans un autre onglet)
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    sw.register('./sw.js', { scope: './' })
      .then((reg) => {
        registration = reg;
        set({ supported: true, offlineReady: Boolean(reg.active) });
        if (reg.waiting && hadController) set({ updateReady: true });
        watchWorker(reg.installing, hadController);
        reg.addEventListener('updatefound', () => watchWorker(reg.installing, Boolean(sw.controller)));
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
        });
        window.setInterval(() => void reg.update().catch(() => undefined), 3_600_000);
      })
      .catch(() => set({ supported: false }));
  });
}

/** Active la version en attente ; la page se recharge quand elle a pris le relais. */
export function applyUpdate(): void {
  const waiting = registration?.waiting;
  if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** Recherche immédiate d'une nouvelle version. Renvoie false si aucune recherche n'est possible. */
export async function checkForUpdate(): Promise<boolean> {
  if (!registration) return false;
  await registration.update();
  return true;
}

/** Ouvre la proposition d'installation du navigateur, si disponible. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!installEvent) return 'unavailable';
  await installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  set({ canInstall: false });
  return outcome;
}
