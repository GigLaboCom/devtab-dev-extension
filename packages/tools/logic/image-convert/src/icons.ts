/**
 * The icon presets (docs/tools/specs/image-convert.md §5.8): which PNG files each set makes, with the names convention
 * expects, and the markup that names them. `favicon.ico` is its own choice of sizes (ico.ts).
 */
export type IconSet = 'favicon' | 'extension' | 'pwa';

export interface IconFile {
  name: string;
  size: number;
  /** Filled with the background colour: iOS shows a transparent touch icon on black. */
  opaque: boolean;
}

export const ICON_SET_IDS: readonly IconSet[] = ['favicon', 'extension', 'pwa'];
export const ICON_SET_LABELS: Record<IconSet, string> = { favicon: 'Favicon', extension: 'Extension', pwa: 'PWA' };

export const ICON_SETS: Record<IconSet, readonly IconFile[]> = {
  favicon: [
    { name: 'favicon-16x16.png', size: 16, opaque: false },
    { name: 'favicon-32x32.png', size: 32, opaque: false },
    { name: 'apple-touch-icon.png', size: 180, opaque: true },
  ],
  extension: [16, 32, 48, 128].map(size => ({ name: `icon${size}.png`, size, opaque: false })),
  pwa: [192, 512].map(size => ({ name: `icon-${size}.png`, size, opaque: false })),
};

export const ICO_NAME = 'favicon.ico';

/** The PNG files of the chosen sets, in the sets' order. */
export const iconFiles = (sets: readonly IconSet[]): IconFile[] =>
  ICON_SET_IDS.filter(id => sets.includes(id)).flatMap(id => ICON_SETS[id]);

/** The markup that uses the files: HTML for the favicon, the manifests' "icons" for the extension and the PWA. */
export const iconMarkup = (icoSizes: readonly number[], sets: readonly IconSet[]): string => {
  const blocks: string[] = [];
  const html: string[] = [];
  if (icoSizes.length) html.push('<link rel="icon" href="/favicon.ico" sizes="any">');
  if (sets.includes('favicon'))
    html.push(
      '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
      '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    );
  if (html.length) blocks.push(html.join('\n'));
  if (sets.includes('extension'))
    blocks.push(`"icons": {\n${ICON_SETS.extension.map(f => `  "${f.size}": "${f.name}"`).join(',\n')}\n}`);
  if (sets.includes('pwa'))
    blocks.push(
      `"icons": [\n${ICON_SETS.pwa
        .map(f => `  { "src": "${f.name}", "sizes": "${f.size}x${f.size}", "type": "image/png" }`)
        .join(',\n')}\n]`,
    );
  return blocks.join('\n\n');
};
