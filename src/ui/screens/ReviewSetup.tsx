// « Réviser aujourd'hui » (lot 2) : cartes dues + nouvelles cartes dans la limite du plafond global, pour un périmètre.
import { useMemo, useState } from 'react';
import { planReview } from '../../review/queue';
import { localDay } from '../../review/schedule';
import { getInProgressSessions, startReviewSession } from '../../storage/repo';
import { nodePathLabel, ROOT_ID } from '../../taxonomy/tree';
import { resolveScope } from '../../tests/selection';
import { useApp } from '../AppContext';
import { confirmReplace, ErrorNotice, errorMessage, plural, TopBar } from '../components/common';
import { href, libraryHref, navigate, type Route } from '../router';
import { formatDay, useReviewData } from '../useReview';

export function ReviewSetup({ route }: { route: Route }) {
  const { db, metas, tax, reload: reloadLibrary } = useApp();
  const { data, error, reload } = useReviewData();
  const requested = route.query.get('n') ?? ROOT_ID;
  const nodeId = tax.byId.has(requested) ? requested : ROOT_ID;
  const scopeLabel = nodePathLabel(tax, nodeId);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  /** v0.2.1 : la sélection a changé entre l'affichage et le clic ; l'aperçu a été actualisé */
  const [changedNotice, setChangedNotice] = useState<string | null>(null);

  const scoped = useMemo(() => resolveScope({ kind: 'node', nodeId }, tax, metas), [nodeId, tax, metas]);
  const remaining = data ? data.newRemaining : 0;
  const plan = useMemo(() => (data ? planReview(scoped, data.states, data.today, remaining) : null), [data, scoped, remaining]);

  /** Répartition par matière, pour montrer qu'aucune matière n'est écartée */
  const byMatiere = useMemo(() => {
    if (!plan) return [];
    const matiereOf = new Map(scoped.map((m) => [m.cardId, m.matiere]));
    const rows = new Map<string, { due: number; fresh: number }>();
    for (const id of plan.due) {
      const k = matiereOf.get(id)!;
      rows.set(k, { due: (rows.get(k)?.due ?? 0) + 1, fresh: rows.get(k)?.fresh ?? 0 });
    }
    for (const id of plan.fresh) {
      const k = matiereOf.get(id)!;
      rows.set(k, { due: rows.get(k)?.due ?? 0, fresh: (rows.get(k)?.fresh ?? 0) + 1 });
    }
    return [...rows];
  }, [plan, scoped]);

  const back = nodeId === ROOT_ID ? '#/' : libraryHref(nodeId);

  if (error) {
    return (
      <div className="page">
        <TopBar title="Réviser" back={back} />
        <ErrorNotice message={`Impossible de lire les échéances : ${error}`} onRetry={reload} />
      </div>
    );
  }
  if (!data || !plan) return <div className="page center muted">Chargement…</div>;

  const start = async () => {
    if (busy || plan.queue.length === 0) return;
    setBusy(true);
    setStartError(null);
    setChangedNotice(null);
    try {
      const running = await getInProgressSessions(db);
      if (running.length > 0 && !confirmReplace(running)) {
        setBusy(false);
        return;
      }
      // v0.2.2 (I2) : seules les séances effectivement présentées sont autorisées au remplacement
      let confirmed = running.map((s) => s.sessionId);
      // v0.2.1 / v0.2.2 (I1) : la file affichée est revalidée dans la transaction qui crée la séance
      // (périmètre relu en base, états, quota, date du jour, séances en cours)
      let res = await startReviewSession(db, { nodeId, scopeLabel, expectedQueue: plan.queue, confirmedReplace: confirmed, today: localDay() });
      for (let attempt = 0; res.status === 'conflict' && attempt < 3; attempt++) {
        if (!confirmReplace(res.running, true)) {
          setBusy(false);
          setChangedNotice("Aucune séance n'a été lancée : la séance ouverte entre-temps est conservée.");
          return;
        }
        confirmed = res.running.map((r) => r.sessionId);
        res = await startReviewSession(db, { nodeId, scopeLabel, expectedQueue: plan.queue, confirmedReplace: confirmed, today: localDay() });
      }
      if (res.status === 'started') {
        navigate(`test/run/${res.session.sessionId}`, undefined, true);
        return;
      }
      setBusy(false);
      if (res.status === 'conflict') {
        setStartError('Les séances en cours changent sans cesse (autre onglet ouvert ?). Fermez les autres onglets puis réessayez.');
        return;
      }
      // Aperçu recalculé sur l'état actuel (bibliothèque et échéances) ; un nouveau clic est nécessaire
      await reloadLibrary().catch(() => undefined);
      reload();
      setChangedNotice(
        res.status === 'empty'
          ? 'Il ne reste plus rien à réviser dans ce périmètre (révisions ou quota utilisés entre-temps, ou changement de jour).'
          : `La sélection a changé depuis son affichage (${res.reason}) : révisions faites ailleurs, cartes ajoutées, déplacées ou supprimées, quota de nouvelles cartes modifié ou changement de jour. Vérifiez l'aperçu actualisé puis touchez à nouveau « Commencer ».`,
      );
    } catch (e) {
      setBusy(false);
      setStartError(`La séance n'a pas pu être créée (${errorMessage(e)}). Aucune séance en cours n'a été modifiée. Vous pouvez réessayer.`);
    }
  };

  return (
    <div className="page with-action-bar">
      <TopBar title="Réviser aujourd'hui" back={back} />
      {changedNotice && (
        <p className="notice" role="status">
          {changedNotice}
        </p>
      )}

      <section className="card-block">
        <p className="eyebrow">Périmètre</p>
        <p className="strong">{scopeLabel}</p>
        <p className="muted small">{plural(scoped.length, 'carte', 'cartes')} dans ce périmètre</p>
      </section>

      <section className="stats-row">
        <div className="stat">
          <span className="stat-value">{plan.due.length}</span>
          <span className="stat-label">à revoir</span>
        </div>
        <div className="stat">
          <span className="stat-value">{plan.fresh.length}</span>
          <span className="stat-label">nouvelles</span>
        </div>
        <div className="stat">
          <span className="stat-value">{plan.queue.length}</span>
          <span className="stat-label">au total</span>
        </div>
      </section>

      <p className="muted small">
        Nouvelles cartes : {remaining} sur {data.newPerDay} encore disponibles aujourd'hui (plafond commun à toutes les matières,
        modifiable dans « Plus »). {plan.freshAvailable > plan.fresh.length && `${plan.freshAvailable - plan.fresh.length} autres nouvelles cartes attendront.`}
      </p>

      {byMatiere.length > 1 && (
        <section>
          <h3 className="section-title">Répartition</h3>
          <ul className="list">
            {byMatiere.map(([m, c]) => (
              <li key={m} className="list-row static">
                <span className="row-main">{m}</span>
                <span className="row-sub">
                  {c.due} à revoir · {c.fresh} nouvelle{c.fresh > 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.queue.length === 0 && (
        <section className="card-block">
          <p className="strong">Rien à réviser aujourd'hui dans ce périmètre.</p>
          {plan.nextDueDay && <p className="muted">Prochaine échéance : {formatDay(plan.nextDueDay)}.</p>}
          {remaining === 0 && plan.freshAvailable > 0 && <p className="muted">Le plafond de nouvelles cartes du jour est atteint.</p>}
          <a className="btn secondary block" href={href('test/setup', { n: nodeId })}>
            Faire un test libre (sans effet sur les échéances)
          </a>
        </section>
      )}

      <p className="muted small">
        Chaque évaluation fixe la prochaine révision de la carte. Une carte « À revoir » est reproposée une fois en fin de séance, puis
        revue demain.
      </p>

      {startError && <ErrorNotice message={startError} />}

      <div className="action-bar">
        <button type="button" className="btn primary block" disabled={busy || plan.queue.length === 0} onClick={() => void start()}>
          {busy ? 'Préparation…' : plan.queue.length === 0 ? 'Rien à réviser' : `Commencer la révision (${plan.queue.length})`}
        </button>
      </div>
    </div>
  );
}
