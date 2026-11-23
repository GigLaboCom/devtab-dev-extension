/**
 * What the YAML and JSON tool remembers between uses (D21; docs/tools/settings.md): the direction, the YAML version
 * read in YAML → JSON, the JSON indent of YAML → JSON and the YAML indent of JSON → YAML — each indent its own field,
 * kept while the other direction is shown. Never the input, a file or its name, or the result (the history keeps the
 * input and the result, D17).
 *
 * Swap is the person's change of direction and is saved. A text handed over from the start page (recognised as YAML)
 * opens YAML → JSON, and a file opens the direction its extension names — both for that visit only.
 */
import { declareSettings, setting } from '@workspace/tools-host';

export const yamlJsonSettings = declareSettings({
  schema: 1,
  fields: {
    direction: setting.oneOf(['yaml-to-json', 'json-to-yaml'], 'yaml-to-json'),
    version: setting.oneOf(['1.2', '1.1'], '1.2'),
    jsonIndent: setting.oneOf([2, 4, 'tab', 'minify'], 2),
    yamlIndent: setting.oneOf([2, 4], 2),
  },
});
