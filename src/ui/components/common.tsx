// Composants d'interface partagés.
import type { ReactNode } from 'react';
import { href, type Route } from '../router';

// Refonte UX/UI : navigation à cinq destinations (Accueil, Biblio., Réviser, Stats, Plus). La recherche plein texte
// reste disponible depuis la Bibliothèque (écran « search »).
type IconName =
  | 'home' | 'library' | 'review' | 'stats' | 'more' | 'back' | 'chevron' | 'search' | 'arrow'
  | 'book' | 'layers' | 'import' | 'edit' | 'merge' | 'palette' | 'sliders' | 'download' | 'restore' | 'app' | 'protect';
const ICON_PATHS: Record<IconName, string> = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  library: 'M5 4.5h5v15H5zM14 4.5h5v15h-5z',
  review: 'M6 4h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 12l2.2 2.2L15.5 10',
  stats: 'M5 20V12M9.7 20V6M14.3 20V10M19 20V4',
  more: 'M5 12a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0M10.6 12a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0M16.2 12a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0',
  back: 'M15 6l-6 6 6 6',
  chevron: 'M9 6l6 6-6 6',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16.5 16.5 20 20',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  book: 'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7h8M8 11h8',
  layers: 'm12 2 9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
  import: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  edit: 'm5 19-2 2 5-1 12-12-4-4L5 19z',
  merge: 'M4 4v4a4 4 0 0 0 4 4h8m-4-4 4 4-4 4M4 20v-4a4 4 0 0 1 4-4',
  palette: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7 10h.01M10 6h.01M15 7h.01M17 17a2 2 0 0 1-3 2 2 2 0 0 1 .5-3.5',
  sliders: 'M4 6h3m4 0h9M4 12h9m4 0h3M4 18h2m4 0h10M9 4v4M15 10v4M8 16v4',
  download: 'M12 3v12m-5-5 5 5 5-5M5 19h14',
  restore: 'M3 11a9 9 0 1 1 4 8M3 5v6h6M12 7v5l4 2',
  app: 'M8 3h8a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM10 17h4',
  protect: 'M12 2 4 5v6c0 5 3 9 8 11 5-2 8-6 8-11V5l-8-3zM9 12l2 2 4-4',
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

const NAV: { path: string; label: string; icon: IconName }[] = [
  { path: '', label: 'Accueil', icon: 'home' },
  { path: 'library', label: 'Biblio.', icon: 'library' },
  { path: 'review', label: 'Réviser', icon: 'review' },
  { path: 'stats', label: 'Stats', icon: 'stats' },
  { path: 'more', label: 'Plus', icon: 'more' },
];
/** Onglet actif pour les écrans secondaires */
const SECTION_OF: Record<string, string> = { import: 'more', restore: 'more', labels: 'more', search: 'library', program: 'library', card: 'library', guide: 'more' };

export function BottomNav({ route }: { route: Route }) {
  const first = route.path[0] ?? '';
  const current = SECTION_OF[first] ?? first;
  return (
    <nav className="bottom-nav" aria-label="Navigation principale">
      {NAV.map((n) => (
        <a key={n.path} href={href(n.path)} className={current === n.path ? 'active' : ''} aria-current={current === n.path ? 'page' : undefined}>
          <Icon name={n.icon} className="nav-icon" />
          <span className="nav-label">{n.label}</span>
        </a>
      ))}
    </nav>
  );
}

/** Interrupteur accessible (role="switch"). */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span aria-hidden="true" />
    </button>
  );
}

/** Monogramme uniforme d'une matière (voir ui/monogram.ts). */
export function Monogram({ text, size }: { text: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`monogram ${size ?? 'md'}`} aria-hidden="true">
      {text}
    </span>
  );
}

/**
 * En-tête d'écran (refonte) : lien de retour discret, grand titre aligné à gauche, surtitre et phrase d'accompagnement
 * facultatifs. Même signature qu'avant pour les écrans existants.
 */
export function TopBar({
  title,
  back,
  right,
  eyebrow,
  lead,
  backLabel = 'Retour',
}: {
  title: string;
  back?: string | (() => void);
  right?: ReactNode;
  eyebrow?: string;
  lead?: ReactNode;
  backLabel?: string;
}) {
  const backEl = back ? (
    typeof back === 'string' ? (
      <a className="back-link" href={back}>
        <Icon name="back" />
        {backLabel}
      </a>
    ) : (
      <button type="button" className="back-link" onClick={back}>
        <Icon name="back" />
        {backLabel}
      </button>
    )
  ) : null;
  return (
    <header className="top-bar">
      {(backEl || right) && (
        <div className="top-row">
          {backEl ?? <span />}
          {right}
        </div>
      )}
      {eyebrow && <p className="pretitle">{eyebrow}</p>}
      <h1 className="top-title">{title}</h1>
      {lead && <p className="lead">{lead}</p>}
    </header>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function formatLabel(f: 'open' | 'mcq'): string {
  return f === 'mcq' ? 'QCM' : 'Question ouverte';
}

/** Nombre au format français (séparateur de milliers) : affichage seulement. */
export function num(n: number): string {
  return n.toLocaleString('fr-FR');
}

export function plural(n: number, one: string, many: string): string {
  return `${num(n)} ${n > 1 ? many : one}`;
}

/** Message lisible pour une erreur quelconque (IndexedDB renvoie parfois un message vide). */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || e.name || 'erreur inconnue';
  if (typeof e === 'string') return e;
  return 'erreur inconnue';
}

/** Message d'erreur homogène, avec bouton « Réessayer » si l'opération est récupérable (I6). */
export function ErrorNotice({
  message,
  onRetry,
  retryLabel = 'Réessayer',
  busy = false,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  busy?: boolean;
}) {
  return (
    <div className="notice error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn secondary block" onClick={onRetry} disabled={busy}>
          {busy ? 'Nouvelle tentative…' : retryLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Alertes V1 : l'opération A RÉUSSI mais l'actualisation de l'affichage a échoué. Ce n'est pas un échec : aucune
 * nouvelle écriture n'est proposée, seulement d'actualiser l'affichage (`onRefresh`) ou de poursuivre (`children`).
 */
export function SavedNotice({ title, message, onRefresh, refreshLabel = 'Actualiser', children }: { title: string; message: string; onRefresh?: () => void; refreshLabel?: string; children?: ReactNode }) {
  return (
    <div className="notice saved" role="status">
      <p>
        <strong>{title}</strong>
      </p>
      <p>{message}</p>
      {onRefresh && (
        <button type="button" className="btn secondary block" onClick={onRefresh}>
          {refreshLabel}
        </button>
      )}
      {children}
    </div>
  );
}

/**
 * v0.2.2 (I2) : demande de confirmation avant de remplacer des séances en cours.
 * `afterConflict` : formulation utilisée quand une séance est apparue entre-temps (autre onglet).
 */
export function confirmReplace(running: { scopeLabel: string; mode: 'libre' | 'revision' }[], afterConflict = false): boolean {
  const list = running.map((r) => `« ${r.scopeLabel} » (${r.mode === 'revision' ? 'révision' : 'test'})`).join(', ');
  const intro = afterConflict
    ? `Une autre séance vient d'être lancée, peut-être dans un autre onglet : ${list}.`
    : `Une séance est en cours : ${list}.`;
  return window.confirm(`${intro}\nLa remplacer par cette nouvelle séance ? Ses réponses déjà enregistrées sont conservées.`);
}

/** Lot 3A : puces à sélection multiple (OU dans une même dimension), cibles tactiles ≥ 44 px. */
export function ChipGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: T; label: string; count?: number }[];
  selected: readonly T[];
  onToggle: (v: T) => void;
}) {
  return (
    <div className="chip-group" role="group" aria-label={label}>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button key={o.value} type="button" className={on ? 'chip-btn on' : 'chip-btn'} aria-pressed={on} onClick={() => onToggle(o.value)}>
            {o.label}
            {o.count !== undefined && <span className="chip-count">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Durée lisible : « 1 min 05 s », « 42 s », « 1 h 02 min ». */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

/** Affichage compact d'un chronomètre : « 03:07 » ou « 1:02:09 ». */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** Anneau de progression (programme étudié). */
export function Ring({ ratio }: { ratio: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 76 76" aria-hidden="true">
      <circle cx="38" cy="38" r={r} className="ring-track" />
      <circle cx="38" cy="38" r={r} className="ring-value" strokeDasharray={`${c * ratio} ${c}`} transform="rotate(-90 38 38)" />
      <text x="38" y="38" dominantBaseline="central" textAnchor="middle" className="ring-text">
        {Math.round(ratio * 100)}
        <tspan className="ring-pct">%</tspan>
      </text>
    </svg>
  );
}

/** Boîte de confirmation modale (role="dialog"). Échap ou « Annuler » ferment sans rien faire. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  onConfirm,
  onCancel,
  busy,
  danger,
  cancelLabel = 'Annuler',
}: {
  cancelLabel?: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        {children}
        <div className="modal-actions">
          <button type="button" className={`btn ${danger ? 'danger' : 'primary'} block`} onClick={onConfirm} disabled={busy}>
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </button>
          <button type="button" className="btn secondary block" onClick={onCancel} disabled={busy} autoFocus>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
