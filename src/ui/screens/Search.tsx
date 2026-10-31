// Recherche textuelle + filtres, puis « Lancer un test sur ces résultats ».
import { useEffect, useMemo, useState } from 'react';
import type { Card, FormatFilter } from '../../domain/types';
import { idsForCriteria, searchCardIds, searchCriteriaKey, type KeyedSearchResult } from '../../library/search';
import { getCards } from '../../storage/repo';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, formatLabel, plural, Segmented, TopBar } from '../components/common';
import { href, navigate } from '../router';

const PAGE = 30;

// Conserve les critères quand on ouvre une carte puis revient à la recherche
const lastSearch: { query: string; matiere: string; format: FormatFilter } = { query: '', matiere: '', format: 'all' };

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

  return (
    <div className="page">
      <TopBar title="Recherche" />
      <input
        className="input"
        type="search"
        inputMode="search"
        placeholder="Mot dans la question, la réponse, l'explication…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Rechercher"
      />
      <div className="filters">
        <select className="input" value={matiere} onChange={(e) => setMatiere(e.target.value)} aria-label="Matière">
          <option value="">Toutes les matières</option>
          {tax.root.children.map((m) => (
            <option key={m.id} value={m.label}>
              {m.label}
            </option>
          ))}
        </select>
        <Segmented
          label="Format"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'all', label: 'Tous' },
            { value: 'mcq', label: 'QCM' },
            { value: 'open', label: 'Ouvertes' },
          ]}
        />
      </div>

      {error ? (
        <ErrorNotice message={`La recherche a échoué : ${error}`} onRetry={() => setAttempt((a) => a + 1)} />
      ) : ids === null ? (
        <>
          <p className="muted" aria-live="polite">
            Recherche…
          </p>
          <button type="button" className="btn primary block" disabled>
            Lancer un test sur ces résultats
          </button>
        </>
      ) : (
        <>
          <div className="result-head">
            <span className="muted">{plural(ids.length, 'résultat', 'résultats')}</span>
          </div>
          {ids.length > 0 && (
            <button type="button" className="btn primary block" onClick={launch}>
              Lancer un test sur ces résultats
            </button>
          )}
          <ul className="list">
            {cards.map((c) => (
              <li key={c.cardId}>
                <a className="list-row card-row" href={href(`card/${encodeURIComponent(c.cardId)}`)}>
                  <span className="row-main">
                    <span className="clamp">{c.question}</span>
                    <span className="row-sub">
                      {[c.matiere, c.theme, c.notion].filter(Boolean).join(' › ')} · {formatLabel(c.formatQuestion)}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {shown < ids.length && (
            <button type="button" className="btn secondary block" onClick={() => setShown((s) => s + PAGE)}>
              Afficher plus
            </button>
          )}
        </>
      )}
    </div>
  );
}
