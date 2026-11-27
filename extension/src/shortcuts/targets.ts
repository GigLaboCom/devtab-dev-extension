/**
 * Which parts of the page offer the commands of a section now (actions.ts, `ShortcutAction.command`; D38): the
 * Projects section offers its panels while a project is open, the open scratch its download, rename, language and
 * delete, the shell a new scratch file while the edition has scratch files. A part offers its handlers while it has a
 * target and takes them back when it has none or goes away; the latest offer of a command is the one that runs. The
 * shell keeps one of these per page: its listener asks it whether a command has a target (a key with none goes on to
 * the page), and the keys the editor hands up follow it (`watch`). Pure: no DOM, no storage.
 */

export type CommandHandlers = Readonly<Record<string, () => void>>;

export interface ShortcutTargets {
  /** Offers these commands until the returned undo is called. */
  offer(handlers: CommandHandlers): () => void;
  /** Whether a part offers the command now. */
  offers(id: string): boolean;
  /** Runs the command's latest offer; false when nothing offers it. */
  run(id: string): boolean;
  /** The commands offered now, sorted. */
  offered(): string[];
  /** Hears every change of what is offered; returns the undo. */
  watch(listener: () => void): () => void;
}

export const createTargets = (): ShortcutTargets => {
  const offers: Array<{ handlers: CommandHandlers }> = [];
  const listeners = new Set<() => void>();
  const changed = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const latest = (id: string): (() => void) | undefined => {
    for (let i = offers.length - 1; i >= 0; i--) {
      const handler = offers[i].handlers[id];
      if (handler) return handler;
    }
    return undefined;
  };
  return {
    offer(handlers) {
      const entry = { handlers };
      offers.push(entry);
      changed();
      return () => {
        const at = offers.indexOf(entry);
        if (at < 0) return;
        offers.splice(at, 1);
        changed();
      };
    },
    offers: id => latest(id) !== undefined,
    offered: () => [...new Set(offers.flatMap(entry => Object.keys(entry.handlers)))].sort(),
    run(id) {
      const handler = latest(id);
      handler?.();
      return handler !== undefined;
    },
    watch(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
