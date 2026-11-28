// The scripted companion's files opened from the system (D42): what ./companion.mjs answers with `openFiles: true` —
// the methods `openFile.*` and `page.activity` in the companion's contract's shapes
// (extension/src/projects/api/companion-api-v1/methods/openFile.*.schema.json), the one-time tokens, and the event
// `open.requested`, which goes only to a connection that has told `page.activity`. No path is ever read: an opened file
// is a text in memory with a `~/…` display path, as the companion would show it.
//
//   openFileMethods({ error, hashOf, now }) → { methods, offer, changeOnDisk, replace, expire, activity, files }
//
// `offer(spec)` is what `devtab open` would do: a file (or a file of an added project) and a token for it, `{ token }`
// back — the e2e then sends `open.requested` or leaves the token for `openFile.pending` / the page's address.
// `changeOnDisk(file, text)` is someone else's edit; `replace(file)` — the file was replaced or moved (read only from
// then on, `not-editable {reason: "replaced"}`); `expire()` lets every waiting token run out; `activity` is what the page
// said of itself.

/** The methods a companion with open files announces. */
export const OPEN_FILE_METHODS = [
  'page.activity',
  'openFile.pending',
  'openFile.claim',
  'openFile.list',
  'openFile.read',
  'openFile.save',
  'openFile.history',
  'openFile.historyContent',
  'openFile.restore',
  'openFile.forget',
];

/** At most this many files in the list (the oldest leaves) and tokens waiting; the pause between saves of a file. */
const MAX_FILES = 20;
const MAX_WAITING = 8;
const SAVE_GAP_MS = 500;
const TOKEN = /^[0-9a-f]{32}$/;

export const openFileMethods = ({ error, hashOf, now = Date.now }) => {
  const files = new Map();
  const tokens = new Map();
  const activity = [];
  let ids = 0;
  let tokenIds = 0;

  const fileOf = id => {
    const found = files.get(id);
    if (!found) throw error('not-found', 'no such open file');
    return found;
  };
  const reasonOf = f => (f.mode === 'read' ? f.reason : null);
  const summary = f => ({
    file: f.file,
    name: f.name,
    displayPath: f.displayPath,
    mode: f.mode,
    executes: f.executes,
    reason: reasonOf(f),
    via: f.via,
    openedAt: f.openedAt,
  });
  const keep = (f, label) => {
    const point = `f:${hashOf(f.text)}@${now() + f.points.length}`;
    f.points.unshift({
      point,
      label,
      source: 'companion',
      size: f.text.length,
      timeMs: now(),
      content: true,
      text: f.text,
    });
    return point;
  };
  const writable = f => {
    if (f.mode !== 'edit')
      throw error('not-editable', 'the open file is read only', { reason: f.reason ?? 'requested' });
  };

  const methods = {
    'page.activity': ({ visible, focusedAt }) => {
      if (typeof visible !== 'boolean' || !Number.isSafeInteger(focusedAt) || focusedAt < 0)
        throw error('invalid-params', 'visible and focusedAt', {
          field: typeof visible !== 'boolean' ? 'visible' : 'focusedAt',
        });
      activity.push({ visible, focusedAt });
      return {};
    },
    'openFile.pending': () => ({
      tokens: [...tokens.entries()].filter(([, t]) => t.expiresAt > now()).map(([token]) => token),
    }),
    'openFile.claim': ({ token }) => {
      if (typeof token !== 'string' || !TOKEN.test(token))
        throw error('invalid-params', 'a token is 32 lowercase hexadecimal characters', { field: 'token' });
      const waiting = tokens.get(token);
      if (!waiting || waiting.expiresAt <= now())
        throw error('not-found', 'no such opening: it was claimed already, it expired, or it is for another extension');
      tokens.delete(token);
      const at = { line: waiting.line ?? null, column: waiting.column ?? null };
      if (waiting.project)
        return {
          kind: 'project',
          project: waiting.project,
          path: waiting.path,
          name: waiting.path.slice(waiting.path.lastIndexOf('/') + 1),
          displayPath: `~/fx/repo/${waiting.path}`,
          class: waiting.class ?? 'mine',
          ...at,
        };
      const f = fileOf(waiting.file);
      return {
        kind: 'file',
        file: f.file,
        name: f.name,
        displayPath: f.displayPath,
        mode: f.mode,
        executes: f.executes,
        reason: reasonOf(f),
        ...at,
      };
    },
    'openFile.list': () => [...files.values()].sort((a, b) => b.openedAt - a.openedAt).map(summary),
    'openFile.read': ({ file }) => {
      const f = fileOf(file);
      return {
        bom: false,
        encoding: 'utf-8',
        hash: hashOf(f.text),
        large: false,
        lineEnding: 'lf',
        mtimeMs: f.mtimeMs,
        protected: f.executes,
        secret: f.reason === 'secret',
        size: f.text.length,
        text: f.text,
      };
    },
    'openFile.save': ({ file, baseHash, text }) => {
      const f = fileOf(file);
      writable(f);
      const wait = f.lastSave + SAVE_GAP_MS - now();
      if (wait > 0) throw error('rate-limited', 'one save of a file per 500 ms', { retryAfterMs: wait });
      if (baseHash !== hashOf(f.text))
        throw error('conflict', 'the file changed on disk', { currentHash: hashOf(f.text) });
      keep(f, 'Before save');
      f.text = text;
      f.mtimeMs = now();
      f.lastSave = now();
      f.saves += 1;
      return { hash: hashOf(text), mtimeMs: f.mtimeMs };
    },
    'openFile.history': ({ file }) => ({
      points: fileOf(file).points.map(p => ({
        point: p.point,
        label: p.label,
        source: p.source,
        size: p.size,
        timeMs: p.timeMs,
        content: p.content,
      })),
    }),
    'openFile.historyContent': ({ file, point }) => {
      const f = fileOf(file);
      const found = f.points.find(p => p.point === point);
      if (!found) throw error('not-found', 'no such copy');
      return { text: found.text, secret: f.reason === 'secret' };
    },
    'openFile.restore': ({ file, point, currentHash }) => {
      const f = fileOf(file);
      writable(f);
      const found = f.points.find(p => p.point === point);
      if (!found) throw error('not-found', 'no such copy');
      if (currentHash !== hashOf(f.text))
        throw error('conflict', 'the file changed on disk', { currentHash: hashOf(f.text) });
      const before = keep(f, 'Before restore');
      f.text = found.text;
      return { restored: point, before, hash: hashOf(f.text) };
    },
    'openFile.forget': ({ file }) => {
      fileOf(file);
      files.delete(file);
      return {};
    },
  };

  return {
    methods,
    files,
    activity,
    /**
     * A file opened by a person: `{ name, displayPath, text, mode, executes, reason, via, line, column, token }`, or a
     * file of an added project: `{ project, path, class, line, column, token }`. Returns the token (empty with
     * `claimed`: the file is listed as if a page had claimed it before).
     */
    offer(spec) {
      let file;
      if (!spec.project) {
        const id = spec.file ?? `f_${String(++ids).padStart(10, '0')}`;
        file = id;
        const mode = spec.mode ?? (spec.reason ? 'read' : 'edit');
        files.set(id, {
          file: id,
          name: spec.name ?? 'todo.md',
          displayPath: spec.displayPath ?? `~/notes/${spec.name ?? 'todo.md'}`,
          text: spec.text ?? '# Todo\n\n- one\n- two\n',
          mode,
          executes: spec.executes ?? false,
          reason: mode === 'read' ? (spec.reason ?? 'requested') : null,
          via: spec.via ?? 'terminal',
          openedAt: now() + ids,
          mtimeMs: now(),
          lastSave: 0,
          points: [],
          saves: 0,
        });
        while (files.size > MAX_FILES)
          files.delete([...files.values()].sort((a, b) => a.openedAt - b.openedAt)[0].file);
      }
      // Opened and claimed before: in the list, no token waits.
      if (spec.claimed) return { token: '', file };
      const token = spec.token ?? (++tokenIds).toString(16).padStart(32, '0');
      tokens.set(token, {
        ...(file && { file }),
        ...(spec.project && { project: spec.project, path: spec.path ?? '', class: spec.class }),
        ...(spec.line !== undefined && { line: spec.line }),
        ...(spec.column !== undefined && { column: spec.column }),
        expiresAt: now() + (spec.lifeMs ?? 120_000),
      });
      while (tokens.size > MAX_WAITING) tokens.delete(tokens.keys().next().value);
      return { token, file: file ?? null };
    },
    /** Someone else's edit of an opened file. */
    changeOnDisk(file, text) {
      const f = files.get(file);
      if (f) {
        f.text = text;
        f.mtimeMs = now();
      }
    },
    /** The file was replaced, moved or became a link: read only until a person opens it again. */
    replace(file) {
      const f = files.get(file);
      if (f) {
        f.mode = 'read';
        f.reason = 'replaced';
      }
    },
    /** Every waiting token runs out. */
    expire() {
      for (const t of tokens.values()) t.expiresAt = 0;
    },
    /** Whether `open.requested` may go to this connection: only after it told `page.activity`. */
    told: () => activity.length > 0,
  };
};
