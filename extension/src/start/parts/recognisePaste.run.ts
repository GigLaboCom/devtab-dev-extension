/**
 * Opening a tool for pasted text — the code: the tools' `detect` in the order of the tools among the page's places,
 * asked for as soon as this loads (the page loads it when idle after its first paint, or at the first paste). Two steps,
 * this module and then the detectors' chunk, so the page's first chunk preloads nothing that grows with the tools.
 */
import { toolRecogniser } from '../../tools/toolRecogniser';
import type { OptionCode } from '../part';
import type { PartDeps } from './deps';

const TOOL_PLACE = /^tools\/(.+)$/;

export const create = (deps: PartDeps): OptionCode => {
  const recognise = toolRecogniser(deps.destinations.flatMap(d => TOOL_PLACE.exec(d.id)?.[1] ?? []));
  recognise.ready().catch(() => undefined);
  return { context: { recognise } };
};
