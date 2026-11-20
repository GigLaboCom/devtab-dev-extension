/**
 * Languages offered for highlighting: D10's first languages plus a few common ones. `id` is the highlighter name
 * the editor accepts (gpui-kit's syntect lookup: docs/research/syntect-coverage.md); `text` = no highlighting.
 * Detection is by file extension only (D11: no server, so no language service).
 */
export interface LanguageOption {
  id: string;
  label: string;
  extensions: readonly string[];
}

export const LANGUAGES: readonly LanguageOption[] = [
  { id: 'text', label: 'Plain text', extensions: ['txt'] },
  { id: 'rust', label: 'Rust', extensions: ['rs'] },
  { id: 'typescript', label: 'TypeScript', extensions: ['ts', 'tsx', 'mts', 'cts'] },
  { id: 'javascript', label: 'JavaScript', extensions: ['js', 'mjs', 'cjs', 'jsx'] },
  { id: 'python', label: 'Python', extensions: ['py', 'pyi'] },
  { id: 'json', label: 'JSON', extensions: ['json', 'jsonc'] },
  { id: 'yaml', label: 'YAML', extensions: ['yaml', 'yml'] },
  { id: 'toml', label: 'TOML', extensions: ['toml'] },
  { id: 'markdown', label: 'Markdown', extensions: ['md', 'markdown'] },
  { id: 'go', label: 'Go', extensions: ['go'] },
  { id: 'java', label: 'Java', extensions: ['java'] },
];

/** The language of a file name, or undefined when its extension is not in the list. */
export const languageOfFile = (name: string): string | undefined => {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return undefined;
  const ext = name.slice(dot + 1).toLowerCase();
  return LANGUAGES.find(l => l.extensions.includes(ext))?.id;
};
