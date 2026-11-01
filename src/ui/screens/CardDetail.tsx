// Fiche d'une carte : contenu complet, provenance, suppression avec confirmation.
import { useEffect, useState } from 'react';
import { SELF_EVAL_LABELS, type Card } from '../../domain/types';
import { isMastered, STATUS_LABELS, statusOf, type ReviewLogEntry, type ReviewState } from '../../review/schedule';
import { deleteCard, getCard, getReviewLogForCard, getReviewState, MANUAL_SOURCE } from '../../storage/repo';
import { childNodeId, pathKeyOf, ROOT_ID } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, formatLabel, Icon, plural, TopBar } from '../components/common';
import { cardVisual } from '../cardVisual';
import { RichText } from '../components/RichText';
import { goBackTo, href, libraryHref } from '../router';
import { formatDay } from '../useReview';

export function CardDetail({ cardId }: { cardId: string }) {
  const { db, collections, reload } = useApp();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSource, setShowSource] = useState(false);
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

  // Retour stable : vers l'écran d'origine (Bibliothèque, Recherche, bilan) s'il précède la fiche, jamais vers un
  // formulaire d'édition ; sinon vers le niveau de la carte dans la Bibliothèque (ouverture directe, rechargement).
  const goBack = () => {
    let fallback = libraryHref(ROOT_ID);
    if (card) {
      let id = ROOT_ID;
      for (const [kind, label] of [['matiere', card.matiere], ['theme', card.theme], ['lecon', card.lecon], ['notion', card.notion]] as const) {
        if (!label) break;
        id = childNodeId(id, kind, label);
      }
      fallback = libraryHref(id);
    }
    goBackTo(fallback, (prev) => !prev.startsWith('#/card/'));
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
      setActionError(`Suppression impossible. La carte n'a pas été supprimée (${errorMessage(e)}). Réessayez.`);
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

      {/* États des cartes V1 : surface selon la dernière catégorie de révision enregistrée */}
      <section className={`question-card cat-${cardVisual(memo?.state?.lastRating, null).surface}`}>
        <div className="card-badges">
          <span className="cat-badge">
            <span className="cat-dot" aria-hidden="true" />
            {cardVisual(memo?.state?.lastRating, null).badge}
          </span>
          <span className="format-tag">Question</span>
        </div>
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

      {/* Fiche V3 : réponse et explications en sections séparées */}
      <section className="answerbox" aria-label="Réponse et explications">
        <div className="answer-section answer-main">
          <h3 className="answer-label">Réponse</h3>
          <RichText text={card.reponse} className="answertext" />
        </div>
        {card.explication && (
          <div className="answer-section">
            <h3 className="answer-label">Explication</h3>
            <RichText text={card.explication} className="answer-copy" />
          </div>
        )}
        {card.astucePiege && (
          <div className="answer-section">
            <h3 className="answer-label">Astuce / Piège</h3>
            <RichText text={card.astucePiege} className="answer-copy" />
          </div>
        )}
      </section>

      {memo && (
        <section className="card-sheet-section">
          <div className="sheet-head">
            <h2>Mémorisation</h2>
            <span className="chip">{STATUS_LABELS[statusOf(memo.state)]}</span>
          </div>
          <div className="memo-panel">
            {memo.state ? (
              <>
                <dl className="memo-rows">
                  <div>
                    <dt>Prochaine révision</dt>
                    <dd>{formatDay(memo.state.dueDay)}</dd>
                  </div>
                  <div>
                    <dt>Intervalle</dt>
                    <dd>{plural(memo.state.intervalDays, 'jour', 'jours')}</dd>
                  </div>
                  <div>
                    <dt>Révisions</dt>
                    <dd>{memo.state.reviewCount}</dd>
                  </div>
                  <div>
                    <dt>« À revoir »</dt>
                    <dd>{memo.state.lapses}</dd>
                  </div>
                </dl>
                <div className="chips">
                  <span className="chip">Dernière évaluation : {SELF_EVAL_LABELS[memo.state.lastRating]}</span>
                  {isMastered(memo.state) && <span className="chip ok">Maîtrisée</span>}
                </div>
              </>
            ) : (
              <p className="muted">Aucun état de mémorisation : la carte sera proposée comme nouvelle.</p>
            )}
            {memo.log.length > 0 && (
              <>
                <button type="button" className="section-toggle" aria-expanded={showHistory} aria-controls="card-history" onClick={() => setShowHistory((v) => !v)}>
                  <span>
                    <strong>Historique des évaluations</strong>
                  </span>
                  <Icon name="chevron" />
                </button>
                {showHistory && (
                  <ul id="card-history" className="history">
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
                            {l.mode === 'libre' && ' · test libre'}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </section>
      )}

      <section className="card-sheet-section">
        <button type="button" className="section-toggle" aria-expanded={showSource} aria-controls="card-source" onClick={() => setShowSource((v) => !v)}>
          <span>
            <strong>Provenance et informations de la carte</strong>
          </span>
          <Icon name="chevron" />
        </button>
        {showSource && (
          <div id="card-source" className="memo-panel">
            <dl className="memo-rows">
              <div>
                <dt>Collection</dt>
                <dd>{collection?.name ?? 'inconnue'}</dd>
              </div>
              <div>
                <dt>{manual ? 'Origine' : 'Fichier source'}</dt>
                <dd>{card.sourceFile}</dd>
              </div>
              {!manual && (
                <div>
                  <dt>Rang</dt>
                  <dd>{card.sourceRow}</dd>
                </div>
              )}
              <div>
                <dt>ID source</dt>
                <dd>{card.externalId ?? (card.duplicateExternalId ? `${card.duplicateExternalId} (doublon, retiré à la migration)` : '—')}</dd>
              </div>
              <div>
                <dt>{manual ? 'Créée le' : 'Importée le'}</dt>
                <dd>{new Date(card.createdAt).toLocaleString('fr-FR')}</dd>
              </div>
              <div>
                <dt>Mise à jour le</dt>
                <dd>{new Date(card.updatedAt).toLocaleString('fr-FR')}</dd>
              </div>
              {card.editedAt && (
                <div>
                  <dt>Modifiée dans l'application le</dt>
                  <dd>{new Date(card.editedAt).toLocaleString('fr-FR')}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
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
