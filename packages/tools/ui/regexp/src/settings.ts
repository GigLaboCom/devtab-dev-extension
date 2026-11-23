/**
 * What the RegExp tool remembers between uses (D21; docs/tools/settings.md): the flags the person turned on and whether
 * Replace is on. Never the pattern, the test text or the replacement (input — the history keeps those, D17), the
 * matches or the result, nor the one-off Allow 10 seconds and the selected match.
 *
 * The flags are kept as the toggles write them: in canonical order, without the tool's own `d`, `u` and `v` never
 * together. Flags that came with a literal pasted into Pattern, or with Keep as pasted, are for that visit only; the
 * person's next toggle saves the flags then shown.
 */
import { declareSettings, setting } from '@workspace/tools-host';

export const regexpSettings = declareSettings({
  schema: 1,
  fields: {
    flags: setting.text({ maxLength: 6, test: s => /^g?i?m?s?[uv]?y?$/.test(s) }, 'g'),
    replace: setting.boolean(false),
  },
});
