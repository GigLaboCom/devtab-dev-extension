/**
 * What the SVG to CSS tool remembers between uses (D21; docs/tools/settings.md): Output, Encoding and Minify — never the
 * SVG, a file's name or the CSS (the history keeps the SVG and the options, D17). A paste from the start page and an
 * opened file bring only the SVG; the options stay as saved. The outputs allowed are the page's own list.
 */
import { OUTPUTS } from './entries';
import { DEFAULT_OPTIONS } from '@workspace/tool-logic-svg-to-css';
import { declareSettings, setting } from '@workspace/tools-host';
import type { Encoding } from '@workspace/tool-logic-svg-to-css';

export const svgToCssSettings = declareSettings({
  schema: 1,
  fields: {
    output: setting.oneOf(OUTPUTS, DEFAULT_OPTIONS.output),
    encoding: setting.oneOf<Encoding>(['url', 'base64'], DEFAULT_OPTIONS.encoding),
    minify: setting.boolean(DEFAULT_OPTIONS.minify),
  },
});
