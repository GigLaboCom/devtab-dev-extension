// The logic against independent implementations already on this machine (docs/tools/specs/data-units.md §10, §15):
// - Python's fractions.Fraction and decimal (ROUND_HALF_UP) with their own unit table: thousands of generated values and
//   unit pairs, the exact value in the target unit and its rounding to 3–15 significant digits; transfer times in words
//   and seconds;
// - this machine's ls and du (macOS, BSD) on sparse files of generated sizes: ls -l, ls -lh, du -A -h, du -A --si,
//   du -A -k, -m, -g — our exact value, rounded by the rule the program documents or shows, against what it prints.
// Every difference fails the run unless it is an explained class (counted and printed). Not part of `pnpm check`: it
// needs python3 and a macOS ls/du, installs nothing and skips without them.
// Run: pnpm --filter @workspace/tool-logic-data-units exec vitest run --config scripts/cross-check.config.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorText, ladder, parseValue, power, ratio, solveTransfer } from '../src/index.ts';

const python = spawnSync('python3', ['-I', '-c', 'print(1)'], { encoding: 'utf8' });
const PYTHON = python.status === 0;
const BSD = process.platform === 'darwin';

const seeded = seed => () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0), seed);
const next = seeded(0x5eed);
const below = n => next() % n;
const digits = n => Array.from({ length: n }, () => String(below(10))).join('');

const PREFIX = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y', 'R', 'Q'];
const BINARY = ['', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi', 'Ei', 'Zi', 'Yi', 'Ri', 'Qi'];
const DIGITS = ['exact', 3, 6, 9, 12, 15];

/** A plain number for Python and the same number decorated for us (groups, a comma as the decimal mark). */
const number = () => {
  const int = digits(1 + below(24)).replace(/^0+(?=\d)/, '');
  const frac = below(2) ? digits(1 + below(18)) : '';
  const exp = below(5) === 0 ? `e${below(31) - 15}` : '';
  const plain = `${int}${frac ? `.${frac}` : ''}${exp}`;
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const style = below(4);
  const decorated =
    style === 0 && int.length > 3
      ? `${grouped}${frac ? `,${frac}` : ''}${exp}` // 1 234 567,89
      : style === 1 && int.length > 3 && frac
        ? `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}${exp}` // 1,234,567.89
        : plain;
  return { plain, decorated };
};

const unit = () => {
  const step = below(11);
  const binary = step > 0 && below(2) === 0;
  const prefix = binary ? BINARY[step] : PREFIX[step];
  const base = below(2) ? 'B' : 'b';
  const rate = below(3) === 0 ? (base === 'b' ? 'ps' : '/s') : '';
  return `${prefix}${base}${rate}`;
};

const runPython = (code, data) => {
  const out = spawnSync('python3', ['-I', '-c', code], {
    input: JSON.stringify(data),
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (out.status !== 0) throw new Error(out.stderr);
  return JSON.parse(out.stdout);
};

const PY = String.raw`
import json, sys, math
from fractions import Fraction as F
from decimal import Decimal, getcontext, ROUND_HALF_UP
getcontext().prec = 700
data = json.load(sys.stdin)
LETTERS = 'kmgtpezyrq'

def factor(u, reading):
    rate = u.endswith('/s') or u.endswith('ps')
    s = u[:-2] if rate else u
    base = s[-1]; p = s[:-1]
    bits = 8 if base == 'B' else 1
    if p == '': return F(bits)
    step = LETTERS.index(p[0].lower()) + 1
    if len(p) == 2: per = 1024
    elif p == 'k' or p in 'RQ': per = 1000
    else: per = 1000 if reading == 'decimal' else 1024
    return F(bits * per ** step)

def target(label):
    s = label[:-2] if label.endswith('/s') else label
    if s in ('bytes', 'B'): return F(8)
    if s in ('bits', 'bit'): return F(1)
    bits = 8 if s.endswith('B') else 1
    p = s[:-1] if s.endswith('B') else s[:-3]
    step = LETTERS.index(p[0].lower()) + 1
    return F(bits * (1024 if p.endswith('i') else 1000) ** step)

def text(d):
    t = format(d, 'f')
    if '.' in t: t = t.rstrip('0').rstrip('.')
    return t

def show(x, digits):
    if x == 0: return '0'
    d = Decimal(x.numerator) / Decimal(x.denominator)
    exact = Decimal(x.numerator) / Decimal(x.denominator) * x.denominator == x.numerator
    if digits == 'exact':
        if terminates(x): return text(d)
        digits = 20
        d = Decimal(x.numerator) / Decimal(x.denominator)
    places = max(0, digits - 1 - d.adjusted())
    return text(d.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))

def terminates(x):
    n = x.denominator
    while n % 2 == 0: n //= 2
    while n % 5 == 0: n //= 5
    return n == 1

def half_up(x): return math.floor(x + F(1, 2))

def words(seconds):
    if seconds == 0: return '0 seconds'
    if seconds < 1: return None
    ms = half_up(seconds * 1000)
    days, ms_ = divmod(ms, 86400000); h, ms_ = divmod(ms_, 3600000); m, ms_ = divmod(ms_, 60000); s, f = divmod(ms_, 1000)
    def pl(n, u): return f'{n} {u}' + ('' if n == '1' else 's')
    parts = []
    if days: parts.append(pl(f'{days:,}', 'day'))
    if h: parts.append(pl(str(h), 'hour'))
    if m: parts.append(pl(str(m), 'minute'))
    if s or f: parts.append(pl(str(s) + (('.' + f'{f:03d}'.rstrip('0')) if f else ''), 'second'))
    out = ('≈ ' if (seconds * 1000).denominator != 1 else '') + ' '.join(parts)
    if seconds >= 31557600:
        t = half_up(seconds * 10 / 31557600)
        y = f'{t // 10:,}' + (f'.{t % 10}' if t % 10 else '')
        out += f' (about {y} year' + ('' if y == '1' else 's') + ')'
    return out

res = []
for c in data['convert']:
    x = F(c['number']) * factor(c['unit'], c['reading']) / target(c['target'])
    res.append(show(x, c['digits']))
tr = []
for c in data['transfer']:
    size = F(c['size']) * factor(c['sizeUnit'], 'decimal')
    rate = F(c['rate']) * factor(c['rateUnit'], 'decimal') * (100 - F(c['overhead'])) / 100
    seconds = size / rate
    tr.append({'words': words(seconds), 'seconds': show(seconds, 'exact')})
print(json.dumps({'convert': res, 'transfer': tr}))
`;

const read = (text, reading, digits = 'exact') => {
  const r = parseValue(text, reading, digits);
  if (!r || !r.ok) throw new Error(`${text}: ${r && !r.ok ? errorText(r.error) : 'empty'}`);
  return r.value;
};

const rowsOf = (value, digits) => {
  const out = {};
  for (const s of ladder(value.bits, value.rate, value.unit?.base === 'bit' ? 'bit' : 'byte', digits))
    for (const row of [s.base, ...s.decimal.rows, ...s.binary.rows]) out[row.label] = row.value.copy;
  return out;
};

describe.skipIf(!PYTHON)('Python fractions and decimal', () => {
  it('converts thousands of values between unit pairs exactly and rounds them the same', () => {
    const cases = [];
    for (let i = 0; i < 4_000; i++) {
      const n = number();
      const u = unit();
      const reading = below(2) ? 'decimal' : 'binary';
      const value = read(`${n.decorated} ${u}`, reading);
      const labels = Object.keys(rowsOf(value, 'exact'));
      const label = labels[below(labels.length)];
      const digits = DIGITS[below(DIGITS.length)];
      cases.push({ number: n.plain, unit: u, reading, target: label, digits, ours: rowsOf(value, digits)[label] });
    }
    const transfers = [];
    for (let i = 0; i < 1_500; i++) {
      const size = number().plain.replace(/e.*/, '');
      const rate = `${1 + below(10_000)}${below(2) ? `.${digits(1 + below(3))}` : ''}`;
      const sizeUnit = ['B', 'kB', 'MB', 'GB', 'TB', 'GiB', 'MiB'][below(7)];
      const rateUnit = ['bps', 'kbps', 'Mbps', 'Gbps', 'MB/s', 'KiB/s'][below(6)];
      const overhead = below(3) === 0 ? String(below(50)) : '0';
      const a = solveTransfer(
        { solve: 'time', size: `${size} ${sizeUnit}`, rate: `${rate} ${rateUnit}`, time: '', overhead },
        'decimal',
        'exact',
      );
      const rows = Object.fromEntries((a.result?.rows ?? []).map(r => [r.id, r]));
      transfers.push({
        size,
        sizeUnit,
        rate,
        rateUnit,
        overhead,
        words: rows.time?.value,
        seconds: rows.seconds?.copy,
      });
    }
    const py = runPython(PY, { convert: cases, transfer: transfers });
    let mismatches = 0;
    cases.forEach((c, i) => {
      if (c.ours !== py.convert[i]) {
        mismatches++;
        if (mismatches < 10) console.log('convert mismatch', c, py.convert[i]);
      }
    });
    let compared = cases.length;
    transfers.forEach((t, i) => {
      compared += 1;
      if (t.seconds !== py.transfer[i].seconds) mismatches++;
      if (py.transfer[i].words !== null) {
        compared += 1;
        if (t.words !== py.transfer[i].words) {
          mismatches++;
          if (mismatches < 10) console.log('transfer mismatch', t, py.transfer[i]);
        }
      }
    });
    console.log(
      `Python: ${compared} comparisons (${cases.length} conversions, ${transfers.length} transfers), ${mismatches} mismatches`,
    );
    expect(mismatches).toBe(0);
  });
});

/** The ceiling of a fraction of bigints. */
const ceil = r => (r.num + r.den - 1n) / r.den;
const exact = copy => {
  const [i, f = ''] = copy.split('.');
  return ratio(BigInt(i + f), power(10n, f.length));
};

/**
 * humanize_number(3) as macOS ls -h and du -h / --si print it (FreeBSD libutil): divide by 1024 (or 1000) step by step,
 * truncating, while the quotient is 1000 or more (or 999 with a remainder past the 0.95 cut); one decimal while the
 * quotient is below 9 (or 9 with a remainder below the cut), its tenth rounded half up from the last remainder only;
 * otherwise a whole number rounded half up from it. `values` — our exact value in each unit (bytes, K, M, …): the
 * truncated quotients of the chain are their whole parts, since ⌊⌊n/a⌋/b⌋ = ⌊n/(ab)⌋.
 */
const humanized = (values, letters, divisor) => {
  const cut = divisor === 1024n ? 973n : 950n; // ceil(0.95 · divisor), as libutil has it
  const q = values.map(v => v.num / v.den);
  let i = 0;
  let r = 0n;
  while ((q[i] >= 1000n || (q[i] === 999n && r >= cut)) && i < q.length - 1) {
    r = q[i] % divisor;
    i++;
  }
  if (i === 0) return `${q[0]}B`;
  if (q[i] < 9n || (q[i] === 9n && r < cut)) {
    const t = (r * 10n + divisor / 2n) / divisor;
    return `${q[i] + t / 10n}.${t % 10n}${letters[i]}`;
  }
  return `${(q[i] * 100n + (r * 100n) / divisor + 50n) / 100n}${letters[i]}`;
};

describe.skipIf(!BSD)('macOS ls and du on sparse files', () => {
  it('print what our exact values give under their rounding', () => {
    const sizes = new Set([
      0, 1, 511, 512, 513, 999, 1000, 1023, 1024, 1025, 1536, 10_239, 10_240, 1_048_575, 1_048_576,
    ]);
    for (let k = 1; k <= 4; k++)
      for (const base of [1000, 1024])
        for (const d of [-1, 0, 1]) {
          sizes.add(base ** k + d);
          sizes.add(Math.round(9.95 * base ** k) + d);
        }
    while (sizes.size < 600) sizes.add(Math.floor(2 ** (below(4_400) / 100)));
    const dir = mkdtempSync(join(tmpdir(), 'data-units-'));
    try {
      const list = [...sizes];
      const made = spawnSync(
        'python3',
        [
          '-I',
          '-c',
          'import os,sys,json\nfor n in json.load(sys.stdin): open(os.path.join(sys.argv[1], f"f{n}"), "wb").truncate(n)',
          dir,
        ],
        {
          input: JSON.stringify(list),
          encoding: 'utf8',
        },
      );
      expect(made.status).toBe(0);
      const files = list.map(n => join(dir, `f${n}`));
      const column = (args, field) => {
        const out = spawnSync(args[0], [...args.slice(1), ...files], { encoding: 'utf8', maxBuffer: 1 << 26 });
        expect(out.status).toBe(0);
        const map = {};
        for (const line of out.stdout.trim().split('\n')) {
          const parts = line.trim().split(/\s+/);
          const name = parts[parts.length - 1].split('/').pop();
          map[name] = field === 'du' ? parts[0] : parts[4];
        }
        return list.map(n => map[`f${n}`]);
      };
      const lsBytes = column(['ls', '-l'], 'ls');
      const lsHuman = column(['ls', '-lh'], 'ls');
      const duH = column(['du', '-A', '-h'], 'du');
      const duSi = column(['du', '-A', '--si'], 'du');
      const duK = column(['du', '-A', '-k'], 'du');
      const duM = column(['du', '-A', '-m'], 'du');
      const duG = column(['du', '-A', '-g'], 'du');
      let comparisons = 0;
      const mismatches = [];
      const compare = (what, n, ours, theirs) => {
        comparisons++;
        if (ours !== theirs) mismatches.push({ what, n, ours, theirs });
      };
      list.forEach((n, i) => {
        const binary = (bytes, letters) => {
          const rows = rowsOf(read(`${bytes} B`, 'decimal'), 'exact');
          return humanized([rows.bytes, ...BINARY.slice(1, 6).map(p => rows[`${p}B`])].map(exact), letters, 1024n);
        };
        const decimalRows = bytes => rowsOf(read(`${bytes} B`, 'decimal'), 'exact');
        compare('ls -l', n, decimalRows(n).bytes, lsBytes[i]);
        compare('ls -lh', n, binary(n, ['B', 'K', 'M', 'G', 'T', 'P']), lsHuman[i]);
        // du counts 512-byte blocks: the apparent size rounded up to whole blocks (its default BLOCKSIZE).
        const blocks = Math.ceil(n / 512) * 512;
        compare('du -A -h', n, binary(blocks, ['B', 'K', 'M', 'G', 'T', 'P']), duH[i]);
        const d = decimalRows(blocks);
        compare(
          'du -A --si',
          n,
          humanized([d.bytes, d.kB, d.MB, d.GB, d.TB, d.PB].map(exact), ['B', 'k', 'M', 'G', 'T', 'P'], 1000n),
          duSi[i],
        );
        compare('du -A -k', n, String(ceil(exact(d.KiB))), duK[i]);
        compare('du -A -m', n, String(ceil(exact(d.MiB))), duM[i]);
        compare('du -A -g', n, String(ceil(exact(d.GiB))), duG[i]);
      });
      const byKind = {};
      for (const m of mismatches) byKind[m.what] = (byKind[m.what] ?? 0) + 1;
      console.log(`ls/du: ${list.length} sizes, ${comparisons} comparisons, ${mismatches.length} mismatches`, byKind);
      console.log(mismatches.slice(0, 20));
      expect(mismatches).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
