/**
 * What the HTML to JSX tool remembers between uses (D21; docs/tools/settings.md): Wrap in a component — never the HTML
 * or the JSX (the history keeps those, D17). Text handed over by the host brings only the markup; the option stays as
 * saved.
 */
import { declareSettings, setting } from '@workspace/tools-host';

export const htmlToJsxSettings = declareSettings({
  schema: 1,
  fields: {
    component: setting.boolean(false),
  },
});
