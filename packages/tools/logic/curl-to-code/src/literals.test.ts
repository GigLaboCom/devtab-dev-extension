// String literals checked against the languages themselves (docs/tools/specs/curl-to-code.md §5, «Код»): every text —
// quotes, backslashes, line breaks, `${`, backticks, `%`, NUL, controls, C1, non-ASCII, U+2028, bidi controls, the BOM,
// unpaired surrogates — is written as a literal, the literals are put side by side in one array of the language, and
// the language reads them back: JavaScript here (node:vm), Python (`python3`, ast.literal_eval), Go (`go run`) and Rust
// (`rustc`) when the machine has them — otherwise that language's checks are skipped and the rules are only checked
// by the expectations below. A literal that ended early would break the array or change a neighbour.
import { goBytes, goString, jsBytes, jsLatin1, jsString, pyBytes, pyString, rustBytes, rustString } from './literals';
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const HEAVY = { timeout: 120_000 };
const has = (command: string, args: string[]): boolean => {
  try {
    return spawnSync(command, args, { stdio: 'ignore', timeout: 20_000 }).status === 0;
  } catch {
    return false;
  }
};
const PYTHON = has('python3', ['--version']);
const GO = has('go', ['version']);
const RUSTC = has('rustc', ['--version']);

const generator = (seed: number) => {
  let state = seed >>> 0 || 1;
  return (n: number): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % n;
  };
};

const POOL = [
  ...'aZ09 -_/:?&=',
  "'",
  '"',
  '\\',
  '`',
  '${',
  '$',
  '%',
  '%s',
  '#',
  '"#',
  '"##',
  '{}',
  '\n',
  '\r',
  '\t',
  '\r\n',
  '\u0000',
  '\u00001',
  '\u0007',
  '\u000b',
  '\u001b',
  '\u007f',
  '\u0085',
  '\u00a0',
  'é',
  'ÿ',
  'Ж',
  '€',
  '😀',
  '\u2028',
  '\u2029',
  '\u202e',
  '\u2066',
  '\ufeff',
  '\ud800',
  '\udfff',
];

const FIXED = [
  '',
  'plain',
  "it's",
  'say "hi"',
  'C:\\path\\',
  '\\',
  '"',
  "'",
  '`${x}`',
  '100%',
  'a\nb\r\nc\td',
  '\u0000',
  '\u00007',
  'é 😀 Ж',
  '\u2028\u2029',
  '"#',
  'r#"x"#',
  '\u202eevil',
  '\ufeffbom',
  '\ud83d',
  '\ude00x',
  '{"text":"line1\\nline2 é it\'s"}',
];

const texts = (() => {
  const next = generator(20261122);
  const out = [...FIXED];
  for (let i = 0; i < 400; i++) {
    let s = '';
    for (let k = next(12); k > 0; k--) s += POOL[next(POOL.length)];
    out.push(s);
  }
  return out;
})();

/** What a language that cannot hold an unpaired surrogate reads: U+FFFD in its place. */
const wellFormed = (s: string): string =>
  s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd');
const hexOf = (s: string): string => Buffer.from(s, 'utf8').toString('hex');

const tmp = (): string => mkdtempSync(join(tmpdir(), 'curl-to-code-literals-'));

describe('the rules, by example', () => {
  it('JavaScript', () => {
    expect(jsString("it's \\ ${x} `y` %s")).toBe("'it\\'s \\\\ ${x} `y` %s'");
    expect(jsString('\u0000\u00001\b\t\n\u000b\f\r\u0001\u007f\u0085')).toBe(
      "'\\0\\x001\\b\\t\\n\\v\\f\\r\\x01\\x7F\\x85'",
    );
    expect(jsString('\u2028\u202e\ufeff\ud800é😀')).toBe("'\\u2028\\u202E\\uFEFF\\uD800é😀'");
    expect(jsLatin1('Jörg')).toBe("'J\\xC3\\xB6rg'");
    expect(jsBytes(Uint8Array.of(0, 255))).toBe('new Uint8Array([0x00, 0xff])');
  });
  it('Python', () => {
    expect(pyString('it\'s \\ "q"')).toBe("'it\\'s \\\\ \"q\"'");
    expect(pyString('\u0000\b\t\n\r\u007f\u0085é\u2028\ud800')).toBe("'\\x00\\x08\\t\\n\\r\\x7f\\x85é\\u2028\\ufffd'");
    expect(pyBytes(Uint8Array.of(0x27, 0x5c, 0x41, 0x0a, 0xff))).toBe("b'\\'\\\\A\\n\\xff'");
  });
  it('Go: a raw string when it has " or \\ and fits one, otherwise strconv.Quote', () => {
    expect(goString('{"a":1}')).toBe('`{"a":1}`');
    expect(goString('C:\\x')).toBe('`C:\\x`');
    expect(goString('a"`b')).toBe('"a\\"`b"');
    expect(goString('a"\rb')).toBe('"a\\"\\rb"');
    expect(goString('say "hi"\n')).toBe('`say "hi"\n`');
    expect(goString('plain é')).toBe('"plain é"');
    expect(goString('\u0000\u0007\u007f\u0085\u2028\ufeff\ud800')).toBe('"\\x00\\a\\x7f\\u0085\\u2028\\ufeff\\ufffd"');
    expect(goBytes(Uint8Array.of(0x22, 0xff))).toBe('"\\"\\xff"');
  });
  it('Rust: a raw string with the fewest #, otherwise escapes', () => {
    expect(rustString('{"a":1}')).toBe('r#"{"a":1}"#');
    expect(rustString('C:\\x')).toBe('r"C:\\x"');
    expect(rustString('a"#b')).toBe('r##"a"#b"##');
    expect(rustString('a"\rb')).toBe('"a\\"\\rb"');
    expect(rustString('plain é')).toBe('"plain é"');
    expect(rustString('\u0000\u0007\u0085\u202e\ud800')).toBe('"\\0\\u{7}\\u{85}\\u{202e}\\u{fffd}"');
    expect(rustBytes(Uint8Array.of(0x22, 0, 0xff))).toBe('b"\\"\\0\\xff"');
  });
});

describe('the languages read every literal back', () => {
  it(`JavaScript: ${texts.length} texts`, () => {
    const back = runInNewContext(`[${texts.map(jsString).join(',\n')}]`) as string[];
    expect(back).toEqual(texts);
  });

  it.skipIf(!PYTHON)(`Python: ${texts.length} texts and as many byte strings`, HEAVY, () => {
    const bytes = texts.map(t => Buffer.from(wellFormed(t), 'utf8'));
    const program = [
      'import ast, sys',
      `src = sys.stdin.read()`,
      'texts, blobs = ast.literal_eval(src)',
      "print('\\n'.join(t.encode('utf-8', 'surrogatepass').hex() for t in texts))",
      "print('--')",
      "print('\\n'.join(b.hex() for b in blobs))",
    ].join('\n');
    const source = `([${texts.map(pyString).join(',\n')}], [${bytes.map(b => pyBytes(b)).join(',\n')}])`;
    const r = spawnSync('python3', ['-I', '-c', program], { input: source, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    const [strs, blobs] = r.stdout.trimEnd().split('\n--\n');
    expect(strs!.split('\n')).toEqual(texts.map(t => hexOf(wellFormed(t))));
    expect(blobs!.split('\n')).toEqual(bytes.map(b => b.toString('hex')));
  });

  it.skipIf(!GO)(`Go: ${texts.length} texts and as many byte strings, gofmt-clean`, HEAVY, () => {
    const dir = tmp();
    try {
      const bytes = texts.map((t, i) => Buffer.from(i % 2 ? `${t}\u00ff` : wellFormed(t), 'latin1'));
      const program = `package main

import (
	"fmt"
)

var texts = []string{
${texts.map(t => `\t${goString(t)},`).join('\n')}
}

var blobs = []string{
${bytes.map(b => `\t${goBytes(b)},`).join('\n')}
}

func main() {
	for _, s := range texts {
		fmt.Printf("%x\\n", s)
	}
	fmt.Println("--")
	for _, s := range blobs {
		fmt.Printf("%x\\n", s)
	}
}
`;
      writeFileSync(join(dir, 'main.go'), program);
      const r = spawnSync('go', ['run', 'main.go'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GOFLAGS: '-mod=mod', GO111MODULE: 'off' },
      });
      expect(r.stderr).toBe('');
      const [strs, blobs] = r.stdout.trimEnd().split('\n--\n');
      expect(strs!.split('\n').map(h => (h === '' ? '' : h))).toEqual(texts.map(t => hexOf(wellFormed(t))));
      expect(blobs!.split('\n')).toEqual(bytes.map(b => b.toString('hex')));
      expect(spawnSync('gofmt', ['-l', 'main.go'], { cwd: dir, encoding: 'utf8' }).stdout).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!RUSTC)(`Rust: ${texts.length} texts and as many byte strings`, HEAVY, () => {
    const dir = tmp();
    try {
      const bytes = texts.map(t => Buffer.from(wellFormed(t), 'utf8'));
      const program = `fn main() {
    let texts: Vec<&str> = vec![
${texts.map(t => `        ${rustString(t)},`).join('\n')}
    ];
    let blobs: Vec<&[u8]> = vec![
${bytes.map(b => `        &${rustBytes(b)}[..],`).join('\n')}
    ];
    for s in texts {
        println!("{}", s.bytes().map(|b| format!("{:02x}", b)).collect::<String>());
    }
    println!("--");
    for b in blobs {
        println!("{}", b.iter().map(|b| format!("{:02x}", b)).collect::<String>());
    }
}
`;
      writeFileSync(join(dir, 'main.rs'), program);
      const built = spawnSync('rustc', ['--edition', '2021', '-o', join(dir, 'main'), join(dir, 'main.rs')], {
        encoding: 'utf8',
      });
      expect(built.stderr).toBe('');
      const r = spawnSync(join(dir, 'main'), [], { encoding: 'utf8' });
      const [strs, blobs] = r.stdout.trimEnd().split('\n--\n');
      expect(strs!.split('\n')).toEqual(texts.map(t => hexOf(wellFormed(t))));
      expect(blobs!.split('\n')).toEqual(bytes.map(b => b.toString('hex')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
