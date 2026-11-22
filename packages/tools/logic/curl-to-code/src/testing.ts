/**
 * For the package's tests only (not exported): every client's writer loaded at once, and the tool's result for a
 * command and a target as the page gets it.
 */
import { loadGenerator } from './load';
import { curlToCode } from './logic';
import { TARGETS } from './targets';
import type { CodeResult, CurlRequest, Generated, Generator, Target } from './types';

export const ALL_TARGETS: readonly Target[] = TARGETS.map(t => t.value);

export const loadAll = async (): Promise<Readonly<Record<Target, Generator>>> =>
  Object.fromEntries(await Promise.all(ALL_TARGETS.map(async t => [t, await loadGenerator(t)]))) as Record<
    Target,
    Generator
  >;

let loaded: Readonly<Record<Target, Generator>> | null = null;
/** Call once (beforeAll) before `convert` or `generate`. */
export const ready = async (): Promise<void> => {
  loaded ??= await loadAll();
};

const writer = (target: Target): Generator => {
  if (!loaded) throw new Error('call ready() first');
  return loaded[target];
};

export const convert = (text: string, target: Target): CodeResult => curlToCode(text, writer(target));
export const generate = (request: CurlRequest, target: Target): Generated => writer(target).generate(request);

/** A request with every field at its default, changed by `over`. */
export const request = (over: Partial<CurlRequest> = {}): CurlRequest => ({
  method: 'GET',
  url: 'https://a.example/x',
  headers: [],
  body: null,
  user: null,
  insecure: false,
  timeoutSeconds: null,
  compressed: false,
  followRedirects: false,
  ...over,
});
