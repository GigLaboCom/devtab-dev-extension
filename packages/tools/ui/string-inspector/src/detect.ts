/**
 * Does pasted text hide something the String Inspector reveals (docs/tools/specs/string-inspector.md §7)? The package's
 * `./detect` export, a module of its own: a host loads it only when pasted text needs it, never with the list of tools.
 * It imports the tool's own logic and nothing else.
 */
export { detectStringIssues as detect } from '@workspace/tool-logic-string-inspector';
