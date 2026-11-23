/**
 * What the Code Formatter remembers between uses (D21; docs/tools/settings.md): the Language choice (Auto or a
 * language) and the one set of options for every language — Indent (Tab is kept while YAML shows 2 spaces), Line width,
 * Semicolons, Quotes, Trailing commas, Whitespace, Prose wrap — never the code, the result or a file's name (the history
 * keeps the code, D17). A paste from the start page opens Auto and an opened file its own language, both for that visit
 * only. The allowed values are the page's own lists; a value a list no longer has opens as its default.
 */
import { DEFAULT_SETTINGS, LANGUAGES } from '@workspace/tool-logic-code-format';
import { declareSettings, setting } from '@workspace/tools-host';

export const codeFormatSettings = declareSettings({
  schema: 1,
  fields: {
    language: setting.oneOf(['auto', ...LANGUAGES], 'auto'),
    indent: setting.oneOf([2, 4, 'tab'], DEFAULT_SETTINGS.indent),
    lineWidth: setting.oneOf([80, 100, 120], DEFAULT_SETTINGS.lineWidth),
    semi: setting.boolean(DEFAULT_SETTINGS.semi),
    singleQuote: setting.boolean(DEFAULT_SETTINGS.singleQuote),
    trailingComma: setting.oneOf(['all', 'es5', 'none'], DEFAULT_SETTINGS.trailingComma),
    whitespace: setting.oneOf(['css', 'strict', 'ignore'], DEFAULT_SETTINGS.whitespace),
    proseWrap: setting.oneOf(['preserve', 'always', 'never'], DEFAULT_SETTINGS.proseWrap),
  },
});
