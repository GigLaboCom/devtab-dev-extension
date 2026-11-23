import { defineConfig } from 'vitest/config';

// Node has WebCrypto (globalThis.crypto.subtle); the package needs nothing of a page.
export default defineConfig({
  test: { environment: 'node' },
});
