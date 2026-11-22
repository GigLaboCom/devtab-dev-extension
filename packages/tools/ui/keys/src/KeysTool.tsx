/**
 * The Key Pairs tool's page (docs/tools/specs/keys.md §8): Generate — a pair made by the browser's Web Crypto, only
 * when asked — and Inspect — a pasted key read as it is typed, completed and checked by Web Crypto (§5.6) —, then one
 * key at a time (parts.tsx). All logic is in @workspace/tool-logic-keys; the host draws the page frame.
 *
 * Private keys (§5.8) live only in this component's state: a generated pair until Clear, the next Generate or leaving
 * the page; a pasted one while it is in the field. They never reach the history (drafts are built from public material
 * only, entries.ts), the saved parameters (settings.ts holds choices), a log or the address. The automatic copy after
 * Generate copies the public key.
 *
 * History (D17): Generate commits `generated`; an edit of the field that reads keys is a `change` of `inspected`; every
 * Copy and Save of public material commits the shown entry again (the factory drops repeats). An entry opens in Inspect
 * with its public key.
 */
import { generatedDraft, inspectedDraft, readEntry } from './entries';
import { keysHistory } from './history';
import { KeyView, Note } from './parts';
import { keysSettings } from './settings';
import {
  ALGORITHM_LABELS,
  ALGORITHMS,
  completeKey,
  describe,
  fingerprints,
  generatePair,
  isPrivate,
  newCheckint,
  publicForms,
  publicText,
  readKeys,
  RSA_JWK_ALGS,
  RSA_SIZES,
  supported,
  UNSUPPORTED,
} from '@workspace/tool-logic-keys';
import {
  AUTO_COPY_REFUSED,
  announceGenerated,
  useAutoCopy,
  useRestore,
  useSavedSettings,
  useToolHistory,
} from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { Input } from '@workspace/ui/input';
import { InputField } from '@workspace/ui/input-field';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolEmpty, ToolMessage, ToolOptions, ToolPane } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeysSettings } from './settings';
import type {
  Algorithm,
  Fingerprints,
  PrivateForm,
  PublicForm,
  ReadItem,
  ReadKey,
  RsaJwkAlg,
  RsaSize,
} from '@workspace/tool-logic-keys';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

export const EMPTY_GENERATE = 'Choose an algorithm and press Generate. The private key stays in this page.';
export const EMPTY_INSPECT = 'Paste a public or private key: PEM, JWK, a JWK Set or an OpenSSH line.';
export const PLACEHOLDER = '-----BEGIN PUBLIC KEY-----, a JWK, or ssh-ed25519 AAAA…';
export const CANCEL_TITLE = 'The browser finishes the key; it is thrown away.';
export const STORAGE_FIRST = 'Everything runs in this tab; nothing is sent. Private keys are never kept.';
export const STORAGE_ON = "Public keys and fingerprints are kept in this browser's history.";
export const STORAGE_OFF = 'Nothing is kept (history is off).';

type Generated = { key: ReadKey; ms: number; checkint: number; fp: Fingerprints };
type Busy = { started: number };
/** The inspected keys of one input, completed by Web Crypto; `of` is the input they belong to. */
type Completed = { of: string; items: ReadItem[]; checkints: number[] };

const errorName = (error: unknown): string =>
  error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : 'Error';
const seconds = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

const KidOption = ({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }): ReactElement => (
  <div className="flex items-center gap-2">
    <Checkbox id="keys-kid" checked={checked} onCheckedChange={value => onChange(value === true)} />
    <Label htmlFor="keys-kid">Add kid (RFC 7638 thumbprint)</Label>
  </div>
);

const KeysTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const saved = useSavedSettings(host, 'keys', keysSettings, initial ? { opening: { mode: 'inspect' } } : {});
  const v = saved.values;
  const { history, recorder, status } = useToolHistory(host, 'keys', keysHistory);
  const autoCopy = useAutoCopy(host, 'keys');
  const [support, setSupport] = useState<Record<'Ed25519' | 'X25519', boolean> | null>(null);
  const [comment, setComment] = useState('');
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [now, setNow] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [input, setInput] = useState(initial ?? '');
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [selected, setSelected] = useState(0);
  const [prints, setPrints] = useState<{ of: ReadKey; fp: Fingerprints } | null>(null);
  const [shown, setShown] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [restored, setRestored] = useState<string | null>(null);
  const ticket = useRef(0);
  // An edit (or the start page's text) records a snapshot once its keys are read; an opened entry is not an edit.
  const origin = useRef<'edit' | 'restore'>('edit');
  const firstPrints = useRef<Fingerprints | null>(null);

  const mode = v.mode;
  const algorithm: Algorithm = v.algorithm;

  // §5.1: what this browser's Web Crypto has — tried, never assumed. A saved algorithm it has not falls back for the visit.
  const visit = saved.visit;
  const opening = useRef(algorithm);
  useEffect(() => {
    let live = true;
    void supported().then(s => {
      if (!live) return;
      setSupport(s);
      const chosen = opening.current;
      if ((chosen === 'Ed25519' && !s.Ed25519) || (chosen === 'X25519' && !s.X25519))
        visit({ algorithm: chosen === 'X25519' && s.Ed25519 ? 'Ed25519' : 'P-256' });
    });
    return () => {
      live = false;
    };
  }, [visit]);

  // Generating: the seconds tick (not a live region).
  useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy]);

  // Inspect: read at once (sync), complete with Web Crypto (async; an answer for an older input is dropped).
  const reading = useMemo(() => readKeys(input), [input]);
  useEffect(() => {
    let live = true;
    void Promise.all(reading.items.map(item => (item.ok ? completeKey(item.key) : Promise.resolve(item)))).then(
      done => {
        if (live) setCompleted({ of: input, items: done, checkints: done.map(() => newCheckint()) });
      },
    );
    return () => {
      live = false;
    };
  }, [reading, input]);
  const items = completed?.of === input ? completed.items : null;
  const index = items ? Math.min(selected, Math.max(items.length - 1, 0)) : 0;
  const current = items?.[index];
  const inspected = current?.ok ? current.key : null;
  const okKeys = useMemo(() => (items ?? []).flatMap(i => (i.ok ? [i.key] : [])), [items]);

  // Fingerprints of the key shown in Inspect.
  useEffect(() => {
    if (!inspected) return;
    let live = true;
    void fingerprints(inspected.data).then(fp => {
      if (live) setPrints({ of: inspected, fp });
    });
    return () => {
      live = false;
    };
  }, [inspected]);
  const inspectedPrints = prints && prints.of === inspected ? prints.fp : null;

  // The inspected keys, as the history keeps them: a snapshot after an edit, once the first key's fingerprint is known.
  useEffect(() => {
    if (okKeys.length === 0) return;
    let live = true;
    void fingerprints(okKeys[0]!.data).then(fp => {
      if (!live) return;
      firstPrints.current = fp;
      if (origin.current === 'edit') recorder.change(inspectedDraft(okKeys, fp));
    });
    return () => {
      live = false;
    };
  }, [okKeys, recorder]);

  const shownKey = mode === 'generate' ? (generated?.key ?? null) : inspected;
  const shownPrints = mode === 'generate' ? (generated?.fp ?? null) : inspectedPrints;
  const kid = v.addKid ? shownPrints?.thumbprint : undefined;

  const taken = (): void => {
    if (mode === 'generate' && generated)
      void recorder.commit(
        generatedDraft(generated.key, { algorithm, size: v.size, rsaAlg: v.rsaAlg, addKid: v.addKid }, generated.fp),
      );
    else if (mode === 'inspect' && okKeys.length > 0 && firstPrints.current)
      void recorder.commit(inspectedDraft(okKeys, firstPrints.current));
  };

  const set = (change: Partial<KeysSettings>): void => {
    saved.set(change);
    if (change.mode !== undefined) setShown(false);
  };

  const onGenerate = async (): Promise<void> => {
    const mine = ++ticket.current;
    const started = Date.now();
    setBusy({ started });
    setFailure(null);
    setRestored(null);
    setShown(false);
    setAnnouncement('Generating…');
    const options = { algorithm, size: v.size, rsaAlg: v.rsaAlg };
    try {
      const key = await generatePair(options);
      const ms = Date.now() - started;
      if (ticket.current !== mine) return;
      const c = comment.trim();
      if (c) key.comment = c;
      const fp = await fingerprints(key.data);
      if (ticket.current !== mine) return;
      setGenerated({ key, ms, checkint: newCheckint(), fp });
      setBusy(null);
      void recorder.commit(generatedDraft(key, { ...options, addKid: v.addKid }, fp));
      const label = algorithm === 'RSA' ? `RSA ${v.size}-bit` : ALGORITHM_LABELS[algorithm];
      const text = `New ${label} key pair generated`;
      const forms = publicForms(key.data);
      const form = forms.includes(v.publicForm as PublicForm) ? (v.publicForm as PublicForm) : forms[0]!;
      // The public key, as its Copy copies it — never the private key (§5.8).
      if (!autoCopy.on) setAnnouncement(text);
      else
        void autoCopy
          .afterGenerate(publicText(key, form, v.addKid ? fp.thumbprint : undefined))
          .then(o => setAnnouncement(announceGenerated(text, o)));
    } catch (error) {
      if (ticket.current !== mine) return;
      setBusy(null);
      setAnnouncement('');
      setFailure(`The browser could not generate the key: ${errorName(error)}.`);
    }
  };

  const cancel = (): void => {
    ticket.current++;
    setBusy(null);
    setAnnouncement('Cancelled.');
  };

  const clearGenerated = (): void => {
    ticket.current++;
    setBusy(null);
    setGenerated(null);
    setShown(false);
    setFailure(null);
  };

  const edit = (text: string): void => {
    origin.current = 'edit';
    setRestored(null);
    setSelected(0);
    setShown(false);
    setInput(text);
  };

  useRestore(history, restore, opened => {
    if (!opened.ok) {
      setRestored(
        opened.reason === 'newer-schema'
          ? 'This entry was kept by a newer version of the tool.'
          : 'This entry could not be opened.',
      );
      return;
    }
    const entry = readEntry(opened.entry.kind, opened.payload);
    if (!entry) {
      setRestored('This entry could not be opened.');
      return;
    }
    origin.current = 'restore';
    saved.visit({
      mode: 'inspect',
      ...(entry.generated
        ? {
            algorithm: entry.generated.algorithm,
            ...(entry.generated.size ? { size: entry.generated.size } : {}),
            ...(entry.generated.rsaAlg ? { rsaAlg: entry.generated.rsaAlg } : {}),
          }
        : {}),
    });
    setSelected(0);
    setShown(false);
    setInput(entry.publicText);
    setRestored(`Opened from History: ${opened.label ?? 'an entry'}. Only the public key was kept.`);
  });

  const unsupported = support ? (['Ed25519', 'X25519'] as const).filter(a => !support[a]) : [];
  const elapsed = busy ? Math.max(0, Math.floor((now - busy.started) / 1000)) : 0;
  const errors: string[] = [
    ...(reading.message ? [reading.message] : []),
    ...(items && items.length > 1
      ? items.flatMap((item, i) => (item.ok ? [] : [`Key ${i + 1}: ${item.message}`]))
      : items?.[0] && !items[0].ok
        ? [items[0].message]
        : []),
  ];
  const storage = `${STORAGE_FIRST} ${status.gate === 'on' ? STORAGE_ON : STORAGE_OFF}`;

  return (
    <div className="flex flex-col gap-3">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Mode"
          value={mode}
          onValueChange={next => next && set({ mode: next as 'generate' | 'inspect' })}>
          <ToggleGroupItem value="generate">Generate</ToggleGroupItem>
          <ToggleGroupItem value="inspect">Inspect</ToggleGroupItem>
        </ToggleGroup>
      </ToolOptions>

      {mode === 'generate' ? (
        <div className="flex flex-col gap-2" data-generate>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="keys-algorithm">Algorithm</Label>
              <Select value={algorithm} onValueChange={next => set({ algorithm: next as Algorithm })}>
                <SelectTrigger id="keys-algorithm" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALGORITHMS.map(a => {
                    const missing = (a === 'Ed25519' || a === 'X25519') && support !== null && !support[a];
                    return (
                      <SelectItem key={a} value={a} disabled={missing}>
                        {`${ALGORITHM_LABELS[a]}${missing ? ' — not in this browser' : ''}`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            {algorithm === 'RSA' && (
              <>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Size</span>
                  <ToggleGroup
                    type="single"
                    variant="segmented"
                    aria-label="Size"
                    value={String(v.size)}
                    onValueChange={next => next && set({ size: Number(next) as RsaSize })}>
                    {RSA_SIZES.map(s => (
                      <ToggleGroupItem key={s} value={String(s)}>
                        {s}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="keys-rsa-alg">JWK algorithm</Label>
                  <Select value={v.rsaAlg} onValueChange={next => set({ rsaAlg: next as RsaJwkAlg })}>
                    <SelectTrigger id="keys-rsa-alg" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RSA_JWK_ALGS.map(a => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {algorithm !== 'X25519' && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="keys-comment">Comment</Label>
                <Input
                  id="keys-comment"
                  className="w-56"
                  placeholder="user@host"
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={256}
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                />
              </div>
            )}
          </div>
          {unsupported.map(a => (
            <Note key={a}>{UNSUPPORTED[a]}</Note>
          ))}
          <KidOption checked={v.addKid} onChange={addKid => set({ addKid })} />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void onGenerate()} disabled={busy !== null} data-generate-button>
              Generate
            </Button>
            <Button variant="ghost" onClick={clearGenerated} disabled={!generated && !busy}>
              Clear
            </Button>
            {busy && (
              <>
                <span className="text-sm text-muted-foreground" data-busy>
                  {elapsed > 0 ? `Generating… ${elapsed} s` : 'Generating…'}
                </span>
                <Button variant="outline" size="sm" onClick={cancel} title={CANCEL_TITLE}>
                  Cancel
                </Button>
              </>
            )}
          </div>
          {failure && (
            <ToolMessage tone="error" data-failure>
              {failure}
            </ToolMessage>
          )}
          {autoCopy.outcome?.ok === false && generated && (
            <ToolMessage role={undefined}>{AUTO_COPY_REFUSED}</ToolMessage>
          )}
          {!generated && !busy && !failure && <ToolEmpty>{EMPTY_GENERATE}</ToolEmpty>}
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-inspect>
          <ToolPane
            label="Key"
            htmlFor="keys-input"
            actions={
              <Button variant="ghost" size="sm" onClick={() => edit('')} disabled={input === ''}>
                Clear
              </Button>
            }>
            <InputField
              id="keys-input"
              className="max-h-72 min-h-32 resize-y font-mono text-code break-all"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              placeholder={PLACEHOLDER}
              value={input}
              onValueChange={edit}
              aria-describedby={errors.length + reading.notes.length > 0 ? 'keys-messages' : undefined}
            />
            {/* Changes while typing: a polite status, not an alert per keystroke (the recipe). */}
            <div id="keys-messages" className="flex flex-col gap-1">
              {errors.map(m => (
                <ToolMessage key={m} tone="error" role="status" data-message="error">
                  {m}
                </ToolMessage>
              ))}
              {reading.notes.map(n => (
                <ToolMessage key={n} tone="note" data-message="note">
                  {n}
                </ToolMessage>
              ))}
            </div>
          </ToolPane>
          <KidOption checked={v.addKid} onChange={addKid => set({ addKid })} />
          {input.trim() === '' && <ToolEmpty>{EMPTY_INSPECT}</ToolEmpty>}
          {items && items.length >= 2 && (
            <div className="flex flex-wrap items-center gap-3" data-key-switch>
              <ToggleGroup
                type="single"
                variant="segmented"
                size="sm"
                aria-label="Shown key"
                value={String(index + 1)}
                onValueChange={next => {
                  if (!next) return;
                  setSelected(Number(next) - 1);
                  setShown(false);
                }}>
                {items.map((_, i) => (
                  <ToggleGroupItem key={i} value={String(i + 1)} aria-label={`Key ${i + 1}`}>
                    {i + 1}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <span className="text-sm text-muted-foreground">{`${items.length} keys`}</span>
            </div>
          )}
        </div>
      )}

      {shownKey && (
        <KeyView
          keyRead={shownKey}
          summary={describe(shownKey)}
          detail={mode === 'generate' && generated ? `Generated in ${seconds(generated.ms)}` : undefined}
          fingerprints={shownPrints}
          kid={kid}
          publicForm={v.publicForm as PublicForm}
          privateForm={v.privateForm as PrivateForm}
          onPublicForm={publicForm => set({ publicForm })}
          onPrivateForm={privateForm => set({ privateForm })}
          checkint={mode === 'generate' ? (generated?.checkint ?? 0) : (completed?.checkints[index] ?? 0)}
          shown={shown && isPrivate(shownKey.data)}
          onShown={setShown}
          onTaken={taken}
          autoCopied={mode === 'generate' ? autoCopy.outcome : null}
        />
      )}

      <p className="m-0 text-sm text-muted-foreground" data-storage>
        {storage}
      </p>
      <div className="sr-only" aria-live="polite" data-announcement>
        {announcement}
      </div>
    </div>
  );
};

export default KeysTool;
