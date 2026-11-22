/**
 * Making a code (docs/tools/specs/qr.md §5.1–§5.2) with `qr` 0.7.2 — the making half of the library, which a host
 * loads only when the first code is needed (the component imports this module lazily). The library picks the smallest
 * version that fits, the mask with the lowest penalty of ISO/IEC 18004 §7.8.3 and one mode for the whole text; byte mode
 * is UTF-8 with no ECI header (§5.1). It insists on a quiet zone of at least one module: the tool asks for one and cuts
 * it off, and draws its own (§5.4).
 */
import { capacityCheck } from './logic';
import { encodeQR } from 'qr';
import type { BuildResult, Level } from './logic';

const ECC = { L: 'low', M: 'medium', Q: 'quartile', H: 'high' } as const;

export const buildQr = (text: string, level: Level): BuildResult => {
  if (text === '') return { ok: false, empty: true };
  const check = capacityCheck(text, level);
  if (!check.fits) return { ok: false, message: check.message! };
  // The capacities above are the library's own limits (§10 checks all twelve), so it does not throw here.
  const raw = encodeQR(text, 'raw', { ecc: ECC[level], border: 1 });
  const modules = raw.slice(1, -1).map(row => row.slice(1, -1));
  return {
    ok: true,
    modules,
    size: modules.length,
    version: (modules.length - 17) / 4,
    mode: check.mode,
    units: check.units,
  };
};
