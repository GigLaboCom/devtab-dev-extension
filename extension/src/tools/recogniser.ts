/**
 * Seam `PasteRecogniser` — which of our tools text pasted into the start page's field or the shell's palette is for
 * (docs/replaceable-behaviors.md). The tool that recognises it opens with the text (app/finder/useFinder.ts). The
 * default (toolRecogniser.ts) asks the tools' `detect` (detectors.ts), a chunk the page loads only when it needs it:
 * until it has arrived
 * the recogniser answers `PENDING`, and the field waits for `ready()` — the paste is held, then either opens the tool or
 * goes into the field as typed text. Synchronous once loaded, because a paste has to be taken or let through in its own
 * event.
 */
export const PENDING: unique symbol = Symbol('pending');

export interface PasteRecogniser {
  /** The id of the tool that recognises the text; undefined when none does; PENDING while the code has not arrived. */
  recognise(text: string): string | undefined | typeof PENDING;
  /** Resolves once `recognise` answers without PENDING (starts loading what it needs, if that has not started). */
  ready(): Promise<void>;
}

/** Recognises nothing: pasted text is text (a load that failed; a page without recognition). */
export const recognisesNothing: PasteRecogniser = { recognise: () => undefined, ready: () => Promise.resolve() };

/** A recogniser over a function that is already here. */
export const recogniserOf = (recognise: (text: string) => string | undefined): PasteRecogniser => ({
  recognise,
  ready: () => Promise.resolve(),
});

/**
 * A recogniser whose code arrives later: PENDING until `load` resolves, then the loaded one; recognises nothing if the
 * load fails (the paste goes into the field).
 */
export const deferredRecogniser = (load: () => Promise<PasteRecogniser>): PasteRecogniser => {
  let loaded: PasteRecogniser | undefined;
  let loading: Promise<void> | undefined;
  const ready = (): Promise<void> =>
    (loading ??= load().then(
      r => {
        loaded = r;
        return r.ready();
      },
      e => {
        loaded = recognisesNothing;
        throw e;
      },
    ));
  return { recognise: text => (loaded ? loaded.recognise(text) : PENDING), ready };
};
