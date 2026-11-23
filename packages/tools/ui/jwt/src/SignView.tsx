/**
 * Signing (docs/tools/specs/jwt.md §16): the header and the payload as editable JSON, the algorithm (written into the
 * header's "alg"), the key — a shared secret for HS*, a private key for the others — and the signed token, made as the
 * person types by `crypto.subtle.sign` (an answer for older fields is dropped). The key lives in this component's state
 * only: it is never recorded (the history's `signed` kind keeps the header, the payload and the token, encrypted, with a
 * master password), saved or logged. Compact JSON and the secret's format are the tool's saved parameters: they come
 * from the tool, and a change goes back to it.
 */
import { signedDraft } from './payload';
import { SIGNING_ALGORITHMS, algorithmName, headerAlg, signToken, withAlg } from '@workspace/tool-logic-jwt';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { ResultField } from '@workspace/ui/result-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToolMessage, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SecretFormat, SignResult } from '@workspace/tool-logic-jwt';
import type { HistoryRecorder, RecordingStatus } from '@workspace/tools-host';
import type { ReactElement } from 'react';

export interface SignSeed {
  header: string;
  payload: string;
  /** A shared secret carried over from Decode (HS*): in memory only. */
  secret?: string;
}

export const DEFAULT_SEED: SignSeed = {
  header: '{\n  "alg": "HS256",\n  "typ": "JWT"\n}',
  payload: '{\n  "sub": "user-42",\n  "name": "Ada Lovelace"\n}',
};

/** How Sign signs, held by the tool (saved parameters): Compact JSON and the format of the signing secret. */
export interface SignOptions {
  compact: boolean;
  format: SecretFormat;
}

const FORMATS: Array<{ value: SecretFormat; label: string }> = [
  { value: 'text', label: 'Text (UTF-8)' },
  { value: 'base64', label: 'Base64' },
  { value: 'hex', label: 'Hex' },
  { value: 'jwk', label: 'JWK' },
];

/** What the line under the page says about keeping, by the history's state now. */
const signedKept = (status: RecordingStatus): string =>
  status.gate !== 'on'
    ? 'Signed tokens are not kept (history is off).'
    : status.secrets === 'unlocked'
      ? 'Signed tokens are kept encrypted in this browser.'
      : status.secrets === 'locked'
        ? 'Signed tokens are not kept while the history is locked.'
        : 'Signed tokens are not kept (no master password).';

export const SignView = ({
  seed,
  options: { compact, format },
  onOptions,
  recorder,
  status,
  onDecode,
}: {
  seed: SignSeed;
  options: SignOptions;
  /** The person changed an option. */
  onOptions: (change: Partial<SignOptions>) => void;
  recorder: HistoryRecorder;
  status: RecordingStatus;
  onDecode: (token: string, secret?: { text: string; format: SecretFormat }) => void;
}): ReactElement => {
  const [header, setHeader] = useState(seed.header);
  const [payload, setPayload] = useState(seed.payload);
  const [secret, setSecret] = useState(seed.secret ?? '');
  const [privateKey, setPrivateKey] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [result, setResult] = useState<SignResult | null>(null);
  const edited = useRef(false);

  const alg = headerAlg(header);
  const listed = (SIGNING_ALGORITHMS as readonly string[]).includes(alg ?? '') ? alg : undefined;
  const hmac = (alg ?? 'HS256').startsWith('HS');

  useEffect(() => {
    let live = true;
    const key = hmac
      ? { kind: 'secret' as const, text: secret, format }
      : { kind: 'private' as const, text: privateKey };
    void signToken({ header, payload, compact, key }).then(r => {
      if (!live) return;
      setResult(r);
      // An edit that signs is recorded by the checkpoint rule: header, payload and token — never the key.
      if (r.ok && edited.current)
        recorder.change(signedDraft({ header, payload, compact, alg: r.alg, token: r.token }));
    });
    return () => {
      live = false;
    };
  }, [header, payload, compact, secret, format, privateKey, hmac, recorder]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    apply();
  };
  const signed = result?.ok ? result : null;
  const error = (field: 'header' | 'payload' | 'key') =>
    result && !result.ok && result.field === field && result.message ? result.message : '';

  return (
    <div className="flex flex-col gap-3" data-sign>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="jwt-sign-alg">Algorithm</Label>
          <Select value={listed ?? ''} onValueChange={next => edit(() => setHeader(h => withAlg(h, next)))}>
            <SelectTrigger id="jwt-sign-alg" className="min-w-36">
              <SelectValue placeholder="From the header" />
            </SelectTrigger>
            <SelectContent>
              {SIGNING_ALGORITHMS.map(a => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox
            id="jwt-sign-compact"
            checked={compact}
            onCheckedChange={v => edit(() => onOptions({ compact: v === true }))}
          />
          <Label htmlFor="jwt-sign-compact">Compact JSON</Label>
        </div>
        {listed && (
          <p className="m-0 pb-2 text-sm text-muted-foreground" data-sign-algorithm>
            {algorithmName(listed)}
          </p>
        )}
      </div>

      <ToolPanes className="max-md:grid-cols-1">
        <ToolPane label="Header" htmlFor="jwt-sign-header">
          <Textarea
            id="jwt-sign-header"
            className="min-h-28 resize-y font-mono text-code"
            spellCheck={false}
            autoComplete="off"
            value={header}
            onChange={e => {
              const value = e.target.value;
              edit(() => setHeader(value));
            }}
          />
          {error('header') && (
            <ToolMessage tone="error" role="status" data-sign-error="header">
              {error('header')}
            </ToolMessage>
          )}
        </ToolPane>
        <ToolPane label="Payload" htmlFor="jwt-sign-payload">
          <Textarea
            id="jwt-sign-payload"
            className="min-h-28 resize-y font-mono text-code"
            spellCheck={false}
            autoComplete="off"
            value={payload}
            onChange={e => {
              const value = e.target.value;
              edit(() => setPayload(value));
            }}
          />
          {error('payload') && (
            <ToolMessage tone="error" role="status" data-sign-error="payload">
              {error('payload')}
            </ToolMessage>
          )}
        </ToolPane>
      </ToolPanes>

      {hmac ? (
        <div className="flex flex-wrap items-center gap-2" data-sign-key="secret">
          <Label htmlFor="jwt-sign-secret">Signing secret</Label>
          <Input
            id="jwt-sign-secret"
            className="w-96 max-w-full font-mono text-code"
            type={showSecret ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={secret}
            onChange={e => {
              const value = e.target.value;
              edit(() => setSecret(value));
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Show signing secret"
            title={showSecret ? 'Hide signing secret' : 'Show signing secret'}
            aria-pressed={showSecret}
            onClick={() => setShowSecret(s => !s)}>
            {showSecret ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
          </Button>
          <Label htmlFor="jwt-sign-secret-format" className="ml-2 text-muted-foreground">
            Secret format
          </Label>
          <Select value={format} onValueChange={value => edit(() => onOptions({ format: value as SecretFormat }))}>
            <SelectTrigger id="jwt-sign-secret-format" className="min-w-36">
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
      ) : (
        <div className="flex flex-col gap-1" data-sign-key="private">
          <Label htmlFor="jwt-sign-private">Private key</Label>
          <Textarea
            id="jwt-sign-private"
            className="max-h-60 min-h-20 resize-y font-mono text-code break-all"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            placeholder='-----BEGIN PRIVATE KEY----- …, RSA PRIVATE KEY, EC PRIVATE KEY or a JWK with "d"'
            value={privateKey}
            onChange={e => {
              const value = e.target.value;
              edit(() => setPrivateKey(value));
            }}
          />
        </div>
      )}
      {error('key') && (
        <ToolMessage tone="error" role="status" data-sign-error="key">
          {error('key')}
        </ToolMessage>
      )}
      {signed?.notes.map(n => (
        <ToolMessage key={n}>{n}</ToolMessage>
      ))}

      <ToolPane
        label="Signed token"
        htmlFor="jwt-signed"
        actions={
          <span className="flex gap-1">
            <CopyButton
              value={signed?.token ?? ''}
              data-copy-signed
              onCopied={() => {
                if (signed)
                  void recorder.commit(signedDraft({ header, payload, compact, alg: signed.alg, token: signed.token }));
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              disabled={!signed}
              data-decode-signed
              onClick={() => signed && onDecode(signed.token, hmac ? { text: secret, format } : undefined)}>
              Decode it
            </Button>
          </span>
        }>
        <ResultField
          id="jwt-signed"
          className="min-h-20 resize-y font-mono text-code break-all"
          spellCheck={false}
          value={signed?.token ?? ''}
          placeholder="The token appears here once the header, the payload and the key are right."
        />
      </ToolPane>

      <p className="m-0 text-sm text-muted-foreground" data-sign-hint>
        {`Nothing is sent: tokens are signed in this tab, and the signing key is never kept. ${signedKept(status)}`}
      </p>
    </div>
  );
};
