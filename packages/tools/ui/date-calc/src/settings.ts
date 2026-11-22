/**
 * What the Date Calculator remembers between uses (D21; docs/tools/settings.md): the list of time zones the person
 * built in Time zones, and Add or Subtract — never a moment, a duration or the zone beside a moment field (they are the
 * input; the history keeps them, D17).
 *
 * The list's default is the page's own (docs/defaults.md §3): the browser's zone and UTC, or UTC alone where the
 * browser's zone is UTC — read each time the default is needed, so it follows the browser. A saved list keeps only names this browser knows, as
 * the list shows them, at most MAX_ZONES, no repeats; anything else is the default list.
 */
import { MAX_ZONES, browserTimeZone, resolveTimeZone } from '@workspace/tool-logic-date-calc';
import { declareSettings, setting } from '@workspace/tools-host';

/** The list the Time zones part opens with when nothing is saved. */
export const defaultZones = (zone: string): readonly string[] => (zone === 'UTC' ? ['UTC'] : [zone, 'UTC']);

export const dateCalcSettings = declareSettings({
  schema: 1,
  fields: {
    zones: setting.list({ maxItems: MAX_ZONES, item: zone => resolveTimeZone(zone) === zone }, () =>
      defaultZones(browserTimeZone()),
    ),
    operation: setting.oneOf(['add', 'subtract'], 'add'),
  },
});
