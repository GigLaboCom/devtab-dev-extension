/**
 * A component's state wins over its variants (found 2026-11-21: a pressed outline Toggle looked unpressed). Tailwind
 * compiles the Radix state variants of tailwind.css to `&:where([data-state=…])`, which adds no specificity, so a
 * variant's rule (`.cn-toggle-variant-outline`) that comes later in the file and sets a property plainly overrides the
 * base's state rule for that property (`.cn-toggle` `data-on:bg-accent`). The check: compile the component layer as a
 * page does, and for every base rule `.cn-<part>` with state blocks, no later rule `.cn-<part>-variant-*` /
 * `.cn-<part>-size-*` may set one of those state properties plainly unless it sets it for the same state too.
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
@import './style-gpui-tools.css';
@import './style-gpui-dialog.css';
`;

interface Rule {
  selector: string;
  /** Properties set with no condition. */
  plain: Set<string>;
  /** Properties set in a state block, by the block's selector (`&:where([data-state='on'])`). */
  states: Map<string, Set<string>>;
}

/** The top-level `.cn-*` rules of compiled (nested) CSS, in order, inside any `@layer`. */
const componentRules = (css: string): Rule[] => {
  const rules: Rule[] = [];
  const walk = (text: string, depth: number, current?: Rule, state?: string): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      const semi = text.indexOf(';', i);
      if (semi >= 0 && (open < 0 || semi < open)) {
        const decl = text.slice(i, semi).trim();
        const prop = /^([a-z-]+)\s*:/.exec(decl)?.[1];
        if (prop && current) (state ? current.states.get(state)! : current.plain).add(prop);
        i = semi + 1;
        continue;
      }
      if (open < 0) break;
      let depthIn = 1;
      let j = open + 1;
      for (; j < text.length && depthIn > 0; j++) {
        if (text[j] === '{') depthIn++;
        else if (text[j] === '}') depthIn--;
      }
      const head = text.slice(i, open).trim();
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@layer') || (head.startsWith('@media') && !current) || head.startsWith('@supports'))
        walk(body, depth, current, state);
      else if (!current && /^\.cn-[\w-]+$/.test(head)) {
        const rule: Rule = { selector: head, plain: new Set(), states: new Map() };
        rules.push(rule);
        walk(body, depth + 1, rule);
      } else if (current && /^&(?::where\()?\[(?:data-|aria-pressed|aria-checked)/.test(head)) {
        if (!current.states.has(head)) current.states.set(head, new Set());
        walk(body, depth + 1, current, head);
      }
      // Other nested blocks (:hover, :focus-visible, children, media) are conditions of their own: not plain, not state.
      i = j;
    }
  };
  walk(css, 0);
  return rules;
};

/** Later variant or size rules that override a base's state property plainly: `[variant, property, state]`. */
const stateOverrides = (rules: Rule[]): Array<[string, string, string]> => {
  const found: Array<[string, string, string]> = [];
  rules.forEach((rule, index) => {
    if (!rule.states.size) return;
    for (const later of rules.slice(index + 1)) {
      if (
        !later.selector.startsWith(`${rule.selector}-variant-`) &&
        !later.selector.startsWith(`${rule.selector}-size-`)
      )
        continue;
      for (const [state, props] of rule.states)
        for (const prop of props)
          if (later.plain.has(prop) && !later.states.get(state)?.has(prop)) found.push([later.selector, prop, state]);
    }
  });
  return found;
};

describe('a component’s state is not overridden by its variants', () => {
  it('finds the rules and their states (the check sees what it checks)', async () => {
    const css = (await compile(ENTRY, { base, onDependency: () => undefined })).build([]);
    const toggle = componentRules(css).find(r => r.selector === '.cn-toggle');
    expect(toggle?.states.get("&:where([data-state='on'])")).toContain('background-color');
  });

  it('catches the case it is for', () => {
    const css = `@layer components { .cn-x { &:where([data-state='on']) { background-color: red; } } .cn-x-variant-y { background-color: transparent; } }`;
    expect(stateOverrides(componentRules(css))).toEqual([
      ['.cn-x-variant-y', 'background-color', "&:where([data-state='on'])"],
    ]);
  });

  it('style-gpui.css, style-gpui-tools.css, style-gpui-dialog.css: none', async () => {
    const css = (await compile(ENTRY, { base, onDependency: () => undefined })).build([]);
    expect(stateOverrides(componentRules(css))).toEqual([]);
  });
});
