/**
 * What the Cron tool remembers between uses (D21; docs/tools/settings.md): how the expression is read (Dialect), the
 * time zone the next runs are shown in and how many runs are listed. Never the expression (input — the history keeps
 * it, D17), the description or the runs (results).
 *
 * The zone is kept under the name the zone list shows ("Asia/Kolkata", not "Asia/Calcutta"); one this browser does not
 * know falls back to UTC — §4 of the specification: the zone most schedules read here run in (GitHub Actions,
 * Kubernetes, servers), not the browser's.
 */
import { resolveTimeZone, RUN_COUNTS } from '@workspace/tool-logic-cron';
import { declareSettings, setting } from '@workspace/tools-host';

export const cronSettings = declareSettings({
  schema: 1,
  fields: {
    dialect: setting.oneOf(['auto', 'unix', 'seconds', 'quartz'], 'auto'),
    timeZone: setting.text({ maxLength: 64, test: zone => resolveTimeZone(zone) === zone }, 'UTC'),
    runs: setting.oneOf(RUN_COUNTS, 10),
  },
});
