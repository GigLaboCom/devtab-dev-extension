// A scripted companion speaking the companion's contract (extension/src/projects/api/companion-api-v1/): what the
// e2e's fake Native Messaging host (./fake-host.mjs) answers with, and what the extension's unit tests run the client
// and the seam's contract suite against. No socket, no server, no git: one repository in memory, seeded from the
// contract's vectors — a read that is one of the vectors' is answered with that vector's response, word for word, while
// the repository is as the vectors saw it; anything else — and every method whose answer depends on what happened
// before (classes, writes, commits) — is answered from the same repository by the contract's rules (paths, secrets,
// symlinks, limits, the write policy, `expect` of a commit).
//
//   createCompanion({ vectors, mode, hostile, big, wait, methods, replay, contentFlag, limits })
//     → { handle(frame, send), emit(…), … }
//
// `vectors` is the vectors folder as { 'tree.list.json': [...], … } (the caller reads it: Node from disk, the tests
// with Vite's glob). `mode`: 'normal' | 'empty' (no project added) | 'fresh' (`devtab init` never ran: no project, no
// trusted folder, no environment) | 'version' (no API version in common) | 'not-running' (the relay cannot reach the
// supervisor). `methods: 'stage3'` is a companion of stage 3: it reads and offers nothing else; `'stage6'` one of stage
// 6: everything but restoring from the history and clearing it (stage 7's `HISTORY_METHODS`). `hostile` adds a second
// project whose names, branch, history labels and lines carry HTML and terminal escape sequences; `big` adds to it a
// folder of 5001 long names (5000 listed) and a 2 MiB file, both answered in chunks. `replay` answers every vector's
// request word for word, a request asked again with the vector's next answer (the vectors' own sequence).
// `contentFlag: false` is a companion older than the points' `content` and the full `welcome.limits`: its points carry
// no `content`, its welcome only `maxRequestBytes` and `maxTextBytes`. `limits` replaces announced limits (a smaller
// `maxHistoryPage`, say). `send(frame)` gets each frame out, chunked as the supervisor chunks (`maxFrameBytes`).
//
// Steering what needs a person or the outside world: `confirm` — what the companion's window would answer to a request
// outside a trusted folder ('unavailable': no window, the command instead; 'yes'; 'no'; 'busy'; 'requests-off';
// 'rate-limited'); `failNext(method, error, stream)` — the next call of a method fails as given, after its streamed
// output (a hook that fails, a lock, a signing failure, too little disk, …); `identity` — git's name and e-mail, or none;
// `changeOnDisk(project, path, text)` — someone else's edit; `gap(project, from, to, paths)` — the companion was not
// running for a while (a stretch in the history, the event `history.gap`). `now` is the clock of new history points.

const PROJECT = 'p_abcdefgh23';
const HOSTILE = 'p_hostile001';
export const MAX_FRAME_BYTES = 921_600;
export const MAX_TEXT_BYTES = 5_242_880;
/** The methods of a companion of stage 3: reads only. */
export const METHODS = [
  'companion.state',
  'projects.list',
  'project.state',
  'events.subscribe',
  'events.unsubscribe',
  'tree.list',
  'file.read',
  'files.find',
  'search.start',
  'git.status',
  'git.identity',
  'diff.sides',
  'git.hunks',
  'history.file',
  'history.project',
  'history.content',
];

/** What stages 4–6 added (a companion without a Trash does not offer `file.delete`). */
export const WRITE_METHODS = [
  'locations.list',
  'project.requestAdd',
  'project.requestMine',
  'project.setView',
  'project.remove',
  'env.requestCapture',
  'file.save',
  'file.create',
  'folder.create',
  'file.rename',
  'git.commit',
  'git.rollback',
  'git.undoCommit',
  'git.messages',
];

/** What stage 7 added: restoring a point of the history, and asking the person to clear it. */
export const HISTORY_METHODS = ['history.restore', 'history.requestPurge'];

/** Methods whose answer depends on what happened before: never replayed from a vector outside `replay`. */
const STATEFUL = new Set([...WRITE_METHODS, ...HISTORY_METHODS, 'git.identity', 'file.delete']);

/** The trusted folder of the scripted repository, as an absolute path typed on the page would be inside it. */
export const TRUSTED_ROOT = '/srv/fixtures/fx';

/** Strings a hostile repository may hold (S17): HTML, and a terminal's colour and link sequences. */
export const HOSTILE_STRINGS = {
  name: '<img src=x onerror="window.__pwned=1">',
  branch: 'feat/<script>window.__pwned=2</script>',
  file: '"><svg onload="window.__pwned=3">.txt',
  label: '\u001b]8;;https://evil.invalid/\u0007click me\u001b]8;;\u0007 \u001b[31mred\u001b[0m',
  line: 'echo \u001b[2J\u001b[31mhostile\u001b[0m <b>bold</b>',
};

const encoder = new TextEncoder();
const bytes = text => encoder.encode(text).length;
/** A path as the companion's points carry it: its UTF-8 bytes in hex. */
const hexOf = path => [...encoder.encode(path)].map(b => b.toString(16).padStart(2, '0')).join('');
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map(k => `${JSON.stringify(k)}:${canonical(value[k])}`)
          .join(',')}}`
      : JSON.stringify(value);

/** An opaque stand-in for a text's SHA-256 (the page never computes one): 64 hex digits from FNV-1a. */
const fnv = text => {
  let out = '';
  for (let round = 0; round < 8; round++) {
    let h = 0x811c9dc5 ^ round;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
};

const error = (code, message, data) => Object.assign(new Error(message), { code, data });

/** Points newest first; of two at one time, by the point (as the companion orders them). */
const newestFirst = points => [...points].sort((a, b) => b.timeMs - a.timeMs || (a.point < b.point ? -1 : 1));

/** The hunks of a text from `a` to `b`, by lines (a longest common subsequence): 0-based starts, as `git.hunks` has. */
export const lineHunks = (a, b) => {
  const x = a === null || a === '' ? [] : a.replace(/\n$/, '').split('\n');
  const y = b === null || b === '' ? [] : b.replace(/\n$/, '').split('\n');
  const n = x.length;
  const m = y.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const hunks = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      i++;
      j++;
      continue;
    }
    const oldStart = i;
    const start = j;
    while ((i < n || j < m) && !(i < n && j < m && x[i] === y[j])) {
      if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) j++;
      else i++;
    }
    hunks.push({ index: hunks.length, oldStart, oldLines: i - oldStart, start, lines: j - start });
  }
  return hunks;
};

/** `head` with the chosen hunks of `head → disk` applied. */
export const applyHunks = (head, disk, chosen) => {
  const x = head === null || head === '' ? [] : head.replace(/\n$/, '').split('\n');
  const y = disk === null || disk === '' ? [] : disk.replace(/\n$/, '').split('\n');
  const out = [];
  let i = 0;
  for (const hunk of lineHunks(head, disk)) {
    while (i < hunk.oldStart) out.push(x[i++]);
    if (chosen.includes(hunk.index)) out.push(...y.slice(hunk.start, hunk.start + hunk.lines));
    else out.push(...x.slice(hunk.oldStart, hunk.oldStart + hunk.oldLines));
    i = hunk.oldStart + hunk.oldLines;
  }
  while (i < x.length) out.push(x[i++]);
  return out.length ? `${out.join('\n')}\n` : '';
};

/** A path as one word of a shell command. */
const shellWord = path => (/^[\w~@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`);

/** The files that run code (the companion's `protected.toml`, in short): written, and marked with the rule. */
const protectedRule = path =>
  /^(\.husky|\.githooks)\//.test(path)
    ? 'hooks'
    : /(^|\/)(package\.json|pyproject\.toml)$/.test(path)
      ? 'commit-time'
      : /^\.(envrc|tool-versions|nvmrc)$/.test(path)
        ? 'shell-environment'
        : null;
const SECRET = /(^|\/)(\.env(\..+)?|id_rsa[^/]*|[^/]+\.(pem|key)|\.npmrc|\.netrc|credentials\.json)$/;

/** The supervisor's chunking (§4.3): the message as one JSON string, cut so every frame is at most `max` bytes. */
export const chunked = (frame, max = MAX_FRAME_BYTES) => {
  const message = JSON.stringify(frame);
  if (bytes(message) <= max) return [frame];
  const id = typeof frame.id === 'number' ? frame.id : null;
  const pieces = [];
  let at = 0;
  let size = Math.max(16, Math.floor(max / 8));
  while (at < message.length) {
    let end = Math.min(message.length, at + size);
    for (;;) {
      // Never between the two halves of a surrogate pair.
      if (end < message.length && /[\ud800-\udbff]/.test(message[end - 1])) end--;
      const piece = {
        type: 'chunk',
        id,
        seq: pieces.length,
        last: end >= message.length,
        data: message.slice(at, end),
      };
      if (bytes(JSON.stringify(piece)) <= max || end - at <= 2) {
        pieces.push(piece);
        break;
      }
      end = at + Math.floor((end - at) / 2);
    }
    at = pieces.at(-1).data.length + at;
  }
  return pieces;
};

const entry = (path, kind, extra = {}) => ({
  hidden: path.split('/').at(-1).startsWith('.'),
  ignored: false,
  kind,
  link: null,
  mtimeMs: 0,
  name: path.split('/').at(-1),
  path,
  protected: false,
  secret: false,
  size: 0,
  ...extra,
});

export const createCompanion = ({
  vectors = {},
  mode = 'normal',
  hostile = false,
  big = false,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  maxFrameBytes = MAX_FRAME_BYTES,
  methods: offered = 'all',
  replay = false,
  confirm: confirmed = 'unavailable',
  identity: who = { name: 'Fixture Person', email: 'person@example.invalid' },
  now = Date.now,
  contentFlag = true,
  limits: announced = {},
} = {}) => {
  // ---- the vectors: requests answered word for word ----------------------------------------------------------------
  const replies = new Map();
  for (const [file, list] of Object.entries(vectors)) {
    if (!Array.isArray(list) || file === 'hello.json' || file === 'unknown-method.json') continue;
    for (const v of list)
      if (v.request?.type === 'call') {
        const key = `${v.request.method} ${canonical(v.request.params ?? {})}`;
        if (!replies.has(key)) replies.set(key, []);
        replies.get(key).push({ method: v.request.method, response: v.response, stream: v.stream });
      }
  }
  const vector = (file, at = 0) => vectors[file]?.[at]?.response;
  const helloed = vectors['hello.json']?.[0]?.response ?? {
    type: 'welcome',
    companion: '0.1.0',
    api: 1,
    server: '0.1.44',
    platform: 'macos',
    methods: [...METHODS, ...WRITE_METHODS],
    limits: { maxRequestBytes: 8_388_608, maxTextBytes: MAX_TEXT_BYTES },
  };
  const offeredWelcome =
    offered === 'stage3'
      ? { ...copy(helloed), methods: helloed.methods.filter(m => METHODS.includes(m)) }
      : offered === 'stage6'
        ? { ...copy(helloed), methods: helloed.methods.filter(m => !HISTORY_METHODS.includes(m)) }
        : helloed;
  const { maxRequestBytes, maxTextBytes } = offeredWelcome.limits;
  const welcome = {
    ...offeredWelcome,
    limits: contentFlag ? { ...offeredWelcome.limits, ...announced } : { maxRequestBytes, maxTextBytes, ...announced },
  };
  const historyPage = welcome.limits.maxHistoryPage ?? 500;
  /** An answer as this companion gives it: without the points' `content` when it is older than the field. */
  const asSent = (method, result) =>
    contentFlag || !['history.file', 'history.project'].includes(method) || !Array.isArray(result?.points)
      ? result
      : {
          ...result,
          points: result.points.map(pt => Object.fromEntries(Object.entries(pt).filter(([k]) => k !== 'content'))),
        };
  const offers = method => welcome.methods.includes(method);

  // The versions of texts the vectors name: a text the vectors saw keeps its real hash, any other gets a stand-in.
  const knownHashes = new Map();
  for (const v of vectors['file.read.json'] ?? []) {
    const r = v.response?.result;
    if (r?.text !== undefined && r.hash) knownHashes.set(r.text, r.hash);
  }
  const hashOf = text => knownHashes.get(text) ?? fnv(text);

  // ---- the repository ---------------------------------------------------------------------------------------------
  const appText = vector('file.read.json', 0)?.result?.text ?? 'line 01 of the app\n';
  const headApp = vector('diff.sides.json', 0)?.result?.old?.text ?? appText;
  const projects = new Map();
  const project = (id, seed) => projects.set(id, { id, ...seed });

  const repoFiles = new Map([
    ['.env', { text: 'API_TOKEN=dummy-value-for-tests\n', secret: true, ignored: true }],
    ['.gitignore', { text: 'build/\n.env\n' }],
    ['big.txt', { size: 6_291_456, tooLarge: true }],
    ['bom.txt', { text: 'a file that starts with a BOM\n'.slice(0, 26) }],
    ['crlf.txt', { text: 'first\nsecond\nthird\n', lineEnding: 'crlf' }],
    ['image.bin', { size: 15, binary: true }],
    ['latin1.txt', { text: 'café au lait', encoding: 'windows-1252' }],
    ['docs/readme.md', { text: '# Readme\n\nchanged on disk\n' }],
    ['keys/id_rsa', { text: '-----BEGIN DUMMY KEY-----\nnot a key\n-----END DUMMY KEY-----\n', secret: true }],
    ['src/app.txt', { text: appText }],
    ['src/new.txt', { text: 'a new file\n' }],
    ['build/out.txt', { text: 'built\n', ignored: true }],
    ['link-in', { link: 'inside', target: 'src/app.txt' }],
    ['link-out', { link: 'outside' }],
    ['link-git', { link: 'outside' }],
  ]);
  // The vectors' status names the changed files; every other file is as HEAD has it.
  const changedInVectors = new Set([
    'big.txt',
    'src/new.txt',
    'link-in',
    'link-out',
    'link-git',
    '.env',
    'build/out.txt',
  ]);
  const bigFiles = new Map();
  if (big) {
    for (let i = 0; i < 5001; i++)
      bigFiles.set(
        `many/${String(i).padStart(4, '0')}-${'a-rather-long-file-name-for-the-chunked-answer-'.repeat(3)}.txt`,
        {
          text: `${i}\n`,
        },
      );
    const line = 'a long file read in pieces: é 中文 😀 "quoted" \\ backslash\n';
    bigFiles.set('large.txt', { text: line.repeat(Math.ceil((2 * 1024 * 1024) / bytes(line))) });
  }
  project(PROJECT, {
    summary: vector('projects.list.json')?.result?.[0] ?? {
      branch: 'main',
      class: 'view',
      displayPath: '~/fx/repo',
      id: PROJECT,
      location: null,
      locationName: null,
      name: 'repo',
      state: 'open',
      via: 'terminal',
    },
    state: vector('project.state.json')?.result,
    files: repoFiles,
    head: new Map([
      ...[...repoFiles]
        .filter(([path, file]) => !changedInVectors.has(path) && !file.link)
        .map(([path, file]) => [path, file.text ?? { bytes: path, size: file.size }]),
      ['src/app.txt', headApp],
      ['docs/readme.md', '# Readme\n'],
      ['gone.txt', 'This file will be deleted.\n'],
    ]),
    hooks: vector('project.state.json')?.result?.hooks ?? ['pre-commit'],
    headSha: vector('git.status.json')?.result?.headSha ?? 'a5c8a8f38f555426b8634a56dac2a7423e9f3902',
    commits: [],
    messages: [],
    status: vector('git.status.json')?.result,
    points: [
      // The vectors' points of docs/readme.md; the server's, whose time the vectors leave out (0), as the newest.
      ...(vector('history.file.json')?.result?.points ?? []).map(p => ({
        ...p,
        path: 'docs/readme.md',
        timeMs: p.timeMs || 1767484800000,
      })),
      // A file that is gone: the server's last «Saved» of it, and the companion's note that it went while away.
      {
        content: false,
        label: 'Deleted while away',
        path: 'gone.txt',
        point: `c:none@1767398400000:${hexOf('gone.txt')}`,
        size: 0,
        source: 'companion',
        timeMs: 1767398400000,
      },
      {
        content: true,
        label: 'Saved',
        path: 'gone.txt',
        point: `s:${fnv('gone.txt').slice(0, 12)}@1767312000000:${hexOf('gone.txt')}`,
        size: 27,
        source: 'server',
        timeMs: 1767312000000,
      },
      // A file a commit deleted: that commit keeps no version of it, nor did the copy before a rollback of it while it
      // was binary; the commit that added it does.
      {
        content: false,
        label: 'Remove retired.txt',
        path: 'retired.txt',
        point: `g:${fnv('remove retired.txt').slice(0, 40)}@1767441600000:${hexOf('retired.txt')}`,
        size: 0,
        source: 'commit',
        timeMs: 1767441600000,
      },
      {
        content: false,
        label: 'Before rollback',
        path: 'retired.txt',
        point: `c:none@1767355200000:${hexOf('retired.txt')}`,
        size: 0,
        source: 'companion',
        timeMs: 1767355200000,
      },
      {
        content: true,
        label: 'Add retired.txt',
        path: 'retired.txt',
        point: `g:${fnv('add retired.txt').slice(0, 40)}@1767139200000:${hexOf('retired.txt')}`,
        size: 0,
        source: 'commit',
        timeMs: 1767139200000,
      },
    ],
    contents: new Map([
      [vector('history.file.json')?.result?.points?.[0]?.point, '# Readme\n\nchanged on disk\n'],
      ...(vector('history.file.json')?.result?.points ?? [])
        .filter(p => p.source === 'commit')
        .map(p => [p.point, '# Readme\n']),
      [`s:${fnv('gone.txt').slice(0, 12)}@1767312000000:${hexOf('gone.txt')}`, 'This file will be deleted.\n'],
      [`g:${fnv('add retired.txt').slice(0, 40)}@1767139200000:${hexOf('retired.txt')}`, 'A file a commit deleted.\n'],
    ]),
    gaps: [],
  });
  for (const f of vector('git.status.json')?.result?.files ?? []) {
    const text = repoFiles.get(f.path)?.text;
    if (text !== undefined && f.diskHash) knownHashes.set(text, f.diskHash);
  }
  if (hostile || big) {
    const files = new Map([
      [HOSTILE_STRINGS.file, { text: `${HOSTILE_STRINGS.line}\n` }],
      ['notes.txt', { text: `plain\n${HOSTILE_STRINGS.line}\n` }],
      ...bigFiles,
    ]);
    project(HOSTILE, {
      summary: {
        branch: HOSTILE_STRINGS.branch,
        class: 'view',
        displayPath: `~/fx/${HOSTILE_STRINGS.name}`,
        id: HOSTILE,
        location: null,
        locationName: null,
        name: HOSTILE_STRINGS.name,
        state: 'open',
        via: 'terminal',
      },
      files,
      head: new Map([['notes.txt', 'plain\n']]),
      hooks: [],
      headSha: '0'.repeat(39) + '1',
      commits: [],
      messages: [],
      points: [
        {
          label: HOSTILE_STRINGS.label,
          path: 'notes.txt',
          point: 'g:0000000000000000000000000000000000000001@1767225600000:6e6f7465732e747874',
          content: true,
          size: 0,
          source: 'commit',
          timeMs: 1767225600000,
        },
      ],
      contents: new Map([['g:0000000000000000000000000000000000000001@1767225600000:6e6f7465732e747874', 'plain\n']]),
      gaps: [],
    });
  }

  const projectOf = id => {
    const p = projects.get(id);
    if (!p || mode === 'empty' || mode === 'fresh') throw error('not-found', 'no such project');
    return p;
  };
  const checkPath = path => {
    if (typeof path !== 'string')
      throw error('invalid-params', 'the parameters do not match the method’s schema', { field: 'path' });
    if (path.startsWith('/')) throw error('invalid-path', 'the path must be relative to the project root');
    if (path === '') return;
    // eslint-disable-next-line no-control-regex
    if (/\\|[\u0000-\u001f]/.test(path)) throw error('invalid-path', 'the path has a backslash or a control character');
    if (path.split('/').some(s => s === '' || s === '.' || s === '..'))
      throw error('invalid-path', 'the path has an empty, . or .. segment');
    if (path.split('/').some(s => s.toLowerCase() === '.git'))
      throw error('protected-path', 'the .git folder is never read or listed', { rule: 'git-dir' });
  };
  const lead = (p, path) => {
    const head = path.split('/')[0];
    const file = p.files.get(head);
    if (file?.link === 'outside') throw error('outside-project', 'the path leads out of the project');
    return file?.link === 'inside' ? p.files.get(file.target) : p.files.get(path);
  };
  const textOf = (p, path) => {
    checkPath(path);
    const file = lead(p, path);
    if (!file) throw error('not-found', 'no such file or folder in the project');
    if (file.binary) throw error('binary', 'the file is binary', { size: file.size });
    if (file.tooLarge)
      throw error('too-large', 'the file is larger than the companion shows', {
        limit: MAX_TEXT_BYTES,
        size: file.size,
      });
    return file;
  };
  const listing = (p, path) => {
    checkPath(path);
    if (path) lead(p, path);
    const prefix = path ? `${path}/` : '';
    const children = new Map();
    let found = false;
    for (const [full, file] of p.files) {
      if (!full.startsWith(prefix)) continue;
      found = true;
      const rest = full.slice(prefix.length);
      const name = rest.split('/')[0];
      // An empty folder is kept as `<folder>/`: it has no entry of its own inside.
      if (!name) continue;
      const dir = rest.includes('/');
      const at = prefix + name;
      if (children.has(at)) continue;
      if (dir) children.set(at, entry(at, 'dir', { ignored: !!file.ignored && at === 'build' }));
      else if (file.link)
        children.set(at, entry(at, 'symlink', { link: file.link, size: file.link === 'inside' ? 611 : 33 }));
      else
        children.set(
          at,
          entry(at, 'file', {
            ignored: !!file.ignored,
            secret: !!file.secret,
            protected: protectedRule(at) !== null,
            size: file.size ?? bytes(file.text),
          }),
        );
    }
    if (path && !found) throw error('not-found', 'no such file or folder in the project');
    const entries = [...children.values()].sort(
      (a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || (a.name < b.name ? -1 : 1),
    );
    return { entries: entries.slice(0, 5000), skippedNames: 0, truncated: entries.length > 5000 };
  };

  let changed = false;
  const running = new Map();
  const subscribed = new Set();
  let confirm = confirmed;
  let identity = who;
  const failures = [];
  let commits = 0;
  // Emitting needs a way out: the last `send` the companion was handed (the port of the call or command).
  let lastSend = null;
  const tell = (name, project, data) => {
    if (!lastSend) return;
    if (project !== null && !subscribed.has(project)) return;
    out(lastSend, { type: 'event', name, project, data });
  };

  const locations = () =>
    mode === 'fresh'
      ? []
      : (
          vector('locations.list.json')?.result ?? [
            { createdVia: 'terminal', displayPath: '~/fx', mode: 'write', name: 'fx', projects: 1 },
          ]
        ).map(l => ({
          ...l,
          projects: [...projects.values()].filter(p => p.summary.location === l.displayPath).length,
        }));

  const textFile = file => file !== undefined && file.text !== undefined && !file.binary && !file.tooLarge;
  /** The status the companion computes: HEAD against the disk, by the text's hash (the bytes' for a binary). */
  const statusOf = p => {
    const out = [];
    const paths = [...new Set([...p.head.keys(), ...p.files.keys()])].filter(path => !path.endsWith('/')).sort();
    for (const path of paths) {
      const disk = p.files.get(path);
      const head = p.head.get(path);
      if (disk?.ignored) continue;
      const diskHash = textFile(disk) ? hashOf(disk.text) : null;
      const diskBytesHash = disk && !disk.link && !textFile(disk) ? fnv(`bytes:${path}:${disk.size}`) : null;
      const base = { diskBytesHash, diskHash, path, renamedFrom: null, stagedOutside: false };
      if (head === undefined && disk !== undefined) out.push({ ...base, change: 'untracked', group: 'unversioned' });
      else if (head !== undefined && disk === undefined) out.push({ ...base, change: 'deleted', group: 'changes' });
      else if (typeof head === 'string' && textFile(disk) && head !== disk.text)
        out.push({ ...base, change: 'modified', group: 'changes' });
    }
    return out;
  };

  const isMine = p => (p.cls ?? p.summary.class) === 'mine';
  const summaryOf = p => ({ ...copy(p.summary), class: p.cls ?? p.summary.class, via: p.via ?? p.summary.via });
  const failing = method => {
    const at = failures.findIndex(f => f.method === method);
    return at < 0 ? null : failures.splice(at, 1)[0];
  };
  /** Waits as the companion's window would, then answers as `confirm` says; `cancel` closes it. */
  const askPerson = async (command, cancelled) => {
    if (confirm === 'unavailable')
      throw error(
        'confirmation-unavailable',
        'the companion cannot show its window; run the command in a terminal instead',
        {
          command,
          reason: 'no-window',
        },
      );
    if (confirm === 'requests-off')
      throw error('confirmation-unavailable', 'the page’s requests are off', {
        command: 'devtab resume-requests',
        reason: 'requests-off',
      });
    if (confirm === 'busy') throw error('confirmation-busy', 'another confirmation is waiting');
    if (confirm === 'rate-limited') throw error('rate-limited', 'too soon after a decline', { retryAfterMs: 30_000 });
    for (let i = 0; i < 40; i++) {
      await wait(125);
      if (cancelled()) throw error('cancelled', 'the request was cancelled');
    }
    if (confirm === 'no') throw error('confirmation-declined', 'declined in the companion’s window');
  };
  /** The write policy (§5.4), for every write: the class, `.git`, secrets, links, a file read only on disk. */
  const writable = (p, path, field = 'path') => {
    if (!isMine(p)) throw error('not-mine', 'the project is read-only (view); this needs a writable one');
    if (typeof path !== 'string' || path === '')
      throw error('invalid-params', 'the parameters do not match the method’s schema', { field });
    checkPath(path);
    if (SECRET.test(path) || p.files.get(path)?.secret)
      throw error('secret-file', 'secret files are shown read-only and never written from the browser');
    const top = p.files.get(path.split('/')[0]);
    if (top?.link === 'outside' && path.includes('/'))
      throw error('outside-project', 'the path leads out of the project');
    if (p.files.get(path)?.link)
      throw error('protected-path', 'the companion never writes through a symlink or to one', { rule: 'symlink' });
    if (p.files.get(path)?.readOnly)
      throw error('protected-path', 'the file is read-only on disk', { rule: 'read-only-file' });
    if (/[\s.]$/.test(path)) throw error('invalid-path', 'a name may not end with a space or a dot');
  };
  const exists = (p, path) => [...p.files.keys()].some(k => k === path || k.startsWith(`${path}/`));
  const wrote = (p, paths) => {
    changed = true;
    tell('files.changed', p.id, { more: false, paths });
  };
  const sha = () => fnv(`commit ${++commits}`).slice(0, 40);
  /** The time of a new point: the clock's, never before the newest point of the project. */
  const timeOf = p => Math.max(now(), ...p.points.map(pt => pt.timeMs + 1));
  /** The server's «Saved» point of each write, as its history keeps it. */
  const saved = (p, path, text) => {
    const timeMs = timeOf(p);
    const point = `s:${fnv(`${path}:${p.points.length}`).slice(0, 12)}@${timeMs}:${hexOf(path)}`;
    p.points.unshift({ content: true, label: 'Saved', path, point, size: bytes(text), source: 'server', timeMs });
    p.contents.set(point, text);
    return point;
  };
  /** A copy of the companion's own (`Before …`): the text it keeps, or none (`c:none`). */
  const kept = (p, path, label, text) => {
    const timeMs = timeOf(p);
    const id = text === null ? 'none' : fnv(`${path}:${label}:${p.points.length}:${text}`);
    const point = `c:${id}@${timeMs}:${hexOf(path)}`;
    const size = text === null ? 0 : bytes(text);
    p.points.unshift({ content: text !== null, label, path, point, size, source: 'companion', timeMs });
    if (text !== null) p.contents.set(point, text);
    return point;
  };

  const methods = {
    'companion.state': () =>
      (mode !== 'fresh' && vector('companion.state.json')?.result) || {
        companion: '0.1.0',
        deletePolicy: 'unavailable',
        env: { capturedAt: null, path: [] },
        paused: false,
        problems: [],
        server: { state: 'running', version: '0.1.44' },
      },
    'projects.list': () => (mode === 'empty' || mode === 'fresh' ? [] : [...projects.values()].map(summaryOf)),
    'project.state': ({ project: id }) => {
      const p = projectOf(id);
      const state = (p.state && { ...copy(p.state), class: p.cls ?? p.state.class, via: p.via ?? p.state.via }) ?? null;
      return (
        state ?? {
          ahead: 0,
          behind: 0,
          branch: p.summary.branch,
          class: 'view',
          detached: false,
          historyGaps: p.gaps.map(g => ({ ...g })),
          hooks: [],
          hooksPath: false,
          location: null,
          upstream: null,
          via: 'terminal',
        }
      );
    },
    'events.subscribe': ({ project: id }) => (projectOf(id), subscribed.add(id), {}),
    'events.unsubscribe': ({ project: id }) => (subscribed.delete(id), {}),
    'tree.list': ({ project: id, path }) => listing(projectOf(id), path),
    'file.read': ({ project: id, path }) => {
      const file = textOf(projectOf(id), path);
      return {
        bom: path === 'bom.txt',
        encoding: file.encoding ?? 'utf-8',
        hash: hashOf(file.text),
        large: false,
        lineEnding: file.lineEnding ?? 'lf',
        mtimeMs: 0,
        protected: protectedRule(path) !== null,
        secret: !!file.secret,
        size: bytes(file.text),
        text: file.text,
      };
    },
    'files.find': ({ project: id, query, limit }) => {
      const p = projectOf(id);
      const q = String(query ?? '').toLowerCase();
      const found = [];
      for (const [path, file] of p.files) {
        if (file.link) continue;
        const indices = [];
        let at = 0;
        for (const c of q) {
          const i = path.toLowerCase().indexOf(c, at);
          if (i < 0) break;
          indices.push(i);
          at = i + 1;
        }
        if (indices.length === q.length)
          found.push({ ignored: !!file.ignored, indices, path, score: 1000 - path.length });
      }
      return found.sort((a, b) => b.score - a.score).slice(0, Math.min(limit ?? 100, 100));
    },
    'search.start': async (params, { id, send, cancelled }) => {
      const p = projectOf(params.project);
      if (typeof params.pattern !== 'string' || params.pattern === '')
        throw error('invalid-params', 'the parameters do not match the method’s schema', { field: 'pattern' });
      const slow = params.pattern === 'slow-search';
      const max = Math.min(params.maxMatches ?? 5000, 5000);
      const flags = params.caseSensitive ? 'g' : 'gi';
      const source = params.isRegex ? params.pattern : params.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let pattern;
      try {
        pattern = new RegExp(params.wholeWord ? `\\b${source}\\b` : source, flags);
      } catch {
        throw error('invalid-params', 'the pattern is not a regular expression', { field: 'pattern' });
      }
      let files = 0;
      let matches = 0;
      let truncated = false;
      let seq = 0;
      const all = slow
        ? Array.from({ length: 40 }, (_, i) => [`slow/${i}.txt`, { text: 'slow-search\n' }])
        : [...p.files].filter(([, f]) => f.text !== undefined && (params.includeIgnored || !f.ignored));
      for (const [path, file] of all) {
        if (cancelled()) throw error('cancelled', 'the search was cancelled');
        if (slow) await wait(250);
        if (cancelled()) throw error('cancelled', 'the search was cancelled');
        const found = [];
        file.text.split('\n').forEach((text, line) => {
          const ranges = [...text.matchAll(pattern)].map(m => [m.index, m.index + m[0].length]);
          if (ranges.length && matches < max) {
            found.push({ line, ranges, text });
            matches++;
          } else if (ranges.length) truncated = true;
        });
        if (found.length) {
          files++;
          send({ type: 'stream', id, seq: seq++, data: { matches: found, path } });
        }
      }
      return { files, matches, truncated };
    },
    'git.status': ({ project: id }) => {
      const p = projectOf(id);
      if (p.status && !changed) return copy(p.status);
      // Whether HEAD can be undone, by the rule `git.undoCommit` follows here (a commit of this page, still HEAD).
      const undoable = isMine(p) && p.commits.at(-1)?.sha === p.headSha;
      return {
        branch: p.summary.branch,
        files: statusOf(p),
        headSha: p.headSha,
        headUndoReason: undoable ? null : isMine(p) ? 'pushed' : 'not-mine',
        headUndoable: undoable,
      };
    },
    'git.identity': () => ({
      email: identity?.email ?? null,
      name: identity?.name ?? null,
      signing: { enabled: false, format: null },
    }),
    'diff.sides': ({ project: id, path, base }) => {
      const p = projectOf(id);
      checkPath(path);
      let old = null;
      if (base && typeof base === 'object' && 'point' in base) {
        if (!p.contents.has(base.point)) throw error('not-found', 'no such history point');
        old = p.contents.get(base.point);
      } else old = p.head.get(path) ?? null;
      const file = lead(p, path);
      const now = file?.text ?? null;
      const hunks = lineHunks(old, now).map(({ oldStart, oldLines, start, lines }) => ({
        oldStart,
        oldLines,
        start,
        lines,
      }));
      return {
        flags: { binary: false, conflicted: false, crlf: false, renamedFrom: null, utf8: true },
        hunks,
        new: { exists: now !== null, text: now },
        old: { exists: old !== null, text: old },
      };
    },
    'git.hunks': ({ project: id, path }) => {
      const p = projectOf(id);
      checkPath(path);
      const file = lead(p, path);
      const head = p.head.get(path);
      const headHash = typeof head === 'string' ? hashOf(head) : null;
      if (file?.binary || file?.tooLarge)
        return { chunkable: false, diskHash: null, headHash, hunks: [], reason: 'binary' };
      if (!file) return { chunkable: false, diskHash: null, headHash, hunks: [], reason: 'deleted' };
      if (head === undefined)
        return { chunkable: false, diskHash: hashOf(file.text), headHash, hunks: [], reason: 'new-file' };
      if (file.encoding && file.encoding !== 'utf-8')
        return { chunkable: false, diskHash: hashOf(file.text), headHash, hunks: [], reason: 'not-utf8' };
      return {
        chunkable: true,
        diskHash: hashOf(file.text),
        headHash,
        hunks: lineHunks(typeof head === 'string' ? head : null, file.text),
        reason: null,
      };
    },
    // A file's points: of a regular file, or of one that is gone (its points stay); never of a link (S6).
    'history.file': ({ project: id, path }) => {
      const p = projectOf(id);
      checkPath(path);
      const file = p.files.get(path);
      const points = p.points.filter(pt => pt.path === path);
      if (file?.link || (!file && !points.length)) throw error('not-found', 'no such file or folder in the project');
      return {
        gaps: p.gaps.map(({ from, to }) => ({ from, to })),
        points: newestFirst(points).map(pt => Object.fromEntries(Object.entries(pt).filter(([k]) => k !== 'path'))),
      };
    },
    // Newest first, page by page: the cursor is the place after the last point given (stable as new points arrive).
    'history.project': ({ project: id, limit, cursor, since }) => {
      const p = projectOf(id);
      const size = Math.min(Math.max(1, limit ?? historyPage), historyPage);
      let all = newestFirst(p.points).filter(pt => since == null || pt.timeMs >= since);
      if (cursor) {
        const [time, point] = [Number(cursor.slice(0, cursor.indexOf(':'))), cursor.slice(cursor.indexOf(':') + 1)];
        all = all.filter(pt => pt.timeMs < time || (pt.timeMs === time && pt.point > point));
      }
      const page = all.slice(0, size);
      const deleted = [...new Set(p.points.map(pt => pt.path))].filter(path => !p.files.has(path)).sort();
      return {
        deleted,
        next: all.length > size ? `${page.at(-1).timeMs}:${page.at(-1).point}` : null,
        points: page.map(copy),
      };
    },
    'history.content': ({ project: id, point }) => {
      const p = projectOf(id);
      if (!p.contents.has(point)) throw error('not-found', 'no such history point');
      return { secret: false, text: p.contents.get(point) };
    },
  };

  Object.assign(methods, {
    'locations.list': () => locations(),
    'project.requestAdd': async ({ path }, { cancelled }) => {
      if (typeof path !== 'string' || !path.startsWith('/') || path.split('/').some(s => s === '..'))
        throw error('not-found', 'not found');
      const inside = path.startsWith(`${TRUSTED_ROOT}/`) && !path.slice(TRUSTED_ROOT.length + 1).includes('/');
      const name = path.slice(path.lastIndexOf('/') + 1);
      if (inside && name === 'repo') return { class: 'mine', id: PROJECT, via: 'location' };
      if (inside && (name === 'outside' || name === 'no-such-folder')) throw error('not-found', 'not found');
      if (!inside) await askPerson(`cd ${shellWord(path)} && devtab add`, cancelled);
      const id = `p_${fnv(path).slice(0, 10)}`;
      const location = inside ? '~/fx' : null;
      project(id, {
        summary: {
          branch: 'main',
          class: inside ? 'mine' : 'view',
          displayPath: inside ? `~/fx/${name}` : `~/elsewhere/${name}`,
          id,
          location,
          locationName: inside ? 'fx' : null,
          name,
          state: 'open',
          via: inside ? 'location' : 'dialog',
        },
        files: new Map([['README.md', { text: `# ${name}\n` }]]),
        head: new Map([['README.md', `# ${name}\n`]]),
        hooks: [],
        headSha: fnv(`head ${id}`).slice(0, 40),
        commits: [],
        messages: [],
        points: [],
        contents: new Map(),
        gaps: [],
      });
      changed = true;
      tell('projects.changed', null, {});
      return { class: inside ? 'mine' : 'view', id, via: inside ? 'location' : 'dialog' };
    },
    'project.requestMine': async ({ project: id }, { cancelled }) => {
      const p = projectOf(id);
      if (isMine(p)) return { class: 'mine' };
      const folder = locations().find(l => l.displayPath === p.summary.location && l.mode === 'write');
      if (!folder || p.via === 'person')
        await askPerson(`cd ${p.summary.displayPath} && devtab add --write`, cancelled);
      p.cls = 'mine';
      p.via = folder && p.via !== 'person' ? 'location' : 'dialog';
      changed = true;
      tell('project.changed', id, { class: 'mine', via: p.via });
      tell('projects.changed', null, {});
      return { class: 'mine' };
    },
    'project.setView': ({ project: id }) => {
      const p = projectOf(id);
      if (!isMine(p)) throw error('not-mine', 'the project is read-only (view); this needs a writable one');
      p.cls = 'view';
      p.via = 'person';
      changed = true;
      tell('project.changed', id, { class: 'view', via: 'person' });
      tell('projects.changed', null, {});
      return { class: 'view' };
    },
    'project.remove': ({ project: id }) => {
      projectOf(id);
      projects.delete(id);
      changed = true;
      tell('projects.changed', null, {});
      return {};
    },
    'env.requestCapture': () => {
      throw error(
        'confirmation-unavailable',
        'the companion cannot show its window; run the command in a terminal instead',
        {
          command: 'devtab env capture',
          reason: 'no-window',
        },
      );
    },
    'file.save': ({ project: id, path, baseHash, text }) => {
      const p = projectOf(id);
      writable(p, path);
      const file = p.files.get(path);
      if (!file) throw error('not-found', 'no such file or folder in the project');
      if (file.binary) throw error('binary', 'the file is binary', { size: file.size });
      if (typeof text !== 'string')
        throw error('invalid-params', 'the parameters do not match the method’s schema', { field: 'text' });
      if (bytes(text) > MAX_TEXT_BYTES)
        throw error('too-large', 'the text is too large', { limit: MAX_TEXT_BYTES, size: bytes(text) });
      const current = hashOf(file.text);
      if (baseHash !== current)
        throw error('conflict', 'the file changed on disk since it was read; nothing was written', {
          currentHash: current,
        });
      // eslint-disable-next-line no-control-regex
      if (file.encoding === 'windows-1252' && /[^\u0000-\u00ff]/.test(text))
        throw error('not-encodable', 'the text has characters its encoding cannot hold; nothing was written', {
          encoding: 'windows-1252',
        });
      // The companion keeps what is there before the first write of an editing session.
      if (!p.sessions?.has(path)) {
        kept(p, path, 'Before edit', file.text);
        (p.sessions ??= new Set()).add(path);
      }
      p.files.set(path, { ...file, text: text.replace(/\r\n?/g, '\n') });
      saved(p, path, text);
      wrote(p, [path]);
      return { hash: hashOf(text), mtimeMs: 0, protected: protectedRule(path) };
    },
    'file.create': ({ project: id, path, text = '' }) => {
      const p = projectOf(id);
      writable(p, path);
      if (exists(p, path)) throw error('exists', 'a file or folder with that name exists already');
      for (const key of [...p.files.keys()]) if (path.startsWith(key) && key.endsWith('/')) p.files.delete(key);
      kept(p, path, 'Before create', null);
      p.files.set(path, { text });
      saved(p, path, text);
      wrote(p, [path]);
      return { hash: hashOf(text), protected: protectedRule(path) };
    },
    'folder.create': ({ project: id, path }) => {
      const p = projectOf(id);
      writable(p, path);
      if (exists(p, path)) throw error('exists', 'a file or folder with that name exists already');
      p.files.set(`${path}/`, { dir: true });
      wrote(p, [path]);
      return { protected: protectedRule(`${path}/`) };
    },
    'file.rename': ({ project: id, from, to }) => {
      const p = projectOf(id);
      writable(p, from, 'from');
      writable(p, to, 'to');
      if (!exists(p, from)) throw error('not-found', 'no such file or folder in the project');
      if (exists(p, to)) throw error('exists', 'a file or folder with that name exists already');
      for (const [key, file] of [...p.files])
        if (key === from || key.startsWith(`${from}/`)) {
          p.files.delete(key);
          p.files.set(to + key.slice(from.length), file);
        }
      wrote(p, [from, to]);
      return { protected: protectedRule(to) };
    },
    'file.delete': ({ project: id, path }) => {
      writable(projectOf(id), path);
      throw error(
        'trash-unavailable',
        'the companion cannot move files to the Trash here, so it deleted nothing; delete the file in Finder',
      );
    },
    'git.messages': ({ project: id }) => ({ messages: [...projectOf(id).messages] }),
    'git.commit': async (params, { id: call, send, cancelled }) => {
      const p = projectOf(params.project);
      if (!isMine(p)) throw error('not-mine', 'the project is read-only (view); this needs a writable one');
      const { message, selection, runHooks, expect } = params;
      if (typeof message !== 'string' || !message.trim())
        throw error('invalid-params', 'the parameters do not match the method’s schema', { field: 'message' });
      if (!Array.isArray(selection) || selection.length === 0)
        throw error('nothing-selected', 'nothing is checked; nothing was committed');
      const shown = new Map((expect?.files ?? []).map(f => [f.path, f]));
      for (const { path, chunks } of selection) {
        if (!shown.has(path))
          throw error('invalid-params', 'every checked path needs its entry in expect', { field: 'expect' });
        if (Array.isArray(chunks) && chunks.length === 0)
          throw error('invalid-params', 'the parameters do not match the method’s schema', { field: 'chunks' });
      }
      if ((expect?.headSha ?? null) !== p.headSha)
        throw error('stale-selection', 'the repository or a file changed since the page showed it; nothing was done', {
          paths: [],
        });
      const status = statusOf(p);
      const stale = selection
        .map(({ path }) => {
          const now = status.find(f => f.path === path);
          const was = shown.get(path);
          return (now?.diskHash ?? null) === (was.diskHash ?? null) &&
            (now?.diskHash != null || (now?.diskBytesHash ?? null) === (was.diskBytesHash ?? null))
            ? null
            : path;
        })
        .filter(Boolean);
      if (stale.length)
        throw error('stale-selection', 'the repository or a file changed since the page showed it; nothing was done', {
          paths: stale,
        });
      for (const { path, chunks } of selection) {
        if (!chunks) continue;
        const entry = status.find(f => f.path === path);
        const file = p.files.get(path);
        const reason =
          entry?.change === 'untracked'
            ? 'new-file'
            : entry?.change === 'deleted'
              ? 'deleted'
              : !textFile(file)
                ? 'binary'
                : file.encoding && file.encoding !== 'utf-8'
                  ? 'not-utf8'
                  : null;
        if (reason)
          throw error('hunks-unsupported', 'hunks were chosen of a file committed whole; nothing was committed', {
            path,
            reason,
          });
      }
      if (!identity?.email) throw error('identity-missing', 'git has no user.name or user.email for the repository');
      const streamed = text => send({ type: 'stream', id: call, seq: streamSeq++, data: { text } });
      let streamSeq = 0;
      const failure = failing('git.commit');
      const hooks = runHooks ? p.hooks.filter(h => h === 'pre-commit' || h === 'commit-msg') : [];
      if (failure) {
        for (const text of failure.stream ?? []) {
          await wait(failure.pauseMs ?? 150);
          if (cancelled()) throw error('cancelled', 'the commit was cancelled');
          streamed(text);
        }
        if (failure.code === 'hook-timeout' || failure.hang) {
          for (let i = 0; i < 40 && !cancelled(); i++) await wait(100);
          if (cancelled()) throw error('cancelled', 'the commit was cancelled');
        }
        throw error(failure.code, failure.message ?? 'the commit failed; nothing was committed', failure.data);
      }
      for (const hook of hooks) {
        await wait(150);
        if (cancelled()) throw error('cancelled', 'the commit was cancelled');
        streamed(`${hook}: checking ${selection.length} ${selection.length === 1 ? 'file' : 'files'}\n`);
        await wait(150);
        if (cancelled()) throw error('cancelled', 'the commit was cancelled');
        streamed(`${hook}: passed\n`);
      }
      const before = new Map();
      for (const { path, chunks } of selection) {
        before.set(path, p.head.has(path) ? p.head.get(path) : null);
        const file = p.files.get(path);
        if (file === undefined) p.head.delete(path);
        else if (chunks) p.head.set(path, applyHunks(p.head.get(path) ?? null, file.text, chunks));
        else p.head.set(path, file.text ?? { bytes: path, size: file.size });
      }
      const made = { sha: sha(), parent: p.headSha, message: message.trim(), before };
      p.commits.push(made);
      p.headSha = made.sha;
      p.messages = [made.message, ...p.messages.filter(m => m !== made.message)].slice(0, 20);
      changed = true;
      tell('git.changed', p.id, {});
      return {
        changedAfter: [],
        hookChangedCommit: [],
        hooksSkipped: runHooks ? [] : p.hooks.filter(h => h === 'pre-commit' || h === 'commit-msg'),
        indexKept: [],
        sha: made.sha,
      };
    },
    'git.rollback': ({ project: id, paths, deleteAdded, expect }) => {
      const p = projectOf(id);
      for (const path of paths ?? []) writable(p, path);
      const status = statusOf(p);
      const shown = new Map((expect?.files ?? []).map(f => [f.path, f]));
      const stale = (paths ?? []).filter(path => {
        const now = status.find(f => f.path === path);
        return (now?.diskHash ?? null) !== (shown.get(path)?.diskHash ?? null);
      });
      if (stale.length)
        throw error('stale-selection', 'the repository or a file changed since the page showed it; nothing was done', {
          paths: stale,
        });
      if (deleteAdded && paths.some(path => !p.head.has(path)))
        throw error(
          'trash-unavailable',
          'the companion cannot move files to the Trash here, so it deleted nothing; delete the file in Finder',
        );
      const rolledBack = [];
      for (const path of paths) {
        if (!p.head.has(path)) continue;
        const head = p.head.get(path);
        if (textFile(p.files.get(path))) kept(p, path, 'Before rollback', p.files.get(path).text);
        p.files.set(
          path,
          typeof head === 'string' ? { ...(p.files.get(path) ?? {}), text: head } : { binary: true, size: head.size },
        );
        rolledBack.push(path);
      }
      wrote(p, rolledBack);
      tell('git.changed', id, {});
      return { rolledBack, trashed: [] };
    },
    // Stage 7: a point's version written over the file (or the file created again), after a copy «Before restore».
    'history.restore': ({ project: id, path, point, currentHash = null }) => {
      const p = projectOf(id);
      writable(p, path);
      const own = p.points.find(pt => pt.point === point && pt.path === path);
      if (!own || !p.contents.has(point)) throw error('not-found', "the point is not one of this file's");
      const file = p.files.get(path);
      if (file?.binary) throw error('binary', 'the file is binary', { size: file.size });
      const now = textFile(file) ? hashOf(file.text) : null;
      if ((currentHash ?? null) !== now)
        throw error('conflict', 'the file changed on disk since it was read; nothing was written', {
          currentHash: now,
        });
      const before = file ? kept(p, path, 'Before restore', file.text) : null;
      const text = p.contents.get(point);
      p.files.set(path, { ...(file ?? {}), text });
      saved(p, path, text);
      wrote(p, [path]);
      return { before, hash: hashOf(text), protected: protectedRule(path), restored: point };
    },
    // Asks the person (the companion's window, or the command for the terminal); «yes» deletes the project's history.
    'history.requestPurge': async ({ project: id }, { cancelled }) => {
      const p = projectOf(id);
      await askPerson(`devtab history purge ${shellWord(p.summary.displayPath)}`, cancelled);
      p.points = [];
      p.contents = new Map();
      changed = true;
      return {};
    },
    'git.undoCommit': ({ project: id, headSha }) => {
      const p = projectOf(id);
      if (!isMine(p)) throw error('not-mine', 'the project is read-only (view); this needs a writable one');
      if (headSha !== p.headSha)
        throw error('undo-unavailable', 'HEAD is not the commit the page showed', { reason: 'moved' });
      const last = p.commits.at(-1);
      if (!last || last.sha !== p.headSha)
        throw error('undo-unavailable', 'a remote branch has the commit', { reason: 'pushed' });
      for (const [path, was] of last.before) {
        if (was === null) p.head.delete(path);
        else p.head.set(path, was);
      }
      p.commits.pop();
      p.headSha = last.parent;
      changed = true;
      tell('git.changed', id, {});
      return { message: last.message, paths: [...last.before.keys()] };
    },
  });

  const out = (send, frame) => {
    for (const piece of chunked(frame, maxFrameBytes)) send(piece);
  };

  return {
    welcome,
    projects,
    subscribed,
    /** Answers one frame of the extension; frames go out through `send`. */
    async handle(frame, send) {
      lastSend = send;
      if (frame?.type === 'hello') {
        if (mode === 'not-running')
          return send({
            type: 'error',
            id: null,
            error: { code: 'not-running', message: 'the companion is not running; run `devtab doctor`' },
          });
        if (mode === 'version' || !Array.isArray(frame.api) || !frame.api.includes(1))
          return send({
            type: 'error',
            id: null,
            error: { code: 'unsupported-version', message: 'no API version in common', data: { supported: [2] } },
          });
        return send(copy(welcome));
      }
      if (frame?.type === 'cancel') {
        running.get(frame.id)?.cancel();
        return;
      }
      if (frame?.type !== 'call') return;
      const { id, method, params = {} } = frame;
      const handler = methods[method];
      if (!handler || (!offers(method) && !replay))
        return send({
          type: 'error',
          id,
          error: { code: 'unknown-method', data: { method }, message: 'this companion does not offer that method' },
        });
      const queue = replies.get(`${method} ${canonical(params)}`);
      if (method === 'events.subscribe' && projects.has(params.project)) subscribed.add(params.project);
      // A vector answers only for the repository as the vectors saw it: not once a file was added, and never a method
      // whose answer depends on what happened before — unless the vectors' own sequence is played (`replay`).
      const known = replay ? (queue?.length > 1 ? queue.shift() : queue?.[0]) : queue?.[0];
      if (
        known &&
        (replay ||
          (mode === 'normal' &&
            !changed &&
            !STATEFUL.has(method) &&
            !(method === 'projects.list' && projects.size > 1)))
      ) {
        for (const part of known.stream ?? []) send({ ...copy(part), id });
        const response = copy(known.response);
        return out(send, { ...response, ...(response.result && { result: asSent(method, response.result) }), id });
      }
      // A failure scripted for this method (git.commit streams its own before it fails).
      const scripted = method === 'git.commit' ? null : failing(method);
      if (scripted)
        return out(send, {
          type: 'error',
          id,
          error: {
            code: scripted.code,
            message: scripted.message ?? 'refused',
            ...(scripted.data && { data: scripted.data }),
          },
        });
      let stop = false;
      running.set(id, { cancel: () => (stop = true) });
      try {
        const result = await handler(params, { id, send: f => out(send, f), cancelled: () => stop });
        out(send, { type: 'result', id, result: asSent(method, result) });
      } catch (e) {
        if (!e.code) throw e;
        out(send, { type: 'error', id, error: { code: e.code, message: e.message, ...(e.data && { data: e.data }) } });
      } finally {
        running.delete(id);
      }
    },
    /** An event, sent if the extension subscribed to its project (or about the companion: `project` null). */
    emit(name, project, data, send) {
      if (project !== null && !subscribed.has(project)) return false;
      out(send, { type: 'event', name, project, data });
      return true;
    },
    /** A file appears on disk (for the e2e's `files.changed`). */
    addFile(id, path, text) {
      changed = true;
      projects.get(id)?.files.set(path, { text });
    },
    /** Someone else's edit of a file on disk (null: deleted): a save from the older text then meets `conflict`. */
    changeOnDisk(id, path, text) {
      changed = true;
      const p = projects.get(id);
      if (!p) return;
      if (text === null) p.files.delete(path);
      else p.files.set(path, { ...(p.files.get(path) ?? {}), text });
      tell('files.changed', id, { more: false, paths: [path] });
    },
    /**
     * The companion was not running from `from` to `to` and found `paths` files changed meanwhile: a stretch in the
     * project's history (`history.file.gaps`, `project.state.historyGaps`) and the event `history.gap`.
     */
    gap(id, from, to, paths = 0) {
      const p = projects.get(id);
      if (!p) return;
      changed = true;
      p.gaps.push({ from, to });
      if (p.state) p.state = { ...p.state, historyGaps: p.gaps.map(g => ({ ...g })) };
      tell('history.gap', id, { from, paths, to });
    },
    /** The next call of `method` fails with `code` and `data`, after the streamed parts `stream` (texts). */
    failNext(method, code, data, options = {}) {
      failures.push({ method, code, data, ...options });
    },
    /** What the companion's window answers from now on. */
    setConfirm(answer) {
      confirm = answer;
    },
    /** git's name and e-mail (null: none, `identity-missing`). */
    setIdentity(next) {
      identity = next;
    },
  };
};
