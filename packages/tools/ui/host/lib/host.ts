/** The host contract and its default. */
import { memoryToolSettings } from './settings';
import {
  createHistoryFactory,
  memoryKeyHolder,
  memoryStore,
  noCipher,
  passwordCipher,
} from '@workspace/tools-shared/history';
import type { ToolNavigation } from './navigation';
import type { ToolSettings, ToolSettingsStore } from './settings';
import type { HistoryDeclaration, HistoryFactory, PasswordVault } from '@workspace/tools-shared/history';
import type { ComponentType } from 'react';

/** What a host gives every tool. More members come as tools need them (logging). */
export interface ToolHost {
  /** The history factory: `history.forOwner(toolId, declaration)`. */
  history: HistoryFactory;
  /**
   * Per-tool settings: `settings.forTool(toolId)` — the tool's own entry, followed live (settings.ts). Absent: the
   * page's in-memory default (`defaultToolHost.settings`), so a host that keeps none still works.
   */
  settings?: ToolSettings;
  /**
   * Sending the person to another place of the host — another tool, or a part such as the comparison — with what it
   * should start with, in memory (navigation.ts). Absent: `noNavigation`, which goes nowhere and says so.
   */
  navigation?: ToolNavigation;
}

/** A host's request to open an entry of the tool's history in the tool (a new object each time it asks). */
export interface RestoreRequest {
  id: string;
}

/** What the host gives a tool's component. */
export interface ToolProps {
  /** Text to start with: what the user pasted into the start page's field and this tool's `detect` recognised. */
  input?: string;
  /** The host; absent: `defaultToolHost`. */
  host?: ToolHost;
  /** Open this entry of the tool's own history. */
  restore?: RestoreRequest;
}

/** A tool's description: what a host lists, finds and records by. */
export interface ToolDescription {
  id: string;
  title: string;
  /** One line under the title. */
  summary: string;
  keywords: readonly string[];
  /**
   * Where the tool stands in a host's lists and in which order pasted text is offered to `detect`: its number in the
   * registry of docs/tools/README.md (JSON 1, Base64 2, …). Lower first; unique.
   */
  order: number;
  /** What of the tool's work may be recorded (docs/tools/history.md). Absent: nothing. */
  history?: HistoryDeclaration;
  /**
   * A keyboard shortcut the tool suggests to open it — optional, most tools have none. A host may take it as the
   * default and may refuse it (one it or the browser needs, or one an earlier tool already suggested); the person can
   * always change it.
   */
  shortcut?: ToolShortcut;
  /** What the tool's result is — a capability hosts build on (automatic copying first). Every tool states it. */
  output: ToolOutput;
}

/**
 * A key combination in the portable form: `mod` is the platform's command modifier (⌘ on a Mac, Ctrl elsewhere), `code`
 * the physical key (`KeyK`, `Digit1`, `Comma`), `key` its character in lower case.
 */
export interface ToolKey {
  key: string;
  code: string;
  mod: boolean;
  shift: boolean;
  alt?: boolean;
}

/** One combination for every platform, or one per platform where they must differ (null: none there). */
export type ToolShortcut = ToolKey | { mac: ToolKey | null; other: ToolKey | null };

/**
 * What a tool's result is, as a host may use it (docs/tools/copying.md):
 *
 *   { origin: 'generated', copies }  the tool makes a new value when the person asks for one (Generate). A host may
 *                                    copy it at once ("Copy automatically after generating"); `copies` is what one
 *                                    generation puts on the clipboard — what the tool's "Copy" / "Copy all" copies:
 *                                    'lines' — one item, or a batch one item per line, no line break at the end;
 *                                    'text' — the whole result as one text (paragraphs as the tool joins them)
 *   { origin: 'input' }              the result is derived from what the person typed, pasted or dropped (a converter,
 *                                    an inspector): there is nothing to copy that they did not ask for
 */
export type ToolOutput = { origin: 'generated'; copies: 'lines' | 'text' } | { origin: 'input' };

/**
 * A tool as its `ui` package exports it (`definition`, the package's main export): the description and its component,
 * loaded only when the tool is opened. The module is data: it imports its history declaration and nothing else at run
 * time — no logic, no library, no `detect` — so a host can read every tool's definition at build time (the extension
 * makes its start page's catalogue of them) and list the tools without loading their code.
 */
export interface ToolDefinition extends ToolDescription {
  load: () => Promise<{ default: ComponentType<ToolProps> }>;
}

/**
 * Does pasted text look like this tool's input? Cheap and strict: a host may open the tool on it without asking. A tool
 * that recognises its input exports it as `detect` from `src/detect.ts`, its package's `./detect` export — a module of
 * its own, which a host loads only when pasted text needs it (the extension: on the first paste, or when the page is
 * idle after its first paint). A tool without the module recognises nothing.
 */
export type ToolDetect = (text: string) => boolean;

/** What a tool's `./detect` export is. */
export interface ToolDetectModule {
  detect: ToolDetect;
}

/** A host in memory: the history (nothing persists or is encrypted, recording is on) and the per-tool settings. */
export const memoryHost = (): ToolHost & { settings: ToolSettingsStore } => ({
  history: createHistoryFactory({ store: memoryStore(), cipher: noCipher }),
  settings: memoryToolSettings(),
});

/** The host a tool uses when it is rendered with none (one per page, shared by its tools). */
export const defaultToolHost: ToolHost & { settings: ToolSettingsStore } = memoryHost();

/** The master password of `unlockedHost`. */
export const TEST_PASSWORD = 'correct horse battery staple';

/**
 * A host in memory whose history has a master password and is unlocked — for a component test of a tool with a secret
 * kind (`secret: true`), through the real factory and the real cipher: a secret draft is sealed and recorded, and
 * `vault.lock()` locks it (then the factory refuses secret drafts with `secret-locked`, and an opened entry says
 * `locked`). `iterations` keeps the password's derivation fast in a test (the product's is 600 000).
 */
export const unlockedHost = async ({ iterations = 1_000 }: { iterations?: number } = {}): Promise<
  ToolHost & { settings: ToolSettingsStore; vault: PasswordVault; store: ReturnType<typeof memoryStore> }
> => {
  const store = memoryStore();
  const vault = passwordCipher({ keyrings: store, holder: memoryKeyHolder(), iterations });
  await vault.setPassword(TEST_PASSWORD);
  return {
    history: createHistoryFactory({ store, cipher: vault }),
    settings: memoryToolSettings(),
    vault,
    store,
  };
};
