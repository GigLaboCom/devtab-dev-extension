/**
 * What the UUID / ULID tool remembers between uses (D21; docs/tools/settings.md): what is generated and how it is
 * written — the type, how many, the format, uppercase, the namespace and a custom namespace (a project's namespace,
 * used with many names). Never a name (the data an identifier is made from), a generated identifier or an inspected
 * one (the history keeps those, D17).
 *
 * How many and the custom namespace are saved only when their field holds a valid value (a number being typed, a
 * namespace half pasted are not saved); a text pasted into Inspect touches none of them.
 */
import { MAX_COUNT, namespaceBytes } from '@workspace/tool-logic-uuid';
import { declareSettings, setting } from '@workspace/tools-host';

export const uuidSettings = declareSettings({
  schema: 1,
  fields: {
    type: setting.oneOf(['v4', 'v7', 'ulid', 'v5', 'v3', 'nil', 'max'], 'v4'),
    count: setting.integer({ min: 1, max: MAX_COUNT }, 1),
    format: setting.oneOf(['standard', 'no-hyphens', 'braces', 'urn'], 'standard'),
    uppercase: setting.boolean(false),
    namespace: setting.oneOf(['dns', 'url', 'oid', 'x500', 'custom'], 'dns'),
    customNamespace: setting.text({ maxLength: 64, test: s => s === '' || namespaceBytes(s) !== null }, ''),
  },
});
