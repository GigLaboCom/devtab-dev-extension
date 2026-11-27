#!/usr/bin/env node
// Every default of the product, read from the code itself — the settings' default objects, the start page's part
// definitions, the shortcut actions and their default keys per platform, the composition roots, the tools' definitions,
// the limits and budgets — and printed as the tables of the defaults document (the developer documents' defaults.md),
// so that document is this output plus its hand-written columns, and re-running it shows whether the document is stale.
// The script reads code only (it never reads docs/).
//
// Usage: node scripts/defaults.mjs [--json]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fromExtension = createRequire(join(ROOT, 'extension/package.json'));
const esbuild = createRequire(fromExtension.resolve('vite'))('esbuild');
const at = path => JSON.stringify(join(ROOT, path));
const src = text => readFileSync(join(ROOT, text), 'utf8');

/** Bundles a TypeScript entry of the workspace (with `@src/…` and the tools' catalogue) and imports its default export. */
const load = async (entry, catalogue = []) => {
  const { outputFiles } = await esbuild.build({
    stdin: { contents: entry, resolveDir: join(ROOT, 'extension'), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    absWorkingDir: join(ROOT, 'extension'),
    plugins: [
      {
        name: 'workspace',
        setup(build) {
          build.onResolve({ filter: /^@src\// }, args => {
            const path = join(ROOT, 'extension/src', args.path.slice(5));
            // A folder is its index.ts (`@src/licence`, a composition root).
            if (existsSync(join(path, 'index.ts'))) return { path: join(path, 'index.ts') };
            return { path: path.replace(/(\.tsx?)?$/, m => m || '.ts') };
          });
          build.onResolve({ filter: /^virtual:tool-catalogue$/ }, () => ({ path: 'catalogue', namespace: 'virtual' }));
          build.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({
            contents: `export const CATALOGUE = ${JSON.stringify(catalogue)};`,
            loader: 'js',
          }));
          // Lazy imports (a part's code, a component) are not followed: the defaults are in the definitions.
          build.onResolve({ filter: /.*/ }, args =>
            args.kind === 'dynamic-import' ? { path: args.path, external: true } : undefined,
          );
        },
      },
    ],
  });
  const dir = mkdtempSync(join(tmpdir(), 'defaults-'));
  try {
    const file = join(dir, 'entry.mjs');
    writeFileSync(file, outputFiles[0].text);
    return (await import(pathToFileURL(file).href)).default;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// The tools: each definition, bundled on its own (the catalogue plugin's way).
const toolDirs = readdirSync(join(ROOT, 'packages/tools/ui'), { withFileTypes: true })
  .filter(e => e.isDirectory() && existsSync(join(ROOT, 'packages/tools/ui', e.name, 'src/definition.ts')))
  .map(e => e.name);
const tools = [];
for (const id of toolDirs) {
  const d = await load(
    `import { definition } from ${at(`packages/tools/ui/${id}/src/definition.ts`)};
     export default { ...definition, load: undefined };`,
  );
  if (d) tools.push({ ...d, detects: existsSync(join(ROOT, 'packages/tools/ui', id, 'src/detect.ts')) });
}
tools.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
const catalogue = tools.map(({ id, title, keywords, shortcut }) => ({
  id,
  title,
  keywords,
  ...(shortcut ? { shortcut } : {}),
}));

const code = await load(
  `
  import { DEFAULT_SETTINGS, SETTINGS_KEY, SHORTCUTS_KEY, RECENT_KEY, START_CACHE_KEY, MAX_SHORTCUTS, MAX_RECENT } from ${at('extension/src/start/settings.ts')};
  import { START_PARTS } from ${at('extension/src/start/parts/index.ts')};
  import { MAX_TILES } from ${at('extension/src/start/tileSources.ts')};
  import { DEFAULT_PREF, THEME_STORAGE_KEY } from '@extension/theme';
  import { DEFAULT_SHELL, SHELL_KEY, SHELL_CACHE_KEY } from ${at('extension/src/shell/settings.ts')};
  import { shortcutActions, suggestedKeys } from ${at('extension/src/shortcuts/actions.ts')};
  import { resolveBindings, DEFAULT_SHORTCUTS } from ${at('extension/src/shortcuts/bindings.ts')};
  import { SHORTCUT_KEYS_KEY } from ${at('extension/src/shortcuts/store.ts')};
  import { DESTINATIONS } from ${at('extension/src/shared/destinations.ts')};
  import { TOOL_CATALOGUE } from ${at('extension/src/tools/catalogue.ts')};
  import { DEFAULT_HISTORY_SETTINGS, HISTORY_SETTINGS_KEY, RETENTION_DAYS, BUDGET_MIB, IDLE_LOCK_MINUTES } from ${at('extension/src/history/settings.ts')};
  import { DEFAULT_MAX_BLOB_BYTES, IDLE_MS, MIN_GAP_MS, SESSION_IDLE_MS, LABEL_MAX, TEXT_MAX } from ${at('packages/tools/logic/shared/history/factory.ts')};
  import { TOOL_SETTINGS_KEY } from ${at('extension/src/tools/settings.ts')};
  import { AUTO_COPY } from ${at('packages/tools/ui/host/lib/autoCopy.ts')};
  import { SAVE_AFTER_MS, SAVED_PARAMETERS_MAX_CHARS, WRITE_ATTEMPTS } from ${at('packages/tools/ui/host/lib/settings.ts')};
  import { editionSource } from ${at('extension/src/edition/index.ts')};
  import { editionFor } from ${at('extension/src/edition/inForce.ts')};
  import { MAX_BYTES as COMPARE_MAX_BYTES } from ${at('extension/src/compare/files.ts')};
  import { toolbarButton, pageOpener } from ${at('extension/src/toolbar/index.ts')};
  import { newTab } from ${at('extension/src/newTab/index.ts')};
  import { optionsPage } from ${at('extension/src/options/index.ts')};
  import { planSource } from ${at('extension/src/plans/index.ts')};
  import { licence } from ${at('extension/src/licence/index.ts')};
  import * as PANELS from ${at('extension/src/projects/layout.ts')};
  import { LAYOUT_KEY, LAYOUT_CACHE_KEY } from ${at('extension/src/projects/layoutMemory.ts')};
  import { AUTOSAVE_DELAY_MS } from ${at('extension/src/projects/autosave.ts')};
  import { SCRATCH_MAX_COUNT, SCRATCH_MAX_CHARS, SCRATCH_NAME_MAX, SCRATCH_DEFAULT_NAME, SCRATCH_DEFAULT_LANGUAGE } from ${at('extension/src/projects/scratch/store.ts')};
  import { SCRATCHES_KEY, SCRATCH_TEXT_PREFIX } from ${at('extension/src/projects/scratch/storage.ts')};
  import { LANGUAGES, labelOf } from ${at('extension/src/compare/languages.ts')};
  const actions = shortcutActions(DESTINATIONS, suggestedKeys(TOOL_CATALOGUE));
  const resolved = mac => {
    const r = resolveBindings(actions, DEFAULT_SHORTCUTS, mac);
    return Object.fromEntries(actions.map(a => [a.id, r.bindings.get(a.id) ?? null]));
  };
  export default {
    start: { settings: DEFAULT_SETTINGS, keys: { SETTINGS_KEY, SHORTCUTS_KEY, RECENT_KEY, START_CACHE_KEY }, MAX_SHORTCUTS, MAX_RECENT, MAX_TILES,
      parts: START_PARTS.map(p => ({ id: p.id, kind: p.kind, title: p.title, defaultOn: p.defaultOn, loadAt: p.loadAt,
        optional: p.permissions.filter(q => q.optional).map(q => q.name), required: p.permissions.filter(q => !q.optional).map(q => q.name) })) },
    theme: { pref: DEFAULT_PREF, key: THEME_STORAGE_KEY },
    shell: { settings: DEFAULT_SHELL, key: SHELL_KEY, cache: SHELL_CACHE_KEY },
    shortcuts: { key: SHORTCUT_KEYS_KEY, actions: actions.map(a => ({ id: a.id, title: a.title, group: a.group })), mac: resolved(true), other: resolved(false) },
    history: { settings: DEFAULT_HISTORY_SETTINGS, key: HISTORY_SETTINGS_KEY, choices: { RETENTION_DAYS, BUDGET_MIB, IDLE_LOCK_MINUTES },
      factory: { DEFAULT_MAX_BLOB_BYTES, IDLE_MS, MIN_GAP_MS, SESSION_IDLE_MS, LABEL_MAX, TEXT_MAX } },
    toolSettings: { key: TOOL_SETTINGS_KEY, autoCopy: AUTO_COPY, saveAfterMs: SAVE_AFTER_MS, maxChars: SAVED_PARAMETERS_MAX_CHARS, writeAttempts: WRITE_ATTEMPTS,
      // Does the storage of the edition a fixed source names keep the parameters between uses? A licensed source has
      // no edition until it has read the licence (null). (Nothing of the browser is touched to ask.)
      keeps: editionSource.id === 'licensed' ? null : editionFor({ kind: 'fixed', edition: editionSource.id === 'fixedPro' ? 'pro' : 'free' }).parameters({ area: {}, onChanged: {} }).keeps },
    compare: { maxBytes: COMPARE_MAX_BYTES },
    panels: { layout: PANELS.DEFAULT_LAYOUT, key: LAYOUT_KEY, cache: LAYOUT_CACHE_KEY, SIDE_MIN: PANELS.SIDE_MIN, SIDE_MAX: PANELS.SIDE_MAX,
      BOTTOM_MIN: PANELS.BOTTOM_MIN, BOTTOM_MAX: PANELS.BOTTOM_MAX, EDITOR_MIN_WIDTH: PANELS.EDITOR_MIN_WIDTH, EDITOR_MIN_HEIGHT: PANELS.EDITOR_MIN_HEIGHT,
      NARROW_BELOW: PANELS.NARROW_BELOW, RESIZE_STEP: PANELS.RESIZE_STEP, RESIZE_STEP_LARGE: PANELS.RESIZE_STEP_LARGE },
    scratches: { MAX_COUNT: SCRATCH_MAX_COUNT, MAX_CHARS: SCRATCH_MAX_CHARS, NAME_MAX: SCRATCH_NAME_MAX, name: SCRATCH_DEFAULT_NAME,
      language: labelOf(SCRATCH_DEFAULT_LANGUAGE), languages: LANGUAGES.filter(l => l.id !== 'text').length, key: SCRATCHES_KEY, textPrefix: SCRATCH_TEXT_PREFIX,
      autosaveMs: AUTOSAVE_DELAY_MS, inPro: editionFor({ kind: 'fixed', edition: 'pro' }).scratches, inFree: editionFor({ kind: 'fixed', edition: 'free' }).scratches },
    roots: { toolbarButton: toolbarButton.id, newTab: newTab.id, optionsPage: optionsPage.id, pageOpener: pageOpener.id ?? null, editionSource: editionSource.id, planSource: planSource.id, licence: licence.id },
  };
`,
  catalogue,
);

/** The one line of each composition root that picks an implementation: `export { x as y }` and the implementations it imports. */
const ROOT_FILES = [
  'extension/src/toolbar/index.ts',
  'extension/src/newTab/index.ts',
  'extension/src/options/index.ts',
  'extension/src/edition/index.ts',
  'extension/src/licence/index.ts',
  'extension/src/plans/index.ts',
  'extension/src/highlighter/index.ts',
  'extension/src/start/behaviors.ts',
  'extension/src/start/parts/index.ts',
  'extension/src/shell/behaviors.ts',
  'extension/src/compare/behaviors.ts',
  'extension/src/history/behaviors.ts',
  'extension/src/projects/behaviors.ts',
];
const picks = ROOT_FILES.map(file => ({
  file,
  lines: src(file)
    .split('\n')
    .filter(l => /^export \{ \w+ as \w+ \}|^import \{[^}]+\} from '\.\.?\//.test(l) && !/^import type/.test(l)),
}));

// The editor's highlighter as its root names it (the root imports the module's build, which is not bundled here).
const highlighter = /^export \{ (\w+) as highlighter \}/m.exec(src('extension/src/highlighter/index.ts'))?.[1] ?? null;

const budget = (file, name) => Number(new RegExp(`${name}\\s*=\\s*([\\d_]+)`).exec(src(file))?.[1].replaceAll('_', ''));
const budgets = {
  startRoute: budget('scripts/validate-build.sh', 'START_ROUTE_BUDGET'),
  popup: budget('scripts/validate-build.sh', 'POPUP_BUDGET'),
  firstPaint: budget('scripts/e2e-start.mjs', 'FIRST_PAINT_BUDGET'),
  fieldReady: budget('scripts/e2e-start.mjs', 'READY_BUDGET'),
  popupPaint: budget('scripts/e2e-toolbar.mjs', 'POPUP_PAINT_BUDGET'),
  perTool: budget('scripts/start-route-growth.mjs', 'PER_TOOL_LIMIT'),
  companionRetry: budget('extension/src/projects/connection.ts', 'RETRY_MS'),
  companionHandshake: budget('extension/src/projects/companion/client.ts', 'HANDSHAKE_MS'),
  companionReconnect: (/RECONNECT_MS[^=]*=\s*\[([^\]]*)\]/.exec(src('extension/src/projects/connection.ts'))?.[1] ?? '')
    .split(',')
    .map(v => Number(v.trim().replaceAll('_', '')))
    .filter(v => !Number.isNaN(v)),
};

const state = (() => {
  try {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT }).toString().trim() !== '';
    return `${head}${dirty ? ' + uncommitted changes' : ''}`;
  } catch {
    return 'unknown';
  }
})();

const result = { generated: new Date().toISOString().slice(0, 10), state, ...code, tools, picks, budgets };
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

// The tables, in the document's form (Markdown; the hand-written columns are left to the document).
const keyName = chord => {
  const k = chord.code?.replace(/^Key|^Digit/, '') ?? chord.key;
  const named = { Comma: ',', Period: '.', Slash: '/', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return named[k] ?? (k.length === 1 ? k.toUpperCase() : k);
};
const chordLabel = (chord, mac) => {
  if (!chord) return '—';
  if (mac) return `${chord.alt ? '⌥' : ''}${chord.shift ? '⇧' : ''}${chord.mod ? '⌘' : ''}${keyName(chord)}`;
  return [chord.mod && 'Ctrl', chord.alt && 'Alt', chord.shift && 'Shift', keyName(chord)].filter(Boolean).join('+');
};
const row = cells => `| ${cells.join(' | ')} |`;
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
const yes = v => (v ? 'да' : 'нет');
const out = [];
const h = text => out.push(`\n### ${text}\n`);

out.push(`<!-- node scripts/defaults.mjs — ${result.generated}, ${result.state} -->`);
h('Новая вкладка и стартовая страница');
out.push(
  table(
    ['Что', 'По умолчанию', 'Хранится'],
    [
      [
        'Что открывает новая вкладка',
        `\`${code.start.settings.newTab}\``,
        `\`${code.start.keys.SETTINGS_KEY}.newTab\``,
      ],
      [
        'Порядок строк',
        code.start.settings.order.length ? code.start.settings.order.join(', ') : 'порядок корня сборки',
        `\`${code.start.keys.SETTINGS_KEY}.order\``,
      ],
      ['Ярлыки, не больше', String(code.start.MAX_SHORTCUTS), `\`${code.start.keys.SHORTCUTS_KEY}\``],
      ['Недавние места, не больше', String(code.start.MAX_RECENT), `\`${code.start.keys.RECENT_KEY}\``],
      ['Плиток в строке, не больше', String(code.start.MAX_TILES), '—'],
    ],
  ),
);
h('Части стартовой страницы (в порядке корня сборки `extension/src/start/parts/index.ts`)');
out.push(
  table(
    ['id', 'Название', 'Вид', 'Включена', 'Код грузится', 'Разрешения'],
    code.start.parts.map(p => [
      `\`${p.id}\``,
      p.title,
      p.kind === 'row' ? 'строка' : 'настройка',
      yes(p.defaultOn),
      p.loadAt === 'start' ? 'сразу' : 'после первой отрисовки',
      [...p.required.map(n => `${n} (обяз.)`), ...p.optional.map(n => `${n} (необяз.)`)].join(', ') || '—',
    ]),
  ),
);
h('Тема');
out.push(
  table(
    ['Что', 'По умолчанию', 'Хранится'],
    [
      ['Режим', `\`${code.theme.pref.mode}\``, `\`${code.theme.key}.mode\``],
      ['Светлая тема', `\`${code.theme.pref.light}\``, `\`${code.theme.key}.light\``],
      ['Тёмная тема', `\`${code.theme.pref.dark}\``, `\`${code.theme.key}.dark\``],
    ],
  ),
);
h('Оболочка');
out.push(
  table(
    ['Что', 'По умолчанию', 'Хранится'],
    [
      [
        'Группа Tools в боковой панели',
        Object.keys(code.shell.settings.open).length
          ? JSON.stringify(code.shell.settings.open)
          : 'закрыта; открывается сама на странице инструмента',
        `\`${code.shell.key}.open\``,
      ],
      ['Хлебные крошки', yes(code.shell.settings.breadcrumb), `\`${code.shell.key}.breadcrumb\``],
    ],
  ),
);
h('Projects: панели вокруг редактора (D35)');
const pl = code.panels;
const viewName = { files: 'Files', commit: 'Commit', history: 'History', find: 'Find in files' };
out.push(
  table(
    ['Что', 'По умолчанию', 'Пределы', 'Хранится'],
    [
      [
        'Боковая панель',
        `${pl.layout.side.open ? 'открыта' : 'свёрнута'}, вид ${viewName[pl.layout.side.view]}`,
        `уже ${pl.NARROW_BELOW} px места при входе — свёрнута на этот вход`,
        `\`${pl.key}.side.open\`, \`.view\``,
      ],
      [
        'Ширина боковой панели',
        `${pl.layout.side.width} px`,
        `${pl.SIDE_MIN}–${pl.SIDE_MAX} px; редактору — не меньше ${pl.EDITOR_MIN_WIDTH} px`,
        `\`${pl.key}.side.width\``,
      ],
      [
        'Нижняя панель',
        `${pl.layout.bottom.open ? 'открыта' : 'свёрнута'}, вид ${viewName[pl.layout.bottom.view]}`,
        '—',
        `\`${pl.key}.bottom.open\`, \`.view\``,
      ],
      [
        'Высота нижней панели',
        `${pl.layout.bottom.height} px`,
        `${pl.BOTTOM_MIN}–${pl.BOTTOM_MAX} px; редактору — не меньше ${pl.EDITOR_MIN_HEIGHT} px`,
        `\`${pl.key}.bottom.height\``,
      ],
      [
        'Шаг границы с клавиатуры',
        `${pl.RESIZE_STEP} px, с Shift — ${pl.RESIZE_STEP_LARGE} px`,
        'Home / End — до предела',
        '—',
      ],
    ],
  ),
);
out.push(
  `\nХранится в \`chrome.storage.local\` (\`${pl.key}\`), одна запись на расширение, не на проект; копия для первой отрисовки — \`localStorage\` (\`${pl.cache}\`).`,
);
h('Projects: скретч-файлы (D34)');
const sc = code.scratches;
out.push(
  table(
    ['Что', 'По умолчанию', 'Пределы', 'Хранится'],
    [
      [
        'Где',
        'группа «Scratches» на главной раздела, рядом со списком проектов; без компаньона, в любом состоянии подключения',
        '—',
        '—',
      ],
      [
        'Язык нового скретча',
        `окошко выбора языка (D38): «New scratch…» или сочетание с любой нашей страницы; предложен и выбран ${sc.language}, дальше — язык последнего созданного; фильтр, ↑ / ↓, Enter, Escape`,
        `все языки редактора: ${sc.languages} и Plain text, список «Compare code»`,
        `\`${sc.key}.lastLanguage\``,
      ],
      [
        'Имя нового скретча',
        `\`${sc.name}.<расширение>\`, если занято — \`${sc.name}_1\`, \`${sc.name}_2\`, …; открывается сразу`,
        `имя без расширения — до ${sc.NAME_MAX} знаков`,
        `\`${sc.key}.items[].name\``,
      ],
      [
        'Расширение',
        'первое расширение языка; смена языка меняет его, расширение известного языка в новом имени меняет язык',
        '—',
        '—',
      ],
      ['Число скретчей', '—', `не больше ${sc.MAX_COUNT}`, `\`${sc.key}.items\``],
      [
        'Длина текста скретча',
        '—',
        `не больше ${sc.MAX_CHARS.toLocaleString('ru-RU')} единиц UTF-16`,
        `\`${sc.textPrefix}<id>\``,
      ],
      [
        'Запись',
        `через ${sc.autosaveMs} мс после последней правки, сразу при уходе и по ⌘S`,
        'отказ — одной строкой, сохранённое остаётся',
        '—',
      ],
      [
        'Скачивание',
        'Save as через выбор файла браузера, без него — загрузка; имя — имя скретча с расширением',
        '—',
        '—',
      ],
      ['Удаление', 'спрашивает', '—', '—'],
      [
        'Издание',
        `Pro — ${sc.inPro ? 'есть' : 'нет'}, free — ${sc.inFree ? 'есть' : 'нет'} (решает владелец: \`scratches\` в \`extension/src/edition/pro.ts\`, \`free.ts\`)`,
        '—',
        '—',
      ],
    ],
  ),
);
out.push(
  `\nХранится в \`chrome.storage.local\`: список — \`${sc.key}\`, текст каждого — \`${sc.textPrefix}<id>\`; не синхронизируется между вкладками, последняя запись выигрывает.`,
);
h('Сочетания клавиш (сочетания приложения, по умолчанию)');
out.push(
  table(
    ['Действие', 'Группа', 'macOS', 'Windows / Linux'],
    code.shortcuts.actions.map(a => [
      `${a.title} (\`${a.id}\`)`,
      a.group,
      chordLabel(code.shortcuts.mac[a.id], true),
      chordLabel(code.shortcuts.other[a.id], false),
    ]),
  ),
);
h('История инструментов');
const hs = code.history.settings;
out.push(
  table(
    ['Что', 'По умолчанию', 'Варианты', 'Хранится'],
    [
      ['История', hs.on ? 'включена' : 'выключена', 'вкл / выкл', `\`${code.history.key}.on\``],
      [
        'Срок',
        `${hs.retentionDays} дней`,
        code.history.choices.RETENTION_DAYS.join(', '),
        `\`${code.history.key}.retentionDays\``,
      ],
      [
        'Бюджет',
        `${hs.budgetMiB} МиБ`,
        code.history.choices.BUDGET_MIB.join(', '),
        `\`${code.history.key}.budgetMiB\``,
      ],
      [
        'Запирание после простоя',
        `${hs.idleLockMinutes} мин`,
        code.history.choices.IDLE_LOCK_MINUTES.join(', '),
        `\`${code.history.key}.idleLockMinutes\``,
      ],
      ['Выключены для инструментов', hs.off.length ? hs.off.join(', ') : 'ни один', '—', `\`${code.history.key}.off\``],
      ['Мастер-пароль', 'не задан', '—', 'связки ключей в базе истории'],
      ['Предел одного блоба', `${code.history.factory.DEFAULT_MAX_BLOB_BYTES / 1024 / 1024} МиБ`, '—', '—'],
      [
        'Снимок ввода',
        `после ${code.history.factory.IDLE_MS / 1000} с покоя, не чаще раза в ${code.history.factory.MIN_GAP_MS / 1000} с`,
        '—',
        '—',
      ],
      ['Сессия кончается', `после ${code.history.factory.SESSION_IDLE_MS / 60000} мин паузы`, '—', '—'],
    ],
  ),
);
h('Настройки инструментов');
out.push(
  table(
    ['Что', 'По умолчанию', 'Хранится'],
    [
      [
        'Copy automatically after generating',
        'выключено',
        `\`${code.toolSettings.key}\` (\`all.${code.toolSettings.autoCopy}\`, \`tools.<id>.${code.toolSettings.autoCopy}\`)`,
      ],
      [
        'Сохранённые параметры инструментов (D21)',
        `Pro — последний выбор человека, free — умолчания при каждом открытии (источник издания: \`${code.roots.editionSource}\`; хранилище параметров сохраняет: ${code.toolSettings.keeps === null ? 'по состоянию лицензии' : code.toolSettings.keeps ? 'да' : 'нет'}); запись — через ${code.toolSettings.saveAfterMs} мс после последней правки, не больше ${code.toolSettings.maxChars} знаков JSON на инструмент, при конфликте — до ${code.toolSettings.writeAttempts} попыток`,
        `Pro (шов \`ParameterStorage\`, локальная реализация): \`${code.toolSettings.key}\` (\`params.<id>\` = \`{ schema, values }\`); free (хранение выключено): нигде, выбор живёт в памяти страницы`,
      ],
    ],
  ),
);
h('Корни сборки (что выбрано)');
out.push(
  table(
    ['Корень', 'Строки выбора'],
    picks.map(p => [`\`${p.file}\``, p.lines.map(l => `\`${l.trim()}\``).join('<br>') || '—']),
  ),
);
out.push(
  `\nВыбрано: кнопка на панели — \`${code.roots.toolbarButton}\`, подмена новой вкладки — \`${code.roots.newTab}\`, страница настроек — \`${code.roots.optionsPage}\`, как кнопка открывает нашу страницу — \`${code.roots.pageOpener}\`, источник издания — \`${code.roots.editionSource}\`, конфигурация лицензии — \`${code.roots.licence}\`, источник планов — \`${code.roots.planSource}\`, подсветка редактора — \`${highlighter}\`.`,
);
h('Инструменты');
out.push(
  table(
    ['id', 'Название', '№', 'detect', 'Сочетание', 'Результат', 'История: виды (секретные — *)'],
    tools.map(t => [
      `\`${t.id}\``,
      t.title,
      String(t.order),
      yes(t.detects),
      t.shortcut ? JSON.stringify(t.shortcut) : 'нет',
      t.output.origin === 'generated' ? `создаётся (${t.output.copies}), автокопия применима` : 'из ввода',
      t.history ? t.history.kinds.map(k => `${k.id}${k.secret ? '*' : ''}`).join(', ') || 'ничего' : 'ничего',
    ]),
  ),
);
h('Пределы инструментов (числа из их логики)');
const LIMIT =
  /^export const ((?:MAX|LIVE|MIN|SETTLE|DEBOUNCE|DEFAULT_CHUNK|WORD_LIST_SIZE|TIMEOUT|LONG_TIMEOUT)[A-Z_]*) = ([\d\s*+_().-]+);/gm;
const limitsIn = (text, suffix = '') =>
  [...text.matchAll(LIMIT)].map(
    m => `${m[1]} = ${Number(Function(`return ${m[2].replaceAll('_', '')}`)()).toLocaleString('en-US')}${suffix}`,
  );
const limits = tools.map(t => {
  const dir = join(ROOT, 'packages/tools/logic', t.id, 'src');
  const sources = existsSync(dir)
    ? readdirSync(dir)
        .filter(f => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
        .map(f => readFileSync(join(dir, f), 'utf8'))
    : [];
  // A limit of a shared module the tool's logic imports by name (the JSON scanner's MAX_DEPTH) is the tool's too.
  const shared = [
    ...new Set(
      sources.flatMap(text => [...text.matchAll(/from '@workspace\/tools-shared\/([a-z-]+)'/g)].map(m => m[1])),
    ),
  ]
    .filter(name => existsSync(join(ROOT, 'packages/tools/logic/shared', `${name}.ts`)))
    .flatMap(name => {
      const own = sources.join('\n');
      return limitsIn(src(`packages/tools/logic/shared/${name}.ts`), ` (общий \`${name}\`)`).filter(line =>
        new RegExp(`\\b${line.split(' ')[0]}\\b`).test(own),
      );
    });
  const found = [...sources.flatMap(text => limitsIn(text)), ...shared];
  return [`\`${t.id}\``, found.join('<br>') || '—'];
});
out.push(table(['Инструмент', 'Константы'], limits));
h('Пределы и бюджеты');
out.push(
  table(
    ['Что', 'Число', 'Где держится'],
    [
      ['Стартовый маршрут до первой отрисовки', `${budgets.startRoute} байт`, '`scripts/validate-build.sh`, Check 15'],
      [
        'Рост стартового маршрута на инструмент',
        `≤ ${budgets.perTool} байт, только запись каталога`,
        '`scripts/start-route-growth.mjs`',
      ],
      ['Меню под кнопкой', `${budgets.popup} байт`, '`scripts/validate-build.sh`, Check 16'],
      ['Первая отрисовка новой вкладки, p90 из 20', `${budgets.firstPaint} мс`, '`scripts/e2e-start.mjs`'],
      ['Готовность поля, p90 из 20', `${budgets.fieldReady} мс`, '`scripts/e2e-start.mjs`'],
      ['Первая отрисовка меню, p90 из 10', `${budgets.popupPaint} мс`, '`scripts/e2e-toolbar.mjs`'],
      [
        'Файл одной стороны «Compare code»',
        `${code.compare.maxBytes / 1024 / 1024} МБ`,
        '`extension/src/compare/files.ts`',
      ],
      [
        'Projects: повтор, пока компаньон «не запущен»',
        `раз в ${budgets.companionRetry / 1000} с`,
        '`extension/src/projects/connection.ts`',
      ],
      [
        'Projects: новые попытки после обрыва порта',
        `через ${budgets.companionReconnect.join(', ')} мс, затем «не запущен»`,
        '`extension/src/projects/connection.ts`',
      ],
      [
        'Projects: рукопожатие с компаньоном',
        `≤ ${budgets.companionHandshake / 1000} с`,
        '`extension/src/projects/companion/client.ts`',
      ],
      [
        'Подпись / текст записи истории',
        `${code.history.factory.LABEL_MAX} / ${code.history.factory.TEXT_MAX} знаков`,
        '`packages/tools/logic/shared/history/factory.ts`',
      ],
    ],
  ),
);
process.stdout.write(`${out.join('\n')}\n`);
