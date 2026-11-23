/**
 * The Subnet Calculator's page (docs/tools/specs/subnet.md §8): the Task switch, then one of four bodies — Explain
 * (the Block field and its rows), Match (two lists and a table), Split (the Block field, how to split, a paged table)
 * and Summarize (a list and the blocks it comes to). Each task's input lives while the page is open. All rules are in
 * @workspace/tool-logic-subnet; the host wraps the page in the kit's ToolPage. Nothing here touches the network: an
 * address is a number.
 *
 * History (D17, docs/tools/history.md §10): an edit that reads is a snapshot (`change`) of the task's kind — for the
 * lists, once their answer came; a copy is a commit; an opened entry comes back as its task and fields.
 *
 * The task and Split by are saved parameters (settings.ts; docs/tools/settings.md): the page opens with what the person
 * chose last; a paste from the start page (Explain or Summarize) and an opened entry choose for the visit only.
 */
import { ChunkedRows } from './ChunkedRows';
import { explainDraft, matchDraft, readEntry, splitDraft, summarizeDraft } from './entries';
import { ExplainRows } from './ExplainRows';
import { subnetHistory } from './history';
import { Pager } from './Pager';
import { subnetSettings } from './settings';
import { useListAnswer, useRunner } from './useListAnswer';
import {
  BITS,
  blockSize,
  detectedTask,
  explain,
  formatBlock,
  groupDigits,
  matchCopyText,
  matchStatus,
  MAX_COPY_ROWS,
  PAGE_ROWS,
  parseEntry,
  planSplit,
  skippedText,
  splitRows,
  splitSummary,
  splitText,
} from '@workspace/tool-logic-subnet';
import { useRestore, useSavedSettings, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/table';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from './entries';
import type { ListJob } from './runner';
import type { Block, Entry, MatchCopy, SplitPlan, TextError } from '@workspace/tool-logic-subnet';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const TASKS: { id: Task; label: string }[] = [
  { id: 'explain', label: 'Explain' },
  { id: 'match', label: 'Match' },
  { id: 'split', label: 'Split' },
  { id: 'summarize', label: 'Summarize' },
];

const isTask = (v: string): v is Task => TASKS.some(t => t.id === v);

const errorLine = (e: TextError): string => (e.start < 0 ? e.message : `Column ${e.start + 1}: ${e.message}`);

type SplitBy = 'prefix' | 'count';

type PlanState =
  | { kind: 'none' }
  | { kind: 'ask'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'plan'; plan: Extract<SplitPlan, { ok: true }> };

/** What the Split parameter says for this block (§6: empty — a prompt, not a number — an error). */
const planOf = (block: Block | null, by: SplitBy, prefix: string, count: string): PlanState => {
  if (!block) return { kind: 'none' };
  const bits = BITS[block.family];
  if (by === 'prefix') {
    const text = prefix.trim().replace(/^\//, '');
    if (text === '') return { kind: 'ask', message: `Enter a prefix length from ${block.prefix} to ${bits}.` };
    if (!/^[0-9]{1,4}$/.test(text)) return { kind: 'error', message: 'Write the prefix length as a whole number.' };
    let n = 0;
    for (const d of text) n = n * 10 + (d.charCodeAt(0) - 48);
    const plan = planSplit(block, { by: 'prefix', prefix: n });
    return plan.ok ? { kind: 'plan', plan } : { kind: 'error', message: plan.message };
  }
  const text = count.trim();
  if (text === '')
    return { kind: 'ask', message: `Enter a number of subnets from 1 to ${groupDigits(blockSize(block))}.` };
  if (!/^[0-9]{1,40}$/.test(text)) return { kind: 'error', message: 'Write the number of subnets as a whole number.' };
  const plan = planSplit(block, { by: 'count', count: BigInt(text) });
  return plan.ok ? { kind: 'plan', plan } : { kind: 'error', message: plan.message };
};

const readBlock = (
  text: string,
): { entry: Extract<Entry, { kind: 'block' }> | null; error: TextError | null; range: boolean } => {
  if (!text.trim()) return { entry: null, error: null, range: false };
  const read = parseEntry(text);
  if (!read.ok) return { entry: null, error: read.error, range: false };
  if (read.entry.kind === 'range')
    return {
      entry: null,
      error: { message: 'A range is not one block: Summarize gives its blocks.', start: -1, end: -1 },
      range: true,
    };
  return { entry: read.entry, error: null, range: false };
};

const SubnetTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const handed = initial?.trim() ? initial : '';
  const saved = useSavedSettings(host, 'subnet', subnetSettings, {
    // A paste opens Summarize (several blocks) or Explain for this visit; what is saved stays as it was.
    opening: handed ? { task: detectedTask(handed) === 'summarize' ? 'summarize' : 'explain' } : undefined,
  });
  const { task, by } = saved.values;
  const [blockText, setBlockText] = useState(() => (handed && detectedTask(handed) !== 'summarize' ? handed : ''));
  const [prefixText, setPrefixText] = useState('');
  const [countText, setCountText] = useState('');
  const [addressesText, setAddressesText] = useState('');
  const [blocksText, setBlocksText] = useState('');
  const [listText, setListText] = useState(() => (handed && detectedTask(handed) === 'summarize' ? handed : ''));
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'subnet', subnetHistory);
  const runner = useRunner();

  const block = useMemo(() => readBlock(blockText), [blockText]);
  const explanation = useMemo(() => (block.entry ? explain(block.entry) : null), [block.entry]);
  const planState = useMemo(
    () => planOf(block.entry?.block ?? null, by, prefixText, countText),
    [block.entry, by, prefixText, countText],
  );
  const plan = planState.kind === 'plan' ? planState.plan : null;
  const [page, setPage] = useState<{ plan: typeof plan; from: bigint }>({ plan: null, from: 0n });
  const from = page.plan === plan ? page.from : 0n;

  const matchJob = useMemo<ListJob | null>(
    () =>
      task === 'match' && addressesText.trim() && blocksText.trim()
        ? { task: 'match', addresses: addressesText, blocks: blocksText }
        : null,
    [task, addressesText, blocksText],
  );
  const summarizeJob = useMemo<ListJob | null>(
    () => (task === 'summarize' && listText.trim() ? { task: 'summarize', list: listText } : null),
    [task, listText],
  );
  const listState = useListAnswer(matchJob ?? summarizeJob, runner);
  const match = listState.answer?.task === 'match' ? listState.answer.result : null;
  const summary = listState.answer?.task === 'summarize' ? listState.answer.result : null;
  const [matchPage, setMatchPage] = useState<{ rows: unknown; from: bigint }>({ rows: null, from: 0n });
  const matchFrom = match && matchPage.rows === match.rows ? matchPage.from : 0n;

  // Drafts of the history, from the state as it is.
  const explainNow = () =>
    explanation && block.entry
      ? explainDraft(
          blockText,
          formatBlock(block.entry.block),
          explanation.rows.find(r => r.id === 'kind')?.value ?? '',
        )
      : null;
  const splitNow = () =>
    plan && block.entry
      ? splitDraft(
          { block: blockText, by, prefix: prefixText, count: countText, subnets: plan.count.toString() },
          formatBlock(block.entry.block),
          plan.prefix,
        )
      : null;
  const matchNow = () =>
    match && match.rows.length
      ? matchDraft(addressesText, blocksText, {
          addresses: match.rows.length,
          blocks: match.blocks.entries,
          inside: match.inside,
        })
      : null;
  const summarizeNow = () =>
    summary && summary.blocks
      ? summarizeDraft(listText, { entries: summary.list.entries, blocks: summary.blocks })
      : null;
  const draftNow = () =>
    task === 'explain' ? explainNow() : task === 'split' ? splitNow() : task === 'match' ? matchNow() : summarizeNow();

  // An edit is recorded once the state it made reads (for the lists: once their answer came).
  const edited = useRef(Boolean(handed));
  const draftKey = task === 'match' ? match : task === 'summarize' ? summary : task === 'split' ? plan : explanation;
  const latestDraft = useRef(draftNow);
  latestDraft.current = draftNow;
  useEffect(() => {
    if (!edited.current) return;
    const draft = latestDraft.current();
    if (draft) recorder.change(draft);
  }, [draftKey, recorder]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    apply();
  };
  const copied = (): void => {
    const draft = draftNow();
    if (draft) void recorder.commit(draft);
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
    edited.current = false;
    const r = readEntry(opened.entry.kind, opened.payload);
    // The entry's task (and a split's Split by) for this visit; what is saved stays as it was.
    saved.visit(r.by ? { task: r.task, by: r.by } : { task: r.task });
    if (r.block !== undefined) setBlockText(r.block);
    if (r.prefix !== undefined) setPrefixText(r.prefix);
    if (r.count !== undefined) setCountText(r.count);
    const text = (name: string): Promise<string> => opened.blobs[name]?.text() ?? Promise.resolve('');
    const done = (): void => setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    if (r.task === 'match')
      void Promise.all([text('addresses'), text('blocks')]).then(([a, b]) => {
        setAddressesText(a);
        setBlocksText(b);
        done();
      });
    else if (r.task === 'summarize')
      void text('list').then(l => {
        setListText(l);
        done();
      });
    else done();
  });

  const blockField = (
    <div className="flex flex-col gap-1">
      <Label htmlFor="subnet-block">Block</Label>
      <Input
        id="subnet-block"
        className="font-mono text-code"
        placeholder="10.0.12.5/22 or 2001:db8::/48"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        aria-invalid={block.error ? true : undefined}
        aria-describedby="subnet-block-hint subnet-block-message"
        value={blockText}
        onChange={e => edit(() => setBlockText(e.target.value))}
      />
      <p id="subnet-block-hint" className="text-muted-foreground">
        A CIDR block (10.0.12.0/22), an address with a netmask (10.0.12.0 255.255.252.0) or a wildcard mask (10.0.12.0
        0.0.3.255), or one address.
      </p>
      {/* Changes while typing: read out politely (status), never an alert per keystroke. */}
      <div id="subnet-block-message" role="status" data-field="block" className="flex flex-col gap-1">
        {block.error && (
          <ToolMessage tone="error" role={undefined}>
            {errorLine(block.error)}
          </ToolMessage>
        )}
        {block.range && (
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                edit(() => {
                  setListText(t => (t.trim() ? `${t.replace(/\n*$/, '')}\n${blockText.trim()}` : blockText.trim()));
                  saved.set({ task: 'summarize' });
                })
              }>
              Summarize this range
            </Button>
          </div>
        )}
        {block.entry?.notes.map(n => (
          <ToolMessage key={n.kind} role={undefined} data-note={n.kind}>
            {n.text}
          </ToolMessage>
        ))}
      </div>
    </div>
  );

  const total = plan?.count ?? 0n;
  const rows = useMemo(
    () => (plan && block.entry ? splitRows(block.entry.block, plan.prefix, from, PAGE_ROWS, plan.count) : []),
    [plan, block.entry, from],
  );
  const copyable = plan !== null && plan.count <= BigInt(MAX_COPY_ROWS);
  const splitCopy = (table: boolean) => () =>
    plan && block.entry ? (splitText(block.entry.block, plan.prefix, table) ?? '') : '';

  const matchRows = match ? match.rows.slice(Number(matchFrom), Number(matchFrom) + PAGE_ROWS) : [];
  const copyMatch = (what: MatchCopy) => () => (match ? matchCopyText(match.rows, what) : '');

  return (
    <div className="flex flex-col gap-4">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Task"
          value={task}
          onValueChange={v => {
            if (isTask(v) && v !== task) {
              setRestored(null);
              saved.set({ task: v });
            }
          }}>
          {TASKS.map(t => (
            <ToggleGroupItem key={t.id} value={t.id}>
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </ToolOptions>

      {task === 'explain' && (
        <div className="flex flex-col gap-4" data-task="explain">
          {blockField}
          {explanation && <ExplainRows explanation={explanation} onCopied={copied} />}
        </div>
      )}

      {task === 'split' && (
        <div className="flex flex-col gap-4" data-task="split">
          {blockField}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground" id="subnet-split-by">
              Split by
            </span>
            <ToggleGroup
              type="single"
              variant="segmented"
              aria-labelledby="subnet-split-by"
              value={by}
              onValueChange={v => {
                if ((v === 'prefix' || v === 'count') && v !== by) edit(() => saved.set({ by: v }));
              }}>
              <ToggleGroupItem value="prefix">Prefix length</ToggleGroupItem>
              <ToggleGroupItem value="count">Number of subnets</ToggleGroupItem>
            </ToggleGroup>
            {by === 'prefix' ? (
              <>
                <Label htmlFor="subnet-prefix" className="ml-2">
                  New prefix length
                </Label>
                <Input
                  id="subnet-prefix"
                  className="w-20 font-mono text-code"
                  inputMode="numeric"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={
                    block.entry ? String(Math.min(block.entry.block.prefix + 2, BITS[block.entry.block.family])) : ''
                  }
                  aria-invalid={planState.kind === 'error' || undefined}
                  aria-describedby="subnet-split-message"
                  value={prefixText}
                  onChange={e => edit(() => setPrefixText(e.target.value))}
                />
              </>
            ) : (
              <>
                <Label htmlFor="subnet-count" className="ml-2">
                  Count
                </Label>
                <Input
                  id="subnet-count"
                  className="w-28 font-mono text-code"
                  inputMode="numeric"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="4"
                  aria-invalid={planState.kind === 'error' || undefined}
                  aria-describedby="subnet-split-message"
                  value={countText}
                  onChange={e => edit(() => setCountText(e.target.value))}
                />
              </>
            )}
          </div>
          <div id="subnet-split-message" role="status" data-field="split">
            {planState.kind === 'error' && (
              <ToolMessage tone="error" role={undefined}>
                {planState.message}
              </ToolMessage>
            )}
            {planState.kind === 'ask' && <ToolMessage role={undefined}>{planState.message}</ToolMessage>}
            {plan && block.entry && <p data-status="split">{splitSummary(block.entry.block, plan)}</p>}
          </div>
          {plan && block.entry && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1">
                <CopyButton
                  label="Copy subnets"
                  value={splitCopy(false)}
                  resetKey={plan}
                  disabled={!copyable}
                  variant="ghost"
                  size="sm"
                  onCopied={copied}
                />
                <CopyButton
                  label="Copy table"
                  value={splitCopy(true)}
                  resetKey={plan}
                  disabled={!copyable}
                  variant="ghost"
                  size="sm"
                  onCopied={copied}
                />
              </div>
              {!copyable && (
                <ToolMessage data-copy-limit>
                  Copying takes up to {groupDigits(BigInt(MAX_COPY_ROWS))} subnets; this split has {groupDigits(total)}.
                </ToolMessage>
              )}
              <Table aria-label="Subnets">
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Subnet</TableHead>
                    <TableHead>First address</TableHead>
                    <TableHead>Last address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ChunkedRows
                    rows={rows}
                    render={r => (
                      <TableRow key={r.index.toString()}>
                        <TableCell className="text-muted-foreground">{groupDigits(r.index + 1n)}</TableCell>
                        <TableCell className="font-mono text-code break-all">{r.subnet}</TableCell>
                        <TableCell className="font-mono text-code break-all">{r.first}</TableCell>
                        <TableCell className="font-mono text-code break-all">{r.last}</TableCell>
                      </TableRow>
                    )}
                  />
                </TableBody>
              </Table>
              <Pager
                noun="Subnets"
                from={from}
                size={BigInt(PAGE_ROWS)}
                total={total}
                onPage={f => setPage({ plan, from: f })}
              />
            </div>
          )}
        </div>
      )}

      {task === 'match' && (
        <div className="flex flex-col gap-4" data-task="match">
          <ToolPanes>
            <ToolPane label="Addresses" htmlFor="subnet-addresses">
              <Textarea
                id="subnet-addresses"
                className="h-48 resize-y font-mono text-code field-sizing-fixed"
                spellCheck={false}
                placeholder={'10.0.12.77\n192.168.1.10\n2001:db8::1'}
                value={addressesText}
                onChange={e => edit(() => setAddressesText(e.target.value))}
              />
              <ListMessages report={match?.addresses} field="addresses" />
            </ToolPane>
            <ToolPane label="Blocks" htmlFor="subnet-blocks">
              <Textarea
                id="subnet-blocks"
                className="h-48 resize-y font-mono text-code field-sizing-fixed"
                spellCheck={false}
                placeholder={'10.0.0.0/8\n10.0.12.0/22\n192.168.0.10 - 192.168.0.20'}
                value={blocksText}
                onChange={e => edit(() => setBlocksText(e.target.value))}
              />
              <ListMessages report={match?.blocks} field="blocks" />
            </ToolPane>
          </ToolPanes>
          <div role="status" className="flex items-center gap-2">
            {match && match.rows.length > 0 && (
              <span data-status="match">{matchStatus(match.inside, match.rows.length)}</span>
            )}
            {listState.working && matchJob && <span className="text-muted-foreground">Working…</span>}
            {listState.crash && matchJob && (
              <ToolMessage tone="error" role={undefined}>
                The lists could not be matched: {listState.crash}.
              </ToolMessage>
            )}
          </div>
          {matchJob && match && match.rows.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    ['table', 'Copy table', match.rows.length > 0],
                    ['inside', 'Copy inside', match.inside > 0],
                    ['outside', 'Copy outside', match.inside < match.rows.length],
                  ] as const
                ).map(([what, label, enabled]) => (
                  <CopyButton
                    key={what}
                    label={label}
                    value={copyMatch(what)}
                    resetKey={match.rows}
                    disabled={!enabled}
                    variant="ghost"
                    size="sm"
                    onCopied={copied}
                  />
                ))}
              </div>
              <Table aria-label="Matches">
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Block</TableHead>
                    <TableHead>In blocks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ChunkedRows
                    rows={matchRows}
                    render={(r, k) => (
                      <TableRow key={k}>
                        <TableCell className="text-muted-foreground">
                          {groupDigits(matchFrom + BigInt(k) + 1n)}
                        </TableCell>
                        <TableCell className="font-mono text-code break-all">{r.address}</TableCell>
                        <TableCell className="font-mono text-code break-all">{r.block ?? '—'}</TableCell>
                        <TableCell>{groupDigits(BigInt(r.count))}</TableCell>
                      </TableRow>
                    )}
                  />
                </TableBody>
              </Table>
              <Pager
                noun="Addresses"
                from={matchFrom}
                size={BigInt(PAGE_ROWS)}
                total={BigInt(match.rows.length)}
                onPage={f => setMatchPage({ rows: match.rows, from: f })}
              />
            </div>
          )}
        </div>
      )}

      {task === 'summarize' && (
        <div className="flex flex-col gap-4" data-task="summarize">
          <ToolPanes>
            <ToolPane label="Blocks and ranges" htmlFor="subnet-list">
              <Textarea
                id="subnet-list"
                className="h-90 resize-y font-mono text-code field-sizing-fixed"
                spellCheck={false}
                placeholder={'10.0.0.0/24\n10.0.1.0/24\n192.168.0.5 - 192.168.0.20'}
                aria-describedby="subnet-list-hint"
                value={listText}
                onChange={e => edit(() => setListText(e.target.value))}
              />
              <p id="subnet-list-hint" className="text-muted-foreground">
                One per line or comma-separated: CIDR blocks, addresses with masks, single addresses, ranges a - b. Text
                after # is skipped.
              </p>
              <ListMessages report={summary?.list} field="list" />
            </ToolPane>
            <ToolPane
              label="Summary"
              htmlFor="subnet-summary"
              actions={
                <CopyButton
                  label={summary && summary.blocks > 1 ? 'Copy all' : 'Copy'}
                  value={summary?.text ?? ''}
                  disabled={!summary?.text || !summarizeJob}
                  onCopied={copied}
                />
              }>
              <div role="status" className="flex min-h-6 items-center gap-2">
                {summarizeJob && summary?.status && <span data-status="summarize">{summary.status}</span>}
                {listState.working && summarizeJob && <span className="text-muted-foreground">Working…</span>}
              </div>
              <Textarea
                id="subnet-summary"
                readOnly
                className="h-90 resize-y font-mono text-code field-sizing-fixed"
                spellCheck={false}
                value={summarizeJob ? (summary?.text ?? '') : ''}
              />
              <div role="status">
                {summarizeJob && summary && summary.skipped > 0 && (
                  <ToolMessage role={undefined} data-skipped>
                    {skippedText(summary.skipped)}
                  </ToolMessage>
                )}
                {listState.crash && summarizeJob && (
                  <ToolMessage tone="error" role={undefined}>
                    The list could not be summarized: {listState.crash}.
                  </ToolMessage>
                )}
              </div>
            </ToolPane>
          </ToolPanes>
        </div>
      )}
    </div>
  );
};

/** A list's first error and notes, or why it is not read (§6), under its field. */
const ListMessages = ({
  report,
  field,
}: {
  report: { error: string; notes: string[]; tooLong?: string } | undefined;
  field: string;
}): ReactElement => (
  <div role="status" data-field={field} className="flex flex-col gap-1">
    {report?.tooLong && (
      <ToolMessage tone="error" role={undefined}>
        {report.tooLong}
      </ToolMessage>
    )}
    {report?.error && (
      <ToolMessage tone="error" role={undefined}>
        {report.error}
      </ToolMessage>
    )}
    {report?.notes.map(n => (
      <ToolMessage key={n} role={undefined}>
        {n}
      </ToolMessage>
    ))}
  </div>
);

export default SubnetTool;
