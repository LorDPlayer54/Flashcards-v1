// v0.4.1 : annonce d'une restauration aux autres onglets. Chaque import du module (après vi.resetModules) joue le rôle
// d'un onglet distinct ; BroadcastChannel est celui de Node, localStorage, window et document sont simulés et partagés.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Channel = typeof import('./channel');

class Storage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const NativeBroadcastChannel = globalThis.BroadcastChannel;
let win: EventTarget;
let doc: EventTarget & { visibilityState: string };

async function openTab(opts: { broadcast?: boolean } = {}): Promise<Channel> {
  vi.resetModules();
  vi.stubGlobal('BroadcastChannel', opts.broadcast === false ? undefined : NativeBroadcastChannel);
  const tab = await import('./channel');
  tab.subscribeDataReplaced(() => undefined); // démarre l'écoute, comme l'application au chargement
  vi.stubGlobal('BroadcastChannel', NativeBroadcastChannel);
  return tab;
}
const delivered = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('localStorage', new Storage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('restauration dans un autre onglet', () => {
  it('les autres onglets sont bloqués dès le début de la restauration, jamais l’onglet qui restaure', async () => {
    const a = await openTab();
    const b = await openTab();
    const c = await openTab();
    const seen: (string | null)[] = [];
    b.subscribeDataReplaced(() => seen.push(b.dataReplacedPhase()));

    a.announceRestore('restore-started');
    await delivered();
    expect(b.dataReplacedPhase()).toBe('restore-started');
    expect(c.dataReplacedPhase()).toBe('restore-started');
    expect(a.dataReplacedPhase()).toBeNull();

    a.announceRestore('data-replaced');
    await delivered();
    expect(b.dataReplacedPhase()).toBe('data-replaced');
    expect(c.dataReplacedPhase()).toBe('data-replaced');
    expect(a.dataReplacedPhase()).toBeNull();
    expect(seen).toEqual(['restore-started', 'data-replaced']);
  });

  it('restauration annulée : les autres onglets restent bloqués avec le bon message ; « remplacées » ne s’efface pas', async () => {
    const a = await openTab();
    const b = await openTab();
    a.announceRestore('restore-started');
    a.announceRestore('restore-aborted');
    await delivered();
    expect(b.dataReplacedPhase()).toBe('restore-aborted');

    a.announceRestore('data-replaced');
    await delivered();
    a.announceRestore('restore-aborted');
    await delivered();
    expect(b.dataReplacedPhase()).toBe('data-replaced');
  });

  it('sans BroadcastChannel ou onglet suspendu : l’annonce est retrouvée au retour au premier plan', async () => {
    const b = await openTab({ broadcast: false });
    const a = await openTab();
    a.announceRestore('data-replaced');
    await delivered();
    expect(b.dataReplacedPhase()).toBeNull(); // rien reçu par le canal
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(b.dataReplacedPhase()).toBe('data-replaced');
  });

  it('une annonce antérieure à l’ouverture de l’onglet est ignorée', async () => {
    const a = await openTab();
    a.announceRestore('data-replaced');
    const b = await openTab(); // ouvert après la restauration : données déjà à jour
    win.dispatchEvent(new Event('focus'));
    doc.dispatchEvent(new Event('visibilitychange'));
    await delivered();
    expect(b.dataReplacedPhase()).toBeNull();
  });

  it('message étranger ou mal formé : ignoré', async () => {
    const b = await openTab();
    const ch = new NativeBroadcastChannel('flashcards-ena');
    ch.postMessage({ type: 'autre-chose', from: 'x' });
    ch.postMessage('texte');
    ch.postMessage(null);
    ch.close();
    await delivered();
    expect(b.dataReplacedPhase()).toBeNull();
  });
});
