/** The host contract and its default. */
import { createHistoryFactory, memoryStore, noCipher } from '@workspace/tools-shared/history';
import type { HistoryDeclaration, HistoryFactory } from '@workspace/tools-shared/history';
import type { ComponentType } from 'react';

/** What a host gives every tool. More members come as tools need them (options, navigation, logging). */
export interface ToolHost {
  /** The history factory: `history.forOwner(toolId, declaration)`. */
  history: HistoryFactory;
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
  /** Does pasted text look like this tool's input? Cheap and strict: a host may open the tool on it without asking. */
  detect?: (text: string) => boolean;
  /** What of the tool's work may be recorded (docs/tools/history.md). Absent: nothing. */
  history?: HistoryDeclaration;
}

/**
 * A tool as its `ui` package exports it (`definition`, the package's main export): the description and its component,
 * loaded only when the tool is opened. The module that exports it stays light — it is part of every host page that
 * lists the tools (the start page's field runs `detect`), so it imports no library of the tool.
 */
export interface ToolDefinition extends ToolDescription {
  load: () => Promise<{ default: ComponentType<ToolProps> }>;
}

/** A host with an in-memory history: nothing persists, nothing is encrypted, recording is on. */
export const memoryHost = (): ToolHost => ({
  history: createHistoryFactory({ store: memoryStore(), cipher: noCipher }),
});

/** The host a tool uses when it is rendered with none (one per page, shared by its tools). */
export const defaultToolHost: ToolHost = memoryHost();
