/**
 * The validator (docs/tools/specs/json-schema.md §5 п. 9–32): a schema node applied to a document node of the shared
 * scanner's tree, every keyword of the node's draft, every violation collected with its place in the document and in
 * the schema. Numbers are exact decimals (decimal.ts), strings are measured in code points, a repeated key's every value
 * is checked. Annotations (the properties and items a keyword evaluated) travel up for `unevaluated*`.
 *
 * Recursion follows the document and the schema; a schema place that meets the same document place again without
 * moving into it is a loop and stops the run (§5 п. 13). A run that only needs to know whether a subschema matches
 * (`not`, `if`, `contains`, a first pass over `anyOf`/`oneOf`) stops at the first failure: a failing subschema's
 * annotations are dropped anyway.
 */
import { compareDecimal, isIntegerValue, isMultipleOf, toDecimal } from './decimal';
import { draftRank } from './drafts';
import { canonical, jsonEqual } from './equal';
import { checkFormat, FORMAT_NAMES } from './formats';
import { got, plural, typeList, written } from './messages';
import { pointerOf, step } from './pointer';
import { member, resolveIn } from './registry';
import { resolveUri, showUri, splitFragment } from './uri';
import type { Draft } from './drafts';
import type { Path } from './pointer';
import type { Index, NodeInfo, Vocabulary } from './registry';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

/** A violation as the evaluator makes it; places become pointers and lines only for those that are shown. */
export interface RawViolation {
  ip: Path | null;
  kp: Path | null;
  schema: JsonNode;
  keyword: string;
  message: string;
  offset: number;
  causes?: RawViolation[];
}

interface Res {
  valid: boolean;
  errors: RawViolation[];
  /** Property names evaluated (true — every one), null — none. */
  props: Set<string> | true | null;
  /** Items evaluated from the start (true — every one). */
  items: number | true;
  /** Items `contains` evaluated (2020-12). */
  contained: Set<number> | null;
}

export class SchemaLoop extends Error {
  constructor(readonly schema: JsonNode) {
    super('loop');
  }
}

export class TooDeep extends Error {}

export class Unresolved extends Error {
  constructor(readonly uri: string) {
    super(`unresolved ${uri}`);
  }
}

export interface EvaluateOptions {
  formats: boolean;
  /** Violations kept at most (counted with their causes); past it validity is still decided. */
  maxViolations: number;
  maxCauses: number;
}

/** Nested evaluations at most: far above the scanner's 1,000 levels times a few `$ref`s per level. */
export const MAX_EVALUATION_DEPTH = 6_000;

const ok = (): Res => ({ valid: true, errors: [], props: null, items: 0, contained: null });

const mergeProps = (a: Set<string> | true | null, b: Set<string> | true | null): Set<string> | true | null => {
  if (a === true || b === true) return true;
  if (!a) return b ? new Set(b) : null;
  if (b) for (const k of b) a.add(k);
  return a;
};

const mergeItems = (a: number | true, b: number | true): number | true =>
  a === true || b === true ? true : Math.max(a, b);

const codePoints = (s: string): number => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
};

const quote = (name: string): string => JSON.stringify(name);

export class Evaluator {
  private kept = 0;
  private readonly active = new Map<JsonNode, Set<JsonNode>>();
  private readonly scope: string[] = [];
  private depth = 0;
  private readonly patterns = new Map<string, RegExp | null>();
  /** Set by a run when more violations were found than kept. */
  truncated = false;

  constructor(
    private readonly indexes: readonly Index[],
    private readonly options: EvaluateOptions,
    private readonly text: string = '',
  ) {}

  run(schema: JsonNode, document: JsonNode): { valid: boolean; errors: RawViolation[] } {
    const r = this.evaluate(schema, document, null, null, true);
    return { valid: r.valid, errors: r.errors };
  }

  private info(node: JsonNode): NodeInfo {
    for (const ix of this.indexes) {
      const i = ix.info.get(node);
      if (i) return i;
    }
    throw new Error('a schema node outside every index');
  }

  /** The info of a reference's target; a target outside the schema walk (a pointer into `enum`) borrows the referrer's. */
  private infoOr(node: JsonNode, from: NodeInfo): NodeInfo {
    for (const ix of this.indexes) {
      const i = ix.info.get(node);
      if (i) return i;
    }
    const borrowed: NodeInfo = { ...from, isResource: false, recursiveAnchor: false };
    this.indexes[0]!.info.set(node, borrowed);
    return borrowed;
  }

  regex(pattern: string): RegExp | null {
    let re = this.patterns.get(pattern);
    if (re !== undefined) return re;
    try {
      re = new RegExp(pattern, 'u');
    } catch {
      try {
        re = new RegExp(pattern);
      } catch {
        re = null;
      }
    }
    this.patterns.set(pattern, re);
    return re;
  }

  private add(res: Res, collect: boolean, v: RawViolation): void {
    res.valid = false;
    if (!collect) return;
    if (this.kept >= this.options.maxViolations) {
      this.truncated = true;
      return;
    }
    this.kept++;
    res.errors.push(v);
  }

  evaluate(schema: JsonNode, inst: JsonNode, ip: Path | null, kp: Path | null, collect: boolean): Res {
    if (schema.type === 'boolean') {
      if (schema.value) return ok();
      const r: Res = { valid: false, errors: [], props: null, items: 0, contained: null };
      this.add(r, collect, {
        ip,
        kp,
        schema,
        keyword: 'false',
        message: 'No value is allowed here: the schema is false.',
        offset: inst.offset,
      });
      return r;
    }
    if (schema.type !== 'object') return ok();
    const info = this.info(schema);
    let seen = this.active.get(schema);
    if (seen?.has(inst)) throw new SchemaLoop(schema);
    if (!seen) {
      seen = new Set();
      this.active.set(schema, seen);
    }
    seen.add(inst);
    if (++this.depth > MAX_EVALUATION_DEPTH) throw new TooDeep();
    // Entering a resource — at its root or anywhere inside it through a reference — adds it to the dynamic scope.
    const entered = this.scope[this.scope.length - 1] !== info.resource;
    if (entered) this.scope.push(info.resource);
    try {
      return this.keywords(schema, info, inst, ip, kp, collect);
    } finally {
      if (entered) this.scope.pop();
      this.depth--;
      seen.delete(inst);
      if (seen.size === 0) this.active.delete(schema);
    }
  }

  private resolve(ref: string, info: NodeInfo): { node: JsonNode; uri: string } {
    const uri = resolveUri(ref, info.base);
    const r = resolveIn(this.indexes, uri);
    if (!r.ok) throw new Unresolved(uri);
    return { node: r.node, uri };
  }

  private resourceNode(uri: string): JsonNode | undefined {
    for (const ix of this.indexes) {
      const n = ix.resources.get(uri);
      if (n) return n;
    }
    return undefined;
  }

  private dynamicTarget(ref: string, info: NodeInfo): JsonNode {
    const { node, uri } = this.resolve(ref, info);
    const fragment = splitFragment(uri).fragment;
    if (!fragment || fragment.startsWith('/')) return node;
    const anchor = member(node, '$dynamicAnchor');
    if (anchor?.type !== 'string' || anchor.value !== fragment) return node;
    for (const resource of this.scope) {
      for (const ix of this.indexes) {
        const n = ix.dynamicAnchors.get(`${resource}#${fragment}`);
        if (n) return n;
      }
    }
    return node;
  }

  private recursiveTarget(ref: string, info: NodeInfo): JsonNode {
    const { node } = this.resolve(ref, info);
    if (!this.infoOr(node, info).recursiveAnchor) return node;
    for (const resource of this.scope) {
      const n = this.resourceNode(resource);
      if (n && this.infoOr(n, info).recursiveAnchor) return n;
    }
    return node;
  }

  private merge(res: Res, sub: Res): void {
    if (!sub.valid) {
      res.valid = false;
      for (const e of sub.errors) res.errors.push(e);
      return;
    }
    res.props = mergeProps(res.props, sub.props);
    res.items = mergeItems(res.items, sub.items);
    if (sub.contained) {
      res.contained ??= new Set();
      for (const i of sub.contained) res.contained.add(i);
    }
  }

  /** A child instance's evaluation: its validity and violations, never its annotations (they are about the child). */
  private mergeChild(res: Res, sub: Res): void {
    if (sub.valid) return;
    res.valid = false;
    for (const e of sub.errors) res.errors.push(e);
  }

  private matchesType(t: string, inst: JsonNode, draft: Draft): boolean {
    switch (t) {
      case 'integer':
        return inst.type === 'number' && isIntegerValue(inst.raw, draft);
      case 'number':
        return inst.type === 'number';
      default:
        return inst.type === t;
    }
  }

  /**
   * Of an `anyOf`/`oneOf` that nothing matched: when exactly one branch fails on something other than the type of
   * this very place, its violations say more than «matches none» does (`"type": "strnig"` → «Must be one of: …»).
   */
  private bestBranch(branches: RawViolation[][], ip: Path | null): RawViolation[] | null {
    const fitting = branches.filter(b => !b.some(e => e.ip === ip && e.keyword === 'type'));
    return fitting.length === 1 && fitting[0]!.length > 0 ? fitting[0]! : null;
  }

  private keywords(
    schema: JsonNode,
    info: NodeInfo,
    inst: JsonNode,
    ip: Path | null,
    kp: Path | null,
    collect: boolean,
  ): Res {
    const res = ok();
    const draft = info.draft;
    const rank = draftRank(draft);
    const vocab = info.vocabularies;
    const has = (v: Vocabulary): boolean => vocab === null || vocab.has(v);
    const get = (k: string): JsonNode | undefined => member(schema, k);
    const at = (k: string): Path => step(kp, k);
    const fail = (
      keyword: string,
      message: string,
      offset = inst.offset,
      where: Path | null = ip,
      path = at(keyword),
    ): void => this.add(res, collect, { ip: where, kp: path, schema, keyword, message, offset });
    const stop = (): boolean => !res.valid && !collect;

    // References first: up to draft 7 a `$ref` is the whole schema.
    const $ref = get('$ref');
    if ($ref?.type === 'string') {
      const target = this.resolve($ref.value, info).node;
      this.infoOr(target, info);
      this.merge(res, this.evaluate(target, inst, ip, at('$ref'), collect));
      if (rank <= 7) return res;
      if (stop()) return res;
    }
    if (rank === 2020) {
      const dyn = get('$dynamicRef');
      if (dyn?.type === 'string') {
        const target = this.dynamicTarget(dyn.value, info);
        this.infoOr(target, info);
        this.merge(res, this.evaluate(target, inst, ip, at('$dynamicRef'), collect));
        if (stop()) return res;
      }
    }
    if (rank === 2019) {
      const rec = get('$recursiveRef');
      if (rec?.type === 'string') {
        const target = this.recursiveTarget(rec.value, info);
        this.merge(res, this.evaluate(target, inst, ip, at('$recursiveRef'), collect));
        if (stop()) return res;
      }
    }

    if (has('validation')) {
      this.validation(schema, info, inst, ip, kp, collect, res, fail);
      if (stop()) return res;
    }

    const format = get('format');
    if (format?.type === 'string' && inst.type === 'string' && (has('format') || has('format-assertion'))) {
      const assert = this.options.formats || (vocab !== null && vocab.has('format-assertion'));
      if (assert && checkFormat(format.value, inst.value, info.draft) === false)
        fail('format', `Is not a valid ${FORMAT_NAMES[format.value] ?? format.value} (format ${quote(format.value)}).`);
      if (stop()) return res;
    }

    if (has('applicator')) {
      this.inPlace(schema, info, inst, ip, kp, collect, res, fail);
      if (stop()) return res;
      if (inst.type === 'object') this.objectApplicators(schema, info, inst, ip, kp, collect, res);
      else if (inst.type === 'array') this.arrayApplicators(schema, info, inst, ip, kp, collect, res, fail);
      if (stop()) return res;
    }

    if (rank >= 2019 && has('unevaluated')) this.unevaluated(schema, info, inst, ip, kp, collect, res);
    return res;
  }

  private validation(
    schema: JsonNode,
    info: NodeInfo,
    inst: JsonNode,
    ip: Path | null,
    kp: Path | null,
    collect: boolean,
    res: Res,
    fail: (keyword: string, message: string, offset?: number, where?: Path | null, path?: Path) => void,
  ): void {
    void collect;
    void kp;
    const draft = info.draft;
    const rank = draftRank(draft);
    const get = (k: string): JsonNode | undefined => member(schema, k);
    const text = this.text;

    const type = get('type');
    if (type) {
      const types =
        type.type === 'string'
          ? [type.value]
          : type.type === 'array'
            ? type.items.flatMap(t => (t.type === 'string' ? [t.value] : []))
            : [];
      if (types.length > 0 && !types.some(t => this.matchesType(t, inst, draft)))
        fail('type', `Expected ${typeList(types)}, got ${got(inst)}.`);
    }
    const en = get('enum');
    if (en?.type === 'array' && !en.items.some(v => jsonEqual(v, inst))) {
      const shown = en.items.slice(0, 10).map(v => written(text, v, 60));
      const more = en.items.length > 10 ? ` … and ${en.items.length - 10} more` : '';
      fail('enum', `Must be one of: ${shown.join(', ')}${more}.`);
    }
    if (rank >= 6) {
      const c = get('const');
      if (c && !jsonEqual(c, inst)) fail('const', `Must be exactly ${written(text, c, 60)}.`);
    }

    if (inst.type === 'number') {
      const value = toDecimal(inst.raw);
      const num = (k: string): Extract<JsonNode, { type: 'number' }> | undefined => {
        const n = get(k);
        return n?.type === 'number' ? n : undefined;
      };
      const mult = num('multipleOf');
      if (mult && compareDecimal(toDecimal(mult.raw), toDecimal('0')) > 0 && !isMultipleOf(value, toDecimal(mult.raw)))
        fail('multipleOf', `Must be a multiple of ${mult.raw}, got ${got(inst)}.`);
      const max = num('maximum');
      const min = num('minimum');
      if (rank === 4) {
        const exMax = get('exclusiveMaximum');
        const exMin = get('exclusiveMinimum');
        if (max) {
          const c = compareDecimal(value, toDecimal(max.raw));
          if (exMax?.type === 'boolean' && exMax.value) {
            if (c >= 0) fail('exclusiveMaximum', `Must be less than ${max.raw}, got ${got(inst)}.`);
          } else if (c > 0) fail('maximum', `Must be at most ${max.raw}, got ${got(inst)}.`);
        }
        if (min) {
          const c = compareDecimal(value, toDecimal(min.raw));
          if (exMin?.type === 'boolean' && exMin.value) {
            if (c <= 0) fail('exclusiveMinimum', `Must be greater than ${min.raw}, got ${got(inst)}.`);
          } else if (c < 0) fail('minimum', `Must be at least ${min.raw}, got ${got(inst)}.`);
        }
      } else {
        if (max && compareDecimal(value, toDecimal(max.raw)) > 0)
          fail('maximum', `Must be at most ${max.raw}, got ${got(inst)}.`);
        if (min && compareDecimal(value, toDecimal(min.raw)) < 0)
          fail('minimum', `Must be at least ${min.raw}, got ${got(inst)}.`);
        const exMax = num('exclusiveMaximum');
        const exMin = num('exclusiveMinimum');
        if (exMax && compareDecimal(value, toDecimal(exMax.raw)) >= 0)
          fail('exclusiveMaximum', `Must be less than ${exMax.raw}, got ${got(inst)}.`);
        if (exMin && compareDecimal(value, toDecimal(exMin.raw)) <= 0)
          fail('exclusiveMinimum', `Must be greater than ${exMin.raw}, got ${got(inst)}.`);
      }
    }

    const limit = (k: string): { raw: string; value: bigint } | null => {
      const n = get(k);
      if (n?.type !== 'number') return null;
      const d = toDecimal(n.raw);
      if (d.negative) return { raw: n.raw, value: -1n };
      if (d.exponent < 0) return null;
      return { raw: n.raw, value: d.digits * 10n ** BigInt(Math.min(d.exponent, 30)) };
    };

    if (inst.type === 'string') {
      const minL = limit('minLength');
      const maxL = limit('maxLength');
      if (minL || maxL) {
        const k = BigInt(codePoints(inst.value));
        if (minL && k < minL.value)
          fail('minLength', `Must be at least ${plural(minL.raw, 'character', 'characters')} long, got ${k}.`);
        if (maxL && k > maxL.value)
          fail('maxLength', `Must be at most ${plural(maxL.raw, 'character', 'characters')} long, got ${k}.`);
      }
      const pattern = get('pattern');
      if (pattern?.type === 'string') {
        const re = this.regex(pattern.value);
        if (re && !re.test(inst.value)) fail('pattern', `Must match the pattern ${pattern.value}.`);
      }
    }

    if (inst.type === 'array') {
      const n = BigInt(inst.items.length);
      const minI = limit('minItems');
      const maxI = limit('maxItems');
      if (minI && n < minI.value)
        fail('minItems', `Must have at least ${plural(minI.raw, 'item', 'items')}, got ${n}.`);
      if (maxI && n > maxI.value) fail('maxItems', `Must have at most ${plural(maxI.raw, 'item', 'items')}, got ${n}.`);
      const unique = get('uniqueItems');
      if (unique?.type === 'boolean' && unique.value) {
        const first = new Map<string, number>();
        inst.items.forEach((item, j) => {
          const key = `${item.type}:${item.type === 'string' ? item.value : item.type === 'boolean' ? String(item.value) : canonical(item)}`;
          const i = first.get(key);
          if (i === undefined) first.set(key, j);
          else
            fail(
              'uniqueItems',
              `Items ${i} and ${j} are equal: every item must be different.`,
              item.offset,
              step(ip, j),
            );
        });
      }
    }

    if (inst.type === 'object') {
      const names = new Set(inst.entries.map(e => e.key));
      const minP = limit('minProperties');
      const maxP = limit('maxProperties');
      const count = BigInt(names.size);
      if (minP && count < minP.value)
        fail('minProperties', `Must have at least ${plural(minP.raw, 'property', 'properties')}, got ${count}.`);
      if (maxP && count > maxP.value)
        fail('maxProperties', `Must have at most ${plural(maxP.raw, 'property', 'properties')}, got ${count}.`);
      const required = get('required');
      if (required?.type === 'array')
        for (const r of required.items)
          if (r.type === 'string' && !names.has(r.value))
            fail('required', `Missing required property ${quote(r.value)}.`);
      const depReq = rank >= 2019 ? get('dependentRequired') : undefined;
      const deps = get('dependencies');
      for (const [node, keyword] of [
        [depReq, 'dependentRequired'],
        [deps, 'dependencies'],
      ] as const) {
        if (node?.type !== 'object') continue;
        for (const d of node.entries) {
          if (d.value.type !== 'array' || !names.has(d.key)) continue;
          for (const r of d.value.items)
            if (r.type === 'string' && !names.has(r.value))
              this.add(res, collect, {
                ip,
                kp: step(step(kp, keyword), d.key),
                schema,
                keyword,
                message: `Property ${quote(r.value)} is required when ${quote(d.key)} is present.`,
                offset: inst.entries.find(e => e.key === d.key)!.offset,
              });
        }
      }
    }
  }

  private inPlace(
    schema: JsonNode,
    info: NodeInfo,
    inst: JsonNode,
    ip: Path | null,
    kp: Path | null,
    collect: boolean,
    res: Res,
    fail: (keyword: string, message: string) => void,
  ): void {
    const rank = draftRank(info.draft);
    const get = (k: string): JsonNode | undefined => member(schema, k);

    const allOf = get('allOf');
    if (allOf?.type === 'array')
      allOf.items.forEach((s, i) => {
        if (!res.valid && !collect) return;
        this.merge(res, this.evaluate(s, inst, ip, step(step(kp, 'allOf'), i), collect));
      });
    if (!res.valid && !collect) return;

    for (const keyword of ['anyOf', 'oneOf'] as const) {
      const list = get(keyword);
      if (list?.type !== 'array') continue;
      const results = list.items.map((s, i) => this.evaluate(s, inst, ip, step(step(kp, keyword), i), false));
      const matched = results.map((r, i) => (r.valid ? i : -1)).filter(i => i >= 0);
      const good = keyword === 'anyOf' ? matched.length > 0 : matched.length === 1;
      if (good) {
        for (const i of matched) this.merge(res, results[i]!);
        continue;
      }
      if (!collect) {
        res.valid = false;
        return;
      }
      if (keyword === 'oneOf' && matched.length > 1) {
        fail('oneOf', `Must match exactly one schema in oneOf; it matches ${matched.length}: ${matched.join(', ')}.`);
        continue;
      }
      // Nothing matched: the branches again, collecting why (a bounded number of causes).
      const branches = list.items.map((s, i) => this.evaluate(s, inst, ip, step(step(kp, keyword), i), true).errors);
      const best = this.bestBranch(branches, ip);
      if (best) {
        res.valid = false;
        for (const e of best) res.errors.push(e);
        continue;
      }
      const causes = branches.flat().slice(0, this.options.maxCauses);
      const message =
        keyword === 'anyOf'
          ? `Must match at least one schema in anyOf; it matches none of the ${list.items.length}.`
          : `Must match exactly one schema in oneOf; it matches none of the ${list.items.length}.`;
      this.add(res, collect, { ip, kp: step(kp, keyword), schema, keyword, message, offset: inst.offset, causes });
    }
    if (!res.valid && !collect) return;

    const not = get('not');
    if (not && this.evaluate(not, inst, ip, step(kp, 'not'), false).valid)
      fail('not', 'Must not match the schema in not.');
    if (!res.valid && !collect) return;

    if (rank >= 7) {
      const iff = get('if');
      if (iff) {
        const r = this.evaluate(iff, inst, ip, step(kp, 'if'), false);
        if (r.valid) {
          this.merge(res, r);
          const then = get('then');
          if (then) this.merge(res, this.evaluate(then, inst, ip, step(kp, 'then'), collect));
        } else {
          const els = get('else');
          if (els) this.merge(res, this.evaluate(els, inst, ip, step(kp, 'else'), collect));
        }
        if (!res.valid && !collect) return;
      }
    }

    if (inst.type !== 'object') return;
    const names = new Set(inst.entries.map(e => e.key));
    for (const keyword of rank >= 2019 ? ['dependentSchemas', 'dependencies'] : ['dependencies']) {
      const deps = get(keyword);
      if (deps?.type !== 'object') continue;
      for (const d of deps.entries) {
        if (d.value.type === 'array' || !names.has(d.key)) continue;
        this.merge(res, this.evaluate(d.value, inst, ip, step(step(kp, keyword), d.key), collect));
        if (!res.valid && !collect) return;
      }
    }
  }

  private objectApplicators(
    schema: JsonNode,
    info: NodeInfo,
    inst: Extract<JsonNode, { type: 'object' }>,
    ip: Path | null,
    kp: Path | null,
    collect: boolean,
    res: Res,
  ): void {
    const rank = draftRank(info.draft);
    const get = (k: string): JsonNode | undefined => member(schema, k);
    const properties = get('properties');
    const patterns = get('patternProperties');
    const additional = get('additionalProperties');
    const evaluated = new Set<string>();
    const props = properties?.type === 'object' ? properties : null;
    const pats =
      patterns?.type === 'object'
        ? patterns.entries.map(p => ({ key: p.key, re: this.regex(p.key), schema: p.value }))
        : [];

    for (const e of inst.entries) {
      if (!res.valid && !collect) return;
      const iPath = step(ip, e.key);
      let matched = false;
      if (props) {
        const sub = member(props, e.key);
        if (sub) {
          matched = true;
          this.mergeChild(res, this.evaluate(sub, e.value, iPath, step(step(kp, 'properties'), e.key), collect));
        }
      }
      for (const p of pats) {
        if (p.re && p.re.test(e.key)) {
          matched = true;
          this.mergeChild(
            res,
            this.evaluate(p.schema, e.value, iPath, step(step(kp, 'patternProperties'), p.key), collect),
          );
        }
      }
      if (matched) {
        evaluated.add(e.key);
        continue;
      }
      if (additional) {
        evaluated.add(e.key);
        if (additional.type === 'boolean' && !additional.value)
          this.add(res, collect, {
            ip: iPath,
            kp: step(kp, 'additionalProperties'),
            schema,
            keyword: 'additionalProperties',
            message: `Property ${quote(e.key)} is not allowed: additionalProperties is false.`,
            offset: e.offset,
          });
        else this.mergeChild(res, this.evaluate(additional, e.value, iPath, step(kp, 'additionalProperties'), collect));
      }
    }
    if (props || pats.length > 0 || additional) res.props = mergeProps(res.props, additional ? true : evaluated);
    if (!res.valid && !collect) return;

    const names = rank >= 6 ? get('propertyNames') : undefined;
    if (names) {
      const seen = new Set<string>();
      for (const e of inst.entries) {
        if (seen.has(e.key)) continue;
        seen.add(e.key);
        const nameNode: JsonNode = { type: 'string', offset: e.offset, raw: e.raw, value: e.key };
        const r = this.evaluate(names, nameNode, ip, step(kp, 'propertyNames'), collect);
        if (r.valid) continue;
        res.valid = false;
        if (!collect) return;
        for (const v of r.errors)
          res.errors.push({
            ...v,
            ip: step(ip, e.key),
            message: `Property name ${quote(e.key)}: ${v.message}`,
            offset: e.offset,
          });
      }
    }
  }

  private arrayApplicators(
    schema: JsonNode,
    info: NodeInfo,
    inst: Extract<JsonNode, { type: 'array' }>,
    ip: Path | null,
    kp: Path | null,
    collect: boolean,
    res: Res,
    fail: (keyword: string, message: string, offset?: number, where?: Path | null, path?: Path) => void,
  ): void {
    const rank = draftRank(info.draft);
    const get = (k: string): JsonNode | undefined => member(schema, k);
    const items = inst.items;
    const notAllowed = (keyword: string, i: number, n: number): void =>
      fail(
        keyword,
        `Item ${i} is not allowed: the array may hold ${plural(n, 'item', 'items')} here.`,
        items[i]!.offset,
        step(ip, i),
      );

    let prefix: JsonNode[] | null = null;
    let rest: JsonNode | undefined;
    let restKeyword = '';
    const itemsKw = get('items');
    if (rank === 2020) {
      const p = get('prefixItems');
      if (p?.type === 'array') prefix = p.items;
      rest = itemsKw;
      restKeyword = 'items';
    } else if (itemsKw?.type === 'array') {
      prefix = itemsKw.items;
      rest = get('additionalItems');
      restKeyword = 'additionalItems';
    } else {
      rest = itemsKw;
      restKeyword = 'items';
    }
    const prefixKeyword = rank === 2020 ? 'prefixItems' : 'items';
    let evaluatedTo: number | true = 0;
    if (prefix) {
      const n = Math.min(prefix.length, items.length);
      for (let i = 0; i < n; i++) {
        if (!res.valid && !collect) return;
        this.mergeChild(
          res,
          this.evaluate(prefix[i]!, items[i]!, step(ip, i), step(step(kp, prefixKeyword), i), collect),
        );
      }
      evaluatedTo = n >= items.length ? true : n;
    }
    if (rest) {
      const start = prefix ? prefix.length : 0;
      for (let i = start; i < items.length; i++) {
        if (!res.valid && !collect) return;
        if (rest.type === 'boolean' && !rest.value) notAllowed(restKeyword, i, start);
        else this.mergeChild(res, this.evaluate(rest, items[i]!, step(ip, i), step(kp, restKeyword), collect));
      }
      evaluatedTo = true;
    }
    res.items = mergeItems(res.items, evaluatedTo);
    if (!res.valid && !collect) return;

    const contains = rank >= 6 ? get('contains') : undefined;
    if (contains) {
      const matched: number[] = [];
      items.forEach((item, i) => {
        if (this.evaluate(contains, item, step(ip, i), step(kp, 'contains'), false).valid) matched.push(i);
      });
      const minC = rank >= 2019 ? get('minContains') : undefined;
      const maxC = rank >= 2019 ? get('maxContains') : undefined;
      const k = BigInt(matched.length);
      const min =
        minC?.type === 'number'
          ? BigInt(toDecimal(minC.raw).digits * 10n ** BigInt(Math.max(0, toDecimal(minC.raw).exponent)))
          : 1n;
      if (k < min) {
        if (minC?.type === 'number' && min !== 1n)
          fail(
            'minContains',
            `Must contain at least ${plural(minC.raw, 'item that matches', 'items that match')} the contains schema, got ${k}.`,
          );
        else
          fail('contains', `Must contain an item that matches the contains schema; none of the ${items.length} does.`);
      }
      if (maxC?.type === 'number') {
        const max = toDecimal(maxC.raw);
        if (compareDecimal(toDecimal(String(k)), max) > 0)
          fail(
            'maxContains',
            `Must contain at most ${plural(maxC.raw, 'item that matches', 'items that match')} the contains schema, got ${k}.`,
          );
      }
      if (rank === 2020) {
        res.contained ??= new Set();
        for (const i of matched) res.contained.add(i);
      }
    }
  }

  private unevaluated(
    schema: JsonNode,
    info: NodeInfo,
    inst: JsonNode,
    ip: Path | null,
    kp: Path | null,
    collect: boolean,
    res: Res,
  ): void {
    void info;
    const get = (k: string): JsonNode | undefined => member(schema, k);
    if (inst.type === 'array') {
      const u = get('unevaluatedItems');
      if (u && res.items !== true) {
        const from = res.items;
        for (let i = from; i < inst.items.length; i++) {
          if (res.contained?.has(i)) continue;
          if (!res.valid && !collect) return;
          if (u.type === 'boolean' && !u.value)
            this.add(res, collect, {
              ip: step(ip, i),
              kp: step(kp, 'unevaluatedItems'),
              schema,
              keyword: 'unevaluatedItems',
              message: `Item ${i} is not allowed: no keyword evaluates it and unevaluatedItems is false.`,
              offset: inst.items[i]!.offset,
            });
          else
            this.mergeChild(res, this.evaluate(u, inst.items[i]!, step(ip, i), step(kp, 'unevaluatedItems'), collect));
        }
        if (res.valid) res.items = true;
      }
    }
    if (inst.type === 'object') {
      const u = get('unevaluatedProperties');
      if (u && res.props !== true) {
        const done = res.props;
        for (const e of inst.entries) {
          if (done?.has(e.key)) continue;
          if (!res.valid && !collect) return;
          if (u.type === 'boolean' && !u.value)
            this.add(res, collect, {
              ip: step(ip, e.key),
              kp: step(kp, 'unevaluatedProperties'),
              schema,
              keyword: 'unevaluatedProperties',
              message: `Property ${quote(e.key)} is not allowed: no keyword evaluates it and unevaluatedProperties is false.`,
              offset: e.offset,
            });
          else
            this.mergeChild(
              res,
              this.evaluate(u, e.value, step(ip, e.key), step(kp, 'unevaluatedProperties'), collect),
            );
        }
        if (res.valid) res.props = true;
      }
    }
  }

  /** `<resource>#<pointer>/<keyword>` of a violation: where the keyword is written. */
  absoluteLocation(v: RawViolation): string {
    const info = this.indexes.map(ix => ix.info.get(v.schema)).find(Boolean);
    if (!info) return `#${pointerOf(v.kp)}`;
    // The keyword's tokens are what the keyword path adds after the schema node: `required`, `dependentRequired/a`.
    const tail =
      v.kp && v.kp.token !== v.keyword && v.kp.parent?.token === v.keyword
        ? `/${v.keyword}/${pointerOf(step(null, v.kp.token)).slice(1)}`
        : v.keyword === 'false'
          ? ''
          : `/${v.keyword}`;
    const base = info.resource.startsWith('file:///') ? '' : showUri(info.resource);
    return `${base}#${info.pointer}${tail}`;
  }
}
