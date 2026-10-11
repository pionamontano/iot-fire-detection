# Live Authentication Verification Log

Record of authentication/session checks (see `AUTHENTICATION_TESTING.md`
for the checklist) executed against a real running instance of the app
(Vite dev server, `npm run dev`) pointed at the real Supabase project,
driven with Playwright (headless Chromium). Unlike the database/RBAC
testing passes, this one required an actual browser — redirects, error
banners, password masking, and idle timers are UI behavior that raw
PostgREST/RPC calls can't exercise.

## Setup

Five disposable accounts were created via the app's real `register` Edge
Function and set to the needed state via `manage-registration`/direct
`PATCH` (self-update, for `setup_complete`):

- **Pending** — registered, left untouched (not approved)
- **Rejected** — registered, then rejected
- **NoSetup** — resident, approved, `setup_complete: false` (the default)
- **SetupDone** — resident, approved, `setup_complete: true` (set via the account's own `PATCH` after approval, matching what `ResidentSetup.tsx` would do)
- **Responder** — `bfp_responder`, approved

All five were deleted via `manage-registration`'s `delete` action
immediately after testing. Two settings values (`timeout_resident`) were
temporarily lowered to 1 minute for the idle-timeout test and restored to
their original value (`60`) immediately after.

## Results

| # | Test | Result | Verdict |
|---|---|---|---|
| 1 | Submit with both fields empty | `input.validity.valueMissing === true`, no request sent | Pass |
| 2 | Invalid email format (`not-an-email`) | `input.validity.typeMismatch === true` | Pass |
| 3 | Password `123` (< 6 chars) | `input.validity.tooShort === true` | Pass |
| 4 | Password field default type + eye icon click | `type="password"` before, `type="text"` after click | Pass |
| 5 | Admin, wrong password | Error banner: `"Invalid login credentials"`, stayed on `/login` | Pass (see checklist note on exact wording) |
| 6 | Nonexistent email | Identical `"Invalid login credentials"` banner | Pass — no user enumeration |
| 7 | SQL injection payload (`' OR '1'='1`) as both fields | Failed normally, stayed on `/login`, no console errors beyond expected `400`s | Pass |
| 8 | 2000+ character email/password | Form remained responsive, no crash | Pass |
| 9 | XSS payload (`<script>...`, `"><img onerror=...>`) in fields | No script execution, no `alert` in console | Pass |
| 10 | Admin, correct credentials | Redirected to `/dashboard` | Pass |
| 11 | Pending account, correct credentials | Authenticated at the Supabase layer, but **stuck on "Authenticating..." forever** — never reached the Account Pending screen | 🔴 **Bug** — see below |
| 12 | Rejected account, correct credentials | Same infinite-spinner bug | 🔴 Same bug |
| 13 | Browser console during #11/#12 | `Error fetching profile: {code: PGRST116, message: "Cannot coerce the result to a single JSON object"}` | Root cause: 0-row profile read for a non-approved user |
| 14 | Responder, correct credentials | Redirected to `/responder` | Pass |
| 15 | Resident (`setup_complete: false`), correct credentials | Redirected to `/setup` | Pass |
| 16 | Same resident, direct navigation to `/home` | Bounced back to `/setup` | Pass |
| 17 | Resident (`setup_complete: true`), correct credentials | Redirected to `/home` | Pass |
| 18 | Same resident, direct navigation to `/setup` | Redirected to `/home` | Pass |
| 19 | Same resident, direct navigation to `/dashboard` | Redirected away (not left on the admin page) | Pass |
| 20 | Admin login → sidebar "Logout" → confirm modal → "LOGOUT" | Redirected to `/login`; Supabase session key gone from `localStorage` | Pass |
| 21 | Direct navigation to `/dashboard` after logout | Redirected to `/login` | Pass |
| 22 | Browser back button after logout | Stayed on `/login`, did not reopen `/dashboard` | Pass |
| 23 | 3 real failed logins (fresh disposable email) | `"Too many attempts. Wait ~10 seconds..."`, submit disabled | Pass — tier 1 (3 failures → 10s) fires correctly |
| 24 | 4 more submit-button clicks while "locked" | Same `~10s` message repeated every time | Investigated further — see #25 |
| 25 | `login_attempts` row count for that email, checked directly, after 7 total submit-button clicks | **3 rows**, not 7 | 🔴 **Finding** — clicks 4–7 never recorded a new failure; the client-side pre-check intercepts every submission once locked, so tiers 2 (30s) and 3 (900s) are unreachable through the form |
| 26 | 10 consecutive direct `POST /auth/v1/token?grant_type=password` calls against the same "locked" account, bypassing the app/RPC entirely | All 10 returned normal `invalid_credentials`/`400`, no throttling | 🔴 **Finding** — confirms the lockout has zero server-side enforcement; `signInWithPassword` itself doesn't know or care about `check_login_lockout` |
| 27 | Resident login, `timeout_resident` temporarily set to 1 minute, then idle | Signed out after ~61s, but landed on **`/login`**, not `/session-expired` | 🔴 **Bug** — see below |
| 28 | Browser console during #27 | No errors; pure client-side navigation race | Root cause: `AuthGuard` re-renders on `session` becoming null (from `signOut()`) and its own `<Navigate to="/login">` overrides the idle-timeout hook's `navigate('/session-expired')` |
| 29 | Same idle-timeout test, re-run after swapping the order in `useIdleTimeout.ts` (navigate first, `signOut()` after) | Landed on `/session-expired` correctly | Pass — fix confirmed live |

## Round 2 — server-side login lockout enforcement (`login` Edge Function)

Follow-up pass, once finding #3 below got its own fix. All requests direct
to the deployed `login` function (`POST /functions/v1/login`), not the
browser — the Edge Function *is* the thing under test here.

| # | Test | Result | Verdict |
|---|---|---|---|
| 30 | `POST /functions/v1/login` with correct admin credentials | `200`, real `access_token`/`refresh_token` returned | Pass — the function correctly proxies a real sign-in |
| 31 | 7 direct `POST`s to the deployed function against a fresh disposable email, back-to-back with no waiting | Only **3** rows landed in `login_attempts`; attempts 4–7 all got `429 locked` immediately | 🔴 **Second bug found**, by testing the first fix once deployed — enforcement was no longer skippable, but `check_login_lockout` itself had no time decay, so it stayed stuck at tier 1 forever within the 15-minute window. See fix below |
| 32 | Full 7-failure escalation, this time with real waits between attempts matching each tier's cooldown (10s → 10s → 30s → 30s), re-run after `20260924090000_fix_login_lockout_escalation.sql` | Failures 3–4 → tier 1 (10s each); failure 5 → tier 2 (30s); failure 6 → tier 2 again (30s); failure 7 → **tier 3, `retry_after_seconds: 900`** | Pass — exactly **7** rows in `login_attempts` this time (verified directly), confirming every cooldown-respecting attempt was recorded and the tiers escalate for real: 3→10s, 4→10s, 5→30s, 6→30s, 7→900s |
| 33 | Test account unlocked via `admin_unlock_login` afterward | `204` | Cleanup — no account left sitting on a 900s lock |

## Bugs found and fixed in this pass

1. **Pending/rejected accounts stuck on infinite "Authenticating..."** — `supabase/migrations/20260924070000_fix_own_profile_read_for_pending_rejected.sql`. Lets a user always read their own profile row regardless of status, without reopening the original HIGH-03 vulnerability (bulk-reading *other* users' profiles while unapproved).
2. **Idle timeout lands on `/login` instead of `/session-expired`** — `src/hooks/useIdleTimeout.ts`. Reordered to navigate before signing out, avoiding the `AuthGuard` redirect race.
3. **Login lockout had no server-side enforcement** (originally flagged as an architectural gap, not fixed — see below for how it got resolved). The web form's own lockout UX worked as far as tier 1, but a scripted attacker calling Supabase Auth directly was entirely unaffected — `login_attempts`/`check_login_lockout` never gated the real authentication call. Fixed by moving sign-in through a new `login` Edge Function (`supabase/functions/login/index.ts`) that checks the lockout and records the outcome atomically, server-side, with the service role. `login_attempts` INSERT and `check_login_lockout` EXECUTE were also revoked from `anon`/`authenticated` (`20260924080000_lock_down_login_attempts_and_lockout_check.sql`), since only the function needs them now.
4. **Login lockout tiers didn't escalate even with enforcement fixed** — found by testing fix #3 live once deployed (test #31 above). `check_login_lockout` had no time decay: once a tier's failure count was hit, every check for up to 15 minutes returned the same flat result, since nothing ever let a new attempt through to become the next failure. Fixed in `20260924090000_fix_login_lockout_escalation.sql` by tracking elapsed time since the most recent failure and letting exactly one more real attempt through once the current tier's cooldown has genuinely elapsed. Confirmed live end-to-end (test #32): all three tiers now fire for real.

## Gap confirmed still open — by design, not an oversight

A scripted attacker who skips this app entirely and calls Supabase's own
`/auth/v1/token?grant_type=password` endpoint directly (with the public
anon key) is unaffected by any of the above — GoTrue is a separate service
with no reach into this project's Postgres policies or Edge Functions.
Checked the project's actual Supabase dashboard settings (Authentication →
Rate Limits): "Rate limit for sign-ups and sign-ins" is **30 requests / 5
min per IP** (the Supabase default), which is real but looser than this
app's own per-email tier-1 threshold (3 failures). Deliberately left
as-is per the project owner's decision — tightening it risks locking out
multiple legitimate users (e.g. BFP responders) sharing a station's IP,
and Supabase's CAPTCHA/Attack Protection feature would be the more
targeted lever if this is revisited later.

## Still not independently testable

- Idle-timer reset on real mouse/keyboard/touch/scroll input mid-countdown — would need to simulate input at precise intervals against the countdown; the timeout firing correctly after genuine inactivity was verified instead.
- Multi-tab logout sync — needs a real multi-tab browser session, not a single headless page.
- Exhaustive audit that the password value never appears in any network response beyond the Supabase auth call itself — spot-checked, not exhaustively audited.
