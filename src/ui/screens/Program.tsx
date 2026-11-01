// « Mon programme étudié » (v1.1.0 ; refonte UX/UI, référence Programme étudié V2 figée).
// Paramétrage global et permanent : l'utilisatrice coche ce qu'elle a étudié ; seules ces notions alimentent la
// révision programmée. Arbre dépliable (matière, thème, leçon, notion) avec recherche, cases à trois états,
// enregistrement immédiat de chaque case. Logique inchangée : src/program/studied.ts (correctif de normalisation compris).
import { useMemo, useState } from 'react';
import { comparable } from '../../domain/text';
import { nodeProgress, progressOf, setUnits, unitsUnder, type CheckState } from '../../program/studied';
import { breadcrumb, ROOT_ID, type TaxNode } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, Icon, Monogram, plural, Ring, TopBar } from '../components/common';
import { monogramsFor } from '../monogram';
import { href, type Route } from '../router';

function TriBox({ state, label, disabled, onToggle }: { state: CheckState; label: string; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'}
      aria-label={label}
      className={`tri-box ${state}`}
      disabled={disabled}
      onClick={onToggle}
    >
      <span aria-hidden="true">{state === 'all' ? '✓' : state === 'some' ? '–' : ''}</span>
    </button>
  );
}

/** Le niveau ou l'un de ses sous-niveaux correspond à la recherche */
function matches(n: TaxNode, q: string): boolean {
  return comparable(n.label).includes(q) || n.children.some((c) => matches(c, q));
}

export function Program({ route }: { route: Route }) {
  const { tax, studiedUnits, setStudiedUnits } = useApp();
  const requested = route.query.get('n');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Dépliés au départ : les ancêtres du niveau demandé (lien depuis un niveau de la bibliothèque), et ce niveau
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const e = new Set<string>();
    if (requested && tax.byId.has(requested)) for (const n of breadcrumb(tax, requested)) if (n.id !== ROOT_ID) e.add(n.id);
    return e;
  });
  const monos = useMemo(() => monogramsFor(tax.root.children.map((c) => c.label)), [tax]);

  const toggle = async (units: string[], current: CheckState) => {
    if (saving || units.length === 0) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // Partiel ou vide → tout cocher ; complet → tout décocher
      await setStudiedUnits(setUnits(studiedUnits, units, current !== 'all'));
      setSaved(true);
    } catch (e) {
      setError(`Le programme n'a pas pu être enregistré (${errorMessage(e)}). Aucun changement n'a été appliqué.`);
    } finally {
      setSaving(false);
    }
  };

  const all = nodeProgress(tax, ROOT_ID, studiedUnits);
  const q = comparable(query.trim());
  const isOpen = (id: string) => (q ? true : expanded.has(id));
  const flip = (id: string) =>
    setExpanded((e) => {
      const n = new Set(e);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const renderNode = (n: TaxNode, depth: number): React.ReactNode => {
    if (q && !matches(n, q)) return null;
    const units = unitsUnder(tax, n.id);
    const p = progressOf(tax, units, studiedUnits);
    const leaf = n.children.length === 0;
    const open = !leaf && isOpen(n.id);
    const stateLabel = p.state === 'all' ? 'étudié' : p.state === 'some' ? 'partiellement étudié' : 'non étudié';
    const own = n.direct > 0 && n.children.length > 0 ? progressOf(tax, [n.id], studiedUnits) : null;
    return (
      <li key={n.id} className={`tree-item depth-${Math.min(depth, 3)}`}>
        <div className={`program-row${leaf ? ' leaf' : ''}`}>
          {leaf ? (
            <span className="tree-bullet" aria-hidden="true" />
          ) : (
            <button type="button" className="tree-toggle" aria-expanded={open} aria-label={`${open ? 'Replier' : 'Déplier'} ${n.label}`} onClick={() => flip(n.id)}>
              <svg className="chev-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          )}
          {depth === 0 && <Monogram text={monos.get(n.label) ?? '?'} size="sm" />}
          <span className="row-main">
            <span className="row-title">{n.label}</span>
            <span className="row-sub">
              {leaf ? plural(p.totalCards, 'carte', 'cartes') : `${p.studiedUnits} / ${p.totalUnits} notion${p.totalUnits > 1 ? 's étudiées' : ' étudiée'}`}
            </span>
          </span>
          <TriBox state={p.state} label={`${n.label} : ${stateLabel}`} disabled={saving} onToggle={() => void toggle(units, p.state)} />
        </div>
        {open && (
          <ul className="tree-children">
            {n.children.map((c) => renderNode(c, depth + 1))}
            {own && (!q || comparable('cartes sans notion').includes(q) || comparable(n.label).includes(q)) && (
              <li className={`tree-item depth-${Math.min(depth + 1, 3)}`}>
                <div className="program-row leaf">
                  <span className="tree-bullet" aria-hidden="true" />
                  <span className="row-main">
                    <span className="row-title">Cartes sans notion</span>
                    <span className="row-sub">{plural(own.totalCards, 'carte', 'cartes')}</span>
                  </span>
                  <TriBox
                    state={own.state}
                    label={`Cartes sans notion de « ${n.label} » : ${own.state === 'all' ? 'étudié' : 'non étudié'}`}
                    disabled={saving}
                    onToggle={() => void toggle([n.id], own.state)}
                  />
                </div>
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const shownSubjects = tax.root.children.filter((c) => !q || matches(c, q));

  return (
    <div className="page program">
      <TopBar title="Mon programme étudié" back={href('library')} backLabel="Bibliothèque" lead="Sélectionnez les notions que vous avez déjà vues en cours." />

      {tax.root.total === 0 ? (
        <section className="card-block">
          <p>La bibliothèque est vide. Importez d'abord vos flashcards.</p>
          <a className="btn primary block" href={href('import')}>
            Importer des flashcards
          </a>
        </section>
      ) : (
        <>
          <section className="progress-card">
            <div>
              <p className="progress-eyebrow">
                <span className="dot" aria-hidden="true" />
                Mon avancement
              </p>
              <p className="progress-figure">
                <strong>{all.studiedUnits}</strong> / {all.totalUnits}
              </p>
              <p className="muted small">notions déclarées étudiées</p>
            </div>
            <Ring ratio={all.totalUnits ? all.studiedUnits / all.totalUnits : 0} />
          </section>

          <div className="search-field">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Rechercher dans le programme"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Rechercher une matière, un thème, une leçon ou une notion"
            />
            {query && (
              <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Effacer la recherche">
                ×
              </button>
            )}
          </div>

          <div className="section-head list-head">
            <h2 className="group-title">Matières</h2>
            <span className="small muted" role="status" aria-live="polite">
              {error ? '' : saving ? 'Enregistrement…' : saved ? 'Enregistré' : plural(shownSubjects.length, 'matière', 'matières')}
            </span>
          </div>
          {error && <ErrorNotice message={error} />}
          {shownSubjects.length === 0 ? (
            <p className="muted">Aucun élément ne correspond à « {query.trim()} ».</p>
          ) : (
            <ul className="list tree">{shownSubjects.map((c) => renderNode(c, 0))}</ul>
          )}
        </>
      )}
    </div>
  );
}
