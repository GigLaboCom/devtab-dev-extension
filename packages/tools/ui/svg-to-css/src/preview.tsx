/**
 * The preview (docs/tools/specs/svg-to-css.md §5 «Предпросмотр») under the extension pages' policy (`img-src 'self'`,
 * `style-src 'self'`: no `data:` images, no inline styles):
 *
 * - The SVG is an `<img>` on an object URL of a Blob of the prepared text — the bytes the data: URI carries — never the
 *   URI itself, never markup in the page, a frame, `<object>` or `<use>`: shown as an image, an SVG runs no script and
 *   loads nothing. One URL per result, revoked when the result changes or the page goes away (`useObjectUrl`).
 * - The frame is 128 × 128 on a checkerboard of the theme's two greys (an SVG pattern with token classes), the image
 *   fitted by a class (`object-contain`).
 * - For `mask-image`, a second tile shows what the mask does: an inline SVG `<mask mask-type="alpha">` holding an
 *   `<image>` on the same URL (an image again: nothing runs or loads), over a rect filled with the theme's foreground —
 *   the shape in the text's colour, as `mask-image` with `background-color: currentColor` paints it. Attributes and
 *   token classes only: no style is set, so the policy has nothing to refuse.
 * - If the image does not load: `The preview could not be shown.` — the result stays (also what would remain if a
 *   later Chrome stopped loading `blob:` images under `'self'`).
 */
import { useEffect, useId, useState } from 'react';
import type { ReactElement } from 'react';

export const PREVIEW_FAILED = 'The preview could not be shown.';
const SIDE = 128;

/** The object URL of the current SVG, revoked when the SVG changes or the component goes away. */
export const useObjectUrl = (svg: string): string | null => {
  const [url, setUrl] = useState<{ of: string; url: string } | null>(null);
  useEffect(() => {
    if (svg === '') return;
    const created = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    setUrl({ of: svg, url: created });
    return () => {
      URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [svg]);
  return url && url.of === svg ? url.url : null;
};

/** An id usable inside `url(#…)`: React's own ids carry punctuation. */
const useSvgId = (name: string): string => `${name}-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;

/** 8 × 8 cells of the two theme greys: transparency and white icons show. */
const Checks = ({ id }: { id: string }): ReactElement => (
  <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse">
    <rect width="16" height="16" className="fill-background" />
    <rect width="8" height="8" className="fill-muted" />
    <rect x="8" y="8" width="8" height="8" className="fill-muted" />
  </pattern>
);

const Board = (): ReactElement => {
  const id = useSvgId('svg-to-css-checks');
  return (
    <svg className="absolute inset-0" width={SIDE} height={SIDE} aria-hidden="true">
      <defs>
        <Checks id={id} />
      </defs>
      <rect width={SIDE} height={SIDE} fill={`url(#${id})`} />
    </svg>
  );
};

const MaskTile = ({ url }: { url: string }): ReactElement => {
  const mask = useSvgId('svg-to-css-mask');
  return (
    <figure className="m-0 flex flex-col gap-1">
      <div className="relative size-32 overflow-hidden rounded-md border border-border">
        <Board />
        <svg
          className="absolute inset-0"
          width={SIDE}
          height={SIDE}
          role="img"
          aria-label="Preview of the SVG as a mask"
          data-part="mask">
          <defs>
            {/* mask-type="alpha" — what mask-image does with an image; set on the element (React's types lack it). */}
            <mask id={mask} ref={el => el?.setAttribute('mask-type', 'alpha')}>
              <image href={url} width={SIDE} height={SIDE} preserveAspectRatio="xMidYMid meet" />
            </mask>
          </defs>
          <rect width={SIDE} height={SIDE} className="fill-foreground" mask={`url(#${mask})`} />
        </svg>
      </div>
      <figcaption className="text-xs text-muted-foreground">As a mask</figcaption>
    </figure>
  );
};

type Shown = 'loading' | 'shown' | 'failed';

/** Keyed by the URL by its caller: a new result starts loading afresh. */
export const Preview = ({ url, mask }: { url: string | null; mask: boolean }): ReactElement => {
  const [state, setState] = useState<Shown>('loading');
  if (state === 'failed')
    return (
      <p className="m-0 text-sm text-muted-foreground" data-preview="failed">
        {PREVIEW_FAILED}
      </p>
    );
  return (
    <div className="flex flex-wrap gap-3" data-preview={url ? state : 'empty'}>
      <figure className="m-0 flex flex-col gap-1">
        <div className="relative size-32 overflow-hidden rounded-md border border-border">
          <Board />
          {url && (
            <img
              src={url}
              alt="Preview of the SVG"
              className="absolute inset-0 size-full object-contain"
              onLoad={() => setState('shown')}
              onError={() => setState('failed')}
            />
          )}
        </div>
        {mask && url && state === 'shown' && (
          <figcaption className="text-xs text-muted-foreground">As an image</figcaption>
        )}
      </figure>
      {mask && url && state === 'shown' && <MaskTile url={url} />}
    </div>
  );
};
