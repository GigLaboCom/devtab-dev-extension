// A scripted companion speaking the companion's contract (extension/src/projects/api/companion-api-v1/): what the
// e2e's fake Native Messaging host (./fake-host.mjs) answers with, and what the extension's unit tests run the client
// and the seam's contract suite against. No socket, no server, no git: one repository in memory, seeded from the
// contract's vectors — a request that is one of the vectors' is answered with that vector's response, word for word;
// any other is answered from the same repository by the contract's rules (paths, secrets, symlinks, limits).
//
//   createCompanion({ vectors, mode, hostile, big, wait }) → { handle(frame, send), emit(event, send), files, … }
//
// `vectors` is the vectors folder as { 'tree.list.json': [...], … } (the caller reads it: Node from disk, the tests
// with Vite's glob). `mode`: 'normal' | 'empty' (no project added) | 'version' (no API version in common) |
// 'not-running' (the relay cannot reach the supervisor). `hostile` adds a second project whose names, branch, history
// labels and lines carry HTML and terminal escape sequences; `big` adds to it a folder of 5001 long names (5000 listed)
// and a 2 MiB file, both answered in chunks. `send(frame)` gets each frame out, chunked as the supervisor chunks (`maxFrameBytes`).

const PROJECT = 'p_abcdefgh23';
const HOSTILE = 'p_hostile001';
export const MAX_FRAME_BYTES = 921_600;
export const MAX_TEXT_BYTES = 5_242_880;
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
const hashOf = text => {
  let out = '';
  for (let round = 0; round < 8; round++) {
    let h = 0x811c9dc5 ^ round;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
};

const error = (code, message, data) => Object.assign(new Error(message), { code, data });

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
} = {}) => {
  // ---- the vectors: requests answered word for word ----------------------------------------------------------------
  const replies = new Map();
  for (const [file, list] of Object.entries(vectors)) {
    if (!Array.isArray(list) || file === 'hello.json' || file === 'unknown-method.json') continue;
    for (const v of list)
      if (v.request?.type === 'call')
        replies.set(`${v.request.method} ${canonical(v.request.params ?? {})}`, {
          response: v.response,
          stream: v.stream,
        });
  }
  const vector = (file, at = 0) => vectors[file]?.[at]?.response;
  const welcome = vectors['hello.json']?.[0]?.response ?? {
    type: 'welcome',
    companion: '0.1.0',
    api: 1,
    server: '0.1.44',
    platform: 'macos',
    methods: METHODS,
    limits: { maxRequestBytes: 8_388_608, maxTextBytes: MAX_TEXT_BYTES },
  };

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
      ['src/app.txt', headApp],
      ['docs/readme.md', '# Readme\n'],
      ['gone.txt', 'This file will be deleted.\n'],
      ['.gitignore', 'build/\n.env\n'],
    ]),
    status: vector('git.status.json')?.result,
    points: [...(vector('history.file.json')?.result?.points ?? []).map(p => ({ ...p, path: 'docs/readme.md' }))],
    contents: new Map([[vector('history.file.json')?.result?.points?.[0]?.point, '# Readme\n\nchanged on disk\n']]),
  });
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
      points: [
        {
          label: HOSTILE_STRINGS.label,
          path: 'notes.txt',
          point: 'g:0000000000000000000000000000000000000001@1767225600000:6e6f7465732e747874',
          size: 0,
          source: 'commit',
          timeMs: 1767225600000,
        },
      ],
      contents: new Map([['g:0000000000000000000000000000000000000001@1767225600000:6e6f7465732e747874', 'plain\n']]),
    });
  }

  const projectOf = id => {
    const p = projects.get(id);
    if (!p || mode === 'empty') throw error('not-found', 'no such project');
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
    for (const [full, file] of p.files) {
      if (!full.startsWith(prefix)) continue;
      const rest = full.slice(prefix.length);
      const name = rest.split('/')[0];
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
            size: file.size ?? bytes(file.text),
          }),
        );
    }
    if (path && children.size === 0) throw error('not-found', 'no such file or folder in the project');
    const entries = [...children.values()].sort(
      (a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || (a.name < b.name ? -1 : 1),
    );
    return { entries: entries.slice(0, 5000), skippedNames: 0, truncated: entries.length > 5000 };
  };

  let changed = false;
  const running = new Map();
  const subscribed = new Set();

  const methods = {
    'companion.state': () =>
      vector('companion.state.json')?.result ?? {
        companion: '0.1.0',
        deletePolicy: 'trash',
        env: { capturedAt: null, path: [] },
        paused: false,
        problems: [],
        server: { state: 'running', version: '0.1.44' },
      },
    'projects.list': () => (mode === 'empty' ? [] : [...projects.values()].map(p => copy(p.summary))),
    'project.state': ({ project: id }) => {
      const p = projectOf(id);
      return (
        (p.state && copy(p.state)) ?? {
          ahead: 0,
          behind: 0,
          branch: p.summary.branch,
          class: 'view',
          detached: false,
          historyGaps: [],
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
        protected: false,
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
      return p.status ? copy(p.status) : { branch: p.summary.branch, files: [], headSha: '0'.repeat(40) };
    },
    'git.identity': () => ({ email: null, name: null, signing: { enabled: false, format: null } }),
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
      const a = (old ?? '').split('\n');
      const b = (now ?? '').split('\n');
      // A plain line-by-line comparison: enough for a fake, the hunks of the vectors come with the vectors.
      const hunks = [];
      let i = 0;
      while (i < Math.max(a.length, b.length)) {
        if (a[i] === b[i]) {
          i++;
          continue;
        }
        const start = i;
        while (i < Math.max(a.length, b.length) && a[i] !== b[i]) i++;
        hunks.push({
          lines: Math.max(0, Math.min(i, b.length) - start),
          oldLines: Math.max(0, Math.min(i, a.length) - start),
          oldStart: start,
          start,
        });
      }
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
      if (file?.binary) return { chunkable: false, diskHash: null, headHash: null, hunks: [], reason: 'binary' };
      return {
        chunkable: true,
        diskHash: file?.text ? hashOf(file.text) : null,
        headHash: null,
        hunks: [],
        reason: null,
      };
    },
    'history.file': ({ project: id, path }) => {
      const p = projectOf(id);
      checkPath(path);
      const file = p.files.get(path);
      if (!file || file.link) throw error('not-found', 'no such file or folder in the project');
      return {
        gaps: [],
        points: p.points
          .filter(pt => pt.path === path)
          .map(pt => Object.fromEntries(Object.entries(pt).filter(([k]) => k !== 'path'))),
      };
    },
    'history.project': ({ project: id, limit }) => {
      const p = projectOf(id);
      return { deleted: [], next: null, points: p.points.slice(0, Math.min(limit ?? 500, 500)).map(copy) };
    },
    'history.content': ({ project: id, point }) => {
      const p = projectOf(id);
      if (!p.contents.has(point)) throw error('not-found', 'no such history point');
      return { secret: false, text: p.contents.get(point) };
    },
  };

  const out = (send, frame) => {
    for (const piece of chunked(frame, maxFrameBytes)) send(piece);
  };

  return {
    welcome,
    projects,
    subscribed,
    /** Answers one frame of the extension; frames go out through `send`. */
    async handle(frame, send) {
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
      if (!handler)
        return send({
          type: 'error',
          id,
          error: { code: 'unknown-method', data: { method }, message: 'this companion does not offer that method' },
        });
      const known = replies.get(`${method} ${canonical(params)}`);
      if (method === 'events.subscribe' && projects.has(params.project)) subscribed.add(params.project);
      // A vector answers only for the repository as the vectors saw it: not once a file was added.
      if (known && mode === 'normal' && !changed && !(method === 'projects.list' && projects.size > 1)) {
        for (const part of known.stream ?? []) send({ ...copy(part), id });
        return out(send, { ...copy(known.response), id });
      }
      let stop = false;
      running.set(id, { cancel: () => (stop = true) });
      try {
        const result = await handler(params, { id, send: f => out(send, f), cancelled: () => stop });
        out(send, { type: 'result', id, result });
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
  };
};
