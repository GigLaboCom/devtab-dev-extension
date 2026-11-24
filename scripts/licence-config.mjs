#!/usr/bin/env node
// The licence configuration as the build sees it: bundles the composition roots extension/src/licence/index.ts (seam
// LicenceConfig), extension/src/edition/index.ts (seam EditionSource) and extension/src/plans/index.ts (seam
// PlanSource) — read-definitions.mjs — and prints what they choose:
//   { "licence": { "id", "origin", "keys": [{ "kid", "x", "y" }], "payHosts", "siteUrl", "testCurrencies" },
//     "editionSource": "<id>", "planSource": "<id>" }
// For scripts/validate-build.sh (the licence parts of Check 17) and the e2e checks, so the roots stay the one source of
// which keys a build trusts and where it may connect. The roots as written: a DEVTAB_VARIANT build is not read here.
// The manifest does not read this: it names the licence origin itself (extension/build/licenceOrigin.ts).
//
// Usage: node scripts/licence-config.mjs
import { APP_ALIAS, at, readDefinitions } from './read-definitions.mjs';

const config = await readDefinitions(
  `
  import { licence } from ${at('extension/src/licence/index.ts')};
  import { editionSource } from ${at('extension/src/edition/index.ts')};
  import { planSource } from ${at('extension/src/plans/index.ts')};
  export default {
    licence: {
      id: licence.id,
      origin: licence.origin ?? null,
      keys: licence.keys.map(({ kid, jwk }) => ({ kid, x: jwk.x, y: jwk.y })),
      payHosts: licence.payHosts,
      siteUrl: licence.siteUrl ?? null,
      testCurrencies: licence.testCurrencies,
    },
    editionSource: editionSource.id,
    planSource: planSource.id,
  };
`,
  { alias: APP_ALIAS },
);
process.stdout.write(`${JSON.stringify(config)}\n`);
