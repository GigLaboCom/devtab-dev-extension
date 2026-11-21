// Long inputs (docs/tools/specs/backslash-escape.md §12; docs/tools/adding-a-tool.md §7): every walk is linear, and the
// tool's two regular expressions (the Windows path of detect, the surrogate check) are anchored or a single class. A
// quadratic walk or expression fails here, not in a person's tab. The limits are generous — a slow or busy machine (the
// whole workspace's tests run at once) passes, a quadratic walk (minutes at these sizes) does not; the times measured
// are in the specification's §12.
import { DIALECTS, LIVE_INPUT, MAX_INPUT, detectBackslashEscape, escapeString, unescapeString } from './index';
import { describe, expect, it } from 'vitest';

// Heavy on purpose (thousands of generated cases, megabytes, external oracles): more than the default 5 s per test
// when the whole workspace's tests run at once.
const HEAVY = { timeout: 60_000 };

const timed = <T>(fn: () => T): [T, number] => {
  const start = performance.now();
  const value = fn();
  return [value, performance.now() - start];
};

describe('300,000 backslashes', HEAVY, () => {
  const backslashes = '\\'.repeat(300_000);

  it('detect answers at once: too long; 65,536 of them; a long network name; many escapes outside its set', () => {
    const [long, longMs] = timed(() => detectBackslashEscape(backslashes));
    expect(long).toBe(false);
    // 65,536 backslashes are 32,768 escaped backslashes: two or more of §7's set.
    const [limit, limitMs] = timed(() => detectBackslashEscape(backslashes.slice(0, 65_536)));
    expect(limit).toBe(true);
    // A network path's name runs to the end without its closing backslash: the expression backtracks once.
    const [named, namedMs] = timed(() => detectBackslashEscape(`\\\\${'a'.repeat(65_000)}`));
    expect(named).toBe(false);
    const [escapes, escapesMs] = timed(() => detectBackslashEscape(`x${'\\q'.repeat(30_000)}`));
    expect(escapes).toBe(false);
    expect(Math.max(longMs, limitMs, namedMs, escapesMs)).toBeLessThan(250);
  });

  it('Escape doubles them in every dialect', () => {
    for (const dialect of DIALECTS) {
      const [out, ms] = timed(() =>
        escapeString(backslashes, { dialect, quote: '"', nonAscii: false, withQuotes: false }),
      );
      expect(out.length).toBe(600_000);
      expect(ms).toBeLessThan(1000);
    }
  });

  it('Unescape reads them as 150,000 backslashes; one more is a lone backslash at the end', () => {
    for (const dialect of DIALECTS) {
      const [even, evenMs] = timed(() => unescapeString(backslashes, { dialect, withQuotes: false }));
      expect(even.ok && even.text.length).toBe(150_000);
      const [odd, oddMs] = timed(() => unescapeString(`${backslashes}\\`, { dialect, withQuotes: false }));
      expect(odd.ok ? null : odd.error).toEqual({
        message: 'lone backslash at the end',
        offset: 300_000,
        line: 1,
        column: 300_001,
      });
      expect(Math.max(evenMs, oddMs)).toBeLessThan(1000);
    }
  });

  it('With quotes trims and checks them linearly', () => {
    const [result, ms] = timed(() => unescapeString(` "${backslashes}" `, { dialect: 'json', withQuotes: true }));
    expect(result.ok && result.text.length).toBe(150_000);
    expect(ms).toBeLessThan(1000);
  });
});

describe('1 Mi of the worst input for each walk', HEAVY, () => {
  it('Escape: a control character in every position, every dialect, Escape non-ASCII on', () => {
    const controls = '\u0001é\u{1F600}'.repeat(LIVE_INPUT / 4);
    for (const dialect of DIALECTS) {
      const [out, ms] = timed(() => escapeString(controls, { dialect, quote: '"', nonAscii: true, withQuotes: false }));
      expect(out.length).toBeGreaterThan(controls.length);
      expect(ms).toBeLessThan(5000);
    }
  });

  it('Unescape: an escape in every position, every dialect', () => {
    const inputs = {
      json: '\\u00e9\\n'.repeat(LIVE_INPUT / 8),
      js: '\\u{1F600}\\x41'.repeat(LIVE_INPUT / 13),
      python: '\\U0001F600\\101\\q'.repeat(LIVE_INPUT / 16),
      c: '\\303\\251\\x41'.repeat(LIVE_INPUT / 12),
    };
    for (const dialect of DIALECTS) {
      const [result, ms] = timed(() => unescapeString(inputs[dialect], { dialect, withQuotes: false }));
      expect(result.ok).toBe(true);
      expect(ms).toBeLessThan(5000);
    }
  });

  it('Unescape: unpaired surrogates everywhere are counted in one pass', () => {
    const [result, ms] = timed(() =>
      unescapeString('\\ud800'.repeat(LIVE_INPUT / 6), { dialect: 'json', withQuotes: false }),
    );
    expect(result.ok && result.loneSurrogates).toBe(Math.floor(LIVE_INPUT / 6));
    expect(ms).toBeLessThan(5000);
  });
});

describe('5 Mi — the largest input the tool takes', HEAVY, () => {
  it('escapes and unescapes plain text and newline-heavy text within a few hundred milliseconds', () => {
    const plain = 'Lorem ipsum dolor sit amet, '.repeat(MAX_INPUT / 28 + 1).slice(0, MAX_INPUT);
    const lines = 'ab\n'.repeat(MAX_INPUT / 3 + 1).slice(0, MAX_INPUT);
    for (const dialect of DIALECTS) {
      for (const input of [plain, lines]) {
        const [escaped, escapeMs] = timed(() =>
          escapeString(input, { dialect, quote: '"', nonAscii: false, withQuotes: false }),
        );
        const [back, unescapeMs] = timed(() => unescapeString(escaped, { dialect, withQuotes: false }));
        expect(back.ok && back.text === input).toBe(true);
        expect(escapeMs + unescapeMs).toBeLessThan(15_000);
      }
    }
  });
});
