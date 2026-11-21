/** The note lines under the result (docs/tools/specs/yaml-json.md §5 «Заметки»), in their order. */
import type { ConvertNotes, Direction } from './types';

/** What JSON cannot carry. The specification's text, with the styles it lists among the losses (§15). */
export const LOST_IN_JSON = 'JSON has no comments, anchors, tags or YAML styles: they are not carried over.';
export const ALIASES_EXPANDED = 'Aliases were expanded and merge keys (<<) applied: JSON has no references.';

const count = (n: number): string => n.toLocaleString('en-US');

export const describeNotes = (notes: ConvertNotes, direction: Direction): string[] => {
  const lines: string[] = [];
  if (direction === 'yaml-to-json') {
    lines.push(LOST_IN_JSON);
    if (notes.aliasesExpanded) lines.push(ALIASES_EXPANDED);
    if (notes.documents > 1)
      lines.push(`${count(notes.documents)} YAML documents became a JSON array of ${count(notes.documents)} items.`);
    const [first] = notes.unknownTags;
    if (first) {
      const at = `${first.message} at line ${first.line}, column ${first.column}`;
      lines.push(
        notes.unknownTags.length === 1
          ? `Unknown tag ${at} was dropped; the value is kept as plain YAML.`
          : `${count(notes.unknownTags.length)} unknown tags were dropped, the first: ${at}; the values are kept as plain YAML.`,
      );
    }
  }
  const n = notes.inexactNumbers;
  if (n === 1)
    lines.push(
      "1 number is kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change it.",
    );
  else if (n > 1)
    lines.push(
      `${count(n)} numbers are kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change them.`,
    );
  return lines;
};
