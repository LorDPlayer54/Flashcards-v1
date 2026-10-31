// Composants d'interface partagés.
import type { ReactNode } from 'react';
import { href, type Route } from '../router';

const NAV = [
  { path: '', label: 'Accueil', icon: '⌂' },
  { path: 'library', label: 'Bibliothèque', icon: '☰' },
  { path: 'review', label: 'Réviser', icon: '↻' },
  { path: 'search', label: 'Recherche', icon: '⌕' },
  // Lot 2 : « Importer » passe dans « Plus » (et reste accessible depuis l'accueil et la bibliothèque)
  { path: 'more', label: 'Plus', icon: '⋯' },
];

export function BottomNav({ route }: { route: Route }) {
  const current = route.path[0] === 'import' ? 'more' : (route.path[0] ?? '');
  return (
    <nav className="bottom-nav" aria-label="Navigation principale">
      {NAV.map((n) => (
        <a key={n.path} href={href(n.path)} className={current === n.path ? 'active' : ''} aria-current={current === n.path ? 'page' : undefined}>
          <span className="nav-icon" aria-hidden="true">
            {n.icon}
          </span>
          <span className="nav-label">{n.label}</span>
        </a>
      ))}
    </nav>
  );
}

export function TopBar({ title, back, right }: { title: string; back?: string | (() => void); right?: ReactNode }) {
  return (
    <header className="top-bar">
      {back ? (
        typeof back === 'string' ? (
          <a className="icon-btn" href={back} aria-label="Retour">
            ‹
          </a>
        ) : (
          <button type="button" className="icon-btn" onClick={back} aria-label="Retour">
            ‹
          </button>
        )
      ) : (
        <span className="icon-spacer" />
      )}
      <h1 className="top-title">{title}</h1>
      {right ?? <span className="icon-spacer" />}
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

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;
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
