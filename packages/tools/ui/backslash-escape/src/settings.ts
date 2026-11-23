/**
 * What the String Escape tool remembers between uses (D21; docs/tools/settings.md): the direction, the dialect, its
 * quote and both options — never the input or the result (the history keeps those, D17). A new dialect starts from the
 * double quote, and both are saved; a quote the saved dialect does not have opens as the double quote (the component
 * checks it). Swap is the person's change of direction and is saved; a paste from the start page opens Unescape
 * without With quotes for that visit only, in the saved dialect.
 */
import { DIALECTS } from '@workspace/tool-logic-backslash-escape';
import { declareSettings, setting } from '@workspace/tools-host';

export const backslashEscapeSettings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['escape', 'unescape'], 'escape'),
    dialect: setting.oneOf(DIALECTS, 'json'),
    quote: setting.oneOf(['"', "'", '`'], '"'),
    nonAscii: setting.boolean(false),
    withQuotes: setting.boolean(false),
  },
});
