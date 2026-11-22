/**
 * How programs read size suffixes (docs/tools/specs/data-units.md §5 item 19): only what each program's own
 * documentation says, read on SUFFIXES_READ. The page names the source without its address (an address in the chunk
 * would fail the build's host check); the links are in the specification.
 */
export interface SuffixRow {
  program: string;
  writes: string;
  means: string;
  source: string;
}

export const SUFFIXES_READ = '2026-11-22';

export const SUFFIXES: readonly SuffixRow[] = [
  {
    program: 'GNU coreutils dd',
    writes: 'c, w, b; kB, MB, GB …; K, M, G …, KiB, MiB …',
    means: 'c = 1, w = 2, b = 512 bytes; kB = 1,000, MB = 1,000²; K = KiB = 1,024, M = 1,024² … up to R and Q',
    source: 'GNU coreutils manual: dd invocation, Block size',
  },
  {
    program: 'GNU ls -h, du -h, df -h',
    writes: 'K, M, G …; with --si: kB, MB …',
    means: '-h: powers of 1,024 (M = 1,048,576 bytes); --si: powers of 1,000',
    source: 'GNU coreutils manual: Block size',
  },
  {
    program: 'macOS (BSD) dd',
    writes: 'b, k, m, g, t, p, w',
    means: '512; 1,024; 1,048,576; 1,073,741,824; 1,024⁴; 1,024⁵; the size of an integer',
    source: 'dd(1), macOS manual page',
  },
  {
    program: 'macOS ls -lh, du -h; du --si',
    writes: 'B, K, M, G, T, P',
    means: 'ls -h: base 2; du -h: powers of 1,024; du --si: powers of 1,000',
    source: 'ls(1), du(1), macOS manual pages',
  },
  {
    program: 'Kubernetes (memory)',
    writes: 'k, M, G, T, P, E; Ki, Mi, Gi, Ti, Pi, Ei; m',
    means: 'powers of 1,000; powers of 1,024; m is a thousandth of a byte (400m = 0.4 bytes)',
    source: 'Kubernetes docs: Resource Management for Pods and Containers',
  },
  {
    program: 'JVM -Xmx, -Xms',
    writes: 'k or K, m or M, g or G',
    means: '1,024, 1,024², 1,024³: -Xmx83886080, -Xmx81920k and -Xmx80m are the same',
    source: 'The java Command (JDK 21)',
  },
  {
    program: 'PostgreSQL (memory settings)',
    writes: 'B, kB, MB, GB, TB',
    means: 'the multiplier is 1,024, not 1,000: kB is 1,024 bytes here',
    source: 'PostgreSQL docs: Setting Parameters',
  },
  {
    program: 'Redis (redis.conf)',
    writes: '1k, 1kb, 1m, 1mb, 1g, 1gb, any case',
    means: 'k = 1,000, kb = 1,024; m = 1,000,000, mb = 1,024²; g = 1,000³, gb = 1,024³',
    source: 'redis.conf, the comment on units',
  },
  {
    program: 'systemd (MemoryMax= and others)',
    writes: 'K, M, G, T',
    means: 'base 1,024',
    source: 'systemd.resource-control(5)',
  },
];
