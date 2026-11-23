/**
 * What the QR Code tool remembers between uses (D21; docs/tools/settings.md): how codes are made — the mode, the kind of
 * content, the error correction, the quiet zone and the PNG size. Never what goes into a code: the text, the network's
 * name, its security, its password or whether it is hidden (the network's own details, the code's data), never an image
 * read or the text read from it (the history keeps codes, secret ones only encrypted, D17).
 *
 * A text handed over opens Generate · Text, and an image dropped, pasted or chosen opens Read — both for that visit
 * only; the person pressing Generate / Read or Text / Wi-Fi is what is saved.
 */
import {
  DEFAULT_LEVEL,
  DEFAULT_MODULE_PX,
  DEFAULT_QUIET,
  LEVELS,
  MODULE_PX,
  QUIET_ZONES,
} from '@workspace/tool-logic-qr';
import { declareSettings, setting } from '@workspace/tools-host';
import type { SettingsValues } from '@workspace/tools-host';

export const qrSettings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['generate', 'read'], 'generate'),
    content: setting.oneOf(['text', 'wifi'], 'text'),
    level: setting.oneOf(LEVELS, DEFAULT_LEVEL),
    quiet: setting.oneOf(QUIET_ZONES, DEFAULT_QUIET),
    px: setting.oneOf(MODULE_PX, DEFAULT_MODULE_PX),
  },
});

export type QrSettings = SettingsValues<typeof qrSettings>;
