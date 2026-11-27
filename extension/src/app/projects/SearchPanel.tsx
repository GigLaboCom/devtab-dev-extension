/**
 * Find in files (§8.4 «Поиск»): the companion's search, streamed file by file, cancellable; ignored folders are left
 * out unless the person includes them (Р20). A match opens its file at its line.
 */
import { TEXT, printable } from './text';
import { isCompanionError } from '@src/projects/types';
import { Button } from '@workspace/ui/button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Switch } from '@workspace/ui/switch';
import { Toggle } from '@workspace/ui/toggle';
import { useRef, useState } from 'react';
import type { Workspace } from './useWorkspace';
import type { SearchDone, SearchHit } from '@src/projects/types';
import type { FormEvent, ReactElement } from 'react';

type Run =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; done: SearchDone }
  | { state: 'cancelled' }
  | {
      state: 'failed';
      message: string;
    };

/** The line with its matches marked. */
const Line = ({ text: raw, ranges }: { text: string; ranges: [number, number][] }): ReactElement => {
  // One unit for one: the ranges (UTF-16 columns) still fit the printable text.
  const text = printable(raw);
  const parts: ReactElement[] = [];
  let at = 0;
  ranges.forEach(([from, to], i) => {
    if (from > at) parts.push(<span key={`t${i}`}>{text.slice(at, from)}</span>);
    parts.push(
      <mark key={`m${i}`} className="kit-projects-match">
        {text.slice(from, to)}
      </mark>,
    );
    at = to;
  });
  parts.push(<span key="end">{text.slice(at)}</span>);
  return <>{parts}</>;
};

export const SearchPanel = ({ workspace }: { workspace: Workspace }): ReactElement => {
  const { backend, project } = workspace;
  const [pattern, setPattern] = useState('');
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [word, setWord] = useState(false);
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [run, setRun] = useState<Run>({ state: 'idle' });
  const abort = useRef<AbortController | null>(null);

  const search = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (!pattern) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setHits([]);
    setRun({ state: 'running' });
    try {
      const done = await backend.call(
        'search.start',
        { project: project.id, pattern, isRegex: regex, caseSensitive: matchCase, wholeWord: word, includeIgnored },
        { signal: controller.signal, onStream: hit => setHits(h => [...h, hit]) },
      );
      if (abort.current === controller) setRun({ state: 'done', done });
    } catch (error) {
      if (abort.current !== controller) return;
      setRun(
        isCompanionError(error, 'cancelled')
          ? { state: 'cancelled' }
          : { state: 'failed', message: error instanceof Error ? error.message : String(error) },
      );
    }
  };

  return (
    <section className="kit-projects-search" aria-label={TEXT.searchLabel}>
      <form className="kit-projects-search-form" onSubmit={e => void search(e)}>
        <Input
          aria-label={TEXT.searchLabel}
          placeholder={TEXT.searchPlaceholder}
          value={pattern}
          onChange={e => setPattern(e.target.value)}
        />
        <Toggle size="sm" variant="outline" pressed={regex} onPressedChange={setRegex} aria-label={TEXT.searchRegex}>
          .*
        </Toggle>
        <Toggle
          size="sm"
          variant="outline"
          pressed={matchCase}
          onPressedChange={setMatchCase}
          aria-label={TEXT.searchCase}>
          Aa
        </Toggle>
        <Toggle size="sm" variant="outline" pressed={word} onPressedChange={setWord} aria-label={TEXT.searchWord}>
          W
        </Toggle>
        <span className="kit-projects-check">
          <Switch id="projects-search-ignored" checked={includeIgnored} onCheckedChange={setIncludeIgnored} />
          <Label htmlFor="projects-search-ignored">{TEXT.searchIgnored}</Label>
        </span>
        {/* Two buttons, not one that changes its type: a click on Cancel must not submit the form it turned into. */}
        {run.state === 'running' ? (
          <Button key="cancel" type="button" variant="outline" size="sm" onClick={() => abort.current?.abort()}>
            {TEXT.searchCancel}
          </Button>
        ) : (
          <Button key="find" type="submit" size="sm" disabled={!pattern}>
            {TEXT.searchRun}
          </Button>
        )}
      </form>
      <p className="kit-projects-part-hint" role="status">
        {run.state === 'running' && TEXT.searching}
        {run.state === 'cancelled' && TEXT.searchCancelled}
        {run.state === 'failed' && TEXT.failed(run.message)}
        {run.state === 'done' && (
          <>
            {TEXT.searchSummary(run.done.matches, run.done.files)}
            {run.done.truncated && ` ${TEXT.searchTruncated}`}
          </>
        )}
      </p>
      <ul className="kit-projects-results">
        {hits.map(hit => (
          <li key={hit.path}>
            <span className="kit-projects-result-file">{printable(hit.path)}</span>
            <ul>
              {hit.matches.map(match => (
                <li key={match.line}>
                  <button
                    type="button"
                    className="kit-projects-result-line"
                    onClick={() =>
                      workspace.open(hit.path, { kind: 'file' }, { line: match.line, column: match.ranges[0]?.[0] })
                    }>
                    <span className="kit-projects-result-number">{match.line + 1}</span>
                    <span className="kit-projects-result-text">
                      <Line text={match.text} ranges={match.ranges} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
};
