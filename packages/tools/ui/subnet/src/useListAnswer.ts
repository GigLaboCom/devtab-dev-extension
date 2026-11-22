/**
 * The answer for a list (Match, Summarize; docs/tools/specs/subnet.md §12): computed on the page at each edit while the
 * lists are small, otherwise 300 ms after the last edit in the worker — the previous answer stays shown until the new
 * one comes, and an edit cancels the job in flight.
 */
import { ListRunner } from './runner';
import { startSubnetWorker } from './startWorker';
import { isLive, runMatch, runSummarize, SETTLE_MS } from '@workspace/tool-logic-subnet';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ListAnswer, ListJob } from './runner';

const texts = (job: ListJob): string[] => (job.task === 'match' ? [job.addresses, job.blocks] : [job.list]);

const compute = (job: ListJob): ListAnswer =>
  job.task === 'match'
    ? { task: 'match', result: runMatch(job.addresses, job.blocks) }
    : { task: 'summarize', result: runSummarize(job.list) };

export interface ListState {
  answer: ListAnswer | null;
  /** The answer shown is for an older text: the worker is on the new one. */
  working: boolean;
  /** The worker could not run (no workers here, an exception): what it said. */
  crash: string | null;
}

/** One runner per page; its worker starts on the first large list and goes with the page. */
export const useRunner = (): ListRunner => {
  const runner = useRef<ListRunner | null>(null);
  runner.current ??= new ListRunner(startSubnetWorker);
  useEffect(() => {
    const current = runner.current;
    return () => current?.dispose();
  }, []);
  return runner.current;
};

export const useListAnswer = (job: ListJob | null, runner: ListRunner): ListState => {
  const live = job === null || isLive(...texts(job));
  const liveAnswer = useMemo(() => (job && live ? compute(job) : null), [job, live]);
  const [far, setFar] = useState<{ job: ListJob; answer: ListAnswer } | null>(null);
  const [crash, setCrash] = useState<{ job: ListJob; message: string } | null>(null);

  useEffect(() => {
    if (!job || live) {
      runner.cancel();
      return;
    }
    let gone = false;
    const timer = setTimeout(() => {
      void runner.run(job).then(outcome => {
        if (gone) return;
        if (outcome.kind === 'done') setFar({ job, answer: outcome.answer });
        else if (outcome.kind === 'crashed') setCrash({ job, message: outcome.message });
      });
    }, SETTLE_MS);
    return () => {
      gone = true;
      clearTimeout(timer);
      runner.cancel();
    };
  }, [job, live, runner]);

  if (!job) return { answer: null, working: false, crash: null };
  if (live) return { answer: liveAnswer, working: false, crash: null };
  const sameTask = far && far.answer.task === job.task ? far.answer : null;
  return {
    answer: sameTask,
    working: far?.job !== job && crash?.job !== job,
    crash: crash?.job === job ? crash.message : null,
  };
};
