/**
 * The demo's projects: invented from end to end — the folders, the projects, the people, the remote's host (`.invalid`,
 * a name that never resolves), the code and the "secret" (obviously fake). Two trusted folders with names, four
 * projects in them at different depths and one outside every folder (read only); a tree with ignored entries, a file
 * with secrets, files that run code, a binary and a too-large file; changed, new, deleted and renamed files; a short
 * local history with a stretch the companion did not watch and a deleted file; commits waiting to be pushed. Times are
 * minutes before the page opened the section.
 */
import type { ProjectClass, TrustedLocation, Via } from '../types';

/** A file of the working tree or of HEAD: its text, or what stands for a file the page cannot open. */
export type DemoFile =
  string | { readonly binary: number } | { readonly large: number } | { readonly link: 'inside' | 'outside' };

export interface DemoCommitSeed {
  readonly summary: string;
  readonly author: string;
  readonly ago: number;
  readonly pushed: boolean;
  /** What its files held before it (null: the file did not exist): lets the last one be undone. */
  readonly before?: Readonly<Record<string, string | null>>;
}

export interface DemoPointSeed {
  readonly path: string;
  readonly label: string;
  readonly source: 'server' | 'companion' | 'commit';
  readonly ago: number;
  /** Null: the companion noted the moment and kept no text (`Before create`, `Deleted while away`). */
  readonly text: string | null;
}

/** A stretch the companion did not watch the project, in minutes before the page opened the section. */
export interface DemoGapSeed {
  readonly fromAgo: number;
  readonly toAgo: number;
}

export interface DemoProjectSeed {
  readonly id: string;
  readonly name: string;
  readonly displayPath: string;
  /** The trusted folder's displayPath, or null. */
  readonly location: string | null;
  readonly class: ProjectClass;
  readonly via: Via;
  readonly branch: string;
  readonly remote: string | null;
  /** `remote/branch`, or null when the branch has no upstream yet. */
  readonly upstream: string | null;
  readonly behind: number;
  readonly hooks: readonly string[];
  /** What HEAD holds. */
  readonly head: Readonly<Record<string, DemoFile>>;
  /** The working tree. */
  readonly disk: Readonly<Record<string, DemoFile>>;
  /** Ignored by `.gitignore`: a folder (`name/`) anywhere, or a file name. */
  readonly ignore: readonly string[];
  /** New path → old path. */
  readonly renames?: Readonly<Record<string, string>>;
  readonly stagedOutside?: readonly string[];
  readonly conflicted?: readonly string[];
  readonly commits: readonly DemoCommitSeed[];
  readonly history: readonly DemoPointSeed[];
  readonly gaps?: readonly DemoGapSeed[];
  readonly messages: readonly string[];
}

export const DEMO_IDENTITY = { name: 'Demo Developer', email: 'developer@example.invalid' } as const;
/** The remote every demo project pushes to: a host that does not exist. */
export const DEMO_REMOTE_HOST = 'git.example.invalid';

export const DEMO_LOCATIONS: readonly TrustedLocation[] = [
  { name: 'Work', displayPath: '~/work', mode: 'write', projects: 2, createdVia: 'init' },
  { name: 'Self', displayPath: '~/self', mode: 'write', projects: 2, createdVia: 'terminal' },
];

const HOUR = 60;
const DAY = 24 * HOUR;

/** The demo's last visit of a project (the history's «Since your last visit»): this many minutes before it began. */
export const DEMO_LAST_VISIT_MINUTES = 3 * HOUR;

// ---- ledger-api: the richest project ----------------------------------------------------------------------------

const SERVER_HEAD = `import { createServer } from 'node:http';
import { accounts } from '@/routes/accounts';
import { formatAmount } from '@/currency';

const PORT = Number(process.env.PORT ?? 8080);

export const start = () =>
  createServer((request, response) => {
    if (request.url === '/health') {
      response.end('ok');
      return;
    }
    if (request.url?.startsWith('/accounts')) {
      accounts(request, response);
      return;
    }
    response.statusCode = 404;
    response.end(formatAmount(0));
  }).listen(PORT);
`;

const SERVER_DISK = `import { createServer } from 'node:http';
import { accounts } from '@/routes/accounts';
import { invoices } from '@/routes/invoices';
import { formatAmount } from '@/money';

const PORT = Number(process.env.PORT ?? 8080);

export const start = () =>
  createServer((request, response) => {
    if (request.url === '/health') {
      response.end('ok');
      return;
    }
    if (request.url?.startsWith('/accounts')) {
      accounts(request, response);
      return;
    }
    if (request.url?.startsWith('/invoices')) {
      invoices(request, response);
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  }).listen(PORT);
`;

const SERVER_EARLIER = SERVER_DISK.replace("    response.end('not found');\n", '    response.end(formatAmount(0));\n');

const CURRENCY = `/** Formats an amount of minor units (cents) for a statement line. */
export const formatAmount = (minor: number, currency = 'EUR'): string =>
  \`\${(minor / 100).toFixed(2)} \${currency}\`;
`;

const MONEY = `/** Formats an amount of minor units (cents) for a statement line. */
export const formatAmount = (minor: number, currency = 'EUR'): string =>
  \`\${(minor / 100).toFixed(2)} \${currency}\`;

/** Rounds half to even, as the ledger's statements do. */
export const roundHalfEven = (value: number): number => {
  const floor = Math.floor(value);
  const rest = value - floor;
  if (rest !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
};
`;

const README_HEAD = `# ledger-api

A small HTTP service for the demo ledger: accounts, balances and statements.

## Run

    npm install
    npm start

The service listens on port 8080 unless PORT says otherwise.
`;

const README_DISK = README_HEAD.replace(
  'A small HTTP service for the demo ledger: accounts, balances and statements.\n',
  'A small HTTP service for the demo ledger: accounts, balances, invoices and statements.\n',
).concat(`
## Test

    npm test
`);

const PACKAGE_HEAD = `{
  "name": "ledger-api",
  "version": "0.3.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node dist/index.js",
    "build": "tsc",
    "test": "node --test"
  }
}
`;

const PACKAGE_DISK = PACKAGE_HEAD.replace('"version": "0.3.0"', '"version": "0.4.0"');

const ACCOUNTS = `import type { IncomingMessage, ServerResponse } from 'node:http';

const BALANCES = new Map([
  ['acc-001', 125_00],
  ['acc-002', 9_870_50],
]);

export const accounts = (request: IncomingMessage, response: ServerResponse) => {
  const id = request.url?.split('/')[2];
  const balance = id ? BALANCES.get(id) : undefined;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(balance === undefined ? { accounts: [...BALANCES.keys()] } : { id, balance }));
};
`;

const INVOICES = `import type { IncomingMessage, ServerResponse } from 'node:http';
import { formatAmount } from '@/money';

const OPEN = [
  { number: 'INV-1001', account: 'acc-001', amount: 42_00 },
  { number: 'INV-1002', account: 'acc-002', amount: 310_75 },
];

export const invoices = (_request: IncomingMessage, response: ServerResponse) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(OPEN.map(invoice => ({ ...invoice, label: formatAmount(invoice.amount) }))));
};
`;

const REPORT = `// The monthly report, replaced by the statements endpoint.
export const report = () => 'see /accounts';
`;

const LEDGER_HEAD: Record<string, DemoFile> = {
  '.gitignore': 'node_modules/\ndist/\n.env\n*.log\n',
  '.env.example': 'DATABASE_URL=postgres://localhost/ledger_demo\nPAYMENTS_KEY=replace-me\n',
  '.husky/pre-commit': 'npx lint-staged\n',
  '.nvmrc': '22\n',
  'README.md': README_HEAD,
  'package.json': PACKAGE_HEAD,
  'tsconfig.json':
    '{\n  "compilerOptions": {\n    "target": "es2022",\n    "module": "nodenext",\n    "strict": true,\n    "outDir": "dist"\n  }\n}\n',
  'src/index.ts': "import { start } from '@/server';\n\nstart();\n",
  'src/server.ts': SERVER_HEAD,
  'src/currency.ts': CURRENCY,
  'src/routes/accounts.ts': ACCOUNTS,
  'src/legacy/report.ts': REPORT,
  'src/db/schema.sql':
    'CREATE TABLE accounts (\n  id TEXT PRIMARY KEY,\n  balance_minor BIGINT NOT NULL DEFAULT 0\n);\n\nCREATE TABLE invoices (\n  number TEXT PRIMARY KEY,\n  account TEXT REFERENCES accounts (id),\n  amount_minor BIGINT NOT NULL\n);\n',
  'test/money.test.ts':
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { formatAmount } from '@/currency';\n\ntest('formats cents', () => {\n  assert.equal(formatAmount(12345), '123.45 EUR');\n});\n",
  'scripts/release.sh':
    '#!/bin/sh\n# Tags a release of the demo service.\nset -e\nnpm test\ngit tag "v$(node -p "require(\'./package.json\').version")"\n',
  'assets/logo.png': { binary: 18_432 },
  'fixtures/large-export.csv': { large: 7_340_032 },
  'docs/handbook': { link: 'outside' },
};

const LEDGER_DISK: Record<string, DemoFile> = {
  ...LEDGER_HEAD,
  '.env':
    '# Demo only: nothing here is real.\nDATABASE_URL=postgres://localhost/ledger_demo\nPAYMENTS_KEY=xxxxxxxxxxxxxxxx\n',
  'README.md': README_DISK,
  'package.json': PACKAGE_DISK,
  'src/server.ts': SERVER_DISK,
  'src/money.ts': MONEY,
  'src/routes/invoices.ts': INVOICES,
  'node_modules/left-pad/package.json': '{ "name": "left-pad", "version": "1.3.0" }\n',
  'node_modules/left-pad/index.js': "module.exports = (s, n, c = ' ') => String(s).padStart(n, c);\n",
  'dist/index.js': '"use strict";\n// Built output of src/index.ts.\n',
  'server.log': '[demo] listening on 8080\n[demo] GET /health 200\n',
};
delete LEDGER_DISK['src/currency.ts'];
delete LEDGER_DISK['src/legacy/report.ts'];

// ---- settlement-worker: deep in Work, clean ---------------------------------------------------------------------

const WORKER_HEAD: Record<string, DemoFile> = {
  '.gitignore': 'bin/\n',
  'go.mod': 'module example.invalid/settlement-worker\n\ngo 1.23\n',
  'main.go':
    'package main\n\nimport (\n\t"log"\n\n\t"example.invalid/settlement-worker/worker"\n)\n\nfunc main() {\n\tq := worker.NewQueue(16)\n\tlog.Printf("settling %d batches", q.Len())\n}\n',
  'worker/queue.go':
    'package worker\n\n// Queue holds settlement batches in arrival order.\ntype Queue struct{ items []string }\n\nfunc NewQueue(capacity int) *Queue { return &Queue{items: make([]string, 0, capacity)} }\n\nfunc (q *Queue) Len() int { return len(q.items) }\n',
  'README.md': "# settlement-worker\n\nSettles the day's batches of the demo ledger.\n",
};

// ---- tide-tracker: Self, a branch with no upstream, a conflict ---------------------------------------------------

const PREDICT_HEAD = `"""Predicts the next high tide from the last two."""


def next_high(previous: float, last: float) -> float:
    period = last - previous
    return last + period
`;

const PREDICT_DISK = `"""Predicts the next high tide from the last two."""

LUNAR_DAY_HOURS = 24.84


def next_high(previous: float, last: float) -> float:
    period = last - previous
    if period <= 0:
        period = LUNAR_DAY_HOURS / 2
    return last + period
`;

const TIDE_HEAD: Record<string, DemoFile> = {
  '.gitignore': '.venv/\n__pycache__/\n',
  'README.md': '# tide-tracker\n\nA weekend project: next high tide for an invented harbour.\n',
  'requirements.txt': 'requests==2.32.3\n',
  'app.py': 'from tide.predict import next_high\n\nif __name__ == "__main__":\n    print(next_high(0.0, 12.42))\n',
  'tide/__init__.py': '',
  'tide/predict.py': PREDICT_HEAD,
  'tide/stations.csv': 'id,name\n1,Harbour North\n2,Harbour South\n',
};

const TIDE_DISK: Record<string, DemoFile> = {
  ...TIDE_HEAD,
  'tide/predict.py': PREDICT_DISK,
  'tide/stations.csv':
    'id,name\n1,Harbour North\n<<<<<<< HEAD\n2,Harbour South\n=======\n2,South Pier\n>>>>>>> stations\n',
  '.venv/pyvenv.cfg': 'home = /usr/bin\nversion = 3.12.0\n',
  '__pycache__/app.cpython-312.pyc': { binary: 912 },
};

// ---- pixel-garden: Self, two levels down -------------------------------------------------------------------------

const GARDEN_HEAD: Record<string, DemoFile> = {
  '.gitignore': 'target/\n',
  // The project's own editor settings (D39): Rust by four spaces, TOML and Markdown by two.
  '.editorconfig':
    '# Editor settings shared by everyone who works on pixel-garden.\nroot = true\n\n[*]\nend_of_line = lf\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n\n[*.rs]\nindent_style = space\nindent_size = 4\n\n[*.{toml,md}]\nindent_size = 2\n',
  'Cargo.toml': '[package]\nname = "pixel-garden"\nversion = "0.1.0"\nedition = "2024"\n',
  'rust-toolchain.toml': '[toolchain]\nchannel = "stable"\n',
  'src/main.rs':
    'mod garden;\n\nfn main() {\n    let mut garden = garden::Garden::new(8, 8);\n    garden.plant(3, 4);\n    println!("{garden}");\n}\n',
  'src/garden.rs':
    "use std::fmt;\n\npub struct Garden {\n    width: usize,\n    cells: Vec<bool>,\n}\n\nimpl Garden {\n    pub fn new(width: usize, height: usize) -> Self {\n        Self { width, cells: vec![false; width * height] }\n    }\n\n    pub fn plant(&mut self, x: usize, y: usize) {\n        self.cells[y * self.width + x] = true;\n    }\n}\n\nimpl fmt::Display for Garden {\n    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {\n        for row in self.cells.chunks(self.width) {\n            let line: String = row.iter().map(|&c| if c { '*' } else { '.' }).collect();\n            writeln!(f, \"{line}\")?;\n        }\n        Ok(())\n    }\n}\n",
  'assets/tiles.png': { binary: 4_096 },
};

const GARDEN_DISK: Record<string, DemoFile> = {
  ...GARDEN_HEAD,
  'NOTES.md': '# Ideas\n\n- seasons\n- a watering can\n',
  'target/debug/pixel-garden': { binary: 2_457_600 },
};

// ---- regex-notes: outside every trusted folder, read only ---------------------------------------------------------

const NOTES_HEAD: Record<string, DemoFile> = {
  'README.md': '# regex-notes\n\nPatterns worth keeping, with an example each.\n',
  'patterns.md':
    '# Patterns\n\n- ISO date: `\\d{4}-\\d{2}-\\d{2}` — 2026-01-31\n- Hex colour: `#[0-9a-fA-F]{6}` — #a1b2c3\n- Semantic version: `\\d+\\.\\d+\\.\\d+` — 1.4.0\n',
};

export const DEMO_PROJECTS: readonly DemoProjectSeed[] = [
  {
    id: 'p_demo0ledgr',
    name: 'ledger-api',
    displayPath: '~/work/ledger-api',
    location: '~/work',
    class: 'mine',
    via: 'location',
    branch: 'main',
    remote: 'origin',
    upstream: 'origin/main',
    behind: 0,
    hooks: ['pre-commit', 'commit-msg'],
    head: LEDGER_HEAD,
    disk: LEDGER_DISK,
    ignore: ['node_modules/', 'dist/', '.env', 'server.log'],
    renames: { 'src/money.ts': 'src/currency.ts' },
    stagedOutside: ['package.json'],
    commits: [
      { summary: 'Add the accounts endpoint', author: 'Demo Developer', ago: 3 * DAY, pushed: true },
      {
        summary: 'Format amounts with their currency',
        author: 'Demo Reviewer',
        ago: DAY + 2 * HOUR,
        pushed: false,
      },
      {
        summary: 'Answer 404 with a formatted zero',
        author: 'Demo Developer',
        ago: DAY,
        pushed: false,
        before: {
          'src/server.ts': SERVER_HEAD.replace('    response.end(formatAmount(0));\n', "    response.end('');\n"),
        },
      },
    ],
    history: [
      {
        path: 'src/server.ts',
        label: 'Answer 404 with a formatted zero',
        source: 'commit',
        ago: DAY,
        text: SERVER_HEAD,
      },
      { path: 'README.md', label: 'Changed while away', source: 'companion', ago: 17 * HOUR, text: README_HEAD },
      { path: 'src/server.ts', label: 'Before edit', source: 'companion', ago: 95, text: SERVER_HEAD },
      { path: 'src/server.ts', label: 'Saved', source: 'server', ago: 80, text: SERVER_EARLIER },
      { path: 'src/server.ts', label: 'Saved', source: 'server', ago: 25, text: SERVER_DISK },
      { path: 'README.md', label: 'External change', source: 'server', ago: 40, text: README_DISK },
      { path: 'src/legacy/report.ts', label: 'Deleted', source: 'server', ago: 70, text: REPORT },
      { path: 'src/routes/invoices.ts', label: 'Saved', source: 'server', ago: 30, text: INVOICES },
      { path: 'src/routes/invoices.ts', label: 'Before create', source: 'companion', ago: 31, text: null },
    ],
    // The companion was stopped overnight: on its return it noted what changed (README.md) as «Changed while away».
    gaps: [{ fromAgo: 20 * HOUR, toAgo: 17 * HOUR }],
    messages: ['Answer 404 with a formatted zero', 'Format amounts with their currency', 'Add the accounts endpoint'],
  },
  {
    id: 'p_demo0settl',
    name: 'settlement-worker',
    displayPath: '~/work/teams/payments/settlement-worker',
    location: '~/work',
    class: 'mine',
    via: 'location',
    branch: 'main',
    remote: 'origin',
    upstream: 'origin/main',
    behind: 2,
    hooks: [],
    head: WORKER_HEAD,
    disk: WORKER_HEAD,
    ignore: ['bin/'],
    commits: [{ summary: 'Start the settlement queue', author: 'Demo Reviewer', ago: 5 * DAY, pushed: true }],
    history: [],
    messages: [],
  },
  {
    id: 'p_demo0tides',
    name: 'tide-tracker',
    displayPath: '~/self/tide-tracker',
    location: '~/self',
    class: 'mine',
    via: 'location',
    branch: 'lunar-period',
    remote: 'origin',
    upstream: null,
    behind: 0,
    hooks: ['pre-commit'],
    head: TIDE_HEAD,
    disk: TIDE_DISK,
    ignore: ['.venv/', '__pycache__/'],
    conflicted: ['tide/stations.csv'],
    commits: [
      { summary: 'Predict from the last two highs', author: 'Demo Developer', ago: 2 * DAY, pushed: true },
      { summary: 'Name the harbour stations', author: 'Demo Developer', ago: 5 * HOUR, pushed: false },
    ],
    history: [{ path: 'tide/predict.py', label: 'Saved', source: 'server', ago: 12, text: PREDICT_DISK }],
    messages: ['Name the harbour stations'],
  },
  {
    id: 'p_demo0garden',
    name: 'pixel-garden',
    displayPath: '~/self/games/pixel-garden',
    location: '~/self',
    class: 'mine',
    via: 'location',
    branch: 'main',
    remote: null,
    upstream: null,
    behind: 0,
    hooks: [],
    head: GARDEN_HEAD,
    disk: GARDEN_DISK,
    ignore: ['target/'],
    commits: [{ summary: 'Plant the first pixel', author: 'Demo Developer', ago: 6 * DAY, pushed: false }],
    history: [],
    messages: [],
  },
  {
    id: 'p_demo0notes',
    name: 'regex-notes',
    displayPath: '~/scratch/regex-notes',
    location: null,
    class: 'view',
    via: 'terminal',
    branch: 'main',
    remote: 'origin',
    upstream: 'origin/main',
    behind: 0,
    hooks: [],
    head: NOTES_HEAD,
    disk: NOTES_HEAD,
    ignore: [],
    commits: [{ summary: 'Collect the first patterns', author: 'Demo Developer', ago: 9 * DAY, pushed: true }],
    history: [],
    messages: [],
  },
];
