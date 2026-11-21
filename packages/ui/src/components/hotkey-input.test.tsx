import { HotkeyInput, formatHotkey, hotkeyOf, hotkeyPlatform } from './hotkey-input';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hotkey } from './hotkey-input';

afterEach(cleanup);

const K: Hotkey = { key: 'k', code: 'KeyK', mod: true, shift: false };

describe('formatHotkey: as the platform shows it', () => {
  it('a Mac: the symbols in Apple’s order, ⌃ for the other modifier', () => {
    expect(formatHotkey(K, 'mac')).toBe('⌘K');
    expect(formatHotkey({ ...K, shift: true, alt: true }, 'mac')).toBe('⌥⇧⌘K');
    expect(formatHotkey({ ...K, other: true }, 'mac')).toBe('⌃⌘K');
    expect(formatHotkey({ key: '/', code: 'Slash', mod: false, shift: false, alt: true }, 'mac')).toBe('⌥/');
  });

  it('elsewhere: the names joined by +, Win for the other modifier; the physical key names the key', () => {
    expect(formatHotkey(K, 'other')).toBe('Ctrl+K');
    expect(formatHotkey({ ...K, shift: true, alt: true }, 'other')).toBe('Ctrl+Alt+Shift+K');
    expect(formatHotkey({ ...K, other: true }, 'other')).toBe('Ctrl+Win+K');
    expect(formatHotkey({ key: 'ß', code: 'KeyS', mod: true, shift: false, alt: true }, 'other')).toBe('Ctrl+Alt+S');
    expect(formatHotkey({ key: 'f5', code: 'F5', mod: true, shift: false }, 'other')).toBe('Ctrl+F5');
  });

  it('knows the platform from the browser', () => {
    expect(hotkeyPlatform({ platform: 'MacIntel', userAgent: '' })).toBe('mac');
    expect(hotkeyPlatform({ platform: 'Win32', userAgent: '' })).toBe('other');
  });

  it('a key event: ⌘ on a Mac and Ctrl elsewhere are the same `mod`; modifiers alone are no combination', () => {
    const event = { key: 'J', code: 'KeyJ', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };
    expect(hotkeyOf(event, 'mac')).toEqual({ key: 'j', code: 'KeyJ', mod: true, shift: true });
    expect(hotkeyOf(event, 'other')).toEqual({ key: 'j', code: 'KeyJ', mod: false, shift: true, other: true });
    expect(hotkeyOf({ ...event, key: 'Meta', code: 'MetaLeft' }, 'mac')).toBeNull();
  });
});

describe('HotkeyInput: keyboard only', () => {
  const setup = (value: Hotkey | null = null, platform: 'mac' | 'other' = 'mac') => {
    const onRecord = vi.fn();
    const onClear = vi.fn();
    render(
      <HotkeyInput aria-label="Shortcut" value={value} platform={platform} onRecord={onRecord} onClear={onClear} />,
    );
    const field = screen.getByRole('textbox', { name: 'Shortcut' }) as HTMLInputElement;
    return { field, onRecord, onClear };
  };

  it('shows the combination, or “None”; focused it waits for keys', () => {
    const { field } = setup(K);
    expect(field.value).toBe('⌘K');
    expect(field.readOnly).toBe(true);
    cleanup();
    const empty = setup().field;
    expect(empty.placeholder).toBe('None');
    fireEvent.focus(empty);
    expect(empty.placeholder).toBe('Press the keys…');
    expect(empty.dataset.recording).toBe('');
  });

  it('every modifier: shows what is held, records on the first other key — the default of the key is cancelled', () => {
    const { field, onRecord } = setup();
    fireEvent.focus(field);
    fireEvent.keyDown(field, { key: 'Meta', code: 'MetaLeft', metaKey: true });
    expect(field.value).toBe('⌘…');
    fireEvent.keyDown(field, { key: 'Alt', code: 'AltLeft', metaKey: true, altKey: true });
    fireEvent.keyDown(field, { key: 'Shift', code: 'ShiftLeft', metaKey: true, altKey: true, shiftKey: true });
    expect(field.value).toBe('⌥⇧⌘…');
    const pressed = fireEvent.keyDown(field, { key: 'Ï', code: 'KeyJ', metaKey: true, altKey: true, shiftKey: true });
    expect(pressed).toBe(false);
    expect(onRecord).toHaveBeenCalledWith({ key: 'ï', code: 'KeyJ', mod: true, shift: true, alt: true });
  });

  it('elsewhere Ctrl is the command modifier and the Windows key the other one', () => {
    const { field, onRecord } = setup(null, 'other');
    fireEvent.focus(field);
    fireEvent.keyDown(field, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    expect(field.value).toBe('Ctrl+…');
    fireEvent.keyDown(field, { key: 'k', code: 'KeyK', ctrlKey: true, metaKey: true });
    expect(onRecord).toHaveBeenCalledWith({ key: 'k', code: 'KeyK', mod: true, shift: false, other: true });
  });

  it('Backspace alone asks to clear; Escape gives up and leaves; Tab alone moves on', () => {
    const { field, onRecord, onClear } = setup(K);
    field.focus();
    fireEvent.keyDown(field, { key: 'Backspace', code: 'Backspace' });
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(fireEvent.keyDown(field, { key: 'Tab', code: 'Tab' })).toBe(true);
    fireEvent.keyDown(field, { key: 'Escape', code: 'Escape' });
    expect(document.activeElement).not.toBe(field);
    expect(onRecord).not.toHaveBeenCalled();
  });
});
