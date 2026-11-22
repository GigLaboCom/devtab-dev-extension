/**
 * The code as files (docs/tools/specs/qr.md §5.5), under the extension pages' policy (`img-src 'self'`, no inline
 * styles): the PNG is drawn on an OffscreenCanvas — white, the dark modules as whole-pixel rectangles — and encoded by
 * the browser; a file is saved through a temporary `<a download>` on an object URL, revoked right after the click (no
 * `downloads` permission; a navigation, not an image load, so `img-src` does not apply); Copy image hands the clipboard
 * a promise of the PNG from the click, so the write starts inside the gesture while the PNG is still being drawn.
 */
import { DARK, LIGHT, pngModulePx, sideOf, svgFile } from '@workspace/tool-logic-qr';
import type { ModulePx } from '@workspace/tool-logic-qr';

type Modules = readonly (readonly boolean[])[];

export const pngBlob = async (modules: Modules, quiet: number, wanted: ModulePx): Promise<Blob> => {
  const { px } = pngModulePx(modules.length, quiet, wanted);
  const side = sideOf(modules.length, quiet) * px;
  const canvas = new OffscreenCanvas(side, side);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('No 2D canvas.');
  g.fillStyle = LIGHT;
  g.fillRect(0, 0, side, side);
  g.fillStyle = DARK;
  for (let y = 0; y < modules.length; y++) {
    const row = modules[y]!;
    for (let x = 0; x < row.length;) {
      if (!row[x]) {
        x++;
        continue;
      }
      let n = 1;
      while (x + n < row.length && row[x + n]) n++;
      g.fillRect((x + quiet) * px, (y + quiet) * px, n * px, px);
      x += n;
    }
  }
  return canvas.convertToBlob({ type: 'image/png' });
};

export const svgBlob = (modules: Modules, quiet: number, modulePx: number): Blob =>
  new Blob([svgFile(modules, quiet, modulePx)], { type: 'image/svg+xml' });

export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/** Copy image: resolves when the clipboard took the PNG, rejects when it refused. Called from the click itself. */
export const copyPng = (png: Promise<Blob>): Promise<void> =>
  navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
