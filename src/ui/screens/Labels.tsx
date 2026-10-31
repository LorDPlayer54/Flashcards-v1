// Lot 3B : fusion explicite des libellés (matière, thème, leçon, notion).
// Sans niveau choisi : libellés semblables détectés (suggestions) et fusions mémorisées.
// Avec un niveau parent : choix des libellés frères à fusionner, du libellé cible, aperçu (libellés et nombre de
// cartes), puis confirmation explicite. Jamais de fusion automatique.
import { useEffect, useMemo, useState } from 'react';
import { forgetLabelRule, getLabelRules, mergeLabels } from '../../storage/repo';
import { similarLabelGroups, similarLabels, type LabelLevel, type LabelRule } from '../../taxonomy/labelMerge';
import { childNodeId, LEVEL_LABELS, nodePathLabel, ROOT_ID, type TaxNode } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, plural, Segmented, TopBar } from '../components/common';
import { href, libraryHref, navigate, type Route } from '../router';

const LEVEL_PLURAL: Record<LabelLevel, string> = { matiere: 'Matières', theme: 'Thèmes', lecon: 'Leçons', notion: 'Notions' };

export function labelsHref(parentId: string, level?: LabelLevel, selected?: string[]): string {
  return href('labels', { n: parentId, k: level, s: selected && selected.length ? JSON.stringify(selected) : undefined });
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

  const forget = async (r: LabelRule) => {
    if (!window.confirm(`Ne plus appliquer « ${r.from} → ${r.to} » aux prochains imports ? Les cartes déjà fusionnées ne changent pas.`)) return;
    try {
      await forgetLabelRule(db, r);
      setAttempt((a) => a + 1);
      await reload().catch(() => undefined); // règles à jour dans toute l'application (lot 4)
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const parentLabel = (id: string) => (id === ROOT_ID ? 'Bibliothèque' : nodePathLabel(tax, id));

  return (
    <div className="page">
      <TopBar title="Libellés" back={href('more')} />
      <p className="small">
        Regroupez des matières, thèmes, leçons ou notions écrits différemment (« Fraction » et « Fractions », par exemple). Rien n'est fusionné sans
        votre confirmation : choisissez un niveau dans la bibliothèque, puis « Fusionner des libellés ».
      </p>

      <section>
        <h3 className="section-title">Libellés semblables détectés</h3>
        {groups.length === 0 ? (
          <p className="muted">Aucun libellé semblable détecté.</p>
        ) : (
          <ul className="list">
            {groups.map((g) => (
              <li key={`${g.parentId}|${g.level}|${g.labels.map((l) => l.label).join('|')}`}>
                <a className="list-row" href={labelsHref(g.parentId, g.level, g.labels.map((l) => l.label))}>
                  <span className="row-main">
                    {g.labels.map((l) => `« ${l.label} » (${l.total})`).join(', ')}
                    <span className="row-sub">
                      {LEVEL_PLURAL[g.level]} de : {parentLabel(g.parentId)}
                    </span>
                  </span>
                  <span className="chev" aria-hidden="true">
                    ›
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="section-title">Fusions mémorisées</h3>
        {error && <ErrorNotice message={`Lecture impossible : ${error}`} onRetry={() => setAttempt((a) => a + 1)} />}
        {rules && rules.length === 0 && <p className="muted">Aucune fusion pour l'instant.</p>}
        {rules && rules.length > 0 && (
          <>
            <p className="muted small">Elles sont appliquées aux prochains imports : un fichier qui contient l'ancien libellé est reclassé automatiquement.</p>
            <ul className="list">
              {rules.map((r) => (
                <li key={`${r.level}|${r.parentId}|${r.from}`} className="list-row static">
                  <span className="row-main">
                    « {r.from} » → « {r.to} »
                    <span className="row-sub">
                      {LEVEL_LABELS[r.level]} · {parentLabel(r.parentId)} · {new Date(r.at).toLocaleDateString('fr-FR')}
                    </span>
                  </span>
                  <button type="button" className="btn ghost small" onClick={() => void forget(r)}>
                    Oublier
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
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

  if (!parent) {
    return (
      <div className="page">
        <TopBar title="Fusionner des libellés" back={libraryHref(ROOT_ID)} />
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
    if (!valid || !level) return;
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
        setMessage({ text: "Les cartes de ces libellés ont changé depuis l'affichage (autre onglet ou import). Rien n'a été modifié ; l'aperçu va être actualisé, vérifiez-le puis confirmez de nouveau.", error: true });
        await reload().catch((e: unknown) => setMessage({ text: `Rien n'a été modifié, mais l'aperçu n'a pas pu être actualisé : ${errorMessage(e)}. Rechargez la page.`, error: true }));
        setBusy(false);
        return;
      }
      try {
        await reload();
      } catch (e) {
        setBusy(false);
        setMessage({ text: `Fusion effectuée (${plural(res.updated, 'carte reclassée', 'cartes reclassées')}), mais la bibliothèque n'a pas pu être actualisée : ${errorMessage(e)}. Rechargez la page.`, error: true });
        return;
      }
      navigate('library', { n: childNodeId(parentId, level, target), merged: String(res.updated) }, true);
    } catch (e) {
      setBusy(false);
      setMessage({ text: `La fusion n'a pas été effectuée (aucune carte modifiée) : ${errorMessage(e)}. Vous pouvez réessayer.`, error: true });
    }
  };

  return (
    <div className="page with-action-bar">
      <TopBar title="Fusionner des libellés" back={libraryHref(parentId)} />
      <p className="crumbs">{parentId === ROOT_ID ? 'Bibliothèque' : nodePathLabel(tax, parentId)}</p>

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
          <section className="card-block">
            <h3 className="label">1. {LEVEL_PLURAL[level]} à regrouper</h3>
            {siblings.map((s) => {
              const similar = siblings.filter((o) => o !== s && similarLabels(o.label, s.label)).map((o) => o.label);
              return (
                <label key={s.id} className="radio-row">
                  <input type="checkbox" checked={selected.includes(s.label)} onChange={() => toggle(s.label)} />
                  <span>
                    « {s.label} » <span className="muted small">({plural(s.total, 'carte', 'cartes')})</span>
                    {similar.length > 0 && <span className="muted small"> · semblable à {similar.map((x) => `« ${x} »`).join(', ')}</span>}
                  </span>
                </label>
              );
            })}
          </section>

          {chosen.length > 0 && (
            <section className="card-block">
              <h3 className="label">2. Libellé à conserver</h3>
              {chosen.map((c) => (
                <label key={c.id} className="radio-row">
                  <input type="radio" name="target" checked={!useCustom && target === c.label} onChange={() => setPick({ custom: false, label: c.label })} />
                  <span>« {c.label} »</span>
                </label>
              ))}
              <label className="radio-row">
                <input type="radio" name="target" checked={useCustom} onChange={() => setPick({ custom: true, label: null })} />
                <span>Autre libellé :</span>
              </label>
              <input
                className="input"
                value={custom}
                placeholder="Nouveau libellé"
                aria-label="Nouveau libellé"
                onChange={(e) => {
                  setPick({ custom: true, label: null });
                  setCustom(e.target.value);
                }}
              />
            </section>
          )}

          {valid && (
            <section className="card-block merge-preview" aria-live="polite">
              <h3 className="label">3. Aperçu</h3>
              <ul className="kv">
                {chosen.map((c) => (
                  <li key={c.id}>
                    <span>« {c.label} »</span>
                    <strong>{c.label === target ? `conservé (${c.total})` : `${c.total} → « ${target} »`}</strong>
                  </li>
                ))}
                {targetNode && !chosen.includes(targetNode) && (
                  <li>
                    <span>« {target} » (existant)</span>
                    <strong>{targetNode.total}</strong>
                  </li>
                )}
              </ul>
              <p className="small">
                <strong>{plural(movedCards, 'carte sera reclassée', 'cartes seront reclassées')}</strong> sous « {target} »
                {targetNode || chosen.some((c) => c.label === target) ? '' : ' (nouveau libellé)'}. Leurs identifiants, échéances et historiques sont
                conservés ; leurs sous-niveaux sont regroupés sous « {target} ».
              </p>
              <p className="muted small">
                La fusion est mémorisée et appliquée aux prochains imports. Elle ne s'annule pas automatiquement : les cartes réunies ne peuvent plus
                être distinguées par leur ancien libellé.
              </p>
            </section>
          )}
        </>
      )}

      {message && (message.error ? <ErrorNotice message={message.text} /> : <p className="notice">{message.text}</p>)}

      <div className="action-bar">
        <button type="button" className="btn primary block" disabled={!valid || busy} onClick={() => void confirm()}>
          {busy ? 'Fusion…' : valid ? `Confirmer la fusion (${plural(movedCards, 'carte', 'cartes')})` : 'Choisissez au moins un libellé à remplacer'}
        </button>
      </div>
    </div>
  );
}
