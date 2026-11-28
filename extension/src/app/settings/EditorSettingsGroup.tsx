/**
 * Settings → Editor (D39; research §6.2): the Default set of the editor's settings — the general values, then a row per
 * language that overrides them (add one, change it, reset it to its built-in values). Everything here is in every
 * edition (D39, D40). Saved at once into the store the shell's composition root names
 * (src/editorSettings/behaviors.ts); every open editor — project files, scratch files, both sides of «Compare code»,
 * in any tab of ours — takes the change without a reload. A write the store refuses is said in one line and what was
 * stored stays.
 *
 * Stage 2 (profiles, Pro) puts the choice of the profile above the general values; stage 3 (`.editorconfig`, Pro) a
 * switch under the languages. Neither is drawn yet: there is nothing to point to.
 */
import { EDITOR_TEXT } from '../editor/text';
import { useEditorRecord } from '../editor/useEditorIndent';
import { LANGUAGES, labelOf } from '@src/compare/languages';
import {
  BUILT_IN_LANGUAGES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  INDENT_SIZE_MAX,
  INDENT_SIZE_MIN,
  defaultEditorSettings,
  isEditorLanguage,
  languageChanged,
  withLanguage,
  withLanguageReset,
} from '@src/editorSettings/model';
import { Button } from '@workspace/ui/button';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Switch } from '@workspace/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { RotateCcwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EditorSettingsBehaviors } from '@src/editorSettings/behaviors';
import type { EditorSettingsRecord, EditorValues, LanguageValues } from '@src/editorSettings/model';
import type { EditorSettingsRefusal } from '@src/editorSettings/store';
import type { ReactElement } from 'react';

export interface EditorSettingsGroupProps {
  behaviors: EditorSettingsBehaviors;
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const INDENT_SIZES = range(INDENT_SIZE_MIN, INDENT_SIZE_MAX);
const FONT_SIZES = range(FONT_SIZE_MIN, FONT_SIZE_MAX);
/** A Select's value for "the general value" (Radix wants a non-empty one). */
const GENERAL = 'general';
const THEME = 'theme';

const refusalText = (refusal: EditorSettingsRefusal): string =>
  EDITOR_TEXT.notSaved(
    refusal.kind === 'full' ? EDITOR_TEXT.full : refusal.kind === 'too-large' ? EDITOR_TEXT.tooLarge : refusal.message,
  );

type SwitchField = 'detectIndent' | 'softWrap' | 'whitespace' | 'indentGuides' | 'lineNumbers';
const SWITCHES: ReadonlyArray<{ field: SwitchField; label: string; hint: string }> = [
  { field: 'detectIndent', label: EDITOR_TEXT.detect, hint: EDITOR_TEXT.detectHint },
  { field: 'softWrap', label: EDITOR_TEXT.softWrap, hint: EDITOR_TEXT.softWrapHint },
  { field: 'whitespace', label: EDITOR_TEXT.whitespace, hint: EDITOR_TEXT.whitespaceHint },
  { field: 'indentGuides', label: EDITOR_TEXT.indentGuides, hint: EDITOR_TEXT.indentGuidesHint },
  { field: 'lineNumbers', label: EDITOR_TEXT.lineNumbers, hint: EDITOR_TEXT.lineNumbersHint },
];

export const EditorSettingsGroup = ({ behaviors }: EditorSettingsGroupProps): ReactElement => {
  const stored = useEditorRecord(behaviors);
  // What the page shows: the stored set, or the change just made while it is being written.
  const [shown, setShown] = useState<EditorSettingsRecord>(stored);
  useEffect(() => setShown(stored), [stored]);
  const [note, setNote] = useState<string | null>(null);

  const save = (next: EditorSettingsRecord): void => {
    setShown(next);
    void behaviors.store.save(next).then(result => {
      if (result.ok) return setNote(null);
      setNote(refusalText(result.refused));
      setShown(stored);
    });
  };
  const setBase = <K extends keyof EditorValues>(field: K, value: EditorValues[K]): void =>
    save({ ...shown, base: { ...shown.base, [field]: value } });
  const setLanguageField = (language: string, field: keyof LanguageValues, value: unknown): void => {
    const row: Record<string, unknown> = { ...shown.languages[language] };
    if (value === undefined) delete row[field];
    else row[field] = value;
    save(withLanguage(shown, language, row as LanguageValues));
  };

  const { base } = shown;
  const rows = Object.keys(shown.languages)
    .filter(isEditorLanguage)
    .sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  const addable = LANGUAGES.filter(l => !(l.id in shown.languages));
  const changed = JSON.stringify(shown) !== JSON.stringify(defaultEditorSettings());
  const styleWord = (style: string): string => (style === 'tab' ? EDITOR_TEXT.tabs : EDITOR_TEXT.spaces);

  return (
    <section className="kit-settings-group" aria-labelledby="settings-editor" data-settings="editor">
      <h2 id="settings-editor" className="kit-settings-group-title">
        {EDITOR_TEXT.group}
      </h2>
      <p className="kit-settings-intro kit-settings-hint">{EDITOR_TEXT.intro}</p>
      {!behaviors.store.keeps && <p className="kit-settings-hint">{EDITOR_TEXT.inMemory}</p>}

      <div className="kit-settings-row" data-setting="indentStyle">
        <div className="kit-settings-text">
          <span id="editor-indent-style" className="kit-settings-label">
            {EDITOR_TEXT.indentWith}
          </span>
          <span className="kit-settings-hint">{EDITOR_TEXT.indentWithHint}</span>
        </div>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          aria-labelledby="editor-indent-style"
          value={base.indentStyle}
          onValueChange={(value: string) => {
            if (value === 'space' || value === 'tab') setBase('indentStyle', value);
          }}>
          <ToggleGroupItem value="space">{EDITOR_TEXT.spaces}</ToggleGroupItem>
          <ToggleGroupItem value="tab">{EDITOR_TEXT.tabs}</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="kit-settings-row" data-setting="indentSize">
        <div className="kit-settings-text">
          <Label htmlFor="editor-indent-size" className="kit-settings-label">
            {EDITOR_TEXT.indentSize}
          </Label>
          <span className="kit-settings-hint">{EDITOR_TEXT.indentSizeHint}</span>
        </div>
        <Select value={String(base.indentSize)} onValueChange={value => setBase('indentSize', Number(value))}>
          <SelectTrigger id="editor-indent-size" size="sm" className="kit-editor-settings-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INDENT_SIZES.map(size => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="kit-settings-row" data-setting="fontSize">
        <div className="kit-settings-text">
          <Label htmlFor="editor-font-size" className="kit-settings-label">
            {EDITOR_TEXT.fontSize}
          </Label>
          <span className="kit-settings-hint">{EDITOR_TEXT.fontSizeHint}</span>
        </div>
        <Select
          value={base.fontSize === null ? THEME : String(base.fontSize)}
          onValueChange={value => setBase('fontSize', value === THEME ? null : Number(value))}>
          <SelectTrigger id="editor-font-size" size="sm" className="kit-editor-settings-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={THEME}>{EDITOR_TEXT.fontSizeTheme}</SelectItem>
            {FONT_SIZES.map(size => (
              <SelectItem key={size} value={String(size)}>
                {`${size} px`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {SWITCHES.map(({ field, label, hint }) => (
        <div key={field} className="kit-settings-row" data-setting={field}>
          <div className="kit-settings-text">
            <Label htmlFor={`editor-${field}`} className="kit-settings-label">
              {label}
            </Label>
            {hint && (
              <span id={`editor-${field}-hint`} className="kit-settings-hint">
                {hint}
              </span>
            )}
          </div>
          <div className="kit-settings-controls">
            <Switch
              id={`editor-${field}`}
              {...(hint && { 'aria-describedby': `editor-${field}-hint` })}
              checked={base[field]}
              onCheckedChange={value => setBase(field, value)}
            />
          </div>
        </div>
      ))}

      <h3 id="editor-languages" className="kit-settings-subtitle">
        {EDITOR_TEXT.languagesTitle}
      </h3>
      <p className="kit-settings-intro kit-settings-hint">{EDITOR_TEXT.languagesIntro}</p>
      <div role="list" aria-labelledby="editor-languages">
        {rows.map(language => {
          const label = labelOf(language);
          const row = shown.languages[language] ?? {};
          const slug = `editor-language-${language}`;
          return (
            <div
              key={language}
              role="listitem"
              className="kit-settings-row kit-editor-language"
              data-language={language}>
              <div className="kit-settings-text">
                <span className="kit-settings-label">{label}</span>
              </div>
              <div className="kit-settings-controls kit-editor-language-controls">
                <Select
                  value={row.indentStyle ?? GENERAL}
                  onValueChange={value =>
                    setLanguageField(language, 'indentStyle', value === GENERAL ? undefined : value)
                  }>
                  <SelectTrigger
                    size="sm"
                    className="kit-editor-language-select"
                    aria-label={EDITOR_TEXT.fieldOf(EDITOR_TEXT.indentColumn, label)}
                    id={`${slug}-style`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GENERAL}>{EDITOR_TEXT.generalWith(styleWord(base.indentStyle))}</SelectItem>
                    <SelectItem value="space">{EDITOR_TEXT.spaces}</SelectItem>
                    <SelectItem value="tab">{EDITOR_TEXT.tabs}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={row.indentSize === undefined ? GENERAL : String(row.indentSize)}
                  onValueChange={value =>
                    setLanguageField(language, 'indentSize', value === GENERAL ? undefined : Number(value))
                  }>
                  <SelectTrigger
                    size="sm"
                    className="kit-editor-language-select"
                    aria-label={EDITOR_TEXT.fieldOf(EDITOR_TEXT.sizeColumn, label)}
                    id={`${slug}-size`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GENERAL}>{EDITOR_TEXT.generalWith(String(base.indentSize))}</SelectItem>
                    {INDENT_SIZES.map(size => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={row.softWrap === undefined ? GENERAL : row.softWrap ? 'on' : 'off'}
                  onValueChange={value =>
                    setLanguageField(language, 'softWrap', value === GENERAL ? undefined : value === 'on')
                  }>
                  <SelectTrigger
                    size="sm"
                    className="kit-editor-language-select"
                    aria-label={EDITOR_TEXT.fieldOf(EDITOR_TEXT.wrapColumn, label)}
                    id={`${slug}-wrap`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GENERAL}>
                      {EDITOR_TEXT.generalWith(base.softWrap ? EDITOR_TEXT.on : EDITOR_TEXT.off)}
                    </SelectItem>
                    <SelectItem value="on">{`${EDITOR_TEXT.wrapColumn}: ${EDITOR_TEXT.on}`}</SelectItem>
                    <SelectItem value="off">{`${EDITOR_TEXT.wrapColumn}: ${EDITOR_TEXT.off}`}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={EDITOR_TEXT.resetLanguage(label)}
                  title={EDITOR_TEXT.resetLanguageTitle(language in BUILT_IN_LANGUAGES)}
                  disabled={!languageChanged(shown, language)}
                  onClick={() => save(withLanguageReset(shown, language))}>
                  <RotateCcwIcon aria-hidden="true" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="kit-settings-row">
        <div className="kit-settings-text">
          <Label htmlFor="editor-add-language" className="kit-settings-label">
            {EDITOR_TEXT.addLanguage}
          </Label>
        </div>
        <Select value="" onValueChange={language => save(withLanguage(shown, language, {}))}>
          <SelectTrigger
            id="editor-add-language"
            size="sm"
            className="kit-editor-settings-select"
            disabled={!addable.length}>
            <SelectValue placeholder={EDITOR_TEXT.addLanguagePlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {addable.map(l => (
              <SelectItem key={l.id} value={l.id}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {note && (
        <p className="kit-settings-note" role="alert">
          {note}
        </p>
      )}
      <div className="kit-settings-actions">
        <Button variant="outline" size="sm" disabled={!changed} onClick={() => save(defaultEditorSettings())}>
          {EDITOR_TEXT.resetAll}
        </Button>
      </div>
    </section>
  );
};
