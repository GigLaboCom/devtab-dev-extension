/**
 * The Image Converter tool's logic (docs/tools/specs/image-convert.md §9). Pure: no React, no DOM, no chrome — pixels
 * come in as arrays, files as their bytes. Decoding, drawing and encoding are the browser's and live in the ui package's
 * worker; here is everything that can be said and written without them: types and header facts, an SVG's own size,
 * the size of a result, the `.ico` and `.zip` containers, icon presets, names and numbers.
 */
export type * from './types';
export * from './limits';
export * from './format';
export * from './sniff';
export * from './header';
export * from './svg';
export * from './resize';
export * from './inspect';
export * from './ico';
export * from './zip';
export * from './icons';
export * from './names';
