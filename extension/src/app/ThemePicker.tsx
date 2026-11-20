/**
 * The theme choice (D9, docs/theming.md §5.1): the mode — System / Light / Dark, a Segmented bar — and the pair, a
 * light and a dark theme from themes.index.json. Writes the choice to chrome.storage.local; every page, the editor page
 * included, follows it from there.
 *
 * A swatch is an element with the theme's own `data-theme`: themes.css paints it with that theme's variables, so the
 * list shows each theme's colours without a single colour in the code.
 */
import { themesOf } from '@extension/theme';
import { Label } from '@src/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@src/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@src/components/ui/toggle-group';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
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

export const ThemePicker = ({
  pref,
  onChange,
}: {
  pref: ThemePref;
  onChange: (pref: ThemePref) => void;
}): ReactElement => (
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
        <ToggleGroupItem key={mode} value={mode}>
          <ModeIcon aria-hidden="true" />
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
    <ThemeSelect side="light" label="Light theme" value={pref.light} onChange={light => onChange({ ...pref, light })} />
    <ThemeSelect side="dark" label="Dark theme" value={pref.dark} onChange={dark => onChange({ ...pref, dark })} />
  </section>
);
