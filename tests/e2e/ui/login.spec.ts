// testing/reports/AUTHENTICATION_TESTING.md, "Login".
import { expect, test } from '@playwright/test';
import { ACCOUNTS, PASSWORD, freshEmail } from '../support/accounts.ts';
import { loginForm, loginViaUi, watchFunctionCalls } from '../support/ui.ts';

test.describe('client-side validation blocks the request', () => {
  test('empty fields', async ({ page }) => {
    const calls = watchFunctionCalls(page, 'login');
    await page.goto('/login');
    const f = loginForm(page);
    await f.submit.click();
    expect(await f.email.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test('malformed email', async ({ page }) => {
    const calls = watchFunctionCalls(page, 'login');
    await page.goto('/login');
    const f = loginForm(page);
    await f.email.fill('not-an-email');
    await f.password.fill('whatever123');
    await f.submit.click();
    expect(await f.email.evaluate((el: HTMLInputElement) => el.validity.typeMismatch)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test('password under 6 characters', async ({ page }) => {
    const calls = watchFunctionCalls(page, 'login');
    await page.goto('/login');
    const f = loginForm(page);
    await f.email.fill(freshEmail('short'));
    await f.password.fill('12345');
    await f.submit.click();
    expect(await f.password.evaluate((el: HTMLInputElement) => el.validity.tooShort)).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

test('wrong password shows an error, stays on /login and keeps the email', async ({ page }) => {
  const email = ACCOUNTS.editable.email;
  await loginViaUi(page, email, 'wrong-password');
  await expect(page.getByText('Invalid login credentials')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(loginForm(page).email).toHaveValue(email);
  await expect(loginForm(page).password).toBeFocused();
});

test('unknown email gets the same message as a wrong password (no user enumeration)', async ({ page }) => {
  await loginViaUi(page, ACCOUNTS.otherResident.email, 'wrong-password');
  const known = await page.getByText('Invalid login credentials').textContent();
  await loginViaUi(page, freshEmail('nobody'), 'wrong-password');
  await expect(page.getByText('Invalid login credentials')).toHaveText(known!);
});

test('password is masked by default and the eye button toggles it', async ({ page }) => {
  await page.goto('/login');
  const { password } = loginForm(page);
  await password.fill('secret-value');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
});

test('XSS payloads are rendered as text, never executed', async ({ page }) => {
  let dialog = false;
  page.on('dialog', async (d) => { dialog = true; await d.dismiss(); });
  await loginViaUi(page, freshEmail('xss'), '<img src=x onerror="window.__xss=1;alert(1)">');
  await expect(page.getByText('Invalid login credentials')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialog).toBe(false);
});

test('SQL injection in the password fails like any wrong password', async ({ page }) => {
  await loginViaUi(page, freshEmail('sqli'), `' OR '1'='1' --`);
  await expect(page.getByText('Invalid login credentials')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('2000+ character input does not break the form', async ({ page }) => {
  await loginViaUi(page, freshEmail('long'), 'x'.repeat(2500));
  await expect(page.getByText(/invalid|error|failed/i).first()).toBeVisible();
  await expect(loginForm(page).submit).toBeEnabled();
});

test.describe('role-based redirect after sign-in', () => {
  const cases = [
    ['admin', '/dashboard'],
    ['responder', '/responder'],
    ['resident', '/home'],
    ['newResident', '/setup'],
  ] as const;
  for (const [name, path] of cases) {
    test(`${name} lands on ${path}`, async ({ page }) => {
      await loginViaUi(page, ACCOUNTS[name].email, PASSWORD);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    });
  }
});

test.describe('accounts that may not use the app yet', () => {
  test('pending account sees "Registration under review"', async ({ page }) => {
    await loginViaUi(page, ACCOUNTS.pending.email, PASSWORD);
    await expect(page.getByText('Registration under review')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('rejected account sees "Registration not approved"', async ({ page }) => {
    await loginViaUi(page, ACCOUNTS.rejected.email, PASSWORD);
    await expect(page.getByText('Registration not approved')).toBeVisible();
  });

  test('deactivated account cannot get in', async ({ page }) => {
    await loginViaUi(page, ACCOUNTS.deactivated.email, PASSWORD);
    // Either the auth ban refuses sign-in or AuthGuard shows the deactivated screen in place of
    // the page (the URL may still read /home); the app itself never renders.
    await expect(page.getByText(/Account deactivated|Invalid login credentials|banned/i).first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  });
});

test('signed-out visitor is returned to the page they asked for after signing in', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/login$/);
  const f = loginForm(page);
  await f.email.fill(ACCOUNTS.admin.email);
  await f.password.fill(PASSWORD);
  await f.submit.click();
  await expect(page).toHaveURL(/\/admin\/users$/);
});
