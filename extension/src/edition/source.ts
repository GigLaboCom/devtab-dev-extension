/**
 * Seam `EditionSource` — which edition is in force now (docs/replaceable-behaviors.md). Next to seam `Edition` (what
 * stands behind each thing of Pro, ./edition.ts), a source says which of the two applies at this moment: the edition
 * chosen at build time (`fixedPro`, `fixedFree`), or — later — the state of a licence. The pages never ask it "is this
 * Pro?": the host turns its state into an `Edition` (editionFor, ./inForce.ts) and the places follow the host. The
 * composition root (./index.ts) names one source.
 */
import type { EditionState } from '@extension/licence';

/** What a source says: a licence state, not read yet, or the edition fixed at build time. */
export type SourceState =
  EditionState | { readonly kind: 'unknown' } | { readonly kind: 'fixed'; readonly edition: 'pro' | 'free' };

/**
 * Which edition is in force now: a synchronous `current()`, a promise of the first known state, and every later change.
 */
export interface EditionSource {
  readonly id: 'fixedPro' | 'fixedFree' | 'licensed';
  current(): SourceState;
  /** Resolves with the first state that is not `unknown`. */
  readonly ready: Promise<SourceState>;
  /** Called after each change of `current()` (not for an equal state); returns the undo. */
  subscribe(listener: (state: SourceState) => void): () => void;
  /** Stops listening to storage and timers. */
  dispose(): void;
}

/** What a source may read: the stored licence record and its changes, and the worker to ask. */
export interface EditionSourceEnvironment {
  readonly chrome: {
    readonly storage: {
      readonly local: Pick<chrome.storage.LocalStorageArea, 'get'>;
      readonly onChanged: Pick<chrome.storage.StorageChangedEvent, 'addListener' | 'removeListener'>;
    };
    readonly runtime: Pick<typeof chrome.runtime, 'sendMessage'>;
  };
  readonly now?: () => number;
  /** For tests; default: globalThis.crypto.subtle. */
  readonly subtle?: SubtleCrypto;
}

/** What a composition root names: a way to build the source of a page, with its name for reports. */
export type EditionSourceFactory = ((env: EditionSourceEnvironment) => EditionSource) & {
  readonly id: EditionSource['id'];
};
