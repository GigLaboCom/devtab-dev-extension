/**
 * The JWT tool's page (docs/tools/specs/jwt.md §8): the token, the signature status, the key the algorithm needs, the
 * times status, the header and the payload with the claims, the signature. Decoding and checking run as the person
 * types (no Verify button); a check WebCrypto has to answer shows "Checking signature…" until it does, and an answer
 * for an older token or key is dropped. All logic is in @workspace/tool-logic-jwt.
 *
 * History (D17): two secret kinds through the host — `decoded` (a token) and `checked` (a token with the key typed for
 * it). An edit is a `change` once its result is known; a Copy is a `commit`. The history keeps them only encrypted,
 * with a master password set and unlocked; the hint says which applies now. An entry opened from History brings the
 * token and the key back and records nothing. The page frame (title, summary, the history line) is the host's.
 */
import { jwtHistory } from './history';
import { Caption, ClaimsTable, PartView, SignatureStatus, TimeStatusLine, partText } from './parts';
import { draftOf, readPayload, readSignedPayload } from './payload';
import { DEFAULT_SEED, SignView } from './SignView';
import {
  MAX_TOKEN,
  TOO_LARGE,
  algorithmName,
  decodeToken,
  keyFieldOf,
  parseKey,
  verificationWithoutCrypto,
  verifyToken,
} from '@workspace/tool-logic-jwt';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolEmpty, ToolMessage, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Shown } from './parts';
import type { JwtPayload, KeyField } from './payload';
import type { SignSeed } from './SignView';
import type { Decoded, ParsedKey, SecretFormat, Verification } from '@workspace/tool-logic-jwt';
import type { RecordingStatus, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const FORMATS: Array<{ value: SecretFormat; label: string }> = [
  { value: 'text', label: 'Text (UTF-8)' },
  { value: 'base64', label: 'Base64' },
  { value: 'hex', label: 'Hex' },
  { value: 'jwk', label: 'JWK' },
];

/**
 * What the hint says about keeping tokens and keys, in the words of the host's history line for secrets (§8 said
 * "Nothing is sent or stored" before D17; now that depends on the history and its master password).
 */
const keptSentence = (status: RecordingStatus): string =>
  status.gate !== 'on'
    ? 'They are not kept (history is off).'
    : status.secrets === 'unlocked'
      ? 'They are kept encrypted in this browser.'
      : status.secrets === 'locked'
        ? 'They are not kept while the history is locked.'
        : 'They are not kept (no master password).';

type Origin = 'edit' | 'restore';

const JwtTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [token, setToken] = useState(initial ?? '');
  const [secret, setSecret] = useState('');
  const [format, setFormat] = useState<SecretFormat>('text');
  const [publicKey, setPublicKey] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);
  // §16: Sign, with what it starts from (the defaults, a decoded token to edit, an entry); its key never leaves it.
  const [mode, setMode] = useState<'decode' | 'sign'>('decode');
  const [seed, setSeed] = useState<{ n: number; seed: SignSeed }>({ n: 0, seed: DEFAULT_SEED });
  const { history, recorder, status } = useToolHistory(host, 'jwt', jwtHistory);
  // Text handed over from the start page is the person's first edit; an opened entry is not an edit.
  const origin = useRef<Origin>('edit');

  const blank = token.trim() === '';
  const tooLarge = token.length > MAX_TOKEN;
  const result = useMemo(() => (blank || tooLarge ? undefined : decodeToken(token)), [token, blank, tooLarge]);
  const decoded = result?.ok ? result.token : undefined;
  const keyField = decoded && keyFieldOf(decoded);
  const parsedKey = useMemo<ParsedKey | undefined>(
    () =>
      keyField === 'secret'
        ? parseKey({ kind: 'secret', text: secret, format })
        : keyField === 'public'
          ? parseKey({ kind: 'public', text: publicKey })
          : undefined,
    [keyField, secret, format, publicKey],
  );

  // The verdict when no WebCrypto is needed; otherwise WebCrypto's answer for exactly this token and key.
  const immediate = useMemo(() => decoded && verificationWithoutCrypto(decoded, parsedKey), [decoded, parsedKey]);
  const [answer, setAnswer] = useState<{ token: Decoded; key: ParsedKey | undefined; v: Verification } | null>(null);
  useEffect(() => {
    if (!decoded || immediate) return;
    let live = true;
    void verifyToken(decoded, parsedKey).then(v => {
      if (live) setAnswer({ token: decoded, key: parsedKey, v });
    });
    return () => {
      live = false;
    };
  }, [decoded, parsedKey, immediate]);
  const verification = useMemo<Shown | undefined>(
    () =>
      !decoded
        ? undefined
        : (immediate ??
          (answer && answer.token === decoded && answer.key === parsedKey ? answer.v : { state: 'checking' })),
    [decoded, immediate, answer, parsedKey],
  );

  const keyRecord = (): KeyField | undefined =>
    keyField === 'secret' && secret !== ''
      ? { field: 'secret', format, text: secret }
      : keyField === 'public' && publicKey.trim() !== ''
        ? { field: 'public', text: publicKey }
        : undefined;
  const payloadNow = (v: Verification): JwtPayload | undefined => {
    if (!decoded) return undefined;
    const key = keyRecord();
    return {
      token,
      kind: decoded.kind,
      ...(decoded.alg !== undefined ? { alg: decoded.alg } : {}),
      signature: v.state,
      ...(key ? { key } : {}),
    };
  };

  // A person's edit is recorded once its result is known (the checkpoint rule decides when it is written); only a new
  // verdict records, with the payload of the render that made it.
  const latestPayload = useRef(payloadNow);
  latestPayload.current = payloadNow;
  useEffect(() => {
    if (!verification || verification.state === 'checking' || origin.current !== 'edit') return;
    const payload = latestPayload.current(verification);
    if (payload) recorder.change(draftOf(payload));
  }, [verification, recorder]);

  const edit = (apply: () => void): void => {
    origin.current = 'edit';
    setRestored(null);
    apply();
  };
  const copied = (): void => {
    if (!verification || verification.state === 'checking') return;
    const payload = payloadNow(verification);
    if (payload) void recorder.commit(draftOf(payload));
  };
  const clear = (): void =>
    edit(() => {
      setToken('');
      setSecret('');
      setPublicKey('');
    });

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
    const signedEntry = opened.entry.kind === 'signed' ? readSignedPayload(opened.payload) : undefined;
    if (signedEntry) {
      origin.current = 'restore';
      setSeed(s => ({
        n: s.n + 1,
        seed: { header: signedEntry.header, payload: signedEntry.payload, compact: signedEntry.compact },
      }));
      setMode('sign');
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}. The signing key is never kept: enter it again.`);
      return;
    }
    const entry = readPayload(opened.payload);
    if (!entry) {
      setRestored('This entry could not be opened.');
      return;
    }
    origin.current = 'restore';
    setMode('decode');
    setToken(entry.token);
    if (entry.key?.field === 'secret') {
      setSecret(entry.key.text);
      setFormat(entry.key.format);
    } else setSecret('');
    setPublicKey(entry.key?.field === 'public' ? entry.key.text : '');
    setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
  });

  const tokenError = tooLarge ? TOO_LARGE : result && !result.ok ? result.message : '';
  const keyError = parsedKey && !parsedKey.ok && parsedKey.message !== '' ? parsedKey.message : '';
  const verified = verification?.state === 'valid';
  const header = decoded?.header;
  const payload = decoded?.payload;
  const alg = decoded?.alg;
  const described = (id: string, message: string) => (message ? { 'aria-invalid': true, 'aria-describedby': id } : {});

  const editAndSign = (): void => {
    if (!decoded || !header) return;
    setSeed(s => ({
      n: s.n + 1,
      seed: {
        header: partText(header),
        payload: payload ? partText(payload) : '',
        compact: true,
        ...(keyField === 'secret' && secret !== '' ? { secret: { text: secret, format } } : {}),
      },
    }));
    setRestored(null);
    setMode('sign');
  };
  const decodeSigned = (signed: string, carried?: { text: string; format: SecretFormat }): void =>
    edit(() => {
      setMode('decode');
      setToken(signed);
      if (carried) {
        setSecret(carried.text);
        setFormat(carried.format);
      }
    });

  const modeSwitch = (
    <ToggleGroup
      type="single"
      variant="segmented"
      aria-label="Mode"
      value={mode}
      onValueChange={next => {
        if (!next) return;
        setRestored(null);
        setMode(next as 'decode' | 'sign');
      }}>
      <ToggleGroupItem value="decode">Decode</ToggleGroupItem>
      <ToggleGroupItem value="sign">Sign</ToggleGroupItem>
    </ToggleGroup>
  );

  if (mode === 'sign')
    return (
      <div className="flex flex-col gap-3">
        {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
        <div>{modeSwitch}</div>
        <SignView key={seed.n} seed={seed.seed} recorder={recorder} status={status} onDecode={decodeSigned} />
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <div>{modeSwitch}</div>

      <ToolPane
        label="Token"
        htmlFor="jwt-token"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            disabled={token === '' && secret === '' && publicKey === ''}>
            Clear
          </Button>
        }>
        <Textarea
          id="jwt-token"
          className="max-h-36 min-h-24 resize-y font-mono text-code break-all"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          placeholder="Paste a JWT: eyJ…"
          value={token}
          onChange={e => {
            const value = e.target.value;
            edit(() => setToken(value));
          }}
          {...described('jwt-token-error', tokenError)}
        />
        {/* Changes while typing: read out politely (status), as the JSON tool does — not an alert per keystroke. */}
        {tokenError && (
          <ToolMessage tone="error" role="status" id="jwt-token-error">
            {tokenError}
          </ToolMessage>
        )}
        {decoded?.notes.map(note => (
          <ToolMessage key={note} data-note>
            {note}
          </ToolMessage>
        ))}
      </ToolPane>

      {blank && <ToolEmpty>Paste a token to decode it. Add a key to verify its signature.</ToolEmpty>}

      {decoded && verification && (
        <>
          <SignatureStatus verification={verification} />

          {keyField === 'secret' && (
            <div className="flex flex-col gap-1" data-key="secret">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="jwt-secret">Secret</Label>
                <Input
                  id="jwt-secret"
                  className="w-96 max-w-full font-mono text-code"
                  type={showSecret ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={secret}
                  onChange={e => {
                    const value = e.target.value;
                    edit(() => setSecret(value));
                  }}
                  {...described('jwt-key-error', keyError)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Show secret"
                  title={showSecret ? 'Hide secret' : 'Show secret'}
                  aria-pressed={showSecret}
                  onClick={() => setShowSecret(s => !s)}>
                  {showSecret ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
                </Button>
                <Label htmlFor="jwt-secret-format" className="ml-2 text-muted-foreground">
                  Secret format
                </Label>
                <Select value={format} onValueChange={value => edit(() => setFormat(value as SecretFormat))}>
                  <SelectTrigger id="jwt-secret-format" className="min-w-36">
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
              </div>
              <KeyMessages parsed={parsedKey} error={keyError} />
            </div>
          )}
          {keyField === 'public' && (
            <div className="flex flex-col gap-1" data-key="public">
              <Label htmlFor="jwt-public-key">Public key</Label>
              <Textarea
                id="jwt-public-key"
                className="max-h-60 min-h-20 resize-y font-mono text-code break-all"
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                placeholder="-----BEGIN PUBLIC KEY----- …, a certificate, a JWK or a JWKS"
                value={publicKey}
                onChange={e => {
                  const value = e.target.value;
                  edit(() => setPublicKey(value));
                }}
                {...described('jwt-key-error', keyError)}
              />
              <KeyMessages parsed={parsedKey} error={keyError} />
            </div>
          )}

          {payload?.ok && <TimeStatusLine payload={payload.json} />}

          <ToolPanes className="max-md:grid-cols-1" layout={decoded.kind === 'jwe' ? 'stacked' : 'columns'}>
            <ToolPane label="Header" actions={<CopyButton value={header ? partText(header) : ''} onCopied={copied} />}>
              <Caption verified={verified} />
              {header && <PartView part={header} label="Header" error />}
              {alg !== undefined && (
                <p className="m-0 text-sm text-muted-foreground" data-algorithm>
                  {`Algorithm: ${alg} — ${algorithmName(alg) ?? 'not supported'}`}
                </p>
              )}
              {decoded.headerNotes.map(note => (
                <ToolMessage key={note}>{note}</ToolMessage>
              ))}
            </ToolPane>
            {payload && (
              <ToolPane label="Payload" actions={<CopyButton value={partText(payload)} onCopied={copied} />}>
                <Caption verified={verified} />
                <PartView part={payload} label="Payload" error={false} />
                {payload.ok && <ClaimsTable json={payload.json} raw={payload.raw} />}
              </ToolPane>
            )}
          </ToolPanes>

          {decoded.signature && (
            <ToolPane label="Signature" actions={<CopyButton value={decoded.signature.text} onCopied={copied} />}>
              <output
                aria-label="Signature"
                className="kit-result-row-value min-h-5"
                data-empty={decoded.signature.text === '' || undefined}>
                {decoded.signature.text === '' ? 'empty' : decoded.signature.text}
              </output>
              <span className="text-sm text-muted-foreground" data-signature-bytes>
                {decoded.signature.bytes.length === 1 ? '1 byte' : `${decoded.signature.bytes.length} bytes`}
              </span>
            </ToolPane>
          )}

          {decoded.kind === 'jws' && header?.ok && (
            <div>
              <Button variant="outline" size="sm" onClick={editAndSign} data-edit-sign>
                Edit and sign
              </Button>
            </div>
          )}
        </>
      )}

      {!blank && (
        <p className="m-0 text-sm text-muted-foreground" data-hint>
          {`Nothing is sent: tokens and keys are decoded and checked in this tab. ${keptSentence(status)}`}
        </p>
      )}
    </div>
  );
};

/** Under the key field: why it cannot be read, or what it is and what to know about it (§8). */
const KeyMessages = ({ parsed, error }: { parsed: ParsedKey | undefined; error: string }): ReactElement | null => {
  if (error)
    return (
      <ToolMessage tone="error" role="status" id="jwt-key-error">
        {error}
      </ToolMessage>
    );
  if (!parsed?.ok) return null;
  return (
    <>
      <ToolMessage data-key-description>{parsed.description}</ToolMessage>
      {parsed.warnings.map(w => (
        <ToolMessage key={w}>{w}</ToolMessage>
      ))}
    </>
  );
};

export default JwtTool;
