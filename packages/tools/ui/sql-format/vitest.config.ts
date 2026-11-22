import { defineConfig } from 'vitest/config';

// The component's tests: jsdom with what it lacks (@workspace/ui/testing), React once. The workers' body runs on the page
// with the real library (no workers in jsdom), and some tests format large inputs or every dialect: a generous timeout
// for a busy machine.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['@workspace/ui/testing'],
    testTimeout: 60_000,
  },
});
