import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: process.env.WEB_URL ?? 'http://localhost:3001' },
});
