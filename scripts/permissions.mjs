#!/usr/bin/env node
// The extension's permissions as the build sees them, from the definitions that declare them: the start page's parts
// (extension/src/start/parts/index.ts) and the main page's sections (extension/src/app/sectionPermissions.ts — the
// Projects section's optional `nativeMessaging`). Bundles them (plain modules, relative imports only;
// read-definitions.mjs), creates the definitions without their run-time dependencies, and prints
//   { "required": [...], "optional": [...],
//     "sources": [{ "id", "kind": "part" | "section", "name", "optional" }],
//     "parts": [{ "id", "kind", "title", "defaultOn", "loadAt", "permissions": [{ "name", "optional" }] }] }
// `required` and `optional` are what manifest.config.ts puts in the manifest (besides `storage`, the page's own).
// scripts/validate-build.sh (Check 10) and scripts/e2e-start.mjs hold the built manifest to it, so the definitions stay
// the one source of the extension's permissions.
//
// Usage: node scripts/permissions.mjs
import { at, readDefinitions } from './read-definitions.mjs';

const declared = await readDefinitions(
  `
  import { partDefinitions } from ${at('extension/src/start/parts/index.ts')};
  import { sectionPermissions } from ${at('extension/src/app/sectionPermissions.ts')};
  const parts = partDefinitions();
  const sections = sectionPermissions();
  const sources = [
    ...parts.flatMap(p => p.permissions.map(({ name, optional }) => ({ id: p.id, kind: 'part', name, optional }))),
    ...sections.flatMap(s => s.permissions.map(({ name, optional }) => ({ id: s.id, kind: 'section', name, optional }))),
  ];
  const unique = names => [...new Set(names)];
  export default {
    required: unique(sources.filter(s => !s.optional).map(s => s.name)),
    optional: unique(sources.filter(s => s.optional).map(s => s.name)),
    sources,
    parts: parts.map(p => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      defaultOn: p.defaultOn,
      loadAt: p.loadAt,
      permissions: p.permissions.map(({ name, optional }) => ({ name, optional })),
    })),
  };
`,
  // A part's code (`<id>.run`, with its data modules) loads only while the part is on; the definitions do not need it.
  { external: ['*.run', '*.data'] },
);
process.stdout.write(`${JSON.stringify(declared)}\n`);
