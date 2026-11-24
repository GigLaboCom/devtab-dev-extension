/**
 * Seam `PlanSource` — the Pro plans as the page can show them now (pro-plans-and-payment §4.8). The plans come from the
 * server only (the build holds no price); the seam is there so that the remote source can be replaced in tests of the
 * pages, in the style showcase and in development without a server — never to put plans into a store build. A
 * component imports this interface, never an implementation; the composition root (./index.ts) names one.
 */
import type { Catalog } from './model';

/** What the plans part shows. */
export type PlansView =
  /** The build has no server (no origin): no plans at all. */
  | { readonly kind: 'absent' }
  /** Nothing usable stored, nothing asked yet (the free version until See plans). */
  | { readonly kind: 'idle' }
  /** A request is on its way; `stale` is what to show meanwhile, if anything. */
  | { readonly kind: 'loading'; readonly stale?: { readonly catalog: Catalog; readonly fetchedAt: number } }
  | { readonly kind: 'fresh'; readonly catalog: Catalog; readonly fetchedAt: number }
  | { readonly kind: 'stale'; readonly catalog: Catalog; readonly fetchedAt: number }
  /** Nothing usable to show after an attempt. */
  | {
      readonly kind: 'unavailable';
      readonly why: 'offline' | 'server' | 'bad-answer' | 'rate-limited' | 'server-busy' | 'worker';
      readonly retryAt?: number;
    }
  /** The server speaks a format this version cannot read. */
  | { readonly kind: 'unsupported' };

/**
 * The Pro plans as the page can show them now — a synchronous `current()`, a promise of the first read, every later
 * change, and a way to ask for a fresh list.
 */
export interface PlanSource {
  readonly id: 'remotePlans' | 'samplePlans' | 'memoryPlans';
  current(): PlansView;
  /** Resolves once the stored record has been read (or 2 s passed). */
  readonly ready: Promise<PlansView>;
  /** Called after each change of `current()`, not for an equal view; returns the undo. */
  subscribe(listener: (view: PlansView) => void): () => void;
  /** Asks for a fresh list. Never rejects; `signal` drops the wait, not the worker's request. */
  refresh(reason: 'person' | 'opened', signal?: AbortSignal): Promise<void>;
  dispose(): void;
}

export interface PlanSourceEnvironment {
  readonly chrome: {
    readonly storage: {
      readonly local: Pick<chrome.storage.LocalStorageArea, 'get'>;
      readonly onChanged: Pick<chrome.storage.StorageChangedEvent, 'addListener' | 'removeListener'>;
    };
    readonly runtime: Pick<typeof chrome.runtime, 'sendMessage'>;
  };
  readonly now?: () => number;
}

export type PlanSourceFactory = ((env: PlanSourceEnvironment) => PlanSource) & { readonly id: PlanSource['id'] };
