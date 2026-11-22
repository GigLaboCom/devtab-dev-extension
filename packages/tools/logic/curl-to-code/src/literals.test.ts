// String literals of every client language, checked against the languages themselves (docs/tools/specs/curl-to-code.md
// §5, «Код»): every text — quotes, backslashes, line breaks, `${`, `$(`, backticks, `%`, NUL, controls, C1, non-ASCII,
// U+2028, bidi controls, the BOM, typographic quotes, unpaired surrogates — is written as a literal, the literals are
// put side by side in one array of the language, and the language reads them back. Run here: JavaScript (node:vm),
// Python (`python3`, ast.literal_eval), Go (`go run`), Rust (`rustc`), Ruby (`ruby`), Java (`java` of a JDK 11+),
// Swift (`swift`), the POSIX shell (`bash` and `/bin/sh`, and the tool's own word reader) — each when the machine has
// it, otherwise that check is skipped. Read by a reader written from the language's specification
// (readers.testing.ts): Kotlin, C#, PHP, Dart, PowerShell — the machine has none of them. A literal that ended early
// would break the array or change a neighbour.
import { hex2, wellFormed } from './literals/common';
import { csharpBytes, csharpString } from './literals/csharp';
import { dartBytes, dartString } from './literals/dart';
import { goBytes, goString } from './literals/go';
import { javaBytes, javaString } from './literals/java';
import { jsBytes, jsLatin1, jsString } from './literals/javascript';
import { kotlinBytes, kotlinString } from './literals/kotlin';
import { phpBytes, phpString } from './literals/php';
import { psBytes, psString } from './literals/powershell';
import { pyBytes, pyString } from './literals/python';
import { rubyBytes, rubyString } from './literals/ruby';
import { rustBytes, rustString } from './literals/rust';
import { printfFormat, shellBytes, shellWord } from './literals/shell';
import { swiftBytes, swiftString } from './literals/swift';
import { READERS, scan } from './readers.testing';
import { splitWords } from './words';
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { Language } from './readers.testing';

const HEAVY = { timeout: 240_000 };
const has = (command: string, args: string[]): boolean => {
  try {
    return spawnSync(command, args, { stdio: 'ignore', timeout: 30_000 }).status === 0;
  } catch {
    return false;
  }
};
const PYTHON = has('python3', ['--version']);
const GO = has('go', ['version']);
const RUSTC = has('rustc', ['--version']);
const RUBY = has('ruby', ['--version']);
const SWIFT = has('swift', ['--version']);
/** A JDK 11+: JAVA_HOME, then the usual places (macOS's /usr/bin/java is a stub without one). */
const JAVA = [
  process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin/java'),
  '/opt/homebrew/opt/openjdk/bin/java',
  '/usr/local/opt/openjdk/bin/java',
  '/usr/lib/jvm/default-java/bin/java',
  'java',
].find((j): j is string => !!j && (j === 'java' || existsSync(j)) && has(j, ['-version']));
/** bash 4.2+ and the system's POSIX sh. */
const BASH = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash'].find(existsSync);

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
  ...'aZ09 -_/:?&=;@',
  "'",
  '"',
  '\\',
  '`',
  '${',
  '$(',
  '$',
  '$x',
  '#{',
  '#',
  '%',
  '%s',
  '"#',
  '"##',
  '{}',
  '{$x}',
  '\\u0041',
  '\\x41',
  '\n',
  '\r',
  '\t',
  '\r\n',
  '\u{0}',
  '\u{0}1',
  '\u{7}',
  '\u{b}',
  '\u{1b}',
  '\u{7f}',
  '\u{85}',
  '\u{a0}',
  'é',
  'ÿ',
  'Ж',
  '€',
  '😀',
  '\u{2018}',
  '\u{2019}',
  '\u{201c}',
  '\u{201d}',
  '\u{2028}',
  '\u{2029}',
  '\u{202e}',
  '\u{2066}',
  '\u{feff}',
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
  '$(rm -rf x)',
  '#{x} #$y #@z',
  '{$x} $x',
  '100%',
  'a\nb\r\nc\td',
  '\u{0}',
  '\u{0}7',
  '\\u0022 \\u000a',
  'é 😀 Ж',
  '\u{2028}\u{2029}',
  '"#',
  'r#"x"#',
  '\u{202e}evil',
  '\u{feff}bom',
  '\u{2018}typographic\u{2019} \u{201c}quotes\u{201d}',
  '\ud83d',
  '\ude00x',
  '{"text":"line1\\nline2 é it\'s"}',
];

const TEXTS = (() => {
  const next = generator(20261122);
  const out = [...FIXED];
  for (let i = 0; i < 400; i++) {
    let s = '';
    for (let k = next(12); k > 0; k--) s += POOL[next(POOL.length)];
    out.push(s);
  }
  return out;
})();
/** Byte strings: the texts' UTF-8, and every second one with bytes that are not UTF-8. */
const BYTES = TEXTS.map((t, i) => {
  const b = Buffer.from(wellFormed(t), 'utf8');
  return i % 2 ? Buffer.concat([b, Buffer.from([0xff, 0x80, 0])]) : b;
});

const hexOf = (s: string): string => Buffer.from(s, 'utf8').toString('hex');
const utf16 = (s: string): string =>
  Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).padStart(4, '0')).join('');
const tmp = (): string => mkdtempSync(join(tmpdir(), 'curl-to-code-literals-'));

describe('the rules, by example', () => {
  it('JavaScript', () => {
    expect(jsString("it's \\ ${x} `y` %s")).toBe("'it\\'s \\\\ ${x} `y` %s'");
    expect(jsString('\u{0}\u{0}1\b\t\n\u{b}\f\r\u{1}\u{7f}\u{85}')).toBe(
      "'\\0\\x001\\b\\t\\n\\v\\f\\r\\x01\\x7F\\x85'",
    );
    expect(jsString('\u{2028}\u{202e}\u{feff}\ud800é😀')).toBe("'\\u2028\\u202E\\uFEFF\\uD800é😀'");
    expect(jsLatin1('Jörg')).toBe("'J\\xC3\\xB6rg'");
    expect(jsBytes(Uint8Array.of(0, 255))).toBe('new Uint8Array([0x00, 0xff])');
  });
  it('Python', () => {
    expect(pyString('it\'s \\ "q"')).toBe("'it\\'s \\\\ \"q\"'");
    expect(pyString('\u{0}\b\t\n\r\u{7f}\u{85}é\u{2028}\ud800')).toBe("'\\x00\\x08\\t\\n\\r\\x7f\\x85é\\u2028\\ufffd'");
    expect(pyBytes(Uint8Array.of(0x27, 0x5c, 0x41, 0x0a, 0xff))).toBe("b'\\'\\\\A\\n\\xff'");
  });
  it('Go: a raw string when it has " or \\ and fits one, otherwise strconv.Quote', () => {
    expect(goString('{"a":1}')).toBe('`{"a":1}`');
    expect(goString('a"`b')).toBe('"a\\"`b"');
    expect(goString('\u{0}\u{7}\u{7f}\u{85}\u{2028}\u{feff}\ud800')).toBe(
      '"\\x00\\a\\x7f\\u0085\\u2028\\ufeff\\ufffd"',
    );
    expect(goBytes(Uint8Array.of(0x22, 0xff))).toBe('"\\"\\xff"');
  });
  it('Rust: a raw string with the fewest #, otherwise escapes', () => {
    expect(rustString('{"a":1}')).toBe('r#"{"a":1}"#');
    expect(rustString('a"#b')).toBe('r##"a"#b"##');
    expect(rustString('\u{0}\u{7}\u{85}\u{202e}\ud800')).toBe('"\\0\\u{7}\\u{85}\\u{202e}\\u{fffd}"');
    expect(rustBytes(Uint8Array.of(0x22, 0, 0xff))).toBe('b"\\"\\0\\xff"');
  });
  it('Java: octal for controls, \\u only where a Unicode escape cannot break the literal', () => {
    expect(javaString('say "hi" \\u0022')).toBe('"say \\"hi\\" \\\\u0022"');
    expect(javaString('\u{0}7\b\t\n\f\r\u{1b}\u{7f}\u{85}')).toBe('"\\0007\\b\\t\\n\\f\\r\\033\\177\\205"');
    expect(javaString('\u{2028}\u{202e}\u{feff}\ud800é')).toBe('"\\u2028\\u202E\\uFEFF\\uFFFDé"');
    expect(javaBytes(Uint8Array.of(0, 34, 255))).toBe('new byte[] { 0, 34, -1 }');
  });
  it('Kotlin: every $ escaped, \\u for what has no short escape', () => {
    expect(kotlinString('${x} $y "q" \\')).toBe('"\\${x} \\$y \\"q\\" \\\\"');
    expect(kotlinString('\u{0}\f\n\u{85}\ud800')).toBe('"\\u0000\\u000C\\n\\u0085\\uFFFD"');
    expect(kotlinBytes(Uint8Array.of(0, 255))).toBe('byteArrayOf(0, -1)');
  });
  it('C#: simple escapes and \\uXXXX, never \\x', () => {
    expect(csharpString('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(csharpString('\u{0}1\u{7}\u{1b}\u{85}\u{2028}\ud800')).toBe('"\\01\\a\\u001B\\u0085\\u2028\\uFFFD"');
    expect(csharpBytes(Uint8Array.of(0, 255))).toBe('new byte[] { 0x00, 0xFF }');
  });
  it('PHP: single quotes unless an invisible character needs double quotes', () => {
    expect(phpString("it's $x {$y} \\")).toBe("'it\\'s $x {$y} \\\\'");
    expect(phpString('$x\n\u{0}\u{85}\u{2028}\ud800"')).toBe('"\\$x\\n\\x00\\u{85}\\u{2028}\\u{fffd}\\""');
    expect(phpBytes(Uint8Array.of(0x24, 0x22, 0xff))).toBe('"\\$\\"\\xff"');
  });
  it('Ruby: single quotes unless an invisible character needs double quotes', () => {
    expect(rubyString("it's #{x} \\")).toBe("'it\\'s #{x} \\\\'");
    expect(rubyString('#{x}\n\u{0}\u{85}\ud800"')).toBe('"\\#{x}\\n\\x00\\u0085\\uFFFD\\""');
    expect(rubyBytes(Uint8Array.of(0x23, 0xff))).toBe('"\\#\\xff".b');
  });
  it('Swift: \\u{…} for what has no short escape; a backslash cannot start \\(', () => {
    expect(swiftString('\\(x) "q"')).toBe('"\\\\(x) \\"q\\""');
    expect(swiftString('\u{0}\u{7}\u{2028}\ud800')).toBe('"\\0\\u{7}\\u{2028}\\u{FFFD}"');
    expect(swiftBytes(Uint8Array.of(0, 255))).toBe('Data([0x00, 0xFF])');
  });
  it('Dart: every $ escaped', () => {
    expect(dartString("it's ${x} $y")).toBe("'it\\'s \\${x} \\$y'");
    expect(dartString('\u{0}\u{85}\u{2028}\ud800')).toBe("'\\x00\\x85\\u{2028}\\u{FFFD}'");
    expect(dartBytes(Uint8Array.of(0, 255))).toBe('[0x00, 0xff]');
  });
  it('PowerShell: typographic quotes are quotes too', () => {
    expect(psString("it's it\u{2019}s $x `")).toBe("'it''s it\u{2019}\u{2019}s $x `'");
    expect(psString('$x "\u{201c}`\n\u{0}\u{2028}\ud800')).toBe('"`$x `"`\u{201c}```n`0`u{2028}`u{FFFD}"');
    expect(psBytes(Uint8Array.of(0, 255))).toBe('[byte[]](0x00, 0xFF)');
  });
  it("the shell: single quotes, $'…' for invisible characters, nothing for NUL", () => {
    expect(shellWord("it's $x `y`")).toBe("'it'\\''s $x `y`'");
    expect(shellWord("a\nb'\\")).toBe("$'a\\x0ab\\'\\\\'");
    expect(shellWord('a\u{0}b')).toBeNull();
    expect(shellBytes(Uint8Array.of(0x27, 0xff))).toBe("$'\\'\\xff'");
    expect(shellBytes(Uint8Array.of(0))).toBeNull();
    expect(printfFormat(Uint8Array.of(0, 0x25, 0x5c, 0x27, 0x41, 0xff))).toBe("'\\000%%\\\\'\\''A\\377'");
  });
});

describe('the languages read every literal back', () => {
  it(`JavaScript: ${TEXTS.length} texts and byte arrays`, () => {
    expect(runInNewContext(`[${TEXTS.map(jsString).join(',\n')}]`)).toEqual(TEXTS);
    const bytes = runInNewContext(`[${BYTES.map(b => jsBytes(b)).join(',\n')}]`) as Uint8Array[];
    expect(bytes.map(b => Buffer.from(b).toString('hex'))).toEqual(BYTES.map(b => b.toString('hex')));
  });

  it.skipIf(!PYTHON)(`Python: ${TEXTS.length} texts and as many byte strings`, HEAVY, () => {
    const program = [
      'import ast, sys',
      'texts, blobs = ast.literal_eval(sys.stdin.read())',
      "print('\\n'.join(t.encode('utf-8').hex() for t in texts))",
      "print('--')",
      "print('\\n'.join(b.hex() for b in blobs))",
    ].join('\n');
    const source = `([${TEXTS.map(pyString).join(',\n')}], [${BYTES.map(b => pyBytes(b)).join(',\n')}])`;
    const r = spawnSync('python3', ['-I', '-c', program], { input: source, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    const [strs, blobs] = r.stdout.trimEnd().split('\n--\n');
    expect(strs!.split('\n')).toEqual(TEXTS.map(t => hexOf(wellFormed(t))));
    expect(blobs!.split('\n')).toEqual(BYTES.map(b => b.toString('hex')));
  });

  it.skipIf(!GO)(`Go: ${TEXTS.length} texts and as many byte strings, gofmt-clean`, HEAVY, () => {
    const dir = tmp();
    try {
      const program = `package main

import (
	"fmt"
)

var texts = []string{
${TEXTS.map(t => `\t${goString(t)},`).join('\n')}
}

var blobs = []string{
${BYTES.map(b => `\t${goBytes(b)},`).join('\n')}
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
        env: { ...process.env, GO111MODULE: 'off' },
      });
      expect(r.stderr).toBe('');
      const [strs, blobs] = r.stdout.trimEnd().split('\n--\n');
      expect(strs!.split('\n')).toEqual(TEXTS.map(t => hexOf(wellFormed(t))));
      expect(blobs!.split('\n')).toEqual(BYTES.map(b => b.toString('hex')));
      expect(spawnSync('gofmt', ['-l', 'main.go'], { cwd: dir, encoding: 'utf8' }).stdout).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!RUSTC)(`Rust: ${TEXTS.length} texts and as many byte strings`, HEAVY, () => {
    const dir = tmp();
    try {
      const program = `fn main() {
    let texts: Vec<&str> = vec![
${TEXTS.map(t => `        ${rustString(t)},`).join('\n')}
    ];
    let blobs: Vec<&[u8]> = vec![
${BYTES.map(b => `        &${rustBytes(b)}[..],`).join('\n')}
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
      expect(strs!.split('\n')).toEqual(TEXTS.map(t => hexOf(wellFormed(t))));
      expect(blobs!.split('\n')).toEqual(BYTES.map(b => b.toString('hex')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!RUBY)(`Ruby: ${TEXTS.length} texts and as many byte strings`, HEAVY, () => {
    const dir = tmp();
    try {
      const program = `# encoding: utf-8
texts = [
${TEXTS.map(t => `  ${rubyString(t)},`).join('\n')}
]
blobs = [
${BYTES.map(b => `  ${rubyBytes(b)},`).join('\n')}
]
texts.each { |s| raise 'not UTF-8' unless s.valid_encoding?; puts s.unpack1('H*') }
puts '--'
blobs.each { |b| puts b.unpack1('H*') }
`;
      writeFileSync(join(dir, 'main.rb'), program);
      const r = spawnSync('ruby', ['-W0', join(dir, 'main.rb')], { encoding: 'utf8' });
      expect(r.stderr).toBe('');
      const [strs, blobs] = r.stdout.trimEnd().split('\n--\n');
      expect(strs!.split('\n')).toEqual(TEXTS.map(t => hexOf(wellFormed(t))));
      expect(blobs!.split('\n')).toEqual(BYTES.map(b => b.toString('hex')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!JAVA)(`Java: ${TEXTS.length} texts and as many byte arrays`, HEAVY, () => {
    const dir = tmp();
    try {
      const program = `public class Main {
    static final String[] TEXTS = {
${TEXTS.map(t => `        ${javaString(t)},`).join('\n')}
    };
    static final byte[][] BLOBS = {
${BYTES.map(b => `        ${javaBytes(b)},`).join('\n')}
    };
    public static void main(String[] args) {
        StringBuilder out = new StringBuilder();
        for (String s : TEXTS) {
            for (int i = 0; i < s.length(); i++) out.append(String.format("%04x", (int) s.charAt(i)));
            out.append('\\n');
        }
        out.append("--\\n");
        for (byte[] b : BLOBS) {
            for (byte x : b) out.append(String.format("%02x", x & 0xff));
            out.append('\\n');
        }
        System.out.print(out);
    }
}
`;
      writeFileSync(join(dir, 'Main.java'), program);
      const r = spawnSync(JAVA!, ['-Dfile.encoding=UTF-8', join(dir, 'Main.java')], {
        encoding: 'utf8',
        env: { ...process.env, JAVA_TOOL_OPTIONS: '' },
      });
      expect(r.stderr.replace(/^Picked up JAVA_TOOL_OPTIONS.*\n/m, '')).toBe('');
      const [strs, blobs] = r.stdout.trimEnd().split('\n--\n');
      expect(strs!.split('\n')).toEqual(TEXTS.map(t => utf16(wellFormed(t))));
      expect(blobs!.split('\n')).toEqual(BYTES.map(b => b.toString('hex')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!SWIFT)(`Swift: ${TEXTS.length} texts and as many byte strings`, HEAVY, () => {
    const dir = tmp();
    try {
      const program = `import Foundation
let texts: [String] = [
${TEXTS.map(t => `    ${swiftString(t)},`).join('\n')}
]
let blobs: [Data] = [
${BYTES.map(b => `    ${swiftBytes(b)},`).join('\n')}
]
var out = ""
for s in texts { out += s.utf8.map { String(format: "%02x", $0) }.joined() + "\\n" }
out += "--\\n"
for b in blobs { out += b.map { String(format: "%02x", $0) }.joined() + "\\n" }
print(out, terminator: "")
`;
      writeFileSync(join(dir, 'main.swift'), program);
      const r = spawnSync('swift', [join(dir, 'main.swift')], { encoding: 'utf8', cwd: dir });
      expect(r.status, r.stderr).toBe(0);
      const [strs, blobs] = r.stdout.trimEnd().split('\n--\n');
      expect(strs!.split('\n')).toEqual(TEXTS.map(t => hexOf(wellFormed(t))));
      expect(blobs!.split('\n')).toEqual(BYTES.map(b => b.toString('hex')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('the POSIX shell', () => {
    const words = TEXTS.filter(t => !t.includes('\0'));
    const blobs = BYTES.filter(b => !b.includes(0));
    it('NUL, and only NUL, cannot be written', () => {
      for (const t of TEXTS) expect(shellWord(t) === null).toBe(t.includes('\0'));
      for (const b of BYTES) expect(shellBytes(b) === null).toBe(b.includes(0));
    });
    it(`the tool's own word reader reads ${words.length} words back`, () => {
      const line = `curl ${words.map(t => shellWord(t)!).join(' ')}`;
      const r = splitWords(line);
      if (!r.ok) throw new Error(r.message);
      expect(r.words.slice(1).map(w => wellFormed(w.text))).toEqual(words.map(wellFormed));
    });
    for (const [name, shell] of [
      ['bash', BASH],
      ['/bin/sh', existsSync('/bin/sh') ? '/bin/sh' : undefined],
    ] as const)
      it.skipIf(!shell)(`${name} reads ${words.length} words and ${blobs.length} byte words back`, HEAVY, () => {
        const script = `printf '%s\\0' ${words.map(t => shellWord(t)!).join(' ')}; printf -- '--\\0'; printf '%s\\0' ${blobs.map(b => shellBytes(b)!).join(' ')}`;
        const r = spawnSync(shell!, ['-c', script], { encoding: 'buffer' });
        expect(r.stderr.toString()).toBe('');
        const parts: string[] = [];
        for (let at = 0; at < r.stdout.length;) {
          const end = r.stdout.indexOf(0, at);
          parts.push(r.stdout.subarray(at, end).toString('hex'));
          at = end + 1;
        }
        const sep = parts.indexOf(Buffer.from('--').toString('hex'));
        expect(parts.slice(0, sep)).toEqual(words.map(t => hexOf(wellFormed(t))));
        expect(parts.slice(sep + 1, sep + 1 + blobs.length)).toEqual(blobs.map(b => b.toString('hex')));
      });
    it.skipIf(!BASH)('printf formats print every byte string back', HEAVY, () => {
      for (const b of BYTES.slice(0, 120)) {
        const r = spawnSync(BASH!, ['-c', `printf ${printfFormat(b)}`], { encoding: 'buffer' });
        expect(r.stdout.toString('hex')).toBe(b.toString('hex'));
      }
    });
  });

  describe('readers written from the specifications (no compiler here)', () => {
    const readAll = (language: Language, literals: string[]): string[] => {
      const src = `[${literals.join(',\n')}]`;
      const out: string[] = [];
      let i = 1;
      for (let k = 0; k < literals.length; k++) {
        const r = READERS[language](src, i);
        out.push('value' in r ? r.value : Buffer.from(r.bytes).toString('hex'));
        i = r.end;
        expect(src.slice(i, i + 2) === ',\n' || src[i] === ']').toBe(true);
        i += 2;
      }
      return out;
    };
    const cases: Array<[Language, (t: string) => string, (t: string) => string]> = [
      ['kotlin', kotlinString, wellFormed],
      ['csharp', csharpString, wellFormed],
      ['php', phpString, t => hexOf(wellFormed(t))],
      ['dart', dartString, wellFormed],
      ['powershell', psString, wellFormed],
    ];
    it.each(cases)(`%s: ${TEXTS.length} texts`, (language, write, want) => {
      expect(readAll(language, TEXTS.map(write))).toEqual(TEXTS.map(want));
    });
    it('PHP byte strings', () => {
      expect(
        readAll(
          'php',
          BYTES.map(b => phpBytes(b)),
        ),
      ).toEqual(BYTES.map(b => b.toString('hex')));
    });
    it('the readers refuse what the languages refuse', () => {
      expect(() => READERS.kotlin('"a$b"', 0)).toThrow(/template/);
      expect(() => READERS.kotlin('"a\\x41"', 0)).toThrow(/escape/);
      expect(() => READERS.csharp('"a\u{2028}"', 0)).toThrow(/new-line/);
      expect(() => READERS.php('"$x"', 0)).toThrow(/interpolation/);
      expect(() => READERS.php('"{$x}"', 0)).toThrow(/interpolation/);
      expect(() => READERS.dart("'${x}'", 0)).toThrow(/interpolation/);
      expect(() => READERS.powershell('"$x"', 0)).toThrow(/variable/);
      expect(() => READERS.powershell("'it\u{2019}s'", 0)).not.toThrow();
      expect(READERS.powershell("'it\u{2019}s'", 0)).toMatchObject({ value: 'it', end: 4 });
      expect(scan('csharp', `// "\nx('"', "a\\"b");`)).toEqual(['a"b']);
    });
    it('Kotlin, C#, Dart and PowerShell byte arrays are numbers in range', () => {
      for (const b of BYTES.slice(0, 50)) {
        const nums = (s: string): number[] => (s.match(/-?(?:0x[0-9A-Fa-f]+|\d+)/g) ?? []).map(Number);
        expect(nums(kotlinBytes(b)).map(n => (n + 256) % 256)).toEqual([...b]);
        expect(nums(csharpBytes(b))).toEqual([...b]);
        expect(nums(dartBytes(b))).toEqual([...b]);
        expect(nums(psBytes(b).slice('[byte[]]'.length))).toEqual([...b]);
        expect(nums(kotlinBytes(b)).every(n => n >= -128 && n <= 127)).toBe(true);
      }
      expect(hex2(255)).toBe('ff');
    });
  });
});
