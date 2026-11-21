/**
 * Text handed from the start page's field to a tool (pasted text a tool's `detect` recognised). It lives in this
 * module's memory only — never in the address, never in storage — and goes when the tool has taken it or the page
 * closes. The same tab keeps the same document across the hash change, so the tool finds it here.
 */
let pending: { tool: string; text: string } | null = null;

export const handOff = (tool: string, text: string): void => {
  pending = { tool, text };
};

/** The text waiting for this tool, if any (read twice under StrictMode: it is cleared by `clearHandoff`). */
export const peekHandoff = (tool: string): string | undefined => (pending?.tool === tool ? pending.text : undefined);

export const clearHandoff = (): void => {
  pending = null;
};
