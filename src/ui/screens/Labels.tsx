// Libellés V1 (figée) ; lot 3B : fusion explicite des libellés (matière, thème, leçon, notion).
// Sans niveau choisi : libellés semblables détectés (suggestions) et fusions mémorisées.
// Avec un niveau parent : choix des libellés frères à fusionner, du libellé cible, aperçu (libellés et nombre de
// cartes), puis confirmation explicite. Jamais de fusion automatique.
import { useEffect, useMemo, useState } from 'react';
import { forgetLabelRule, getLabelRules, mergeLabels } from '../../storage/repo';
import { similarLabelGroups, similarLabels, type LabelLevel, type LabelRule } from '../../taxonomy/labelMerge';
import { childNodeId, LEVEL_LABELS, nodePathLabel, ROOT_ID, type TaxNode } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { searchable } from '../../domain/text';
import { ConfirmDialog, ErrorNotice, errorMessage, Icon, num, plural, SavedNotice, Segmented, TopBar } from '../components/common';
import { href, libraryHref, navigate, type Route } from '../router';

const LEVEL_PLURAL: Record<LabelLevel, string> = { matiere: 'Matières', theme: 'Thèmes', lecon: 'Leçons', notion: 'Notions' };

const LEVEL_LETTER: Record<LabelLevel, string> = { matiere: 'M', theme: 'T', lecon: 'L', notion: 'N' };

export function labelsHref(parentId: string, level?: LabelLevel, selected?: string[], fromLabels?: boolean): string {
  return href('labels', { n: parentId, k: level, s: selected && selected.length ? JSON.stringify(selected) : undefined, o: fromLabels ? '1' : undefined });
}

function parseSelected(raw: string | null): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function Labels({ route }: { route: Route }) {
  const parentId = route.query.get('n');
  return parentId ? <MergeForm route={route} parentId={parentId} /> : <Overview />;
}

function Overview() {
  const { db, tax, reload } = useApp();
  const groups = useMemo(() => similarLabelGroups(tax), [tax]);
  const [rules, setRules] = useState<LabelRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState('');
  const [forgetting, setForgetting] = useState<LabelRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    getLabelRules(db)
      .then((r) => alive && setRules(r))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [db, attempt]);

  const forget = async () => {
    if (!forgetting) return;
    const r = forgetting;
    setBusy(true);
    setNotice(null);
    try {
      await forgetLabelRule(db, r);
    } catch (e) {
      setBusy(false);
      setForgetting(null);
      setNotice({ text: `La règle n'a pas été oubliée : ${errorMessage(e)}. Vous pouvez réessayer.`, error: true });
      return;
    }
    setBusy(false);
    setForgetting(null);
    setAttempt((a) => a + 1);
    setNotice({ text: `Règle « ${r.from} → ${r.to} » oubliée. Les cartes déjà fusionnées ne changent pas.`, error: false });
    await reload().catch(() => undefined); // règles à jour dans toute l'application (lot 4)
  };

  const parentLabel = (id: string) => (id === ROOT_ID ? 'Bibliothèque' : nodePathLabel(tax, id));
  const q = searchable(filter.trim());
  const shownGroups = q ? groups.filter((g) => searchable(g.labels.map((l) => l.label).join(' ') + ' ' + parentLabel(g.parentId)).includes(q)) : groups;
  const shownRules = rules && q ? rules.filter((r) => searchable(`${r.from} ${r.to} ${parentLabel(r.parentId)}`).includes(q)) : rules;

  return (
    <div className="page labels-v1">
      <TopBar title="Libellés" eyebrow="Bibliothèque" back={href('more')} backLabel="Plus" lead="Repérez les écritures semblables et réunissez-les en toute confiance." />
      <div className="search-field">
        <Icon name="search" />
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Chercher un libellé" aria-label="Chercher un libellé" autoComplete="off" />
        {filter && (
          <button type="button" className="search-clear" onClick={() => setFilter('')} aria-label="Effacer">
            ×
          </button>
        )}
      </div>
      {notice && (notice.error ? <ErrorNotice message={notice.text} /> : <p className="notice" role="status">{notice.text}</p>)}

      <section>
        <div className="labels-head">
          <h2>Libellés semblables</h2>
          <span className="muted small">{plural(shownGroups.length, 'suggestion', 'suggestions')}</span>
        </div>
        <p className="muted small">Sélectionnez une suggestion pour vérifier les cartes concernées avant de fusionner.</p>
        {shownGroups.length === 0 ? (
          <p className="muted">{q ? 'Aucune suggestion ne correspond.' : 'Aucun libellé semblable détecté.'}</p>
        ) : (
          <ul className="labels-list">
            {shownGroups.map((g) => (
              <li key={`${g.parentId}|${g.level}|${g.labels.map((l) => l.label).join('|')}`}>
                <a className="labels-row" href={labelsHref(g.parentId, g.level, g.labels.map((l) => l.label), true)}>
                  <span className="level-badge" aria-hidden="true">
                    {LEVEL_LETTER[g.level]}
                  </span>
                  <span className="row-main">
                    <strong>{g.labels.map((l) => l.label).join(' · ')}</strong>
                    <span className="row-sub">
                      {LEVEL_PLURAL[g.level]} · {parentLabel(g.parentId)} · {plural(g.labels.reduce((n, l) => n + l.total, 0), 'carte', 'cartes')}
                    </span>
                  </span>
                  <Icon name="chevron" />
                </a>
              </li>
            ))}
          </ul>
        )}
        <a className="labels-library-link" href={libraryHref(ROOT_ID)}>
          <Icon name="library" />
          Fusionner depuis la Bibliothèque
        </a>
      </section>

      <section>
        <div className="labels-head">
          <h2>Fusions mémorisées</h2>
          {rules && <span className="muted small">{rules.length}</span>}
        </div>
        <p className="muted small">Elles sont appliquées aux prochains imports : un fichier qui contient l'ancien libellé est reclassé automatiquement.</p>
        {error && <ErrorNotice message={`Lecture impossible : ${error}`} onRetry={() => setAttempt((a) => a + 1)} />}
        {shownRules && shownRules.length === 0 && <p className="muted">{q ? 'Aucune règle ne correspond.' : "Aucune fusion pour l'instant."}</p>}
        {shownRules && shownRules.length > 0 && (
          <ul className="labels-list">
            {shownRules.map((r) => (
              <li key={`${r.level}|${r.parentId}|${r.from}`} className="labels-row static">
                <span className="row-main">
                  <strong>
                    {r.from} → {r.to}
                  </strong>
                  <span className="row-sub">
                    {LEVEL_LABELS[r.level]} · {parentLabel(r.parentId)} · {new Date(r.at).toLocaleDateString('fr-FR')}
                  </span>
                </span>
                <button type="button" className="btn secondary small" onClick={() => setForgetting(r)}>
                  Oublier
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {forgetting && (
        <ConfirmDialog title="Oublier cette fusion ?" confirmLabel="Oublier la règle" busyLabel="Oubli…" busy={busy} onConfirm={() => void forget()} onCancel={() => setForgetting(null)}>
          <p>
            « {forgetting.from} » ne sera plus reclassé en « {forgetting.to} » lors des prochains imports.
          </p>
          <p className="muted small">Les cartes déjà fusionnées restent sous « {forgetting.to} ». Aucune carte n'est supprimée.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function MergeForm({ route, parentId }: { route: Route; parentId: string }) {
  const { db, tax, reload } = useApp();
  const parent = tax.byId.get(parentId);
  const kinds = useMemo(() => {
    const m = new Map<LabelLevel, TaxNode[]>();
    for (const c of parent?.children ?? []) m.set(c.kind as LabelLevel, [...(m.get(c.kind as LabelLevel) ?? []), c]);
    return m;
  }, [parent]);
  const requestedKind = route.query.get('k') as LabelLevel | null;
  const defaultKind = [...kinds.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
  const [level, setLevel] = useState<LabelLevel | undefined>(requestedKind && kinds.has(requestedKind) ? requestedKind : defaultKind);
  const [selected, setSelected] = useState<string[]>(() => parseSelected(route.query.get('s')));
  /** Libellé cible : un des libellés sélectionnés, ou un libellé saisi */
  const [pick, setPick] = useState<{ custom: boolean; label: string | null }>({ custom: false, label: null });
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  const [doneRefreshFailed, setDoneRefreshFailed] = useState<{ updated: number; target: string; level: LabelLevel } | null>(null);
  const fromLabels = route.query.get('o') === '1';
  const backTo = fromLabels ? href('labels') : libraryHref(parentId);
  const backLabel = fromLabels ? 'Libellés' : 'Bibliothèque';

  if (!parent) {
    return (
      <div className="page">
        <TopBar title="Fusionner des libellés" eyebrow="Gestion des libellés" back={backTo} backLabel={backLabel} />
        <p className="notice">Ce niveau n'existe plus (ses cartes ont été déplacées ou supprimées).</p>
        <a className="btn secondary block" href={href('labels')}>
          Libellés semblables
        </a>
      </div>
    );
  }

  const siblings = level ? (kinds.get(level) ?? []) : [];
  const chosen = siblings.filter((s) => selected.includes(s.label));
  // Cible par défaut : le libellé sélectionné qui compte le plus de cartes
  const defaultTarget = [...chosen].sort((a, b) => b.total - a.total)[0]?.label ?? null;
  const useCustom = pick.custom;
  const target = useCustom
    ? custom.replace(/\s+/g, ' ').trim()
    : pick.label !== null && chosen.some((c) => c.label === pick.label)
      ? pick.label
      : (defaultTarget ?? '');
  const targetNode = level && target ? siblings.find((s) => s.label === target) : undefined;
  const moving = chosen.filter((c) => c.label !== target);
  const movedCards = moving.reduce((n, c) => n + c.total, 0);
  const valid = Boolean(level && target && chosen.length > 0 && moving.length > 0);

  const toggle = (label: string) => setSelected((s) => (s.includes(label) ? s.filter((x) => x !== label) : [...s, label]));

  const confirm = async () => {
    if (!valid || !level || doneRefreshFailed) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await mergeLabels(db, {
        parentId,
        level,
        from: chosen.map((c) => c.label),
        to: target,
        expectedCounts: Object.fromEntries(chosen.map((c) => [c.label, c.total])),
      });
      if (res.status === 'changed') {
        setAsking(false);
        setMessage({ text: "Les cartes de ces libellés ont changé depuis l'affichage (autre onglet ou import). Rien n'a été modifié ; l'aperçu va être actualisé, vérifiez-le puis confirmez de nouveau.", error: true });
        await reload().catch((e: unknown) => setMessage({ text: `Rien n'a été modifié, mais l'aperçu n'a pas pu être actualisé : ${errorMessage(e)}. Rechargez la page.`, error: true }));
        setBusy(false);
        return;
      }
      try {
        await reload();
      } catch {
        // Fusion réalisée : on ne la relance jamais ; seul l'affichage reste à actualiser
        setBusy(false);
        setAsking(false);
        setDoneRefreshFailed({ updated: res.updated, target, level });
        return;
      }
      navigate('library', { n: childNodeId(parentId, level, target), merged: String(res.updated) }, true);
    } catch (e) {
      setBusy(false);
      setAsking(false);
      setMessage({ text: `La fusion n'a pas été effectuée (aucune carte modifiée) : ${errorMessage(e)}. Vous pouvez réessayer.`, error: true });
    }
  };

  const alreadyUnderTarget = targetNode && !chosen.includes(targetNode) ? targetNode.total : chosen.find((c) => c.label === target)?.total ?? 0;
  const isNew = !targetNode && !chosen.some((c) => c.label === target);

  if (doneRefreshFailed) {
    return (
      <div className="page labels-v1">
        <TopBar title="Fusionner des libellés" eyebrow="Gestion des libellés" back={backTo} backLabel={backLabel} />
        <SavedNotice
          title="Fusion effectuée"
          message={`${plural(doneRefreshFailed.updated, 'carte reclassée', 'cartes reclassées')} sous « ${doneRefreshFailed.target} ». La bibliothèque n'a pas pu être actualisée ; la fusion ne sera pas relancée.`}
          onRefresh={() =>
            void reload()
              .then(() => navigate('library', { n: childNodeId(parentId, doneRefreshFailed.level, doneRefreshFailed.target) }, true))
              .catch(() => undefined)
          }
        />
      </div>
    );
  }

  return (
    <div className="page labels-v1 with-action-bar">
      <TopBar title="Fusionner des libellés" eyebrow="Gestion des libellés" back={backTo} backLabel={backLabel} lead="Vérifiez les écritures, choisissez celle à conserver, puis confirmez." />
      <p className="labels-scope">
        {level && <strong>{LEVEL_PLURAL[level]}</strong>}
        {level && ' · '}
        {parentId === ROOT_ID ? 'Bibliothèque' : nodePathLabel(tax, parentId)}
      </p>

      {kinds.size > 1 && level && (
        <Segmented
          label="Niveau"
          value={level}
          onChange={(v) => {
            setLevel(v);
            setSelected([]);
            setPick({ custom: false, label: null });
          }}
          options={[...kinds.keys()].map((k) => ({ value: k, label: LEVEL_PLURAL[k] }))}
        />
      )}

      {!level || siblings.length === 0 ? (
        <p className="notice">Ce niveau n'a pas de sous-niveau à fusionner.</p>
      ) : (
        <>
          <h2 className="field-label">1 · Libellés à regrouper</h2>
          <ul className="labels-choices">
            {siblings.map((s) => {
              const similar = siblings.filter((o) => o !== s && similarLabels(o.label, s.label)).map((o) => o.label);
              return (
                <li key={s.id}>
                  <label className="choice-row">
                    <input type="checkbox" checked={selected.includes(s.label)} onChange={() => toggle(s.label)} />
                    <span>
                      <strong>{s.label}</strong>
                      <small>
                        {plural(s.total, 'carte', 'cartes')}
                        {similar.length > 0 && ` · semblable à ${similar.map((x) => `« ${x} »`).join(', ')}`}
                      </small>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {chosen.length > 0 && (
            <>
              <h2 className="field-label">2 · Libellé à conserver</h2>
              <ul className="labels-choices">
                {chosen.map((c) => (
                  <li key={c.id}>
                    <label className="choice-row">
                      <input type="radio" name="target" checked={!useCustom && target === c.label} onChange={() => setPick({ custom: false, label: c.label })} />
                      <span>
                        <strong>{c.label}</strong>
                      </span>
                    </label>
                  </li>
                ))}
                <li>
                  <label className="choice-row">
                    <input type="radio" name="target" checked={useCustom} onChange={() => setPick({ custom: true, label: null })} />
                    <span>
                      <strong>Créer un nouveau libellé</strong>
                    </span>
                  </label>
                </li>
              </ul>
              <input
                className="input"
                value={custom}
                placeholder="Nouveau nom"
                aria-label="Nouveau libellé"
                onChange={(e) => {
                  setPick({ custom: true, label: null });
                  setCustom(e.target.value);
                }}
              />
            </>
          )}

          {valid && (
            <>
              <h2 className="field-label">3 · Aperçu de la fusion</h2>
              <section className="merge-preview-v1" aria-live="polite">
                <p className="merge-big">{num(movedCards)}</p>
                <p>
                  {movedCards > 1 ? 'cartes seront déplacées' : 'carte sera déplacée'} sous « {target} »{isNew ? ' (nouveau libellé)' : ''}.
                  {alreadyUnderTarget > 0 && ` ${plural(alreadyUnderTarget, 'carte est déjà classée', 'cartes sont déjà classées')} sous ce libellé et ne bougent pas.`} Leurs
                  identifiants, l'historique et les échéances restent conservés.
                </p>
                <ul className="kv">
                  {chosen.map((c) => (
                    <li key={c.id}>
                      <span>{c.label}</span>
                      <strong>{c.label === target ? 'Conservé' : `→ ${target}`}</strong>
                    </li>
                  ))}
                  {targetNode && !chosen.includes(targetNode) && (
                    <li>
                      <span>{target} (existant)</span>
                      <strong>Conservé</strong>
                    </li>
                  )}
                </ul>
              </section>
              <p className="muted small">Les nouvelles importations suivront également cette fusion. Cette opération ne s'annule pas automatiquement ; les sous-niveaux sont regroupés sous « {target} ».</p>
            </>
          )}
        </>
      )}

      {message && (message.error ? <ErrorNotice message={message.text} /> : <p className="notice">{message.text}</p>)}

      <div className="action-bar">
        <button type="button" className="btn primary block" disabled={!valid || busy} onClick={() => setAsking(true)}>
          {valid ? `Confirmer la fusion (${plural(movedCards, 'carte', 'cartes')})` : 'Choisissez au moins un libellé à remplacer'}
        </button>
      </div>

      {asking && valid && (
        <ConfirmDialog title="Confirmer la fusion ?" confirmLabel="Confirmer la fusion" busyLabel="Fusion…" busy={busy} onConfirm={() => void confirm()} onCancel={() => setAsking(false)}>
          <p>
            <strong>{plural(movedCards, 'carte', 'cartes')}</strong> {movedCards > 1 ? 'seront reclassées' : 'sera reclassée'} sous « {target} ». Leurs identifiants, leurs échéances et leur historique resteront inchangés.
          </p>
          <p className="muted small">Cette fusion sera également appliquée aux prochains imports.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
