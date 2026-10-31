// Fiche d'une carte : contenu complet, provenance, suppression avec confirmation.
import { useEffect, useState } from 'react';
import { SELF_EVAL_LABELS, type Card } from '../../domain/types';
import { isMastered, STATUS_LABELS, statusOf, type ReviewLogEntry, type ReviewState } from '../../review/schedule';
import { deleteCard, getCard, getReviewLogForCard, getReviewState, MANUAL_SOURCE } from '../../storage/repo';
import { pathKeyOf } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, formatLabel, plural, TopBar } from '../components/common';
import { RichText } from '../components/RichText';
import { href, libraryHref } from '../router';
import { formatDay } from '../useReview';

export function CardDetail({ cardId }: { cardId: string }) {
  const { db, collections, reload } = useApp();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [memo, setMemo] = useState<{ state?: ReviewState; log: ReviewLogEntry[] } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    Promise.all([getCard(db, cardId), getReviewState(db, cardId), getReviewLogForCard(db, cardId)])
      .then(([c, state, log]) => {
        if (!alive) return;
        setCard(c ?? null);
        setMemo({ state, log });
      })
      .catch((e: unknown) => alive && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [db, cardId, attempt]);

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = libraryHref('root').slice(1);
  };

  if (loadError)
    return (
      <div className="page">
        <TopBar title="Carte" back={goBack} />
        <ErrorNotice message={`Impossible de charger la carte : ${loadError}`} onRetry={() => setAttempt((a) => a + 1)} />
      </div>
    );
  if (card === undefined) return <div className="page center muted">Chargement…</div>;
  if (card === null)
    return (
      <div className="page">
        <TopBar title="Carte" back={goBack} />
        <p className="notice">Cette carte n'existe plus.</p>
      </div>
    );

  const collection = collections.find((c) => c.collectionId === card.collectionId);
  const path = [card.matiere, card.theme, card.lecon, card.notion].filter(Boolean).join(' › ');
  const manual = card.sourceFile === MANUAL_SOURCE;

  const onDelete = async () => {
    if (!window.confirm('Supprimer définitivement cette carte ? Cette action est irréversible.')) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteCard(db, card.cardId);
    } catch (e) {
      setDeleting(false);
      setActionError(`La carte n'a pas été supprimée : ${errorMessage(e)}`);
      return;
    }
    try {
      await reload();
    } catch {
      // La suppression est faite ; la bibliothèque sera relue au prochain affichage
    }
    window.location.hash = libraryHref(pathKeyOf(card)).slice(1);
  };

  return (
    <div className="page">
      <TopBar title="Carte" back={goBack} />
      <p className="crumbs">{path}</p>
      <div className="chips">
        <span className="chip">{formatLabel(card.formatQuestion)}</span>
        {card.difficulte && <span className="chip">{card.difficulte}</span>}
        {card.typePedagogique && <span className="chip">{card.typePedagogique}</span>}
      </div>

      <section className="card-block">
        <h3 className="label">Question</h3>
        <RichText text={card.question} className="question" />
        {card.options && (
          <ol className="options readonly">
            {card.options.map((o) => (
              <li key={o.id} className={o.id === card.correctOptionId ? 'option correct' : 'option'}>
                <span className="opt-letter">{o.id}</span>
                <RichText text={o.text} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card-block">
        <h3 className="label">Réponse</h3>
        <RichText text={card.reponse} />
        {card.explication && (
          <>
            <h3 className="label">Explication</h3>
            <RichText text={card.explication} />
          </>
        )}
        {card.astucePiege && (
          <>
            <h3 className="label">Astuce / Piège</h3>
            <RichText text={card.astucePiege} />
          </>
        )}
      </section>

      {memo && (
        <section className="card-block small">
          <h3 className="label">Mémorisation</h3>
          <div className="chips">
            <span className="chip">{STATUS_LABELS[statusOf(memo.state)]}</span>
            {isMastered(memo.state) && <span className="chip ok">Maîtrisée</span>}
          </div>
          {memo.state ? (
            <dl className="meta">
              <dt>Prochaine révision</dt>
              <dd>{formatDay(memo.state.dueDay)}</dd>
              <dt>Intervalle</dt>
              <dd>{plural(memo.state.intervalDays, 'jour', 'jours')}</dd>
              <dt>Dernière évaluation</dt>
              <dd>{SELF_EVAL_LABELS[memo.state.lastRating]}</dd>
              <dt>Révisions</dt>
              <dd>
                {memo.state.reviewCount} (dont {memo.state.lapses} « À revoir »)
              </dd>
            </dl>
          ) : (
            <p className="muted">Jamais révisée en révision programmée.</p>
          )}
          {memo.log.length > 0 && (
            <>
              <h3 className="label">Historique des révisions</h3>
              <ul className="history">
                {memo.log
                  .slice(-10)
                  .reverse()
                  .map((l) => (
                    <li key={l.logId}>
                      <span>{new Date(l.at).toLocaleDateString('fr-FR')}</span>
                      <span>
                        {SELF_EVAL_LABELS[l.rating]}
                        {l.correct !== undefined && (l.correct ? ' · QCM juste' : ' · QCM faux')}
                        {l.repeat && ' · reprise'}
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="card-block small">
        <h3 className="label">Provenance</h3>
        <dl className="meta">
          <dt>Collection</dt>
          <dd>{collection?.name ?? 'inconnue'}</dd>
          <dt>{manual ? 'Origine' : 'Fichier'}</dt>
          <dd>{card.sourceFile}</dd>
          {!manual && (
            <>
              <dt>Rang dans le fichier</dt>
              <dd>{card.sourceRow}</dd>
            </>
          )}
          <dt>Identifiant source</dt>
          <dd>{card.externalId ?? (card.duplicateExternalId ? `${card.duplicateExternalId} (doublon, retiré à la migration)` : '—')}</dd>
          <dt>{manual ? 'Créée le' : 'Importée le'}</dt>
          <dd>{new Date(card.createdAt).toLocaleString('fr-FR')}</dd>
          <dt>Mise à jour le</dt>
          <dd>{new Date(card.updatedAt).toLocaleString('fr-FR')}</dd>
          {card.editedAt && (
            <>
              <dt>Modifiée dans l'application le</dt>
              <dd>{new Date(card.editedAt).toLocaleString('fr-FR')}</dd>
            </>
          )}
        </dl>
      </section>

      <a className="btn secondary block" href={href(`card/${encodeURIComponent(card.cardId)}/edit`)}>
        Modifier cette carte
      </a>
      {actionError && <ErrorNotice message={actionError} onRetry={() => void onDelete()} busy={deleting} />}
      <button type="button" className="btn danger block" onClick={() => void onDelete()} disabled={deleting}>
        {deleting ? 'Suppression…' : 'Supprimer cette carte'}
      </button>
    </div>
  );
}
