/** @workspace/tool-logic-curl-to-code — the cURL to Code tool's logic, everything its component and its definition use. */
export * from './logic';
export { curlUrlEncode, parseCurl } from './parse';
export { loadGenerator } from './load';
export { DEFAULT_TARGET, TARGETS, TARGET_GROUPS, isTarget, targetInfo } from './targets';
export type { Family, TargetGroup, TargetInfo } from './targets';
export { isCmdForm, splitWords } from './words';
export type { Word, Words } from './words';
export type * from './types';
// Each family's writers, for the tool's workers: a worker imports one of them and nothing of the others.
export { clients as javascriptClients } from './clients/javascript';
export { clients as pythonClients } from './clients/python';
export { clients as shellClients } from './clients/shell';
export { clients as javaClients } from './clients/java';
export { clients as csharpClients } from './clients/csharp';
export { clients as phpClients } from './clients/php';
export { clients as powershellClients } from './clients/powershell';
export { clients as goClients } from './clients/go';
export { clients as rustClients } from './clients/rust';
export { clients as kotlinClients } from './clients/kotlin';
export { clients as dartClients } from './clients/dart';
export { clients as rubyClients } from './clients/ruby';
export { clients as swiftClients } from './clients/swift';
