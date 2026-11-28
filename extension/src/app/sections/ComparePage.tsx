/**
 * «Compare code» (D11): a toolbar and the two-editor view filling the rest. The editors are the page: text gets in by
 * dropping files (anywhere on the section, the editor included), opening files, pasting, or typing into a side
 * switched to edit mode; with nothing loaded the example of the selected language is shown. The editor page in the
 * iframe (src/viewer/) owns the two texts and compares them in its wasm module (crates/review-view: the comparison
 * lives in Rust, D13) — on a request, and by itself as the user edits. This page keeps what it says about each side
 * (compare/state.ts), and its toolbar is the list of compare/actions.ts. Nothing opened or typed here is stored; the
 * only writes are the user's Save and Save as. The editor keeps the keys pressed in it, so it hands up the page's
 * shortcuts and the frame's (`frameKeys`: ⌘K for the shell's palette).
 *
 * Indentation (D39): each side opens with what applies to its own text (../editor/useEditorIndent.ts — detected from
 * it, the language's values, the settings), and each side's bar has its indent indicator: what applies there and the
 * person's choice for that side's text, which lasts until another text replaces it (a swap carries it along).
 */
import { IndentIndicator } from '../editor/IndentIndicator';
import { useEditorIndent } from '../editor/useEditorIndent';
import { routeHash } from '../route';
import { useOffer } from '../shell/sectionKeys';
import { createDebug } from '@extension/logger';
import { sideWord } from '@src/compare/actions';
import { collectDrop } from '@src/compare/files';
import { LANGUAGES, labelOf, languageOfFile } from '@src/compare/languages';
import {
  SIDES,
  initialState,
  isEmptyComparison,
  languageAfter,
  other,
  place,
  reduce,
  sideName,
} from '@src/compare/state';
import { keyLabel } from '@src/shared/keyLabels';
import { VIEWER_PAGE } from '@src/shared/pages';
import { chordOf, isFromViewer, isMac, sameChord } from '@src/shared/viewerProtocol';
import { Button } from '@workspace/ui/button';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@workspace/ui/tooltip';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { SectionKeys } from '../shell/sectionKeys';
import type { ActionContext, CompareAction, ComparePort } from '@src/compare/actions';
import type { CompareBehaviors } from '@src/compare/behaviors';
import type { SideText } from '@src/compare/files';
import type { Arrival, CompareState, Side, Tone } from '@src/compare/state';
import type { EditorSettingsBehaviors } from '@src/editorSettings/behaviors';
import type { FrameKeys } from '@src/shared/keys';
import type { DroppedEntry, KeyChord, ToViewer } from '@src/shared/viewerProtocol';
import type { DragEvent, ReactElement } from 'react';

const debug = createDebug('app:compare');

/** The language of the example the page opens with. */
export const DEFAULT_LANGUAGE = 'rust';

const ROLE: Record<Side, string> = { old: 'Original', new: 'Changed' };

/** Where the texts of the module's status line come from: the changed side's name, else the original's. */
const pathOf = (state: CompareState): string => state.sides.new.fileName ?? state.sides.old.fileName ?? 'untitled';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, iframe, [tabindex]';

const ActionButton = ({
  action,
  side,
  state,
  mac,
  onRun,
}: {
  action: CompareAction;
  side: Side | null;
  state: CompareState;
  mac: boolean;
  onRun: (action: CompareAction, side: Side | null) => void;
}): ReactElement => {
  const Icon = action.icon;
  const pressed = action.pressed?.(state, side);
  const label = side ? `${action.title} (${sideWord(side)} side)` : action.title;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed === undefined ? undefined : pressed}
          data-action={action.id}
          data-pressed={pressed ? '' : undefined}
          className="kit-compare-action"
          disabled={!action.enabled(state, side)}
          onClick={() => onRun(action, side)}>
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {action.title}
        {action.shortcut && <kbd className="cn-kbd">{keyLabel(action.shortcut, mac)}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
};

export interface ComparePageProps {
  behaviors: CompareBehaviors;
  /** The shortcuts of the frame around the page (the shell's palette), handed up from the editor as well. */
  frameKeys?: FrameKeys;
  /** The editor's settings (D39); absent: the editors keep their own defaults and there are no indicators. */
  editorSettings?: EditorSettingsBehaviors;
  /** The user's shortcuts as the section gets them (the shell's); absent: no keys. */
  keys?: SectionKeys;
}

export const ComparePage = ({ behaviors, frameKeys, editorSettings, keys }: ComparePageProps): ReactElement => {
  const [state, dispatch] = useReducer(reduce, DEFAULT_LANGUAGE, initialState);
  const frameKeysRef = useRef(frameKeys);
  frameKeysRef.current = frameKeys;
  // The page's shortcuts and the frame's: the editor keeps every key it is not told to hand up.
  const keysMessage = useCallback(
    (): ToViewer => ({
      type: 'viewer/keys',
      keys: [
        ...behaviors.actions.flatMap(a => (a.shortcut ? [a.shortcut] : [])),
        ...(frameKeysRef.current?.keys ?? []),
      ],
    }),
    [behaviors.actions],
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const frame = useRef<HTMLIFrameElement>(null);
  const mac = useMemo(() => isMac(), []);
  const sideActions = behaviors.actions.filter(a => a.scope === 'side');
  const commonActions = behaviors.actions.filter(a => a.scope === 'common');

  // ---- the editor page: requests, reads, answers --------------------------------------------------------------
  const viewerReady = useRef(false);
  // Messages for an editor that has not drawn yet; a full comparison drops what waited before it.
  const outbox = useRef<ToViewer[]>([]);
  const nextId = useRef(0);
  // The latest request that changes what is shown: only its answer (or an edit's) is taken.
  const latest = useRef(0);
  const reads = useRef(new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>());
  const [shown, setShown] = useState({ count: 0, path: '' });

  const post = useCallback((message: ToViewer) => {
    if (viewerReady.current) frame.current?.contentWindow?.postMessage(message, location.origin);
    else outbox.current = message.type === 'viewer/compare' ? [message] : [...outbox.current, message];
  }, []);
  // The user changed a shortcut (on any page): the editor hands up the new set from now on.
  const frameKeyList = frameKeys?.keys;
  useEffect(() => {
    if (viewerReady.current) frame.current?.contentWindow?.postMessage(keysMessage(), location.origin);
  }, [frameKeyList, keysMessage]);
  const request = useCallback(
    (make: (id: number) => ToViewer) => {
      const id = ++nextId.current;
      latest.current = id;
      post(make(id));
    },
    [post],
  );
  const read = useCallback(
    (side: Side) =>
      new Promise<string>((resolve, reject) => {
        if (!viewerReady.current) return reject(new Error('The editor is still loading.'));
        const id = ++nextId.current;
        reads.current.set(id, { resolve, reject });
        post({ type: 'viewer/read', id, side });
      }),
    [post],
  );
  const say = useCallback(
    (text: string, tone: Tone = 'info') => dispatch({ type: 'notice', notice: { tone, text } }),
    [],
  );
  const indent = useEditorIndent(editorSettings, post, DEFAULT_LANGUAGE);
  const indentRef = useRef(indent);
  indentRef.current = indent;
  // The side whose indicator a shortcut opened.
  const [indentOpen, setIndentOpen] = useState<Side | null>(null);

  // ---- the example ---------------------------------------------------------------------------------------------
  // Bumped whenever the user's own text arrives, so an example still loading does not land over it.
  const generation = useRef(0);
  const showExample = useCallback(
    async (language: string) => {
      const ticket = ++generation.current;
      let pair;
      try {
        pair = await behaviors.examples.load(language);
      } catch {
        // The examples are a file of their own, loaded on the first use: a page left open over a rebuilt or updated
        // extension asks for a file that is no longer there. Said, not swallowed — the button would seem dead.
        if (ticket === generation.current)
          say('The example could not be loaded. Reload this page and try again.', 'error');
        return;
      }
      if (ticket !== generation.current) return;
      if (!pair) {
        dispatch({ type: 'language', language });
        indentRef.current.setLanguage(language);
        request(id => ({ type: 'viewer/set-language', id, language }));
        return;
      }
      for (const side of SIDES)
        if (stateRef.current.sides[side].editable)
          post({ type: 'viewer/set-editable', side, editable: false, focus: false });
      dispatch({
        type: 'example',
        language,
        names: { old: pair.before.name, new: pair.after.name },
        empty: { old: !pair.before.text, new: !pair.after.text },
      });
      const editor = indentRef.current.open({ old: pair.before.text, new: pair.after.text }, language);
      request(id => ({
        type: 'viewer/compare',
        id,
        request: {
          path: pair.after.name,
          language,
          oldText: pair.before.text,
          newText: pair.after.text,
          ...(editor && { editor }),
        },
      }));
    },
    [behaviors.examples, post, request, say],
  );
  // Texts another part of the page handed over (a tool sending the person here: TextSource.handed) come instead of the
  // example — two: the original and the changed text; one: the original. Taken once, so StrictMode's second run finds
  // none and the example it asks for is dropped by the generation the arrival bumps.
  const portRef = useRef<ComparePort | null>(null);
  useEffect(() => {
    const handed = behaviors.texts.handed?.() ?? [];
    if (!handed.length) return void showExample(DEFAULT_LANGUAGE);
    // As when the example goes away: plain text unless a name tells the language.
    stateRef.current = reduce(stateRef.current, { type: 'language', language: 'text' });
    dispatch({ type: 'language', language: 'text' });
    // One text: an empty changed side — both go in one comparison, the editor's first.
    const pair = [handed[0]!, handed[1] ?? { text: '', fileName: null, handle: null, bom: false }];
    void portRef.current?.load(pair, null, 'handed');
  }, [behaviors.texts, showExample]);

  // ---- what the actions may do (ComparePort) -------------------------------------------------------------------
  const lastSide = useRef<Side>('new');
  const confirmLoss = useCallback(
    async (sides: readonly Side[]) => {
      const losing = sides.filter(side => stateRef.current.sides[side].modified);
      if (!losing.length) return true;
      const which = losing.length === 2 ? 'both sides' : `the ${sideWord(losing[0]!)} side`;
      return behaviors.confirmDiscard(`Replace the unsaved edits of ${which}? They are not saved anywhere.`);
    },
    [behaviors],
  );

  const port: ComparePort = useMemo(
    () => ({
      async load(texts: readonly SideText[], side: Side | null, origin: Arrival['origin']) {
        const placed = place(texts, side, origin);
        if ('problem' in placed) return say(placed.problem, 'error');
        const { arrivals } = placed;
        if (!(await confirmLoss(arrivals.map(a => a.side)))) return say('Kept the edits; nothing was replaced.');
        generation.current++;
        const before = stateRef.current;
        const language = languageAfter(before, arrivals, languageOfFile);
        for (const { side: target } of arrivals)
          if (before.sides[target].editable)
            post({ type: 'viewer/set-editable', side: target, editable: false, focus: false });
        dispatch({ type: 'arrived', arrivals, language });
        const after = reduce(before, { type: 'arrived', arrivals, language });
        const textOf = (target: Side): string | undefined => arrivals.find(a => a.side === target)?.text.text;
        const first = arrivals[0]!;
        if (arrivals.length === 2 || before.sides[other(first.side)].origin === 'example') {
          // Both sides change: the other side's example goes too.
          const oldText = textOf('old') ?? '';
          const newText = textOf('new') ?? '';
          const editor = indentRef.current.open({ old: oldText, new: newText }, language);
          request(id => ({
            type: 'viewer/compare',
            id,
            request: { path: pathOf(after), language, oldText, newText, ...(editor && { editor }) },
          }));
        } else {
          if (language !== before.language) request(id => ({ type: 'viewer/set-language', id, language }));
          request(id => ({
            type: 'viewer/set-side',
            id,
            request: { side: first.side, text: first.text.text, path: pathOf(after) },
          }));
          // After the text: its indentation is detected and sent as a change of that side.
          indentRef.current.setLanguage(language);
          indentRef.current.replaceSide(first.side, first.text.text);
        }
        const named = arrivals.map(
          a =>
            a.text.fileName ??
            (origin === 'clipboard'
              ? 'The clipboard’s text'
              : origin === 'handed'
                ? 'The pasted text'
                : 'The dropped text'),
        );
        say(
          origin === 'handed' && arrivals.length === 2 && arrivals.every(a => !a.text.fileName)
            ? 'Comparing the pasted texts: the original on the left, the changed text on the right.'
            : arrivals.length === 2
              ? `Comparing ${named[0]} (original) with ${named[1]} (changed).`
              : `${named[0]} is on the ${sideWord(first.side)} side.`,
          'success',
        );
      },
      read,
      setEditable(side: Side, editable: boolean) {
        lastSide.current = side;
        dispatch({ type: 'editable', side, editable });
        if (editable) frame.current?.contentWindow?.focus();
        post({ type: 'viewer/set-editable', side, editable, focus: editable });
        say(
          editable
            ? `Editing the ${sideWord(side)} side: the comparison follows your edits. Escape, then Tab leaves the editor.`
            : `The ${sideWord(side)} side is read-only again; your edits stay.`,
        );
      },
      async clear(side: Side) {
        if (!(await confirmLoss([side]))) return;
        generation.current++;
        const before = stateRef.current;
        if (before.sides[side].editable) post({ type: 'viewer/set-editable', side, editable: false, focus: false });
        dispatch({ type: 'cleared', side });
        if (before.sides[other(side)].origin === 'example') {
          const editor = indentRef.current.open({ old: '', new: '' }, before.language);
          request(id => ({
            type: 'viewer/compare',
            id,
            request: {
              path: 'untitled',
              language: before.language,
              oldText: '',
              newText: '',
              ...(editor && { editor }),
            },
          }));
        } else {
          request(id => ({
            type: 'viewer/set-side',
            id,
            request: { side, text: '', path: pathOf(reduce(before, { type: 'cleared', side })) },
          }));
          indentRef.current.replaceSide(side, '');
        }
      },
      swap() {
        dispatch({ type: 'swapped' });
        request(id => ({ type: 'viewer/swap', id }));
        indentRef.current.swap();
        say('Swapped the sides.');
      },
      saved(side: Side, text: string, fileName: string, handle: FileSystemFileHandle | null) {
        dispatch({ type: 'saved', side, fileName, handle });
        request(id => ({ type: 'viewer/mark-saved', id, side, text }));
      },
      say,
    }),
    [confirmLoss, post, read, request, say],
  );
  portRef.current = port;

  const runAction = useCallback(
    (action: CompareAction, side: Side | null) => {
      if (side) lastSide.current = side;
      const context: ActionContext = { side, state: stateRef.current, page: port, behaviors };
      if (!action.enabled(context.state, side)) return;
      action
        .run(context)
        .catch((error: unknown) => say(error instanceof Error ? error.message : String(error), 'error'));
    },
    [behaviors, port, say],
  );
  const runShortcut = useCallback(
    (chord: KeyChord, side: Side | null): boolean => {
      const action = behaviors.actions.find(a => a.shortcut && sameChord(a.shortcut, chord));
      if (!action) return false;
      runAction(action, action.scope === 'side' ? (side ?? lastSide.current) : null);
      return true;
    },
    [behaviors.actions, runAction],
  );

  // ---- drops --------------------------------------------------------------------------------------------------
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<Side | null>(null);
  const handleDrop = useCallback(
    async (entries: readonly DroppedEntry[], side: Side | null) => {
      setDragging(false);
      setOver(null);
      if (!entries.length) return;
      const incoming = await behaviors.texts.drop(entries);
      if (incoming.problems.length) return say(`Nothing was opened: ${incoming.problems.join('; ')}.`, 'error');
      await port.load(incoming.texts, side, entries.every(e => e.text !== null) ? 'dropped' : 'file');
    },
    [behaviors.texts, port, say],
  );
  const dropOn = (side: Side) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void collectDrop(event.dataTransfer).then(entries => handleDrop(entries, side));
  };
  const dragOver = (side: Side) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (over !== side) setOver(side);
  };

  // Window-wide: a drag entering the page shows the drop targets; a drop beside them never navigates the tab away.
  useEffect(() => {
    const carriesText = (event: globalThis.DragEvent): boolean =>
      !!event.dataTransfer &&
      (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes('text/plain'));
    const onEnter = (event: globalThis.DragEvent): void => {
      if (carriesText(event)) setDragging(true);
    };
    const onOver = (event: globalThis.DragEvent): void => {
      if (carriesText(event)) event.preventDefault();
    };
    const onLeave = (event: globalThis.DragEvent): void => {
      if (!event.relatedTarget) {
        setDragging(false);
        setOver(null);
      }
    };
    const onDrop = (event: globalThis.DragEvent): void => {
      if (!event.dataTransfer) return;
      event.preventDefault();
      void collectDrop(event.dataTransfer).then(entries => handleDrop(entries, null));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleDrop]);

  // ---- keyboard: the shortcuts, Tab into and out of the editor -------------------------------------------------
  const tabbed = useRef({ at: -Infinity, backwards: false });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') tabbed.current = { at: performance.now(), backwards: event.shiftKey };
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-side]') : null;
      const side = (target?.dataset.side as Side | undefined) ?? null;
      if (runShortcut(chordOf(event, mac), side)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mac, runShortcut]);
  const leaveEditor = useCallback((backwards: boolean) => {
    const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      el => el.tabIndex >= 0 && el.offsetParent !== null,
    );
    const at = all.indexOf(frame.current!);
    const target = backwards ? all[at - 1] : (all[at + 1] ?? all[0]);
    target?.focus();
  }, []);
  const enterEditor = (): void => {
    // Keyboard only: a click places the caret itself.
    if (performance.now() - tabbed.current.at > 300) return;
    post({ type: 'viewer/focus', side: tabbed.current.backwards ? 'new' : 'old' });
  };

  // ---- the editor page's messages ------------------------------------------------------------------------------
  const handlers = useRef({ runShortcut, handleDrop, leaveEditor });
  handlers.current = { runShortcut, handleDrop, leaveEditor };
  const grammarNotes = useRef(new Set<string>());
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      const data: unknown = event.data;
      if (!isFromViewer(data)) return;
      switch (data.type) {
        case 'viewer/ready': {
          viewerReady.current = true;
          dispatch({ type: 'viewer', viewer: 'ready' });
          for (const message of [keysMessage(), ...outbox.current])
            frame.current?.contentWindow?.postMessage(message, location.origin);
          outbox.current = [];
          return;
        }
        case 'viewer/shown': {
          if (data.id === undefined ? data.shown.cause !== 'edit' : data.id !== latest.current) return;
          dispatch({ type: 'shown', shown: data.shown });
          setShown(s => ({ count: s.count + 1, path: data.shown.path }));
          return;
        }
        case 'viewer/text':
          reads.current.get(data.id)?.resolve(data.text);
          reads.current.delete(data.id);
          return;
        case 'viewer/error': {
          const pending = data.id !== undefined ? reads.current.get(data.id) : undefined;
          if (pending) {
            pending.reject(new Error(data.message));
            reads.current.delete(data.id!);
          } else if (data.id === undefined) {
            if (!viewerReady.current) dispatch({ type: 'viewer', viewer: 'error' });
            dispatch({ type: 'notice', notice: { tone: 'error', text: data.message } });
          } else if (data.id === latest.current) {
            dispatch({ type: 'notice', notice: { tone: 'error', text: data.message } });
          }
          return;
        }
        case 'viewer/drag':
          setDragging(true);
          return;
        case 'viewer/drop':
          void handlers.current.handleDrop(data.entries, data.side);
          return;
        case 'viewer/key':
          if (data.side) lastSide.current = data.side;
          if (!handlers.current.runShortcut(data.chord, data.side)) frameKeysRef.current?.run(data.chord);
          return;
        case 'viewer/leave':
          handlers.current.leaveEditor(data.backwards);
          return;
        case 'viewer/grammar':
          // A grammar file of the mixed highlighter build that could not be used: texts in that language stay plain.
          // A note, not the editor's error — logged once.
          if (data.state === 'failed' && !grammarNotes.current.has(data.language)) {
            grammarNotes.current.add(data.language);
            debug.warn(`grammar ${data.language}: ${data.message}`);
          }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [behaviors.actions, keysMessage]);

  const onLanguage = (language: string): void => {
    if (stateRef.current.example !== null) void showExample(language);
    else {
      dispatch({ type: 'language', language });
      request(id => ({ type: 'viewer/set-language', id, language }));
      indent.setLanguage(language);
    }
  };
  // The indent indicator of the side used last (D39), by its shortcut.
  useOffer(keys, { 'editor:indentation': indent.enabled && (() => setIndentOpen(lastSide.current)) });

  // ---- rendering ------------------------------------------------------------------------------------------------
  const { counts, notice } = state;
  const empty = state.viewer === 'ready' && isEmptyComparison(state);
  const noticeText =
    notice?.text ??
    (state.example !== null
      ? 'This is an example. Drop two files, open or paste a text on each side, or edit one, to compare your own. ' +
        'Nothing you open or type here is stored or sent.'
      : '');

  return (
    <TooltipProvider>
      <section className="kit-compare" aria-labelledby="compare-title">
        <div className="kit-compare-bar">
          <h1 id="compare-title" className="kit-compare-title">
            Compare code
          </h1>
          <p className="kit-compare-notice" role="status" data-tone={notice?.tone ?? 'info'}>
            {state.viewer === 'error' ? `The editor could not start. ${noticeText}` : noticeText}
          </p>
          <div className="kit-compare-tools">
            <Label htmlFor="compare-language" className="sr-only">
              Language
            </Label>
            <Select value={state.language} onValueChange={onLanguage}>
              <SelectTrigger id="compare-language" className="min-w-36" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map(l => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {commonActions.map(action => (
              <ActionButton key={action.id} action={action} side={null} state={state} mac={mac} onRun={runAction} />
            ))}
            <span
              className="kit-compare-counts"
              data-viewer-state={state.viewer}
              data-shown={shown.count}
              data-shown-path={shown.path}
              data-changes={counts?.changes}
              data-added={counts?.added}
              data-removed={counts?.removed}
              title={
                counts
                  ? `${counts.changes} changed blocks; ${counts.added} lines added, ${counts.removed} removed`
                  : undefined
              }>
              {state.viewer === 'loading' && 'Loading the editor…'}
              {state.viewer === 'ready' &&
                counts &&
                (counts.changes === 0 ? (
                  'No differences'
                ) : (
                  <>
                    {`${counts.changes} ${counts.changes === 1 ? 'change' : 'changes'}`}
                    <span className="kit-compare-added">+{counts.added}</span>
                    <span className="kit-compare-removed">−{counts.removed}</span>
                  </>
                ))}
            </span>
          </div>
        </div>

        <div className="kit-compare-sides">
          {SIDES.map(side => {
            const meta = state.sides[side];
            return (
              <div
                key={side}
                className="kit-compare-side"
                role="group"
                aria-label={`${ROLE[side]} side`}
                data-side={side}
                onFocus={() => (lastSide.current = side)}>
                <span className="kit-compare-side-role">{ROLE[side]}</span>
                <span className="kit-compare-side-name" title={meta.fileName ?? undefined} data-origin={meta.origin}>
                  {sideName(meta)}
                </span>
                {meta.origin === 'example' && <span className="kit-compare-badge">Example</span>}
                {meta.editable && (
                  <span className="kit-compare-badge" data-badge="editing">
                    Editing
                  </span>
                )}
                {meta.modified && (
                  <span className="kit-compare-badge" data-badge="modified" title="Edited, not saved">
                    Edited
                  </span>
                )}
                {indent.enabled && (
                  <IndentIndicator
                    effective={indent.effective[side]}
                    choice={indent.choice[side]}
                    languageLabel={labelOf(state.language)}
                    onChoose={choice => indent.choose(side, choice)}
                    side={sideWord(side)}
                    compact
                    open={indentOpen === side}
                    onOpenChange={open => setIndentOpen(open ? side : null)}
                    settingsHref={routeHash({ section: 'settings' })}
                  />
                )}
                <div className="kit-compare-side-actions">
                  {sideActions.map(action => (
                    <ActionButton
                      key={action.id}
                      action={action}
                      side={side}
                      state={state}
                      mac={mac}
                      onRun={runAction}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="kit-compare-view">
          <iframe
            ref={frame}
            className="kit-compare-frame"
            src={`/${VIEWER_PAGE}`}
            title="Side-by-side comparison"
            onFocus={enterEditor}
          />
          {empty && !dragging && (
            <div className="kit-compare-empty">
              <p className="kit-compare-empty-title">Nothing to compare</p>
              <p className="kit-compare-empty-hint">
                Drop one or two files here, open or paste a text on each side, or switch a side to Edit and type.
              </p>
              <Button variant="outline" size="sm" onClick={() => void showExample(state.language)}>
                Show the example
              </Button>
            </div>
          )}
        </div>

        {dragging && (
          <div className="kit-compare-drop" data-testid="drop-targets">
            {SIDES.map(side => (
              <div
                key={side}
                className="kit-compare-drop-target"
                data-side={side}
                data-over={over === side ? '' : undefined}
                onDragOver={dragOver(side)}
                onDrop={dropOn(side)}>
                <span className="kit-compare-drop-label">
                  {`Drop to open as the ${sideWord(side)} text`}
                  <span className="kit-compare-drop-hint">Two files at once: the first is the original</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </TooltipProvider>
  );
};
