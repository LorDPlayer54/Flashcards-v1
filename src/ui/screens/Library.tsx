// Bibliothèque (refonte UX/UI, référence Bibliothèque V1 figée).
// Racine : recherche (matières, puis texte des cartes via le moteur de recherche existant), accès à « Mon programme
// étudié », liste des matières avec monogrammes. Niveaux : consultation hiérarchique, deux actions principales
// (Lancer un test, Réviser) et les autres actions existantes dans « Plus d'actions ». Aucune case « étudié » ici.
import { useEffect, useMemo, useState } from 'react';
import { planReview } from '../../review/queue';
import { nodeProgress } from '../../program/studied';
import type { Card } from '../../domain/types';
import { getCards } from '../../storage/repo';
import { comparable } from '../../domain/text';
import { breadcrumb, cardsDirectlyAt, LEVEL_LABELS, nearestExistingNode, ROOT_ID, type TaxNode } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, formatLabel, Icon, Monogram, plural, TopBar } from '../components/common';
import { monogramsFor } from '../monogram';
import { href, libraryHref, navigate, type Route } from '../router';
import { useReviewData } from '../useReview';
import { presetSearch } from './Search';

const PAGE = 30;

function childSummary(c: TaxNode): string {
  const kinds = new Set(c.children.map((x) => x.kind));
  const sub = c.children.length
    ? `${c.children.length} ${kinds.size === 1 ? LEVEL_LABELS[c.children[0]!.kind].toLowerCase() + (c.children.length > 1 ? 's' : '') : c.children.length > 1 ? 'éléments' : 'élément'} · `
    : '';
  return `${sub}${plural(c.total, 'carte', 'cartes')}`;
}

export function Library({ route }: { route: Route }) {
  const { db, metas, tax, studied, studiedUnits } = useApp();
  const nodeId = route.query.get('n') ?? ROOT_ID;
  const node = tax.byId.get(nodeId);
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const review = useReviewData();
  const reviewCount = useMemo(() => {
    const d = review.data;
    if (!d || !node) return null;
    // v1.1.0 : la révision programmée ne porte que sur le programme étudié
    const scoped = node.id === ROOT_ID ? studied : studied.filter((m) => tax.pathOf.get(m.cardId)?.includes(node.id));
    const p = planReview(scoped, d.states, d.today, d.newRemaining);
    return { due: p.due.length, fresh: p.fresh.length };
  }, [review.data, node, studied, tax]);
  const program = useMemo(() => (node ? nodeProgress(tax, node.id, studiedUnits) : null), [tax, node, studiedUnits]);
  const monos = useMemo(() => monogramsFor(tax.root.children.map((c) => c.label)), [tax]);

  const direct = useMemo(() => (node ? cardsDirectlyAt(tax, metas, node.id) : []), [tax, metas, node]);
  const [shown, setShown] = useState(PAGE);
  const [cards, setCards] = useState<Card[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setShown(PAGE);
    setCards([]);
    setMenuOpen(false);
  }, [nodeId]);
  useEffect(() => {
    let alive = true;
    setLoadError(null);
    getCards(db, direct.slice(0, shown).map((m) => m.cardId))
      .then((c) => alive && setCards(c))
      .catch((e: unknown) => alive && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [db, direct, shown, attempt]);

  // v1.1.1 : niveau disparu (ex. dernière carte supprimée) → redirection vers le plus proche niveau existant
  const fallback = node ? null : nearestExistingNode(tax, nodeId);
  useEffect(() => {
    if (fallback !== null) navigate('library', { n: fallback === ROOT_ID ? undefined : fallback, gone: '1' }, true);
  }, [fallback]);
  const gone = route.query.get('gone') === '1';

  if (!node) return <div className="page center muted">Chargement…</div>;

  const crumbs = breadcrumb(tax, node.id);
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2]! : null;
  const isRoot = node.id === ROOT_ID;
  const q = comparable(query.trim());
  const subjects = isRoot ? tax.root.children.filter((c) => !q || comparable(c.label).includes(q)) : [];
  const nOrUndef = isRoot ? undefined : node.id;

  const searchCards = () => {
    presetSearch(query.trim());
    navigate('search');
  };

  const menu = (
    <div className="more-actions">
      <button type="button" className="btn ghost small more-toggle" aria-expanded={menuOpen} aria-controls="level-actions" onClick={() => setMenuOpen((o) => !o)}>
        Plus d'actions
        <svg className="chev-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div id="level-actions" className="head-links" hidden={!menuOpen}>
        <a className="menu-row" href={href('stats', { n: nOrUndef })}>
          Statistiques
        </a>
        <a className="menu-row" href={href('card/new', { n: nOrUndef })}>
          Ajouter une carte
        </a>
        {node.children.length > 1 && (
          <a className="menu-row" href={href('labels', { n: node.id })}>
            Fusionner des libellés
          </a>
        )}
        {program && !isRoot && (
          <a className="menu-row program-summary" href={href('program', { n: node.id })}>
            Mon programme étudié : {program.studiedUnits} notion{program.studiedUnits > 1 ? 's' : ''} sur {program.totalUnits}
          </a>
        )}
        {isRoot && (
          <a className="menu-row" href={href('import')}>
            Importer d'autres fichiers CSV
          </a>
        )}
      </div>
    </div>
  );

  return (
    <div className="page library">
      {isRoot ? (
        <TopBar eyebrow="Flashcard" title="Bibliothèque" lead="Retrouvez vos matières et explorez vos cartes." />
      ) : (
        <div className="top-row">
          <a className="back-link" href={libraryHref(parent!.id)}>
            <Icon name="back" />
            {parent!.id === ROOT_ID ? 'Bibliothèque' : parent!.label}
          </a>
        </div>
      )}

      {route.query.get('merged') && (
        <p className="notice small" role="status">
          Fusion effectuée : {plural(Number(route.query.get('merged')), 'carte reclassée', 'cartes reclassées')} sous « {node.label} ».
        </p>
      )}
      {gone && (
        <p className="notice small" role="status">
          Le niveau consulté n'existe plus (sa dernière carte a été supprimée) : voici le niveau le plus proche.
        </p>
      )}

      {isRoot ? (
        node.total === 0 ? (
          <section className="card-block empty-state">
            <p className="strong">Votre bibliothèque est vide.</p>
            <p className="muted small">Importez vos fichiers CSV pour retrouver ici vos matières, thèmes et notions.</p>
            <a className="btn primary block" href={href('import')}>
              Importer des flashcards
            </a>
            <a className="btn secondary block" href={href('card/new')}>
              Ajouter une carte à la main
            </a>
          </section>
        ) : (
          <>
            <div className="search-field">
              <Icon name="search" />
              <input
                type="search"
                inputMode="search"
                placeholder="Matière ou mot d'une carte"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && query.trim() && searchCards()}
                aria-label="Rechercher une matière ou une carte"
              />
              {query && (
                <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Effacer la recherche">
                  ×
                </button>
              )}
            </div>
            {query.trim() && (
              <button type="button" className="row-link search-cards" onClick={searchCards}>
                <span>
                  <span className="strong">Rechercher « {query.trim()} » dans les cartes</span>
                  <span className="row-sub">Question, réponse, explication</span>
                </span>
                <Icon name="chevron" />
              </button>
            )}
            {!query && (
              <a className="row-link program-entry program-summary" href={href('program')}>
                <span>
                  <span className="strong">Mon programme étudié</span>
                  <span className="row-sub">
                    {program && program.studiedUnits > 0
                      ? `${program.studiedUnits} notion${program.studiedUnits > 1 ? 's' : ''} sur ${program.totalUnits} indiquées comme vues en cours`
                      : 'Indiquer les notions vues en cours'}
                  </span>
                </span>
                <Icon name="chevron" />
              </a>
            )}
            <div className="section-head list-head">
              <h2 className="home-subtitle">Mes matières</h2>
              <span className="muted small">{plural(subjects.length, 'matière', 'matières')}</span>
            </div>
            {subjects.length === 0 ? (
              <p className="muted">
                Aucune matière ne correspond.{' '}
                <button type="button" className="btn ghost small" onClick={() => setQuery('')}>
                  Effacer
                </button>
              </p>
            ) : (
              <ul className="list">
                {subjects.map((c) => (
                  <li key={c.id}>
                    <a className="list-row subject-row" href={libraryHref(c.id)}>
                      <Monogram text={monos.get(c.label) ?? '?'} />
                      <span className="row-main">
                        <span className="row-title">{c.label}</span>
                        <span className="row-sub">{childSummary(c)}</span>
                      </span>
                      <Icon name="chevron" className="chev" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {menu}
          </>
        )
      ) : (
        <>
          {crumbs.length > 2 && (
            <nav className="crumbs" aria-label="Fil d'Ariane">
              {crumbs.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && <span className="crumb-sep">›</span>}
                  {i < crumbs.length - 1 ? <a href={libraryHref(c.id)}>{c.id === ROOT_ID ? 'Tout' : c.label}</a> : <span>{c.label}</span>}
                </span>
              ))}
            </nav>
          )}
          <section className="level-head">
            <p className="pretitle">Bibliothèque · {LEVEL_LABELS[node.kind]}</p>
            <h2 className="level-title">{node.label}</h2>
            <p className="muted small">{plural(node.total, 'carte', 'cartes')} dans cet ensemble · Consultation libre</p>
            <div className="head-actions">
              <a className="btn primary" href={href('test/setup', { n: node.id })}>
                Lancer un test
              </a>
              <a className="btn secondary" href={href('review', { n: node.id })}>
                {reviewCount ? `Réviser (${reviewCount.due} à revoir · ${reviewCount.fresh} nouvelle${reviewCount.fresh > 1 ? 's' : ''})` : 'Réviser'}
              </a>
            </div>
            {menu}
          </section>

          {node.children.length > 0 && (
            <section>
              <div className="section-head list-head">
                <h3 className="home-subtitle">
                  {node.children.every((c) => c.kind === node.children[0]!.kind) ? `${LEVEL_LABELS[node.children[0]!.kind]}s` : 'Sous-niveaux'}
                </h3>
                <span className="muted small">{plural(node.children.length, 'élément', 'éléments')}</span>
              </div>
              <ul className="list">
                {node.children.map((c) => (
                  <li key={c.id}>
                    <a className="list-row" href={libraryHref(c.id)}>
                      <span className="row-main">
                        <span className="row-title">{c.label}</span>
                        <span className="row-sub">{childSummary(c)}</span>
                      </span>
                      <Icon name="chevron" className="chev" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {direct.length > 0 && (
            <section>
              <div className="section-head list-head">
                <h3 className="home-subtitle">{node.children.length > 0 ? 'Cartes rattachées directement' : 'Cartes'}</h3>
                <span className="muted small">{plural(direct.length, 'carte', 'cartes')}</span>
              </div>
              {loadError && <ErrorNotice message={`Impossible d'afficher les cartes : ${loadError}`} onRetry={() => setAttempt((a) => a + 1)} />}
              <ul className="list">
                {cards.map((c) => (
                  <li key={c.cardId}>
                    <a className="list-row card-row" href={href(`card/${encodeURIComponent(c.cardId)}`)}>
                      <span className="row-main">
                        <span className="clamp">{c.question}</span>
                        <span className="row-sub">
                          {formatLabel(c.formatQuestion)}
                          {c.difficulte && ` · ${c.difficulte}`}
                          {c.externalId && ` · ${c.externalId}`}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              {shown < direct.length && (
                <button type="button" className="btn secondary block" onClick={() => setShown((s) => s + PAGE)}>
                  Afficher plus ({direct.length - shown} restantes)
                </button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
