/**
 * Every word of the editor's settings (D39), in one place for the owner's approval: Settings → Editor and the indent
 * indicator at each editor. Working texts — minimal and factual; the owner writes the final ones (D22). The apostrophe
 * is ’.
 */
import type { IndentStyle } from '@src/editorSettings/model';
import type { Source } from '@src/editorSettings/resolve';

export const EDITOR_TEXT = {
  // ---- Settings → Editor ------------------------------------------------------------------------------------------
  group: 'Editor',
  intro:
    'How the editors indent and show code: project files, scratch files and Compare code. A file that is already indented keeps its own indentation; the indicator at each editor changes it for one file.',
  indentWith: 'Indent with',
  indentWithHint: 'What Tab inserts and what one indent level is.',
  spaces: 'Spaces',
  tabs: 'Tabs',
  indentSize: 'Indent size',
  indentSizeHint: 'Spaces per level, and how wide a tab is drawn.',
  detect: 'Detect indentation from the file',
  detectHint: 'A file with at least five indented lines keeps the indentation it uses.',
  fontSize: 'Code font size',
  fontSizeHint: 'In every editor.',
  fontSizeTheme: 'Theme’s',
  softWrap: 'Wrap long lines',
  softWrapHint: 'In a single file. Side-by-side comparisons do not wrap, so their lines stay level.',
  whitespace: 'Show spaces and tabs',
  whitespaceHint: 'Spaces as dots, tabs as arrows.',
  indentGuides: 'Indent guides',
  indentGuidesHint: 'A thin line at each indent level.',
  lineNumbers: 'Line numbers',
  lineNumbersHint: '',
  languagesTitle: 'Languages',
  languagesIntro:
    'A language’s row overrides the values above for its files. Go, Markdown, Plain text, Ruby and YAML start with values of their own.',
  general: 'General',
  generalWith: (value: string) => `General (${value})`,
  on: 'On',
  off: 'Off',
  wrapColumn: 'Wrap',
  indentColumn: 'Indent',
  sizeColumn: 'Size',
  addLanguage: 'Add a language',
  addLanguagePlaceholder: 'Add a language…',
  resetLanguage: (language: string) => `Reset ${language}`,
  resetLanguageTitle: (hasBuiltIn: boolean) => (hasBuiltIn ? 'Back to the built-in values' : 'Remove this row'),
  fieldOf: (field: string, language: string) => `${field} for ${language}`,
  resetAll: 'Reset editor settings',
  notSaved: (reason: string) => `Not saved: ${reason}`,
  full: 'the extension’s storage in this browser is full.',
  tooLarge: 'the settings are too large to keep.',
  inMemory: 'This page has no storage: these settings last only while it is open.',

  // ---- the indent indicator ---------------------------------------------------------------------------------------
  indicator: (style: IndentStyle, size: number) => (style === 'tab' ? `Tab: ${size}` : `Spaces: ${size}`),
  indicatorLabel: (summary: string, from: string) => `Indentation: ${summary}, ${from}. Change it for this file`,
  /** The short word after the value: where it came from. */
  sourceWord: (source: Source, language: string): string =>
    ({
      file: 'this file',
      project: 'project',
      detected: 'detected',
      language,
      general: 'default',
      default: 'default',
    })[source],
  /** The sentence in the popup: where the value came from. */
  sourceSentence: (source: Source, language: string): string =>
    ({
      file: 'Chosen for this file until it is closed.',
      project: 'From the project’s settings.',
      detected: 'Detected from the file’s content.',
      language: `${language}’s value in Settings → Editor.`,
      general: 'The default in Settings → Editor.',
      default: 'The built-in default.',
    })[source],
  popupTitle: 'Indentation of this file',
  popupTitleSide: (side: string) => `Indentation of the ${side} side`,
  sizeLabel: 'Size',
  automatic: 'Back to automatic',
  automaticHint: 'Detected from the content when it can be, otherwise the settings.',
  openSettings: 'Editor settings',
};
