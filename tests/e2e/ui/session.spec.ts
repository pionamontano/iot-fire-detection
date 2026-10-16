// AUTHENTICATION_TESTING.md, "Logout" (including the idle-timeout items the live pass could not
// automate): the browser clock is fast-forwarded past the configured timeout.
import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, IDLE_TIMEOUT_MINUTES, PASSWORD } from '../support/accounts.ts';
import { env, useSession } from '../support/supabase.ts';
import { loginViaUi } from '../support/ui.ts';

const minutes = (n: number) => n * 60_000;

/**
 * Opens /home and waits until the app has fetched its idle-timeout setting; jumping the clock
 * before that would fire the idle check while no timeout is known yet.
 */
async function openHomeWithIdleTimeoutLoaded(page: Page) {
  const loaded = page.waitForResponse((r) => r.url().includes('/rest/v1/settings') && r.url().includes('timeout_resident'));
  await page.goto('/home');
  await loaded;
}
const storageKey = `sb-${new URL(env.supabaseUrl).hostname.split('.')[0]}-auth-token`;

test('logout clears the session; back button and direct URLs lead to /login', async ({ page }) => {
  await loginViaUi(page, ACCOUNTS.logout.email, PASSWORD);
  await expect(page).toHaveURL(/\/home$/);
  await page.goto('/home/alerts');
  await expect(page).toHaveURL(/\/home\/alerts$/);

  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log out?' })).toBeVisible();
  await page.getByRole('button', { name: 'Log out', exact: true }).click();

  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate((k) => localStorage.getItem(k), storageKey)).toBeNull();

  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

  await page.goto('/home');
  await expect(page).toHaveURL(/\/login$/);
});

test('logout can be cancelled', async ({ page }) => {
  await useSession(page, 'resident');
  await page.goto('/home');
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Log out?' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/home$/);
});

test('idle timeout signs the user out and lands on /session-expired', async ({ page }) => {
  await page.clock.install();
  await useSession(page, 'idle');
  await openHomeWithIdleTimeoutLoaded(page);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.clock.fastForward(minutes(IDLE_TIMEOUT_MINUTES + 1));
  await expect(page).toHaveURL(/\/session-expired$/);
  await expect(page.getByText('Session expired')).toBeVisible();
  // signOut() runs after the redirect; the stored session must actually be gone.
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), storageKey), { timeout: 15_000 }).toBeNull();
  await page.goto('/home');
  await expect(page).toHaveURL(/\/login$/);
});

test('activity resets the idle timer', async ({ page }) => {
  await page.clock.install();
  await useSession(page, 'idleReset');
  await openHomeWithIdleTimeoutLoaded(page);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  await page.clock.fastForward(minutes(IDLE_TIMEOUT_MINUTES - 1));
  // A key press, not a mouse move: after a real mouse move Chromium keeps sending synthetic
  // mousemoves whenever content under the resting cursor re-renders, which also counts as activity.
  await page.keyboard.press('Shift');
  await page.clock.fastForward(minutes(IDLE_TIMEOUT_MINUTES - 1));
  await expect(page).toHaveURL(/\/home$/);

  // Control: with no further activity the timeout does fire.
  await page.clock.fastForward(minutes(2));
  await expect(page).toHaveURL(/\/session-expired$/);
});
