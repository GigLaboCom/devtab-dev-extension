/**
 * Notes under the document (docs/tools/specs/json-schema.md §5 п. 6, §6): repeated keys — every value is checked — and
 * numbers a double cannot hold, which this tool keeps as written and compares exactly.
 */
import type { JsonNotes } from '@workspace/tools-shared/json-scan';

export const documentNotes = (notes: Pick<JsonNotes, 'duplicateKeys' | 'inexactNumbers'>): string[] => {
  const out: string[] = [];
  const d = notes.duplicateKeys;
  if (d.length > 0) {
    const first = d[0]!;
    const where = `${JSON.stringify(first.key)} at line ${first.line}, column ${first.column}`;
    out.push(
      d.length === 1
        ? `Duplicate key ${where}: every value is checked.`
        : `${d.length.toLocaleString('en-US')} duplicate keys, the first: ${where}. Every value is checked.`,
    );
  }
  const n = notes.inexactNumbers;
  if (n > 0)
    out.push(
      `${n === 1 ? '1 number is' : `${n.toLocaleString('en-US')} numbers are`} kept as written and compared exactly: JSON.parse in JavaScript would change ${n === 1 ? 'it' : 'them'}.`,
    );
  return out;
};
