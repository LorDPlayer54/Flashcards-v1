// Recherche V1 : recherche textuelle locale + filtres, extraits contextuels, puis « Préparer un test sur ces cartes ».
import { useEffect, useMemo, useState } from 'react';
import type { Card, FormatFilter } from '../../domain/types';
import { idsForCriteria, queryTerms, searchCardIds, searchCriteriaKey, type KeyedSearchResult } from '../../library/search';
import { highlight, snippetFor, type Segment } from '../../library/snippet';
import { getCards } from '../../storage/repo';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, Icon, Monogram, plural, Segmented, TopBar } from '../components/common';
import { monogramsFor } from '../monogram';
import { href, navigate } from '../router';

const PAGE = 30;

// Conserve les critères quand on ouvre une carte puis revient à la recherche
const lastSearch: { query: string; matiere: string; format: FormatFilter } = { query: '', matiere: '', format: 'all' };

/** Refonte : la recherche est ouverte depuis la Bibliothèque avec le texte déjà saisi. */
export function presetSearch(query: string): void {
  lastSearch.query = query;
  lastSearch.matiere = '';
  lastSearch.format = 'all';
}

export function Search() {
  const { db, metas, tax, setPendingScope } = useApp();
  const [query, setQuery] = useState(lastSearch.query);
  const [matiere, setMatiere] = useState(lastSearch.matiere);
  const [format, setFormat] = useState<FormatFilter>(lastSearch.format);
  const [result, setResult] = useState<KeyedSearchResult | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // I4 : les résultats ne valent que pour les critères qui les ont produits
  const filters = useMemo(() => ({ format, matiere: matiere || undefined }), [format, matiere]);
  const currentKey = searchCriteriaKey(query, filters);
  const ids = idsForCriteria(result, currentKey);

  // Ordre d'affichage = ordre de la bibliothèque
  const order = useMemo(() => new Map(metas.map((m, i) => [m.cardId, i])), [metas]);

  useEffect(() => {
    lastSearch.query = query;
    lastSearch.matiere = matiere;
    lastSearch.format = format;
    let alive = true;
    const key = searchCriteriaKey(query, filters);
    setError(null);
    const t = window.setTimeout(async () => {
      try {
        const found = await searchCardIds(db, query, filters);
        found.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
        if (alive) {
          setResult({ key, ids: found });
          setShown(PAGE);
        }
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [db, query, filters, order, attempt]);

  // Nouveaux résultats : on vide l'ancienne liste (mais pas lors d'un « Afficher plus »)
  useEffect(() => setCards([]), [ids]);

  useEffect(() => {
    let alive = true;
    if (ids)
      getCards(db, ids.slice(0, shown))
        .then((c) => alive && setCards(c))
        .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [db, ids, shown]);

  const launch = () => {
    // Relecture des identifiants au moment du clic : jamais ceux d'anciens critères
    const current = idsForCriteria(result, searchCriteriaKey(query, filters));
    if (!current || current.length === 0) return;
    const parts = [query.trim() && `« ${query.trim()} »`, matiere, format === 'mcq' ? 'QCM' : format === 'open' ? 'questions ouvertes' : '']
      .filter(Boolean)
      .join(' · ');
    setPendingScope({ kind: 'cards', cardIds: current, label: `Recherche${parts ? ' : ' + parts : ''}` });
    navigate('test/setup', { from: 'selection' });
  };

  const terms = useMemo(() => queryTerms(query), [query]);
  const monos = useMemo(() => monogramsFor(tax.root.children.map((c) => c.label)), [tax]);
  const filtered = query.trim() !== '' || matiere !== '' || format !== 'all';
  const reset = () => {
    setQuery('');
    setMatiere('');
    setFormat('all');
  };
  const scope = matiere || 'Toute la bibliothèque';

  return (
    <div className="page search-v1">
      <TopBar title="Recherche" eyebrow="Bibliothèque" back={href('library')} backLabel="Bibliothèque" lead="Retrouvez vos cartes dans les questions, réponses et explications." />
      <label className="field-label" htmlFor="search-input">
        Rechercher
      </label>
      <div className="search-field">
        <Icon name="search" />
        <input
          id="search-input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Un mot, une notion, une expression…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Effacer la recherche">
            ×
          </button>
        )}
      </div>
      <label className="field-label" htmlFor="search-matiere">
        Matière
      </label>
      <select id="search-matiere" className="input" value={matiere} onChange={(e) => setMatiere(e.target.value)}>
        <option value="">Toutes les matières</option>
        {tax.root.children.map((m) => (
          <option key={m.id} value={m.label}>
            {m.label}
          </option>
        ))}
      </select>
      <p className="field-label">Type de question</p>
      <Segmented
        label="Type de question"
        value={format}
        onChange={setFormat}
        options={[
          { value: 'all', label: 'Tous' },
          { value: 'mcq', label: 'QCM' },
          { value: 'open', label: 'Ouvertes' },
        ]}
      />

      {error ? (
        <ErrorNotice message={`Recherche indisponible. ${error}`} onRetry={() => setAttempt((a) => a + 1)} />
      ) : ids === null ? (
        <>
          <div className="result-head">
            <span aria-live="polite">Recherche en cours…</span>
          </div>
          <button type="button" className="btn primary block" disabled>
            <Icon name="arrow" />
            Préparer un test sur ces cartes
          </button>
        </>
      ) : ids.length === 0 ? (
        <div className="search-empty">
          <p className="result-count" aria-live="polite">
            Aucune carte trouvée
          </p>
          <p className="muted">Essayez un autre mot ou élargissez les filtres.</p>
          {filtered && (
            <button type="button" className="btn secondary block" onClick={reset}>
              Réinitialiser les filtres
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="result-head">
            <span className="result-count" aria-live="polite">
              {plural(ids.length, 'carte trouvée', 'cartes trouvées')}
            </span>
            <span className="muted small">{scope}</span>
          </div>
          <button type="button" className="btn primary block" onClick={launch}>
            <Icon name="arrow" />
            Préparer un test sur ces cartes
          </button>
          <ul className="search-results">
            {cards.map((c) => {
              const snip = snippetFor(c, terms);
              return (
                <li key={c.cardId}>
                  <a className="search-row" href={href(`card/${encodeURIComponent(c.cardId)}`)}>
                    <Monogram text={monos.get(c.matiere) ?? '?'} size="sm" />
                    <span className="row-main">
                      <span className="search-q clamp">
                        <Marked segments={highlight(c.question, terms)} />
                      </span>
                      {snip && (
                        <span className="search-snippet">
                          <span className="snippet-label">{snip.label} : </span>
                          <Marked segments={snip.segments} />
                        </span>
                      )}
                      <span className="row-sub">{[c.matiere, c.theme, c.notion].filter(Boolean).join(' › ')}</span>
                    </span>
                    <span className="format-badge">{c.formatQuestion === 'mcq' ? 'QCM' : 'Ouverte'}</span>
                  </a>
                </li>
              );
            })}
          </ul>
          {shown < ids.length && (
            <button type="button" className="btn secondary block" onClick={() => setShown((s) => s + PAGE)}>
              Afficher plus ({Math.min(PAGE, ids.length - shown)})
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Marked({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </>
  );
}
