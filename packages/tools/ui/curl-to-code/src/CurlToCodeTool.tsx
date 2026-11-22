/**
 * The cURL to Code tool's page (docs/tools/specs/curl-to-code.md §8): Target, the command and the code side by side,
 * the command's state under it (an error is a link to its place), the warnings and the credentials note under the code.
 * Up to LIVE_INPUT characters the code follows every change, written on the page; above it Convert (or Ctrl+Enter)
 * works in the tool's worker (runner.ts); above MAX_INPUT the command is refused (§12). The command is text: nothing is
 * sent, no address is fetched or resolved, nothing is run. All logic is in @workspace/tool-logic-curl-to-code.
 *
 * History (D17): one secret kind through the host — `converted`: the command, the language and the code. An edit with
 * a result is a `change`; Copy and Convert are a `commit`. The history keeps them only encrypted, with a master password
 * set and unlocked; the line under the panes says which applies now. An entry opened from History brings the command and
 * the language back and records nothing. The page frame (title, summary, the history line) is the host's.
 */
import { draftOf, readPayload } from './entries';
import { curlToCodeHistory } from './history';
import { createRunner } from './runner';
import {
  CREDENTIALS_NOTE,
  LIVE_INPUT,
  MAX_INPUT,
  TARGETS,
  curlToCode,
  isTarget,
} from '@workspace/tool-logic-curl-to-code';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { CopyButton } from '@workspace/ui/copy-button';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { CircleAlertIcon, KeyRoundIcon, TriangleAlertIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CodeResult, Target } from '@workspace/tool-logic-curl-to-code';
import type { RecordingStatus, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const LARGE = 'Large command: press Convert (Ctrl+Enter).';
const TOO_LARGE = 'Command is larger than 16 MB.';
// §8 says api.example.com; the build allows only example.com among hosts in shipped code (validate-build.sh, Check 11).
const PLACEHOLDER = "curl https://example.com/users -H 'Accept: application/json'";

/** What the page says about keeping commands, in the words of the host's history line for secrets (§15). */
const keptSentence = (status: RecordingStatus): string =>
  status.gate !== 'on'
    ? 'Commands are not kept (history is off).'
    : status.secrets === 'unlocked'
      ? 'Commands and code are kept encrypted in this browser.'
      : status.secrets === 'locked'
        ? 'Commands are not kept while the history is locked.'
        : 'Commands are not kept (no master password).';

interface Ran {
  text: string;
  target: Target;
  result: CodeResult;
}

const CurlToCodeTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [command, setCommand] = useState(initial ?? '');
  const [target, setTarget] = useState<Target>('javascript');
  const [ran, setRan] = useState<Ran | null>(null);
  const [working, setWorking] = useState<{ text: string; target: Target } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const { history, recorder, status } = useToolHistory(host, 'curl-to-code', curlToCodeHistory);

  const runner = useMemo(() => createRunner(), []);
  useEffect(() => () => runner.dispose(), [runner]);

  const blank = command.trim() === '';
  const tooLarge = command.length > MAX_INPUT;
  const large = !tooLarge && command.length > LIVE_INPUT;

  // Live up to LIVE_INPUT (§12): tens of milliseconds at most.
  const live = useMemo(
    () => (blank || tooLarge || large ? null : curlToCode(command, target)),
    [command, target, blank, tooLarge, large],
  );
  const current = live ?? (ran && ran.text === command && ran.target === target ? ran.result : null);

  // A change while Convert is under way makes it out of date: stop it.
  useEffect(() => {
    if (working && (working.text !== command || working.target !== target)) {
      runner.cancel();
      setWorking(null);
    }
  }, [command, target, working, runner]);

  // A person's edit — or the text handed over from the start page — is recorded once it has code; opening an entry is not.
  const edited = useRef(Boolean(initial));
  const code = current?.ok ? current.text : '';
  useEffect(() => {
    if (edited.current && live?.ok && live.text !== '') recorder.change(draftOf(command, target, live.text));
  }, [recorder, live, command, target]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    setMessage(null);
    apply();
  };

  const convert = useCallback((): void => {
    if (!large || working) return;
    const job = { text: command, target };
    setWorking(job);
    runner.run(job).then(
      result => {
        if (!result) return;
        setRan({ ...job, result });
        setWorking(null);
        if (result.ok && result.text !== '') void recorder.commit(draftOf(job.text, job.target, result.text));
      },
      (error: unknown) => {
        setWorking(null);
        setMessage(`Convert stopped: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
  }, [large, working, command, target, runner, recorder]);

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
    const payload = readPayload(opened.payload);
    const blob = opened.blobs.command;
    if (!payload || !blob) {
      setRestored('This entry could not be opened.');
      return;
    }
    void blob.text().then(text => {
      edited.current = false;
      setMessage(null);
      setCommand(text);
      setTarget(payload.target);
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const goTo = (offset: number, line: number): void => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(offset, offset);
    const height = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.scrollTop = Math.max(0, (line - 1) * height - el.clientHeight / 3);
  };

  let state: ReactElement | string = ' ';
  let tone: 'error' | 'note' = 'note';
  if (message) [state, tone] = [message, 'error'];
  else if (tooLarge) [state, tone] = [TOO_LARGE, 'error'];
  else if (!blank && !current) state = LARGE;
  else if (current && !current.ok) {
    const { line, column, message: what, offset } = current.error;
    tone = 'error';
    state = (
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-destructive"
        data-part="error"
        onClick={() => goTo(offset, line)}>
        <CircleAlertIcon aria-hidden="true" />
        {`Line ${line}, column ${column}: ${what}`}
      </Button>
    );
  }

  const warnings = current?.ok ? current.warnings : [];
  const credentials = current?.ok === true && current.hasCredentials;
  const area = 'h-90 resize-y font-mono text-code field-sizing-fixed [tab-size:4]';

  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <Label htmlFor="curl-to-code-target" className="text-muted-foreground">
          Target
        </Label>
        <Select
          value={target}
          onValueChange={value => {
            if (isTarget(value) && value !== target) edit(() => setTarget(value));
          }}>
          <SelectTrigger id="curl-to-code-target" className="min-w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TARGETS.map(t => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {large && (
          <Button className="ml-2" disabled={working !== null} onClick={convert}>
            {working ? 'Working…' : 'Convert'}
          </Button>
        )}
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="curl command" htmlFor="curl-to-code-input">
          <Textarea
            ref={field}
            id="curl-to-code-input"
            className={area}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            placeholder={PLACEHOLDER}
            value={command}
            onChange={e => {
              const next = e.target.value;
              edit(() => setCommand(next));
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && large) {
                e.preventDefault();
                convert();
              }
            }}
          />
          {/* Changes while typing: read out politely (status), never as an alert on every keystroke. */}
          <ToolMessage tone={tone} role="status" data-part="status">
            {state}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="Code"
          htmlFor="curl-to-code-output"
          actions={
            <CopyButton
              value={code}
              onCopied={() => {
                if (code !== '') void recorder.commit(draftOf(command, target, code));
              }}
            />
          }>
          <Textarea id="curl-to-code-output" className={area} spellCheck={false} readOnly value={code} />
          <ul role="status" className="m-0 flex min-h-5 list-none flex-col gap-1 p-0 text-sm" data-part="warnings">
            {warnings.map(w => (
              <li key={w} className="flex items-start gap-1.5" data-part="warning">
                <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>{w}</span>
              </li>
            ))}
            {credentials && (
              <li className="flex items-start gap-1.5 text-muted-foreground" data-part="credentials">
                <KeyRoundIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>{CREDENTIALS_NOTE}</span>
              </li>
            )}
          </ul>
        </ToolPane>
      </ToolPanes>
      <p className="m-0 text-sm text-muted-foreground" data-hint>
        {`Nothing is sent: the command is read in this tab and the code is never run. ${keptSentence(status)}`}
      </p>
    </div>
  );
};

export default CurlToCodeTool;
