# @workspace/dna — стиль продукта: токены, база, компоненты, рамка, линт

Один пакет стиля для расширения и, позже, для сайта продукта. Устройство взято у пакета `dna` второго
образца (токены и база, слой готовых частей, рамка страницы расширения, `tokens.json`, правила линта,
тесты, этот README с контрактом), содержимое своё:

- **токены** — переменные shadcn/ui со значениями из тем gpui-kit (D9, `docs/theming.md`);
- **вид компонентов** — стиль shadcn `nova`, подогнанный под замеры gpui-kit (D10,
  `docs/theming-components.md`): эталон — gpui-kit, подстраивается shadcn.

Имя продукта не утверждено (Q6) и в пакет не входит: ни в имена файлов, ни в классы, ни в токены.

## Файлы

| Файл | Что | Кто пишет |
|---|---|---|
| `themes.css` | 30 тем gpui-kit, прошедших правило контраста: блок `[data-theme="<id>"]` на тему, 115 переменных — 31 токен shadcn, состояния и поверхности gpui-kit (`--primary-hover`, `--button-*`, `--list-*`, `--tab-*`, `--scrollbar-*`, `--status-*`…), ступени радиуса `--radius-sm/md/lg/xl`, `color-scheme` | **сгенерирован**, руками не править |
| `themes.index.json` | список этих тем: `id`, имя gpui-kit, семейство, режим, файл темы, три цвета образца | **сгенерирован** |
| `theme.css` | подключает `themes.css` и `fonts.css`; токены, которых нет в темах (шрифты и шкала текста, радиусы выше `xl`, размеры, тени, фокус, движение, disabled), и база в `@layer base` (`body`, код, `::selection`, ссылки, `:focus-visible`, тонкие системные полосы прокрутки, «уменьшить движение») | руками |
| `fonts.css`, `fonts/` | IBM Plex Sans 400/500/600 и IBM Plex Mono 400, woff2, лицензия OFL | руками (см. «Шрифты») |
| `tailwind.css` | мост в Tailwind v4: свои варианты (`dark`, состояния Radix `data-open` и т. д.), сброс палитры и шкал Tailwind, `@theme inline reference` — каждая утилита читает переменную темы | руками; тест сверяет с темами |
| `style-gpui.css` | **слой компонентов**: правила `cn-*` стиля shadcn с числами gpui-kit, в `@layer components` | руками |
| `upstream/style-nova.css` | исходный стиль `nova` (shadcn-ui/ui `e62c9435`, MIT, `upstream/LICENSE-shadcn.md`) — без изменений, для сравнения с `style-gpui.css` | не править |
| `ui.css` | **рамка страницы расширения**: `kit-shell`, `kit-sidebar*`, `kit-nav*`, `kit-main`, `kit-section*` | руками |
| `tokens.json` | все токены: `themes.<id>.tokens` и `base` | **выводится** из CSS (`pnpm --filter @workspace/dna tokens`) |
| `lint/rules.ts` | контракт в коде: `lintCss`, `lintInlineStyles`, `lintHtml`, `TOKENS`, `COLOR_NAMES` | руками |
| `scripts/tokens.mjs`, `scripts/sync-themes.mjs` | вывод `tokens.json`; перенос сгенерированной половины из выгрузки | руками |
| `tests/` | `tokens.test.ts` (tokens.json = CSS, индекс = темы, мост = токены, шрифты), `rules.test.ts` (каждое правило срабатывает; `ui.css` и `style-gpui.css` чисты), `compile.test.ts` (пакет собирается Tailwind v4, палитры Tailwind нет) | руками |

Префиксы: `cn-*` — классы частей компонентов shadcn (это соглашение самого shadcn: так их называют его
стили, и `style-gpui.css` остаётся в формате стиля shadcn); `kit-*` — свои классы пакета (рамка и
строки списка, которых в shadcn нет). Свои переменные страниц — со своим префиксом (`own` у линта).

## Контракт

**Цвет — только токен.** Ни hex, ни `rgb()`/`oklch()`, ни именованного цвета, ни палитры Tailwind
(`red-500`, `white`). Цвет утилиты — имя цветового токена (`bg-primary-hover`, `text-tab-foreground`).
Прозрачность — модификатором (`bg-accent/70`) или `color-mix(…, transparent)`: так gpui-kit сам делает
`opacity()`. Поэтому любая из 30 тем перекрашивает всё без пересборки.

**Радиус — только ступень темы.** `--radius-sm` = r/2, `md` = r (6 по умолчанию: кнопки, поля, меню,
подсказки), `lg` = r.lg (8: диалоги, сегментированная полоса), `xl` = 2r; `2xl…4xl`, `checkbox`
(min(r, 4)), `thumb` (min(r, 3)), а также `0`, `50%`, `full`. Шкала не пропорциональна (`theming.md`
§3.2), поэтому ступени заданы явно.

**Тень — только токен.** `--shadow-sm` (активная вкладка), `md` (поповер, меню, список select), `lg`
(уведомление), `tooltip`, `dialog`, `focus`. Тени всплывающих окон есть в каждой теме, даже при
`shadow: false` (`theming-components.md` §4.5).

**Размер — только токен.** Шаг `--spacing` (0,25 rem, как в Tailwind: `h-8` = 32 px) и именованные
`--size-*`, `--sidebar-width`; в CSS без Tailwind — `calc(var(--spacing) * n)`. Литерал допустим только
для линии в 1 px. Размер текста — только `--text-xs/sm/base/lg/code`.

**Текст.** IBM Plex Sans для всего, IBM Plex Mono для кода (13 px на строке 20). Жирность — три
начертания gpui-kit: 400, 500, 600. `system-ui` и системные шрифты не используем (`theming.md` §6).

**Плоско.** Без градиентов и размытия; поповеры и меню появляются без анимации, подсказка и список
select — 150 мс, как в gpui-kit.

**Страница не определяет тему сама.** Никаких `prefers-color-scheme`, `@font-face`, переопределения
токенов; `@import` — только Tailwind и файлы этого пакета. Тема выбирается атрибутами на `<html>`:
`data-theme="<id>"` (блок `themes.css`) и `data-mode="light|dark"` (вариант `dark:`). Без `data-theme`
у страницы нет цветов: в HTML стоит статический `data-theme="default-light"` как запасной.

**Стили — в CSS.** В TSX инлайновые стили только для геометрии и своих переменных, литеральным
объектом; в HTML нет `<style>`, `style=""` и встроенных `<script>`.

Всё это проверяет `lint/rules.ts`; расширение прогоняет через него свои CSS, классы Tailwind в TSX,
инлайновые стили и HTML (`extension/src/dna.test.ts`).

## Слой компонентов

У shadcn теперь есть «стили»: компонент базы (Radix) несёт раскладку и по классу `cn-*` на каждую
часть, а вид этих классов описан в одном CSS-файле стиля. Реестр shadcn при сборке **вписывает** стиль
в файлы компонентов (`createStyleMap` / `transformStyle`). Мы делаем иначе: классы `cn-*` остаются в
DOM, а `style-gpui.css` применяется во время работы. Почему:

- один файл — один вид: расширение и сайт берут одни и те же правила из одного файла, без генерации;
- не нужен внутренний API `shadcn/utils` и закреплённая версия пакета `shadcn`;
- формат файла остаётся форматом стиля shadcn, так что путь со вписыванием по-прежнему возможен.

Правила лежат в `@layer components`: утилита в файле компонента или в `className` побеждает стиль, как
в shadcn. Поэтому то, что база задаёт утилитами поперёк gpui-kit, правится в самой базе — список правок
записан в шапке каждого файла компонента (`extension/src/components/ui/*.tsx`), сводка —
`docs/extension-structure.md`.

Что есть в `style-gpui.css` (по приоритетам `theming-components.md` §5):

| Приоритет | Части |
|---|---|
| P1 | Button, Badge, Kbd, Tooltip, Popover, Hover Card, Dropdown Menu, Context Menu, Tabs (`default` = Segmented, `line` = Underline), строки списка (`kit-list`, `kit-list-item`) |
| P2, нужные расширению | Input, Textarea, Select, Checkbox, Label, Toggle (+ вариант `segmented`), Toggle Group, Card, Separator |
| §4.8 | полоса Scroll Area |
| ещё нет | Sidebar как компонент (у расширения навигацию рисует рамка `ui.css` по тем же числам), Dialog, Sheet, Command, Sonner, Table, Switch, Slider, Radio, Progress и прочее из P2–P3 — их правила `nova` в `upstream/style-nova.css` |

Компоненты, которые уже стоят в расширении и проверены в браузере: Button, Textarea, Select, Checkbox,
Label, Toggle Group, Card. Правила остальных частей собираются Tailwind (`tests/compile.test.ts`) и
проходят линт, но в браузере не открывались.

## Что нужно расширению и что сайту

| Часть | Расширение | Сайт |
|---|---|---|
| `theme.css` (+ `themes.css`, `fonts.css`) | да (главная страница и страница редактора) | да |
| `tailwind.css` | да | да, если сайт на Tailwind v4 (D10) |
| `style-gpui.css` | да | да, вместе с компонентами shadcn базы Radix |
| `ui.css` | да (только главная страница) | **нет**: это рамка страницы расширения |
| `tokens.json`, `lint` | тесты | тесты, сборка других платформ (письма, графика) |

Порядок подключения (CSS страницы, одна сборка Tailwind):

```css
@import 'tailwindcss';
@import '@workspace/dna/theme.css';
@import '@workspace/dna/tailwind.css';
@import '@workspace/dna/style-gpui.css';
@import '@workspace/dna/ui.css'; /* только расширение */
```

Страница без Tailwind и без компонентов (страница редактора в iframe) берёт один `theme.css`.

## Витрина

`showcase/` — одна статическая страница со всеми компонентами слоя `style-gpui.css`, токенами и рамкой
расширения, в любой из 30 тем. Это не часть расширения: страница нужна, чтобы смотреть стиль целиком
и сверять его с gpui-kit.

```sh
pnpm --filter @workspace/dna showcase                       # собирает showcase/dist
python3 -m http.server 8793 --bind 127.0.0.1 -d packages/dna/showcase/dist
```

Разметка в `showcase/index.html` повторяет то, что отдают компоненты shadcn (базовые классы
раскладки плюс `cn-*`); состояния, которые в настоящих компонентах ставит Radix, имитирует
`showcase/showcase.js`. Открытые списки и меню показаны раскрытыми на месте.

## Как обновлять токены

Сгенерированная половина (`themes.css`, `themes.index.json`) приходит из спайка `spikes/theme-export`:
нативная утилита на Rust вызывает `Theme::apply_config` самого gpui-kit (те же запасные значения, что в
wasm) и пишет `out/themes.resolved.json`; `contrast.mjs` отбирает темы по правилу контраста (D10: текст
4,5, кнопки 3); `to-css.mjs` делает из выгрузки CSS и индекс. Подробно — `spikes/theme-export/RESULTS.md`.

```sh
cd spikes/theme-export
cargo run -- ~/.cargo/git/checkouts/gpui-component-*/<коммит>   # выгрузка
node contrast.mjs && node to-css.mjs                            # отбор и CSS
cd ../..
pnpm --filter @workspace/dna sync:themes   # копирует out/ в пакет байт в байт и выводит tokens.json
pnpm --filter @extension/theme exec node scripts/sync-gpui-themes.mjs   # файлы тем для редактора (если список тем изменился)
pnpm test
```

- Пока выгрузка лежит рядом, тест сверяет копии с `out/` байт в байт: руками они не правятся.
- Если в выгрузке появился новый цветовой токен, `tests/tokens.test.ts` потребует строку в
  `tailwind.css` (`--color-<имя>: var(--<имя>)`).
- После правки `:root` в `theme.css` — `pnpm --filter @workspace/dna tokens`.

## Шрифты

IBM Plex Sans 400, 500, 600 и IBM Plex Mono 400 (D9: шрифт продукта; `theming-components.md` §3:
начертания 400/500/600). Файлы woff2 из наборов `fonts/complete/woff2` пакетов публичного npm
`@ibm/plex-sans@1.1.0` и `@ibm/plex-mono@2.5.0` (скачаны архивы пакетов; сами пакеты в зависимости не
добавлены — у них телеметрия в `postinstall`). Лицензия SIL OFL 1.1, `fonts/OFL-IBMPlex.txt`; расширение
кладёт её в `dist/licenses/`.

| Файл | sha256 |
|---|---|
| `IBMPlexSans-Regular.woff2` | `ba711a3085ff9f27440b6b9c4550cfc47c97bf36591d5da958b975bb3add8c1a` |
| `IBMPlexSans-Medium.woff2` | `5660f8a658f8bb50dbc005232f885eadffd2bc1c235c4f6fbb63469d1f9cde6d` |
| `IBMPlexSans-SemiBold.woff2` | `f78048030eab62e860efa39a0df79e2e5581bf122eb95b9bc42c0b8a4988d205` |
| `IBMPlexMono-Regular.woff2` | `ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350` |

Открыто (решает владелец): D9 говорит «одни TTF на обе стороны», но в npm у Plex только woff/woff2, а
модуль wasm сейчас вшивает свои IBM Plex Sans Regular и **JetBrains Mono** (не Plex Mono). Пока
страницы React и редактор берут шрифты из разных файлов, а моноширинный шрифт у них разный.

## Как перенести пакет на сайт

1. Скопировать каталог `packages/dna` в рабочее пространство сайта целиком (с `fonts/`, `upstream/`,
   `tests/`, `scripts/`). Внешних ссылок у пакета нет; зависимость времени работы одна —
   `tw-animate-css`; для тестов — `tailwindcss`, `@tailwindcss/node`, `vitest`, `typescript` и пресет
   tsconfig (`@extension/tsconfig/app` — заменить на пресет сайта).
2. Подключить `theme.css`, `tailwind.css`, `style-gpui.css` (без `ui.css`) в порядке выше.
3. Компоненты — база Radix shadcn (`apps/v4/registry/bases/radix/ui/*.tsx` на `e62c9435`) с правками из
   шапок файлов `extension/src/components/ui/*.tsx`; их можно взять оттуда же.
4. Ставить `data-theme` и `data-mode` на `<html>` до первой отрисовки: на сайте можно встроенным
   скриптом (у расширения — внешний `theme-boot.js`, потому что CSP запрещает встроенные).
5. Тест сайта, как `extension/src/dna.test.ts`: его CSS, классы и HTML через `@workspace/dna/lint`.
6. Тест `tokens.test.ts` сверяет копии с `spikes/theme-export/out` только если каталог есть — на сайте
   эта проверка пропускается; источником остаётся этот репозиторий.
