/**
 * What the tool history keeps of the QR Code tool (D17; docs/tools/history.md §10, row `qr`). The kind is picked by the
 * code's content — the tool's logic decides (`secretContent`), the host does not branch:
 *   - a code made of text, and a code read from an image: in clear;
 *   - Wi-Fi details (the network's name, type and password) — made with the form, typed as `WIFI:…` or read — and, read
 *     cautiously, the key of a one-time password (`otpauth://`): secret kinds, kept only encrypted, with a master password
 *     set and the history unlocked, and not at all otherwise.
 * Kept: the text (or the Wi-Fi fields) and the level, quiet zone and PNG size — the code is made again from them, the
 * same picture with the same library. Never kept: the image a person gave (only the text read from it) and the code's
 * PNG or SVG files. The declaration only — payloads and labels are entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const qrHistory: HistoryDeclaration = {
  kinds: [
    { id: 'made', title: 'Made' },
    { id: 'made-secret', title: 'Made: Wi-Fi or one-time key', secret: true },
    { id: 'read', title: 'Read' },
    { id: 'read-secret', title: 'Read: Wi-Fi or one-time key', secret: true },
  ],
  schema: 1,
  records:
    'The text you made a code of, with the level, quiet zone and PNG size, and the text read from an image. Wi-Fi details and one-time password keys only encrypted, with a master password.',
  never:
    'The images you give it and the code’s image files (they are made again from the text). Wi-Fi details and one-time password keys without a master password or while the history is locked.',
};
