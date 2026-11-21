#!/usr/bin/env node
// The start page's parts as the build sees them: bundles extension/src/start/parts/index.ts (plain modules, relative
// imports only; read-definitions.mjs), creates the definitions without their run-time dependencies, and prints what
// they declare: `{ "parts": [{ "id", "kind", "permissions": [{ "name", "optional" }] }], "required": [...],
// "optional": [...] }`. scripts/validate-build.sh and scripts/e2e-start.mjs hold the built manifest to it, so the
// definitions stay the one source of the extension's start-page permissions.
//
// Usage: node scripts/start-parts.mjs
import { at, readDefinitions } from './read-definitions.mjs';

const declared = await readDefinitions(
  `
  import { partDefinitions } from ${at('extension/src/start/parts/index.ts')};
  import { declaredPermissions } from ${at('extension/src/start/part.ts')};
  const parts = partDefinitions();
  export default {
    parts: parts.map(p => ({ id: p.id, kind: p.kind, permissions: p.permissions.map(({ name, optional }) => ({ name, optional })) })),
    ...declaredPermissions(parts),
  };
`,
  // The data modules are loaded only when a part runs; the definitions do not need them.
  { external: ['*.data'] },
);
process.stdout.write(`${JSON.stringify(declared)}\n`);
