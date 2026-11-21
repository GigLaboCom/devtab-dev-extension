/**
 * "Open in its tool" from the History page: the entry's id waits here, in this module's memory, until the tool's page
 * takes it (the same document survives the hash change). Never in the address, never in storage.
 */
let pending: { owner: string; id: string } | null = null;

export const handOffRestore = (owner: string, id: string): void => {
  pending = { owner, id };
};

/** The entry waiting for this owner (read twice under StrictMode: cleared by `clearRestore`). */
export const peekRestore = (owner: string): string | undefined => (pending?.owner === owner ? pending.id : undefined);

export const clearRestore = (): void => {
  pending = null;
};
