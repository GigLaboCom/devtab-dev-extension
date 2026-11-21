/**
 * @workspace/tools-host — what a tool gets from the application it runs in (D14). Whatever depends on the host is a
 * member of `ToolHost`, with a default that needs no host: a tool rendered with no host at all works. Also the shape of
 * a tool's definition (`ToolDefinition`, what its `ui` package exports) and the hooks tools share (`useNow`).
 *
 * The tool history (D17) is the first member. A tool asks for the history of its own id under its declaration and
 * records through a recorder; it never imports storage, `chrome.*` or the extension:
 *
 *   const { recorder, status } = useToolHistory(host, 'json', jsonHistory);
 *   recorder.change(draft);            // inputs or options changed — recorded by the checkpoint rule
 *   await recorder.commit(draft);      // a result of an explicit action — recorded at once
 *   useRestore(history, restore, opened => apply(opened));   // the host asks to open an entry in the tool
 */
export { defaultToolHost, memoryHost } from './host';
export type { RestoreRequest, ToolDefinition, ToolDescription, ToolHost, ToolProps } from './host';
export { useHistoryStatus, useRestore, useToolHistory } from './hooks';
export { useNow } from './useNow';
export type {
  EntrySummary,
  HistoryDeclaration,
  HistoryDraft,
  HistoryFactory,
  HistoryKind,
  HistoryRecorder,
  OpenedEntry,
  RecordingStatus,
  RecordOutcome,
  ToolHistory,
} from '@workspace/tools-shared/history';
export { NOTHING } from '@workspace/tools-shared/history';
