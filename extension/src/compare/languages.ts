/**
 * Languages offered for highlighting. `id` is the highlighter name the editor accepts (gpui-kit's syntect lookup:
 * docs/research/syntect-coverage.md); each of them is one the module colours — gpui-kit's own test
 * `common_fence_names_find_a_syntax` holds that its syntax set has them, and `pnpm test:e2e` sees each language's
 * example coloured in the module. `text` = no highlighting. TSX and JSX go to `tsx`: syntect's JavaScript syntax reads
 * JSX tags as strings. Detection is by file name only (D11: no server, so no language service) — until the
 * `LanguageDetector` seam moves into Rust (docs/replaceable-behaviors.md).
 */
export interface LanguageOption {
  id: string;
  label: string;
  extensions: readonly string[];
}

export const LANGUAGES: readonly LanguageOption[] = [
  { id: 'text', label: 'Plain text', extensions: ['txt', 'text', 'log'] },
  { id: 'bash', label: 'Shell', extensions: ['sh', 'bash', 'zsh'] },
  { id: 'c', label: 'C', extensions: ['c', 'h'] },
  { id: 'cpp', label: 'C++', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'] },
  { id: 'csharp', label: 'C#', extensions: ['cs'] },
  { id: 'css', label: 'CSS', extensions: ['css', 'scss'] },
  { id: 'go', label: 'Go', extensions: ['go'] },
  { id: 'html', label: 'HTML', extensions: ['html', 'htm'] },
  { id: 'java', label: 'Java', extensions: ['java'] },
  { id: 'javascript', label: 'JavaScript', extensions: ['js', 'mjs', 'cjs'] },
  { id: 'json', label: 'JSON', extensions: ['json', 'jsonc'] },
  { id: 'kotlin', label: 'Kotlin', extensions: ['kt', 'kts'] },
  { id: 'markdown', label: 'Markdown', extensions: ['md', 'markdown'] },
  { id: 'php', label: 'PHP', extensions: ['php'] },
  { id: 'python', label: 'Python', extensions: ['py', 'pyi'] },
  { id: 'ruby', label: 'Ruby', extensions: ['rb'] },
  { id: 'rust', label: 'Rust', extensions: ['rs'] },
  { id: 'sql', label: 'SQL', extensions: ['sql'] },
  { id: 'swift', label: 'Swift', extensions: ['swift'] },
  { id: 'toml', label: 'TOML', extensions: ['toml'] },
  { id: 'tsx', label: 'TSX / JSX', extensions: ['tsx', 'jsx'] },
  { id: 'typescript', label: 'TypeScript', extensions: ['ts', 'mts', 'cts'] },
  { id: 'yaml', label: 'YAML', extensions: ['yaml', 'yml'] },
];

/** The language of a file name, or undefined when its extension is not in the list. */
export const languageOfFile = (name: string): string | undefined => {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return undefined;
  const ext = name.slice(dot + 1).toLowerCase();
  return LANGUAGES.find(l => l.extensions.includes(ext))?.id;
};

/** A file extension for text of a language (what Save suggests for a side with no file name). */
export const extensionOf = (language: string): string => LANGUAGES.find(l => l.id === language)?.extensions[0] ?? 'txt';

export const labelOf = (language: string): string => LANGUAGES.find(l => l.id === language)?.label ?? language;
