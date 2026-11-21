/**
 * The theme choice (D9, docs/theming.md §5.1), in Settings → Appearance only: the mode — System / Light / Dark, a
 * Segmented bar — and the pair, a light and a dark theme from themes.index.json. A profile that never chose is System
 * (DEFAULT_PREF): every page follows the system's light or dark setting live; one line under the bar says which. Writes the choice to chrome.storage.local; every page, the editor page
 * included, follows it from there.
 *
 * A swatch is an element with the theme's own `data-theme`: themes.css paints it with that theme's variables, so the
 * list shows each theme's colours without a single colour in the code.
 */
import { themesOf } from '@extension/theme';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ThemeMode, ThemePref } from '@extension/theme';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

const MODES: Array<{ mode: ThemeMode; label: string; icon: LucideIcon }> = [
  { mode: 'system', label: 'System', icon: MonitorIcon },
  { mode: 'light', label: 'Light', icon: SunIcon },
  { mode: 'dark', label: 'Dark', icon: MoonIcon },
];

const ThemeSelect = ({
  side,
  label,
  value,
  onChange,
}: {
  side: 'light' | 'dark';
  label: string;
  value: string;
  onChange: (id: string) => void;
}): ReactElement => {
  const id = `theme-${side}`;
  return (
    <div className="theme-field">
      <Label htmlFor={id} className="theme-field-label">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {themesOf(side).map(theme => (
            <SelectItem key={theme.id} value={theme.id}>
              <span className="theme-swatch" data-theme={theme.id} aria-hidden="true" />
              {theme.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

/** Whether the system asks for dark now, kept current when it changes (no reload). */
const useSystemDark = (): boolean => {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const on = (): void => setDark(media.matches);
    media.addEventListener('change', on);
    return () => media.removeEventListener('change', on);
  }, []);
  return dark;
};

/** What the chosen mode means, in one line: "System" is also what a choice never made is. */
const modeNote = (mode: ThemeMode, systemDark: boolean): string =>
  mode === 'system'
    ? `Follows your system’s light or dark setting, also when it changes — ${systemDark ? 'dark' : 'light'} now.`
    : `Always ${mode}, whatever your system is set to.`;

export const ThemePicker = ({
  pref,
  onChange,
}: {
  pref: ThemePref;
  onChange: (pref: ThemePref) => void;
}): ReactElement => {
  const systemDark = useSystemDark();
  return (
    <section className="theme-picker" aria-label="Theme">
      <div className="kit-sidebar-group-label">Theme</div>
      <ToggleGroup
        type="single"
        variant="segmented"
        size="sm"
        className="w-full"
        aria-label="Theme mode"
        value={pref.mode}
        onValueChange={(mode: string) => {
          // Radix offers '' when the pressed item is pressed again; a mode is always chosen.
          if (mode) onChange({ ...pref, mode: mode as ThemeMode });
        }}>
        {MODES.map(({ mode, label, icon: ModeIcon }) => (
          // The three share the row (the kit's segment is as wide as its label).
          <ToggleGroupItem key={mode} value={mode} className="flex-1">
            <ModeIcon aria-hidden="true" />
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="kit-settings-hint" data-theme-note={pref.mode}>
        {modeNote(pref.mode, systemDark)}
      </p>
      <ThemeSelect
        side="light"
        label="Light theme"
        value={pref.light}
        onChange={light => onChange({ ...pref, light })}
      />
      <ThemeSelect side="dark" label="Dark theme" value={pref.dark} onChange={dark => onChange({ ...pref, dark })} />
    </section>
  );
};
