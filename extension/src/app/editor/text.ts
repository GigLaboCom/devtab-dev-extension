/**
 * Every word of the editor's settings (D39), in one place for the owner's approval: Settings → Editor (with its
 * profiles, Pro) and the indent indicator at each editor (with a project's `.editorconfig`, Pro). Working texts —
 * minimal and factual, nothing about a price or how to get Pro (D40); the owner writes the final ones (D22). The
 * apostrophe is ’.
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

  // ---- profiles (Pro; Settings → Editor) ----------------------------------------------------------------------------
  profilesTitle: 'Profiles',
  profilesIntro:
    'The values below belong to the active profile. A project can use another one: choose it in the indentation popup of one of its files.',
  /** The one line in the free edition, where the profiles would be. */
  profilesExcluded: 'Profiles are part of Pro.',
  /** The heading over the values, where there are profiles: whose values they are. */
  profileValues: (name: string) => `Values of ${name}`,
  profileActive: (name: string) => `Use ${name}`,
  profileRename: (name: string) => `Rename ${name}`,
  profileDuplicate: (name: string) => `Duplicate ${name}`,
  profileExport: (name: string) => `Export ${name}`,
  profileDelete: (name: string) => `Delete ${name}`,
  profileNameLabel: (name: string) => `New name for ${name}`,
  save: 'Save',
  cancel: 'Cancel',
  newProfile: 'New profile',
  newProfileHint: 'A copy of the active profile, under a name of its own. It becomes the active one.',
  newProfileName: 'Name of the new profile',
  create: 'Create',
  importProfile: 'Import…',
  importHint: 'A profile file exported here before. It is added next to the others.',
  deleteTitle: (name: string) => `Delete the profile “${name}”?`,
  deleteBody: 'Projects that use it go back to the active profile. An exported file keeps a copy.',
  deleteRun: 'Delete',
  created: (name: string) => `Created “${name}”.`,
  imported: (name: string) => `Imported “${name}”.`,
  deleted: (name: string) => `Deleted “${name}”.`,
  exported: (file: string) => `Saved as ${file}.`,
  notCreated: (reason: string) => `Not created: ${reason}`,
  notRenamed: (reason: string) => `Not renamed: ${reason}`,
  notImported: (reason: string) => `Not imported: ${reason}`,
  nameEmpty: 'a profile needs a name.',
  nameTooLong: (max: number) => `a name has at most ${max} characters.`,
  nameCharacters: 'the name has characters that cannot be part of one.',
  nameTaken: (name: string) => `there is already a profile named “${name}”.`,
  profilesFull: (max: number) => `there are already ${max} profiles, the most kept.`,
  fileTooLarge: (kib: number) => `the file is larger than ${kib} KiB.`,
  fileNotJson: 'the file is not JSON.',
  fileNotProfile: 'the file is not an editor profile exported from this extension.',
  fileUnreadable: 'the file could not be read.',
  profilesExcludedRefusal: 'profiles are part of Pro.',
  importedName: 'Imported profile',

  // ---- the indent indicator ---------------------------------------------------------------------------------------
  indicator: (style: IndentStyle, size: number) => (style === 'tab' ? `Tab: ${size}` : `Spaces: ${size}`),
  indicatorLabel: (summary: string, from: string) => `Indentation: ${summary}, ${from}. Change it for this file`,
  /** The short word after the value: where it came from (`profile`: the profile in force when it is not Default). */
  sourceWord: (source: Source, language: string, profile?: string): string =>
    ({
      file: 'this file',
      project: 'EditorConfig',
      detected: 'detected',
      language,
      general: profile ?? 'default',
      default: 'default',
    })[source],
  /**
   * The sentence in the popup: where the value came from (`profile`: the profile in force when it is not Default;
   * `files`: the `.editorconfig` files that decided).
   */
  sourceSentence: (source: Source, language: string, profile?: string, files: readonly string[] = []): string =>
    ({
      file: 'Chosen for this file until it is closed.',
      project: files.length ? `Set by ${files.join(' and ')}.` : 'From the project’s .editorconfig.',
      detected: 'Detected from the file’s content.',
      language: profile
        ? `${language}’s value in the profile “${profile}”.`
        : `${language}’s value in Settings → Editor.`,
      general: profile ? `The profile “${profile}”.` : 'The default in Settings → Editor.',
      default: 'The built-in default.',
    })[source],
  /** The one line in the free edition, in the popup of a project's file. */
  projectExcluded: 'Settings from a project’s .editorconfig are part of Pro.',
  projectUnreadable: (file: string) => `${file} could not be read, so the project’s settings are not used.`,
  projectOverLimits: (file: string) => `${file} is over the limits read here, so the project’s settings are not used.`,
  projectProfile: 'Profile of this project',
  projectProfileActive: (name: string) => `As in Settings (${name})`,
  popupTitle: 'Indentation of this file',
  popupTitleSide: (side: string) => `Indentation of the ${side} side`,
  sizeLabel: 'Size',
  automatic: 'Back to automatic',
  automaticHint: 'Detected from the content when it can be, otherwise the settings.',
  openSettings: 'Editor settings',
};
