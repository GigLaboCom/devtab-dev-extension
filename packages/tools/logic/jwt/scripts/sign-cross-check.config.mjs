// The signing cross-check with this machine's OpenSSL (scripts/sign-cross-check.check.mjs) — not part of the package's tests.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['scripts/sign-cross-check.check.mjs'], testTimeout: 300_000 } });
