// Fiabilisation de la sauvegarde d'une session (correctif B1, v1.1).
// Une transition (réponse, passage à la carte suivante, fin du test) n'est confirmée
// qu'APRÈS la réussite de son écriture. En cas d'échec, elle reste « en attente » pour être réessayée,
// et l'état confirmé ne change pas : la progression n'avance pas et la réponse n'est pas perdue.
import type { TestSession } from '../domain/types';

export type ApplyOutcome =
  | { status: 'saved'; session: TestSession }
  /** stale = la session a été modifiée ailleurs (autre onglet) : réessayer est inutile, il faut recharger */
  | { status: 'failed'; error: string; stale: boolean }
  /** Une écriture est déjà en cours : action ignorée (évite les doubles validations) */
  | { status: 'busy' }
  /** Une transition précédente a échoué : il faut la réessayer ou l'abandonner d'abord */
  | { status: 'blocked' };

export class SessionController {
  private confirmed: TestSession;
  private pendingNext: TestSession | null = null;
  private writing = false;

  constructor(
    initial: TestSession,
    private readonly save: (s: TestSession) => Promise<void>,
  ) {
    this.confirmed = initial;
  }

  /** Dernier état effectivement enregistré */
  get current(): TestSession {
    return this.confirmed;
  }

  /** Transition dont l'enregistrement a échoué, conservée pour une nouvelle tentative */
  get pending(): TestSession | null {
    return this.writing ? null : this.pendingNext;
  }

  /**
   * v0.3.0-a1 : état le plus récent connu de cet écran : transition en cours d'écriture ou en échec, sinon état
   * enregistré. Sert à l'affichage du chronomètre et au constat de la limite, jamais à l'enregistrement.
   */
  get latest(): TestSession {
    return this.pendingNext ?? this.confirmed;
  }

  get busy(): boolean {
    return this.writing;
  }

  async apply(next: TestSession): Promise<ApplyOutcome> {
    if (this.writing) return { status: 'busy' };
    if (this.pendingNext && this.pendingNext !== next) return { status: 'blocked' };
    this.writing = true;
    this.pendingNext = next;
    // v1.1.1 : chaque enregistrement porte la révision suivant l'état confirmé (contrôle de version en base)
    const stamped: TestSession = { ...next, revision: (this.confirmed.revision ?? 0) + 1 };
    try {
      await this.save(stamped);
      this.confirmed = stamped;
      this.pendingNext = null;
      return { status: 'saved', session: stamped };
    } catch (e) {
      return {
        status: 'failed',
        error: e instanceof Error ? e.message || e.name : String(e),
        stale: (e as { name?: string } | null)?.name === 'StaleSessionError',
      };
    } finally {
      this.writing = false;
    }
  }

  /** Réessaie la transition en échec (sans effet s'il n'y en a pas). */
  async retry(): Promise<ApplyOutcome> {
    if (this.writing) return { status: 'busy' };
    if (!this.pendingNext) return { status: 'saved', session: this.confirmed };
    return this.apply(this.pendingNext);
  }

  /**
   * v0.3.0-a1 (B1) : remplace la transition en échec par une transition construite à partir d'elle
   * (ex. fin du temps limite : la réponse non enregistrée est conservée et la séance se termine), puis l'enregistre.
   * Sans transition en échec, équivaut à `apply(build(current))`.
   */
  async supersede(build: (base: TestSession) => TestSession): Promise<ApplyOutcome> {
    if (this.writing) return { status: 'busy' };
    const next = build(this.pendingNext ?? this.confirmed);
    this.pendingNext = null;
    return this.apply(next);
  }

  /** Abandonne la transition en échec (l'utilisatrice a choisi de quitter sans enregistrer). */
  discardPending(): void {
    if (!this.writing) this.pendingNext = null;
  }
}
