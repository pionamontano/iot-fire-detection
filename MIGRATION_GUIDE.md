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
> You only need to run **ONE** SQL file. All migrations have been consolidated into a single file.

1. In your Supabase dashboard, go to **SQL Editor** (left sidebar).
2. Click **+ New query**.
3. Open the file `supabase/migrations/20260717000000_init.sql` from this project.
4. **Copy the entire contents** of that file and paste it into the SQL Editor.
5. Click **Run** (or press `Ctrl+Enter`).

This single file creates:
- ✅ All 8 tables (`devices`, `profiles`, `sensor_readings`, `alert_events`, `login_attempts`, `settings`, `station_settings`, `registration_requests`)
- ✅ All functions (`get_auth_role`, `protect_profile_fields`)
- ✅ All triggers (self-promotion protection)
- ✅ All RLS policies
- ✅ Default data (settings + station info)

> [!TIP]
> The other migration files (`20260717000001_fix_rls.sql`, `20260717000002_fix_profiles_rls.sql`, `20260717000003_station_settings.sql`, `20260811000000_registration_approval.sql`) are **old incremental patches** that are now baked into the init file. **Do NOT run them separately** — it will cause duplicate errors.

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

---

## Step 5 — Deploy Edge Functions

The project has 9 Supabase Edge Functions in `supabase/functions/`. These handle server-side logic (creating users, ingesting sensor data, triggering alerts, etc.).

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
```

> [!NOTE]
> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are **automatically available** inside Edge Functions — you do NOT need to set them manually.

### 5c. Deploy all functions

```bash
supabase functions deploy assign-device
supabase functions deploy confirm-sms-status
supabase functions deploy create-user
supabase functions deploy get-device-config
supabase functions deploy ingest-reading
supabase functions deploy link-device
supabase functions deploy manage-registration
supabase functions deploy register
supabase functions deploy trigger-alert
```

Or deploy all at once:

```bash
supabase functions deploy
```

### Edge Functions Reference

| Function | Purpose |
|---|---|
| `assign-device` | Admin assigns a device to a user |
| `confirm-sms-status` | IoT device reports real SMS delivery outcome after Tier 2 |
| `create-user` | Admin creates a new user account |
| `get-device-config` | IoT device fetches its current thresholds + SMS numbers |
| `ingest-reading` | IoT device sends sensor data |
| `link-device` | Links a device to a resident profile |
| `manage-registration` | Admin approves/rejects user registrations |
| `register` | Self-registration for new users |
| `trigger-alert` | Fires alerts + sends Telegram notifications |

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
| `.env` | 1-2 | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` |
| `migrate.cjs` | 6 | PostgreSQL connection string (only if using this script) |

> [!WARNING]
> **Do NOT commit `.env` or real keys to GitHub.** The `.gitignore` already excludes `.env`, but double-check before pushing.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Missing Supabase environment variables" on app start | Your `.env` file is missing or the keys are wrong. See Step 4. |
| Login works but dashboard shows nothing | The admin user's `status` is probably still `'pending'`. Run the UPDATE query from Step 3. |
| Edge function returns 500 | Check that you linked the correct project (`supabase link`) and secrets are set (`supabase secrets list`). |
| "infinite recursion detected in policy" | You ran one of the old migration files on top of the new one. Reset the DB and only run `20260717000000_init.sql`. |
| RLS blocks all data | Make sure the `get_auth_role()` function exists. Run `SELECT get_auth_role();` in the SQL Editor to test. |
