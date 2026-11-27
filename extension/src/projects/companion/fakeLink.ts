/**
 * For the tests: a port to the scripted companion of scripts/e2e-projects/companion.mjs (the e2e's fake host speaks
 * the same one over Chrome's frames), with what Chrome would do around it — the messages arrive later, never in the
 * same turn; the relay exits after its last word; the port can be lost or never found. Not part of the app.
 */
import { createCompanion } from '../../../../scripts/e2e-projects/companion.mjs';
import type { ScriptedCompanion } from '../../../../scripts/e2e-projects/companion.mjs';
import type { Link, LinkClosed, LinkEvents, OpenLink } from './link';

/** The contract's vectors, as the scripted companion takes them. */
export const VECTORS: Record<string, unknown> = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../api/companion-api-v1/vectors/*.json', { eager: true, import: 'default' }),
  ).map(([path, value]) => [path.slice(path.lastIndexOf('/') + 1), value]),
);

export interface FakePort {
  /** Every frame the page sent, in order. */
  sent: unknown[];
  /** Whether the page closed the port. */
  closedByPage: boolean;
  open: boolean;
  /** Something from the host's side as it is, malformed or not. */
  inject(message: unknown): void;
  /** The port is lost (the relay exited, Chrome says why). */
  lose(reason?: LinkClosed): void;
}

export interface FakeCompanion {
  companion: ScriptedCompanion;
  openLink: OpenLink;
  /** The ports opened, oldest first. */
  ports: FakePort[];
  /** How each next port behaves: answer, or not be found (`not-installed`). */
  next: 'answer' | 'not-found';
  /** An event from the companion through the latest open port. */
  emit(name: string, project: string | null, data: unknown): void;
}

const later = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

export const fakeCompanion = (options: Parameters<typeof createCompanion>[0] = {}): FakeCompanion => {
  const companion = createCompanion({ vectors: VECTORS, wait: () => Promise.resolve(), ...options });
  const ports: FakePort[] = [];
  const fake: FakeCompanion = {
    companion,
    ports,
    next: 'answer',
    emit(name, project, data) {
      const port = [...ports].reverse().find(p => p.open);
      if (port) companion.emit(name, project, data, frame => port.inject(frame));
    },
    openLink: (events: LinkEvents): Link => {
      const port: FakePort = {
        sent: [],
        closedByPage: false,
        open: true,
        inject(message) {
          const copy = JSON.parse(JSON.stringify(message)) as unknown;
          void later().then(() => port.open && events.onMessage(copy));
        },
        lose(reason = { kind: 'exited', message: 'Native host has exited.' }) {
          void later().then(() => {
            if (!port.open) return;
            port.open = false;
            events.onClose(reason);
          });
        },
      };
      ports.push(port);
      if (fake.next === 'not-found') {
        port.lose({ kind: 'not-found', message: 'Specified native messaging host not found.' });
        return { send: () => undefined, close: () => void (port.open = false) };
      }
      return {
        send(frame) {
          if (!port.open) return;
          port.sent.push(frame);
          void companion
            .handle(JSON.parse(JSON.stringify(frame)), out => port.inject(out))
            .then(() => {
              // The relay's last word about the connection is followed by its exit.
              const said = port.sent.length === 1 && (frame as { type?: string }).type === 'hello';
              if (said && (options.mode === 'not-running' || options.mode === 'version')) port.lose();
            });
        },
        close() {
          port.closedByPage = true;
          port.open = false;
        },
      };
    },
  };
  return fake;
};
