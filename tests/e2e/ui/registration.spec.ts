// Registration forms: UI_UX_TESTING.md form-validation items and the full sign-up -> pending flow.
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, freshEmail } from '../support/accounts.ts';
import { profileByEmail } from '../support/supabase.ts';
import { field, loginViaUi } from '../support/ui.ts';

async function fillResident(page: Page, overrides: Partial<Record<string, string>> = {}) {
  const v = {
    'Full name': 'E2E Registrant',
    'Email address': freshEmail('reg.resident'),
    'Mobile number': '09171234567',
    'House/Unit no., street, subdivision': '12 Test St',
    Barangay: 'Brgy Test',
    'City/Municipality': 'Testing City',
    Province: 'Test Province',
    Password: PASSWORD,
    'Confirm password': PASSWORD,
    ...overrides,
  };
  await page.goto('/register/resident');
  for (const [label, value] of Object.entries(v)) await field(page, label).fill(value!);
  return v;
}

const submit = (page: Page) => page.getByRole('button', { name: 'Submit registration' });

test('mismatched passwords: error is attached to the Confirm password field', async ({ page }) => {
  await fillResident(page, { 'Confirm password': 'Different-123!' });
  await submit(page).click();
  const confirm = field(page, 'Confirm password');
  await expect(confirm).toHaveAccessibleDescription(/Passwords do not match/);
  await expect(confirm).toBeFocused();
  await expect(page).toHaveURL(/\/register\/resident$/);
});

test('invalid mobile number is flagged on the field', async ({ page }) => {
  await fillResident(page, { 'Mobile number': '0812' });
  await submit(page).click();
  await expect(field(page, 'Mobile number')).toHaveAccessibleDescription(/09/);
  await expect(page).toHaveURL(/\/register\/resident$/);
});

test('submit is disabled while the request is in flight (no double submit)', async ({ page }) => {
  await fillResident(page);
  const calls: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/functions/v1/register') && r.method() === 'POST') calls.push(r.url()); });
  await submit(page).dblclick();
  await expect(page).toHaveURL(/\/pending-approval$/);
  expect(calls).toHaveLength(1);
});

test('resident sign-up ends on pending approval, and the new account is held there', async ({ page }) => {
  const v = await fillResident(page);
  await submit(page).click();
  await expect(page).toHaveURL(/\/pending-approval$/);

  const profile = await profileByEmail(v['Email address']!);
  expect(profile).toMatchObject({ role: 'resident', status: 'pending', contact_number: '09171234567' });

  await loginViaUi(page, v['Email address']!, PASSWORD);
  await expect(page.getByText('Registration under review')).toBeVisible();
});

test('responder sign-up ends on pending approval', async ({ page }) => {
  const email = freshEmail('reg.responder');
  await page.goto('/register/responder');
  await field(page, 'Full name').fill('E2E Responder Registrant');
  await field(page, 'Email address').fill(email);
  await field(page, /^Mobile number/).fill('09181234567'); // optional here, so the name ends in "(optional)"
  await field(page, 'Fire station').fill('E2E Station 1');
  await field(page, 'Password').fill(PASSWORD);
  await field(page, 'Confirm password').fill(PASSWORD);
  await submit(page).click();
  await expect(page).toHaveURL(/\/pending-approval$/);
  expect(await profileByEmail(email)).toMatchObject({ role: 'bfp_responder', status: 'pending' });
});

test('registering an email that already exists shows a clear error', async ({ page }) => {
  await fillResident(page, { 'Email address': 'resident@e2e.agapsense.test' });
  await submit(page).click();
  await expect(page.getByText('An account with this email already exists.')).toBeVisible();
  await expect(page).toHaveURL(/\/register\/resident$/);
});
