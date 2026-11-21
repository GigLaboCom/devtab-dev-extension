/**
 * The start page — what a new tab shows (D16). The field in the centre (it finds our sections and tools, opens a tool
 * with pasted text and, with web search on, searches the web), and under it the row parts the user switched on, in the
 * user's order (seam `StartPart`, src/start/part.ts). The page walks the definitions and names none of them.
 *
 * Assembled from what is on (docs/research/start-route-budget.md): the page itself carries the parts' definitions and
 * the tools' catalogue; each part's code arrives only while the part is on — a row's tiles, an option's part of the
 * context (what the field offers, what a tile shows). What the first frames show (`loadAt: 'start'`) is asked for with
 * the page; the rest (`idle`: fuzzy matching, the tools' `detect`) after the first paint. Until a row's code is here the
 * row keeps its exact room (no layout jump); until an option's is, a stand-in keeps the page as it will be. A part whose
 * code fails says so in one quiet line. A row that reads the browser reads after the first paint and keeps one row's
 * place until it answers. With every row off the field still finds our places. Settings sit top right (after the field
 * in the document, so one Tab from the address bar reaches the field): Chrome draws its own "Customize Chrome" button at
 * the bottom right of an extension's new tab.
 */
import product from '../../../product.json';
import { go } from '../route';
import { CommandField } from '../start/CommandField';
import { TileRow } from '../start/Tiles';
import { createDebug } from '@extension/logger';
import { DESTINATIONS, SETTINGS_DESTINATION } from '@src/shared/destinations';
import { pageContext, partState, partsToLoad, rowsInOrder } from '@src/start/part';
import { afterFirstPaint } from '@src/start/tileSources';
import { buttonVariants } from '@workspace/ui/button-variants';
import { PlusIcon, SettingsIcon } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ShortcutStoreDeps } from '@src/shortcuts/store';
import type { EditableTile, PartCode, RowPart, StartPart, TileEditor } from '@src/start/part';
import type { StartState } from '@src/start/settings';
import type { SiteIcons } from '@src/start/siteIcons';
import type { ReactElement } from 'react';

const debug = createDebug('extension:start');

// The form opens on a click only: its chunk loads then, not with the page.
const ShortcutForm = lazy(() => import('../start/ShortcutForm').then(m => ({ default: m.ShortcutForm })));

export interface StartPageProps {
  state: StartState;
  /** The optional permissions Chrome holds now. */
  held: ReadonlySet<string>;
  parts: readonly StartPart[];
  /** The parts' code on this page (src/start/part.ts, `partCode`). */
  code: PartCode;
  /** Where the user's shortcuts are kept (chrome.storage.local); absent: the page listens for none. */
  keys?: ShortcutStoreDeps;
}

type Editing = { kind: 'add' } | { kind: 'edit'; id: string } | null;

/** A row the user fills by hand: its tiles, an edit button on each, the add tile and the form. */
const EditableRow = ({
  part,
  tiles,
  editor,
  state,
  icons,
}: {
  part: RowPart;
  tiles: Parameters<typeof TileRow>[0]['source'];
  editor: TileEditor;
  state: StartState;
  icons: SiteIcons;
}): ReactElement => {
  const [editing, setEditing] = useState<Editing>(null);
  const list = editor.items(state);
  const save = (next: EditableTile[]): void => {
    editor.save(next).catch(e => debug.warn('save the tiles', e));
  };
  const index = editing?.kind === 'edit' ? list.findIndex(s => s.id === editing.id) : -1;
  const edited = index >= 0 ? list[index] : undefined;

  return (
    <TileRow
      id={part.id}
      title={part.title}
      source={tiles}
      state={state}
      icons={icons}
      empty={part.empty}
      onEdit={tile => setEditing({ kind: 'edit', id: tile.id })}
      extra={
        list.length < editor.max && (
          <li className="kit-tile-item">
            <button
              type="button"
              className="kit-tile kit-tile-add"
              aria-expanded={editing?.kind === 'add'}
              onClick={() => setEditing({ kind: 'add' })}>
              <span className="kit-tile-icon" aria-hidden="true">
                <PlusIcon />
              </span>
              <span className="kit-tile-title">{editor.addLabel}</span>
            </button>
          </li>
        )
      }>
      {editing && (editing.kind === 'add' || edited) && (
        <Suspense fallback={null}>
          <ShortcutForm
            key={editing.kind === 'edit' ? editing.id : 'add'}
            addLabel={editor.addLabel}
            shortcut={edited}
            canMoveLeft={index > 0}
            canMoveRight={index >= 0 && index < list.length - 1}
            onCancel={() => setEditing(null)}
            onSave={fields => {
              if (edited) save(list.map(s => (s.id === edited.id ? { ...s, ...fields } : s)));
              else save([...list, { id: crypto.randomUUID(), ...fields }]);
              setEditing(null);
            }}
            onRemove={() => {
              save(list.filter(s => s.id !== edited?.id));
              setEditing(null);
            }}
            onMove={step => {
              const next = [...list];
              const [moved] = next.splice(index, 1);
              next.splice(index + step, 0, moved);
              save(next);
            }}
          />
        </Suspense>
      )}
    </TileRow>
  );
};

/** A row's heading over a line: the permission was removed, or its code could not be loaded. */
const NoteRow = ({ part, children }: { part: RowPart; children: ReactElement | string }): ReactElement => (
  <section className="kit-tile-row" aria-labelledby={`start-row-${part.id}`} data-row={part.id}>
    <h2 id={`start-row-${part.id}`} className="kit-tile-row-title">
      {part.title}
    </h2>
    <p className="kit-tile-row-note">{children}</p>
  </section>
);

/**
 * A row whose code is on its way: its heading, and the room its tiles will take — as many invisible tiles as the state
 * says it will show (the grid wraps them as it will wrap the real ones), or one row's height when it cannot say.
 */
const ReservedRow = ({ part, count }: { part: RowPart; count?: number }): ReactElement => (
  <section className="kit-tile-row" aria-labelledby={`start-row-${part.id}`} data-row={part.id} aria-busy="true">
    <h2 id={`start-row-${part.id}`} className="kit-tile-row-title">
      {part.title}
    </h2>
    {count ? (
      <ul className="kit-tiles kit-tiles-reserved" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className="kit-tile-item">
            <span className="kit-tile" />
          </li>
        ))}
      </ul>
    ) : (
      <div className="kit-tiles-waiting" />
    )}
  </section>
);

/**
 * Resolves once the browser has painted the page's first content (the `first-contentful-paint` entry; a frame and a task
 * where the browser does not report paints) — so what loads after it never competes with the first paint.
 */
const afterContentfulPaint = (): Promise<void> =>
  new Promise(resolve => {
    if (typeof PerformanceObserver !== 'function' || !PerformanceObserver.supportedEntryTypes?.includes('paint')) {
      afterFirstPaint().then(resolve);
      return;
    }
    const observer = new PerformanceObserver(list => {
      if (!list.getEntriesByName('first-contentful-paint').length) return;
      observer.disconnect();
      resolve();
    });
    observer.observe({ type: 'paint', buffered: true });
  });

/** Resolves when the page is idle (or after a short wait where it never says so). */
const whenIdle = (): Promise<void> =>
  new Promise(resolve =>
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback(() => resolve(), { timeout: 1000 })
      : setTimeout(resolve, 0),
  );

/**
 * Loads the code of the parts that are on — what the first frames show at once, the rest after the first paint when the
 * page is idle — and re-renders as each arrives (or fails). A part switched on later, here or on another page, loads
 * then. Returns a number that changes with every arrival.
 */
const usePartCode = (
  parts: readonly StartPart[],
  state: StartState,
  held: ReadonlySet<string>,
  code: PartCode,
): number => {
  const [arrived, bump] = useReducer((n: number) => n + 1, 0);
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let live = true;
    afterContentfulPaint()
      .then(whenIdle)
      .then(() => live && setIdle(true));
    return () => {
      live = false;
    };
  }, []);
  const due = partsToLoad(parts, state.settings, held, idle).filter(p => !code.loaded(p) && !code.failed(p));
  const key = due.map(p => p.id).join(' ');
  useEffect(() => {
    let live = true;
    for (const part of due)
      code.load(part).then(
        () => live && bump(),
        e => {
          debug.warn(`load the start page part ${part.id}`, e);
          if (live) bump();
        },
      );
    return () => {
      live = false;
    };
    // `due` is derived from `key` and what has arrived; the key names the parts to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, code]);
  return arrived;
};

export const StartPage = ({ state, held, parts, code, keys }: StartPageProps): ReactElement => {
  const arrived = usePartCode(parts, state, held, code);
  const context = useMemo(
    () => pageContext(parts, state.settings, held, code),
    // `arrived` changes when a part's code has arrived: the context then takes the code's members.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parts, state.settings, held, code, arrived],
  );
  const rows = rowsInOrder(parts, state.settings)
    .map(part => ({ part, state: partState(part, state.settings, held) }))
    .filter(row => row.state !== 'off');

  // The field is drawn and listening: what the e2e check times a new tab to.
  useEffect(() => void performance.mark('start-ready'), []);

  // The user's shortcuts, after the first paint and from a chunk of their own: `find` focuses the field here.
  const find = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!keys) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    afterFirstPaint()
      .then(() => import('@src/shortcuts/startKeys'))
      .then(m => {
        if (cancelled) return;
        stop = m.listenStartKeys(keys, { go, find: () => find.current?.() }).stop;
      })
      .catch(e => debug.warn('listen for the shortcuts', e));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [keys]);

  const row = (part: RowPart, rowState: 'on' | 'blocked'): ReactElement => {
    if (rowState === 'blocked')
      return (
        <NoteRow key={part.id} part={part}>
          <>
            The permission this row needs was removed in Chrome, so nothing is shown.{' '}
            <a href={SETTINGS_DESTINATION.hash}>Turn it on again in Settings</a>.
          </>
        </NoteRow>
      );
    const loaded = code.loaded(part);
    if (!loaded)
      return code.failed(part) ? (
        <NoteRow key={part.id} part={part}>
          This row could not be loaded. Reload the page to try again.
        </NoteRow>
      ) : (
        <ReservedRow key={part.id} part={part} count={part.reserve?.(state, DESTINATIONS)} />
      );
    return loaded.editor ? (
      <EditableRow
        key={part.id}
        part={part}
        tiles={loaded.tiles}
        editor={loaded.editor}
        state={state}
        icons={context.siteIcons}
      />
    ) : (
      <TileRow
        key={part.id}
        id={part.id}
        title={part.title}
        source={loaded.tiles}
        state={state}
        icons={context.siteIcons}
        empty={part.empty}
      />
    );
  };

  return (
    <div className="kit-start" data-page="start">
      <main className="kit-start-main">
        <h1 className="kit-start-title">{product.name}</h1>
        <CommandField
          destinations={DESTINATIONS}
          webSearch={context.webSearch}
          matcher={context.matcher}
          recogniser={context.recognise}
          recent={state.recent.used}
          findRef={find}
        />
        {rows.length ? (
          <div className="kit-tile-rows">{rows.map(r => row(r.part, r.state as 'on' | 'blocked'))}</div>
        ) : (
          <p className="kit-start-empty">
            Every row of the start page is off. The field still finds every tool and section; turn rows back on in{' '}
            <a href={SETTINGS_DESTINATION.hash}>Settings</a>.
          </p>
        )}
      </main>
      {/* After the field in the document, drawn top right: one Tab from the address bar lands on the field. */}
      <div className="kit-start-corner">
        <a
          className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'no-underline' })}
          href={SETTINGS_DESTINATION.hash}>
          <SettingsIcon aria-hidden="true" />
          Settings
        </a>
      </div>
    </div>
  );
};
