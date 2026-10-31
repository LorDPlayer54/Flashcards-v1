// Lot 4 : prévient les autres onglets ouverts qu'une restauration remplace les données.
// v0.4.1 : les autres onglets sont bloqués jusqu'à leur rechargement et ne peuvent plus rien écrire.
//
// Déroulement : l'onglet qui restaure annonce « restauration en cours » AVANT d'écrire, puis « données remplacées »
// (ou « restauration annulée »). Dès la première annonce, chaque autre onglet affiche un écran bloquant et ferme sa
// connexion IndexedDB : aucune écriture, même automatique (fin de chronomètre), ne peut plus partir de cet onglet.
// Transport : BroadcastChannel (mécanisme déjà utilisé au lot 4). En complément, la même annonce est inscrite dans
// localStorage : l'événement `storage` couvre les navigateurs sans BroadcastChannel, et la vérification au retour
// au premier plan couvre un onglet suspendu par le téléphone au moment de l'annonce.
import { useSyncExternalStore } from 'react';

const NAME = 'flashcards-ena';
const STAMP_KEY = 'flashcards-ena:restore';
const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

export type ReplacePhase = 'restore-started' | 'data-replaced' | 'restore-aborted';
interface Announce {
  type: ReplacePhase;
  from: string;
  at: string;
}

const isPhase = (t: unknown): t is ReplacePhase => t === 'restore-started' || t === 'data-replaced' || t === 'restore-aborted';

function readStamp(): Announce | null {
  try {
    const raw = localStorage.getItem(STAMP_KEY);
    const a = raw ? (JSON.parse(raw) as Partial<Announce>) : null;
    return a && isPhase(a.type) && typeof a.from === 'string' && typeof a.at === 'string' ? (a as Announce) : null;
  } catch {
    return null;
  }
}

// État de cet onglet : null tant qu'aucune restauration n'a eu lieu ailleurs depuis son ouverture.
let phase: ReplacePhase | null = null;
let known = readStamp()?.at ?? null; // annonce déjà présente à l'ouverture : ancienne, ignorée
const listeners = new Set<() => void>();

function receive(a: Announce | null): void {
  if (!a || a.from === TAB_ID) return;
  known = a.at;
  // Une fois bloqué, l'onglet le reste jusqu'au rechargement ; seul le message affiché évolue.
  if (phase === 'data-replaced' && a.type !== 'data-replaced') return;
  phase = a.type;
  for (const l of listeners) l();
}

let started = false;
function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  try {
    const ch = new BroadcastChannel(NAME);
    ch.onmessage = (e: MessageEvent) => {
      const d = e.data as Partial<Announce> | null;
      if (d && isPhase(d.type) && typeof d.from === 'string') receive({ type: d.type, from: d.from, at: d.at ?? new Date().toISOString() });
    };
  } catch {
    // BroadcastChannel indisponible : l'événement storage prend le relais
  }
  window.addEventListener('storage', (e) => {
    if (e.key === STAMP_KEY) receive(readStamp());
  });
  const check = () => {
    const a = readStamp();
    if (a && a.at !== known) receive(a);
  };
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

/** Onglet qui restaure : annonce une étape aux autres onglets (jamais à lui-même). */
export function announceRestore(type: ReplacePhase): void {
  const a: Announce = { type, from: TAB_ID, at: `${new Date().toISOString()}#${TAB_ID}#${type}` };
  known = a.at;
  try {
    localStorage.setItem(STAMP_KEY, JSON.stringify(a));
  } catch {
    // stockage indisponible : BroadcastChannel seul
  }
  try {
    const ch = new BroadcastChannel(NAME);
    ch.postMessage(a);
    ch.close();
  } catch {
    // BroadcastChannel indisponible : l'événement storage prend le relais
  }
}

/** Délai laissé aux autres onglets pour se bloquer avant la première écriture de la restauration. */
export const BLOCK_GRACE_MS = 250;

/** Abonnement à l'état « données remplacées ailleurs » (null si rien). */
export function subscribeDataReplaced(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dataReplacedPhase(): ReplacePhase | null {
  return phase;
}

export function useDataReplaced(): ReplacePhase | null {
  return useSyncExternalStore(subscribeDataReplaced, dataReplacedPhase, () => null);
}

/** Tests uniquement : remet l'état de l'onglet à zéro. */
export function resetDataReplacedForTests(): void {
  phase = null;
  known = readStamp()?.at ?? null;
}
