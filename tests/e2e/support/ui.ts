import { expect, type Page } from '@playwright/test';

/**
 * A form field by its accessible name. (getByLabel matches the raw label text, which includes
 * the aria-hidden "*" of required fields, so exact names like "Password" would never match.)
 */
export const field = (page: Page, name: string | RegExp) => page.getByRole('textbox', { name, exact: true });

export const loginForm = (page: Page) => ({
  email: field(page, 'Email address'),
  password: field(page, 'Password'),
  submit: page.getByRole('button', { name: 'Sign in', exact: true }),
});

/**
 * Signs in through the real login page (and so through the `login` Edge Function), returning
 * once the function has answered. A cold local Edge Function can take several seconds, longer
 * than the default assertion timeout.
 */
export async function loginViaUi(page: Page, email: string, password: string): Promise<Record<string, unknown>> {
  await page.goto('/login');
  const f = loginForm(page);
  await f.email.fill(email);
  await f.password.fill(password);
  const answered = page.waitForResponse((r) => r.url().includes('/functions/v1/login') && r.request().method() === 'POST', { timeout: 60_000 });
  await f.submit.click();
  return (await answered).json();
}

/** Records every call the page makes to the given Edge Function. */
export function watchFunctionCalls(page: Page, name: string): string[] {
  const calls: string[] = [];
  page.on('request', (r) => { if (r.url().includes(`/functions/v1/${name}`) && r.method() === 'POST') calls.push(r.url()); });
  return calls;
}

/** The page does not scroll sideways (nothing wider than the viewport). */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'page is wider than the viewport').toBeLessThanOrEqual(client);
}
