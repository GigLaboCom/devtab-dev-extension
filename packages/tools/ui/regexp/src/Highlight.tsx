/**
 * «Matches in text» (docs/tools/specs/regexp.md §5 п. 17–19, §8): the test text read-only, every match a `<mark>` —
 * React elements with the text as their child, never `innerHTML`; colours are token classes, no `style`. Neighbouring
 * matches alternate two shades, the selected one is ringed, an empty match is a 2 px bar the height of the line.
 *
 * Up to 10,000 matches are highlighted, which is up to about 20,000 nodes: they are not built at once. The segments
 * go in chunks — the first ones with the render, then one more chunk per animation frame — and the text after the
 * last chunk built so far stands as plain text meanwhile, so the whole text is always there and no frame builds more
 * than one chunk (measured in scripts/e2e-tools/regexp.mjs). Each chunk is memoised: selecting a match re-renders
 * only the chunks holding the old and the new selection.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Match, Segment } from '@workspace/tool-logic-regexp';
import type { ReactElement } from 'react';

/** Segments per chunk: one chunk is what a frame builds (about half of them marks). */
export const CHUNK = 1_000;
/** Chunks built with the first render, before any frame passes. */
const FIRST_CHUNKS = 2;

const SHADES = ['bg-primary/15', 'bg-primary/30'] as const;

interface ChunkProps {
  text: string;
  segments: readonly Segment[];
  matches: readonly Match[];
  /** The selected match if it is in this chunk, else -1 (so other chunks keep their props). */
  selected: number;
}

const Chunk = memo(({ text, segments, matches, selected }: ChunkProps): ReactElement => (
  <>
    {segments.map(s => {
      // Plain text is a text node, not an element: half the nodes of a text with many matches.
      if (s.kind === 'plain') return text.slice(s.start, s.end);
      const m = matches[s.match]!;
      const where = `line ${m.line}, column ${m.column}`;
      const ring = s.match === selected ? ' ring-2 ring-ring' : '';
      if (s.kind === 'empty')
        return (
          <mark
            key={`m${s.match}`}
            data-match={s.match}
            title={`Match ${s.match + 1}: ${where}`}
            aria-label={`Empty match at ${where}`}
            className={`inline-block h-[1lh] w-0.5 cursor-pointer align-bottom bg-primary${ring}`}
          />
        );
      return (
        <mark
          key={`m${s.match}`}
          data-match={s.match}
          title={`Match ${s.match + 1}: ${where}`}
          className={`cursor-pointer rounded-sm text-inherit ${SHADES[s.match % 2]}${ring}`}>
          {text.slice(s.start, s.end)}
        </mark>
      );
    })}
  </>
));
Chunk.displayName = 'Chunk';

export interface HighlightProps {
  text: string;
  segments: readonly Segment[];
  matches: readonly Match[];
  selected: number;
  onSelect: (match: number) => void;
}

export const Highlight = ({ text, segments, matches, selected, onSelect }: HighlightProps): ReactElement => {
  const region = useRef<HTMLDivElement>(null);
  // The chunks' segments, sliced once per result: a chunk keeps its props (and is not rendered again) as more come.
  const slices = useMemo(() => {
    const out: Segment[][] = [];
    for (let at = 0; at < segments.length; at += CHUNK) out.push(segments.slice(at, at + CHUNK));
    return out;
  }, [segments]);
  const chunks = slices.length;
  const [built, setBuilt] = useState({ segments, count: FIRST_CHUNKS });
  // New segments start over from the first chunks (state reset during render, React's way for derived state).
  const count = built.segments === segments ? built.count : FIRST_CHUNKS;
  if (built.segments !== segments) setBuilt({ segments, count: FIRST_CHUNKS });

  useEffect(() => {
    if (count >= chunks) return;
    const frame = requestAnimationFrame(() =>
      setBuilt(b => (b.segments === segments ? { segments, count: b.count + 1 } : b)),
    );
    return () => cancelAnimationFrame(frame);
  }, [count, chunks, segments]);

  // A chosen match not built yet: build up to its chunk.
  const selectedChunk = selected >= 0 ? segments.findIndex(s => s.kind !== 'plain' && s.match === selected) : -1;
  const needed = selectedChunk < 0 ? 0 : Math.floor(selectedChunk / CHUNK) + 1;
  if (needed > count && built.segments === segments) setBuilt({ segments, count: needed });

  // The selected mark into view, inside this region only (the page does not jump).
  useLayoutEffect(() => {
    const box = region.current;
    const mark = box?.querySelector<HTMLElement>(`mark[data-match="${selected}"]`);
    if (!box || !mark) return;
    const outer = box.getBoundingClientRect();
    const inner = mark.getBoundingClientRect();
    if (inner.top < outer.top || inner.bottom > outer.bottom)
      box.scrollTop += inner.top - outer.top - (outer.height - inner.height) / 2;
  }, [selected, count]);

  // A click on a mark selects it. A native listener on the region: the region takes no focus (§8) — the table is the
  // way to the same matches from the keyboard.
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    const box = region.current;
    if (!box) return;
    const click = (event: MouseEvent) => {
      const mark = (event.target as Element | null)?.closest?.('mark[data-match]');
      if (mark) select.current(Number(mark.getAttribute('data-match')));
    };
    box.addEventListener('click', click);
    return () => box.removeEventListener('click', click);
  }, []);

  const shown = Math.min(count, chunks);
  const parts: ReactElement[] = [];
  for (let c = 0; c < shown; c++) {
    const inChunk = selectedChunk >= 0 && Math.floor(selectedChunk / CHUNK) === c;
    parts.push(
      <Chunk key={c} text={text} segments={slices[c]!} matches={matches} selected={inChunk ? selected : -1} />,
    );
  }
  const tail = shown < chunks ? segments[shown * CHUNK]!.start : text.length;
  const rest = segments.length === 0 ? text : text.slice(tail);

  return (
    <div
      ref={region}
      role="region"
      aria-label="Matches in text"
      data-built={shown === chunks ? 'all' : `${shown}/${chunks}`}
      className="cn-textarea h-90 overflow-auto font-mono text-code break-words whitespace-pre-wrap [tab-size:4]">
      {parts}
      {rest && <span data-rest>{rest}</span>}
    </div>
  );
};
