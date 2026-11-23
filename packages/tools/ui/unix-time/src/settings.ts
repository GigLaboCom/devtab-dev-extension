/**
 * What the Unix Time tool remembers between uses (D21; docs/tools/settings.md): how a number is read (Unit) and the
 * time zone the instant is shown in — never the timestamp or date typed, nor any result (the history keeps those, D17).
 *
 * The zone's default is the browser's, read each time: a zone never chosen follows the browser, and choosing the
 * browser's own zone stores nothing. A stored zone is used only under the name the picker lists (an old or unknown
 * name falls back to the browser's zone).
 */
import { browserTimeZone, resolveTimeZone } from '@workspace/tool-logic-unix-time';
import { declareSettings, setting } from '@workspace/tools-host';

export const unixTimeSettings = declareSettings({
  schema: 1,
  fields: {
    unit: setting.oneOf(['auto', 's', 'ms', 'us', 'ns'], 'auto'),
    timeZone: setting.text({ maxLength: 64, test: zone => resolveTimeZone(zone) === zone }, () => browserTimeZone()),
  },
});
