/**
 * What HTML Preview remembers between uses (D21; docs/tools/settings.md): the width of the preview — a choice of view.
 * Never the HTML (the history keeps it, D17) or what the preview shows. The width sets only how wide the frame is: the
 * frame's sandbox and its policy are the tool's constants, the same whatever is saved.
 */
import { WIDTHS } from './entries';
import { declareSettings, setting } from '@workspace/tools-host';

export const htmlPreviewSettings = declareSettings({
  schema: 1,
  fields: {
    width: setting.oneOf(
      WIDTHS.map(w => w.value),
      'fit',
    ),
  },
});
