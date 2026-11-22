/**
 * The code on the page (docs/tools/specs/qr.md §5.4): SVG elements React builds — a white square and one black path —
 * not an `<img>`, so no image address is involved under the extension's `img-src 'self'`. The colours are the content
 * a camera reads, black on white in every theme, so they are `fill` attributes (a plain attribute the policy and the
 * style contract do not govern, as the Color tool's swatch), not tokens. 256 × 256 by class; `crispEdges` keeps every
 * module sharp at whatever scale the browser picks.
 */
import { DARK, LIGHT, sideOf, svgPath } from '@workspace/tool-logic-qr';
import { useMemo } from 'react';
import type { ReactElement } from 'react';

export const QrCode = ({ modules, quiet }: { modules: boolean[][]; quiet: number }): ReactElement => {
  const n = sideOf(modules.length, quiet);
  const d = useMemo(() => svgPath(modules, quiet), [modules, quiet]);
  return (
    <svg
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code"
      className="size-64 shrink-0"
      data-qr-code>
      <rect width={n} height={n} fill={LIGHT} />
      <path d={d} fill={DARK} />
    </svg>
  );
};
