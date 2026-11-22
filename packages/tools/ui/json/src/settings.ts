/**
 * What the JSON tool remembers between uses (D21; docs/tools/settings.md): its options — never the input, the result
 * or a file's name (the history keeps those, D17).
 */
import { declareSettings, setting } from '@workspace/tools-host';

export const jsonSettings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['format', 'minify'], 'format'),
    indent: setting.oneOf([2, 4, 'tab'], 2),
    sortKeys: setting.boolean(false),
    allowComments: setting.boolean(false),
  },
});
