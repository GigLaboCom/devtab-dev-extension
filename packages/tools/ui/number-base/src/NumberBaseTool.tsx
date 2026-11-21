/**
 * The Number Bases tool's page (docs/tools/specs/number-base.md §8): the options row, five fields — Binary, Octal,
 * Decimal, Hexadecimal and Base with its N — each with its copy button, and the details under them. The field a person
 * edits is the source: its text stays as typed, the other four show the number in their base. All rules are in
 * @workspace/tool-logic-number-base; the host wraps the page in the kit's ToolPage.
 *
 * History (D17, docs/tools/history.md §10): an edit of a field or an option that reads as a number is a snapshot
 * (`change`); copying a field or a row of details is a commit (the tool has no Run button: a copy is when a person takes
 * a result); an entry the host opens comes back as the source field, its text, N and the options.
 */
import { Details } from './Details';
import { convertDraft, FIELD_IDS, FIELD_LABEL, readConvertPayload } from './entries';
import { numberBaseHistory } from './history';
import { fieldOfText, formatNumber, MESSAGES, parseNumber, radixOf, WIDTHS } from '@workspace/tool-logic-number-base';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { ToolMessage, ToolOptions } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldId } from './entries';
import type {
  FieldBase,
  FormatOptions,
  NegativeMode,
  ParseResult,
  Radix,
  Width,
} from '@workspace/tool-logic-number-base';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

/** How long an icon copy button shows its check (§8). */
const ICON_RESET_MS = 1500;

const RADIX: Record<Exclude<FieldId, 'base'>, FieldBase> = { binary: 2, octal: 8, decimal: 10, hexadecimal: 16 };
const FIELD_OF_RADIX: Record<FieldBase, FieldId> = { 2: 'binary', 8: 'octal', 10: 'decimal', 16: 'hexadecimal' };
const PLACEHOLDER: Record<Exclude<FieldId, 'base'>, string> = {
  binary: '0b1010',
  octal: '0o12',
  decimal: '10',
  hexadecimal: '0xa',
};

interface Source {
  field: FieldId;
  text: string;
}

interface State {
  source: Source | null;
  radix: string;
  negative: NegativeMode;
  width: Width;
  uppercase: boolean;
  grouped: boolean;
  prefixes: boolean;
}

const INITIAL: Omit<State, 'source'> = {
  radix: '36',
  negative: 'sign',
  width: 32,
  uppercase: false,
  grouped: false,
  prefixes: false,
};

const EMPTY: ParseResult = { ok: true, value: null };

/** The source read by the state's rules; the Base field with no valid N reads as nothing. */
const read = (s: State): { n: Radix | null; result: ParseResult } => {
  const n = radixOf(s.radix);
  if (!s.source) return { n, result: EMPTY };
  const radix = s.source.field === 'base' ? n : RADIX[s.source.field];
  if (radix === null) return { n, result: EMPTY };
  return { n, result: parseNumber(s.source.text, radix, { negative: s.negative, width: s.width }) };
};

const formatOf = (s: State): FormatOptions => ({
  negative: s.negative,
  width: s.width,
  uppercase: s.uppercase,
  grouped: s.grouped,
  prefixes: s.prefixes,
});

const draftOf = (s: State): HistoryDraft | null => {
  const { result } = read(s);
  if (!s.source || !result.ok || result.value === null) return null;
  const { source, ...options } = s;
  return convertDraft({ ...options, field: source.field, text: source.text, decimal: result.value.toString() });
};

const NumberBaseTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [state, setState] = useState<State>(() => ({
    ...INITIAL,
    source: initial ? { field: FIELD_OF_RADIX[fieldOfText(initial)], text: initial } : null,
  }));
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'number-base', numberBaseHistory);

  const { n, result } = useMemo(() => read(state), [state]);
  const value = result.ok ? result.value : null;
  const format = formatOf(state);

  const edit = (next: Partial<State>): void => {
    const after = { ...state, ...next };
    setState(after);
    setRestored(null);
    const draft = draftOf(after);
    if (draft) recorder.change(draft);
  };

  // Text handed over from the start page is the first edit of this visit.
  const handed = useRef(state);
  useEffect(() => {
    const draft = draftOf(handed.current);
    if (draft) recorder.change(draft);
  }, [recorder]);

  /** §4: a new N keeps the number; when the Base field was the source, Decimal becomes it. */
  const changeRadix = (radix: string): void => {
    if (state.source?.field === 'base' && value !== null)
      edit({ radix, source: { field: 'decimal', text: formatNumber(value, 10, format).shown } });
    else edit({ radix });
  };

  const copied = (): void => {
    const draft = draftOf(state);
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
    const { field, text, ...options } = readConvertPayload(opened.payload);
    setState({ ...options, source: { field, text } });
    setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
  });

  const fieldRadix = (id: FieldId): Radix | null => (id === 'base' ? n : RADIX[id]);
  const formatted = (id: FieldId) => {
    const radix = fieldRadix(id);
    return radix === null ? { shown: '', copy: '' } : formatNumber(value, radix, { ...format, plain: id === 'base' });
  };
  const radixInvalid = n === null;

  return (
    <div className="flex flex-col gap-4">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolOptions>
        <Label htmlFor="number-base-negative" className="text-muted-foreground">
          Negative numbers
        </Label>
        <Select value={state.negative} onValueChange={v => edit({ negative: v as NegativeMode })}>
          <SelectTrigger id="number-base-negative" className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sign">Minus sign</SelectItem>
            <SelectItem value="twos">Two&apos;s complement</SelectItem>
          </SelectContent>
        </Select>
        <Label htmlFor="number-base-width" className="ml-2 text-muted-foreground">
          Width
        </Label>
        <Select
          value={String(state.width)}
          disabled={state.negative === 'sign'}
          onValueChange={v => edit({ width: Number(v) as Width })}>
          <SelectTrigger id="number-base-width" className="min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WIDTHS.map(w => (
              <SelectItem key={w} value={String(w)}>
                {w} bits
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(
          [
            ['uppercase', 'Uppercase'],
            ['grouped', 'Group digits'],
            ['prefixes', 'Prefixes'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="ml-2 flex items-center gap-2">
            <Checkbox
              id={`number-base-${key}`}
              checked={state[key]}
              onCheckedChange={checked => edit({ [key]: checked === true })}
            />
            <Label htmlFor={`number-base-${key}`} className="font-normal">
              {label}
            </Label>
          </div>
        ))}
      </ToolOptions>

      <div className="flex flex-col gap-2">
        {FIELD_IDS.map(id => {
          const isSource = state.source?.field === id;
          const shown = isSource ? state.source!.text : formatted(id).shown;
          const copy = formatted(id).copy;
          const error = isSource && !result.ok ? result.error : null;
          const base = id === 'base';
          const messageId = `number-base-${id}-message`;
          return (
            <div key={id} className="flex flex-col gap-1" data-field={id}>
              <div className="flex items-center gap-2">
                <div className="flex w-36 shrink-0 items-center gap-2">
                  <Label htmlFor={`number-base-${id}`}>{FIELD_LABEL[id]}</Label>
                  {base && (
                    <Input
                      aria-label="Base"
                      className="w-14 font-mono text-code"
                      inputMode="numeric"
                      spellCheck={false}
                      autoComplete="off"
                      aria-invalid={radixInvalid || undefined}
                      aria-describedby="number-base-radix-message"
                      value={state.radix}
                      onChange={e => changeRadix(e.target.value)}
                    />
                  )}
                </div>
                <Input
                  id={`number-base-${id}`}
                  className="flex-1 font-mono text-code"
                  {...(base ? { 'aria-label': n === null ? 'Number in base N' : `Number in base ${n}` } : {})}
                  placeholder={
                    base ? (n === null ? '' : (10).toString(n)) : PLACEHOLDER[id as keyof typeof PLACEHOLDER]
                  }
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  disabled={base && radixInvalid}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={messageId}
                  value={base && radixInvalid ? '' : shown}
                  onChange={e => edit({ source: { field: id, text: e.target.value } })}
                />
                <CopyButton
                  icon
                  label={base && n !== null ? `Copy base ${n}` : `Copy ${FIELD_LABEL[id].toLowerCase()}`}
                  value={copy}
                  resetAfterMs={ICON_RESET_MS}
                  onCopied={copied}
                />
              </div>
              {/* Changes while typing: read out politely (status), as the recipe says — never an alert per keystroke. */}
              <div id={messageId} role="status" className="ml-38">
                {error && (
                  <ToolMessage tone="error" role={undefined}>
                    Column {error.offset + 1}: {error.message}
                  </ToolMessage>
                )}
              </div>
              {base && (
                <div id="number-base-radix-message" role="status" className="ml-38">
                  {radixInvalid && (
                    <ToolMessage tone="error" role={undefined}>
                      {MESSAGES.radix}
                    </ToolMessage>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {value !== null && <Details value={value} state={state} onCopied={copied} />}
    </div>
  );
};

export default NumberBaseTool;
