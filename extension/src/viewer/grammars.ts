/**
 * Grammar files on the editor page (the mixed highlighter build, src/highlighter/treeSitter.ts): the common languages'
 * grammars are compiled into the editor module, the others are files of the extension's package — `grammars/<name>.wasm`
 * and `grammars/index.json`, the index the build made from crates/review-wasm/grammars.json. When a text is shown in a
 * language whose grammar is a file, this page fetches the file from the extension's own origin, checks its sha256
 * against the index, links it into the module and registers it; the module then highlights the open text again. Until
 * then the text is plain.
 *
 * - A grammar is fetched and linked once per page and kept; requests for it while it loads share that load. Two
 *   languages that share a file (one grammar, other queries) link it once.
 * - A grammar the index does not describe for this module — another runtime, an ABI version the module does not take —
 *   is refused before anything is fetched.
 * - A failed load (no file, a different file, a module that refuses it) leaves the text plain, is reported once
 *   (`onEvent` with `failed`) and is not tried again on this page. A load that ends because the page is going away is
 *   not a failure and is not reported (`leaving`, ./pageLife.ts).
 */
import { reportUnlessLeaving } from './pageLife';
import type { PageLife } from './pageLife';
import type { GrammarEntry, GrammarHost, GrammarIndex, ReviewController } from '@extension/review-wasm';

/** What happened to a language's grammar file, for the main page; `*` is the index itself (no grammar file at all). */
export type GrammarEvent =
  | { language: string; state: 'loaded'; repainted: boolean; ms: number }
  | { language: string; state: 'failed'; message: string };

export interface GrammarLoaderDeps {
  /** The package's index, or why there is none (then every name goes to the module as it is). */
  index: GrammarIndex | Error;
  host: GrammarHost;
  /** A file under the package's `grammars/`, its bytes; rejects when it cannot be read. */
  fetchFile: (file: string) => Promise<Uint8Array<ArrayBuffer>>;
  /** Lower-case hex. */
  sha256: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
  onEvent: (event: GrammarEvent) => void;
  /** Whether the page is going away: a load that fails then is not reported (./pageLife.ts). */
  life: PageLife;
  /** The timer an abort waits on before it is reported (./pageLife.ts); `setTimeout` by default. */
  later?: (run: () => void, ms: number) => void;
  now?: () => number;
}

export interface GrammarLoader {
  /**
   * The name the module is given for a language name from outside (an id or an alias of the table → its id; anything
   * else as it is — the module shows it as plain text). When its grammar is a file not loaded yet, the load starts.
   */
  use: (name: string) => string;
  /** Loads a language's grammar file; whether it is registered now. Never rejects. */
  load: (id: string) => Promise<boolean>;
}

/** An error's message (a `DOMException` is not an `Error` everywhere), or what was thrown as text. */
const messageOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : String(error);

const hex = (digest: ArrayBuffer): string =>
  [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** SHA-256 in the page (the extension's pages are a secure context). */
export const subtleSha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', bytes));

/** Reads a file of the extension's package under `grammars/` (the page's own origin: `connect-src 'self'`). */
export const packageFile =
  (base: URL) =>
  async (file: string): Promise<Uint8Array<ArrayBuffer>> => {
    const response = await fetch(new URL(file, base));
    if (!response.ok) throw new Error(`grammars/${file}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };

export const createGrammarLoader = (deps: GrammarLoaderDeps): GrammarLoader => {
  const { index, host } = deps;
  const now = deps.now ?? (() => performance.now());
  const loads = new Map<string, Promise<boolean>>();
  const links = new Map<string, Promise<number>>();
  const reported = new Set<string>();

  const fail = (language: string, error: unknown): false => {
    if (reported.has(language)) return false;
    reported.add(language);
    reportUnlessLeaving(
      error,
      deps.life,
      () => deps.onEvent({ language, state: 'failed', message: messageOf(error) }),
      deps.later,
    );
    return false;
  };

  // The index must be for this module's runtime; a grammar for another is never linked.
  const unusable = (() => {
    if (index instanceof Error) return index;
    if (index.format !== 1) return new Error(`grammars/index.json: format ${String(index.format)}`);
    const { min, max } = index.runtime.abi;
    if (min !== host.abi.min || max !== host.abi.max)
      return new Error(
        `grammars/index.json is for ${index.runtime.crate} ${index.runtime.version} (ABI ${min}–${max}); the editor module takes ABI ${host.abi.min}–${host.abi.max}`,
      );
    return null;
  })();
  if (unusable) fail('*', unusable);
  const usable = unusable ? null : (index as GrammarIndex);

  const link = (entry: GrammarEntry): Promise<number> => {
    let linked = links.get(entry.file);
    if (!linked) {
      linked = (async () => {
        const bytes = await deps.fetchFile(entry.file);
        if (bytes.length !== entry.size || (await deps.sha256(bytes)) !== entry.sha256)
          throw new Error(`grammars/${entry.file} is not the file the index states`);
        return host.link(bytes, entry.symbol);
      })();
      links.set(entry.file, linked);
    }
    return linked;
  };

  const load = (id: string): Promise<boolean> => {
    let loading = loads.get(id);
    if (loading) return loading;
    const entry = usable?.grammars[id];
    if (!entry) return Promise.resolve(false);
    const started = now();
    loading = (async () => {
      if (entry.abi < host.abi.min || entry.abi > host.abi.max)
        throw new Error(
          `grammar ${id}: ABI version ${entry.abi}; the editor module takes ${host.abi.min}–${host.abi.max}`,
        );
      const language = await link(entry);
      const repainted = host.register({ ...entry, id }, language);
      deps.onEvent({ language: id, state: 'loaded', repainted, ms: Math.round(now() - started) });
      return true;
    })().catch(error => fail(id, error));
    loads.set(id, loading);
    return loading;
  };

  return {
    use(name) {
      if (!usable) return name;
      const id = usable.languages[name] ?? usable.languages[name.toLowerCase()];
      if (!id) return name;
      if (id in usable.grammars) void load(id);
      return id;
    },
    load,
  };
};

/** The controller with every language name passed through the loader on its way to the module. */
export const withGrammars = (controller: ReviewController, loader: GrammarLoader): ReviewController => ({
  get ready() {
    return controller.ready;
  },
  compare: request => controller.compare({ ...request, language: loader.use(request.language) }),
  showDiff: payload => controller.showDiff({ ...payload, language: loader.use(payload.language) }),
  showFile: request => controller.showFile({ ...request, language: loader.use(request.language) }),
  setMode: mode => controller.setMode(mode),
  revealLine: (line, column) => controller.revealLine(line, column),
  revealHunk: index => controller.revealHunk(index),
  setEditorSettings: (settings, side) => controller.setEditorSettings(settings, side),
  setLanguage: language => controller.setLanguage(loader.use(language)),
  setSide: request => controller.setSide(request),
  swap: () => controller.swap(),
  setEditable: (side, editable, focus) => controller.setEditable(side, editable, focus),
  markSaved: (side, text) => controller.markSaved(side, text),
  focusSide: side => controller.focusSide(side),
  sideText: side => controller.sideText(side),
  focusedSide: () => controller.focusedSide(),
  setTheme: theme => controller.setTheme(theme),
  onModuleEvent: (name, detail) => controller.onModuleEvent(name, detail),
});
