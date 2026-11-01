// Collections et suppression ciblée V2 : arbre par collection, cases à trois états, confirmation, suppression atomique.
// La sélection repose sur les IDENTIFIANTS de cartes et de collections, jamais sur des libellés. Rien n'est écrit avant
// la confirmation finale ; l'écriture revalide l'instantané affiché dans la transaction (repo.deleteSelection).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardMeta, Collection } from '../../domain/types';
import { deleteSelection, type DeletionTarget } from '../../storage/repo';
import { pathKeyOf } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { errorMessage, Icon, num, plural, SavedNotice } from './common';

interface TreeNode {
  key: string;
  label: string;
  cardIds: string[];
  children: TreeNode[];
}

/** Arbre matière › thème › leçon › notion construit sur les seules cartes de CETTE collection. */
function buildTree(metas: readonly CardMeta[]): TreeNode[] {
  const root = new Map<string, TreeNode & { map: Map<string, TreeNode & { map: Map<string, unknown> }> }>();
  const roots: TreeNode[] = [];
  const index = new Map<string, TreeNode>();
  for (const m of metas) {
    let parent: TreeNode | null = null;
    let path = '';
    for (const label of [m.matiere, m.theme, m.lecon, m.notion]) {
      if (!label) break;
      path += `\u001f${label}`;
      let node = index.get(path);
      if (!node) {
        node = { key: path, label, cardIds: [], children: [] };
        index.set(path, node);
        (parent ? parent.children : roots).push(node);
      }
      node.cardIds.push(m.cardId);
      parent = node;
    }
  }
  void root;
  return roots;
}

function TriCheck({ state, label, onChange, disabled }: { state: 'all' | 'some' | 'none'; label: string; onChange: () => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return <input ref={ref} type="checkbox" className="del-check" aria-label={label} checked={state === 'all'} disabled={disabled} onChange={onChange} />;
}

export function CollectionsManager({ collections, onSelecting }: { collections: Collection[]; onSelecting?: (on: boolean) => void }) {
  const { db, metas, reload } = useApp();
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [whole, setWhole] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error' | 'changed' | 'refresh'; text: string } | null>(null);

  const byCollection = useMemo(() => {
    const m = new Map<string, CardMeta[]>();
    for (const c of metas) (m.get(c.collectionId) ?? m.set(c.collectionId, []).get(c.collectionId)!).push(c);
    return m;
  }, [metas]);
  const trees = useMemo(() => new Map<string, TreeNode[]>(), [byCollection]);
  const treeOf = (id: string) => trees.get(id) ?? trees.set(id, buildTree(byCollection.get(id) ?? [])).get(id)!;

  useEffect(() => onSelecting?.(selecting), [selecting]);

  const setSelection = (next: Set<string>, nextWhole: Set<string>) => {
    setSel(next);
    setWhole(nextWhole);
  };
  const stateOf = (ids: readonly string[]): 'all' | 'some' | 'none' => {
    let n = 0;
    for (const id of ids) if (sel.has(id)) n++;
    return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
  };
  const toggleCards = (collectionId: string, ids: readonly string[]) => {
    const next = new Set(sel);
    const allIn = ids.length > 0 && ids.every((id) => next.has(id));
    for (const id of ids) allIn ? next.delete(id) : next.add(id);
    const nextWhole = new Set(whole);
    if (allIn) nextWhole.delete(collectionId); // un geste partiel ne désigne jamais la collection entière
    setSelection(next, nextWhole);
  };
  const toggleWhole = (collectionId: string) => {
    const ids = (byCollection.get(collectionId) ?? []).map((m) => m.cardId);
    const next = new Set(sel);
    const nextWhole = new Set(whole);
    if (nextWhole.has(collectionId)) {
      nextWhole.delete(collectionId);
      for (const id of ids) next.delete(id);
    } else {
      nextWhole.add(collectionId);
      for (const id of ids) next.add(id);
    }
    setSelection(next, nextWhole);
  };
  const selectAll = () => setSelection(new Set(metas.filter((m) => byCollection.has(m.collectionId)).map((m) => m.cardId)), new Set(collections.map((c) => c.collectionId)));
  const clear = () => setSelection(new Set(), new Set());
  const stop = () => {
    clear();
    setSelecting(false);
    setConfirming(false);
  };

  // Collections concernées : choisies en entier, ou avec au moins une carte choisie
  const concerned = collections.filter((c) => whole.has(c.collectionId) || (byCollection.get(c.collectionId) ?? []).some((m) => sel.has(m.cardId)));
  const wholeList = concerned.filter((c) => whole.has(c.collectionId));
  const partialList = concerned.filter((c) => !whole.has(c.collectionId));
  const totalCards = sel.size;

  const run = async () => {
    setBusy(true);
    setNotice(null);
    const targets: DeletionTarget[] = concerned.map((c) => {
      const ms = byCollection.get(c.collectionId) ?? [];
      const all = ms.map((m) => m.cardId);
      const paths = Object.fromEntries(ms.map((m) => [m.cardId, pathKeyOf(m)]));
      return { collectionId: c.collectionId, whole: whole.has(c.collectionId), snapshot: all, cardIds: all.filter((id) => sel.has(id)), paths };
    });
    let outcome;
    try {
      outcome = await deleteSelection(db, targets);
    } catch (e) {
      setBusy(false);
      setConfirming(false);
      setNotice({ kind: 'error', text: `Suppression impossible. Aucune carte n'a été supprimée (${errorMessage(e)}). Vous pouvez réessayer.` });
      return;
    }
    setBusy(false);
    setConfirming(false);
    if (outcome.status === 'changed') {
      // Rien n'a été supprimé : l'affichage est actualisé et la sélection doit être refaite
      clear();
      try {
        await reload();
      } catch {
        // l'utilisatrice peut actualiser manuellement
      }
      setNotice({ kind: 'changed', text: "Les données ont changé depuis l'affichage de votre sélection (cartes ajoutées, retirées ou reclassées). Aucune carte n'a été supprimée : vérifiez de nouveau votre sélection puis confirmez." });
      return;
    }
    const text = `${plural(outcome.cards, 'carte supprimée', 'cartes supprimées')}, ${plural(outcome.wholeCollections, 'collection supprimée', 'collections supprimées')}.`;
    clear();
    setSelecting(false);
    try {
      await reload();
      setNotice({ kind: 'ok', text });
    } catch {
      setNotice({ kind: 'refresh', text });
    }
  };

  const retryRefresh = async () => {
    try {
      await reload();
      setNotice(null);
    } catch {
      // la suppression est terminée ; seul l'affichage reste à actualiser
    }
  };

  const renderNode = (collectionId: string, n: TreeNode, depth: number) => {
    const state = stateOf(n.cardIds);
    const isOpen = open.has(`${collectionId}${n.key}`);
    return (
      <li key={n.key} className="del-node" style={{ paddingLeft: `${depth * 14}px` }}>
        <div className="del-row">
          {selecting && <TriCheck state={state} label={`${n.label} : ${plural(n.cardIds.length, 'carte', 'cartes')}`} onChange={() => toggleCards(collectionId, n.cardIds)} disabled={busy} />}
          {n.children.length > 0 ? (
            <button type="button" className="del-toggle" aria-expanded={isOpen} onClick={() => setOpen((o) => toggleKey(o, `${collectionId}${n.key}`))}>
              <Icon name="chevron" />
              <span>{n.label}</span>
            </button>
          ) : (
            <span className="del-leaf">{n.label}</span>
          )}
          <span className="del-count">{num(n.cardIds.length)}</span>
        </div>
        {isOpen && n.children.length > 0 && <ul className="del-tree">{n.children.map((c) => renderNode(collectionId, c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <section className="more-block">
      <div className="simple-head">
        <h2>Collections</h2>
        {collections.length > 0 &&
          (selecting ? (
            <button type="button" className="text-button" onClick={stop} disabled={busy}>
              Terminer
            </button>
          ) : (
            <button type="button" className="text-button" onClick={() => setSelecting(true)}>
              Sélectionner
            </button>
          ))}
      </div>
      {notice?.kind === 'ok' && (
        <p className="notice" role="status">
          {notice.text}
        </p>
      )}
      {notice?.kind === 'error' && (
        <p className="notice error" role="alert">
          {notice.text}
        </p>
      )}
      {notice?.kind === 'changed' && (
        <p className="notice error" role="alert">
          {notice.text}
        </p>
      )}
      {notice?.kind === 'refresh' && <SavedNotice title="Suppression terminée" message={`${notice.text} La liste n'a pas pu être actualisée : la suppression ne sera pas relancée.`} onRefresh={() => void retryRefresh()} />}
      {selecting && (
        <p className="del-tools">
          <button type="button" className="text-button" onClick={selectAll} disabled={busy}>
            Tout sélectionner
          </button>
          <button type="button" className="text-button" onClick={clear} disabled={busy || sel.size + whole.size === 0}>
            Effacer
          </button>
        </p>
      )}
      {collections.length === 0 ? (
        <p className="recent-empty">Aucune collection.</p>
      ) : (
        <ul className="del-collections">
          {collections.map((c) => {
            const ids = (byCollection.get(c.collectionId) ?? []).map((m) => m.cardId);
            const state: 'all' | 'some' | 'none' = whole.has(c.collectionId) ? 'all' : stateOf(ids) === 'none' ? 'none' : 'some';
            const isOpen = open.has(c.collectionId);
            return (
              <li key={c.collectionId} className="del-collection">
                <div className="del-row">
                  {selecting && <TriCheck state={state} label={`Collection ${c.name} : ${plural(ids.length, 'carte', 'cartes')}`} onChange={() => toggleWhole(c.collectionId)} disabled={busy} />}
                  <button type="button" className="del-toggle strong" aria-expanded={isOpen} onClick={() => setOpen((o) => toggleKey(o, c.collectionId))} disabled={ids.length === 0}>
                    <Icon name="chevron" />
                    <span>
                      {c.name}
                      <small>{plural(c.sourceFiles.length, 'fichier importé', 'fichiers importés')}</small>
                    </span>
                  </button>
                  <span className="del-count">{num(ids.length)}</span>
                </div>
                {isOpen && <ul className="del-tree">{treeOf(c.collectionId).map((n) => renderNode(c.collectionId, n, 0))}</ul>}
              </li>
            );
          })}
        </ul>
      )}

      {selecting && (
        <div className="action-bar deletion-bar">
          <p aria-live="polite">
            <strong>{plural(totalCards, 'carte sélectionnée', 'cartes sélectionnées')}</strong>
            {concerned.length > 0 && <span> · {plural(concerned.length, 'collection', 'collections')}</span>}
          </p>
          <button type="button" className="btn danger block" disabled={busy || concerned.length === 0} onClick={() => setConfirming(true)}>
            Supprimer la sélection…
          </button>
        </div>
      )}

      {confirming && (
        <div className="modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && !busy && setConfirming(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="del-title">
            <h2 id="del-title">Supprimer définitivement ?</h2>
            <p>
              <strong>{plural(totalCards, 'carte sera supprimée', 'cartes seront supprimées')}</strong>, dans {plural(concerned.length, 'collection', 'collections')}. Cette action est irréversible.
            </p>
            {wholeList.length > 0 && (
              <p>
                <strong>{plural(wholeList.length, 'collection entière', 'collections entières')}</strong> (supprimée avec son registre) : {wholeList.map((c) => `« ${c.name} »`).join(', ')}.
              </p>
            )}
            {partialList.length > 0 && (
              <p>
                <strong>{plural(partialList.length, 'collection partielle', 'collections partielles')}</strong> (conservée) :{' '}
                {partialList.map((c) => `« ${c.name} » (${num((byCollection.get(c.collectionId) ?? []).filter((m) => sel.has(m.cardId)).length)} sur ${num((byCollection.get(c.collectionId) ?? []).length)})`).join(', ')}.
              </p>
            )}
            <p className="muted small">
              Les états de mémorisation de ces cartes sont supprimés avec elles ; l'historique des séances est conservé. Réimporter un fichier plus tard peut les rajouter. Une sauvegarde existante permet de restaurer vos données.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn secondary block" onClick={() => setConfirming(false)} disabled={busy} autoFocus>
                Annuler
              </button>
              <button type="button" className="btn danger block" onClick={() => void run()} disabled={busy}>
                {busy ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function toggleKey(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}
