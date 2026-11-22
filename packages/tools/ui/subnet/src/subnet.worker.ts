/**
 * The Subnet Calculator's worker (docs/tools/specs/subnet.md §12): Match and Summarize of lists above the page's limit,
 * off the page's thread. Wiring only — the work is the logic's `runMatch` and `runSummarize`, the same the page runs on
 * small lists. Loaded from this file of the package (startWorker.ts), never from `blob:` or `data:`.
 */
import { runMatch, runSummarize } from '@workspace/tool-logic-subnet';
import type { JobMessage, JobReply, ListAnswer } from './runner';

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: { data: JobMessage }) => void) | null;
  postMessage: (reply: JobReply) => void;
};

const work = ({ job }: JobMessage): ListAnswer =>
  job.task === 'match'
    ? { task: 'match', result: runMatch(job.addresses, job.blocks) }
    : { task: 'summarize', result: runSummarize(job.list) };

scope.onmessage = ({ data }) => {
  let reply: JobReply;
  try {
    reply = { id: data.id, ok: true, answer: work(data) };
  } catch (error) {
    reply = {
      id: data.id,
      ok: false,
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
  scope.postMessage(reply);
};
