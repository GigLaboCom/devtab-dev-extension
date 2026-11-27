/**
 * Long answers in pieces (the companion's specification §4.3; docs/api.md of the companion, «Chunking»): Chrome takes
 * at most 1 MiB in one frame from a native host, so the supervisor turns a longer message into one JSON string, cuts
 * it at character boundaries and sends `chunk` frames `{id, seq, last, data}`. The page joins `data` in `seq` order
 * until `last` and parses the joined string as a frame.
 *
 * A piece out of order, or a message above the limit, breaks the whole message: it is dropped and said as a
 * `ChunkError`, never half-parsed.
 */

/** The longest joined message taken, in UTF-16 code units (the companion's text limit is 5 MiB; JSON escapes add). */
export const MAX_JOINED_UNITS = 32 * 1024 * 1024;

export interface ChunkPiece {
  id?: number | null;
  seq: number;
  last: boolean;
  data: string;
}

export class ChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChunkError';
  }
}

export class Chunks {
  private readonly open = new Map<string, { next: number; parts: string[]; units: number }>();

  constructor(private readonly maxUnits = MAX_JOINED_UNITS) {}

  /** Takes one piece: the joined message once its last piece is in, null before. */
  add(piece: ChunkPiece): string | null {
    const key = String(piece.id ?? 'none');
    const message = this.open.get(key) ?? { next: 0, parts: [], units: 0 };
    if (piece.seq !== message.next) {
      this.open.delete(key);
      throw new ChunkError(`piece ${piece.seq} of message ${key} came where ${message.next} was due`);
    }
    message.units += piece.data.length;
    if (message.units > this.maxUnits) {
      this.open.delete(key);
      throw new ChunkError(`message ${key} is longer than ${this.maxUnits} units`);
    }
    message.parts.push(piece.data);
    message.next++;
    if (!piece.last) {
      this.open.set(key, message);
      return null;
    }
    this.open.delete(key);
    return message.parts.join('');
  }

  /** Forgets a message whose call ended another way (cancelled). */
  drop(id: number): void {
    this.open.delete(String(id));
  }

  clear(): void {
    this.open.clear();
  }

  /** How many messages wait for more pieces. */
  get waiting(): number {
    return this.open.size;
  }
}
