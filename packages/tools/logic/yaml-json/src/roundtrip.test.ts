/**
 * The round trip of docs/tools/specs/yaml-json.md §10, last row: random JSON made of the strings and numbers YAML readers
 * disagree on, JSON → YAML → JSON in 1.2 and in 1.1 — the same JSON, character for character. Deterministic (a seeded
 * generator), so a failure names its case.
 */
import { jsonToYaml, yamlToJson } from './convert';
import { describe, expect, it } from 'vitest';

const STRINGS = [
  'yes',
  'no',
  'on',
  'off',
  'y',
  'n',
  'Y',
  'N',
  'Yes',
  'NO',
  'On',
  'OFF',
  'true',
  'False',
  'TRUE',
  'null',
  'Null',
  'NULL',
  '~',
  '',
  ' ',
  '0o10',
  '0o7',
  '010',
  '0x1F',
  '0b101',
  '1_000',
  '1:20',
  '1:20.5',
  '+12',
  '-0',
  '1e3',
  '.5',
  '1.0',
  '.inf',
  '-.Inf',
  '.NaN',
  '2024-01-15',
  '2001-12-14t21:59:43.10-05:00',
  'a: b',
  'a #b',
  '#c',
  '- a',
  '-',
  '--',
  '---',
  '...',
  '*x',
  '&a',
  '!tag',
  '!!str',
  '%YAML',
  '@x',
  '`x`',
  '? x',
  '?',
  ':',
  ': x',
  '|',
  '>',
  '|-',
  "'q'",
  '"q"',
  "it's",
  '\\',
  ' x',
  'x ',
  ' x\ny',
  '\tx\ny',
  'a\nb',
  'a\n',
  '\n',
  '\n\n',
  'a\n\nb\n',
  'line1\nline2\n',
  'a\r\nb',
  'a\rb',
  'a\tb',
  '\t',
  'a\u0001b',
  '\u0000',
  '\u007f',
  '\u0085',
  ' ',
  ' x',
  '﻿a',
  'привет 🙂',
  '🙂',
  'x'.repeat(130),
  `${'w '.repeat(60)}end`,
  '<<',
  '=',
  '[a]',
  '{a: 1}',
  'a, b',
  'a,b',
  '{',
  '}',
  '[',
  ']',
  '0',
  '00',
  '1.',
  'e3',
  '0e0',
];
const NUMBERS = [
  '0',
  '-0',
  '1',
  '-1',
  '1.50',
  '1.0',
  '1E400',
  '-1e-400',
  '1e3',
  '3.14',
  '12345678901234567890',
  '9007199254740993',
  '0.1000000000000000055511151231257827',
  '-2.5E-3',
];

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const generate = (random: () => number): string => {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const string = (): string => {
    const r = random();
    if (r < 0.75) return pick(STRINGS);
    if (r < 0.9) return `${pick(STRINGS)}${pick(STRINGS)}`;
    return `${pick(STRINGS)} ${pick(STRINGS)}`;
  };
  const value = (depth: number): string => {
    const r = random();
    if (depth < 4 && r < 0.2) {
      const n = Math.floor(random() * 5);
      const keys = new Set<string>();
      const entries: string[] = [];
      for (let i = 0; i < n; i++) {
        const key = string();
        if (keys.has(key)) continue;
        keys.add(key);
        entries.push(`${JSON.stringify(key)}:${value(depth + 1)}`);
      }
      return `{${entries.join(',')}}`;
    }
    if (depth < 4 && r < 0.35) {
      const n = Math.floor(random() * 5);
      return `[${Array.from({ length: n }, () => value(depth + 1)).join(',')}]`;
    }
    if (r < 0.7) return JSON.stringify(string());
    if (r < 0.9) return pick(NUMBERS);
    return pick(['true', 'false', 'null']);
  };
  return value(0);
};

describe('JSON → YAML → JSON (§5 «JSON → YAML», 4)', () => {
  it('20 000 random documents come back unchanged in YAML 1.2 and 1.1', () => {
    const random = mulberry32(Number(process.env.ROUNDTRIP_SEED ?? 20261121));
    const failures: string[] = [];
    let checked = 0;
    for (let i = 0; i < 20_000 && failures.length < 5; i++) {
      const json = generate(random);
      const yaml = jsonToYaml(json, { indent: i % 2 ? 2 : 4 });
      if (!yaml.ok) {
        failures.push(`${json} → ${yaml.error.message}`);
        continue;
      }
      for (const version of ['1.2', '1.1'] as const) {
        const back = yamlToJson(yaml.text, { version, layout: 'minify' });
        const text = back.ok ? back.text : `error ${back.error.line}:${back.error.column} ${back.error.message}`;
        checked++;
        if (text !== json) failures.push(`${version}: ${json}\n${yaml.text}→ ${text}`);
      }
    }
    expect(failures).toEqual([]);
    expect(checked).toBe(40_000);
  }, 120_000);
});
