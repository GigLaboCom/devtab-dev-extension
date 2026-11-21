/**
 * The converter as a chunk of its own: `convert.ts` and the `yaml` library are loaded on first use (by the tool's
 * worker, or by its page where there are no workers), never with the tool's definition on the start page.
 */
import type * as convert from './convert';

export type Converter = typeof convert;

export const loadConverter = (): Promise<Converter> => import('./convert');
