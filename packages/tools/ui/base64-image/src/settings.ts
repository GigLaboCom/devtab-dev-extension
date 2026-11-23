/**
 * What Base64 Image remembers between uses (D21; docs/tools/settings.md): the direction, Encode's output form and its
 * line length (kept while another form hides it). Never an image, its name, the Base64 text or the image it holds (the
 * history keeps those, D17).
 *
 * A text handed over opens Decode, an image dropped, chosen or pasted switches to Encode, and image data pasted in
 * Encode switches to Decode — each for that visit only: the content chose the direction, not the person.
 */
import { declareSettings, setting } from '@workspace/tools-host';
import type { SettingsValues } from '@workspace/tools-host';

export const base64ImageSettings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['encode', 'decode'], 'encode'),
    form: setting.oneOf(['dataUri', 'base64', 'img', 'css'], 'dataUri'),
    lineLength: setting.oneOf([0, 64, 76], 0),
  },
});

export type Base64ImageSettings = SettingsValues<typeof base64ImageSettings>;
