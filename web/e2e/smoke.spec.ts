import { test, expect } from '@playwright/test';

// Requires: backend running on :3000 with a user TEST_EMAIL/TEST_PASSWORD, web on :3001.
const email = process.env.TEST_EMAIL ?? 'e2e@x.com';
const password = process.env.TEST_PASSWORD ?? 'password123';

test('login → camera list → create profile', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: 'Cameras' })).toBeVisible();
  await page.getByRole('link', { name: /add camera/i }).click();
  await expect(page.getByLabel('Name')).toBeVisible();
});
