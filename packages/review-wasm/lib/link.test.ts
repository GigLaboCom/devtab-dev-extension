/**
 * What a grammar file asks of the module, read from its `dylink.0` section (./link.ts) — on bytes written here, no
 * grammar and no instantiation.
 */
import { dylinkInfo } from './link';
import { describe, expect, it } from 'vitest';

const leb = (value: number): number[] => {
  const out: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return out;
};

/** A wasm header and a first custom section `name` holding `payload`. */
const moduleWith = (name: string, payload: number[]): Uint8Array => {
  const nameBytes = [...new TextEncoder().encode(name)];
  const body = [...leb(nameBytes.length), ...nameBytes, ...payload];
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x00, ...leb(body.length), ...body]);
};

/** `dylink.0` with a needed-libraries sub-section (kind 2) before the memory info (kind 1), as wasm-ld may write it. */
const sideModule = (memorySize: number, memoryAlign: number, tableSize: number, tableAlign: number): Uint8Array => {
  const needed = [...leb(0)];
  const memInfo = [...leb(memorySize), ...leb(memoryAlign), ...leb(tableSize), ...leb(tableAlign)];
  return moduleWith('dylink.0', [2, ...leb(needed.length), ...needed, 1, ...leb(memInfo.length), ...memInfo]);
};

describe('dylinkInfo', () => {
  it('reads the memory and table a side module needs (sizes past one LEB byte too)', () => {
    expect(dylinkInfo(sideModule(1_086_648, 4, 37, 0))).toEqual({
      memorySize: 1_086_648,
      memoryAlign: 4,
      tableSize: 37,
      tableAlign: 0,
    });
    expect(dylinkInfo(sideModule(0, 0, 0, 0))).toEqual({ memorySize: 0, memoryAlign: 0, tableSize: 0, tableAlign: 0 });
  });

  it('refuses what is not a side module', () => {
    expect(() => dylinkInfo(new TextEncoder().encode('<!doctype html>'))).toThrow('not a wasm module');
    expect(() => dylinkInfo(moduleWith('name', [0]))).toThrow('the first section is "name"');
    const noCustom = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x01, 0x00]);
    expect(() => dylinkInfo(noCustom)).toThrow('no leading custom section');
    expect(() => dylinkInfo(moduleWith('dylink.0', [2, 1, 0]))).toThrow('no memory information');
    expect(() => dylinkInfo(sideModule(300, 0, 0, 0).subarray(0, 14))).toThrow();
  });
});
