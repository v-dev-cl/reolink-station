import { defineConfig, defaultExclude } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // e2e/ holds the opt-in Playwright smoke spec (see e2e/smoke.spec.ts) — it uses
    // @playwright/test's own test()/expect() and must not be collected by Vitest.
    exclude: [...defaultExclude, 'e2e/**'],
  },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
});
