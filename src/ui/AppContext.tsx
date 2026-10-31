// État global : base ouverte, projection des cartes, arbre, collections.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CardMeta, Collection, ScopeSpec, TestConfig } from '../domain/types';
import { dataReplacedPhase, subscribeDataReplaced } from '../backup/channel';
import { openFlashcardsDb, type DB } from '../storage/db';
import { getLabelRules, getSetting, listCollections, loadAllMeta, setSetting } from '../storage/repo';
import type { LabelRule } from '../taxonomy/labelMerge';
import { APPEARANCE_KEY, applyAppearance, cacheAppearance, DEFAULT_APPEARANCE, parseAppearance, type Appearance } from '../settings/preferences';
import { buildTaxonomy, type Taxonomy } from '../taxonomy/tree';

interface LibraryState {
  metas: CardMeta[];
  tax: Taxonomy;
  collections: Collection[];
  /** Lot 4 : fusions de libellés mémorisées (affichage des périmètres renommés depuis une séance) */
  labelRules: LabelRule[];
}

interface AppContextValue extends LibraryState {
  db: DB;
  /** Recharge la projection après un import, une suppression… */
  reload: () => Promise<void>;
  /** Périmètre transmis à l'écran de configuration (recherche, « Refaire les erreurs ») */
  pendingScope: ScopeSpec | null;
  setPendingScope: (s: ScopeSpec | null) => void;
  /** Lot 3A : réglages à reprendre pour « Refaire un test sur ce périmètre » */
  pendingConfig: TestConfig | null;
  setPendingConfig: (c: TestConfig | null) => void;
  /** Lot 3B : thème et taille du texte (appliqués immédiatement, enregistrés dans la base) */
  appearance: Appearance;
  setAppearance: (a: Appearance) => Promise<void>;
}

const Ctx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp doit être utilisé dans <AppProvider>');
  return v;
}

async function loadLibrary(db: DB): Promise<LibraryState> {
  const [metas, collections, labelRules] = await Promise.all([loadAllMeta(db), listCollections(db), getLabelRules(db).catch(() => [])]);
  return { metas, tax: buildTaxonomy(metas), collections, labelRules };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB | null>(null);
  const [lib, setLib] = useState<LibraryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingScope, setPendingScope] = useState<ScopeSpec | null>(null);
  const [pendingConfig, setPendingConfig] = useState<TestConfig | null>(null);
  const [appearance, setAppearanceState] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!('indexedDB' in window)) throw new Error("Ce navigateur ne permet pas le stockage local (IndexedDB).");
        const opened = await openFlashcardsDb();
        // Préférences d'affichage : un échec de lecture garde l'affichage par défaut (thème du système)
        const pref = parseAppearance(await getSetting(opened, APPEARANCE_KEY, null).catch(() => null));
        if (!cancelled) {
          applyAppearance(pref);
          cacheAppearance(pref);
          setAppearanceState(pref);
        }
        const state = await loadLibrary(opened);
        // v0.4.1 : restauration dans un autre onglet → connexion fermée, plus aucune écriture possible ici.
        const closeIfReplaced = () => {
          if (dataReplacedPhase() !== null) opened.close();
        };
        subscribeDataReplaced(closeIfReplaced);
        closeIfReplaced();
        if (cancelled) opened.close();
        else {
          setDb(opened);
          setLib(state);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!db) return;
    setLib(await loadLibrary(db));
  }, [db]);

  const setAppearance = useCallback(
    async (a: Appearance) => {
      if (!db) return;
      await setSetting(db, APPEARANCE_KEY, a); // enregistré d'abord : l'affichage ne change que si le réglage est conservé
      applyAppearance(a);
      cacheAppearance(a);
      setAppearanceState(a);
    },
    [db],
  );

  const value = useMemo<AppContextValue | null>(
    () => (db && lib ? { db, ...lib, reload, pendingScope, setPendingScope, pendingConfig, setPendingConfig, appearance, setAppearance } : null),
    [db, lib, reload, pendingScope, pendingConfig, appearance, setAppearance],
  );

  if (error) {
    return (
      <div className="page">
        <h1>Stockage indisponible</h1>
        <p className="notice error">{error}</p>
        <p>Essayez un autre navigateur (Chrome, Safari, Firefox) et évitez la navigation privée.</p>
      </div>
    );
  }
  if (!value) {
    return (
      <div className="page center">
        <p className="muted">Chargement de la bibliothèque…</p>
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
