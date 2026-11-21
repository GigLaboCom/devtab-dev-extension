/**
 * The colour shown as a colour (docs/tools/specs/color.md §5.7). The extension's policy forbids `style` attributes and
 * the style contract keeps inline styles to geometry, so a colour that is the person's content — not the product's look
 * — is the `fill` attribute of an SVG shape: a plain attribute, set by React like any other, which the content security
 * policy does not govern and which takes any CSS colour (`oklch()` beyond sRGB is painted in the screen's gamut). The
 * frame, the checkerboard under a translucent colour and the text are theme tokens. These are the only colours of the
 * extension not taken from a token.
 */
import { useId } from 'react';
import type { Formats } from '@workspace/tool-logic-color';
import type { ReactElement } from 'react';

/** An id usable inside `url(#…)`: React's own ids carry punctuation. */
const useSvgId = (name: string): string => `${name}-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;

/** 8 × 8 cells of the two theme greys, under a translucent colour. */
const Checks = ({ id }: { id: string }): ReactElement => (
  <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse">
    <rect width="16" height="16" className="fill-background" />
    <rect width="8" height="8" className="fill-muted" />
    <rect x="8" y="8" width="8" height="8" className="fill-muted" />
  </pattern>
);

const Frame = ({ width, height }: { width: number; height: number }): ReactElement => (
  <rect
    x="0.5"
    y="0.5"
    width={width - 1}
    height={height - 1}
    fill="none"
    strokeWidth="1"
    className="stroke-border"
    data-swatch-frame
  />
);

/**
 * The swatch, 96 × 48: the colour (its 8-bit HEX); out of sRGB, two halves — as written (full-precision `oklch()`)
 * and the sRGB HEX the formats show, captioned; under a translucent colour, the checkerboard; empty, the frame.
 */
export const Swatch = ({ formats, translucent }: { formats: Formats | null; translucent: boolean }): ReactElement => {
  const checks = useSvgId('swatch-checks');
  const split = formats !== null && !formats.inSrgb;
  const label =
    formats === null
      ? 'No colour'
      : split
        ? `Swatch: ${formats.swatch} as written, ${formats.hex} in sRGB`
        : `Swatch: ${formats.hex}`;
  return (
    <figure className="m-0 flex w-24 shrink-0 flex-col gap-1" data-swatch>
      <svg viewBox="0 0 96 48" width="96" height="48" role="img" aria-label={label}>
        <defs>
          <Checks id={checks} />
        </defs>
        {formats && translucent && <rect width="96" height="48" fill={`url(#${checks})`} />}
        {formats && !split && <rect width="96" height="48" fill={formats.hex} data-fill="color" />}
        {formats && split && (
          <>
            <rect width="48" height="48" fill={formats.swatch} data-fill="as-written" />
            <rect x="48" width="48" height="48" fill={formats.hex} data-fill="srgb" />
          </>
        )}
        <Frame width={96} height={48} />
      </svg>
      {split && (
        <figcaption className="flex justify-between text-xs whitespace-nowrap text-muted-foreground" aria-hidden="true">
          <span>As written</span>
          <span>sRGB</span>
        </figcaption>
      )}
    </figure>
  );
};

/**
 * The contrast sample, 240 × 72: the background and the text colour, both 8-bit after blending (§5.6), so the sample
 * matches the number. A picture: its text sizes are user units of its view box — WCAG's normal (16 px) and large
 * (24 px, bold) text at 1 : 1 — since the type scale of the style package stops at 18 px.
 */
export const ContrastSample = ({
  foreground,
  background,
}: {
  foreground: string;
  background: string;
}): ReactElement => (
  <svg
    viewBox="0 0 240 72"
    width="240"
    height="72"
    role="img"
    aria-label={`Sample: text ${foreground} on ${background}`}
    className="shrink-0"
    data-contrast-sample>
    <rect width="240" height="72" fill={background} data-fill="background" />
    <text x="12" y="28" fontSize="16" fill={foreground} className="font-sans font-normal" data-fill="text">
      Normal text
    </text>
    <text x="12" y="58" fontSize="24" fill={foreground} className="font-sans font-semibold">
      Large text
    </text>
    <Frame width={240} height={72} />
  </svg>
);
