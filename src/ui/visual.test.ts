// Refonte UX/UI : fonctions pures d'affichage (monogrammes, heure du jour).
import { describe, expect, it } from 'vitest';
import { monogramOf, monogramsFor } from './monogram';
import { greeting, timeOfDay } from './timeOfDay';

describe('monogrammes', () => {
  it('initiales des mots significatifs, accents et mots-outils ignorés', () => {
    expect(monogramOf('Droit public')).toBe('DP');
    expect(monogramOf('Culture générale')).toBe('CG');
    expect(monogramOf('Économie')).toBe('EC');
    expect(monogramOf('Anglais')).toBe('AN');
    expect(monogramOf('Histoire de la France')).toBe('HF');
    expect(monogramOf('  économie   et   gestion ')).toBe('EG');
    expect(monogramOf('Calcul')).toBe('CA');
    expect(monogramOf('Droit')).toBe('DR');
  });
  it('collisions : variantes déterministes, toutes distinctes', () => {
    const m = monogramsFor(['Droit public', 'Droit pénal', 'Droit privé', 'Économie', 'Écologie']);
    expect(m.get('Droit public')).toBe('DP');
    expect(new Set(m.values()).size).toBe(5);
    expect(monogramsFor(['Droit pénal', 'Droit public']).get('Droit pénal')).toBe('DP');
    expect([...monogramsFor(['A', 'A b', 'A c']).values()].every((v) => v.length >= 1)).toBe(true);
  });
});

describe('heure du jour (indépendante du thème)', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 2, h, m);
  it('06:00 inclus → 18:00 exclu : Bonjour ; sinon Bonsoir', () => {
    expect(timeOfDay(at(5, 59))).toBe('evening');
    expect(timeOfDay(at(6, 0))).toBe('day');
    expect(timeOfDay(at(17, 59))).toBe('day');
    expect(timeOfDay(at(18, 0))).toBe('evening');
    expect(greeting('day')).toBe('Bonjour.');
    expect(greeting('evening')).toBe('Bonsoir.');
  });
});

import { streakOf, weekOf } from './regularity';

describe('régularité (Accueil V5)', () => {
  const days = (...d: string[]) => new Set(d);
  it('semaine du lundi au dimanche, jours futurs neutres', () => {
    const w = weekOf('2026-10-31', days('2026-10-27', '2026-10-31')); // samedi
    expect(w.map((d) => d.letter).join('')).toBe('LMMJVSD');
    expect(w[0]!.day).toBe('2026-10-26');
    expect(w.map((d) => d.state)).toEqual(['none', 'done', 'none', 'none', 'none', 'done', 'future']);
    expect(w.find((d) => d.isToday)!.day).toBe('2026-10-31');
    expect(weekOf('2026-11-02', days())[0]!.day).toBe('2026-11-02'); // lundi
  });
  it('série : depuis aujourd’hui si révisé, sinon depuis hier ; 0 sinon', () => {
    expect(streakOf('2026-10-31', days('2026-10-29', '2026-10-30', '2026-10-31'))).toBe(3);
    expect(streakOf('2026-10-31', days('2026-10-29', '2026-10-30'))).toBe(2);
    expect(streakOf('2026-10-31', days('2026-10-28', '2026-10-29'))).toBe(0);
    expect(streakOf('2026-11-01', days('2026-10-31', '2026-11-01', '2026-10-30'))).toBe(3); // changement de mois
  });
});

import { cardVisual } from './cardVisual';

describe('états visuels des cartes (dernière catégorie enregistrée)', () => {
  it('catégorie persistée, recatégorisations successives, retour QCM transitoire', () => {
    expect(cardVisual(undefined, null)).toEqual({ surface: 'neutral', badge: 'Jamais révisée', category: 'neutral' });
    const seq = (['again', 'hard', 'good', 'easy', 'again'] as const).map((c) => cardVisual(c, null));
    expect(seq.map((v) => v.surface)).toEqual(['again', 'hard', 'good', 'easy', 'again']);
    expect(seq.map((v) => v.badge)).toEqual(['À revoir', 'Difficile', 'Correct', 'Facile', 'À revoir']);
    const fb = cardVisual('hard', 'incorrect');
    expect(fb).toEqual({ surface: 'qcm-incorrect', badge: 'Réponse incorrecte', category: 'hard' });
    expect(cardVisual('hard', null).surface).toBe('hard'); // retour fermé : la catégorie enregistrée revient
  });
});
