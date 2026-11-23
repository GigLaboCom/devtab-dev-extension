/**
 * What the Lorem Ipsum tool remembers between uses (D21; docs/tools/settings.md): Unit, Count, Start with "Lorem
 * ipsum…" and Format — never the text (it is not kept anywhere; the history keeps only the settings, D17). Count is saved
 * only while the field holds a whole number in the unit's range; a change of Unit that brings Count to the unit's limit
 * saves both. A saved Count above its unit's limit opens at that limit, as a change of Unit would make it.
 */
import { DEFAULT_SETTINGS, FORMATS, LIMITS, UNITS } from '@workspace/tool-logic-lorem-ipsum';
import { declareSettings, setting } from '@workspace/tools-host';

export const loremIpsumSettings = declareSettings({
  schema: 1,
  fields: {
    unit: setting.oneOf(UNITS, DEFAULT_SETTINGS.unit),
    count: setting.integer({ min: 1, max: Math.max(...Object.values(LIMITS)) }, DEFAULT_SETTINGS.count),
    startWithLorem: setting.boolean(DEFAULT_SETTINGS.startWithLorem),
    format: setting.oneOf(FORMATS, DEFAULT_SETTINGS.format),
  },
});
