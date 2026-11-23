/**
 * What the Hex and Text tool remembers between uses (D21; docs/tools/settings.md): the direction, the encoding (one for
 * both directions), the Text to hex format, Uppercase and Bytes per line (kept while Dump greys it out) — never the text,
 * the hex or the result (the history keeps those, D17). Swap is the person's change of direction and is saved; a paste
 * from the start page opens Hex to text for that visit only. The allowed values are the page's own option lists.
 */
import { BYTES_PER_LINE, ENCODINGS, FORMATS } from './entries';
import { declareSettings, setting } from '@workspace/tools-host';

export const hexAsciiSettings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['to-hex', 'to-text'], 'to-hex'),
    encoding: setting.oneOf(
      ENCODINGS.map(e => e.value),
      'utf-8',
    ),
    format: setting.oneOf(
      FORMATS.map(f => f.value),
      'plain',
    ),
    uppercase: setting.boolean(false),
    bytesPerLine: setting.oneOf(
      BYTES_PER_LINE.map(b => b.value),
      0,
    ),
  },
});
