/**
 * One certificate on the page (docs/tools/specs/x509.md §8): the summary, then Subject, Issuer, Validity, Public key,
 * Extensions, Fingerprints and Details. The parts that show a relative time own the clock (`useNow`), so its tick
 * redraws them only. A state is never told by colour alone: an icon and words go together. Addresses are text, never
 * links — nothing on this page goes to the network.
 */
import {
  fingerprints,
  formatSize,
  NO_EXPIRY,
  NO_EXTENSIONS,
  NOT_RFC5280_TIME,
  spkiSha256,
  timeLines,
  toPem,
  validityPeriod,
  validityStatus,
  validityText,
} from '@workspace/tool-logic-x509';
import { useNow } from '@workspace/tools-host';
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/card';
import { CopyButton } from '@workspace/ui/copy-button';
import { ResultRow, ResultRows } from '@workspace/ui/result-row';
import { cn } from '@workspace/ui/utils';
import { CircleCheckIcon, CircleXIcon, ClockIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CertTime, Certificate, Extension, Name, ValidityStatus } from '@workspace/tool-logic-x509';
import type { ReactElement, ReactNode } from 'react';

/** Called with what was copied: a person taking a value is an action the history keeps (a commit). */
type OnCopied = () => void;

const STATUS: Record<ValidityStatus['kind'], { tone: string; icon?: typeof ClockIcon }> = {
  valid: { tone: 'text-success', icon: CircleCheckIcon },
  expired: { tone: 'text-destructive', icon: CircleXIcon },
  'not-yet': { tone: 'text-warning', icon: ClockIcon },
  unknown: { tone: 'text-muted-foreground' },
};

/** `Valid: expires in 23 years` with its icon; it moves with the clock. None when a date is not RFC 5280's. */
const StatusLine = ({ certificate }: { certificate: Certificate }): ReactElement | null => {
  const now = useNow();
  const status = validityStatus(certificate.notBefore, certificate.notAfter, now);
  const text = validityText(status, now);
  if (text === undefined) return null;
  const { tone, icon: Icon } = STATUS[status.kind];
  return (
    <p className={cn('m-0 flex items-center gap-2 text-sm font-medium', tone)} data-validity={status.kind}>
      {Icon && <Icon aria-hidden="true" className="size-4 shrink-0" />}
      {text}
    </p>
  );
};

const Warning = ({ children }: { children: ReactNode }): ReactElement => (
  <p className="m-0 flex items-start gap-2 text-sm text-warning" data-warning>
    <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
    <span>{children}</span>
  </p>
);

/** The summary (§8 item 3): the subject's name large, the validity status, self-issued, the chain line, warnings. */
export const Summary = ({
  certificate,
  chain,
  role,
}: {
  certificate: Certificate;
  chain?: string;
  role?: string;
}): ReactElement => (
  <section aria-label="Summary" className="flex flex-col gap-1" data-summary>
    <h3 className="m-0 text-lg font-semibold break-all text-foreground" data-subject-display>
      {certificate.subject.display}
    </h3>
    <StatusLine certificate={certificate} />
    {(certificate.selfIssued || role) && (
      <p className="m-0 text-sm text-muted-foreground">
        {[role, certificate.selfIssued ? 'Self-issued' : ''].filter(Boolean).join(' · ')}
      </p>
    )}
    {chain && (
      <p className="m-0 text-sm text-muted-foreground" data-chain>
        {chain}
      </p>
    )}
    {certificate.warnings.map(w => (
      <Warning key={w}>{w}</Warning>
    ))}
  </section>
);

const Section = ({ title, children, ...props }: { title: string; children: ReactNode; 'data-section'?: string }) => (
  <Card size="sm" {...props}>
    <CardHeader>
      <CardTitle>
        <h4 className="m-0 text-sm font-semibold">{title}</h4>
      </CardTitle>
    </CardHeader>
    <CardContent className="flex flex-col gap-2">{children}</CardContent>
  </Card>
);

const Rows = ({ label, children }: { label: string; children: ReactNode }): ReactElement => (
  <dl aria-label={label} className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1">
    {children}
  </dl>
);
const Row = ({ term, children }: { term: ReactNode; children: ReactNode }): ReactElement => (
  <div className="contents">
    <dt className="text-sm text-muted-foreground">{term}</dt>
    <dd className="m-0 min-w-0 text-sm break-words text-foreground">{children}</dd>
  </div>
);

/** Subject or Issuer (§5.5): the attributes in the certificate's order, then the RFC 4514 string with Copy. */
export const NameSection = ({ title, name, onCopied }: { title: string; name: Name; onCopied: OnCopied }) => (
  <Section title={title} data-section={title}>
    {name.rdns.length === 0 ? (
      <p className="m-0 text-sm text-muted-foreground">(empty)</p>
    ) : (
      <Rows label={`${title} attributes`}>
        {name.rdns.flat().map((a, i) => (
          <Row key={i} term={a.label}>
            <span className="font-mono text-code break-all select-text">{a.value}</span>
          </Row>
        ))}
      </Rows>
    )}
    <ResultRows>
      <ResultRow
        label="RFC 4514"
        value={name.rfc4514}
        outputLabel={`${title} (RFC 4514)`}
        copyLabel={`Copy ${title.toLowerCase()}`}
        copy={{ onCopied }}
      />
    </ResultRows>
  </Section>
);

/** One time in three lines (§5.4): ISO 8601 UTC, local, relative — or as written, when it is not RFC 5280's. */
const TimeLines = ({ time, now, notAfter }: { time: CertTime; now: number; notAfter?: boolean }): ReactElement => {
  if (!time.date)
    return (
      <span className="flex flex-col">
        <span className="font-mono text-code">{time.raw}</span>
        <span className="text-sm text-warning">{NOT_RFC5280_TIME}</span>
      </span>
    );
  if (notAfter && time.noExpiry) return <span className="text-sm">{NO_EXPIRY}</span>;
  const lines = timeLines(time, now)!;
  return (
    <span className="flex flex-col">
      <span className="font-mono text-code">{lines.iso}</span>
      {lines.local && <span className="text-sm">{lines.local}</span>}
      <span className="text-sm text-muted-foreground">{lines.relative}</span>
    </span>
  );
};

export const ValiditySection = ({ certificate }: { certificate: Certificate }): ReactElement => {
  const now = useNow();
  const period = validityPeriod(certificate.notBefore, certificate.notAfter);
  return (
    <Section title="Validity" data-section="Validity">
      <Rows label="Validity">
        <Row term="Not before">
          <TimeLines time={certificate.notBefore} now={now} />
        </Row>
        <Row term="Not after">
          <TimeLines time={certificate.notAfter} now={now} notAfter />
        </Row>
        {period && <Row term="Validity period">{period}</Row>}
      </Rows>
    </Section>
  );
};

/** A digest WebCrypto computes for this certificate; an answer for another certificate is dropped. */
const useDigest = <T,>(key: Uint8Array, compute: (bytes: Uint8Array) => Promise<T>): T | undefined => {
  const [answer, setAnswer] = useState<{ key: Uint8Array; value: T } | null>(null);
  useEffect(() => {
    let live = true;
    void compute(key).then(value => {
      if (live) setAnswer({ key, value });
    });
    return () => {
      live = false;
    };
  }, [key, compute]);
  return answer && answer.key === key ? answer.value : undefined;
};

export const PublicKeySection = ({ certificate, onCopied }: { certificate: Certificate; onCopied: OnCopied }) => {
  const pin = useDigest(certificate.publicKey.spkiDer, spkiSha256);
  return (
    <Section title="Public key" data-section="Public key">
      <p className="m-0 text-sm font-medium text-foreground" data-key>
        {certificate.publicKey.description}
      </p>
      <ResultRows>
        <ResultRow label="SPKI SHA-256" value={pin ?? ''} empty="…" copy={{ onCopied }} />
      </ResultRows>
    </Section>
  );
};

const HEX_SHOWN = 64 * 3 - 1;
const LONG = 6;

const ExtensionValue = ({ extension, onCopied }: { extension: Extension; onCopied: OnCopied }): ReactElement => {
  const value = extension.value;
  if (value.kind === 'text') {
    const list = (
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {value.lines.map((line, i) => (
          <li key={i} className="font-mono text-code break-all select-text">
            {line}
          </li>
        ))}
      </ul>
    );
    return value.lines.length > LONG ? (
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">{`${value.lines.length} entries`}</summary>
        {list}
      </details>
    ) : (
      list
    );
  }
  const shown = value.hex.length > HEX_SHOWN ? `${value.hex.slice(0, HEX_SHOWN)}…` : value.hex;
  return (
    <div className="flex flex-col gap-1">
      {value.error && <p className="m-0 text-sm text-warning">{value.error}</p>}
      {value.detail && <p className="m-0 text-sm text-muted-foreground">{value.detail}</p>}
      <div className="flex items-start gap-2">
        <span className="min-w-0 font-mono text-code break-all select-text">{shown}</span>
        <CopyButton icon value={value.hex} label={`Copy ${extension.name} value`} onCopied={onCopied} />
      </div>
    </div>
  );
};

export const ExtensionsSection = ({ certificate, onCopied }: { certificate: Certificate; onCopied: OnCopied }) => (
  <Section title="Extensions" data-section="Extensions">
    {certificate.extensions.length === 0 ? (
      <p className="m-0 text-sm text-muted-foreground">{NO_EXTENSIONS}</p>
    ) : (
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {certificate.extensions.map((e, i) => (
          <li key={i} className="flex flex-col gap-1" data-extension={e.oid}>
            <span className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium text-foreground">{e.name}</span>
              {e.name !== e.oid && <span className="font-mono text-xs text-muted-foreground">{e.oid}</span>}
              {e.critical && <span className="text-xs font-semibold text-warning">Critical</span>}
            </span>
            <ExtensionValue extension={e} onCopied={onCopied} />
          </li>
        ))}
      </ul>
    )}
  </Section>
);

export const FingerprintsSection = ({ certificate, onCopied }: { certificate: Certificate; onCopied: OnCopied }) => {
  const prints = useDigest(certificate.der, fingerprints);
  return (
    <Section title="Fingerprints" data-section="Fingerprints">
      <ResultRows>
        <ResultRow label="SHA-256" value={prints?.sha256 ?? ''} empty="…" copy={{ onCopied }} />
        <ResultRow label="SHA-1" value={prints?.sha1 ?? ''} empty="…" copy={{ onCopied }} />
      </ResultRows>
    </Section>
  );
};

export const DetailsSection = ({ certificate, onCopied }: { certificate: Certificate; onCopied: OnCopied }) => (
  <Section title="Details" data-section="Details">
    <Rows label="Details">
      <Row term="Version">{`v${certificate.version}`}</Row>
      <Row term="Serial number">
        <span className="flex items-start gap-2">
          <span className="flex min-w-0 flex-col">
            <span className="font-mono text-code break-all select-text" data-serial-hex>
              {certificate.serialHex}
            </span>
            {certificate.serialDecimal && (
              <span className="font-mono text-code break-all text-muted-foreground select-text">
                {certificate.serialDecimal}
              </span>
            )}
          </span>
          <CopyButton icon value={certificate.serialHex} label="Copy serial number" onCopied={onCopied} />
        </span>
      </Row>
      <Row term="Signature algorithm">
        {certificate.signatureAlgorithm}
        {certificate.signatureAlgorithm !== certificate.signatureAlgorithmOid && (
          <span className="ml-2 font-mono text-xs text-muted-foreground">{certificate.signatureAlgorithmOid}</span>
        )}
      </Row>
      <Row term="Signature">
        <details>
          <summary className="cursor-pointer">{formatSize(certificate.signatureBytes)}</summary>
          <span className="font-mono text-code break-all select-text">{certificate.signatureHex}</span>
        </details>
      </Row>
      {certificate.issuerUniqueId && (
        <Row term="Issuer unique ID">
          <span className="font-mono text-code break-all">{certificate.issuerUniqueId}</span>
        </Row>
      )}
      {certificate.subjectUniqueId && (
        <Row term="Subject unique ID">
          <span className="font-mono text-code break-all">{certificate.subjectUniqueId}</span>
        </Row>
      )}
    </Rows>
    <div>
      <CopyButton
        value={() => toPem(certificate.der)}
        resetKey={certificate.der}
        label="Copy PEM"
        onCopied={onCopied}
      />
    </div>
  </Section>
);

/** The whole certificate: the summary and the sections of §8 item 4. */
export const CertificateView = ({
  certificate,
  chain,
  role,
  onCopied,
}: {
  certificate: Certificate;
  chain?: string;
  role?: string;
  onCopied: OnCopied;
}): ReactElement => (
  <div className="flex flex-col gap-3" data-certificate>
    <Summary certificate={certificate} chain={chain} role={role} />
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <NameSection title="Subject" name={certificate.subject} onCopied={onCopied} />
      <NameSection title="Issuer" name={certificate.issuer} onCopied={onCopied} />
      <ValiditySection certificate={certificate} />
      <PublicKeySection certificate={certificate} onCopied={onCopied} />
    </div>
    <ExtensionsSection certificate={certificate} onCopied={onCopied} />
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <FingerprintsSection certificate={certificate} onCopied={onCopied} />
      <DetailsSection certificate={certificate} onCopied={onCopied} />
    </div>
  </div>
);
