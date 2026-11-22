// The cross-check with this machine's programs (scripts/cross-check.check.mjs) — not part of the package's tests.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['scripts/cross-check.check.mjs'], testTimeout: 600_000 } });
