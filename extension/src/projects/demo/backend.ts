/**
 * `demoBackend` — the seam `ProjectBackend` (../backend.ts) on the invented projects of ./data.ts, held in memory for the
 * life of the page: what a person (and the store's reviewer) sees without the companion. Every method of the API
 * answers as the companion would, by the same rules — the classes, the protected places, the secrets, the limits —, so
 * every action on the page visibly does something: an edit saves itself, a commit moves files out of the changes and
 * into the commits to push, an undo brings them back, a push empties the list, a restore changes the file. Nothing
 * leaves the page; a reload starts the demo again.
 *
 * Tests reach the states that need the outside world through `controls`: a file changed on disk while it is edited
 * (a save then meets `conflict`), a hook that fails with its output streamed, a hook's tool not found, a hook that runs
 * out of time, a rejected push, a pause of the companion.
 */
import { DEMO_IDENTITY, DEMO_LOCATIONS, DEMO_PROJECTS, DEMO_REMOTE_HOST } from './data';
import { applyHunks, lineHunks, textHash } from './diff';
import { CompanionError } from '../types';
import type { CallOptions, ConnectionState, ProjectBackend } from '../backend';
import type {
  ChunkHunk,
  CompanionEvent,
  DiffSides,
  ErrorCode,
  FilePoint,
  FileText,
  FoundFile,
  GitStatus,
  Method,
  OutputLine,
  Params,
  ProjectClass,
  ProjectId,
  ProjectPoint,
  ProjectState,
  ProjectSummary,
  Result,
  SearchHit,
  StatusFile,
  TreeEntry,
  TrustedLocation,
  Via,
} from '../types';
import type { DemoFile, DemoProjectSeed } from './data';

/** The limits of the API (§5.5). */
export const LIMITS = {
  textBytes: 5 * 1024 * 1024,
  treeEntries: 5000,
  matches: 5000,
  deleteFiles: 2000,
  historyPage: 500,
} as const;

/** A hook's failure the next commit meets. */
export type HookFailure =
  | { code: 'hook-failed'; hook?: string; output?: string[] }
  | { code: 'hook-tool-missing'; hook?: string; tool?: string }
  | { code: 'hook-timeout'; hook?: string };

export type PushFailure =
  'push-rejected' | 'push-remote-rejected' | 'push-auth-failed' | 'push-needs-input' | 'push-timeout' | 'push-network';

export interface DemoControls {
  /** Someone else changed (or, with null, deleted) the file on disk: the next save from an older text conflicts. */
  changeOnDisk(project: ProjectId, path: string, text: string | null): void;
  failNextCommit(failure: HookFailure): void;
  failNextPush(code: PushFailure): void;
  /** No `user.name` / `user.email` in git's configuration (null), or this identity. */
  setIdentity(identity: { name: string; email: string } | null): void;
  /** The companion's pause of writes (`devtab pause`), or its end. */
  setPaused(paused: boolean): void;
}

export interface DemoOptions {
  now?: () => number;
  /** How the demo waits between the lines of a hook's or a push's output, and between the files of a search. */
  wait?: (ms: number) => Promise<void>;
  projects?: readonly DemoProjectSeed[];
  locations?: readonly TrustedLocation[];
}

export type DemoBackend = ProjectBackend & { readonly controls: DemoControls };

interface Commit {
  sha: string;
  summary: string;
  message: string;
  author: string;
  timeMs: number;
  pushed: boolean;
  before: Map<string, DemoFile | null>;
}

interface Point {
  point: string;
  path: string;
  label: string;
  source: FilePoint['source'];
  timeMs: number;
  /** Null: a moment noted without its text (`Before create`, `Deleted while away`), as the companion's `c:none`. */
  text: string | null;
  session?: string;
}

interface Project {
  seed: DemoProjectSeed;
  class: ProjectClass;
  via: Via;
  present: boolean;
  head: Map<string, DemoFile>;
  disk: Map<string, DemoFile>;
  mtimes: Map<string, number>;
  renames: Map<string, string>;
  stagedOutside: Set<string>;
  conflicted: Set<string>;
  commits: Commit[];
  upstream: string | null;
  behind: number;
  points: Point[];
  /** The stretches the companion did not watch the project. */
  gaps: { from: number; to: number }[];
  messages: string[];
  /** Editing sessions seen, and the hash each last saved. */
  sessions: Map<string, string>;
}

const fail = (code: ErrorCode, message: string, data?: Record<string, unknown>): never => {
  throw new CompanionError(code, message, data);
};

const realWait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// ---- the rules of paths (§4.5, §5.3, §5.4) -----------------------------------------------------------------------

const SECRET = [
  /^\.env$/,
  /^\.env\..+/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.keystore$/,
  /\.jks$/,
  /^id_rsa/,
  /^id_ed25519/,
  /^id_ecdsa/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^\.netrc$/,
  /^\.git-credentials$/,
  /^credentials\.json$/,
  /\.tfvars$/,
];

/** The places whose files run code by themselves or change what git runs: writable in «mine», marked (Р25). */
const PROTECTED: readonly [RegExp, string][] = [
  [/^(\.githooks|\.husky)\//, 'hooks'],
  [/^\.(gitattributes|gitmodules)$/, 'git attributes'],
  [/^(\.pre-commit-config\.yaml|\.?lefthook\.yml|lint-staged\.config\..+|\.lintstagedrc.*)$/, 'commit checks'],
  [/^(\.openidea|\.idea|\.devcontainer)\/|^\.vscode\/(tasks|settings)\.json$|^devcontainer\.json$/, 'tool settings'],
  [
    /^(\.envrc|\.tool-versions|\.?mise\.toml|\.nvmrc|\.node-version|\.python-version|\.ruby-version)$/,
    'shell environment',
  ],
  [/^\.cargo\/config(\.toml)?$|^rust-toolchain(\.toml)?$/, 'toolchain'],
];

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
export const isSecretPath = (path: string): boolean => SECRET.some(rule => rule.test(baseName(path)));
export const protectedRule = (path: string): string | undefined => PROTECTED.find(([rule]) => rule.test(path))?.[1];
const isGitPath = (path: string): boolean => path === '.git' || path.startsWith('.git/');
/** A path as one word of a shell command: as it is when it is plain, in single quotes otherwise. */
const shellWord = (path: string): string =>
  /^[\w~@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;

const checkPath = (path: string, field = 'path'): void => {
  if (typeof path !== 'string') fail('invalid-params', `${field} must be a string`, { field });
  if (path === '') return;
  const bad =
    path.startsWith('/') ||
    path.includes('\\') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.length > 4096 ||
    path.split('/').some(segment => segment === '' || segment === '.' || segment === '..' || segment.length > 255);
  if (bad) fail('invalid-path', `not a path inside the project: ${JSON.stringify(path)}`);
};

const isText = (file: DemoFile | undefined): file is string => typeof file === 'string';
const sizeOf = (file: DemoFile): number =>
  typeof file === 'string'
    ? new TextEncoder().encode(file).length
    : 'binary' in file
      ? file.binary
      : 'large' in file
        ? file.large
        : 0;

/** The text of a file, or the error the API gives for one that is not text. */
const textOf = (file: DemoFile | undefined, path: string): string => {
  if (file === undefined) return fail('not-found', `no file ${path}`);
  if (typeof file === 'string') return file;
  if ('binary' in file) return fail('binary', `${path} is a binary file`, { size: file.binary });
  if ('large' in file)
    return fail('too-large', `${path} is larger than the limit`, { size: file.large, limit: LIMITS.textBytes });
  return fail('outside-project', `${path} is a link that leads out of the project`);
};

// ---- the backend --------------------------------------------------------------------------------------------------

export const demoBackend = (options: DemoOptions = {}): DemoBackend => {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? realWait;
  const opened = now();
  const ago = (minutes: number): number => opened - minutes * 60_000;
  let counter = 0;
  const shaOf = (seed: string): string => {
    counter++;
    const part = (s: string) => textHash(`${s}:${counter}`).slice(5);
    return (part(seed) + part(seed + 'a') + part(seed + 'b')).slice(0, 40);
  };

  const projects = new Map<ProjectId, Project>();
  for (const seed of options.projects ?? DEMO_PROJECTS) {
    const commits: Commit[] = seed.commits.map(c => ({
      sha: shaOf(`${seed.id}:${c.summary}`),
      summary: c.summary,
      message: c.summary,
      author: c.author,
      timeMs: ago(c.ago),
      pushed: c.pushed,
      before: new Map(Object.entries(c.before ?? {})),
    }));
    const disk = new Map(Object.entries(seed.disk));
    const points: Point[] = seed.history.map((h, i) => ({
      point: `s:${seed.id}-${i}@${ago(h.ago)}`,
      path: h.path,
      label: h.label,
      source: h.source,
      timeMs: ago(h.ago),
      text: h.text,
    }));
    projects.set(seed.id, {
      seed,
      class: seed.class,
      via: seed.via,
      present: true,
      head: new Map(Object.entries(seed.head)),
      disk,
      mtimes: new Map([...disk.keys()].map((path, i) => [path, ago(DAY_MINUTES + i)])),
      renames: new Map(Object.entries(seed.renames ?? {})),
      stagedOutside: new Set(seed.stagedOutside),
      conflicted: new Set(seed.conflicted),
      commits,
      upstream: seed.upstream,
      behind: seed.behind,
      points,
      gaps: (seed.gaps ?? []).map(g => ({ from: ago(g.fromAgo), to: ago(g.toAgo) })),
      messages: [...seed.messages],
      sessions: new Map(),
    });
  }
  const locations = (options.locations ?? DEMO_LOCATIONS).map(l => ({ ...l }));

  let identity: { name: string; email: string } | null = { ...DEMO_IDENTITY };
  let paused = false;
  let nextCommitFailure: HookFailure | null = null;
  let nextPushFailure: PushFailure | null = null;

  const listeners = new Map<ProjectId | null, Set<(event: CompanionEvent) => void>>();
  const stateListeners = new Set<(state: ConnectionState) => void>();
  let disposed = false;

  const emit = (event: CompanionEvent): void => {
    // An event about the companion (no project) reaches every listener.
    const heard =
      event.project === null
        ? [...listeners.values()].flatMap(set => [...set])
        : [...(listeners.get(event.project) ?? [])];
    queueMicrotask(() => {
      if (disposed) return;
      for (const listener of heard)
        try {
          listener(event);
        } catch {
          // One listener's failure spoils no other.
        }
    });
  };
  const changed = (project: ProjectId, paths: string[]): void => {
    emit({ name: 'files.changed', project, data: { paths, more: false } });
    emit({ name: 'history.appeared', project, data: { paths } });
  };

  const projectOf = (id: ProjectId): Project => {
    const project = projects.get(id);
    if (!project || !project.present) return fail('not-found', `no project ${String(id)}`);
    return project;
  };

  const headSha = (p: Project): string => p.commits.at(-1)?.sha ?? '0'.repeat(40);

  const isIgnored = (p: Project, path: string): boolean =>
    p.seed.ignore.some(rule =>
      rule.endsWith('/')
        ? path === rule.slice(0, -1) || path.startsWith(rule) || path.includes(`/${rule}`)
        : baseName(path) === rule,
    );

  const point = (p: Project, path: string, label: string, text: string | null, extra: Partial<Point> = {}): Point => {
    const timeMs = now();
    const made: Point = {
      point: `c:${textHash(`${p.seed.id}:${path}:${label}:${p.points.length}`).slice(5)}@${timeMs}`,
      path,
      label,
      source: label.startsWith('Before') ? 'companion' : 'server',
      timeMs,
      text,
      ...extra,
    };
    p.points.push(made);
    return made;
  };

  /** The rules every write follows (§5.3, §5.4). */
  const writable = (p: Project, path: string, field = 'path'): void => {
    if (p.class !== 'mine') fail('not-mine', 'the project is «view»: the page may not write to it');
    if (paused) fail('paused', 'the companion has paused writes');
    checkPath(path, field);
    if (path === '' || isGitPath(path))
      fail('protected-path', `${path || 'the root'} may not be written`, { rule: 'git-dir' });
    if (isSecretPath(path)) fail('secret-file', `${path} holds secrets: read only from the page`);
    const file = p.disk.get(path);
    if (file !== undefined && typeof file !== 'string' && 'link' in file)
      fail(file.link === 'outside' ? 'outside-project' : 'protected-path', `${path} is a link`, { rule: 'symlink' });
  };

  const setDisk = (p: Project, path: string, file: DemoFile | null): void => {
    if (file === null) {
      p.disk.delete(path);
      p.mtimes.delete(path);
    } else {
      p.disk.set(path, file);
      p.mtimes.set(path, now());
    }
  };

  const filesUnder = (map: Map<string, DemoFile>, dir: string): string[] =>
    [...map.keys()].filter(path => path === dir || path.startsWith(`${dir}/`));

  // ---- git status ---------------------------------------------------------------------------------------------

  const statusFiles = (p: Project): StatusFile[] => {
    const files: StatusFile[] = [];
    const renamedFrom = new Map<string, string>();
    for (const [to, from] of p.renames)
      if (p.disk.has(to) && !p.head.has(to) && p.head.has(from) && !p.disk.has(from)) renamedFrom.set(to, from);
    const hidden = new Set(renamedFrom.values());
    const paths = [...new Set([...p.head.keys(), ...p.disk.keys()])].sort();
    for (const path of paths) {
      if (hidden.has(path)) continue;
      const inHead = p.head.get(path);
      const onDisk = p.disk.get(path);
      // The text's hash for a text; for a binary or too large file only its bytes' (`diskBytesHash`), as the companion.
      const diskHash = isText(onDisk) ? textHash(onDisk) : null;
      const diskBytesHash = onDisk !== undefined && !isText(onDisk) ? hashOf(onDisk) : null;
      const entry = (change: StatusFile['change'], from: string | null = null): StatusFile => ({
        path,
        group: change === 'untracked' ? 'unversioned' : 'changes',
        change,
        renamedFrom: from,
        stagedOutside: p.stagedOutside.has(path),
        diskHash,
        diskBytesHash,
      });
      if (p.conflicted.has(path) && onDisk !== undefined) files.push(entry('conflicted'));
      else if (renamedFrom.has(path)) files.push(entry('renamed', renamedFrom.get(path)!));
      else if (inHead === undefined && onDisk !== undefined) {
        if (!isIgnored(p, path)) files.push(entry('untracked'));
      } else if (inHead !== undefined && onDisk === undefined) files.push(entry('deleted'));
      else if (inHead !== undefined && onDisk !== undefined && hashOf(inHead) !== hashOf(onDisk))
        files.push(entry('modified'));
    }
    return files;
  };

  const hashOf = (file: DemoFile): string =>
    typeof file === 'string' ? textHash(file) : textHash(`${JSON.stringify(file)}`);

  /** Whether a file is still the version the page showed: the text's hash, else the bytes' (both null: deleted). */
  const sameVersion = (
    now: StatusFile | undefined,
    shown: { diskHash?: string | null; diskBytesHash?: string | null },
  ): boolean =>
    (now?.diskHash ?? null) === (shown.diskHash ?? null) &&
    (now?.diskHash != null || (now?.diskBytesHash ?? null) === (shown.diskBytesHash ?? null));

  /** What HEAD holds for a path of the working tree (its old name when renamed). */
  const headFor = (p: Project, path: string): DemoFile | undefined => {
    const from = statusFiles(p).find(f => f.path === path)?.renamedFrom;
    return p.head.get(from ?? path);
  };

  // ---- streams --------------------------------------------------------------------------------------------------

  const cancelled = (signal: AbortSignal | undefined): void => {
    if (signal?.aborted) fail('cancelled', 'cancelled');
  };
  /** Git's and the hooks' output, a line at a time, as the companion streams it (`{text}`, each line with its end). */
  const emitLines = async (
    lines: readonly string[],
    opts: CallOptions<'git.commit'> | CallOptions<'git.push'>,
  ): Promise<string[]> => {
    for (const text of lines) {
      cancelled(opts.signal);
      await wait(120);
      cancelled(opts.signal);
      opts.onStream?.({ text: `${text}\n` } satisfies OutputLine);
    }
    return [...lines];
  };

  // ---- the methods --------------------------------------------------------------------------------------------

  type OpenFileMethod = Extract<Method, `openFile.${string}`> | 'page.activity';
  type Handler<M extends Method> = (params: Params<M>, opts: CallOptions<M>) => Result<M> | Promise<Result<M>>;
  const summaryOf = (p: Project): ProjectSummary => ({
    id: p.seed.id,
    name: p.seed.name,
    displayPath: p.seed.displayPath,
    class: p.class,
    via: p.via,
    location: p.seed.location,
    locationName: locations.find(l => l.displayPath === p.seed.location)?.name ?? null,
    branch: p.seed.branch,
    state: 'open',
  });

  // Files opened from the system (D42) are a companion's only: the demo offers none of their methods.
  const handlers: { [M in Exclude<Method, OpenFileMethod>]: Handler<M> } = {
    'companion.state': () => ({
      companion: 'demo',
      server: { state: 'running', version: 'demo' },
      env: { capturedAt: opened, path: [] },
      paused,
      problems: [],
      deletePolicy: 'trash',
      openFiles: { executes: 'edit' },
    }),
    'projects.list': () => [...projects.values()].filter(p => p.present).map(summaryOf),
    'project.state': ({ project }): ProjectState => {
      const p = projectOf(project);
      return {
        class: p.class,
        via: p.via,
        location: p.seed.location,
        locationName: locations.find(l => l.displayPath === p.seed.location)?.name ?? null,
        branch: p.seed.branch,
        upstream: p.upstream,
        ahead: p.commits.filter(c => !c.pushed).length,
        behind: p.behind,
        detached: false,
        hooks: [...p.seed.hooks],
        hooksPath: p.seed.hooks.length > 0 && [...p.disk.keys()].some(path => path.startsWith('.husky/')),
        historyGaps: p.gaps.map(g => ({ ...g })),
      };
    },
    'locations.list': () =>
      locations.map(l => ({
        ...l,
        projects: [...projects.values()].filter(p => p.present && p.seed.location === l.displayPath).length,
      })),
    // The demo's folders are invented: no path typed on this computer is inside one, and it has no window to ask in —
    // it answers as a companion without its window does, with the command for Terminal.
    'project.requestAdd': ({ path }) => {
      if (typeof path !== 'string' || !path.startsWith('/'))
        fail('invalid-params', 'the path must be absolute', { field: 'path' });
      return fail('confirmation-unavailable', 'the companion has no window to ask in', {
        reason: 'no-window',
        command: `cd ${shellWord(path)} && devtab add`,
      });
    },
    'project.requestMine': ({ project }) => {
      const p = projectOf(project);
      const location = locations.find(l => l.displayPath === p.seed.location);
      if (!location || location.mode !== 'write')
        return fail('confirmation-unavailable', 'outside a trusted folder only the companion’s window can allow it', {
          reason: 'no-window',
          command: `cd ${shellWord(p.seed.displayPath)} && devtab add --write`,
        });
      p.class = 'mine';
      p.via = 'location';
      emit({ name: 'project.changed', project, data: { class: 'mine', via: 'location' } });
      emit({ name: 'projects.changed', project: null, data: {} });
      return { class: 'mine' };
    },
    'project.setView': ({ project }) => {
      const p = projectOf(project);
      if (p.class !== 'mine') fail('not-mine', 'the project is «view» already');
      p.class = 'view';
      // Made read only by the person: a trusted folder does not raise it again.
      p.via = 'person';
      emit({ name: 'project.changed', project, data: { class: 'view', via: 'person' } });
      emit({ name: 'projects.changed', project: null, data: {} });
      return { class: 'view' };
    },
    'project.remove': ({ project }) => {
      projectOf(project).present = false;
      emit({ name: 'projects.changed', project: null, data: {} });
      return {};
    },
    'env.requestCapture': () =>
      fail('confirmation-unavailable', 'the companion has no window to ask in', {
        reason: 'no-window',
        command: 'devtab env capture',
      }),
    'events.subscribe': ({ project }) => (projectOf(project), {}),
    'events.unsubscribe': () => ({}),

    // ---- reading --------------------------------------------------------------------------------------------
    'tree.list': ({ project, path }) => {
      const p = projectOf(project);
      checkPath(path);
      if (isGitPath(path)) fail('protected-path', '.git is not shown', { rule: 'git-dir' });
      const prefix = path === '' ? '' : `${path}/`;
      const children = new Map<string, 'file' | 'dir'>();
      for (const key of p.disk.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf('/');
        children.set(slash < 0 ? rest : rest.slice(0, slash), slash < 0 ? 'file' : 'dir');
      }
      if (path !== '' && children.size === 0) fail('not-found', `no folder ${path}`);
      const entries: TreeEntry[] = [...children]
        .map(([name, kind]): TreeEntry => {
          const full = prefix + name;
          const file = p.disk.get(full);
          const link = file !== undefined && typeof file !== 'string' && 'link' in file ? file.link : null;
          const rule = kind === 'file' ? protectedRule(full) : undefined;
          return {
            name,
            path: full,
            kind: link ? 'symlink' : kind,
            size: kind === 'file' && file !== undefined ? sizeOf(file) : 0,
            mtimeMs: p.mtimes.get(full) ?? opened,
            ignored: isIgnored(p, kind === 'dir' ? `${full}/` : full),
            hidden: name.startsWith('.'),
            link,
            protected: rule !== undefined,
            secret: kind === 'file' && isSecretPath(full),
          };
        })
        .sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name));
      return {
        entries: entries.slice(0, LIMITS.treeEntries),
        truncated: entries.length > LIMITS.treeEntries,
        skippedNames: 0,
      };
    },
    'file.read': ({ project, path }): FileText => {
      const p = projectOf(project);
      checkPath(path);
      if (isGitPath(path)) fail('protected-path', '.git is not read', { rule: 'git-dir' });
      const text = textOf(p.disk.get(path), path);
      return {
        text,
        hash: textHash(text),
        size: sizeOf(text),
        mtimeMs: p.mtimes.get(path) ?? opened,
        encoding: 'utf-8',
        bom: false,
        lineEnding: 'lf',
        large: false,
        secret: isSecretPath(path),
        protected: protectedRule(path) !== undefined,
      };
    },
    'files.find': ({ project, query, limit }) => {
      const p = projectOf(project);
      const wanted = query.toLowerCase().replace(/\s+/g, '');
      const found: FoundFile[] = [];
      for (const path of p.disk.keys()) {
        const match = fuzzy(path, wanted);
        if (match) found.push({ path, ...match, ignored: isIgnored(p, path) });
      }
      return found
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
        .slice(0, Math.min(Math.max(1, limit ?? 100), 100));
    },
    'search.start': async (params, opts) => {
      const p = projectOf(params.project);
      let pattern: RegExp;
      try {
        const source = params.isRegex ? params.pattern : params.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = new RegExp(params.wholeWord ? `\\b(?:${source})\\b` : source, params.caseSensitive ? 'g' : 'gi');
      } catch {
        return fail('invalid-params', 'the pattern is not a regular expression', { field: 'pattern' });
      }
      if (params.pattern === '') fail('invalid-params', 'the pattern is empty', { field: 'pattern' });
      const limit = Math.min(params.maxMatches ?? LIMITS.matches, LIMITS.matches);
      let files = 0;
      let matches = 0;
      let truncated = false;
      for (const [path, file] of [...p.disk].sort(([a], [b]) => a.localeCompare(b))) {
        if (!isText(file) || (!params.includeIgnored && isIgnored(p, path))) continue;
        cancelled(opts.signal);
        await wait(10);
        cancelled(opts.signal);
        const hit: SearchHit = { path, matches: [] };
        file.split('\n').forEach((line, index) => {
          if (truncated) return;
          const ranges: [number, number][] = [];
          for (const m of line.matchAll(pattern)) if (m[0].length > 0) ranges.push([m.index, m.index + m[0].length]);
          if (!ranges.length) return;
          if (matches >= limit) {
            truncated = true;
            return;
          }
          matches++;
          hit.matches.push({ line: index, text: line, ranges });
        });
        if (hit.matches.length) {
          files++;
          opts.onStream?.(hit);
        }
        if (truncated) break;
      }
      return { files, matches, truncated };
    },
    // Whether HEAD can be undone, by the check `git.undoCommit` makes (as the companion says it beforehand).
    'git.status': ({ project }): GitStatus => {
      const p = projectOf(project);
      const last = p.commits.at(-1);
      const reason =
        p.class !== 'mine'
          ? 'not-mine'
          : !last
            ? 'root'
            : last.pushed
              ? 'pushed'
              : p.commits.length === 1
                ? 'root'
                : null;
      return {
        headSha: headSha(p),
        branch: p.seed.branch,
        files: statusFiles(p),
        headUndoable: reason === null,
        headUndoReason: reason,
      };
    },
    'git.identity': ({ project }) => {
      projectOf(project);
      return {
        name: identity?.name ?? null,
        email: identity?.email ?? null,
        signing: { enabled: false, format: null },
      };
    },
    'diff.sides': ({ project, path, base }): DiffSides => {
      const p = projectOf(project);
      checkPath(path);
      const onDisk = p.disk.get(path);
      const status = statusFiles(p).find(f => f.path === path);
      let old: DemoFile | undefined;
      if (typeof base === 'object' && 'point' in base) {
        const found = p.points.find(pt => pt.point === base.point && pt.path === path);
        if (!found || found.text === null) fail('not-found', 'no such point of the history');
        old = found!.text!;
      } else old = headFor(p, path);
      const binary = [old, onDisk].some(f => f !== undefined && typeof f !== 'string');
      const oldText = old === undefined || binary ? '' : textOf(old, path);
      const newText = onDisk === undefined || binary ? '' : textOf(onDisk, path);
      return {
        old: { text: old === undefined || binary ? null : oldText, exists: old !== undefined },
        new: { text: onDisk === undefined || binary ? null : newText, exists: onDisk !== undefined },
        hunks: binary
          ? []
          : lineHunks(oldText, newText).map(({ oldStart, oldLines, start, lines }) => ({
              oldStart,
              oldLines,
              start,
              lines,
            })),
        flags: {
          crlf: false,
          binary,
          renamedFrom: status?.renamedFrom ?? null,
          conflicted: status?.change === 'conflicted',
          utf8: true,
        },
      };
    },
    'git.hunks': ({ project, path }) => {
      const p = projectOf(project);
      checkPath(path);
      const status = statusFiles(p).find(f => f.path === path);
      const inHead = headFor(p, path);
      const onDisk = p.disk.get(path);
      const headHash = inHead === undefined ? null : hashOf(inHead);
      const diskHash = onDisk === undefined ? null : hashOf(onDisk);
      const whole = (reason: 'binary' | 'conflicted' | 'renamed' | 'new-file') => ({
        hunks: [],
        headHash,
        diskHash,
        chunkable: false,
        reason,
      });
      if (status?.change === 'conflicted') return whole('conflicted');
      if (status?.change === 'renamed') return whole('renamed');
      if ([inHead, onDisk].some(f => f !== undefined && typeof f !== 'string')) return whole('binary');
      // Not in HEAD: committed whole, as the companion says it.
      if (inHead === undefined && onDisk !== undefined) return whole('new-file');
      const hunks: ChunkHunk[] = lineHunks(
        (inHead as string | undefined) ?? '',
        (onDisk as string | undefined) ?? '',
      ).map(({ start, lines, oldStart, oldLines }, index) => ({ index, start, lines, oldStart, oldLines }));
      return { hunks, headHash, diskHash, chunkable: true };
    },
    'git.outgoing': ({ project }) => {
      const p = projectOf(project);
      const commits = p.commits
        .filter(c => !c.pushed)
        .reverse()
        .map(c => ({ sha: c.sha, short: c.sha.slice(0, 7), summary: c.summary, author: c.author, timeMs: c.timeMs }));
      return {
        branch: p.seed.branch,
        remote: p.seed.remote,
        upstream: p.upstream,
        setUpstream: p.upstream === null && p.seed.remote !== null,
        commits: commits.slice(0, 100),
        more: commits.length > 100,
        behindAtLastFetch: p.behind,
      };
    },
    'git.messages': ({ project }) => ({ messages: [...projectOf(project).messages] }),

    // ---- writing files --------------------------------------------------------------------------------------
    'file.save': ({ project, path, baseHash, text, session: given }) => {
      const session = given ?? undefined;
      const p = projectOf(project);
      writable(p, path);
      const current = p.disk.get(path);
      const before = textOf(current, path);
      const currentHash = textHash(before);
      if (currentHash !== baseHash) fail('conflict', `${path} changed on disk`, { currentHash });
      if (sizeOf(text) > LIMITS.textBytes)
        fail('too-large', 'the text is larger than the limit', { size: sizeOf(text), limit: LIMITS.textBytes });
      if (session === undefined) point(p, path, 'Before save', before);
      else if (!p.sessions.has(session)) point(p, path, 'Before edit', before);
      else if (p.sessions.get(session) !== currentHash) point(p, path, 'Before save', before);
      setDisk(p, path, text);
      const hash = textHash(text);
      if (session !== undefined) p.sessions.set(session, hash);
      const last = p.points.at(-1);
      // The saves of one editing session are one point: its latest text and time.
      if (session !== undefined && last?.path === path && last.label === 'Saved' && last.session === session) {
        last.timeMs = now();
        last.text = text;
      } else point(p, path, 'Saved', text, session === undefined ? {} : { session });
      changed(project, [path]);
      return { hash, mtimeMs: p.mtimes.get(path)!, protected: protectedRule(path) ?? null };
    },
    'file.create': ({ project, path, text: given }) => {
      const text = given ?? '';
      const p = projectOf(project);
      writable(p, path);
      if (p.disk.has(path) || filesUnder(p.disk, path).length) fail('exists', `${path} exists`);
      // As the companion: the moment before, noted without a text (there was none), then the server's «Saved».
      point(p, path, 'Before create', null);
      setDisk(p, path, text);
      point(p, path, 'Saved', text);
      changed(project, [path]);
      return { hash: textHash(text), protected: protectedRule(path) ?? null };
    },
    'folder.create': ({ project, path }) => {
      const p = projectOf(project);
      writable(p, path);
      if (filesUnder(p.disk, path).length) fail('exists', `${path} exists`);
      // A folder with nothing in it is not kept by the demo's tree of files: it holds a placeholder.
      setDisk(p, `${path}/.gitkeep`, '');
      changed(project, [path]);
      return { protected: protectedRule(`${path}/`) ?? null };
    },
    'file.rename': ({ project, from, to }) => {
      const p = projectOf(project);
      writable(p, from, 'from');
      writable(p, to, 'to');
      const moving = filesUnder(p.disk, from);
      if (!moving.length) fail('not-found', `no ${from}`);
      if (filesUnder(p.disk, to).length) fail('exists', `${to} exists`);
      for (const path of moving) {
        const file = p.disk.get(path)!;
        if (isText(file)) point(p, path, 'Deleted', file);
        setDisk(p, path, null);
        setDisk(p, to + path.slice(from.length), file);
      }
      changed(project, [from, to]);
      return { protected: protectedRule(to) ?? null };
    },
    'file.delete': ({ project, path }) => {
      const p = projectOf(project);
      writable(p, path);
      const going = filesUnder(p.disk, path);
      if (!going.length) fail('not-found', `no ${path}`);
      if (going.length > LIMITS.deleteFiles)
        fail('too-many-files', `${path} holds more files than the limit`, {
          size: going.length,
          limit: LIMITS.deleteFiles,
        });
      for (const file of going) {
        if (isSecretPath(file)) fail('secret-file', `${file} holds secrets: read only from the page`);
      }
      for (const file of going) {
        const was = p.disk.get(file)!;
        if (isText(was)) point(p, file, 'Deleted', was);
        setDisk(p, file, null);
      }
      changed(project, going);
      return { trashed: true, files: going.length };
    },

    // ---- writing git ----------------------------------------------------------------------------------------
    'git.commit': async ({ project, message, selection, runHooks, expect }, opts) => {
      const p = projectOf(project);
      if (p.class !== 'mine') fail('not-mine', 'the project is «view»: the page may not commit');
      if (paused) fail('paused', 'the companion has paused writes');
      if (!selection.length) fail('nothing-selected', 'nothing is checked');
      if (!message.trim()) fail('invalid-params', 'the commit message is empty', { field: 'message' });
      if (!identity) fail('identity-missing', 'git has no user.name or user.email');
      const status = statusFiles(p);
      const stale = expect.files.filter(
        f =>
          !sameVersion(
            status.find(s => s.path === f.path),
            f,
          ),
      );
      if (expect.headSha !== headSha(p) || stale.length)
        fail('stale-selection', 'the files or HEAD changed since they were shown', { paths: stale.map(f => f.path) });
      for (const { path, chunks } of selection) {
        const entry = status.find(s => s.path === path);
        if (!entry) fail('stale-selection', `${path} has no changes`, { paths: [path] });
        if (entry!.change === 'conflicted')
          fail('hunks-unsupported', `${path} has a conflict`, { reason: 'conflicted', path });
        if (chunks) {
          const whole: Record<string, string> = { renamed: 'renamed', deleted: 'deleted', untracked: 'new-file' };
          const reason = whole[entry!.change] ?? (isText(p.disk.get(path)) ? null : 'binary');
          if (reason) fail('hunks-unsupported', `${path} is committed whole`, { reason, path });
        }
      }
      const hooks = runHooks ? p.seed.hooks.filter(h => h === 'pre-commit' || h === 'commit-msg') : [];
      const failure = nextCommitFailure;
      nextCommitFailure = null;
      if (hooks.includes('pre-commit') || (failure && runHooks)) {
        const hook = failure?.hook ?? 'pre-commit';
        if (failure?.code === 'hook-failed') {
          const output = await emitLines(
            failure.output ?? [`${hook}: checking ${selection.length} files…`, `${hook}: 1 problem found`],
            opts,
          );
          fail('hook-failed', `${hook} exited with 1`, { hook, exitCode: 1, output: output.join('\n') });
        }
        if (failure?.code === 'hook-tool-missing') {
          const tool = failure.tool ?? 'npx';
          const output = await emitLines([`${hook}: line 1: ${tool}: command not found`], opts);
          fail('hook-tool-missing', `${hook} did not find ${tool}`, {
            hook,
            tool,
            output: output.join('\n'),
            pathCapturedAt: opened,
          });
        }
        if (failure?.code === 'hook-timeout') {
          await emitLines([`${hook}: running…`], opts);
          fail('hook-timeout', `${hook} ran out of time`, { hook, afterMs: 300_000 });
        }
        await emitLines(
          [`pre-commit: checking ${selection.length} files…`, 'pre-commit: no secrets found', 'pre-commit: passed'],
          opts,
        );
      }
      if (hooks.includes('commit-msg')) await emitLines(['commit-msg: message format ok'], opts);
      cancelled(opts.signal);
      const before = new Map<string, DemoFile | null>();
      const keep = (path: string) => before.has(path) || before.set(path, p.head.get(path) ?? null);
      for (const { path, chunks } of selection) {
        const entry = status.find(s => s.path === path)!;
        if (entry.renamedFrom) {
          keep(entry.renamedFrom);
          p.head.delete(entry.renamedFrom);
        }
        keep(path);
        const onDisk = p.disk.get(path);
        if (onDisk === undefined) p.head.delete(path);
        else if (chunks && isText(onDisk))
          p.head.set(path, applyHunks((headFor(p, path) as string | undefined) ?? '', onDisk, chunks));
        else p.head.set(path, onDisk);
        p.stagedOutside.delete(path);
      }
      const summary = message.trim().split('\n')[0]!;
      const commit: Commit = {
        sha: shaOf(`${project}:${message}`),
        summary,
        message: message.trim(),
        author: identity!.name,
        timeMs: now(),
        pushed: false,
        before,
      };
      p.commits.push(commit);
      p.messages = [commit.message, ...p.messages.filter(m => m !== commit.message)].slice(0, 20);
      // The commit in each file's history, by its summary, as the companion lists commits.
      for (const { path } of selection) {
        const file = p.head.get(path);
        if (isText(file)) point(p, path, summary, file, { source: 'commit' });
      }
      emit({ name: 'git.changed', project, data: {} });
      const skipped = runHooks ? [] : p.seed.hooks.filter(h => h === 'pre-commit' || h === 'commit-msg');
      return { sha: commit.sha, hookChangedCommit: [], changedAfter: [], indexKept: [], hooksSkipped: skipped };
    },
    'git.rollback': ({ project, paths, deleteAdded, expect }) => {
      const p = projectOf(project);
      for (const path of paths) writable(p, path);
      const status = statusFiles(p);
      const stale = expect.files.filter(
        f =>
          !sameVersion(
            status.find(s => s.path === f.path),
            f,
          ),
      );
      if (stale.length)
        fail('stale-selection', 'the files changed since they were shown', { paths: stale.map(f => f.path) });
      const rolledBack: string[] = [];
      const trashed: string[] = [];
      for (const path of paths) {
        const entry = status.find(s => s.path === path);
        if (!entry) continue;
        const current = p.disk.get(path);
        if (isText(current)) point(p, path, 'Before rollback', current);
        if (entry.renamedFrom) {
          setDisk(p, path, null);
          setDisk(p, entry.renamedFrom, p.head.get(entry.renamedFrom)!);
          rolledBack.push(path);
        } else if (p.head.has(path)) {
          setDisk(p, path, p.head.get(path)!);
          rolledBack.push(path);
        } else if (deleteAdded) {
          setDisk(p, path, null);
          trashed.push(path);
        }
        p.stagedOutside.delete(path);
        p.conflicted.delete(path);
      }
      changed(project, [...rolledBack, ...trashed]);
      emit({ name: 'git.changed', project, data: {} });
      return { rolledBack, trashed };
    },
    'git.undoCommit': ({ project, headSha: expected }) => {
      const p = projectOf(project);
      if (p.class !== 'mine') fail('not-mine', 'the project is «view»: the page may not undo a commit');
      const last = p.commits.at(-1);
      if (!last || last.sha !== expected) return fail('undo-unavailable', 'HEAD moved', { reason: 'moved' });
      if (last.pushed) fail('undo-unavailable', 'the commit is pushed', { reason: 'pushed' });
      if (p.commits.length === 1) fail('undo-unavailable', 'the first commit cannot be undone', { reason: 'root' });
      for (const [path, file] of last.before) {
        if (file === null) p.head.delete(path);
        else p.head.set(path, file);
      }
      p.commits.pop();
      emit({ name: 'git.changed', project, data: {} });
      return { message: last.message, paths: [...last.before.keys()] };
    },
    'git.push': async ({ project, expect }, opts) => {
      const p = projectOf(project);
      if (p.class !== 'mine') fail('not-mine', 'the project is «view»: the page may not push');
      if (paused) fail('paused', 'the companion has paused writes');
      const remote = p.seed.remote;
      if (!remote) return fail('push-remote-ambiguous', 'the project has no remote', { remotes: [] });
      if (expect.headSha !== headSha(p) || expect.branch !== p.seed.branch || expect.remote !== remote)
        fail('stale-selection', 'HEAD changed since the push was shown', { paths: [] });
      const going = p.commits.filter(c => !c.pushed);
      const failure = nextPushFailure;
      nextPushFailure = null;
      const target = `${DEMO_REMOTE_HOST}:demo/${p.seed.name}.git`;
      await emitLines([`Enumerating objects: ${going.length * 4 + 1}, done.`], opts);
      if (failure) {
        const messages: Record<PushFailure, [string, Record<string, unknown>]> = {
          'push-rejected': ['the remote branch has commits this one does not', { remote, branch: p.seed.branch }],
          'push-remote-rejected': [
            'the remote refused the push',
            { output: `! [remote rejected] ${p.seed.branch} (protected branch)` },
          ],
          'push-auth-failed': ['git found no credentials for the remote', { remote }],
          'push-needs-input': ['git wanted to ask in a terminal', { command: `git push ${remote} ${p.seed.branch}` }],
          'push-timeout': ['the push ran out of time', { afterMs: 300_000 }],
          'push-network': ['the remote could not be reached', {}],
        };
        const [message, data] = messages[failure];
        fail(failure, message, data);
      }
      await emitLines([`Writing objects: 100% (${going.length * 3}/${going.length * 3}), done.`, `To ${target}`], opts);
      cancelled(opts.signal);
      const setUpstream = p.upstream === null;
      for (const commit of going) commit.pushed = true;
      if (setUpstream) p.upstream = `${remote}/${p.seed.branch}`;
      emit({ name: 'git.changed', project, data: {} });
      return { pushed: going.length, remote, branch: p.seed.branch, setUpstream };
    },

    // ---- history ----------------------------------------------------------------------------------------------
    'history.file': ({ project, path }) => {
      const p = projectOf(project);
      checkPath(path);
      return {
        points: newestFirst(p.points.filter(pt => pt.path === path)).map(toFilePoint),
        gaps: p.gaps.map(g => ({ ...g })),
      };
    },
    'history.project': ({ project, since, cursor, limit }) => {
      const p = projectOf(project);
      const all: (ProjectPoint & { content: boolean })[] = newestFirst(
        p.points.filter(pt => since == null || pt.timeMs >= since),
      ).map(pt => ({
        ...toFilePoint(pt),
        path: pt.path,
      }));
      const from = cursor ? Number(cursor) : 0;
      const size = Math.min(Math.max(1, limit ?? LIMITS.historyPage), LIMITS.historyPage);
      const deleted = [...new Set(p.points.map(pt => pt.path))].filter(path => !p.disk.has(path)).sort();
      return {
        points: all.slice(from, from + size),
        next: from + size < all.length ? String(from + size) : null,
        deleted,
      };
    },
    'history.content': ({ project, point: wanted }) => {
      const p = projectOf(project);
      const found = p.points.find(pt => pt.point === wanted);
      if (!found || found.text === null) return fail('not-found', 'no such point of the history');
      return { text: found.text, secret: isSecretPath(found.path) };
    },
    'history.restore': ({ project, path, point: wanted, currentHash }) => {
      const p = projectOf(project);
      writable(p, path);
      const found = p.points.find(pt => pt.point === wanted && pt.path === path);
      if (!found || found.text === null) return fail('not-found', 'no such point of the history');
      const current = p.disk.get(path);
      const hash = current === undefined ? null : hashOf(current);
      if (hash !== (currentHash ?? null)) fail('conflict', `${path} changed on disk`, { currentHash: hash });
      const before = isText(current) ? point(p, path, 'Before restore', current) : null;
      setDisk(p, path, found.text);
      point(p, path, 'Saved', found.text);
      changed(project, [path]);
      return {
        restored: found.point,
        before: before?.point ?? null,
        hash: textHash(found.text),
        protected: protectedRule(path) ?? null,
      };
    },
    // The demo has no window to ask in: it answers as a companion without its window does, with the command.
    'history.requestPurge': ({ project }) =>
      fail('confirmation-unavailable', 'the companion cannot show its window; run the command in a terminal instead', {
        reason: 'no-window',
        command: `devtab history purge ${shellWord(projectOf(project).seed.displayPath)}`,
      }),
  };

  const toFilePoint = (pt: Point): FilePoint & { content: boolean } => ({
    content: pt.text !== null,
    point: pt.point,
    label: pt.label,
    source: pt.source,
    size: pt.text === null ? 0 : sizeOf(pt.text),
    timeMs: pt.timeMs,
  });

  const controls: DemoControls = {
    changeOnDisk(project, path, text) {
      const p = projectOf(project);
      setDisk(p, path, text);
      if (text !== null) point(p, path, 'External change', text);
      changed(project, [path]);
    },
    failNextCommit(failure) {
      nextCommitFailure = failure;
    },
    failNextPush(code) {
      nextPushFailure = code;
    },
    setIdentity(next) {
      identity = next ? { ...next } : null;
    },
    setPaused(next) {
      paused = next;
      for (const id of projects.keys())
        emit({ name: next ? 'companion.paused' : 'companion.resumed', project: id, data: {} });
      for (const listener of stateListeners) listener(next ? 'paused' : 'ready');
    },
  };

  return {
    name: 'demo',
    controls,
    connect: () => Promise.resolve({ state: paused ? 'paused' : 'ready' }),
    status: () => ({ state: paused ? 'paused' : 'ready', connecting: false }),
    // The demo needs no permission and has no companion to try again.
    requestPermission: () => Promise.resolve(false),
    retry: () => undefined,
    capabilities: () => ({ methods: Object.keys(handlers) as Method[], historyPage: LIMITS.historyPage, demo: true }),
    async call<M extends Method>(method: M, params: Params<M>, opts: CallOptions<M> = {}): Promise<Result<M>> {
      const handler = (handlers as unknown as Record<string, Handler<M> | undefined>)[method];
      if (!handler) return fail('unknown-method', `unknown method ${String(method)}`, { method: String(method) });
      if (typeof params !== 'object' || params === null) fail('invalid-params', 'params must be an object');
      // The page and the demo share no objects: what comes back is a copy, as a message over a port would be.
      const result = await handler(structuredClone(params), opts);
      return structuredClone(result);
    },
    subscribe(project, onEvent) {
      const set = listeners.get(project) ?? new Set();
      set.add(onEvent);
      listeners.set(project, set);
      return () => set.delete(onEvent);
    },
    onState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
      stateListeners.clear();
    },
  };
};

const DAY_MINUTES = 24 * 60;

/** Points newest first; of two at the same time, the one written later. */
const newestFirst = <T extends { timeMs: number }>(points: readonly T[]): T[] =>
  points
    .map((point, index) => ({ point, index }))
    .sort((a, b) => b.point.timeMs - a.point.timeMs || b.index - a.index)
    .map(({ point }) => point);

/** A subsequence match of the query in the path: its score (a match in the file's name and in a row is better). */
const fuzzy = (path: string, query: string): { score: number; indices: number[] } | null => {
  if (!query) return { score: 0, indices: [] };
  const lower = path.toLowerCase();
  const nameStart = path.lastIndexOf('/') + 1;
  const indices: number[] = [];
  let at = 0;
  for (const char of query) {
    const found = lower.indexOf(char, at);
    if (found < 0) return null;
    indices.push(found);
    at = found + 1;
  }
  let score = 0;
  indices.forEach((index, i) => {
    if (index >= nameStart) score += 2;
    if (i > 0 && indices[i - 1] === index - 1) score += 3;
    if (index === nameStart || path[index - 1] === '/' || path[index - 1] === '-' || path[index - 1] === '_')
      score += 4;
  });
  return { score: score - path.length / 100, indices };
};
