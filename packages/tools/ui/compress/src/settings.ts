/**
 * What Compress / Decompress remembers between uses (D21; docs/tools/settings.md §3): the direction, each direction's
 * format and input encoding, the zstd level and the brotli quality, Keep the file's name and time, and how each
 * direction shows its result — never the input, a file or its name, or the result (the history keeps the input, D17).
 * Text handed over from the start page opens Decompress · Auto in Base64 or Hex for that visit only; a file dropped,
 * pasted or chosen, an opened entry and Decompress again choose for the visit only as well. A saved zstd or brotli loads
 * nothing: a format's worker starts with the first input there is to work on.
 */
import {
  BROTLI_QUALITIES,
  DEFAULT_BROTLI_QUALITY,
  DEFAULT_ZSTD_LEVEL,
  ZSTD_LEVELS,
} from '@workspace/tool-logic-compress';
import { declareSettings, setting } from '@workspace/tools-host';

export const compressSettings = declareSettings({
  schema: 1,
  fields: {
    direction: setting.oneOf(['decompress', 'compress'], 'decompress'),
    dFormat: setting.oneOf(['auto', 'gzip', 'zlib', 'deflate-raw', 'zstd', 'brotli'], 'auto'),
    cFormat: setting.oneOf(['gzip', 'zlib', 'deflate-raw', 'zstd', 'brotli'], 'gzip'),
    zstdLevel: setting.oneOf(ZSTD_LEVELS, DEFAULT_ZSTD_LEVEL),
    brotliQuality: setting.oneOf(BROTLI_QUALITIES, DEFAULT_BROTLI_QUALITY),
    keepName: setting.boolean(false),
    dInput: setting.oneOf(['base64', 'hex', 'file'], 'base64'),
    cInput: setting.oneOf(['text', 'hex', 'base64', 'file'], 'text'),
    /** Decompress's view; `auto`: Text when the result is text, else Hex (the page's own choice). */
    view: setting.oneOf(['auto', 'text', 'hex', 'base64'], 'auto'),
    encoding: setting.oneOf(['base64', 'base64url', 'hex'], 'base64'),
  },
});
