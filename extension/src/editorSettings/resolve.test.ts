/**
 * What applies to a text (./resolve.ts), level by level, and the indentation detected from a text (./detect.ts) with
 * its limits.
 */
import {
  DETECT_MAX_CHARS,
  DETECT_MAX_LINES,
  DETECT_MIN_LINES,
  countingDetector,
  detectIndent,
  noDetector,
} from './detect';
import { BUILT_IN_LANGUAGES, BUILT_IN_VALUES, defaultEditorSettings } from './model';
import { effectiveEditorSettings, indentSource, toModuleSettings } from './resolve';
import { LANGUAGES } from '@src/compare/languages';
import { describe, expect, it } from 'vitest';
import type { DetectedIndent } from './detect';
import type { EditorSettingsRecord } from './model';
import type { FileChoice, ProjectValues, ResolveInput } from './resolve';

const set = (change: (r: EditorSettingsRecord) => EditorSettingsRecord = r => r): EditorSettingsRecord =>
  change(defaultEditorSettings());

const resolve = (input: Partial<ResolveInput> & { language: string }) =>
  effectiveEditorSettings({ profile: set(), detected: null, project: null, file: null, ...input });

describe('effectiveEditorSettings: one level after another, strongest first', () => {
  it('6. the built-in values for what the set does not hold', () => {
    const e = resolve({ language: 'rust', profile: { base: {}, languages: {} } });
    expect(e.values).toEqual(BUILT_IN_VALUES);
    expect(new Set(Object.values(e.sources))).toEqual(new Set(['default']));
    expect(indentSource(e)).toBe('default');
  });

  it('5. the general values of the set', () => {
    const profile = set(r => ({ ...r, base: { ...r.base, indentSize: 2, whitespace: true } }));
    const e = resolve({ language: 'rust', profile });
    expect([e.values.indentStyle, e.values.indentSize, e.values.whitespace]).toEqual(['space', 2, true]);
    expect([e.sources.indentSize, e.sources.indentStyle]).toEqual(['general', 'general']);
    expect(indentSource(e)).toBe('general');
  });

  it('4. a language’s row over the general values, value by value', () => {
    const go = resolve({ language: 'go' });
    expect([go.values.indentStyle, go.values.indentSize]).toEqual(['tab', 4]);
    expect([go.sources.indentStyle, go.sources.indentSize]).toEqual(['language', 'general']);
    expect(indentSource(go)).toBe('language');
    const yaml = resolve({ language: 'yaml' });
    expect([yaml.values.indentStyle, yaml.values.indentSize]).toEqual(['space', 2]);
    expect(resolve({ language: 'markdown' }).values.softWrap).toBe(true);
    expect(resolve({ language: 'text' }).values.softWrap).toBe(true);
    expect(resolve({ language: 'ruby' }).values.indentSize).toBe(2);
    // A language with no row, and an id the editor does not know: the general values.
    expect(resolve({ language: 'python' }).values.indentSize).toBe(4);
    expect(resolve({ language: 'cobol' }).values).toEqual(BUILT_IN_VALUES);
  });

  it('3. the detected indentation over the language — only where the set says to detect', () => {
    const detected: DetectedIndent = { indentStyle: 'space', indentSize: 4 };
    const yaml = resolve({ language: 'yaml', detected });
    expect([yaml.values.indentSize, yaml.sources.indentSize, indentSource(yaml)]).toEqual([4, 'detected', 'detected']);
    // Tabs detected: the style is the file's, the size stays the set's.
    const tabs = resolve({ language: 'python', detected: { indentStyle: 'tab' } });
    expect([tabs.values.indentStyle, tabs.values.indentSize]).toEqual(['tab', 4]);
    expect([tabs.sources.indentStyle, tabs.sources.indentSize]).toEqual(['detected', 'general']);
    const off = resolve({
      language: 'yaml',
      detected,
      profile: set(r => ({ ...r, base: { ...r.base, detectIndent: false } })),
    });
    expect([off.values.indentSize, off.sources.indentSize]).toEqual([2, 'language']);
  });

  it('2. the project’s settings over the detected indentation (stage 3: no level yet, a named place)', () => {
    const project: ProjectValues = { indentStyle: 'tab' };
    const e = resolve({ language: 'python', detected: { indentStyle: 'space', indentSize: 2 }, project });
    expect([e.values.indentStyle, e.values.indentSize]).toEqual(['tab', 2]);
    expect([e.sources.indentStyle, e.sources.indentSize]).toEqual(['project', 'detected']);
    expect(indentSource(e)).toBe('project');
  });

  it('1. the person’s choice for this file over everything', () => {
    const file: FileChoice = { indentStyle: 'space', indentSize: 3 };
    const e = resolve({
      language: 'go',
      detected: { indentStyle: 'tab' },
      project: { indentStyle: 'tab', indentSize: 8 },
      file,
    });
    expect([e.values.indentStyle, e.values.indentSize]).toEqual(['space', 3]);
    expect(indentSource(e)).toBe('file');
    // Only the size chosen: the style stays the next level’s.
    const sizeOnly = resolve({ language: 'go', file: { indentSize: 2 } });
    expect([sizeOnly.values.indentStyle, sizeOnly.sources.indentStyle, sizeOnly.values.indentSize]).toEqual([
      'tab',
      'language',
      2,
    ]);
  });

  it('keeps the indent size within 1…16 whatever a level says', () => {
    expect(resolve({ language: 'rust', file: { indentSize: 100 } }).values.indentSize).toBe(16);
    expect(resolve({ language: 'rust', file: { indentSize: 0 } }).values.indentSize).toBe(1);
    expect(resolve({ language: 'rust', project: { indentSize: -5 } }).values.indentSize).toBe(1);
    expect(resolve({ language: 'rust', profile: { base: { indentSize: 1e9 }, languages: {} } }).values.indentSize).toBe(
      16,
    );
  });

  it('gives the module every value it shows, and keeps the detection switch to itself', () => {
    const e = resolve({ language: 'go' });
    expect(toModuleSettings(e)).toEqual({
      indentStyle: 'tab',
      indentSize: 4,
      softWrap: false,
      whitespace: false,
      indentGuides: true,
      lineNumbers: true,
      fontSize: null,
    });
  });

  it('the built-in rows name languages of the editor only', () => {
    for (const id of Object.keys(BUILT_IN_LANGUAGES)) expect(LANGUAGES.some(l => l.id === id)).toBe(true);
  });
});

const lines = (...indents: Array<number | string>): string =>
  indents.map(i => (typeof i === 'number' ? `${' '.repeat(i)}x` : `${i}x`)).join('\n');

describe('detectIndent: the indentation a text already uses', () => {
  it('spaces: the most frequent step between lines', () => {
    expect(detectIndent(lines(0, 4, 8, 4, 8, 12))).toEqual({ indentStyle: 'space', indentSize: 4 });
    expect(detectIndent(lines(0, 2, 4, 2, 4, 6, 2))).toEqual({ indentStyle: 'space', indentSize: 2 });
    expect(detectIndent(lines(0, 8, 16, 8, 16, 8))).toEqual({ indentStyle: 'space', indentSize: 8 });
  });

  it('tabs: the style, and no size (a tab does not say how wide it is)', () => {
    expect(detectIndent(lines(0, '\t', '\t\t', '\t', '\t\t', '\t'))).toEqual({ indentStyle: 'tab' });
    expect(countingDetector.detect('func main() {\n\tfmt.Println()\n\tif x {\n\t\ty()\n\t}\n\treturn\n}\n')).toEqual({
      indentStyle: 'tab',
    });
  });

  it('mixed: the majority wins', () => {
    expect(detectIndent(lines(0, '\t', '\t', '\t', '\t', 4, 8))).toEqual({ indentStyle: 'tab' });
    expect(detectIndent(lines(0, 4, 8, 4, 8, '\t', 4))).toEqual({ indentStyle: 'space', indentSize: 4 });
    // Steps outside 2, 4, 6, 8 say spaces but no size.
    expect(detectIndent(lines(0, 3, 6, 9, 6, 3, 6))).toEqual({ indentStyle: 'space' });
    expect(detectIndent(lines(0, 1, 0, 1, 0, 1, 0, 1, 0, 1))).toEqual({ indentStyle: 'space' });
  });

  it(`too few indented lines (fewer than ${DETECT_MIN_LINES}), empty and blank texts: nothing detected`, () => {
    expect(detectIndent('')).toBeNull();
    expect(detectIndent('\n\n   \n\t\n')).toBeNull();
    expect(detectIndent(lines(0, 4, 8, 4))).toBeNull();
    expect(detectIndent('no indentation\nat all\n')).toBeNull();
    // Blank lines and Windows line ends do not count as indented lines.
    expect(detectIndent('a\r\n    b\r\n\r\n    c\r\n        d\r\n    e\r\n    f\r\n')).toEqual({
      indentStyle: 'space',
      indentSize: 4,
    });
  });

  it('a huge or hostile text is judged by its start, within bounds', () => {
    // 200 000 lines: only the first 10 000 count, and it ends in time.
    const huge = `${lines(0, 2, 4, 2)}\n`.repeat(50_000);
    const started = performance.now();
    expect(detectIndent(huge)).toEqual({ indentStyle: 'space', indentSize: 2 });
    expect(performance.now() - started).toBeLessThan(500);
    // Past the line limit, a different indentation is not read.
    const head = `${lines(0, '\t', '\t', '\t', '\t', '\t')}\n`;
    const tail = `${lines(0, 4, 8, 4)}\n`.repeat(DETECT_MAX_LINES);
    expect(detectIndent(head + tail)).toEqual({ indentStyle: 'space', indentSize: 4 });
    expect(detectIndent(head.repeat(2) + `${'\n'.repeat(DETECT_MAX_LINES)}${tail}`)).toEqual({ indentStyle: 'tab' });
    // One line of millions of spaces, and a text longer than the character limit.
    expect(detectIndent(' '.repeat(5_000_000))).toBeNull();
    const long = `${lines(0, '\t', '\t', '\t', '\t', '\t')}\n${'y'.repeat(DETECT_MAX_CHARS)}\n${lines(0, 4, 8, 4, 8, 4, 8, 4)}`;
    expect(detectIndent(long)).toEqual({ indentStyle: 'tab' });
  });

  it('the detector switched off detects nothing', () => {
    expect(noDetector.detect(lines(0, 4, 8, 4, 8, 12))).toBeNull();
  });
});
