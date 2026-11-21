import { defineConfig } from 'vitest/config';

// Component tests run in jsdom; React once, whichever package asks for it.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
