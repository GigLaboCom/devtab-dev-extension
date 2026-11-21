/**
 * One run of the tool: the input and the choices in, the logic's answer out. The same function runs on the page (inputs
 * up to LIVE_INPUT) and in the tool's worker (larger ones), so both give the same answer.
 */
import { escapeString, unescapeString } from '@workspace/tool-logic-backslash-escape';
import type { Mode } from './history';
import type { Dialect, Quote, UnescapeResult } from '@workspace/tool-logic-backslash-escape';

export interface Job {
  input: string;
  mode: Mode;
  dialect: Dialect;
  quote: Quote;
  nonAscii: boolean;
  withQuotes: boolean;
}

export type Computed = { mode: 'escape'; text: string } | { mode: 'unescape'; result: UnescapeResult };

export const runJob = (job: Job): Computed =>
  job.mode === 'escape'
    ? { mode: 'escape', text: escapeString(job.input, job) }
    : { mode: 'unescape', result: unescapeString(job.input, job) };
