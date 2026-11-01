// Garde de navigation d'un formulaire modifié (retour du navigateur ou du téléphone, liens), sans DOM réel.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let router: typeof import('./router');

beforeAll(async () => {
  vi.stubGlobal('window', {
    location: { hash: '#/library' },
    history: { pushState: (_s: unknown, _t: string, url: string) => calls.push(`push ${url}`), back: () => calls.push('back') },
    addEventListener: () => undefined,
  });
  router = await import('./router');
});

describe('garde de navigation', () => {
  it('retour arrière bloqué : formulaire rétabli au même rang, puis abandon = un seul retour', () => {
    const r = router;
    r.handleHashChange('#/card/c1');
    r.handleHashChange('#/card/c1/edit');
    const blocked: unknown[] = [];
    const release = r.setNavigationGuard('#/card/c1/edit', (b) => blocked.push(b));
    expect(r.handleHashChange('#/card/c1')).toBe(false); // retour matériel
    expect(blocked).toEqual([{ kind: 'back' }]);
    expect(calls.pop()).toBe('push #/card/c1/edit');
    expect(r.previousHash()).toBe('#/card/c1'); // historique inchangé : pas d'entrée en trop
    // Lien (barre de navigation) : retour sur l'entrée du formulaire, puis événement de retour ignoré
    expect(r.handleHashChange('#/stats')).toBe(false);
    expect(blocked[1]).toEqual({ kind: 'link', hash: '#/stats' });
    expect(calls.pop()).toBe('back');
    expect(r.handleHashChange('#/card/c1/edit')).toBe(false);
    expect(r.previousHash()).toBe('#/card/c1');
    // Abandon confirmé : la garde est levée et le retour aboutit sans boucle
    release();
    r.resumeNavigation({ kind: 'back' });
    expect(calls.pop()).toBe('back');
    expect(r.handleHashChange('#/card/c1')).toBe(true);
    expect(r.previousHash()).toBe('#/library');
  });
  it('sans garde (aucune modification), le retour est normal', () => {
    const r = router;
    r.clearNavigationGuard();
    r.handleHashChange('#/card/c2');
    r.handleHashChange('#/card/c2/edit');
    expect(r.handleHashChange('#/card/c2')).toBe(true);
  });
});
