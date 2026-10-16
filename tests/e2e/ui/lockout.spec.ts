// AUTHENTICATION_TESTING.md lockout items, driven through the real login page. Earlier failures
// are backdated into login_attempts (arrange step) so the tiers are reachable without waiting
// through each cooldown in real time, and the page clock is paused so the lockout countdown
// cannot run out while an assertion is still waiting on a slow (cold) login function.
import { expect, test } from '@playwright/test';
import { ACCOUNTS } from '../support/accounts.ts';
import { clearLoginAttempts, seedFailedAttempts } from '../support/supabase.ts';
import { loginForm, loginViaUi } from '../support/ui.ts';

test.beforeEach(() => { test.slow(); }); // the local login function can be slow to cold-start under load

test('3rd failure locks for 10s: countdown shown, submit disabled, then released', async ({ page }) => {
  const { email } = ACCOUNTS.lockTier1;
  await clearLoginAttempts(email);
  await seedFailedAttempts(email, 2, 60); // two earlier failures, below the first tier
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1_000);

  const res = await loginViaUi(page, email, 'wrong-password');
  expect(res).toMatchObject({ locked: true });
  await expect(page.getByRole('status').filter({ hasText: /Too many attempts\. Try again in \d+ seconds?\./ })).toBeVisible();
  await expect(loginForm(page).submit).toBeDisabled();

  // The countdown actually decays and releases the button.
  await page.clock.runFor(Number(res.retry_after_seconds) * 1000 + 1_000);
  await expect(loginForm(page).submit).toBeEnabled();
});

test('7th failure (900s tier) replaces the page with "Account temporarily locked"', async ({ page }) => {
  const { email } = ACCOUNTS.lockTier3;
  await clearLoginAttempts(email);
  await seedFailedAttempts(email, 6, 60); // 6 failures whose 30s cooldown has elapsed
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1_000); // see the next test for why the clock must not tick

  const res = await loginViaUi(page, email, 'wrong-password');
  expect(res).toMatchObject({ locked: true });
  await expect(page.getByRole('heading', { name: 'Account temporarily locked' })).toBeVisible();
  await expect(page.getByText('Contact your AgapSense administrator to unlock it.')).toBeVisible();
  await expect(loginForm(page).submit).toHaveCount(0);
});

test('the "Account temporarily locked" screen stays up while the lock lasts', async ({ page }) => {
  // Regression: the screen used to be keyed to a live countdown >= 900, so it vanished on the first tick.
  const { email } = ACCOUNTS.lockTier3b;
  await clearLoginAttempts(email);
  await seedFailedAttempts(email, 6, 60);
  const res = await loginViaUi(page, email, 'wrong-password');
  expect(Number(res.retry_after_seconds)).toBeGreaterThanOrEqual(899);
  await page.waitForTimeout(2_500); // a few ticks of the real 1s countdown
  await expect(page.getByRole('heading', { name: 'Account temporarily locked' })).toBeVisible({ timeout: 2_000 });
});

test('signing in again partway through the 900s lock still shows the lock screen', async ({ page }) => {
  const { email } = ACCOUNTS.lockTier3c;
  await clearLoginAttempts(email);
  await seedFailedAttempts(email, 7, 120); // locked two minutes ago: ~780s left
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1_000);

  const res = await loginViaUi(page, email, 'wrong-password');
  expect(res).toMatchObject({ locked: true });
  expect(Number(res.retry_after_seconds)).toBeLessThan(900);
  await expect(page.getByRole('heading', { name: 'Account temporarily locked' })).toBeVisible();
});

test('a 30s (tier 2) lock keeps the form with a countdown, not the lock screen', async ({ page }) => {
  const { email } = ACCOUNTS.lockTier2;
  await clearLoginAttempts(email);
  await seedFailedAttempts(email, 4, 15); // tier-1 cooldown over; the 5th failure starts the 30s tier
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1_000);

  const res = await loginViaUi(page, email, 'wrong-password');
  expect(Number(res.retry_after_seconds)).toBeGreaterThan(10);
  await expect(page.getByRole('status').filter({ hasText: /Too many attempts\. Try again in \d+ seconds\./ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Account temporarily locked' })).toHaveCount(0);
});
