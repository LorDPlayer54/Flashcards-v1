import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openFlashcardsDb as openDB } from '../storage/db';
import { getSetting, setSetting } from '../storage/repo';
import { CORRECTION_PREF_KEY, LAST_TEST_CONFIG_KEY, loadCorrectionPref, resolveCorrectionPref } from './preferences';

describe('Switch V3 : préférence de correction', () => {
  it('résolution', () => {
    expect(resolveCorrectionPref('immediate', 'end')).toEqual({ mode: 'immediate', migrate: false });
    expect(resolveCorrectionPref('end', 'immediate')).toEqual({ mode: 'end', migrate: false });
    expect(resolveCorrectionPref('last', 'end')).toEqual({ mode: 'end', migrate: true });
    expect(resolveCorrectionPref('last', undefined)).toEqual({ mode: 'immediate', migrate: true });
    expect(resolveCorrectionPref('last', 'bizarre')).toEqual({ mode: 'immediate', migrate: true });
    expect(resolveCorrectionPref(null, 'end')).toEqual({ mode: 'immediate', migrate: false });
  });
  it('migre une fois l’ancien « last » et ne suit plus le dernier test ensuite', async () => {
    const db = await openDB(`pref-${Math.random()}`);
    await setSetting(db, CORRECTION_PREF_KEY, 'last');
    await setSetting(db, LAST_TEST_CONFIG_KEY, { correction: 'end' });
    expect(await loadCorrectionPref(db)).toBe('end');
    expect(await getSetting(db, CORRECTION_PREF_KEY, null)).toBe('end');
    await setSetting(db, LAST_TEST_CONFIG_KEY, { correction: 'immediate' });
    expect(await loadCorrectionPref(db)).toBe('end');
  });
  it('sans préférence : immédiate, quel que soit le dernier test', async () => {
    const db = await openDB(`pref-${Math.random()}`);
    await setSetting(db, LAST_TEST_CONFIG_KEY, { correction: 'end' });
    expect(await loadCorrectionPref(db)).toBe('immediate');
  });
});
