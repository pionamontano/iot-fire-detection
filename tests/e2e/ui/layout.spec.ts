// UI_UX_TESTING.md §1 "Navigation & Layout Shell" at the three required widths.
import { expect, test, type Page } from '@playwright/test';
import type { AccountName } from '../support/accounts.ts';
import { useSession } from '../support/supabase.ts';
import { expectNoHorizontalOverflow, field } from '../support/ui.ts';

const WIDTHS = [375, 768, 1440] as const;

// Width below which each shell switches to the slide-in sidebar (Tailwind md = 768, lg = 1024).
const SHELLS: { who: AccountName; home: string; activeLink: string; mobileBelow: number }[] = [
  { who: 'admin', home: '/dashboard', activeLink: 'Dashboard', mobileBelow: 768 },
  { who: 'responder', home: '/responder', activeLink: 'Dashboard', mobileBelow: 768 },
  { who: 'resident', home: '/home', activeLink: 'Dashboard', mobileBelow: 1024 },
];

// The hamburger has no accessible name (see README "Findings"), so find it by its icon.
const menuToggle = (page: Page) => page.locator('header button').filter({ has: page.locator('svg[class*="lucide-menu"], svg[class*="lucide-x"]') });
const backdrop = (page: Page) => page.locator('div.fixed.inset-0').filter({ hasNot: page.locator('*') });

for (const shell of SHELLS) {
  for (const width of WIDTHS) {
    const mobile = width < shell.mobileBelow;
    test.describe(`${shell.who} @ ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test.beforeEach(async ({ page }) => {
        await useSession(page, shell.who);
        await page.goto(shell.home);
        await expect(page.getByRole('navigation', { name: 'Main' })).toBeAttached();
      });

      test('no horizontal overflow; header fits', async ({ page }) => {
        await expectNoHorizontalOverflow(page);
        const header = await page.locator('header').first().boundingBox();
        expect(header!.width).toBeLessThanOrEqual(width);
      });

      test('current route is highlighted', async ({ page }) => {
        if (mobile) await menuToggle(page).click();
        await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: shell.activeLink }))
          .toHaveAttribute('aria-current', 'page');
      });

      if (mobile) {
        test('hamburger slides the sidebar in over a backdrop; backdrop tap closes it', async ({ page }) => {
          const nav = page.getByRole('navigation', { name: 'Main' });
          await expect(nav).not.toBeInViewport();
          await menuToggle(page).click();
          await expect(nav).toBeInViewport();
          await expect(backdrop(page)).toBeVisible();
          await backdrop(page).click({ position: { x: width - 10, y: 450 } });
          await expect(nav).not.toBeInViewport();
          await expect(backdrop(page)).toHaveCount(0);
        });

        test('choosing a link closes the sidebar', async ({ page }) => {
          await menuToggle(page).click();
          const nav = page.getByRole('navigation', { name: 'Main' });
          await nav.getByRole('link').nth(1).click();
          await expect(nav).not.toBeInViewport();
        });
      } else {
        test('sidebar is always shown, with no toggle or backdrop', async ({ page }) => {
          await expect(page.getByRole('navigation', { name: 'Main' })).toBeInViewport();
          await expect(menuToggle(page)).toBeHidden();
          await expect(backdrop(page)).toHaveCount(0);
        });
      }
    });
  }
}

test.describe('public pages', () => {
  for (const width of WIDTHS) {
    test(`login and registration fit at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/login', '/register/resident', '/register/responder', '/forgot-password']) {
        await page.goto(path);
        await expectNoHorizontalOverflow(page);
      }
    });
  }
});

test('keyboard: Tab walks the login form in visual order', async ({ page }) => {
  await page.goto('/login');
  await field(page, 'Email address').focus();
  // "Forgot password?" sits in the password label row, so it comes before the password input.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(field(page, 'Password')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
});
