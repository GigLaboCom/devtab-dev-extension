/**
 * The start page — what a new tab shows (D16). The field in the centre (it finds our sections and tools, opens a tool
 * with pasted text and, with web search on, searches the web), and under it the row parts the user switched on, in the
 * user's order (seam `StartPart`, src/start/part.ts). The page walks the definitions and names none of them: a row is
 * drawn from its TileSource (with the tile editor when the part has one), an option only changes the page's context
 * (what the field offers, what a tile shows). A row that reads the browser loads and reads after the first paint and
 * keeps one row's place until it answers. With every row off the field still finds our places. The look is the style
 * package's, with the product's name — nothing that could be taken for Chrome's own page. Settings sit top
 * right (after the field in the document, so one Tab from the address bar reaches the field): Chrome draws its own
 * "Customize Chrome" button at the bottom right of an extension's new tab.
 */
import product from '../../../product.json';
import { CommandField } from '../start/CommandField';
import { ShortcutForm } from '../start/ShortcutForm';
import { TileRow } from '../start/Tiles';
import { createDebug } from '@extension/logger';
import { DESTINATIONS, SETTINGS_DESTINATION } from '@src/shared/destinations';
import { pageContext, partState, rowsInOrder } from '@src/start/part';
import { TOOLS } from '@src/tools/registry';
import { buttonVariants } from '@workspace/ui/button';
import { PlusIcon, SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EditableTile, RowPart, StartPart, TileEditor } from '@src/start/part';
import type { StartState } from '@src/start/settings';
import type { SiteIcons } from '@src/start/siteIcons';
import type { ReactElement } from 'react';

const debug = createDebug('extension:start');

export interface StartPageProps {
  state: StartState;
  /** The optional permissions Chrome holds now. */
  held: ReadonlySet<string>;
  parts: readonly StartPart[];
}

type Editing = { kind: 'add' } | { kind: 'edit'; id: string } | null;

/** A row the user fills by hand: its tiles, an edit button on each, the add tile and the form. */
const EditableRow = ({
  part,
  editor,
  state,
  icons,
}: {
  part: RowPart;
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
      source={part.tiles}
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
      )}
    </TileRow>
  );
};

/** Switched on, but Chrome no longer holds its permission: nothing is read, one line says why. */
const BlockedRow = ({ part }: { part: RowPart }): ReactElement => (
  <section className="kit-tile-row" aria-labelledby={`start-row-${part.id}`} data-row={part.id}>
    <h2 id={`start-row-${part.id}`} className="kit-tile-row-title">
      {part.title}
    </h2>
    <p className="kit-tile-row-note">
      The permission this row needs was removed in Chrome, so nothing is shown.{' '}
      <a href={SETTINGS_DESTINATION.hash}>Turn it on again in Settings</a>.
    </p>
  </section>
);

export const StartPage = ({ state, held, parts }: StartPageProps): ReactElement => {
  const context = pageContext(parts, state.settings, held);
  const rows = rowsInOrder(parts, state.settings)
    .map(part => ({ part, state: partState(part, state.settings, held) }))
    .filter(row => row.state !== 'off');

  // The field is drawn and listening: what the e2e check times a new tab to.
  useEffect(() => void performance.mark('start-ready'), []);

  return (
    <div className="kit-start" data-page="start">
      <main className="kit-start-main">
        <h1 className="kit-start-title">{product.name}</h1>
        <CommandField destinations={DESTINATIONS} tools={TOOLS} webSearch={context.webSearch} />
        {rows.length ? (
          <div className="kit-tile-rows">
            {rows.map(({ part, state: rowState }) =>
              rowState === 'blocked' ? (
                <BlockedRow key={part.id} part={part} />
              ) : part.editor ? (
                <EditableRow key={part.id} part={part} editor={part.editor} state={state} icons={context.siteIcons} />
              ) : (
                <TileRow
                  key={part.id}
                  id={part.id}
                  title={part.title}
                  source={part.tiles}
                  state={state}
                  icons={context.siteIcons}
                  empty={part.empty}
                />
              ),
            )}
          </div>
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
