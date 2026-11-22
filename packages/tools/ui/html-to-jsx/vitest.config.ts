import { defineConfig } from 'vitest/config';

// The component's tests: jsdom with what it lacks (@workspace/ui/testing), React once.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['@workspace/ui/testing'],
  },
});
