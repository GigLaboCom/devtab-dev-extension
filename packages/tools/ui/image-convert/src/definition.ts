/**
 * The Image Converter tool as a host lists it (docs/tools/specs/image-convert.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 */
import { imageConvertHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'image-convert',
  title: 'Image Converter',
  summary: 'Convert images between PNG, JPEG and WebP, resize them, rasterise SVG, and make .ico files and icon sets.',
  keywords: ['png to jpg', 'webp', 'resize image', 'favicon', 'ico', 'svg to png', 'icon generator'],
  order: 44,
  history: imageConvertHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./ImageConvertTool'),
};
