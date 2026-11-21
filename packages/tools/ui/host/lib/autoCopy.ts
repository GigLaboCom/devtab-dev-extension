/**
 * "Copy automatically after generating" (docs/tools/copying.md): the first per-tool setting. It applies to a tool whose
 * definition says it makes values on request (`output.origin === 'generated'`); the host shows one switch and upserts
 * its state into the entry of every such tool (`AUTO_COPY` in `ToolSettings`).
 *
 * A tool calls `afterGenerate(text)` only from the handler of the person's request for a generation — Generate, by
 * pointer or keyboard — with what its "Copy" / "Copy all" would copy. Never on opening, on restoring an entry, on an
 * edit of the options, or from a timer: Chrome writes the clipboard of a focused page without any user action (probe,
 * docs/research/auto-copy.md), so this rule is ours to keep. Chrome refuses only a page that is not focused
 * ("Document is not focused."); the tool then says so in one line and its copy buttons still work.
 *
 * Recording: the automatic copy records nothing — Generate already committed the same result to the history.
 */
import { useToolSettings } from './useToolSettings';
import { useRef, useState } from 'react';
import type { ToolDescription, ToolHost } from './host';

/** The setting's key in a tool's entry. */
export const AUTO_COPY = 'autoCopy';

/** Does automatic copying apply to this tool (a generator: `output.origin === 'generated'`)? */
export const autoCopyApplies = (tool: Pick<ToolDescription, 'output'>): boolean => tool.output.origin === 'generated';

/** What an automatic copy did. */
export type AutoCopyOutcome = { text: string; ok: true } | { text: string; ok: false; error: string };

/** The line a tool shows when the browser refused the automatic copy. */
export const AUTO_COPY_REFUSED = 'Not copied automatically: the browser did not allow it. Use the Copy button.';

/** The screen reader's one announcement of a generation, with what the automatic copy did (nothing when off). */
export const announceGenerated = (generated: string, outcome: AutoCopyOutcome | null): string =>
  outcome === null ? generated : outcome.ok ? `${generated} and copied` : `${generated}, not copied automatically`;

export interface AutoCopy {
  /** The setting, for this tool. */
  readonly on: boolean;
  /**
   * Call only from the handler of the person's request for a generation, with what "Copy" / "Copy all" would copy.
   * Resolves to what happened, or null when the setting is off (nothing is written).
   */
  afterGenerate(text: string): Promise<AutoCopyOutcome | null>;
  /** The last automatic copy: the copy button shows "Copied" while its text is the value; a refusal is one line. */
  readonly outcome: AutoCopyOutcome | null;
}

const writeClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

/** Reads the tool's setting and copies after a generation the person asked for. `write`: the clipboard (a test's). */
export const useAutoCopy = (
  host: ToolHost | undefined,
  toolId: string,
  write: (text: string) => Promise<void> = writeClipboard,
): AutoCopy => {
  const on = useToolSettings(host, toolId)[AUTO_COPY] === true;
  const [outcome, setOutcome] = useState<AutoCopyOutcome | null>(null);
  const latest = useRef({ on, write });
  latest.current = { on, write };
  const afterGenerate = async (text: string): Promise<AutoCopyOutcome | null> => {
    if (!latest.current.on || text === '') return null;
    let result: AutoCopyOutcome;
    try {
      await latest.current.write(text);
      result = { text, ok: true };
    } catch (error) {
      result = { text, ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
    setOutcome(result);
    return result;
  };
  return { on, afterGenerate, outcome };
};
