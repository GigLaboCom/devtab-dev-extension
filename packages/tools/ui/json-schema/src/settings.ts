/**
 * What the JSON Schema tool remembers between uses (D21; docs/tools/settings.md §3, row `json-schema`): the task, the
 * draft for a schema without `$schema`, whether formats are checked, and generation's options. Never the schema, the
 * document, the referenced schemas, the samples or a result: the history keeps those (D17).
 */
import { declareSettings, setting } from '@workspace/tools-host';

const DRAFT_IDS = ['2020-12', '2019-09', 'draft-07', 'draft-06', 'draft-04'] as const;

export const jsonSchemaSettings = declareSettings({
  schema: 1,
  fields: {
    task: setting.oneOf(['validate', 'infer'], 'validate'),
    draft: setting.oneOf(DRAFT_IDS, '2020-12'),
    formats: setting.boolean(false),
    inferDraft: setting.oneOf(DRAFT_IDS, '2020-12'),
    enums: setting.boolean(false),
    inferFormats: setting.boolean(false),
    closed: setting.boolean(false),
  },
});
