/**
 * The X.509 Certificate tool's page (docs/tools/specs/x509.md §8): the field (PEM, Base64 or a dropped / opened file),
 * the messages under it, the certificate switch for a chain, and one certificate at a time (parts.tsx). Reading runs as
 * the person types; fingerprints come from WebCrypto, an answer for another certificate is dropped. The tool reads:
 * it checks no signature, consults no trust store and fetches nothing — the hint at the bottom says so. All logic is in
 * @workspace/tool-logic-x509; the host draws the page frame.
 *
 * History (D17): one open kind, `read`. A person's edit that reads certificates is a `change`; opening a file and
 * every Copy are a `commit`. A draft is built only from the certificates read (entries.ts), so a private key pasted
 * with them never reaches the history. An entry opened from History brings the certificates back as PEM text.
 */
import { draftOf, readPayload } from './entries';
import { x509History } from './history';
import { CertificateView } from './parts';
import {
  chainLinks,
  chainText,
  EMPTY_STATE,
  FILE_TOO_LARGE,
  formatSize,
  HINT,
  MAX_INPUT_BYTES,
  PLACEHOLDER,
  readCertificates,
  TEXT_TOO_LARGE,
} from '@workspace/tool-logic-x509';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { FileDrop } from '@workspace/ui/file-drop';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolEmpty, ToolMessage, ToolPane } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Reading } from '@workspace/tool-logic-x509';
import type { ToolProps } from '@workspace/tools-host';
import type { DragEvent, ReactElement } from 'react';

interface OpenFile {
  name: string;
  size: number;
  /** Absent: larger than 1 MiB, not read. */
  bytes?: Uint8Array;
}

type Origin = 'edit' | 'file' | 'restore';

const NOTHING: Reading = { certificates: [], messages: [] };

const X509Tool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [text, setText] = useState(initial ?? '');
  const [file, setFile] = useState<OpenFile | null>(null);
  const [selected, setSelected] = useState(0);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'x509', x509History);
  // Text handed over from the start page is the person's first edit; an opened entry is not an edit.
  const origin = useRef<Origin>('edit');
  // A file read last: a later answer for an older file is dropped.
  const reading = useRef(0);

  const blank = !file && text.trim() === '';
  const tooLarge = !file && text.length > MAX_INPUT_BYTES;
  const result = useMemo<Reading>(
    () =>
      file
        ? file.bytes
          ? readCertificates({ bytes: file.bytes })
          : NOTHING
        : blank || tooLarge
          ? NOTHING
          : readCertificates({ text }),
    [file, text, blank, tooLarge],
  );
  const { certificates } = result;
  const current = certificates[Math.min(selected, certificates.length - 1)];
  const links = useMemo(() => chainLinks(certificates), [certificates]);
  const index = Math.min(selected, Math.max(certificates.length - 1, 0));

  // The certificates read are what the history keeps: a person's edit records them by the checkpoint rule.
  const fileOf = (f: OpenFile | null) => (f ? { name: f.name, size: f.size } : undefined);
  useEffect(() => {
    if (certificates.length === 0 || origin.current !== 'edit') return;
    recorder.change(draftOf(certificates));
  }, [certificates, recorder]);
  useEffect(() => {
    if (certificates.length === 0 || origin.current !== 'file' || !file) return;
    void recorder.commit(draftOf(certificates, fileOf(file)));
    origin.current = 'edit';
  }, [certificates, recorder, file]);
  const copied = (): void => {
    if (certificates.length > 0) void recorder.commit(draftOf(certificates, fileOf(file)));
  };

  const edit = (value: string): void => {
    origin.current = 'edit';
    reading.current++;
    setRestored(null);
    setFile(null);
    setSelected(0);
    setText(value);
  };
  const clear = (): void => edit('');

  const open = (chosen: File | undefined): void => {
    if (!chosen) return;
    const ticket = ++reading.current;
    setRestored(null);
    setSelected(0);
    setText('');
    if (chosen.size > MAX_INPUT_BYTES) {
      origin.current = 'edit';
      setFile({ name: chosen.name, size: chosen.size });
      return;
    }
    void chosen.arrayBuffer().then(buffer => {
      if (ticket !== reading.current) return;
      origin.current = 'file';
      setFile({ name: chosen.name, size: chosen.size, bytes: new Uint8Array(buffer) });
    });
  };
  const dropOnField = (event: DragEvent<HTMLTextAreaElement>): void => {
    if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
    event.preventDefault();
    open(event.dataTransfer.files[0]);
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
    const payload = readPayload(opened.payload);
    const blob = opened.blobs.certificates;
    if (!payload || !blob) {
      setRestored('This entry could not be opened.');
      return;
    }
    void blob.text().then(pem => {
      origin.current = 'restore';
      reading.current++;
      setFile(null);
      setSelected(0);
      setText(pem);
      setRestored(
        `Opened from History: ${opened.label ?? 'an entry'}.${payload.file ? ` It was read from ${payload.file.name}.` : ''}`,
      );
    });
  });

  const messages = [
    ...(tooLarge ? [{ tone: 'error' as const, text: TEXT_TOO_LARGE }] : []),
    ...(file && !file.bytes ? [{ tone: 'error' as const, text: FILE_TOO_LARGE }] : []),
    ...result.messages,
  ];
  const count = certificates.length;

  return (
    <div className="flex flex-col gap-3">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      <ToolPane
        label="Input"
        htmlFor="x509-input"
        actions={
          <Button variant="ghost" size="sm" onClick={clear} disabled={text === '' && !file}>
            Clear
          </Button>
        }>
        <Textarea
          id="x509-input"
          className="max-h-72 min-h-32 resize-y font-mono text-code break-all"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          placeholder={PLACEHOLDER}
          value={text}
          onChange={e => edit(e.target.value)}
          onDragOver={e => {
            if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
          }}
          onDrop={dropOnField}
          aria-describedby={messages.length > 0 ? 'x509-messages' : undefined}
        />
        <FileDrop
          onFiles={([chosen]) => open(chosen)}
          label="Drop a certificate file here or"
          choose="Open file"
          accept=".pem,.crt,.cer,.der,.cert,.p7b,.txt,application/x-x509-ca-cert,application/pkix-cert">
          {file && (
            <p className="m-0 text-sm text-muted-foreground" data-file>
              {`${file.name} — ${formatSize(file.size)}`}
            </p>
          )}
        </FileDrop>
        {/* Changes while typing: read out politely (status), not as an alert per keystroke (the recipe over §8). */}
        <div id="x509-messages" className="flex flex-col gap-1">
          {messages.map((m, i) => (
            <ToolMessage key={i} tone={m.tone} role="status" data-message={m.tone}>
              {m.text}
            </ToolMessage>
          ))}
        </div>
      </ToolPane>

      {blank && <ToolEmpty>{EMPTY_STATE}</ToolEmpty>}

      {count >= 2 && (
        <div className="flex flex-wrap items-center gap-3" data-chain-switch>
          <ToggleGroup
            type="single"
            variant="segmented"
            size="sm"
            aria-label="Certificate"
            value={String(index + 1)}
            onValueChange={value => value && setSelected(Number(value) - 1)}>
            {certificates.map((_, i) => (
              <ToggleGroupItem key={i} value={String(i + 1)} aria-label={`Certificate ${i + 1}`}>
                {i + 1}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className="text-sm text-muted-foreground">{`${count} certificates`}</span>
        </div>
      )}

      {current && (
        <CertificateView
          certificate={current}
          chain={count >= 2 ? chainText(links, index) : undefined}
          role={count >= 2 ? (current.ca ? 'CA certificate' : 'End-entity certificate') : undefined}
          onCopied={copied}
        />
      )}

      <p className="m-0 text-sm text-muted-foreground" data-hint>
        {HINT}
      </p>
    </div>
  );
};

export default X509Tool;
