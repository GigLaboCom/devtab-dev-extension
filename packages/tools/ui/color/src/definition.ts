/**
 * The Color tool as a host lists it (docs/tools/specs/color.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { colorHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'color',
  title: 'Color',
  summary: 'Convert a CSS colour between hex, rgb, hsl, oklch and more; check contrast.',
  keywords: [
    'color',
    'colour',
    'hex',
    'rgb',
    'hsl',
    'hwb',
    'lab',
    'lch',
    'oklab',
    'oklch',
    'display-p3',
    'contrast',
    'wcag',
    'css',
  ],
  order: 13,
  history: colorHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./ColorTool'),
};
