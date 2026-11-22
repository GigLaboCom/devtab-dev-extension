import { defineConfig } from 'vitest/config';

// The component's tests: jsdom with what it lacks (@workspace/ui/testing), React once. The preview frame's stylesheet
// is processed (`css`): without it its `?url` is '' and its `?raw` is empty, and the tests could not see either.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'jsdom',
    css: { include: [/preview\.css/] },
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['@workspace/ui/testing'],
  },
});
