# 🔥 AgapSense — Migration Guide

A step-by-step guide to set up this project on a **brand-new Supabase project** and deploy it.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org) |
| **npm** | 9+ | Comes with Node.js |
| **Supabase CLI** | Latest | `npm install -g supabase` |
| **Git** | Latest | [git-scm.com](https://git-scm.com) |

---

## Step 1 — Create a New Supabase Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a **new project**.
2. Wait for the project to finish provisioning.
3. Once ready, go to **Project Settings → API** and note down these values:

| Key | Where to Find It | You'll Paste It Into |
|---|---|---|
| **Project URL** | `Settings → API → Project URL` | `.env` (line 1) |
| **Anon / Public Key** | `Settings → API → Project API Keys → anon public` | `.env` (line 2) |
| **Service Role Key** | `Settings → API → Project API Keys → service_role secret` | Supabase Edge Function secrets |
| **Database Password** | The password you set when creating the project | Only needed if using `migrate.cjs` |

---

## Step 2 — Run the Database Schema

> [!IMPORTANT]
> There are multiple migration files that need to be run in sequential order, or you can use the Supabase CLI to apply them all automatically.

**Method A: Using Supabase CLI (Recommended)**
```bash
supabase db push
```

**Method B: Manual execution via SQL Editor**
1. In your Supabase dashboard, go to **SQL Editor** (left sidebar).
2. Click **+ New query**.
3. Open the files in `supabase/migrations/` sequentially by their timestamp prefix, starting with `20260717000000_init.sql` and ending with the latest one.
4. **Copy the entire contents** of each file and paste it into the SQL Editor.
5. Click **Run** (or press `Ctrl+Enter`) for each one in order.

These files create:
- ✅ All tables — the 8 core tables from `init.sql` (`devices`, `profiles`, `sensor_readings`, `alert_events`, `login_attempts`, `settings`, `station_settings`, `registration_requests`) plus those added later (e.g. `push_subscriptions`, `support_requests`, `firmware_releases`, the alert notification ledger)
- ✅ All functions (`get_auth_role`, `protect_profile_fields`, etc.)
- ✅ All triggers (self-promotion protection)
- ✅ All RLS policies
- ✅ Default data (settings + station info)
- ✅ Fixes, enhancements, and new fields (like `telegram_chat_id` and `local_ip`)
- ✅ Device registration with generated codes (`register_device`) and resident-set, admin-confirmed install locations (`update_own_device_location`, `devices.location_verified`) — `20261102000000_device_registration_location_verification.sql`
- ✅ Station Information name and email columns (`station_settings.station_name`, `station_settings.email`) used by Responder Settings — `20261103000000_station_settings_name_email.sql` (no-op where they were already added by hand)
- ✅ Resident contact for an open fire (`get_incident_resident_contact`): BFP responders get the linked resident's name and mobile only while a Tier 2 incident is open — `20261104000000_incident_resident_contact.sql`
- ✅ Explicit Data API grants for every table, view, sequence and function, so the schema no longer depends on Supabase auto-granting `public` objects (new projects don't, from 2026-10-30) — `20261105000000_explicit_data_api_grants.sql` (GRANT-only; a no-op on a project created before that change)
- ✅ Settings readable only by approved users, and `check_login_lockout` callable only by the `login` Edge Function — `20261106000000_close_settings_read_and_lockout_check_gaps.sql`
- ✅ Removes grants on `devices`, `alert_events` and `devices_safe` that earlier migrations had revoked but that remained on older projects (no-op on a project built from these migrations) — `20261107000000_revoke_drifted_device_and_alert_grants.sql`

> [!IMPORTANT]
> A migration that creates a table, view, sequence or function must also `GRANT` it to the roles that need it (`anon`, `authenticated`, `service_role`). New Supabase projects no longer do this automatically, so without the GRANT the object is unreachable through the API. See `20261105000000_explicit_data_api_grants.sql` for the pattern.

> [!NOTE]
> `20261102000000` continues device codes after the highest existing `AGS-NNN` code. If you later run `supabase/maintenance/reset_and_seed_devices.sql`, it resets the counter to follow the seeded `AGS-005`.

---

## Step 3 — Create the First Admin User

After running the SQL, you need to manually create an admin account since new users default to `pending` residents.

1. In Supabase dashboard, go to **Authentication → Users**.
2. Click **Add user → Create new user**.
3. Fill in email + password (e.g., `admin@agapsense.com` / your password).
4. Click **Create user**.
5. Now go to **SQL Editor** and run this (replace the email with what you used):

```sql
-- Replace 'admin@agapsense.com' with the email you just created
UPDATE profiles
SET role = 'admin', status = 'approved', full_name = 'System Admin'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'admin@agapsense.com'
);
```

> [!CAUTION]
> If you skip this step, you won't be able to log in as admin to approve other users.

---

## Step 4 — Update the `.env` File

Open the file **`.env`** in the project root and replace both values with your new Supabase project's keys:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_public_key_here
```

**Where to find these values:** Step 1 table above.

**File:** `.env` (project root, 2 lines total)

| Line | Variable | Value |
|---|---|---|
| 1 | `VITE_SUPABASE_URL` | Your Project URL from Supabase dashboard |
| 2 | `VITE_SUPABASE_ANON_KEY` | Your anon/public API key from Supabase dashboard |

For browser push notifications on a new project, also add `VITE_VAPID_PUBLIC_KEY=...` with the public key you set in Step 5b. If it is unset, the app falls back to the original project's built-in public key (`src/lib/pushNotifications.ts`), which will not match your private key.

---

## Step 5 — Deploy Edge Functions

The project has multiple Supabase Edge Functions in `supabase/functions/`. These handle server-side logic (creating users, ingesting sensor data, triggering alerts, custom login, etc.).

### 5a. Link your project

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

> Replace `YOUR_PROJECT_REF` with the ID from your Supabase project URL (e.g., if your URL is `https://abcdef.supabase.co`, then `YOUR_PROJECT_REF` is `abcdef`).

### 5b. Set Edge Function Secrets

Some edge functions use secrets. Set them via CLI:

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=your_telegram_bot_token
supabase secrets set TELEGRAM_CHAT_ID=your_telegram_chat_id
# Required by telegram-webhook (it rejects every update without it). Use the same
# value as secret_token when registering the webhook with Telegram's setWebhook.
supabase secrets set TELEGRAM_WEBHOOK_SECRET=a_long_random_string
# Optional: browser push notifications. Without these, push delivery is disabled
# (Telegram/SMS still work). Generate a pair with `npx web-push generate-vapid-keys`
# and put the same public key in the frontend's VITE_VAPID_PUBLIC_KEY (Step 4).
supabase secrets set VAPID_PUBLIC_KEY=your_vapid_public_key
supabase secrets set VAPID_PRIVATE_KEY=your_vapid_private_key
supabase secrets set VAPID_SUBJECT=mailto:you@example.com
# Optional: the dashboard's public address, e.g. https://agapsense.vercel.app.
# Admins' Telegram messages about new support requests include a link to the
# request only when this is set.
supabase secrets set APP_URL=https://your-dashboard-url
```

> [!NOTE]
> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are **automatically available** inside Edge Functions — you do NOT need to set them manually.

### 5c. Deploy all functions

```bash
supabase functions deploy
```

*(Alternatively, you can deploy them individually by name if you prefer).*

### Edge Functions Reference

| Function | Purpose |
|---|---|
| `admin-support-request` | User submits a support request; notifies every active admin |
| `assign-device` | Admin assigns a device to a user |
| `confirm-sms-status` | IoT device reports real SMS delivery outcome after Tier 2 |
| `create-user` | Admin creates a new user account |
| `get-device-config` | IoT device fetches its current thresholds + SMS numbers |
| `ingest-reading` | IoT device sends sensor data |
| `link-device` | Links a device to a resident profile |
| `login` | Gatekeeper for authentication, enforcing lockout logic |
| `manage-registration` | Admin approves/rejects user registrations |
| `manage-user` | Admin edits, deactivates or reactivates a user |
| `register` | Self-registration for new users |
| `register-push` | Stores a browser's Web Push subscription |
| `resolve-support-request` | Admin resolves or reopens a support request and notifies the requester |
| `send-push-notification` | Delivers Web Push (VAPID) notifications |
| `telegram-webhook` | Handles linking user's Telegram ID for notifications |
| `trigger-alert` | Fires alerts + sends Telegram / Web Push notifications |

---

## Step 6 — Install Dependencies & Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npm run dev
```

Open `http://localhost:5173` in your browser and log in with the admin account you created in Step 3.

---

## Step 7 — Deploy to Vercel (Optional)

The project includes a `vercel.json` for SPA routing.

1. Push your code to GitHub.
2. Go to [vercel.com](https://vercel.com) and import the repository.
3. In Vercel project settings, add these **Environment Variables**:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |

4. Deploy.

> [!IMPORTANT]
> After deploying, go back to **Supabase → Authentication → URL Configuration** and add your Vercel domain (e.g., `https://your-app.vercel.app`) to the **Redirect URLs** list. Otherwise, auth redirects will fail.

---

## Quick Reference: Files That Need Your Keys

| File | Line(s) | What to Change |
|---|---|---|
| `.env` | 1-2 | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (optionally `VITE_VAPID_PUBLIC_KEY`) |
| Edge Function secrets | — | Set with `supabase secrets set` (Step 5b), never in code |
| `firmware/agapsense-firmware/src/config.h` | — | Copy from `config.example.h`; see [`FIRMWARE_GUIDE.md`](FIRMWARE_GUIDE.md) |

> [!WARNING]
> **Do NOT commit `.env` or real keys to GitHub.** The `.gitignore` already excludes `.env`, but double-check before pushing.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Missing Supabase environment variables" on app start | Your `.env` file is missing or the keys are wrong. See Step 4. |
| Login works but dashboard shows nothing | The admin user's `status` is probably still `'pending'`. Run the UPDATE query from Step 3. |
| Edge function returns 500 | Check that you linked the correct project (`supabase link`) and secrets are set (`supabase secrets list`). |
| "infinite recursion detected in policy" | Migrations were applied out of order or an old hand-written policy is still present. Reset the DB and apply every file in `supabase/migrations/` in timestamp order (Step 2). |
| RLS blocks all data | Make sure the `get_auth_role()` function exists. Run `SELECT get_auth_role();` in the SQL Editor to test. |
