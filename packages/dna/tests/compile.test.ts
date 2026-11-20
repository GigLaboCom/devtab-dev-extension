/**
 * The package compiles under Tailwind v4 the way a page uses it: every `@apply` of style-gpui.css names a utility the
 * bridge provides (an unknown one throws), and Tailwind's own palette is gone.
 */
import { compile } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('../', import.meta.url));
const ENTRY = `
@import 'tailwindcss';
@import './theme.css';
@import './tailwind.css';
@import './style-gpui.css';
@import './ui.css';
`;

describe('Tailwind v4 over the package', () => {
  it('compiles, keeps the component and frame layers, and offers no palette colour', async () => {
    const compiler = await compile(ENTRY, { base, onDependency: () => undefined });
    const css = compiler.build(['bg-primary', 'bg-red-500', 'text-white', 'rounded-md', 'shadow-md']);
    expect(css).toMatch(/\.cn-button-variant-default \{/);
    expect(css).toMatch(/\.kit-shell \{/);
    expect(css).toMatch(/\.bg-primary \{\s*background-color: var\(--primary\);/);
    expect(css).toMatch(/\.rounded-md \{\s*border-radius: var\(--radius-md\);/);
    expect(css).not.toMatch(/\.bg-red-500|\.text-white/);
    // `reference`: Tailwind emits no copy of a token — the theme blocks are the only definition.
    expect(css).not.toMatch(/--color-primary:/);
  });
});
