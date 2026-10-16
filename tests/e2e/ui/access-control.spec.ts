// Route-level role isolation: AUTHENTICATION_TESTING.md "Role-Based Access Control" and
// UI_UX_TESTING.md "Role isolation", plus ERROR_EDGE_CASE_TESTING.md §7 routing items.
import { expect, test } from '@playwright/test';
import { useSession } from '../support/supabase.ts';

const PROTECTED = ['/dashboard', '/admin/users', '/admin/devices', '/responder', '/responder/alerts', '/home', '/home/alerts', '/setup', '/account'];

test.describe('signed out', () => {
  for (const path of PROTECTED) {
    test(`${path} redirects to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    });
  }
});

const isolation = [
  { who: 'admin', home: '/dashboard', forbidden: ['/home', '/responder', '/responder/alerts', '/setup'] },
  { who: 'responder', home: '/responder', forbidden: ['/dashboard', '/admin/users', '/home', '/setup'] },
  { who: 'resident', home: '/home', forbidden: ['/dashboard', '/admin/users', '/admin/settings/security', '/responder'] },
] as const;

for (const { who, home, forbidden } of isolation) {
  test.describe(`${who} is kept inside their own area`, () => {
    for (const path of forbidden) {
      test(`${path} -> ${home}`, async ({ page }) => {
        await useSession(page, who);
        await page.goto(path);
        await expect(page).toHaveURL(new RegExp(`${home}$`));
      });
    }
  });
}

// Admin pages read the base devices table with an explicit column list; this fails loudly if the
// column-level SELECT grant (20261107000000) and DEVICE_COLUMNS ever disagree.
for (const path of ['/admin/devices', '/admin/status']) {
  test(`admin ${path} lists devices without a permission error`, async ({ page }) => {
    await useSession(page, 'admin');
    await page.goto(path);
    await expect(page.getByText('E2E-RES-1').first()).toBeVisible();
    await expect(page.getByText(/permission denied/i)).toHaveCount(0);
  });
}

test('/ sends a signed-in user to their role home', async ({ page }) => {
  await useSession(page, 'responder');
  await page.goto('/');
  await expect(page).toHaveURL(/\/responder$/);
});

test('resident without setup is forced to /setup and cannot skip it', async ({ page }) => {
  await useSession(page, 'newResident');
  for (const path of ['/home', '/home/alerts', '/account']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/setup$/);
  }
});

test('resident who finished setup is sent from /setup to /home', async ({ page }) => {
  await useSession(page, 'resident');
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/home$/);
});

test('pending account cannot reach app pages by URL', async ({ page }) => {
  await useSession(page, 'pending');
  await page.goto('/home');
  await expect(page.getByText('Registration under review')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});

test('unknown route renders Not Found with a way back', async ({ page }) => {
  await page.goto('/definitely/not/a/page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to dashboard' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('Not Found sends a signed-in user to their own home', async ({ page }) => {
  await useSession(page, 'responder');
  await page.goto('/definitely/not/a/page');
  await page.getByRole('button', { name: 'Go to dashboard' }).click();
  await expect(page).toHaveURL(/\/responder$/);
});
