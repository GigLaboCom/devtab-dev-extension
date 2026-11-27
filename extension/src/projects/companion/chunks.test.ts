/** Joining long answers: the companion's own chunking vector, byte for byte, and what breaks a message. */
import { ChunkError, Chunks } from './chunks';
import { chunked } from '../../../../scripts/e2e-projects/companion.mjs';
import vector from '../api/companion-api-v1/vectors/chunking.json';
import { describe, expect, it } from 'vitest';
import type { ChunkPiece } from './chunks';

const frames = vector.frames as ChunkPiece[];

describe('chunks', () => {
  it('joins the companion’s vector into its message, and the message parses as a frame', () => {
    const chunks = new Chunks();
    const out = frames.map(f => chunks.add(f));
    expect(out.slice(0, -1)).toEqual(frames.slice(0, -1).map(() => null));
    expect(out.at(-1)).toBe(vector.message);
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ type: 'result', id: 7 });
    expect(chunks.waiting).toBe(0);
  });

  it('every frame of the vector is within its limit, measured as UTF-8 after escaping', () => {
    for (const frame of frames)
      expect(new TextEncoder().encode(JSON.stringify(frame)).length).toBeLessThanOrEqual(vector.maxFrameBytes);
  });

  it('keeps two messages apart by id', () => {
    const chunks = new Chunks();
    expect(chunks.add({ id: 1, seq: 0, last: false, data: '{"a":' })).toBeNull();
    expect(chunks.add({ id: 2, seq: 0, last: false, data: '{"b":' })).toBeNull();
    expect(chunks.add({ id: 2, seq: 1, last: true, data: '2}' })).toBe('{"b":2}');
    expect(chunks.add({ id: 1, seq: 1, last: true, data: '1}' })).toBe('{"a":1}');
  });

  it('a piece out of order breaks its message, which is dropped', () => {
    const chunks = new Chunks();
    chunks.add({ id: 3, seq: 0, last: false, data: 'x' });
    expect(() => chunks.add({ id: 3, seq: 2, last: true, data: 'y' })).toThrow(ChunkError);
    expect(chunks.waiting).toBe(0);
    expect(() => chunks.add({ id: 4, seq: 1, last: true, data: 'z' })).toThrow(ChunkError);
  });

  it('a message longer than the limit is dropped', () => {
    const chunks = new Chunks(10);
    chunks.add({ id: 5, seq: 0, last: false, data: '123456' });
    expect(() => chunks.add({ id: 5, seq: 1, last: false, data: '7890ab' })).toThrow(/longer/);
  });

  it('the scripted companion’s chunking joins back to the same message', () => {
    const text = 'é 中文 😀 "q" \\ \n'.repeat(500);
    const frame = { type: 'result', id: 9, result: { text } };
    const pieces = chunked(frame, 300) as unknown as ChunkPiece[];
    expect(pieces.length).toBeGreaterThan(10);
    const chunks = new Chunks();
    let joined: string | null = null;
    for (const piece of pieces) joined = chunks.add(piece);
    expect(JSON.parse(joined!)).toEqual(frame);
  });
});
