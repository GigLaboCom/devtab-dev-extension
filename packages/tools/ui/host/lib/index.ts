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
 *
 * Per-tool settings are the second (settings.ts): a tool reads and follows its own entry, the host keeps it.
 *
 *   const values = useToolSettings(host, 'password');
 *   const autoCopy = useAutoCopy(host, 'password');    // "Copy automatically after generating" (autoCopy.ts)
 *   autoCopy.afterGenerate(text);                      // only from the person's Generate
 *
 * Navigation is the third (navigation.ts): a tool sends the person to another place of the host, handing it texts in
 * memory; with no host it cannot go and says so.
 *
 *   const went = await navigationOf(host).go({ part: 'compare' }, { replace: true, payload: { texts } });
 *
 * Every definition states its `output` (`ToolOutput`): whether it makes values on request and what one generation
 * copies — the capability automatic copying is offered by. A tool that recognises pasted text exports `detect`
 * (`ToolDetect`) from a module of its own (`./detect`), which a host loads only when it needs it.
 */
export { defaultToolHost, memoryHost, TEST_PASSWORD, unlockedHost } from './host';
export type {
  RestoreRequest,
  ToolDefinition,
  ToolDescription,
  ToolDetect,
  ToolDetectModule,
  ToolHost,
  ToolKey,
  ToolOutput,
  ToolProps,
  ToolShortcut,
} from './host';
export {
  createToolSettings,
  memoryToolSettings,
  memoryToolSettingsArea,
  normalizeToolSettings,
  upsertAll,
  upsertTool,
  valuesForTool,
} from './settings';
export type {
  OwnSettings,
  SettingValue,
  ToolSettings,
  ToolSettingsArea,
  ToolSettingsRecord,
  ToolSettingsStore,
  ToolSettingValues,
} from './settings';
export { useToolSettings } from './useToolSettings';
export { navigationOf, noNavigation } from './navigation';
export type { GoOptions, HandedText, Handover, HostPlace, ToolNavigation } from './navigation';
export { AUTO_COPY, AUTO_COPY_REFUSED, announceGenerated, autoCopyApplies, useAutoCopy } from './autoCopy';
export type { AutoCopy, AutoCopyOutcome } from './autoCopy';
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
