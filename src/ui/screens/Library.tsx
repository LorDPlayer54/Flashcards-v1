// Parcours hiérarchique : chaque niveau affiche ses descendants, son nombre de cartes et « Lancer un test ».
import { useEffect, useMemo, useState } from 'react';
import { planReview } from '../../review/queue';
import type { Card } from '../../domain/types';
import { getCards } from '../../storage/repo';
import { breadcrumb, cardsDirectlyAt, LEVEL_LABELS, nearestExistingNode, ROOT_ID } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, formatLabel, plural, TopBar } from '../components/common';
import { href, libraryHref, navigate, type Route } from '../router';
import { useReviewData } from '../useReview';

const PAGE = 30;

export function Library({ route }: { route: Route }) {
  const { db, metas, tax } = useApp();
  const nodeId = route.query.get('n') ?? ROOT_ID;
  const node = tax.byId.get(nodeId);

  const review = useReviewData();
  const reviewCount = useMemo(() => {
    const d = review.data;
    if (!d || !node) return null;
    const scoped = node.id === ROOT_ID ? metas : metas.filter((m) => tax.pathOf.get(m.cardId)?.includes(node.id));
    const p = planReview(scoped, d.states, d.today, d.newRemaining);
    return { due: p.due.length, fresh: p.fresh.length };
  }, [review.data, node, metas, tax]);

  const direct = useMemo(() => (node ? cardsDirectlyAt(tax, metas, node.id) : []), [tax, metas, node]);
  const [shown, setShown] = useState(PAGE);
  const [cards, setCards] = useState<Card[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setShown(PAGE);
    setCards([]);
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

  return (
    <div className="page">
      <TopBar title={node.id === ROOT_ID ? 'Bibliothèque' : LEVEL_LABELS[node.kind]} back={parent ? libraryHref(parent.id) : undefined} />

      {crumbs.length > 1 && (
        <nav className="crumbs" aria-label="Fil d'Ariane">
          {crumbs.map((c, i) => (
            <span key={c.id}>
              {i > 0 && <span className="crumb-sep">›</span>}
              {i < crumbs.length - 1 ? <a href={libraryHref(c.id)}>{c.id === ROOT_ID ? 'Tout' : c.label}</a> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
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

      <section className="level-head">
        <h2>{node.label}</h2>
        <p className="muted">{plural(node.total, 'carte', 'cartes')}</p>
        {node.total > 0 ? (
          <div className="head-actions">
            <a className="btn primary block" href={href('test/setup', { n: node.id })}>
              Lancer un test
            </a>
            <a className="btn secondary block" href={href('review', { n: node.id === ROOT_ID ? undefined : node.id })}>
              {reviewCount
                ? `Réviser (${reviewCount.due} à revoir · ${reviewCount.fresh} nouvelle${reviewCount.fresh > 1 ? 's' : ''})`
                : 'Réviser'}
            </a>
            <div className="head-links">
              <a className="btn ghost small" href={href('stats', { n: node.id === ROOT_ID ? undefined : node.id })}>
                Statistiques
              </a>
              <a className="btn ghost small" href={href('card/new', { n: node.id === ROOT_ID ? undefined : node.id })}>
                Ajouter une carte
              </a>
              {node.children.length > 1 && (
                <a className="btn ghost small" href={href('labels', { n: node.id })}>
                  Fusionner des libellés
                </a>
              )}
            </div>
          </div>
        ) : (
          <>
            <a className="btn primary block" href={href('import')}>
              Importer des flashcards
            </a>
            <a className="btn secondary block" href={href('card/new')}>
              Ajouter une carte à la main
            </a>
          </>
        )}
      </section>

      {node.children.length > 0 && (
        <section>
          <h3 className="section-title">
            {node.children.every((c) => c.kind === node.children[0]!.kind)
              ? `${LEVEL_LABELS[node.children[0]!.kind]}s`
              : 'Sous-niveaux'}
          </h3>
          <ul className="list">
            {node.children.map((c) => (
              <li key={c.id}>
                <a className="list-row" href={libraryHref(c.id)}>
                  <span className="row-main">
                    {c.label}
                    <span className="row-sub">{LEVEL_LABELS[c.kind]}</span>
                  </span>
                  <span className="row-count">{c.total}</span>
                  <span className="chev" aria-hidden="true">
                    ›
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {direct.length > 0 && (
        <section>
          <h3 className="section-title">
            {node.children.length > 0 ? 'Cartes rattachées directement à ce niveau' : 'Cartes'} ({direct.length})
          </h3>
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
      {node.id === ROOT_ID && node.total > 0 && (
        <a className="btn ghost block" href={href('import')}>
          Importer d'autres fichiers CSV
        </a>
      )}
    </div>
  );
}
