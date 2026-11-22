/**
 * The parts both directions show (docs/tools/specs/base64-image.md §5, §8): the preview — `<img>` on the image's object
 * URL, fitted into a frame up to 320 px high on a flat muted background, the canvas fallback and the lines that replace
 * it — and the facts, a list of «label: value». Presentational: the URL and the image are the caller's.
 */
import { blobImagesLoad, blobOf, decodeBitmap } from './image';
import { base64Length, formatSize } from '@workspace/tool-logic-base64-image';
import { useEffect, useRef, useState } from 'react';
import type { DecodedImage, Dimensions } from '@workspace/tool-logic-base64-image';
import type { ReactElement, RefObject } from 'react';

export const DAMAGED = 'The image could not be shown: the data may be damaged.';
export const SVG_UNAVAILABLE = 'SVG preview is not available in this browser.';

type Shown = 'loading' | 'image' | 'canvas' | 'damaged' | 'svg-unavailable';

export interface PreviewProps {
  url: string | null;
  image: DecodedImage;
  alt: string;
  /** Why the image is not decoded at all (its claimed size), or null. */
  refusal: string | null;
  /** The loaded `<img>` (Copy image draws an SVG from it); null while there is none. */
  shown: RefObject<HTMLImageElement | null>;
  /** The size Chrome decoded, once known (AVIF and SVG without one in the header). */
  onDecoded: (size: Dimensions | null) => void;
}

/** Keyed by the URL by its caller: a new image starts loading afresh. */
export const Preview = ({ url, image, alt, refusal, shown, onDecoded }: PreviewProps): ReactElement => {
  const [state, setState] = useState<Shown>('loading');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bitmapSize, setBitmapSize] = useState<Dimensions | null>(null);
  const bitmap = useRef<ImageBitmap | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      bitmap.current?.close();
      bitmap.current = null;
    };
  }, []);

  // The canvas fallback is drawn once its element has the bitmap's size.
  useEffect(() => {
    const g = canvas.current?.getContext('2d');
    if (state !== 'canvas' || !g || !bitmap.current) return;
    g.drawImage(bitmap.current, 0, 0);
    bitmap.current.close();
    bitmap.current = null;
  }, [state, bitmapSize]);

  const failed = async (): Promise<void> => {
    shown.current = null;
    onDecoded(null);
    if (image.type.mime === 'image/svg+xml') {
      const allowed = await blobImagesLoad();
      if (live.current) setState(allowed ? 'damaged' : 'svg-unavailable');
      return;
    }
    const decoded = await decodeBitmap(blobOf(image));
    if (!live.current) return decoded?.close();
    if (!decoded) return setState('damaged');
    bitmap.current = decoded;
    setBitmapSize({ width: decoded.width, height: decoded.height });
    setState('canvas');
    onDecoded({ width: decoded.width, height: decoded.height });
  };

  if (refusal)
    return (
      <p className="m-0 text-sm text-muted-foreground" data-preview="refused">
        {refusal}
      </p>
    );
  return (
    <div
      className="flex min-h-16 items-center justify-center overflow-hidden rounded-md bg-muted p-2"
      data-preview={state}>
      {url && (state === 'loading' || state === 'image') && (
        <img
          ref={shown}
          src={url}
          alt={alt}
          className="max-h-80 max-w-full object-contain"
          onLoad={event => {
            const img = event.currentTarget;
            setState('image');
            onDecoded(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null);
          }}
          onError={() => void failed()}
        />
      )}
      {state === 'canvas' && bitmapSize && (
        <canvas
          ref={canvas}
          width={bitmapSize.width}
          height={bitmapSize.height}
          role="img"
          aria-label={alt}
          className="max-h-80 max-w-full object-contain"
        />
      )}
      {state === 'damaged' && <p className="m-0 text-sm text-muted-foreground">{DAMAGED}</p>}
      {state === 'svg-unavailable' && <p className="m-0 text-sm text-muted-foreground">{SVG_UNAVAILABLE}</p>}
    </div>
  );
};

const count = (n: number): string => n.toLocaleString('en-US');

export interface FactsProps {
  image: DecodedImage;
  /** The size the header gave, or the decoded one when the header has none. */
  dimensions: Dimensions | null;
  /** Encode: the file's name, when there is one. */
  file?: string | null;
}

/** §5 «Факты»: Type, Dimensions, Size, Base64 length and, in Encode, File. */
export const Facts = ({ image, dimensions, file }: FactsProps): ReactElement => {
  const rows: Array<[string, string]> = [
    ['Type', `${image.type.name} (${image.type.mime})`],
    ['Dimensions', dimensions ? `${count(dimensions.width)} × ${count(dimensions.height)}` : 'unknown'],
    ['Size', formatSize(image.bytes.length)],
    ['Base64 length', `${count(base64Length(image.bytes.length))} characters`],
    ...(file ? ([['File', file]] as Array<[string, string]>) : []),
  ];
  return (
    <dl className="m-0 flex flex-col gap-1 text-sm" aria-label="Image facts" data-facts>
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-3">
          <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
          <dd className="m-0 min-w-0 break-all font-mono text-code" data-fact={label}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
};
