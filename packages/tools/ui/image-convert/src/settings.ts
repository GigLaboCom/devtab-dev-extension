/**
 * What the Image Converter remembers between uses (D21; docs/tools/settings.md §3, row 44): the task, the output format
 * and its quality, Lossless, the background colour, how the size is chosen and its numbers, Fit, Allow enlarging, the
 * sizes of favicon.ico, how its images are written and the icon sets — every choice that configures how it works.
 * Never a file, its name or a result: files are the input (the history keeps their types and sizes only, D17).
 */
import {
  ICO_SIZES,
  ICON_SET_IDS,
  MAX_PERCENT,
  MAX_PX,
  MAX_QUALITY,
  MIN_PERCENT,
  MIN_QUALITY,
} from '@workspace/tool-logic-image-convert';
import { declareSettings, setting } from '@workspace/tools-host';

export const DEFAULT_BACKGROUND = '#ffffff';
const HEX_COLOUR = /^#[0-9a-f]{6}$/;

export const imageConvertSettings = declareSettings({
  schema: 1,
  fields: {
    task: setting.oneOf(['convert', 'icons'], 'convert'),
    format: setting.oneOf(['png', 'jpeg', 'webp'], 'png'),
    jpegQuality: setting.integer({ min: MIN_QUALITY, max: MAX_QUALITY }, 85),
    webpQuality: setting.integer({ min: MIN_QUALITY, max: MAX_QUALITY }, 80),
    lossless: setting.boolean(false),
    background: setting.text({ maxLength: 7, test: text => HEX_COLOUR.test(text) }, DEFAULT_BACKGROUND),
    sizeMode: setting.oneOf(['original', 'width', 'height', 'both', 'percent'], 'original'),
    // 0: the field is empty (the page opens with empty Width and Height).
    width: setting.integer({ min: 0, max: MAX_PX }, 0),
    height: setting.integer({ min: 0, max: MAX_PX }, 0),
    percent: setting.integer({ min: MIN_PERCENT, max: MAX_PERCENT }, 100),
    fit: setting.oneOf(['contain', 'cover', 'exact'], 'contain'),
    enlarge: setting.boolean(false),
    icoSizes: setting.list({ maxItems: ICO_SIZES.length, item: s => ICO_SIZES.map(String).includes(s) }, [
      '16',
      '32',
      '48',
    ]),
    icoImages: setting.oneOf(['png', 'bmp'], 'png'),
    sets: setting.list({ maxItems: ICON_SET_IDS.length, item: s => (ICON_SET_IDS as readonly string[]).includes(s) }, [
      'favicon',
    ]),
  },
});
