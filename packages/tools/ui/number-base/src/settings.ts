/**
 * What the Number Bases tool remembers between uses (D21; docs/tools/settings.md): how negative numbers are read and
 * written, the width of two's complement (kept while Minus sign turns it off), the three switches of the output and the
 * N of the Base field. Never a number in any field or the details (input and what follows from it — the history keeps
 * those, D17).
 *
 * N is saved only when its field holds a valid base (a `3` on the way to `36` is a base too; an empty field or `37` is
 * not saved, and what was saved stays). A text handed over from the start page goes into the field its prefix names and
 * changes no option.
 */
import { WIDTHS } from '@workspace/tool-logic-number-base';
import { declareSettings, setting } from '@workspace/tools-host';

export const numberBaseSettings = declareSettings({
  schema: 1,
  fields: {
    negative: setting.oneOf(['sign', 'twos'], 'sign'),
    width: setting.oneOf(WIDTHS, 32),
    uppercase: setting.boolean(false),
    grouped: setting.boolean(false),
    prefixes: setting.boolean(false),
    radix: setting.integer({ min: 2, max: 36 }, 36),
  },
});
