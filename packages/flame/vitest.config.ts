import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    // Mirror the build-time replacement so tests that exercise init()
    // can `console.log` the version without ReferenceError.
    __VERSION__: JSON.stringify('0.2.0-test'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types.ts'],
    },
  },
});
