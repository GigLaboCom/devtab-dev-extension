/**
 * The history factory — the one way anything records (D17). A host builds one factory over its store, gate and cipher;
 * a tool (or a section) asks it for the history of its own owner id and records through a recorder. The tool never sees
 * the store, the cipher or the host.
 *
 * What a session is. One stretch of work in one owner: it starts with the first record a recorder writes and ends when
 * the recorder ends (the tool's page goes away) or after SESSION_IDLE_MS without a record. Every entry carries its
 * session id — the History list groups by it, like an IDE's local history groups changes into one action.
 *
 * When a snapshot is taken (the checkpoint rule), not one record per keystroke:
 *   - commit(draft) — a result of an explicit action (Format, Generate, Decode…): recorded at once; a pending change is
 *     dropped, because the result carries the input that produced it;
 *   - change(draft) — the inputs or options changed: kept pending and recorded when they have been still for IDLE_MS
 *     and at least MIN_GAP_MS passed since the session's last change snapshot, or when the page is left (flush);
 *   - a draft equal to the session's last recorded entry of its kind is not recorded again (like a shell's ignoredups).
 * Gates, in order: the owner declares the kind (else nothing); the host's gate says recording is on for this owner;
 * a secret kind needs an unlocked master password (else it is dropped and the tool is told why).
 */
import { idGenerator, toBase64 } from './bytes';
import { sha256Hex } from './checksums';
import { ENVELOPE_VERSION, parseRecord, recordLine } from './envelope';
import type { HistoryCipher, RecordIdentity, SealedContent } from './cipher';
import type { BlobData, BlobRef, HistoryRecord, JsonValue, RecordRow } from './envelope';
import type { HistoryFilter } from './filter';
import type { HistoryPage, HistoryStore, PageCursor } from './store';

export const IDLE_MS = 3_000;
export const MIN_GAP_MS = 30_000;
export const SESSION_IDLE_MS = 30 * 60_000;
/** Longest label and searchable text an entry keeps (characters). */
export const LABEL_MAX = 200;
export const TEXT_MAX = 4_000;

/** One kind of entry an owner records. */
export interface HistoryKind {
  id: string;
  /** What the History list calls it ("Result", "Edit"). */
  title: string;
  /**
   * Holds a secret (a password, a key, a token): recorded only encrypted — with a master password set and the history
   * unlocked — and dropped otherwise.
   */
  secret?: boolean;
}

/**
 * What an owner may record — written in the owner's definition (a tool's next to its id and title). An owner with no
 * kinds records nothing. `records` and `never` are said to the user (settings, docs/tools/history.md).
 */
export interface HistoryDeclaration {
  kinds: readonly HistoryKind[];
  /** The owner's payload schema version now. */
  schema: number;
  /** One line: what is kept. */
  records: string;
  /** One line: what is never kept. */
  never: string;
  /** Largest blob one entry may keep, bytes (the host's limit applies too). */
  maxBlobBytes?: number;
}

export const NOTHING: HistoryDeclaration = { kinds: [], schema: 0, records: 'Nothing.', never: 'Anything.' };

/** What one record asks to keep. Blobs: binary or large parts, by the owner's names ("input", "image"). */
export interface HistoryDraft {
  kind: string;
  payload: JsonValue;
  label?: string;
  text?: string;
  blobs?: Readonly<Record<string, Blob>>;
}

export type RecordOutcome =
  | { recorded: true; id: string }
  | {
      recorded: false;
      reason: 'off' | 'undeclared' | 'duplicate' | 'secret-locked' | 'secret-no-password' | 'too-large' | 'failed';
    };

/** Whether this owner records now: the host's switches (master switch, per-owner switch, incognito). */
export type GateState = 'on' | 'off' | 'incognito' | 'unavailable';

export interface HistoryGate {
  state(owner: string): GateState;
  subscribe(listener: () => void): () => void;
}

export const openGate: HistoryGate = { state: () => 'on', subscribe: () => () => {} };

/** What a tool can show about its history. `secrets`: whether its secret kinds would be kept now. */
export interface RecordingStatus {
  gate: GateState;
  secrets: 'no-password' | 'locked' | 'unlocked';
  /** The owner declares at least one kind. */
  declared: boolean;
}

export interface HistoryRecorder {
  /** The session's id once its first entry is written. */
  readonly session: string | undefined;
  change(draft: HistoryDraft): void;
  commit(draft: HistoryDraft): Promise<RecordOutcome>;
  flush(): Promise<void>;
  end(): Promise<void>;
}

export interface EntrySummary {
  id: string;
  owner: string;
  kind: string;
  session: string;
  time: number;
  schema: number;
  encrypted: boolean;
  /** Clear records only (an encrypted one shows it after opening). */
  label?: string;
  bytes: number;
}

export type OpenedEntry =
  | {
      ok: true;
      entry: EntrySummary;
      label?: string;
      text?: string;
      payload: JsonValue;
      blobs: Record<string, Blob>;
    }
  | { ok: false; reason: 'missing' | 'locked' | 'newer-schema' | 'damaged' };

/** The history of one owner, as a tool sees it. */
export interface ToolHistory {
  readonly owner: string;
  status(): RecordingStatus;
  subscribe(listener: () => void): () => void;
  /** A recorder for one stretch of work. */
  session(): HistoryRecorder;
  list(options?: { limit?: number; before?: PageCursor; kinds?: readonly string[] }): Promise<{
    entries: EntrySummary[];
    next?: PageCursor;
  }>;
  open(id: string): Promise<OpenedEntry>;
}

export interface HistoryFactory {
  /** The history of `owner` under its declaration. Never throws; records nothing when it may not. */
  forOwner(owner: string, declaration: HistoryDeclaration): ToolHistory;
}

export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface FactoryDeps {
  store: HistoryStore;
  cipher: HistoryCipher;
  gate?: HistoryGate;
  timers?: Timers;
  /** Largest blob the host keeps, bytes. */
  maxBlobBytes?: number;
  /** After a write: the host prunes (retention.ts), at most as often as it likes. */
  onWritten?: () => void;
  onError?: (what: string, error: unknown) => void;
}

export const DEFAULT_MAX_BLOB_BYTES = 32 * 1024 * 1024;

const clip = (text: string | undefined, max: number): string | undefined =>
  text === undefined ? undefined : text.length > max ? text.slice(0, max) : text;

export const summaryOf = (row: RecordRow): EntrySummary => {
  let label: string | undefined;
  if (!row.kid) {
    try {
      label = (JSON.parse(row.line) as HistoryRecord).label;
    } catch {
      // the row was read from this line; a parse error cannot happen
    }
  }
  return {
    id: row.id,
    owner: row.owner,
    kind: row.kind,
    session: row.session,
    time: row.time,
    schema: row.schema,
    encrypted: !!row.kid,
    ...(label !== undefined ? { label } : {}),
    bytes: row.lineBytes + row.blobBytes,
  };
};

const identityOf = (r: HistoryRecord): RecordIdentity => ({
  v: r.v,
  id: r.id,
  owner: r.owner,
  kind: r.kind,
  session: r.session,
  time: r.time,
  schema: r.schema,
  blobs: (r.blobs ?? []).map(b => ({ hash: b.hash, size: b.size })),
});

/** Opens one stored record: clear or sealed, with its blobs. Used by the factory and by the host's History page. */
export const openRecord = async (
  store: HistoryStore,
  cipher: HistoryCipher,
  id: string,
  knownSchema?: number,
): Promise<OpenedEntry> => {
  const row = await store.get(id);
  if (!row) return { ok: false, reason: 'missing' };
  if (knownSchema !== undefined && row.schema > knownSchema) return { ok: false, reason: 'newer-schema' };
  const record = parseRecord(row.line);
  let content: SealedContent = record;
  if (record.sealed) {
    if (cipher.state() !== 'unlocked') return { ok: false, reason: 'locked' };
    try {
      content = await cipher.openRecord(identityOf(record), record.sealed);
    } catch (error) {
      return { ok: false, reason: error instanceof Error && error.message.includes('locked') ? 'locked' : 'damaged' };
    }
  }
  const blobs: Record<string, Blob> = {};
  for (const [i, ref] of (content.blobs ?? []).entries()) {
    const stored = await store.blob(ref.hash);
    if (!stored) return { ok: false, reason: 'damaged' };
    if (stored.kid) {
      try {
        const bytes = await cipher.openBlob(ref.hash, stored.kid, new Uint8Array(await stored.data.arrayBuffer()));
        blobs[ref.name ?? `blob-${i}`] = new Blob([bytes], { type: ref.type ?? '' });
      } catch {
        return { ok: false, reason: cipher.state() === 'unlocked' ? 'damaged' : 'locked' };
      }
    } else blobs[ref.name ?? `blob-${i}`] = stored.data;
  }
  return {
    ok: true,
    entry: summaryOf(row),
    ...(content.label !== undefined ? { label: content.label } : {}),
    ...(content.text !== undefined ? { text: content.text } : {}),
    payload: content.payload ?? null,
    blobs,
  };
};

export const createHistoryFactory = (deps: FactoryDeps): HistoryFactory => {
  const gate = deps.gate ?? openGate;
  const timers = deps.timers ?? realTimers;
  const nextId = idGenerator();
  const hostMax = deps.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES;
  const report = (what: string, error: unknown) => deps.onError?.(what, error);

  const secretsState = (): RecordingStatus['secrets'] =>
    (({ none: 'no-password', locked: 'locked', unlocked: 'unlocked' }) as const)[deps.cipher.state()];

  return {
    forOwner(owner, declaration) {
      const kinds = new Map(declaration.kinds.map(k => [k.id, k]));
      const maxBlob = Math.min(hostMax, declaration.maxBlobBytes ?? hostMax);
      const status = (): RecordingStatus => ({
        gate: gate.state(owner),
        secrets: secretsState(),
        declared: kinds.size > 0,
      });

      /** Writes one draft as a record of `session`. */
      const write = async (session: string, draft: HistoryDraft, time: number): Promise<RecordOutcome> => {
        const kind = kinds.get(draft.kind);
        if (!kind) return { recorded: false, reason: 'undeclared' };
        if (gate.state(owner) !== 'on') return { recorded: false, reason: 'off' };
        const sealing = deps.cipher.state() === 'unlocked' && kind.secret === true;
        if (kind.secret && !sealing)
          return {
            recorded: false,
            reason: deps.cipher.state() === 'none' ? 'secret-no-password' : 'secret-locked',
          };
        const named = Object.entries(draft.blobs ?? {});
        if (named.some(([, b]) => b.size > maxBlob)) return { recorded: false, reason: 'too-large' };
        const blobs: BlobData[] = [];
        const fullRefs: BlobRef[] = [];
        for (const [name, blob] of named) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const type = blob.type || 'application/octet-stream';
          if (sealing) {
            const hash = await deps.cipher.blobId(bytes);
            const stored = await deps.cipher.sealBlob(hash, bytes);
            blobs.push({
              hash,
              size: stored.byteLength,
              type: 'application/octet-stream',
              kid: deps.cipher.activeKid()!,
              data: new Blob([stored]),
            });
            fullRefs.push({ name, hash, size: stored.byteLength, type });
          } else {
            const hash = `sha256-${await sha256Hex(bytes)}`;
            blobs.push({ hash, size: bytes.byteLength, type, data: blob });
            fullRefs.push({ name, hash, size: bytes.byteLength, type });
          }
        }
        const base: HistoryRecord = {
          v: ENVELOPE_VERSION,
          id: nextId(time),
          owner,
          kind: draft.kind,
          session,
          time: new Date(time).toISOString(),
          schema: declaration.schema,
        };
        const label = clip(draft.label, LABEL_MAX);
        const text = clip(draft.text, TEXT_MAX);
        let record: HistoryRecord;
        if (sealing) {
          const clearRefs = fullRefs.map(b => ({ hash: b.hash, size: b.size }));
          const sealed = await deps.cipher.sealRecord(identityOf({ ...base, blobs: clearRefs }), {
            ...(label !== undefined ? { label } : {}),
            ...(text !== undefined ? { text } : {}),
            payload: draft.payload,
            blobs: fullRefs,
          });
          record = { ...base, blobs: clearRefs, sealed };
        } else {
          record = {
            ...base,
            ...(label !== undefined ? { label } : {}),
            ...(text !== undefined ? { text } : {}),
            payload: draft.payload,
            blobs: fullRefs,
          };
        }
        const have = await deps.store.hasBlobs(blobs.map(b => b.hash));
        await deps.store.add(
          [recordLine(record)],
          blobs.filter(b => !have.has(b.hash)),
        );
        deps.onWritten?.();
        return { recorded: true, id: record.id };
      };

      const fingerprint = async (draft: HistoryDraft): Promise<string> => {
        const parts = [draft.kind, JSON.stringify(draft.payload), draft.label ?? '', draft.text ?? ''];
        for (const [name, blob] of Object.entries(draft.blobs ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)))
          parts.push(name, blob.type, await sha256Hex(new Uint8Array(await blob.arrayBuffer())));
        return toBase64(new TextEncoder().encode(parts.join('\u0000')));
      };

      const session = (): HistoryRecorder => {
        let id: string | undefined;
        let lastWrite = 0;
        let lastChangeWrite = -Infinity;
        const lastByKind = new Map<string, string>();
        let pending: HistoryDraft | undefined;
        let timer: unknown;
        let chain: Promise<unknown> = Promise.resolve();
        const serial = <T>(task: () => Promise<T>): Promise<T> => {
          const run = chain.then(task, task);
          chain = run.catch(() => undefined);
          return run;
        };

        const record = (draft: HistoryDraft, isChange: boolean): Promise<RecordOutcome> =>
          serial(async () => {
            try {
              const now = timers.now();
              const print = await fingerprint(draft);
              if (lastByKind.get(draft.kind) === print) return { recorded: false, reason: 'duplicate' } as const;
              if (!id || now - lastWrite > SESSION_IDLE_MS) {
                id = undefined;
                lastByKind.clear();
              }
              const sessionId = id ?? nextId(now);
              const outcome = await write(sessionId, draft, now);
              if (outcome.recorded) {
                id = sessionId;
                lastWrite = now;
                if (isChange) lastChangeWrite = now;
                lastByKind.set(draft.kind, print);
              }
              return outcome;
            } catch (error) {
              report('record', error);
              return { recorded: false, reason: 'failed' } as const;
            }
          });

        const schedule = () => {
          if (timer !== undefined) timers.clearTimeout(timer);
          const wait = Math.max(IDLE_MS, lastChangeWrite + MIN_GAP_MS - timers.now());
          timer = timers.setTimeout(() => {
            timer = undefined;
            const draft = pending;
            pending = undefined;
            if (draft) void record(draft, true);
          }, wait);
        };

        const flush = async () => {
          if (timer !== undefined) timers.clearTimeout(timer);
          timer = undefined;
          const draft = pending;
          pending = undefined;
          if (draft) await record(draft, true);
          else await serial(async () => undefined);
        };

        return {
          get session() {
            return id;
          },
          change(draft) {
            if (!kinds.has(draft.kind) || gate.state(owner) !== 'on') return;
            pending = draft;
            schedule();
          },
          async commit(draft) {
            if (timer !== undefined) timers.clearTimeout(timer);
            timer = undefined;
            pending = undefined;
            return record(draft, false);
          },
          flush,
          async end() {
            await flush();
            id = undefined;
          },
        };
      };

      return {
        owner,
        status,
        subscribe(listener) {
          const a = gate.subscribe(listener);
          const b = deps.cipher.subscribe(listener);
          return () => {
            a();
            b();
          };
        },
        session,
        async list(options = {}) {
          const filter: HistoryFilter = { owners: [owner], ...(options.kinds ? { kinds: options.kinds } : {}) };
          const page: HistoryPage = await deps.store.page(filter, {
            limit: options.limit ?? 50,
            ...(options.before ? { before: options.before } : {}),
          });
          return { entries: page.rows.map(summaryOf), ...(page.next ? { next: page.next } : {}) };
        },
        async open(id) {
          const opened = await openRecord(deps.store, deps.cipher, id, declaration.schema);
          if (opened.ok && opened.entry.owner !== owner) return { ok: false, reason: 'missing' };
          return opened;
        },
      };
    },
  };
};
