/**
 * The composition root of the Hash tool's replaceable behaviors (AGENTS.md, "Replaceable Behavior"): which `Digester`
 * digests streams — the MD5 of a text and every digest of a file. hash-wasm, by measurement (docs/research/hash-in-wasm.md:
 * 4–7× @noble/hashes on files and on the MD5 of a long text, a few ms more on first use); `nobleDigester` is the other
 * implementation, kept and passing the same contract suite, so the choice is this one line.
 */
import { wasmDigester } from './wasmDigester';
import type { Digester } from './digester';

export const defaultDigester: Digester = wasmDigester;
