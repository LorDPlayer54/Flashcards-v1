import { describe, expect, it } from 'vitest';
import { GUIDE, articleById, type Block } from './articles';

function texts(blocks: Block[]): string[] {
  return blocks.flatMap((b) => {
    switch (b.t) {
      case 'p':
      case 'note':
        return [b.text];
      case 'section':
        return [b.title, ...texts(b.blocks)];
      case 'steps':
        return b.items.flatMap((i) => [i.title, i.text]);
      case 'grades':
        return b.items.flatMap((i) => [i.title, i.text]);
      case 'tools':
        return b.items.map((i) => i.title);
      case 'list':
        return b.items;
    }
  });
}

describe('guide embarqué', () => {
  it('dix articles aux identifiants uniques, liens connexes valides', () => {
    expect(GUIDE).toHaveLength(10);
    expect(new Set(GUIDE.map((a) => a.id)).size).toBe(10);
    for (const a of GUIDE) for (const r of a.related ?? []) expect(articleById(r)).toBeDefined();
  });

  it('cinq accès directs dans « Bien démarrer », boutons de préparation dans Révision et Test libre', () => {
    const start = articleById('start')!;
    const tools = start.blocks.flatMap((b) => (b.t === 'section' ? b.blocks : [])).filter((b) => b.t === 'tools');
    expect(tools).toHaveLength(1);
    expect(tools[0]!.t === 'tools' && tools[0]!.items.map((i) => i.target)).toEqual(['library', 'program', 'review', 'test', 'import']);
    expect(articleById('review')!.cta).toEqual({ label: 'Démarrer une révision', target: 'review' });
    expect(articleById('test')!.cta).toEqual({ label: 'Démarrer un test libre', target: 'test' });
  });

  it('ne contient pas les phrases retirées, ni de formule chiffrée de l’algorithme', () => {
    const all = GUIDE.flatMap((a) => [a.title, a.intro, ...texts(a.blocks)]).join('\n');
    expect(all).not.toMatch(/nombre de jours fixe/);
    expect(all).not.toMatch(/consultable hors connexion une fois/);
    expect(all).not.toMatch(/\b(SRS|IndexedDB)\b/);
    expect(texts(articleById('algorithm')!.blocks).join(' ')).not.toMatch(/\d+ jours/);
  });
});
