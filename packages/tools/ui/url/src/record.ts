/**
 * How the URL tool fills its history records (the declaration is history.ts): the payload, the label, the excerpt,
 * and which kind a record goes to. Imported by the component only, so none of it reaches the start page.
 */
import type { UrlMode, UrlStyle } from './history';

/** Payload of schema 1. */
export type UrlPayload = { mode: UrlMode; style: UrlStyle; plusAsSpace: boolean };

/**
 * User info in a URL: `://` (or `:\\`) then anything but a path, query or fragment start, then `@`. Starts only at a
 * colon and stops at the first delimiter, so it stays linear on a long input (a scheme pattern before the colon would
 * backtrack over every run of letters).
 */
const USER_INFO = /:(?:\/\/|\\\\)[^/?#\\\s@]*@/;

/** Does this text hold a URL with user info (a user name, a password, often a token)? Read by syntax, not by guess. */
export const carriesCredentials = (...texts: readonly string[]): boolean => texts.some(t => USER_INFO.test(t));

const STYLE_LABEL: Record<UrlStyle, string> = { component: 'Component', form: 'Form', whole: 'Whole URL' };

export const urlLabel = (p: UrlPayload, input: string, host?: string): string =>
  [
    p.mode === 'encode' ? 'Encode' : p.mode === 'decode' ? 'Decode' : 'Parse',
    p.mode === 'encode' ? STYLE_LABEL[p.style] : p.mode === 'decode' && p.plusAsSpace ? '+ as space' : '',
    p.mode === 'parse' && host ? host : `${input.length.toLocaleString('en-US')} characters`,
  ]
    .filter(Boolean)
    .join(' · ');

/** The first characters of the text, for the History list's text search. */
export const excerpt = (text: string): string => text.slice(0, 2000);

export const isMode = (v: unknown): v is UrlMode => v === 'encode' || v === 'decode' || v === 'parse';
export const isStyle = (v: unknown): v is UrlStyle => v === 'component' || v === 'form' || v === 'whole';
