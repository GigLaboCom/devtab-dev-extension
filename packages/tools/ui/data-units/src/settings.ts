/**
 * What the Data Units tool remembers between uses (D21; docs/tools/settings.md §3): the task, how KB, MB, GB are read,
 * the digits shown and what Transfer time solves for — never a value, a size, a rate, a time or the overhead (they are
 * the input; the history keeps them, D17).
 */
import { declareSettings, setting } from '@workspace/tools-host';

export const dataUnitsSettings = declareSettings({
  schema: 1,
  fields: {
    task: setting.oneOf(['convert', 'transfer', 'suffixes'], 'convert'),
    reading: setting.oneOf(['decimal', 'binary'], 'decimal'),
    digits: setting.oneOf(['exact', 3, 6, 9, 12, 15], 'exact'),
    solve: setting.oneOf(['time', 'rate', 'size'], 'time'),
  },
});
