import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node env — flame-edge runs in edge runtimes (Web Crypto, fetch
    // as globals), which Node 19+ matches.
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
