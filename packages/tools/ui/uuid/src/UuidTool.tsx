/**
 * The UUID / ULID tool's page (docs/tools/specs/uuid.md §8): two cards, Generate and Inspect. All rules are in
 * @workspace/tool-logic-uuid; randomness is its default source (crypto.getRandomValues through
 * @workspace/tools-shared/random), the clock `Date.now()` once per batch. The host wraps the page in the kit's ToolPage.
 *
 * History (D17, docs/tools/history.md §10): Generate and Copy commit the batch shown; an edit of the options is a
 * snapshot (`change`) once its result is there; Inspect snapshots an identifier that parsed; an entry the host asks to
 * open comes back as the options and the identifiers, or as the inspected text.
 */
import { excerpt, generateLabel, NAMESPACE_LABELS, readGeneratePayload, TYPE_LABELS } from './entries';
import { uuidHistory } from './history';
import { Inspect } from './Inspect';
import {
  canonical,
  COUNT_ERROR,
  createTimeOrderedGenerator,
  encodeUlid,
  formatUuid,
  generateBatch,
  kindLabel,
  MAX,
  MAX_NAME,
  NAMESPACE_ERROR,
  NAMESPACES,
  nameBased,
  namespaceBytes,
  NIL,
  parseCount,
  parseId,
  v4,
} from '@workspace/tool-logic-uuid';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/card';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToolMessage, ToolOptions } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeneratePayload, InspectPayload } from './entries';
import type { GenerateType, NamespaceId, TimeOrderedGenerator, UuidFormat } from '@workspace/tool-logic-uuid';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

type RandomType = 'v4' | 'v7' | 'ulid';
type Namespace = NamespaceId | 'custom';
type Batch = { type: RandomType; bytes: Uint8Array[] };

const TYPES: GenerateType[] = ['v4', 'v7', 'ulid', 'v5', 'v3', 'nil', 'max'];
const FORMATS: Array<{ value: UuidFormat; label: string }> = [
  { value: 'standard', label: 'Standard' },
  { value: 'no-hyphens', label: 'No hyphens' },
  { value: 'braces', label: 'Braces' },
  { value: 'urn', label: 'URN' },
];
const NAMESPACE_IDS: Namespace[] = ['dns', 'url', 'oid', 'x500', 'custom'];
/** The result field grows with its lines up to this many, then scrolls (§8). */
const MAX_ROWS = 12;

const isRandom = (type: GenerateType): type is RandomType => type === 'v4' || type === 'v7' || type === 'ulid';
const isNamed = (type: GenerateType): type is 'v3' | 'v5' => type === 'v3' || type === 'v5';

const generateDraft = (payload: GeneratePayload): HistoryDraft => ({
  kind: 'generate',
  payload,
  label: generateLabel(payload),
  text: excerpt([payload.name ?? '', ...payload.ids].filter(Boolean).join('\n')),
});

const inspectDraft = (input: string): HistoryDraft | null => {
  const parsed = parseId(input);
  if (!parsed.ok) return null;
  const payload: InspectPayload = { input };
  return {
    kind: 'inspect',
    payload,
    label: `${kindLabel(parsed.value)} · ${canonical(parsed.value)}`,
    text: excerpt(input.trim()),
  };
};

const UuidTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const generator = useRef<TimeOrderedGenerator | null>(null);
  const [type, setType] = useState<GenerateType>('v4');
  const [countText, setCountText] = useState('1');
  const [format, setFormat] = useState<UuidFormat>('standard');
  const [uppercase, setUppercase] = useState(false);
  const [namespace, setNamespace] = useState<Namespace>('dns');
  const [custom, setCustom] = useState('');
  const [name, setName] = useState('');
  // §2.1: the tool opens with one UUID v4 in Generate.
  const [batch, setBatch] = useState<Batch | null>(() => ({ type: 'v4', bytes: [v4()] }));
  const [named, setNamed] = useState<{ key: string; bytes: Uint8Array } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [inspect, setInspect] = useState(initial ?? '');
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'uuid', uuidHistory);

  const count = parseCount(countText);
  const nsBytes = useMemo(
    () => (namespace === 'custom' ? namespaceBytes(custom) : namespaceBytes(NAMESPACES[namespace])),
    [namespace, custom],
  );
  const nsKey = nsBytes ? formatUuid(nsBytes, 'standard', false) : null;
  const namedKey = isNamed(type) && nsKey ? `${type}|${nsKey}|${name}` : null;

  // v3 and v5 are recomputed as the namespace and the name change (§4): SHA-1 is WebCrypto's, so the result is async.
  useEffect(() => {
    if (!namedKey || !nsBytes || !isNamed(type)) return;
    let live = true;
    void nameBased(type === 'v3' ? 3 : 5, nsBytes, name).then(bytes => {
      if (live) setNamed({ key: namedKey, bytes });
    });
    return () => {
      live = false;
    };
  }, [namedKey, nsBytes, type, name]);

  const ids = useMemo((): string[] => {
    if (isRandom(type)) {
      if (count === null || !batch || batch.type !== type) return [];
      return batch.bytes.map(b => (type === 'ulid' ? encodeUlid(b) : formatUuid(b, format, uppercase)));
    }
    if (type === 'nil' || type === 'max') return [formatUuid(type === 'nil' ? NIL : MAX, format, uppercase)];
    return named && named.key === namedKey ? [formatUuid(named.bytes, format, uppercase)] : [];
  }, [type, count, batch, format, uppercase, named, namedKey]);
  const result = ids.join('\n');

  const payloadOf = (shown: string[]): GeneratePayload => ({
    type,
    ...(isRandom(type) && count !== null ? { count } : {}),
    format,
    uppercase,
    ...(isNamed(type) ? { namespace, ...(namespace === 'custom' ? { customNamespace: custom } : {}), name } : {}),
    ids: shown,
  });

  // An edit of the options is recorded as a snapshot once its result is shown (v3 / v5 come a moment later).
  const edited = useRef(false);
  const payload = ids.length > 0 ? payloadOf(ids) : null;
  const snapshot = payload ? JSON.stringify(payload) : '';
  useEffect(() => {
    if (!edited.current || !snapshot) return;
    edited.current = false;
    recorder.change(generateDraft(JSON.parse(snapshot) as GeneratePayload));
  }, [snapshot, recorder]);

  const generate = (next: GenerateType, n: number | null): Uint8Array[] | null => {
    if (!isRandom(next) || n === null) return null;
    try {
      generator.current ??= createTimeOrderedGenerator();
      const bytes = generateBatch(next, n, generator.current, Date.now());
      setBatch({ type: next, bytes });
      setFailure(null);
      return bytes;
    } catch (error) {
      setBatch(null);
      setFailure(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const edit = (): void => {
    edited.current = true;
    setRestored(null);
  };

  const onType = (next: GenerateType): void => {
    edit();
    setType(next);
    setFailure(null);
    generate(next, count);
  };

  const onCount = (text: string): void => {
    edit();
    setCountText(text);
    generate(type, parseCount(text));
  };

  const onGenerate = (): void => {
    const bytes = generate(type, count);
    setRestored(null);
    if (!bytes || !isRandom(type)) return;
    edited.current = false;
    const shown = bytes.map(b => (type === 'ulid' ? encodeUlid(b) : formatUuid(b, format, uppercase)));
    void recorder.commit(generateDraft(payloadOf(shown)));
  };

  const onInspect = (text: string): void => {
    setInspect(text);
    setRestored(null);
    const draft = inspectDraft(text);
    if (draft) recorder.change(draft);
  };

  // Text handed over from the start page is the first inspection of this visit.
  const handed = useRef(initial);
  useEffect(() => {
    const draft = handed.current ? inspectDraft(handed.current) : null;
    if (draft) recorder.change(draft);
  }, [recorder]);

  useRestore(history, restore, opened => {
    edited.current = false;
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
    if (opened.entry.kind === 'inspect') {
      const p = (opened.payload ?? {}) as Partial<InspectPayload>;
      setInspect(typeof p.input === 'string' ? p.input : '');
    } else {
      const p = readGeneratePayload(opened.payload);
      setType(p.type);
      setCountText(String(p.count ?? 1));
      setFormat(p.format);
      setUppercase(p.uppercase);
      setNamespace(p.namespace ?? 'dns');
      setCustom(p.customNamespace ?? '');
      setName(p.name ?? '');
      setFailure(null);
      if (isRandom(p.type)) {
        const bytes = p.ids.flatMap(id => {
          const parsed = parseId(id);
          return parsed.ok ? [parsed.value.bytes] : [];
        });
        setBatch({ type: p.type, bytes });
      }
    }
    setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
  });

  const random = isRandom(type);
  const ulid = type === 'ulid';
  const nsError = isNamed(type) && !nsBytes;

  return (
    <div className="flex flex-col gap-3">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <Card>
        <CardHeader>
          <CardTitle>Generate</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ToolOptions>
            <Label htmlFor="uuid-type" className="text-muted-foreground">
              Type
            </Label>
            <Select value={type} onValueChange={value => onType(value as GenerateType)}>
              <SelectTrigger id="uuid-type" className="min-w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map(t => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {random && (
              <>
                <Label htmlFor="uuid-count" className="ml-2 text-muted-foreground">
                  How many
                </Label>
                <Input
                  id="uuid-count"
                  className="w-24"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1000}
                  step={1}
                  spellCheck={false}
                  value={countText}
                  onChange={e => onCount(e.target.value)}
                  aria-invalid={count === null ? true : undefined}
                  aria-describedby={count === null ? 'uuid-count-error' : undefined}
                />
              </>
            )}
            <Label htmlFor="uuid-format" className="ml-2 text-muted-foreground">
              Format
            </Label>
            <Select
              value={format}
              disabled={ulid}
              onValueChange={value => {
                edit();
                setFormat(value as UuidFormat);
              }}>
              <SelectTrigger id="uuid-format" className="min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map(f => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-2 flex items-center gap-2">
              <Checkbox
                id="uuid-uppercase"
                checked={uppercase}
                disabled={ulid}
                onCheckedChange={checked => {
                  edit();
                  setUppercase(checked === true);
                }}
              />
              <Label htmlFor="uuid-uppercase" className="font-normal">
                Uppercase
              </Label>
            </div>
          </ToolOptions>
          {random && count === null && (
            <ToolMessage id="uuid-count-error" tone="error" role="status">
              {COUNT_ERROR}
            </ToolMessage>
          )}

          {isNamed(type) && (
            <div className="flex flex-col gap-1">
              <ToolOptions>
                <Label htmlFor="uuid-namespace" className="text-muted-foreground">
                  Namespace
                </Label>
                <Select
                  value={namespace}
                  onValueChange={value => {
                    edit();
                    setNamespace(value as Namespace);
                  }}>
                  <SelectTrigger id="uuid-namespace" className="min-w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NAMESPACE_IDS.map(n => (
                      <SelectItem key={n} value={n}>
                        {NAMESPACE_LABELS[n]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {namespace === 'custom' && (
                  <>
                    <Label htmlFor="uuid-custom" className="ml-2 text-muted-foreground">
                      Custom namespace
                    </Label>
                    <Input
                      id="uuid-custom"
                      className="w-96 max-w-full font-mono text-code"
                      spellCheck={false}
                      autoComplete="off"
                      value={custom}
                      onChange={e => {
                        edit();
                        setCustom(e.target.value);
                      }}
                      aria-invalid={nsError ? true : undefined}
                      aria-describedby={nsError ? 'uuid-namespace-error' : undefined}
                    />
                  </>
                )}
              </ToolOptions>
              {nsError && (
                <ToolMessage id="uuid-namespace-error" tone="error" role="status">
                  {NAMESPACE_ERROR}
                </ToolMessage>
              )}
              <div className="flex flex-col gap-1">
                <Label htmlFor="uuid-name">Name</Label>
                <Input
                  id="uuid-name"
                  placeholder="www.example.com"
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={MAX_NAME}
                  value={name}
                  onChange={e => {
                    edit();
                    setName(e.target.value);
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="cn-label">Result</span>
              <div className="flex items-center gap-2">
                {random && (
                  <Button onClick={onGenerate} disabled={count === null}>
                    Generate
                  </Button>
                )}
                <CopyButton
                  variant="outline"
                  value={result}
                  label={ids.length > 1 ? 'Copy all' : 'Copy'}
                  onCopied={() => void recorder.commit(generateDraft(payloadOf(ids)))}
                />
              </div>
            </div>
            <Textarea
              aria-label="Generated identifiers"
              className="min-h-0 resize-none font-mono text-code field-sizing-fixed"
              rows={Math.max(1, Math.min(ids.length, MAX_ROWS))}
              spellCheck={false}
              readOnly
              value={result}
            />
            {failure && <ToolMessage tone="error">{failure}</ToolMessage>}
            {type === 'v3' && <ToolMessage>UUID v5 is preferred over v3 (RFC 9562 §5.3).</ToolMessage>}
          </div>
        </CardContent>
      </Card>

      <Inspect value={inspect} onChange={onInspect} />
    </div>
  );
};

export default UuidTool;
