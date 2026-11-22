/**
 * One key on the page (docs/tools/specs/keys.md §8, items 5–8): the summary line and notes, the public key in the
 * chosen form, the fingerprints, and — for a private key — the private key in the chosen form, hidden until "Show
 * private key" (Copy and Save work hidden). Every Copy and Save is a person taking a value: `onTaken` (the history's
 * commit, of public material only).
 */
import {
  FORM_LABELS,
  fileName,
  fileType,
  isPrivate,
  privateFormLabel,
  privateForms,
  privateText,
  publicForms,
  publicText,
} from '@workspace/tool-logic-keys';
import { Button } from '@workspace/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/card';
import { CopyButton } from '@workspace/ui/copy-button';
import { ResultField } from '@workspace/ui/result-field';
import { ResultRow, ResultRows } from '@workspace/ui/result-row';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage } from '@workspace/ui/tool-page';
import { EyeIcon, EyeOffIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { Fingerprints, PrivateForm, PublicForm, ReadKey } from '@workspace/tool-logic-keys';
import type { CopyOutcome } from '@workspace/ui/copy-button';
import type { ReactElement, ReactNode } from 'react';

export const PRIVATE_NOTE =
  "The private key is only in this page's memory: it goes when you leave the page or press Clear. It is never saved — not in history, not in settings.";
export const HIDDEN = 'Hidden. Copy and Save work without showing it.';

/** A file from a text: `<a download>` on an object URL, revoked after the click (as json-csv). */
export const saveText = (text: string, name: string, type: string): void => {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const Section = ({
  title,
  children,
  ...props
}: { title: string; children: ReactNode } & Record<`data-${string}`, unknown>): ReactElement => (
  <Card size="sm" {...props}>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
    </CardHeader>
    <CardContent className="flex flex-col gap-2">{children}</CardContent>
  </Card>
);

export const Note = ({ children }: { children: ReactNode }): ReactElement => (
  <p className="m-0 flex items-start gap-2 text-sm text-warning" data-note>
    <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    <span>{children}</span>
  </p>
);

const FormSwitch = <F extends string>({
  label,
  forms,
  value,
  words,
  onChange,
}: {
  label: string;
  forms: readonly F[];
  value: F;
  words: (form: F) => string;
  onChange: (form: F) => void;
}): ReactElement => (
  <ToggleGroup
    type="single"
    variant="segmented"
    size="sm"
    aria-label={label}
    value={value}
    onValueChange={next => next && onChange(next as F)}>
    {forms.map(f => (
      <ToggleGroupItem key={f} value={f}>
        {words(f)}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
);

export interface KeyViewProps {
  keyRead: ReadKey;
  fingerprints: Fingerprints | null;
  /** The `kid` to add to the JWK forms (the thumbprint), when asked. */
  kid?: string;
  publicForm: PublicForm;
  privateForm: PrivateForm;
  onPublicForm: (form: PublicForm) => void;
  onPrivateForm: (form: PrivateForm) => void;
  /** OpenSSH private file's check number, fixed for this key. */
  checkint: number;
  shown: boolean;
  onShown: (shown: boolean) => void;
  /** A Copy or Save of any value: the history's commit. */
  onTaken: () => void;
  /** The automatic copy after Generate (the public key): the public Copy says "Copied". */
  autoCopied?: CopyOutcome | null;
  /** Under the summary: "Generated in 0.4 s". */
  detail?: string;
  summary: string;
}

/** The form to show: the chosen one if this key has it, otherwise its first. */
export const formOf = <F extends string>(available: readonly F[], chosen: F): F =>
  available.includes(chosen) ? chosen : available[0]!;

export const KeyView = (props: KeyViewProps): ReactElement => {
  const { keyRead: key, fingerprints: fp, kid, checkint, onTaken } = props;
  const pubForms = publicForms(key.data);
  const pubForm = formOf(pubForms, props.publicForm);
  const priv = isPrivate(key.data);
  const privForms = privateForms(key.data);
  const privForm = formOf(privForms, props.privateForm);
  const pubText = useMemo(() => publicText(key, pubForm, kid), [key, pubForm, kid]);
  const privText = useMemo(
    () => (priv ? privateText(key, privForm, { kid, checkint }) : ''),
    [key, priv, privForm, kid, checkint],
  );

  return (
    <div className="flex flex-col gap-3" data-key>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-base font-medium" data-summary>
          {props.summary}
        </p>
        {props.detail && <p className="m-0 text-sm text-muted-foreground">{props.detail}</p>}
        {key.notes.map(n => (
          <Note key={n}>{n}</Note>
        ))}
      </div>

      <Section title="Public key" data-public>
        <div className="flex flex-wrap items-center gap-2">
          <FormSwitch
            label="Public key form"
            forms={pubForms}
            value={pubForm}
            words={f => FORM_LABELS[f]}
            onChange={props.onPublicForm}
          />
          <span className="ml-auto flex gap-1">
            <CopyButton value={pubText} onCopied={onTaken} outcome={props.autoCopied} data-copy-public />
            <Button
              variant="ghost"
              size="sm"
              data-save-public
              onClick={() => {
                saveText(pubText, fileName(key.data, 'public', pubForm), fileType(pubForm));
                onTaken();
              }}>
              Save
            </Button>
          </span>
        </div>
        <ResultField
          id="keys-public"
          aria-label="Public key"
          className="min-h-20 resize-y font-mono text-code break-all"
          spellCheck={false}
          value={pubText}
          saves
        />
      </Section>

      <Section title="Fingerprints" data-fingerprints>
        <ResultRows>
          {fp?.sha256 !== null && (
            <ResultRow label="SHA256 (OpenSSH)" value={fp?.sha256 ?? ''} empty="…" copy={{ onCopied: onTaken }} />
          )}
          {fp?.md5 !== null && (
            <ResultRow label="MD5 (OpenSSH, legacy)" value={fp?.md5 ?? ''} empty="…" copy={{ onCopied: onTaken }} />
          )}
          <ResultRow label="SPKI SHA-256 (hex)" value={fp?.spkiHex ?? ''} empty="…" copy={{ onCopied: onTaken }} />
          <ResultRow
            label="SPKI SHA-256 (Base64)"
            value={fp?.spkiBase64 ?? ''}
            empty="…"
            copy={{ onCopied: onTaken }}
          />
          <ResultRow
            label="JWK thumbprint (RFC 7638)"
            value={fp?.thumbprint ?? ''}
            empty="…"
            copy={{ onCopied: onTaken }}
          />
        </ResultRows>
      </Section>

      {priv && (
        <Section title="Private key" data-private>
          <div className="flex flex-wrap items-center gap-2">
            <FormSwitch
              label="Private key form"
              forms={privForms}
              value={privForm}
              words={f => privateFormLabel(key.data, f)}
              onChange={props.onPrivateForm}
            />
            <span className="ml-auto flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={props.shown}
                title={props.shown ? 'Hide private key' : 'Show private key'}
                onClick={() => props.onShown(!props.shown)}
                data-show-private>
                {props.shown ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
                Show private key
              </Button>
              <CopyButton value={privText} data-copy-private />
              <Button
                variant="ghost"
                size="sm"
                data-save-private
                onClick={() => saveText(privText, fileName(key.data, 'private', privForm), fileType(privForm))}>
                Save
              </Button>
            </span>
          </div>
          {props.shown ? (
            <ResultField
              id="keys-private"
              aria-label="Private key"
              className="min-h-32 resize-y font-mono text-code break-all"
              spellCheck={false}
              value={privText}
              saves
            />
          ) : (
            <p className="m-0 text-sm text-muted-foreground" data-hidden>
              {HIDDEN}
            </p>
          )}
          <ToolMessage role={undefined} data-private-note>
            {PRIVATE_NOTE}
          </ToolMessage>
        </Section>
      )}
    </div>
  );
};
