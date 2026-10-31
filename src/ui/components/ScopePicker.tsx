// Lot 3A : choix de plusieurs niveaux de la bibliothèque (matières, thèmes, leçons, notions) pour un test.
// Liste arborescente dépliable, cases à cocher larges ; cocher un niveau inclut tous ses sous-niveaux.
import { useMemo, useState } from 'react';
import { LEVEL_LABELS, ROOT_ID, type TaxNode, type Taxonomy } from '../../taxonomy/tree';

export function ScopePicker({
  tax,
  initial,
  onConfirm,
  onCancel,
}: {
  tax: Taxonomy;
  initial: readonly string[];
  onConfirm: (nodeIds: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  // Dépliés par défaut : les ancêtres des niveaux déjà choisis
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const e = new Set<string>();
    for (const id of initial) {
      let cur = tax.byId.get(id)?.parentId;
      while (cur) {
        e.add(cur);
        cur = tax.byId.get(cur)?.parentId;
      }
    }
    return e;
  });

  /** Vrai si un ancêtre est coché (le niveau est alors inclus d'office) */
  const coveredByAncestor = (n: TaxNode): boolean => {
    let cur = n.parentId;
    while (cur) {
      if (selected.has(cur)) return true;
      cur = tax.byId.get(cur)?.parentId;
    }
    return false;
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Ne garde que les niveaux les plus hauts cochés (un descendant d'un niveau coché est redondant) */
  const normalized = useMemo(() => {
    if (selected.has(ROOT_ID)) return [ROOT_ID];
    return [...selected].filter((id) => {
      const n = tax.byId.get(id);
      return n !== undefined && !coveredByAncestor(n);
    });
  }, [selected, tax]);

  const total = useMemo(() => {
    if (normalized.includes(ROOT_ID)) return tax.root.total;
    return normalized.reduce((t, id) => t + (tax.byId.get(id)?.total ?? 0), 0);
  }, [normalized, tax]);

  const renderNode = (n: TaxNode) => {
    const covered = selected.has(ROOT_ID) || coveredByAncestor(n);
    const checked = covered || selected.has(n.id);
    const open = expanded.has(n.id);
    return (
      <li key={n.id}>
        <div className="picker-row">
          <label>
            <input type="checkbox" checked={checked} disabled={covered} onChange={() => toggle(n.id)} />
            <span className="row-main">
              {n.label}
              <span className="row-sub">
                {LEVEL_LABELS[n.kind]} · {n.total} carte{n.total > 1 ? 's' : ''}
              </span>
            </span>
          </label>
          {n.children.length > 0 && (
            <button
              type="button"
              className="icon-btn"
              aria-expanded={open}
              aria-label={open ? `Replier ${n.label}` : `Déplier ${n.label}`}
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(n.id)) next.delete(n.id);
                  else next.add(n.id);
                  return next;
                })
              }
            >
              {open ? '˄' : '˅'}
            </button>
          )}
        </div>
        {open && n.children.length > 0 && <ul className="picker-children">{n.children.map(renderNode)}</ul>}
      </li>
    );
  };

  return (
    <section className="card-block">
      <h3 className="label">Choisir le périmètre</h3>
      <p className="muted small">Cochez un ou plusieurs niveaux, dans une ou plusieurs matières. Une carte n'est jamais posée deux fois.</p>
      <ul className="list">
        <li>
          <div className="picker-row">
            <label>
              <input type="checkbox" checked={selected.has(ROOT_ID)} onChange={() => toggle(ROOT_ID)} />
              <span className="row-main">
                Toutes les matières
                <span className="row-sub">{tax.root.total} cartes</span>
              </span>
            </label>
          </div>
        </li>
        {tax.root.children.map(renderNode)}
      </ul>
      <p className="small" aria-live="polite">
        {normalized.length === 0 ? 'Aucun niveau choisi.' : `${normalized.length} niveau(x) choisi(s) · ${total} carte(s) avant filtres`}
      </p>
      <div className="button-stack">
        <button type="button" className="btn primary block" disabled={normalized.length === 0} onClick={() => onConfirm(normalized)}>
          Valider le périmètre
        </button>
        <button type="button" className="btn ghost block" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </section>
  );
}
