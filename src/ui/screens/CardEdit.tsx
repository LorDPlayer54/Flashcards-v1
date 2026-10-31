// Lot 3B : ajout et modification manuelles d'une carte (formulaire adapté au téléphone).
// Tous les champs pédagogiques, questions ouvertes et QCM ; à la modification de la question ou de la réponse,
// choix explicite de conserver ou de réinitialiser l'état de mémorisation (comme lors d'une réimportation).
import { useEffect, useMemo, useState } from 'react';
import type { Card } from '../../domain/types';
import { contentChanged, contentFromForm, formFromCard, mcqAnswerText, OPTION_IDS, type CardForm, type FormField } from '../../library/cardForm';
import { CardConflictError, createCard, getCard, getReviewState, MANUAL_COLLECTION_NAME, updateCard } from '../../storage/repo';
import { breadcrumb, ROOT_ID } from '../../taxonomy/tree';
import { useApp } from '../AppContext';
import { ErrorNotice, errorMessage, Segmented, TopBar } from '../components/common';
import { href, libraryHref, navigate } from '../router';

const DIFFICULTIES = ['Facile', 'Moyen', 'Difficile'];

function unique(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, 'fr'));
}

export function CardEdit({ cardId, nodeId }: { cardId?: string; nodeId?: string }) {
  const { db, metas, tax, collections, reload } = useApp();
  const editing = cardId !== undefined;
  const [card, setCard] = useState<Card | null | undefined>(editing ? undefined : null);
  const [hasMemory, setHasMemory] = useState(false);
  const [form, setForm] = useState<CardForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [target, setTarget] = useState<string>('manual');
  const [memoryChoice, setMemoryChoice] = useState<'keep' | 'reset'>('keep');
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Chargement (modification) ou préremplissage d'après le niveau consulté (ajout)
  useEffect(() => {
    let alive = true;
    setLoadError(null);
    if (!editing) {
      const prefill: Record<string, string> = {};
      if (nodeId && nodeId !== ROOT_ID && tax.byId.has(nodeId)) for (const n of breadcrumb(tax, nodeId)) if (n.kind !== 'root') prefill[n.kind] = n.label;
      setForm(formFromCard(undefined, prefill));
      return;
    }
    Promise.all([getCard(db, cardId), getReviewState(db, cardId)])
      .then(([c, st]) => {
        if (!alive) return;
        setCard(c ?? null);
        setHasMemory(Boolean(st));
        setForm(c ? formFromCard(c) : null);
        setMemoryChoice('keep');
      })
      .catch((e: unknown) => alive && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
    // tax : uniquement pour le préremplissage initial
  }, [db, cardId, editing, attempt]);

  // Suggestions : libellés existants (saisie libre possible)
  const suggestions = useMemo(() => {
    const f = form;
    const inMat = metas.filter((m) => m.matiere === f?.matiere);
    const inTheme = inMat.filter((m) => (m.theme ?? '') === (f?.theme ?? ''));
    return {
      matieres: unique(metas.map((m) => m.matiere)),
      themes: unique(inMat.map((m) => m.theme)),
      lecons: unique(inTheme.map((m) => m.lecon)),
      notions: unique(inTheme.map((m) => m.notion)),
      types: unique(metas.map((m) => m.typePedagogique)),
    };
  }, [metas, form?.matiere, form?.theme]);

  const back = editing ? href(`card/${encodeURIComponent(cardId)}`) : nodeId ? libraryHref(nodeId) : libraryHref(ROOT_ID);

  if (loadError)
    return (
      <div className="page">
        <TopBar title="Modifier la carte" back={back} />
        <ErrorNotice message={`Impossible de charger la carte : ${loadError}`} onRetry={() => setAttempt((a) => a + 1)} />
      </div>
    );
  if (editing && card === undefined) return <div className="page center muted">Chargement…</div>;
  if (editing && card === null)
    return (
      <div className="page">
        <TopBar title="Modifier la carte" back={libraryHref(ROOT_ID)} />
        <p className="notice">Cette carte n'existe plus.</p>
      </div>
    );
  if (!form) return <div className="page center muted">Chargement…</div>;

  /** Un champ corrigé perd son message d'erreur (les autres restent jusqu'au prochain enregistrement) */
  const clearError = (...keys: FormField[]) =>
    setErrors((e) => {
      if (!keys.some((k) => e[k])) return e;
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });
  const set = <K extends keyof CardForm>(key: K, value: CardForm[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    clearError(key, ...(key === 'formatQuestion' ? (['options', 'correctIndex', 'reponse'] as FormField[]) : []));
  };
  const setOption = (i: number, value: string) => {
    setForm((f) => (f ? { ...f, options: f.options.map((o, k) => (k === i ? value : o)) } : f));
    clearError('options');
  };

  const existing = card ?? undefined;
  const check = contentFromForm(form, existing);
  const majorChange = check.ok && check.majorChange;
  const unchanged = existing && check.ok && !contentChanged(existing, check.content);
  const manualCollection = collections.find((c) => c.manual);

  const save = async () => {
    const res = contentFromForm(form, existing);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setSaveError(null);
    let saved: Card;
    try {
      saved = existing
        ? await updateCard(db, {
            cardId: existing.cardId,
            expectedUpdatedAt: existing.updatedAt,
            content: res.content,
            resetReview: res.majorChange && hasMemory && memoryChoice === 'reset',
          })
        : await createCard(db, {
            content: res.content,
            collection: target === 'manual' ? { kind: 'manual' } : { kind: 'existing', collectionId: target },
          });
    } catch (e) {
      setBusy(false);
      setSaveError({
        message:
          e instanceof CardConflictError
            ? `${e.message} Vos modifications n'ont pas été enregistrées : rechargez la carte pour partir de sa version actuelle.`
            : `La carte n'a pas été enregistrée (aucune donnée modifiée) : ${errorMessage(e)}. Vous pouvez réessayer.`,
        conflict: e instanceof CardConflictError,
      });
      return;
    }
    setSavedId(saved.cardId);
    try {
      await reload();
      navigate(`card/${encodeURIComponent(saved.cardId)}`, undefined, true);
    } catch (e) {
      // La carte est enregistrée ; seule l'actualisation de la bibliothèque a échoué
      setBusy(false);
      setRefreshError(errorMessage(e));
    }
  };

  const retryRefresh = async () => {
    try {
      await reload();
      navigate(`card/${encodeURIComponent(savedId!)}`, undefined, true);
    } catch (e) {
      setRefreshError(errorMessage(e));
    }
  };

  const err = (k: FormField) =>
    errors[k] ? (
      <p className="field-error" role="alert">
        {errors[k]}
      </p>
    ) : null;

  const textField = (k: 'matiere' | 'theme' | 'lecon' | 'notion' | 'typePedagogique', label: string, list?: string[], required = false) => (
    <div className="form-row">
      <label htmlFor={`f-${k}`}>
        {label}
        {required ? ' *' : ''}
      </label>
      <input
        id={`f-${k}`}
        className="input"
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
        list={list ? `l-${k}` : undefined}
        autoComplete="off"
        aria-invalid={Boolean(errors[k])}
      />
      {list && (
        <datalist id={`l-${k}`}>
          {list.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      )}
      {err(k)}
    </div>
  );

  const area = (k: 'question' | 'reponse' | 'explication' | 'astucePiege', label: string, rows: number, required = false) => (
    <div className="form-row">
      <label htmlFor={`f-${k}`}>
        {label}
        {required ? ' *' : ''}
      </label>
      <textarea id={`f-${k}`} className="input textarea" rows={rows} value={form[k]} onChange={(e) => set(k, e.target.value)} aria-invalid={Boolean(errors[k])} />
      {err(k)}
    </div>
  );

  const correct = form.correctIndex !== null ? form.options[form.correctIndex]?.trim() : '';

  if (refreshError) {
    return (
      <div className="page">
        <TopBar title={editing ? 'Modifier la carte' : 'Ajouter une carte'} back={back} />
        <ErrorNotice
          message={`La carte est enregistrée, mais la bibliothèque n'a pas pu être actualisée (${refreshError}).`}
          onRetry={() => void retryRefresh()}
          retryLabel="Actualiser"
        />
        <a className="btn secondary block" href={href(`card/${encodeURIComponent(savedId!)}`)}>
          Voir la carte
        </a>
      </div>
    );
  }

  return (
    <div className="page with-action-bar card-form">
      <TopBar title={editing ? 'Modifier la carte' : 'Ajouter une carte'} back={back} />

      <section className="card-block">
        <h3 className="label">Classement</h3>
        {textField('matiere', 'Matière', suggestions.matieres, true)}
        {textField('theme', 'Thème', suggestions.themes)}
        {textField('lecon', 'Leçon', suggestions.lecons)}
        {textField('notion', 'Notion', suggestions.notions)}
        <p className="muted small">Les niveaux vides sont simplement omis. Choisissez un libellé proposé pour rejoindre un niveau existant.</p>
      </section>

      <section className="card-block">
        <h3 className="label">Caractéristiques</h3>
        {textField('typePedagogique', 'Type pédagogique', suggestions.types)}
        <div className="form-row">
          <label htmlFor="f-difficulte">Difficulté</label>
          <select id="f-difficulte" className="input" value={form.difficulte} onChange={(e) => set('difficulte', e.target.value)}>
            <option value="">Non renseignée</option>
            {[...new Set([...DIFFICULTIES, ...(form.difficulte && !DIFFICULTIES.includes(form.difficulte) ? [form.difficulte] : [])])].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        {!editing && (
          <div className="form-row">
            <label htmlFor="f-collection">Collection</label>
            <select id="f-collection" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="manual">{manualCollection ? manualCollection.name : `${MANUAL_COLLECTION_NAME} (nouvelle)`}</option>
              {collections
                .filter((c) => !c.manual)
                .map((c) => (
                  <option key={c.collectionId} value={c.collectionId}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
        )}
      </section>

      <section className="card-block">
        <h3 className="label">Contenu</h3>
        <div className="form-row">
          <span className="form-label">Format</span>
          <Segmented
            label="Format de la question"
            value={form.formatQuestion}
            onChange={(v) => set('formatQuestion', v)}
            options={[
              { value: 'open', label: 'Question ouverte' },
              { value: 'mcq', label: 'QCM' },
            ]}
          />
        </div>
        {area('question', form.formatQuestion === 'mcq' ? 'Énoncé (sans les propositions)' : 'Question', 4, true)}
        {form.formatQuestion === 'mcq' ? (
          <fieldset className="form-row options-edit">
            <legend>Propositions * (2 à 5) et bonne réponse</legend>
            {OPTION_IDS.map((id, i) => (
              <div key={id} className="option-edit">
                <input
                  type="radio"
                  name="correct"
                  id={`f-correct-${id}`}
                  checked={form.correctIndex === i}
                  onChange={() => set('correctIndex', i)}
                  aria-label={`Bonne réponse : ${id}`}
                />
                <label htmlFor={`f-opt-${id}`} className="opt-letter">
                  {id}
                </label>
                <input id={`f-opt-${id}`} className="input" value={form.options[i] ?? ''} onChange={(e) => setOption(i, e.target.value)} />
              </div>
            ))}
            <p className="muted small">Cochez le rond de la bonne proposition. Les emplacements vides en fin de liste sont ignorés.</p>
            {err('options')}
            {err('correctIndex')}
            {correct && form.correctIndex !== null && (
              <p className="small">Réponse affichée : {mcqAnswerText({ id: OPTION_IDS[form.correctIndex]!, text: correct })}</p>
            )}
          </fieldset>
        ) : (
          area('reponse', 'Réponse', 4, true)
        )}
        {area('explication', 'Explication', 3)}
        {area('astucePiege', 'Astuce / Piège', 2)}
      </section>

      {editing && majorChange && (
        <section className="card-block">
          <h3 className="label">Mémorisation de cette carte</h3>
          {hasMemory ? (
            <>
              <p className="small">La question ou la réponse a changé. Que faire de l'état de mémorisation de cette carte ?</p>
              <label className="radio-row">
                <input type="radio" name="memory" checked={memoryChoice === 'keep'} onChange={() => setMemoryChoice('keep')} />
                <span>Conserver (échéances inchangées)</span>
              </label>
              <label className="radio-row">
                <input type="radio" name="memory" checked={memoryChoice === 'reset'} onChange={() => setMemoryChoice('reset')} />
                <span>Réinitialiser (la carte redevient nouvelle)</span>
              </label>
              <p className="muted small">Dans les deux cas, l'identifiant de la carte et l'historique de ses révisions sont conservés.</p>
            </>
          ) : (
            <p className="small">La question ou la réponse a changé. Cette carte n'a pas encore d'état de mémorisation.</p>
          )}
        </section>
      )}

      {editing && existing?.externalId && (
        <p className="muted small">
          Carte importée ({existing.externalId}) : une réimportation du fichier dans sa collection la signalera comme modifiée et vous proposera
          d'appliquer la version du fichier.
        </p>
      )}

      {saveError && (
        <ErrorNotice
          message={saveError.message}
          onRetry={saveError.conflict ? () => setAttempt((a) => a + 1) : () => void save()}
          retryLabel={saveError.conflict ? 'Recharger la carte' : 'Réessayer'}
          busy={busy}
        />
      )}
      {Object.keys(errors).length > 0 && (
        <p className="notice error" role="alert">
          Corrigez les champs signalés avant d'enregistrer.
        </p>
      )}

      <div className="action-bar">
        <button type="button" className="btn primary block" onClick={() => void save()} disabled={busy || unchanged}>
          {busy ? 'Enregistrement…' : unchanged ? 'Aucune modification' : editing ? 'Enregistrer les modifications' : 'Ajouter la carte'}
        </button>
      </div>
    </div>
  );
}
