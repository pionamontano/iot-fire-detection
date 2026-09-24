# Authentication Testing Checklist

Manual QA checklist for the AgapSense login/logout flow (`src/pages/Login.tsx`,
`src/contexts/AuthContext.tsx`, `src/components/AuthGuard.tsx`,
`src/hooks/useIdleTimeout.ts`). Covers Supabase-backed email/password auth,
role-based redirects (`admin`, `bfp_responder`, `resident`), account approval
status, and session lifecycle.

> **Live verification status:** items marked `[x]` below were executed
> against the real Supabase project and a real running instance of the app
> (via Playwright), using disposable test accounts for every account state
> (pending, rejected, resident with/without setup, responder). See
> `LIVE_AUTH_VERIFICATION.md` (same folder) for the full log. **Two real
> bugs were found and fixed** along the way:
> - Pending/rejected accounts got stuck on an infinite "Authenticating..."
>   spinner instead of ever reaching the "Account Pending"/"Account
>   Rejected" screens (`20260924070000_fix_own_profile_read_for_pending_rejected.sql`)
> - Idle timeout signed the user out correctly but landed them on `/login`
>   instead of `/session-expired`, due to a race with `AuthGuard`'s own
>   redirect (`src/hooks/useIdleTimeout.ts`)
>
> **One architectural gap was found and is flagged for a decision, not
> silently fixed**: the login lockout has no server-side enforcement at
> all — see the note under Login below.

## Login

- [ ] Correct email + correct password logs in successfully — see note
- [x] Correct email + incorrect password shows an error and stays on `/login` — confirmed live, though the exact text is Supabase's own `"Invalid login credentials"`, not the app's custom fallback (`error.message` is always truthy, so the fallback in `Login.tsx` is effectively dead code — a minor doc/wording correction, not a bug)
- [x] Incorrect email + correct password shows the same generic error (no user enumeration) — confirmed live: byte-for-byte identical message for a wrong password and a nonexistent email
- [x] Both fields empty is blocked by HTML5 `required` validation before submit — confirmed live (`validity.valueMissing === true`, no request sent)
- [x] Invalid email format is blocked by the `type="email"` input before submit — confirmed live (`validity.typeMismatch === true`)
- [x] Password under 6 characters is blocked by `minLength={6}` before submit — confirmed live (`validity.tooShort === true`)
- [x] Very long input (2000+ chars) doesn't crash the form or freeze the UI — confirmed live
- [x] Special characters / XSS payloads in email or password are handled without errors and don't execute (no XSS via error message rendering) — confirmed live, no script execution, only ordinary `400` responses
- [x] SQL injection payloads (`' OR '1'='1`, etc.) fail login normally — confirmed live, Supabase's parameterized auth is not bypassable
- [x] Login attempt for a `pending` account authenticates at the Supabase Auth layer — confirmed live (a session is created) — **but see the bug below: it never reaches the "Account Pending" screen**
- [x] Login attempt for a `rejected` account authenticates at the Supabase Auth layer — same as above, **same bug**
- [x] **Bug found and fixed:** neither the pending nor the rejected account ever reached `AuthGuard`'s "Account Pending"/"Account Rejected" screen. Root cause: the `profiles` SELECT policy (`get_auth_role() IS NOT NULL`, from the HIGH-03 fix) blocks a pending/rejected user from reading even their *own* profile row. `AuthContext.fetchProfile`'s `.single()` call then throws (`PGRST116`, 0 rows), `profile` stays `null` forever, and `Login.tsx`'s redirect effect (which requires both `session` *and* `profile`) never fires — the user is stuck on an infinite "Authenticating..." spinner with zero feedback. Fixed in `20260924070000_fix_own_profile_read_for_pending_rejected.sql` by letting a user always read their own row (`... OR id = auth.uid()`), which doesn't reopen the original HIGH-03 hole since that clause only ever matches the caller's own id
- [x] Login as `admin` redirects to `/dashboard` — confirmed live
- [x] Login as `bfp_responder` redirects to `/responder` — confirmed live
- [x] Login as `resident` redirects to `/home` if `setup_complete`, otherwise to `/setup` — confirmed live for both states
- [x] Successful login redirect happens automatically once `session` + `profile` resolve — confirmed live for every account that isn't pending/rejected (see the bug above for the case where this breaks)
- [x] Failed login displays the error banner without clearing the email field — confirmed live
- [x] Password input defaults to masked (`type="password"`) and the eye icon toggles visibility — confirmed live
- [ ] Password value is never logged to the console or included in network responses beyond the Supabase auth request itself — not independently re-verified this pass (no evidence found of a leak, but not exhaustively audited)
- [x] Repeated failed attempts trigger `check_login_lockout` and lock the account, showing the countdown timer and disabling the submit button — confirmed live for tier 1 (3 failures → 10s)
- [ ] Lockout of 900s+ (tier 3, 7 failures) replaces the whole page with the "Account Locked" screen — **see the architectural finding below: this tier is unreachable through the real login form**
- [x] Every login attempt (success and failure) is recorded in `login_attempts` — confirmed live

### ⚠️ Architectural finding: the login lockout has no server-side enforcement

Two things confirmed live together tell the real story:

1. **Tiers 2 and 3 are unreachable through the UI.** `Login.tsx` calls `check_login_lockout` *before* attempting sign-in, and returns early — without ever calling `signInWithPassword` or inserting a `login_attempts` row — whenever the account is already locked. Once 3 failures accrue (tier 1), every subsequent submission is intercepted before a new failure can ever be recorded, so the count can never reach 5 or 7 through the form. Confirmed live: after 7 real submit-button clicks against a disposable account, only **3** rows existed in `login_attempts` — clicks 4 through 7 never got past the client-side check. The account stays locked at the tier-1 cooldown, repeating indefinitely, until the 15-minute window ages out all 3 failures at once (not gracefully — it jumps straight from "locked" to "fully clear").
2. **`signInWithPassword` itself is never gated by any of this.** Confirmed live: 10 consecutive direct calls to Supabase's own `/auth/v1/token?grant_type=password` endpoint (bypassing the app entirely, as any scripted attacker would) all returned normal `invalid_credentials` responses with no throttling, no matter how "locked" the account appeared in the UI.

Together this means `check_login_lockout`/`login_attempts` is a **client-side-only courtesy for the web form**, not a real brute-force defense — a scripted attacker hitting the Supabase Auth API directly is completely unaffected by it. Closing this properly means moving real login through a server-side gate (e.g. an Edge Function that checks the lockout *before* calling the GoTrue admin API, or Supabase's own native rate-limiting/CAPTCHA features), which is a bigger architectural change than the two bugs above — **left for a decision, not fixed in this pass.**

## Logout

- [x] Logout (via `signOut()`) clears the Supabase session and local `session`/`user`/`profile` state — confirmed live
- [x] Session is destroyed server-side, not just cleared client-side — confirmed live: the Supabase session token was gone from `localStorage` after logout
- [x] After logout, browser back button does not reopen a previously visited protected page — confirmed live
- [x] Direct URL access to a protected route after logout redirects to `/login` — confirmed live
- [x] Idle timeout signs the user out and redirects after the role-configured duration — confirmed live (temporarily set `timeout_resident` to 1 minute, restored afterward)
- [x] **Bug found and fixed:** the idle-timeout redirect landed on `/login`, not `/session-expired` as designed — `AuthGuard` re-renders as soon as `signOut()` clears the session, and its own unconditional "no session → `/login`" redirect won the race against the imperative `navigate('/session-expired')`, so the user never saw the explanation that they were logged out for inactivity. Fixed in `src/hooks/useIdleTimeout.ts` by navigating *before* signing out; re-verified live after the fix — lands on `/session-expired` correctly
- [ ] Idle timer resets correctly on mouse move, click, keydown, touch, and scroll events — not independently tested (would require simulating input mid-countdown; the timeout firing correctly after genuine inactivity was confirmed instead)
- [ ] Logging out from one tab reflects correctly in other open tabs — not tested (requires a real multi-tab browser session)

## Role-Based Access Control (cross-cutting)

- [x] A `resident` cannot access `/dashboard` (redirected away) — confirmed live
- [x] An `admin`/`bfp_responder` role redirect works correctly (tested via direct login redirect for both roles) — confirmed live
- [x] A `resident` with `setup_complete = false` is forced to `/setup` and cannot skip it by typing `/home` directly — confirmed live
- [x] A `resident` with `setup_complete = true` visiting `/setup` is redirected to `/home` — confirmed live
