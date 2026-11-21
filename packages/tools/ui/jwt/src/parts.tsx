/**
 * The JWT tool's parts (docs/tools/specs/jwt.md §8): the signature status, the times status, a decoded part with its
 * caption, the claims table. The two that show relative times own the clock (`useNow`), so its tick re-renders them
 * only, never the decoded JSON. A state is never told by colour alone: an icon and words always go together.
 */
import {
  claimRows,
  timeClaims,
  timeLines,
  timeStatus,
  timeStatusText,
  ISSUED_IN_FUTURE,
} from '@workspace/tool-logic-jwt';
import { useNow } from '@workspace/tools-host';
import { ToolMessage } from '@workspace/ui/tool-page';
import { cn } from '@workspace/ui/utils';
import { CircleCheckIcon, CircleHelpIcon, CircleXIcon, ClockIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { ClaimTime, Part, TimeStatus, Verification } from '@workspace/tool-logic-jwt';
import type { ReactElement, ReactNode } from 'react';

export type Shown = Verification | { state: 'checking' };

const NO_KEY_DETAIL = "Decoding doesn't prove who made the token. Add the key to verify it.";

/** The words and the look of each state of §5.5. */
const statusOf = (v: Shown): { icon?: ReactNode; title: string; detail?: string; tone: string } => {
  const icon = (Icon: typeof CircleHelpIcon) => <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />;
  switch (v.state) {
    case 'checking':
      return { title: 'Checking signature…', tone: 'text-muted-foreground' };
    case 'no-key':
      return {
        icon: icon(CircleHelpIcon),
        title: 'Signature not verified',
        detail: NO_KEY_DETAIL,
        tone: 'text-foreground',
      };
    case 'valid':
      return {
        icon: icon(CircleCheckIcon),
        title: 'Signature verified',
        detail: 'with the key below',
        tone: 'text-success',
      };
    case 'invalid':
      return { icon: icon(CircleXIcon), title: 'Signature does not match', detail: v.reason, tone: 'text-destructive' };
    case 'cannot-verify':
      return { icon: icon(TriangleAlertIcon), title: `Cannot verify: ${v.reason}`, tone: 'text-warning' };
    case 'unsecured':
      return {
        icon: icon(TriangleAlertIcon),
        title: 'Unsecured token: alg is "none". Anyone could have written it.',
        detail: v.hasSignature ? 'The token has a signature anyway, which is not allowed with "none".' : undefined,
        tone: 'text-destructive',
      };
  }
};

/** The signature status (§5.5): one of six states, at the top, in large words with an icon; read out politely. */
export const SignatureStatus = ({ verification }: { verification: Shown }): ReactElement => {
  const { icon, title, detail, tone } = statusOf(verification);
  const warnings = 'warnings' in verification ? verification.warnings : [];
  const key = 'key' in verification ? verification.key : undefined;
  return (
    <div role="status" data-signature={verification.state} className="flex flex-col gap-1">
      <div className={cn('flex items-start gap-2', tone)}>
        {icon}
        <div className="flex min-w-0 flex-col">
          <span className="text-base font-semibold" data-signature-title>
            {title}
          </span>
          {detail && <span className="text-sm text-muted-foreground">{detail}</span>}
          {key && <span className="text-sm text-muted-foreground">Key used: {key}</span>}
        </div>
      </div>
      {warnings.map(w => (
        <p key={w} className="m-0 flex items-start gap-2 text-sm text-warning" data-warning>
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {w}
        </p>
      ))}
    </div>
  );
};

const TIME_TONE: Record<TimeStatus['kind'], string> = {
  expired: 'text-destructive',
  'not-yet': 'text-warning',
  valid: 'text-foreground',
  'no-expiry': 'text-foreground',
  unknown: 'text-foreground',
};

/** The times status (§5.6), separate from the signature: exact, no allowance for clock skew; it moves every second. */
export const TimeStatusLine = ({ payload }: { payload: unknown }): ReactElement | null => {
  const now = useNow();
  const claims = useMemo(() => timeClaims(payload), [payload]);
  const status = timeStatus(claims, now);
  const text = timeStatusText(status, now);
  if (text === undefined) return null;
  return (
    <p
      className={cn('m-0 flex items-center gap-2 text-sm', TIME_TONE[status.status.kind])}
      data-times={status.status.kind}>
      <ClockIcon aria-hidden="true" className="size-4 shrink-0" />
      <span>
        {text}
        {status.issuedInFuture && <span className="text-warning">{` · ${ISSUED_IN_FUTURE}`}</span>}
      </span>
    </p>
  );
};

/** "Decoded, not verified" until the signature is verified — no decoded data on the page without saying which (§5.5). */
export const Caption = ({ verified }: { verified: boolean }): ReactElement => (
  <p
    className={cn('m-0 flex items-center gap-1 text-xs', verified ? 'text-success' : 'text-muted-foreground')}
    data-caption={verified ? 'verified' : 'not-verified'}>
    {verified ? (
      <CircleCheckIcon aria-hidden="true" className="size-3.5" />
    ) : (
      <CircleHelpIcon aria-hidden="true" className="size-3.5" />
    )}
    {verified ? 'Signature verified' : 'Decoded, not verified'}
  </p>
);

const PRE =
  'm-0 max-h-96 overflow-auto rounded-md border border-border bg-muted p-2 font-mono text-code whitespace-pre-wrap break-all text-foreground select-text';

/** What a decoded part shows: its JSON, or its text or hex with why it is not JSON. */
export const partText = (part: Part): string => (part.ok ? part.display : (part.text ?? part.hex ?? ''));

/** A header or payload: the JSON in a <pre>, or the text or hex and the message (an error for the header). */
export const PartView = ({ part, label, error }: { part: Part; label: string; error: boolean }): ReactElement => (
  <>
    <pre className={PRE} aria-label={label} data-part={label}>
      {partText(part)}
    </pre>
    {!part.ok &&
      (error ? (
        <ToolMessage tone="error" role="status">
          {part.message}
        </ToolMessage>
      ) : (
        <ToolMessage>{part.message}</ToolMessage>
      ))}
  </>
);

const TimeValue = ({ time, now }: { time: ClaimTime; now: number }): ReactElement => {
  const lines = timeLines(time, now);
  if ('message' in lines)
    return (
      <>
        <span className="text-sm text-warning">{lines.message}</span>
        {lines.hint && <span className="text-sm text-muted-foreground">{lines.hint}</span>}
      </>
    );
  return (
    <>
      <span className="font-mono text-code text-foreground">{lines.iso}</span>
      {lines.local && <span className="text-sm text-foreground">{lines.local}</span>}
      <span className="text-sm text-muted-foreground">{lines.relative}</span>
    </>
  );
};

/** The claims table (§5.8) under the payload: names in the payload's order, registered ones explained. */
export const ClaimsTable = ({ json, raw }: { json: unknown; raw: unknown }): ReactElement | null => {
  const now = useNow();
  const rows = useMemo(() => claimRows(json, raw), [json, raw]);
  if (rows.length === 0) return null;
  return (
    <dl aria-label="Claims" className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
      {rows.map(row => (
        <div key={row.name} className="contents" data-claim={row.name}>
          <dt className="flex flex-col text-sm">
            <span className="font-mono text-code text-foreground">{row.name}</span>
            {row.label && <span className="text-xs text-muted-foreground">{row.label}</span>}
          </dt>
          <dd className="m-0 flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-code break-all text-foreground select-text">{row.value}</span>
            {row.time && <TimeValue time={row.time} now={now} />}
          </dd>
        </div>
      ))}
    </dl>
  );
};
