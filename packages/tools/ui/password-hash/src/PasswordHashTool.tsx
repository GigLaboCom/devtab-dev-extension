/**
 * The Password Hash tool's page (docs/tools/specs/password-hash.md §8): Hash — a password, an algorithm, its parameters
 * and a salt into the encoded string programs store; Verify — a password against such a string, with what was read from
 * it and a warning when it is below today's recommendations. The work runs in a module worker per press (runner.ts);
 * the page only reads and checks fields. The host wraps it in the kit's ToolPage; this is the body.
 *
 * History (D17): two secret kinds — the host keeps them only encrypted, with a master password and the history
 * unlocked. A finished Hash or Verify and a Copy are a `commit`; editing a field records nothing (there is no result
 * until the button is pressed). The password is never part of a record, of the address, of the console or of a store.
 */
import { FIELD_NAMES, hashedLabel, readHashed, readVerified, verifiedLabel } from './entries';
import { passwordHashHistory } from './history';
import { runInWorker } from './runner';
import {
  ALGORITHM_NAMES,
  assess,
  checkParams,
  costLine,
  describe,
  FORMAT_NAMES,
  formatNumber,
  formatsOf,
  HASH_ALGORITHMS,
  LIMITS,
  parseHash,
  passwordNotes,
  RECOMMENDATION_LINES,
  RECOMMENDED,
  resolveSalt,
  sameParams,
  SECRET_NOTE,
  SECRET_UNKNOWN,
  secretError,
  TEXT_SALT_FORMATS,
  utf8,
} from '@workspace/tool-logic-password-hash';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { ResultRow, ResultRows } from '@workspace/ui/result-row';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions } from '@workspace/ui/tool-page';
import { cn } from '@workspace/ui/utils';
import { CircleCheckIcon, CircleXIcon, EyeIcon, EyeOffIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldName, Fields, HashedPayload, SaltPayload, VerifiedPayload } from './entries';
import type { Algorithm, Format, ParamField, Params, SaltFormat } from '@workspace/tool-logic-password-hash';
import type { HistoryDraft, RecordingStatus, ToolProps } from '@workspace/tools-host';
import type { ReactElement, ReactNode } from 'react';

type Mode = 'hash' | 'verify';

/** Where the work is. */
type Run =
  | { state: 'idle' }
  | { state: 'running'; op: Mode; seconds: number }
  | { state: 'hashed'; encoded: string; summary: string }
  | { state: 'verified'; match: boolean }
  | { state: 'cancelled' }
  | { state: 'failed'; message: string };

const SALT_FORMATS: Array<{ value: SaltFormat; label: string }> = [
  { value: 'text', label: 'Text (UTF-8)' },
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
];

/** The fields of an algorithm's parameters, as strings (what the number inputs hold). */
const fieldsOf = (params: Params, base?: Fields): Fields => {
  const out: Fields = base ? { ...base } : (Object.fromEntries(FIELD_NAMES.map(n => [n, ''])) as Fields);
  switch (params.algorithm) {
    case 'argon2id':
    case 'argon2i':
    case 'argon2d':
      return {
        ...out,
        memory: String(params.memory),
        iterations: String(params.iterations),
        parallelism: String(params.parallelism),
      };
    case 'bcrypt':
      return { ...out, cost: String(params.cost) };
    case 'scrypt':
      return { ...out, logN: String(params.logN), r: String(params.r), p: String(params.p) };
    default:
      return { ...out, pbkdf2: String(params.iterations) };
  }
};

/** A whole number as typed: digits only (`1e3`, `+5`, `1.5` and an empty field are not). */
const whole = (text: string): number => (/^\d{1,12}$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

const paramsOf = (algorithm: Algorithm, f: Fields): Params => {
  switch (algorithm) {
    case 'argon2id':
    case 'argon2i':
    case 'argon2d':
      return { algorithm, memory: whole(f.memory), iterations: whole(f.iterations), parallelism: whole(f.parallelism) };
    case 'bcrypt':
      return { algorithm, cost: whole(f.cost) };
    case 'scrypt':
      return { algorithm, logN: whole(f.logN), r: whole(f.r), p: whole(f.p) };
    default:
      return { algorithm, iterations: whole(f.pbkdf2) };
  }
};

/** Which input holds a parameter of `checkParams` (PBKDF2's iterations are a field of their own). */
const inputOf = (algorithm: Algorithm, field: ParamField): FieldName =>
  field === 'iterations' && algorithm.startsWith('pbkdf2') ? 'pbkdf2' : field;

interface FieldSpec {
  name: FieldName;
  label: string;
  min: number;
  max: number;
}
const FIELDS_OF = (algorithm: Algorithm): FieldSpec[] => {
  const A = LIMITS.argon2;
  const S = LIMITS.scrypt;
  switch (algorithm) {
    case 'argon2id':
    case 'argon2i':
    case 'argon2d':
      return [
        { name: 'memory', label: 'Memory (KiB)', min: A.memory.min, max: A.memory.max },
        { name: 'iterations', label: 'Iterations', min: A.iterations.min, max: A.iterations.max },
        { name: 'parallelism', label: 'Parallelism', min: A.parallelism.min, max: A.parallelism.max },
      ];
    case 'bcrypt':
      return [{ name: 'cost', label: 'Cost', min: LIMITS.bcrypt.cost.min, max: LIMITS.bcrypt.cost.max }];
    case 'scrypt':
      return [
        { name: 'logN', label: 'Cost (log2 N)', min: S.logN.min, max: S.logN.max },
        { name: 'r', label: 'Block size (r)', min: S.r.min, max: S.r.max },
        { name: 'p', label: 'Parallelism (p)', min: S.p.min, max: S.p.max },
      ];
    default:
      return [
        { name: 'pbkdf2', label: 'Iterations', min: LIMITS.pbkdf2.iterations.min, max: LIMITS.pbkdf2.iterations.max },
      ];
  }
};

const userError = (user: string): string | null => {
  if (user === '') return 'Enter a user name.';
  if (/[:\r\n]/.test(user)) return 'The user name cannot contain ":" or a line break.';
  if (utf8(user).length > 255) return 'The user name is longer than 255 bytes.';
  return null;
};

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

const summaryParams = (p: Params): string => {
  switch (p.algorithm) {
    case 'argon2id':
    case 'argon2i':
    case 'argon2d':
      return `m=${p.memory} KiB, t=${p.iterations}, p=${p.parallelism}`;
    case 'bcrypt':
      return `cost ${p.cost}`;
    case 'scrypt':
      return `N=2^${p.logN}, r=${p.r}, p=${p.p}`;
    default:
      return `${formatNumber(p.iterations)} iterations`;
  }
};

/** What the history keeps now, said plainly, after what is always true (§8.6). */
const keptLine = (status: RecordingStatus): string =>
  `Everything runs in this tab; nothing is sent. The password is never kept. ${
    status.gate !== 'on'
      ? 'Hashes are not kept (history is off).'
      : status.secrets === 'unlocked'
        ? 'The hashes you make or check are kept encrypted in this browser.'
        : status.secrets === 'locked'
          ? 'Hashes are not kept while the history is locked.'
          : 'Hashes are not kept (no master password).'
  }`;

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

const Warning = ({ children }: { children: ReactNode }): ReactElement => (
  <ToolMessage data-warning>
    <span className="flex items-start gap-1.5">
      <TriangleAlertIcon aria-hidden="true" className="text-warning mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </span>
  </ToolMessage>
);

const PasswordHashTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [mode, setMode] = useState<Mode>(initial ? 'verify' : 'hash');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  /** Argon2's secret key (pepper): never recorded, never in the address or a store (§5.10). */
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [algorithm, setAlgorithm] = useState<Algorithm>('argon2id');
  const [fields, setFields] = useState<Fields>(() => fieldsOf(RECOMMENDED.argon2id));
  const [format, setFormat] = useState<Format>('phc');
  const [user, setUser] = useState('');
  const [saltMode, setSaltMode] = useState<'random' | 'custom'>('random');
  const [saltText, setSaltText] = useState('');
  const [saltFormat, setSaltFormat] = useState<SaltFormat>('hex');
  const [hashText, setHashText] = useState(initial?.trim() ?? '');
  const [run, setRun] = useState<Run>({ state: 'idle' });
  const [restored, setRestored] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const { history, recorder, status } = useToolHistory(host, 'password-hash', passwordHashHistory);
  const controller = useRef<AbortController | null>(null);
  /** Every press gets a number; the answer of an older one is dropped. */
  const generation = useRef(0);
  /** The record of the last result, committed again on Copy (the host does not write a repeat). */
  const lastDraft = useRef<HistoryDraft | null>(null);

  const params = useMemo(() => paramsOf(algorithm, fields), [algorithm, fields]);
  const paramErrors = useMemo(() => checkParams(params), [params]);
  const errorOf = (name: FieldName): string | undefined =>
    paramErrors.find(e => inputOf(algorithm, e.field) === name)?.message;
  const textSalt = TEXT_SALT_FORMATS.has(format);
  const customSalt = useMemo(
    () =>
      saltMode === 'custom'
        ? resolveSalt({ mode: 'custom', text: saltText, format: textSalt ? 'text' : saltFormat }, algorithm, format)
        : null,
    [saltMode, saltText, saltFormat, textSalt, algorithm, format],
  );
  const parsed = useMemo(() => parseHash(hashText), [hashText]);
  const verifyLimits = parsed.ok ? checkParams(parsed.hash.params) : [];
  const notesFor: Algorithm | null = mode === 'hash' ? algorithm : parsed.ok ? parsed.hash.params.algorithm : null;
  const notes = notesFor ? passwordNotes(password, notesFor) : passwordNotes(password, 'argon2id');
  const userProblem = mode === 'hash' && format === 'htpasswd' ? userError(user) : null;
  /** Is the secret key field shown and used: Argon2 in Hash, an Argon2 string in Verify. */
  const keyed = notesFor !== null && notesFor.startsWith('argon2');
  const secretProblem = keyed ? secretError(secret) : undefined;
  const usedSecret = keyed && secret !== '' ? secret : undefined;

  const canHash =
    password !== '' &&
    !notes.error &&
    paramErrors.length === 0 &&
    (customSalt === null || customSalt.ok) &&
    !userProblem &&
    !secretProblem;
  const canVerify = password !== '' && !notes.error && parsed.ok && verifyLimits.length === 0 && !secretProblem;
  const running = run.state === 'running';

  // The seconds of a running piece of work, once a second (the page says it is working, §8).
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setRun(r => (r.state === 'running' ? { ...r, seconds: r.seconds + 1 } : r)), 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => () => controller.current?.abort(), []);

  /** A person's edit: any running work stops (its result would not match the fields) and the result goes. */
  const edit = (apply: () => void): void => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    lastDraft.current = null;
    setRestored(null);
    setRun({ state: 'idle' });
    setAnnouncement('');
    apply();
  };

  const chooseAlgorithm = (next: Algorithm): void =>
    edit(() => {
      setAlgorithm(next);
      // The secret key belongs to Argon2 only: leaving it lets it go.
      if (!next.startsWith('argon2')) setSecret('');
      setFields(f => fieldsOf(RECOMMENDED[next], f));
      setFormat(formatsOf(next)[0]!);
    });

  const start = (op: Mode): void => {
    if (op === 'hash' ? !canHash : !canVerify) return;
    const mine = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setRestored(null);
    setAnnouncement(op === 'hash' ? 'Hashing…' : 'Verifying…');
    setRun({ state: 'running', op, seconds: 0 });
    const settle = (next: Run, said: string, draft?: HistoryDraft): void => {
      if (generation.current !== mine) return;
      controller.current = null;
      setRun(next);
      setAnnouncement(said);
      if (draft) {
        lastDraft.current = draft;
        void recorder.commit(draft);
      }
    };
    const fail = (error: unknown): void => {
      if (!isAbort(error)) settle({ state: 'failed', message: 'The hash could not be computed.' }, '');
    };
    if (op === 'verify') {
      if (!parsed.ok) return;
      const hashParams = parsed.hash.params;
      const verifyWithKey = usedSecret !== undefined;
      runInWorker(
        { op: 'verify', password, hash: hashText, ...(usedSecret !== undefined ? { secret: usedSecret } : {}) },
        abort.signal,
      ).then(reply => {
        if (!reply.ok || reply.op !== 'verify')
          return settle({ state: 'failed', message: reply.ok ? '' : reply.message }, '');
        const payload: VerifiedPayload = { hash: hashText.trim(), match: reply.match, keyed: verifyWithKey };
        settle({ state: 'verified', match: reply.match }, reply.match ? 'Matches.' : 'Does not match.', {
          kind: 'verified',
          payload: { ...payload },
          label: verifiedLabel(hashParams, reply.match),
        });
      }, fail);
      return;
    }
    const salt =
      saltMode === 'custom' && customSalt?.ok ? customSalt : resolveSalt({ mode: 'random' }, algorithm, format);
    if (!salt.ok) return;
    const hashParams = params;
    const saltWords = `${saltMode === 'random' ? 'random' : 'your'} ${formatNumber(salt.salt.length)}-${textSalt ? 'character' : 'byte'} salt`;
    runInWorker(
      {
        op: 'hash',
        request: {
          password,
          params: hashParams,
          format,
          salt: salt.salt,
          ...(salt.text !== undefined ? { saltText: salt.text } : {}),
          ...(format === 'htpasswd' ? { user } : {}),
          ...(usedSecret !== undefined ? { secret: usedSecret } : {}),
        },
      },
      abort.signal,
    ).then(reply => {
      if (!reply.ok || reply.op !== 'hash')
        return settle({ state: 'failed', message: reply.ok ? '' : reply.message }, '');
      const saltPayload: SaltPayload =
        saltMode === 'custom'
          ? { mode: 'custom', text: saltText, format: textSalt ? 'text' : saltFormat }
          : { mode: 'random' };
      const payload: HashedPayload = {
        algorithm,
        fields: fieldsOf(hashParams),
        format,
        ...(format === 'htpasswd' ? { user } : {}),
        salt: saltPayload,
        encoded: reply.encoded,
        keyed: usedSecret !== undefined,
      };
      settle(
        {
          state: 'hashed',
          encoded: reply.encoded,
          summary: `${ALGORITHM_NAMES[algorithm]} · ${summaryParams(hashParams)} · ${saltWords}${usedSecret !== undefined ? ' · with a secret key' : ''} · ${seconds(reply.ms)}`,
        },
        'Hash ready.',
        { kind: 'hashed', payload: { ...payload }, label: hashedLabel(hashParams) },
      );
    }, fail);
  };

  const cancel = (): void => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setRun({ state: 'cancelled' });
    setAnnouncement('Cancelled.');
  };

  useRestore(history, restore, opened => {
    generation.current++;
    controller.current?.abort();
    setPassword('');
    setSecret('');
    setAnnouncement('');
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
    const said = (keyedEntry: boolean): string =>
      `Opened from History: ${opened.label ?? 'an entry'}. The password is never kept: type it again.${
        keyedEntry ? ' It was made with a secret key, which is never kept either.' : ''
      }`;
    if (opened.entry.kind === 'verified') {
      const v = readVerified(opened.payload);
      if (!v) return setRestored('This entry could not be opened.');
      setMode('verify');
      setHashText(v.hash);
      setRun({ state: 'idle' });
      setRestored(said(v.keyed));
      return;
    }
    const h = readHashed(opened.payload);
    if (!h) return setRestored('This entry could not be opened.');
    setMode('hash');
    setAlgorithm(h.algorithm);
    setFields(h.fields);
    setFormat(h.format);
    setUser(h.user ?? '');
    setSaltMode(h.salt.mode);
    if (h.salt.mode === 'custom') {
      setSaltText(h.salt.text);
      setSaltFormat(h.salt.format);
    }
    setRun({ state: 'hashed', encoded: h.encoded, summary: '' });
    setRestored(said(h.keyed));
  });

  const formats = formatsOf(algorithm);
  const weaknesses = mode === 'hash' && paramErrors.length === 0 ? assess(params) : [];
  const verifyWeaknesses = parsed.ok ? assess(parsed.hash.params, parsed.hash.salt.length) : [];
  const busyWord = run.state === 'running' ? (run.op === 'hash' ? 'Hashing…' : 'Verifying…') : '';

  const numberField = (spec: FieldSpec): ReactElement => {
    const error = errorOf(spec.name);
    const id = `password-hash-${spec.name}`;
    return (
      <div key={spec.name} className="flex flex-col gap-1">
        <Label htmlFor={id}>{spec.label}</Label>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          className="w-36 font-mono"
          min={spec.min}
          max={spec.max}
          step={1}
          value={fields[spec.name]}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={e => {
            const value = e.target.value;
            edit(() => setFields(f => ({ ...f, [spec.name]: value })));
          }}
          onKeyDown={e => e.key === 'Enter' && start('hash')}
        />
        {error && (
          <ToolMessage tone="error" role="status" id={`${id}-error`} data-field={spec.name}>
            {error}
          </ToolMessage>
        )}
      </div>
    );
  };

  const working = running ? (
    <span className="flex items-center gap-2" data-working>
      <span>{run.seconds === 0 ? busyWord : `${busyWord} ${run.seconds} s`}</span>
      <Button type="button" variant="outline" size="sm" onClick={cancel}>
        Cancel
      </Button>
    </span>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          aria-label="Mode"
          value={mode}
          onValueChange={value => value && edit(() => setMode(value as Mode))}>
          <ToggleGroupItem value="hash">Hash</ToggleGroupItem>
          <ToggleGroupItem value="verify">Verify</ToggleGroupItem>
        </ToggleGroup>
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      <div className="flex flex-col gap-1">
        <Label htmlFor="password-hash-password">Password</Label>
        <div className="flex items-center gap-1">
          <Input
            id="password-hash-password"
            className="w-96 max-w-full font-mono"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={password}
            aria-describedby="password-hash-password-notes"
            aria-invalid={notes.error ? true : undefined}
            onChange={e => {
              const value = e.target.value;
              edit(() => setPassword(value));
            }}
            onKeyDown={e => e.key === 'Enter' && start(mode)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Show password"
            title={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            onClick={() => setShow(s => !s)}>
            {show ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
          </Button>
        </div>
        <div id="password-hash-password-notes" data-field="password">
          {notes.error ? (
            <ToolMessage tone="error" role="status">
              {notes.error}
            </ToolMessage>
          ) : (
            notes.notes.map(n => <ToolMessage key={n}>{n}</ToolMessage>)
          )}
        </div>
      </div>

      {keyed && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="password-hash-secret">Secret key (pepper)</Label>
          <div className="flex items-center gap-1">
            <Input
              id="password-hash-secret"
              className="w-96 max-w-full font-mono"
              type={showSecret ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Optional"
              value={secret}
              aria-describedby="password-hash-secret-notes"
              aria-invalid={secretProblem ? true : undefined}
              onChange={e => {
                const value = e.target.value;
                edit(() => setSecret(value));
              }}
              onKeyDown={e => e.key === 'Enter' && start(mode)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Show secret key"
              title={showSecret ? 'Hide secret key' : 'Show secret key'}
              aria-pressed={showSecret}
              onClick={() => setShowSecret(s => !s)}>
              {showSecret ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
            </Button>
          </div>
          <div id="password-hash-secret-notes" data-field="secret">
            {secretProblem ? (
              <ToolMessage tone="error" role="status">
                {secretProblem}
              </ToolMessage>
            ) : secret !== '' ? (
              <ToolMessage>{SECRET_NOTE}</ToolMessage>
            ) : null}
          </div>
        </div>
      )}

      {mode === 'hash' ? (
        <div className="flex flex-col gap-3" data-mode="hash">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="password-hash-algorithm">Algorithm</Label>
              <Select value={algorithm} onValueChange={v => chooseAlgorithm(v as Algorithm)}>
                <SelectTrigger id="password-hash-algorithm" className="min-w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HASH_ALGORITHMS.map(a => (
                    <SelectItem key={a} value={a}>
                      {ALGORITHM_NAMES[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {FIELDS_OF(algorithm).map(numberField)}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground text-sm" data-cost>
              {costLine(params)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sameParams(params, RECOMMENDED[algorithm])}
              onClick={() => edit(() => setFields(f => fieldsOf(RECOMMENDED[algorithm], f)))}>
              Use recommended
            </Button>
          </div>
          <p className="text-muted-foreground m-0 text-sm" data-recommendation>
            {RECOMMENDATION_LINES[algorithm]}
          </p>
          {weaknesses.map(w => (
            <Warning key={w.message}>{w.message}</Warning>
          ))}

          <div className="flex flex-wrap items-start gap-3">
            {formats.length > 1 && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="password-hash-format">Format</Label>
                <Select value={format} onValueChange={v => edit(() => setFormat(v as Format))}>
                  <SelectTrigger id="password-hash-format" className="min-w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {formats.map(f => (
                      <SelectItem key={f} value={f}>
                        {FORMAT_NAMES[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {format === 'htpasswd' && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="password-hash-user">User</Label>
                <Input
                  id="password-hash-user"
                  className="w-48"
                  autoComplete="off"
                  spellCheck={false}
                  value={user}
                  aria-invalid={userProblem && user !== '' ? true : undefined}
                  onChange={e => {
                    const value = e.target.value;
                    edit(() => setUser(value));
                  }}
                  onKeyDown={e => e.key === 'Enter' && start('hash')}
                />
                {userProblem && user !== '' && (
                  <ToolMessage tone="error" role="status" data-field="user">
                    {userProblem}
                  </ToolMessage>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Salt</span>
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  type="single"
                  variant="segmented"
                  size="sm"
                  aria-label="Salt source"
                  value={saltMode}
                  onValueChange={value => value && edit(() => setSaltMode(value as 'random' | 'custom'))}>
                  <ToggleGroupItem value="random">Random</ToggleGroupItem>
                  <ToggleGroupItem value="custom">Custom</ToggleGroupItem>
                </ToggleGroup>
                {saltMode === 'custom' && (
                  <>
                    <Input
                      aria-label="Salt"
                      className="w-64 font-mono"
                      autoComplete="off"
                      spellCheck={false}
                      value={saltText}
                      onChange={e => {
                        const value = e.target.value;
                        edit(() => setSaltText(value));
                      }}
                    />
                    {!textSalt && (
                      <Select value={saltFormat} onValueChange={v => edit(() => setSaltFormat(v as SaltFormat))}>
                        <SelectTrigger aria-label="Salt format" className="min-w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SALT_FORMATS.map(f => (
                            <SelectItem key={f.value} value={f.value}>
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </>
                )}
              </div>
              {customSalt && !customSalt.ok && saltText !== '' && (
                <ToolMessage tone="error" role="status" data-field="salt">
                  {customSalt.message}
                </ToolMessage>
              )}
              {customSalt?.ok && customSalt.warning && <Warning>{customSalt.warning}</Warning>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={!canHash || running} onClick={() => start('hash')}>
              Hash
            </Button>
            {working}
          </div>

          {run.state === 'hashed' && (
            <div className="flex flex-col gap-1" data-result>
              <ResultRows>
                <ResultRow
                  label={format === 'htpasswd' ? 'Line' : 'Hash'}
                  value={run.encoded}
                  copyLabel={format === 'htpasswd' ? 'Copy line' : 'Copy hash'}
                  copy={{ onCopied: () => lastDraft.current && void recorder.commit(lastDraft.current) }}
                />
              </ResultRows>
              {run.summary && (
                <p className="text-muted-foreground m-0 text-sm" data-summary>
                  {run.summary}
                </p>
              )}
            </div>
          )}
          {password === '' && run.state === 'idle' && !restored && (
            <p className="text-muted-foreground m-0 text-sm">Type a password, choose the algorithm and press Hash.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-mode="verify">
          <div className="flex flex-col gap-1">
            <Label htmlFor="password-hash-hash">Hash</Label>
            <Input
              id="password-hash-hash"
              className="font-mono"
              placeholder="$2b$10$… or $argon2id$v=19$…"
              autoComplete="off"
              spellCheck={false}
              value={hashText}
              onChange={e => {
                const value = e.target.value;
                edit(() => setHashText(value));
              }}
              onKeyDown={e => e.key === 'Enter' && start('verify')}
            />
            {!parsed.ok &&
              (parsed.empty ? (
                <ToolMessage>{parsed.message}</ToolMessage>
              ) : (
                <ToolMessage tone="error" role="status" data-field="hash">
                  {parsed.message}
                </ToolMessage>
              ))}
          </div>
          {parsed.ok && (
            <dl
              aria-label="Read from the hash"
              className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
              {describe(parsed.hash).map(row => (
                <div key={row.name} className="contents">
                  <dt className="text-muted-foreground text-sm">{row.name}</dt>
                  <dd className="m-0 font-mono text-code break-all text-foreground" data-row={row.name}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {verifyLimits.length > 0 && (
            <ToolMessage tone="error" role="status" data-field="limits">
              {`This hash is beyond the tool's limits: ${verifyLimits[0]!.message}`}
            </ToolMessage>
          )}
          {verifyWeaknesses.map(w => (
            <Warning key={w.message}>{w.message}</Warning>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={!canVerify || running} onClick={() => start('verify')}>
              Verify
            </Button>
            {working}
          </div>
          {run.state === 'verified' && (
            <p
              className={cn(
                'm-0 flex items-center gap-1.5 font-medium',
                run.match ? 'text-success' : 'text-destructive',
              )}
              data-verdict={run.match ? 'match' : 'no-match'}>
              {run.match ? (
                <CircleCheckIcon aria-hidden="true" className="size-4" />
              ) : (
                <CircleXIcon aria-hidden="true" className="size-4" />
              )}
              {run.match
                ? 'Matches: this password gives this hash.'
                : 'Does not match: this password gives a different hash.'}
            </p>
          )}
          {run.state === 'verified' && !run.match && keyed && (
            <ToolMessage role={undefined} data-secret-unknown>
              {SECRET_UNKNOWN}
            </ToolMessage>
          )}
        </div>
      )}

      {/* The live region below has said it: no second announcement. */}
      {run.state === 'cancelled' && <ToolMessage role={undefined}>Cancelled.</ToolMessage>}
      {run.state === 'failed' && (
        <ToolMessage tone="error">{run.message || 'The hash could not be computed.'}</ToolMessage>
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <p className="text-muted-foreground m-0 text-sm" data-kept>
        {keptLine(status)}
      </p>
    </div>
  );
};

export default PasswordHashTool;
