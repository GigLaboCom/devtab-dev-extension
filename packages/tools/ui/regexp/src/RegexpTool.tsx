/**
 * The RegExp tool's page (docs/tools/specs/regexp.md §8): the pattern, the flags, the test text with its matches
 * highlighted, the table of matches, the groups of the selected one and the replacement. The host wraps it in the
 * kit's ToolPage; this is the body.
 *
 * The pattern is compiled on the page at every edit (V8 parses it, nothing runs: an error shows at once). Matching and
 * replacing run in the tool's worker (runner.ts) 150 ms after the last edit, with a limit of 1 s — 10 s once the person
 * allows it — after which the worker is terminated and the page says so: a pattern that backtracks for ever never
 * freezes the page. A new edit cancels the run in flight. Old results stay while a run is going; after 300 ms the
 * status line says `Running…`.
 *
 * History (D17, entries.ts): every edit is a snapshot (`recorder.change`; the factory writes it after a pause), and the
 * snapshot is refreshed with the number of matches when the run of that edit answers; copying the regex, the matches
 * or the result is committed — the moments something was taken. An entry opened from History comes back as the
 * pattern, the flags, the text and the replacement, and runs again.
 *
 * The flags and Replace are saved parameters (settings.ts; docs/tools/settings.md): the tool opens with what the person
 * chose last. An opened entry, and a literal pasted into Pattern (or Keep as pasted), show their own flags for the visit
 * only. The pattern, the text and the replacement are input, never saved.
 */
import { draft, readPayload } from './entries';
import { Highlight } from './Highlight';
import { regexpHistory } from './history';
import { MatchRows } from './MatchRows';
import { RegexpRunner } from './runner';
import { regexpSettings } from './settings';
import { startRegexpWorker } from './startWorker';
import {
  compileRegexp,
  DEBOUNCE_MS,
  FLAG_NAMES,
  flagWords,
  formatCount,
  LONG_TIMEOUT_MS,
  MAX_TABLE_ROWS,
  MAX_TEXT,
  matchCountText,
  normalizeFlags,
  segments as cut,
  showMatchText,
  splitLiteral,
  TIMEOUT_MS,
  toggleFlag,
  UI_FLAGS,
} from '@workspace/tool-logic-regexp';
import { useRestore, useSavedSettings, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/table';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RegexpPayload, RegexpState } from './entries';
import type { Flag, Match, RunRequest, RunResult } from '@workspace/tool-logic-regexp';
import type { ToolProps } from '@workspace/tools-host';
import type { ClipboardEvent, ReactElement } from 'react';

type Ok = Extract<RunResult, { ok: true }>;

/** After this long without an answer the status line says `Running…` (§5 п. 27). */
const SLOW_MS = 300;

export const TEXTS = {
  hint: 'JavaScript regular expressions, as this browser runs them.',
  pasted: 'Pasted as a literal: the pattern and the flags were split.',
  property: 'Without u or v, \\p{…} is not a Unicode property: it matches the letter p and the braces.',
  splitsPair: 'A match boundary splits a character made of two UTF-16 units. Turn on u or v to match whole characters.',
  textTooLong: 'The text is longer than 1,000,000 characters. RegExp works with up to 1,000,000.',
  resultTooLarge: 'The result would be longer than 5,000,000 characters.',
  replaceHint: '$1 or $<name>: a group; $&: the match; $$: a dollar sign. \\n is not a line break here: press Enter.',
  running: 'Running…',
  stopped: (ms: number) =>
    `Stopped after ${ms === TIMEOUT_MS ? '1 second' : `${ms / 1000} seconds`}: the pattern takes too long on this text. Nested quantifiers such as (a+)+ often cause this (catastrophic backtracking).`,
  crashed: (message: string) => `The regular expression could not be run: ${message.replace(/\.$/, '')}.`,
} as const;

/** What the page shows of the last run that answered. */
type Shown =
  | { kind: 'none' }
  | { kind: 'result'; result: Ok; text: string }
  | { kind: 'stopped'; ms: number }
  | { kind: 'failed'; message: string };

const NONE: Shown = { kind: 'none' };

const range = (start: number | null, end: number | null): string => (start === null ? '—' : `${start}–${end}`);

/** Scrolls `child` into view inside `box` only, if it is out of view. */
const reveal = (box: HTMLElement | null, child: HTMLElement | null | undefined): void => {
  if (!box || !child) return;
  const outer = box.getBoundingClientRect();
  const inner = child.getBoundingClientRect();
  if (inner.top < outer.top || inner.bottom > outer.bottom)
    box.scrollTop += inner.top - outer.top - (outer.height - inner.height) / 2;
};

const RegexpTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [pattern, setPattern] = useState('');
  const saved = useSavedSettings(host, 'regexp', regexpSettings);
  const { flags, replace } = saved.values;
  const [text, setText] = useState(initial ?? '');
  const [replacement, setReplacement] = useState('');
  const [pasted, setPasted] = useState<{ text: string; flags: string } | null>(null);
  const [allowLong, setAllowLong] = useState(false);
  const [shown, setShown] = useState<Shown>(NONE);
  const [slow, setSlow] = useState(false);
  const [selected, setSelected] = useState(0);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'regexp', regexpHistory);

  const state: RegexpState = { pattern, flags, text, replace, replacement };
  const latest = useRef(state);
  latest.current = state;
  /** The person changed something since the last restore: their runs refresh the snapshot. */
  const edited = useRef(false);

  const compiled = useMemo(() => (pattern === '' ? null : compileRegexp(pattern, flags)), [pattern, flags]);
  const textTooLong = text.length > MAX_TEXT;
  const request = useMemo<RunRequest | null>(
    () => (compiled?.ok && !textTooLong ? { pattern, flags, text, replacement: replace ? replacement : null } : null),
    [compiled, textTooLong, pattern, flags, text, replace, replacement],
  );
  const limit = allowLong ? LONG_TIMEOUT_MS : TIMEOUT_MS;

  const runner = useRef<RegexpRunner | null>(null);
  useEffect(() => () => runner.current?.dispose(), []);

  useEffect(() => {
    // A new edit cancels the run in flight at once (its worker is terminated).
    runner.current?.cancel();
    setSlow(false);
    if (!request) {
      setShown(NONE);
      return;
    }
    // A stop or a failure was about the input before this edit: it goes; results stay until the new ones come.
    setShown(s => (s.kind === 'stopped' || s.kind === 'failed' ? NONE : s));
    let live = true;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const send = setTimeout(() => {
      runner.current ??= new RegexpRunner(startRegexpWorker);
      slowTimer = setTimeout(() => live && setSlow(true), SLOW_MS);
      void runner.current.run(request, limit).then(outcome => {
        if (!live || outcome.kind === 'cancelled') return;
        clearTimeout(slowTimer);
        setSlow(false);
        let summary: RegexpPayload['outcome'];
        if (outcome.kind === 'timeout') {
          setShown({ kind: 'stopped', ms: limit });
          summary = { stopped: true };
        } else if (outcome.kind === 'crashed') setShown({ kind: 'failed', message: outcome.message });
        else if (!outcome.result.ok) setShown({ kind: 'failed', message: outcome.result.message });
        else {
          const result = outcome.result;
          setShown({ kind: 'result', result, text: request.text });
          setSelected(s => (s < result.matches.length ? s : 0));
          summary = { matches: result.matches.length, truncated: result.truncated };
        }
        if (edited.current && summary) recorder.change(draft(latest.current, summary));
      });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(send);
      clearTimeout(slowTimer);
    };
  }, [request, limit, recorder]);

  /** An edit; flags and Replace from the person are saved (`set`), those a pasted literal brought are not (`visit`). */
  const edit = (next: Partial<RegexpState>, how: 'set' | 'visit' = 'set'): void => {
    const s = { ...latest.current, ...next };
    latest.current = s;
    if (next.pattern !== undefined) setPattern(next.pattern);
    const options = {
      ...(next.flags !== undefined && { flags: next.flags }),
      ...(next.replace !== undefined && { replace: next.replace }),
    };
    if (Object.keys(options).length > 0) saved[how](options);
    if (next.text !== undefined) setText(next.text);
    if (next.replacement !== undefined) setReplacement(next.replacement);
    setAllowLong(false);
    setRestored(null);
    edited.current = true;
    if (s.pattern !== '' && s.text.length <= MAX_TEXT) {
      const c = s.pattern === pattern && s.flags === flags ? compiled : compileRegexp(s.pattern, s.flags);
      recorder.change(draft(s, c && !c.ok ? { error: c.message } : undefined));
    }
  };

  const editPattern = (value: string): void => {
    setPasted(null);
    edit({ pattern: value });
  };

  const pastePattern = (event: ClipboardEvent<HTMLInputElement>): void => {
    const field = event.currentTarget;
    const whole = field.value === '' || (field.selectionStart === 0 && field.selectionEnd === field.value.length);
    if (!whole) return;
    const clip = event.clipboardData.getData('text/plain');
    const split = splitLiteral(clip);
    if (!split) return;
    event.preventDefault();
    edit({ pattern: split.pattern, flags: split.flags }, 'visit');
    setPasted({ text: clip, flags });
  };

  const keepAsPasted = (): void => {
    if (!pasted) return;
    // As the single-line field itself would have kept it: line breaks removed (§3).
    const value = pasted.text.replaceAll('\r', '').replaceAll('\n', '');
    setPasted(null);
    edit({ pattern: value, flags: pasted.flags }, 'visit');
  };

  const changeFlags = (values: string[]): void => {
    const toggled = UI_FLAGS.find(f => flags.includes(f) !== values.includes(f));
    if (toggled) edit({ flags: toggleFlag(flags, toggled) });
  };

  useRestore(history, restore, opened => {
    if (!opened.ok) {
      setRestored(
        opened.reason === 'locked'
          ? 'This entry is encrypted: unlock the history to open it.'
          : opened.reason === 'newer-schema'
            ? 'This entry was kept by a newer version of the tool.'
            : 'This entry could not be opened.',
      );
      return;
    }
    const p = readPayload(opened.payload);
    const normal = normalizeFlags(p.flags);
    const nextFlags = normal.ok ? normal.flags.replace('d', '') : 'g';
    void Promise.all([opened.blobs.text?.text() ?? '', opened.blobs.replacement?.text() ?? '']).then(
      ([nextText, nextReplacement]) => {
        edited.current = false;
        latest.current = {
          pattern: p.pattern,
          flags: nextFlags,
          text: nextText,
          replace: p.replace,
          replacement: nextReplacement,
        };
        setPattern(p.pattern);
        // The entry's flags and Replace for this visit; what is saved stays as it was.
        saved.visit({ flags: nextFlags, replace: p.replace });
        setText(nextText);
        setReplacement(nextReplacement);
        setPasted(null);
        setAllowLong(false);
        setSelected(0);
        setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
      },
    );
  });

  const commit = (action: NonNullable<RegexpPayload['action']>): void => {
    const s = latest.current;
    if (s.pattern === '' || s.text.length > MAX_TEXT) return;
    const outcome =
      shown.kind === 'result' ? { matches: shown.result.matches.length, truncated: shown.result.truncated } : undefined;
    void recorder.commit(draft(s, outcome, action));
  };

  const result = shown.kind === 'result' && request ? shown : null;
  const matches = useMemo<readonly Match[]>(() => result?.result.matches ?? [], [result]);
  const segs = useMemo(() => (result ? cut(result.text, matches) : []), [result, matches]);
  const copyMatches = useMemo(() => matches.map(m => m.text).join('\n'), [matches]);
  const current: Match | undefined = matches[selected];
  const groups = compiled?.ok ? compiled.groups : [];

  const tableBox = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    reveal(tableBox.current, tableBox.current?.querySelector<HTMLElement>(`[data-row="${selected}"]`));
  }, [selected, result]);

  const notes: string[] = [];
  if (pasted) notes.push(TEXTS.pasted);
  if (compiled?.ok && compiled.notes.includes('property-escape-without-u')) notes.push(TEXTS.property);

  const status =
    shown.kind === 'stopped' && request ? null : result ? matchCountText(matches.length, result.result.truncated) : '';

  return (
    <div className="flex flex-col gap-3">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      <ToolPane label="Pattern" htmlFor="regexp-pattern">
        {/* The button right of the field, and after it from the keyboard (§8). */}
        <div className="flex items-center gap-2">
          <Input
            id="regexp-pattern"
            className="flex-1 font-mono text-code"
            spellCheck={false}
            autoComplete="off"
            placeholder="\d{4}-\d{2}-\d{2}"
            value={pattern}
            onChange={e => editPattern(e.target.value)}
            onPaste={pastePattern}
            aria-describedby="regexp-pattern-hint regexp-pattern-message"
          />
          <CopyButton
            label="Copy regex"
            value={compiled?.ok ? compiled.literal : ''}
            onCopied={() => commit('copy-regex')}
          />
        </div>
        <p id="regexp-pattern-hint" className="m-0 text-sm text-muted-foreground">
          {TEXTS.hint}
        </p>
        {/* Live while typing: read out politely (status), not as an alert on every keystroke (the recipe, §5). */}
        <ToolMessage
          id="regexp-pattern-message"
          tone={compiled && !compiled.ok ? 'error' : 'note'}
          role="status"
          data-field="pattern">
          {compiled && !compiled.ok ? compiled.message : notes.join(' ') || ' '}
        </ToolMessage>
        {pasted && (
          <div>
            <Button variant="outline" size="sm" onClick={keepAsPasted}>
              Keep as pasted
            </Button>
          </div>
        )}
      </ToolPane>

      <div className="flex flex-wrap items-center gap-2">
        <span id="regexp-flags-label" className="cn-label">
          Flags
        </span>
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          aria-labelledby="regexp-flags-label"
          value={UI_FLAGS.filter(f => flags.includes(f))}
          onValueChange={changeFlags}>
          {UI_FLAGS.map((f: Flag) => (
            <ToggleGroupItem
              key={f}
              value={f}
              aria-label={FLAG_NAMES[f]}
              // Pressed flags in the primary colour, stronger than the kit's pressed toggle (accent, which since
              // 2026-11-21 shows on the outline variant too): a choice of this tool, kept until the owner picks one.
              className="font-mono data-on:bg-primary data-on:text-primary-foreground">
              {f}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-sm text-muted-foreground" data-flags>
          {flagWords(flags)}
        </span>
      </div>

      {shown.kind === 'stopped' && request ? (
        <div className="flex flex-wrap items-center gap-2" data-stopped>
          <ToolMessage tone="error">{TEXTS.stopped(shown.ms)}</ToolMessage>
          {!allowLong && (
            <Button variant="outline" size="sm" onClick={() => setAllowLong(true)}>
              Allow 10 seconds
            </Button>
          )}
          {slow && <span className="text-sm text-muted-foreground">{TEXTS.running}</span>}
        </div>
      ) : shown.kind === 'failed' && request ? (
        <ToolMessage tone="error" data-failed>
          {TEXTS.crashed(shown.message)}
        </ToolMessage>
      ) : (
        <p role="status" className="m-0 flex min-h-5 items-center gap-2 text-sm" data-status>
          <span>{status}</span>
          {slow && <span className="text-muted-foreground">{TEXTS.running}</span>}
        </p>
      )}

      <ToolPanes>
        <ToolPane label="Test text" htmlFor="regexp-text">
          <Textarea
            id="regexp-text"
            className="h-90 resize-y font-mono text-code field-sizing-fixed [tab-size:4]"
            spellCheck={false}
            placeholder="Paste the text to search"
            value={text}
            onChange={e => edit({ text: e.target.value })}
          />
          <ToolMessage tone={textTooLong ? 'error' : 'note'} role="status" data-field="text">
            {textTooLong ? TEXTS.textTooLong : ' '}
          </ToolMessage>
        </ToolPane>
        <ToolPane label="Matches in text">
          <Highlight
            text={result ? result.text : text}
            segments={segs}
            matches={matches}
            selected={result ? selected : -1}
            onSelect={setSelected}
          />
          <ToolMessage role="status" data-field="matches">
            {result?.result.splitsPair ? TEXTS.splitsPair : ' '}
          </ToolMessage>
        </ToolPane>
      </ToolPanes>

      <ToolPane
        label="Matches"
        actions={<CopyButton label="Copy matches" value={copyMatches} onCopied={() => commit('copy-matches')} />}>
        {matches.length > 0 && (
          <div ref={tableBox} className="max-h-80 overflow-y-auto">
            <Table aria-label="Matches">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">#</TableHead>
                  <TableHead className="w-24">Line:Col</TableHead>
                  <TableHead className="w-32">Range</TableHead>
                  <TableHead>Text</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="font-mono text-code">
                <MatchRows matches={matches} selected={selected} onSelect={setSelected} />
              </TableBody>
            </Table>
          </div>
        )}
        {matches.length > MAX_TABLE_ROWS && (
          <ToolMessage data-field="rows">
            Showing {formatCount(MAX_TABLE_ROWS)} of {formatCount(matches.length)}
            {result?.result.truncated ? '+' : ''} matches.
          </ToolMessage>
        )}
      </ToolPane>

      {groups.length > 0 && current && (
        <ToolPane label="Groups">
          <Table aria-label="Groups">
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">#</TableHead>
                <TableHead className="w-32">Name</TableHead>
                <TableHead className="w-32">Range</TableHead>
                <TableHead>Text</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-code">
              {current.groups.map(g => (
                <TableRow key={g.number}>
                  <TableCell>{g.number}</TableCell>
                  <TableCell>{g.name ?? '—'}</TableCell>
                  <TableCell>{range(g.start, g.end)}</TableCell>
                  <TableCell className={g.text === null ? 'break-all text-muted-foreground' : 'break-all'}>
                    {g.text === null ? 'no match' : showMatchText(g.text)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ToolPane>
      )}

      <div className="flex items-center gap-2">
        <Checkbox id="regexp-replace" checked={replace} onCheckedChange={c => edit({ replace: c === true })} />
        <Label htmlFor="regexp-replace" className="font-normal">
          Replace
        </Label>
      </div>
      {replace && (
        <ToolPanes layout="stacked">
          <ToolPane label="Replace with" htmlFor="regexp-replacement">
            <Textarea
              id="regexp-replacement"
              rows={2}
              className="resize-y font-mono text-code field-sizing-fixed"
              spellCheck={false}
              placeholder="$1, $<name>, $&"
              value={replacement}
              onChange={e => edit({ replacement: e.target.value })}
              aria-describedby="regexp-replacement-hint"
            />
            <p id="regexp-replacement-hint" className="m-0 text-sm text-muted-foreground">
              {TEXTS.replaceHint}
            </p>
          </ToolPane>
          <ToolPane
            label="Result"
            htmlFor="regexp-result"
            actions={
              <CopyButton
                label="Copy result"
                value={result?.result.replaced ?? ''}
                onCopied={() => commit('copy-result')}
              />
            }>
            <Textarea
              id="regexp-result"
              className="h-40 resize-y font-mono text-code field-sizing-fixed"
              spellCheck={false}
              readOnly
              value={result?.result.replaced ?? ''}
            />
            <ToolMessage tone={result?.result.replacedTooLarge ? 'error' : 'note'} role="status" data-field="result">
              {result?.result.replacedTooLarge ? TEXTS.resultTooLarge : ' '}
            </ToolMessage>
          </ToolPane>
        </ToolPanes>
      )}
    </div>
  );
};

export default RegexpTool;
