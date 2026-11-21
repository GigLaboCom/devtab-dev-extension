/**
 * The details under the fields (docs/tools/specs/number-base.md §5 «Подробности», §8): Signed and Unsigned in two's
 * complement, the lengths in bits and bytes, and the bytes both ways — each value in the code font with its copy icon.
 * A bytes row shows 64 bytes and the count of the rest; its copy button copies all of them.
 */
import { clipBytes, numberDetails } from '@workspace/tool-logic-number-base';
import { ResultRow, ResultRows } from '@workspace/ui/result-row';
import { useMemo } from 'react';
import type { NegativeMode, Width } from '@workspace/tool-logic-number-base';
import type { ReactElement } from 'react';

const ICON_RESET_MS = 1500;
const NO_BYTES = "Switch to two's complement to see the bytes of a negative number.";

interface DetailsProps {
  value: bigint;
  state: { negative: NegativeMode; width: Width; uppercase: boolean };
  onCopied?: (text: string) => void;
}

interface Row {
  key: string;
  label: string;
  value: string | null;
  /** What the copy button copies when it is not what is shown. */
  copy?: string;
}

export const Details = ({ value, state, onCopied }: DetailsProps): ReactElement => {
  const { negative, width, uppercase } = state;
  const d = useMemo(() => numberDetails(value, { negative, width, uppercase }), [value, negative, width, uppercase]);
  const bytes = (text: string | null) => (text === null ? null : clipBytes(text));
  const rows: Row[] = [
    ...(d.signed !== undefined ? [{ key: 'signed', label: 'Signed', value: d.signed }] : []),
    ...(d.unsigned !== undefined ? [{ key: 'unsigned', label: 'Unsigned', value: d.unsigned }] : []),
    { key: 'bit-length', label: 'Bit length', value: String(d.bitLength) },
    { key: 'byte-length', label: 'Byte length', value: String(d.byteLength) },
    {
      key: 'bytes-be',
      label: 'Bytes (big-endian)',
      value: bytes(d.bytesBigEndian),
      copy: d.bytesBigEndian ?? undefined,
    },
    {
      key: 'bytes-le',
      label: 'Bytes (little-endian)',
      value: bytes(d.bytesLittleEndian),
      copy: d.bytesLittleEndian ?? undefined,
    },
  ];
  return (
    <ResultRows aria-label="Details" role="group">
      {rows.map(row => (
        <ResultRow
          key={row.key}
          data-row={row.key}
          label={row.label}
          value={row.value ?? ''}
          empty="—"
          copyLabel={`Copy ${row.label.charAt(0).toLowerCase()}${row.label.slice(1)}`}
          copy={{ resetAfterMs: ICON_RESET_MS, onCopied, ...(row.copy !== undefined ? { value: row.copy } : {}) }}
          {...(row.key === 'bytes-be' && row.value === null ? { extra: NO_BYTES, extraBelow: true } : {})}
        />
      ))}
    </ResultRows>
  );
};
