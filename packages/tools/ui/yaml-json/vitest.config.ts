import { defineConfig } from 'vitest/config';

// The component's tests: jsdom with what it lacks (@workspace/ui/testing), React once. The conversion runs on the page
// in jsdom (no workers), some tests convert large inputs: a generous timeout for a busy machine.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['@workspace/ui/testing'],
    testTimeout: 30_000,
  },
});
