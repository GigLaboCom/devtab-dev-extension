/**
 * The echo of the query under its field when it has an error (docs/tools/specs/json-query.md §6, §8): the query — a
 * window of ±30 characters around the error for a long one — with the error's range marked, or a bar where the place
 * has no width (the end of the query). Hidden from screen readers: the message above says the same in words, with the
 * position. Text nodes only, colours from tokens.
 */
import { errorExcerpt } from '@workspace/tool-logic-json-query';
import type { QueryError } from '@workspace/tool-logic-json-query';
import type { ReactElement } from 'react';

export const Echo = ({ query, error }: { query: string; error: QueryError }): ReactElement => {
  const e = errorExcerpt(query, error);
  return (
    <p
      aria-hidden="true"
      data-part="echo"
      className="m-0 overflow-x-auto font-mono text-code whitespace-pre text-muted-foreground">
      {e.cutStart && '…'}
      {e.before}
      {e.marked === '' ? (
        <span data-part="caret" className="inline-block h-[1lh] w-0.5 bg-destructive align-bottom" />
      ) : (
        <mark data-part="marked" className="rounded-sm bg-destructive/15 text-destructive underline decoration-wavy">
          {e.marked}
        </mark>
      )}
      {e.after}
      {e.cutEnd && '…'}
    </p>
  );
};
