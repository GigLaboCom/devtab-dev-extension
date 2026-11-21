/**
 * The RegExp tool's history entries (schema 1 of its payload): what a record carries and how the History list labels
 * it. Kept out of history.ts, which every host page that lists the tools loads.
 *
 * The pattern (at most 10,000 characters) and the flags are in the payload; the test text and the replacement — any
 * length — are blobs (`text`, `replacement`), deduplicated by content.
 */
import { formatCount } from '@workspace/tool-logic-regexp';
import type { HistoryDraft } from '@workspace/tools-host';

/** Payload of schema 1 (a type, not an interface: it must be a JSON value). */
export type RegexpPayload = {
  pattern: string;
  /** As the toggles hold them (canonical, without d). */
  flags: string;
  replace: boolean;
  /** What the run of this state gave, when it had answered: the number of matches (at most 10,000), or why none. */
  outcome?: { matches: number; truncated: boolean } | { error: string } | { stopped: true };
  /** Set when something was taken (committed); absent for an edit snapshot. */
  action?: 'copy-regex' | 'copy-matches' | 'copy-result';
};

export interface RegexpState {
  pattern: string;
  flags: string;
  text: string;
  replace: boolean;
  replacement: string;
}

const LABEL_PATTERN = 60;

/** `/(\d{4})-(\d{2})/g · 2 matches` — the pattern as a literal, cut, and the outcome. */
export const label = (p: RegexpPayload): string => {
  const body = p.pattern.length > LABEL_PATTERN ? `${p.pattern.slice(0, LABEL_PATTERN - 1)}…` : p.pattern;
  const o = p.outcome;
  const outcome =
    o === undefined
      ? ''
      : 'error' in o
        ? 'error'
        : 'stopped' in o
          ? 'stopped'
          : o.truncated
            ? `${formatCount(o.matches)}+ matches`
            : o.matches === 1
              ? '1 match'
              : `${formatCount(o.matches)} matches`;
  return [`/${body}/${p.flags}`, p.replace ? 'replace' : '', outcome].filter(Boolean).join(' · ');
};

/** What the History list searches: the pattern and the start of the text. */
export const excerpt = (s: RegexpState): string => `${s.pattern}\n${s.text}`.slice(0, 2000);

export const draft = (
  s: RegexpState,
  outcome?: RegexpPayload['outcome'],
  action?: RegexpPayload['action'],
): HistoryDraft => {
  const payload: RegexpPayload = {
    pattern: s.pattern,
    flags: s.flags,
    replace: s.replace,
    ...(outcome ? { outcome } : {}),
    ...(action ? { action } : {}),
  };
  return {
    kind: s.replace ? 'replace' : 'match',
    payload,
    label: label(payload),
    text: excerpt(s),
    blobs: {
      text: new Blob([s.text], { type: 'text/plain' }),
      ...(s.replace ? { replacement: new Blob([s.replacement], { type: 'text/plain' }) } : {}),
    },
  };
};

/** The fields of a payload that a restore can trust (an older or damaged record may lack some). */
export const readPayload = (value: unknown): Pick<RegexpPayload, 'pattern' | 'flags' | 'replace'> => {
  const p = (value ?? {}) as Partial<RegexpPayload>;
  return {
    pattern: typeof p.pattern === 'string' ? p.pattern : '',
    flags: typeof p.flags === 'string' ? p.flags : 'g',
    replace: p.replace === true,
  };
};
