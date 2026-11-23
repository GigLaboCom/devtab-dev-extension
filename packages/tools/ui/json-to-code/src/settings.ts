/**
 * What JSON to Code remembers between uses (D21; docs/tools/settings.md): the language and the TypeScript options
 * (Declaration, Export; kept while another language is chosen) — never the sample, the result or the root type's name
 * (it names this sample's type; the history keeps it with the sample, D17). The languages allowed are the logic's own
 * list: a saved language the list no longer has opens as TypeScript.
 */
import { DEFAULT_OPTIONS, LANGUAGES } from '@workspace/tool-logic-json-to-code';
import { declareSettings, setting } from '@workspace/tools-host';

export const jsonToCodeSettings = declareSettings({
  schema: 1,
  fields: {
    language: setting.oneOf(
      LANGUAGES.map(l => l.value),
      DEFAULT_OPTIONS.language,
    ),
    declaration: setting.oneOf(['interface', 'type'], DEFAULT_OPTIONS.declaration),
    exportTypes: setting.boolean(DEFAULT_OPTIONS.exportTypes),
  },
});
