/**
 * EditorConfig's section globs (specification 0.17.2, "Glob Expressions"; docs/research/editor-settings.md §2.1, §3.4),
 * matched by our own small matcher — no dependency, no regular expression built from the pattern:
 *
 *   *            any characters but `/`
 *   **           any characters, `/` included; `**` and a `/`, at the start or after a `/`, also match no folder
 *   ?            one character but `/`
 *   [seq] [!seq] one character in (not in) seq; `a-z` is a range; a bracket holding `/` is plain text
 *   {a,b,…}      any of the alternatives, nested ones too; `{single}` and `{}` are plain text
 *   {n..m}       a whole number from n to m (n < m, either may be negative; leading zeros allowed)
 *   \x           x as plain text
 *
 * A pattern with a `/` (outside brackets) is relative to the folder of its `.editorconfig` (a leading `/` changes
 * nothing); one without matches a file's name at any depth below that folder; one ending in `/` matches no file.
 * Matching is case-sensitive (the specification says nothing; the reference core is).
 *
 * Against a hostile file the pattern is compiled into a small program run as a set of states over the path (a Pike
 * machine): every state is visited at most once per position, so the work is bounded by the pattern's length times the
 * path's, never exponential, and each match is also given a budget of steps (`budget`): past it the answer is "no
 * match" and the caller is told (`exhausted`). A range wider than `RANGE_MAX` numbers or braces nested deeper than
 * `NESTING_MAX` make the pattern match nothing.
 */

/** The widest `{n..m}` accepted (numbers in it). */
export const RANGE_MAX = 1000;
/** The deepest nesting of `{…}` accepted. */
export const NESTING_MAX = 8;
/** The longest pattern accepted (the specification's minimum for a section name). */
export const PATTERN_MAX = 1024;

type Op =
  | { op: 'char'; c: string }
  /** One character but `/` (`slash`: or `/` too). */
  | { op: 'any'; slash: boolean }
  | { op: 'class'; negated: boolean; chars: string; ranges: Array<[string, string]> }
  | { op: 'range'; lo: number; hi: number }
  | { op: 'split'; a: number; b: number }
  | { op: 'jump'; to: number }
  | { op: 'match' };

type Node =
  | { kind: 'char'; c: string }
  | { kind: 'any' }
  | { kind: 'star' }
  | { kind: 'globstar' }
  /** `**` and a `/` at a folder's start: no folder, or any folders. */
  | { kind: 'dirs' }
  | { kind: 'class'; negated: boolean; chars: string; ranges: Array<[string, string]> }
  | { kind: 'alt'; options: Node[][] }
  | { kind: 'range'; lo: number; hi: number };

class Invalid extends Error {}

/** The index of the `]` closing a bracket opened at `start`, or -1. */
const bracketEnd = (p: string, start: number): number => {
  let i = start + 1;
  if (p[i] === '!' || p[i] === '^') i += 1;
  if (p[i] === ']') i += 1;
  for (; i < p.length; i += 1) {
    if (p[i] === '\\') i += 1;
    else if (p[i] === ']') return i;
  }
  return -1;
};

/** The index of the `}` closing a brace opened at `start` (nesting and escapes followed), or -1. */
const braceEnd = (p: string, start: number): number => {
  let depth = 0;
  for (let i = start; i < p.length; i += 1) {
    const c = p[i];
    if (c === '\\') i += 1;
    else if (c === '[') {
      const end = bracketEnd(p, i);
      if (end > 0 && !p.slice(i, end).includes('/')) i = end;
    } else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/** Splits a brace's inside at its commas of the top level. */
const alternatives = (inside: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < inside.length; i += 1) {
    const c = inside[i];
    if (c === '\\') i += 1;
    else if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(inside.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(inside.slice(from));
  return parts;
};

const literal = (text: string): Node[] => [...text].map(c => ({ kind: 'char', c }));

const parse = (p: string, depth: number): Node[] => {
  if (depth > NESTING_MAX) throw new Invalid('nested too deep');
  const nodes: Node[] = [];
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i]!;
    if (c === '\\') {
      if (i + 1 < p.length) nodes.push({ kind: 'char', c: p[++i]! });
      else nodes.push({ kind: 'char', c });
    } else if (c === '*') {
      let end = i;
      while (p[end + 1] === '*') end += 1;
      const globstar = end > i;
      const atStart = i === 0 || p[i - 1] === '/';
      if (globstar && atStart && p[end + 1] === '/') {
        nodes.push({ kind: 'dirs' });
        i = end + 1;
      } else {
        nodes.push({ kind: globstar ? 'globstar' : 'star' });
        i = end;
      }
    } else if (c === '?') nodes.push({ kind: 'any' });
    else if (c === '[') {
      const end = bracketEnd(p, i);
      const inside = end < 0 ? '' : p.slice(i + 1, end);
      if (end < 0 || inside.includes('/')) {
        nodes.push({ kind: 'char', c });
        continue;
      }
      let body = inside;
      const negated = body[0] === '!' || body[0] === '^';
      if (negated) body = body.slice(1);
      let chars = '';
      const ranges: Array<[string, string]> = [];
      const units = [...body];
      for (let k = 0; k < units.length; k += 1) {
        let ch = units[k]!;
        if (ch === '\\' && k + 1 < units.length) ch = units[++k]!;
        if (units[k + 1] === '-' && k + 2 < units.length) {
          let to = units[k + 2]!;
          k += 2;
          if (to === '\\' && k + 1 < units.length) to = units[++k]!;
          ranges.push([ch, to]);
        } else chars += ch;
      }
      nodes.push({ kind: 'class', negated, chars, ranges });
      i = end;
    } else if (c === '{') {
      const end = braceEnd(p, i);
      if (end < 0) {
        nodes.push({ kind: 'char', c });
        continue;
      }
      const inside = p.slice(i + 1, end);
      const range = /^([+-]?\d+)\.\.([+-]?\d+)$/.exec(inside);
      if (range) {
        const lo = Number(range[1]);
        const hi = Number(range[2]);
        if (lo < hi && hi - lo + 1 > RANGE_MAX) throw new Invalid('range too wide');
        nodes.push(...(lo < hi ? [{ kind: 'range', lo, hi } as Node] : literal(p.slice(i, end + 1))));
      } else {
        const options = alternatives(inside);
        if (options.length < 2) nodes.push(...literal(p.slice(i, end + 1)));
        else nodes.push({ kind: 'alt', options: options.map(o => parse(o, depth + 1)) });
      }
      i = end;
    } else nodes.push({ kind: 'char', c });
  }
  return nodes;
};

const compile = (nodes: Node[]): Op[] => {
  const ops: Op[] = [];
  const emit = (op: Op): number => ops.push(op) - 1;
  const loop = (slash: boolean): void => {
    // L: split(body, out); body: any; jump L; out:
    const at = emit({ op: 'split', a: 0, b: 0 });
    emit({ op: 'any', slash });
    emit({ op: 'jump', to: at });
    ops[at] = { op: 'split', a: at + 1, b: ops.length };
  };
  const seq = (list: Node[]): void => {
    for (const node of list) {
      switch (node.kind) {
        case 'char':
          emit({ op: 'char', c: node.c });
          break;
        case 'any':
          emit({ op: 'any', slash: false });
          break;
        case 'star':
          loop(false);
          break;
        case 'globstar':
          loop(true);
          break;
        case 'dirs': {
          // split(in, out); in: (any incl. /)* then '/'; out:
          const at = emit({ op: 'split', a: 0, b: 0 });
          loop(true);
          emit({ op: 'char', c: '/' });
          ops[at] = { op: 'split', a: at + 1, b: ops.length };
          break;
        }
        case 'class':
          emit({ op: 'class', negated: node.negated, chars: node.chars, ranges: node.ranges });
          break;
        case 'range':
          emit({ op: 'range', lo: node.lo, hi: node.hi });
          break;
        case 'alt': {
          const jumps: number[] = [];
          node.options.forEach((option, index) => {
            const last = index === node.options.length - 1;
            const split = last ? -1 : emit({ op: 'split', a: 0, b: 0 });
            seq(option);
            if (!last) {
              jumps.push(emit({ op: 'jump', to: 0 }));
              ops[split] = { op: 'split', a: split + 1, b: ops.length };
            }
          });
          for (const j of jumps) ops[j] = { op: 'jump', to: ops.length };
          break;
        }
      }
    }
  };
  seq(nodes);
  emit({ op: 'match' });
  return ops;
};

/** Whether a class op takes one character. */
const inClass = (op: Extract<Op, { op: 'class' }>, c: string): boolean => {
  if (c === '/') return false;
  const found = op.chars.includes(c) || op.ranges.some(([from, to]) => c >= from && c <= to);
  return found !== op.negated;
};

export interface MatchOptions {
  /** Steps this match may take (states visited); past it the answer is false and `exhausted` is set. */
  budget?: number;
  /** Told how many steps were taken, and whether the budget ran out. */
  spent?: { steps: number; exhausted: boolean };
}

/** The default budget of one match: far above a real pattern's need, far below what hangs a page. */
export const MATCH_BUDGET = 200_000;

/** A compiled section glob: `matches(path)` takes a path relative to the folder of its `.editorconfig`. */
export interface Glob {
  readonly pattern: string;
  /** The pattern can match nothing (ends in `/`, too long, a range too wide, nested too deep). */
  readonly never: boolean;
  matches(path: string, options?: MatchOptions): boolean;
}

/** Whether the pattern has a `/` outside brackets (then it is anchored to its file's folder). */
const hasSlash = (p: string): boolean => {
  for (let i = 0; i < p.length; i += 1) {
    if (p[i] === '\\') i += 1;
    else if (p[i] === '[') {
      const end = bracketEnd(p, i);
      if (end > 0 && !p.slice(i, end).includes('/')) i = end;
    } else if (p[i] === '/') return true;
  }
  return false;
};

const NEVER = (pattern: string): Glob => ({ pattern, never: true, matches: () => false });

export const compileGlob = (pattern: string): Glob => {
  if (pattern.length === 0 || pattern.length > PATTERN_MAX || pattern.endsWith('/')) return NEVER(pattern);
  let nodes: Node[];
  try {
    if (hasSlash(pattern)) nodes = parse(pattern.startsWith('/') ? pattern.slice(1) : pattern, 0);
    else nodes = [{ kind: 'dirs' }, ...parse(pattern, 0)];
  } catch (error) {
    if (error instanceof Invalid) return NEVER(pattern);
    throw error;
  }
  const ops = compile(nodes);
  return {
    pattern,
    never: false,
    matches: (path, options = {}) => run(ops, path, options),
  };
};

/** The Pike machine: the set of states at each position, each state once per position. */
const run = (ops: Op[], text: string, { budget = MATCH_BUDGET, spent }: MatchOptions): boolean => {
  const chars = [...text];
  const n = chars.length;
  // States waiting at a position (a range jumps ahead by more than one).
  const waiting = new Map<number, number[]>();
  const seen = new Int32Array(ops.length).fill(-1);
  let steps = 0;
  let exhausted = false;
  const add = (list: number[], pc: number, pos: number): void => {
    // Epsilon closure, iterative: split and jump are followed here, the rest wait for a character.
    const stack = [pc];
    while (stack.length) {
      const at = stack.pop()!;
      if (seen[at] === pos) continue;
      seen[at] = pos;
      steps += 1;
      const op = ops[at]!;
      if (op.op === 'split') stack.push(op.b, op.a);
      else if (op.op === 'jump') stack.push(op.to);
      else list.push(at);
    }
  };
  const later = (pos: number, pc: number): void => {
    const list = waiting.get(pos);
    if (list) list.push(pc);
    else waiting.set(pos, [pc]);
  };
  let current: number[] = [];
  add(current, 0, 0);
  for (let pos = 0; pos <= n; pos += 1) {
    for (const pc of waiting.get(pos) ?? []) add(current, pc, pos);
    waiting.delete(pos);
    if (steps > budget) {
      exhausted = true;
      break;
    }
    const next: number[] = [];
    const c = chars[pos];
    for (const pc of current) {
      steps += 1;
      const op = ops[pc]!;
      if (op.op === 'match') {
        if (pos === n) {
          if (spent) Object.assign(spent, { steps, exhausted: false });
          return true;
        }
        continue;
      }
      if (c === undefined) continue;
      if (op.op === 'char') {
        if (c === op.c) add(next, pc + 1, pos + 1);
      } else if (op.op === 'any') {
        if (op.slash || c !== '/') add(next, pc + 1, pos + 1);
      } else if (op.op === 'class') {
        if (inClass(op, c)) add(next, pc + 1, pos + 1);
      } else if (op.op === 'range') {
        // [+-]?digits from here; every end whose number is within the range goes on.
        let end = pos;
        if (chars[end] === '+' || chars[end] === '-') end += 1;
        const digitsFrom = end;
        while (end < n && end - digitsFrom < 12 && chars[end]! >= '0' && chars[end]! <= '9') {
          end += 1;
          steps += 1;
          const value = Number(chars.slice(pos, end).join(''));
          if (value >= op.lo && value <= op.hi) {
            if (end === pos + 1) add(next, pc + 1, pos + 1);
            else later(end, pc + 1);
          }
        }
      }
    }
    current = next;
    if (!current.length && !waiting.size) break;
  }
  if (spent) Object.assign(spent, { steps, exhausted });
  return false;
};
