/**
 * HotkeyInput — a field that records a keyboard shortcut. Focus it (click, or Tab to it) and press the combination: the
 * modifiers held so far show as you press them, and the first key that is not a modifier ends the recording and is
 * handed to `onRecord`. Escape gives up and leaves the field (the shortcut stays as it was); Backspace or Delete alone
 * asks to clear it (`onClear`); Tab alone leaves the field, so it never traps the keyboard. The field is an `<input>`
 * read only, with the kit's Input look (`cn-input`): no rules of its own.
 *
 * A recorded combination is portable, as the host stores it: `mod` is the platform's command modifier (⌘ on a Mac,
 * Ctrl elsewhere), `other` the platform's other one (⌃ on a Mac, the Windows / Super key elsewhere — a host may refuse
 * it: it has no counterpart on the other side), and `code` the physical key, so the combination does not change with
 * the keyboard layout. `formatHotkey` shows it as the platform does: the symbols in Apple's order on a Mac (⌥⇧⌘K),
 * the names joined by `+` elsewhere (Ctrl+Alt+Shift+K).
 */
import { cn } from '../lib/utils';
import { useState } from 'react';
import type { ComponentProps, KeyboardEvent, ReactElement } from 'react';

export interface Hotkey {
  /** `KeyboardEvent.key`, lower case. */
  key: string;
  /** `KeyboardEvent.code`: the physical key. */
  code?: string;
  mod: boolean;
  shift: boolean;
  alt?: boolean;
  other?: boolean;
}

export type HotkeyPlatform = 'mac' | 'other';

export const hotkeyPlatform = (nav: Pick<Navigator, 'platform' | 'userAgent'> = navigator): HotkeyPlatform =>
  /Mac|iPhone|iPad/.test(nav.platform || nav.userAgent) ? 'mac' : 'other';

const MODIFIERS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'OS', 'AltGraph']);

const NAMES: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Tab: 'Tab',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** The key itself: `K`, `1`, `/`, `F5`, `↑` — from the physical key when there is one. */
export const hotkeyKeyName = (hotkey: Pick<Hotkey, 'key' | 'code'>): string => {
  const code = hotkey.code ?? '';
  const letter = /^(?:Key|Digit|Numpad)(.+)$/.exec(code);
  if (letter) return letter[1].toUpperCase();
  if (NAMES[code]) return NAMES[code];
  if (/^F\d+$/.test(code)) return code;
  return hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
};

const modifiersOf = (h: Omit<Hotkey, 'key'>, platform: HotkeyPlatform): string[] =>
  platform === 'mac'
    ? [h.other && '⌃', h.alt && '⌥', h.shift && '⇧', h.mod && '⌘'].filter((m): m is string => !!m)
    : [h.mod && 'Ctrl', h.alt && 'Alt', h.shift && 'Shift', h.other && 'Win'].filter((m): m is string => !!m);

/** How the platform shows a combination: `⌥⇧⌘K` on a Mac, `Ctrl+Alt+Shift+K` elsewhere. */
export const formatHotkey = (hotkey: Hotkey, platform: HotkeyPlatform): string => {
  const parts = [...modifiersOf(hotkey, platform), hotkeyKeyName(hotkey)];
  return platform === 'mac' ? parts.join('') : parts.join('+');
};

/** The combination of a key event in the portable form, or null while only modifiers are held. */
export const hotkeyOf = (
  event: Pick<globalThis.KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform: HotkeyPlatform,
): Hotkey | null => {
  if (MODIFIERS.has(event.key)) return null;
  const mac = platform === 'mac';
  return {
    key: event.key.toLowerCase(),
    ...(event.code ? { code: event.code } : {}),
    mod: mac ? event.metaKey : event.ctrlKey,
    shift: event.shiftKey,
    ...(event.altKey ? { alt: true } : {}),
    ...((mac ? event.ctrlKey : event.metaKey) ? { other: true } : {}),
  };
};

export type HotkeyInputProps = Omit<ComponentProps<'input'>, 'value' | 'onKeyDown' | 'readOnly' | 'type'> & {
  value: Hotkey | null;
  platform: HotkeyPlatform;
  onRecord: (hotkey: Hotkey) => void;
  onClear?: () => void;
  /** Shown while the field waits for keys. */
  recordingText?: string;
  /** Shown when there is no shortcut. */
  emptyText?: string;
};

export const HotkeyInput = ({
  value,
  platform,
  onRecord,
  onClear,
  recordingText = 'Press the keys…',
  emptyText = 'None',
  className,
  onFocus,
  onBlur,
  ...props
}: HotkeyInputProps): ReactElement => {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string>('');

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape' && plain) {
      event.currentTarget.blur();
      return;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && plain) {
      setHeld('');
      onClear?.();
      return;
    }
    const hotkey = hotkeyOf(event, platform);
    if (!hotkey) {
      const mods = modifiersOf(
        {
          mod: platform === 'mac' ? event.metaKey : event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          other: platform === 'mac' ? event.ctrlKey : event.metaKey,
        },
        platform,
      );
      setHeld(mods.join(platform === 'mac' ? '' : '+'));
      return;
    }
    setHeld('');
    onRecord(hotkey);
  };

  const shown = recording
    ? held
      ? `${held}${platform === 'mac' ? '' : '+'}…`
      : value
        ? formatHotkey(value, platform)
        : ''
    : value
      ? formatHotkey(value, platform)
      : '';

  return (
    <input
      type="text"
      readOnly
      data-slot="hotkey-input"
      data-recording={recording ? '' : undefined}
      className={cn('cn-input w-full min-w-0 outline-none', className)}
      value={shown}
      placeholder={recording ? recordingText : emptyText}
      autoComplete="off"
      spellCheck={false}
      onKeyDown={onKeyDown}
      onKeyUp={() => setHeld('')}
      onFocus={e => {
        setRecording(true);
        onFocus?.(e);
      }}
      onBlur={e => {
        setRecording(false);
        setHeld('');
        onBlur?.(e);
      }}
      {...props}
    />
  );
};
