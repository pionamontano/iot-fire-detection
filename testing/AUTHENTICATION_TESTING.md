# Authentication Testing Checklist

Manual QA checklist for the AgapSense login/logout flow (`src/pages/Login.tsx`,
`src/contexts/AuthContext.tsx`, `src/components/AuthGuard.tsx`,
`src/hooks/useIdleTimeout.ts`). Covers Supabase-backed email/password auth,
role-based redirects (`admin`, `bfp_responder`, `resident`), account approval
status, and session lifecycle.

## Login

- [ ] Correct email + correct password logs in successfully
- [ ] Correct email + incorrect password shows "Incorrect email or password. Try again." and stays on `/login`
- [ ] Incorrect email + correct password shows the same generic error (no user enumeration)
- [ ] Both fields empty is blocked by HTML5 `required` validation before submit
- [ ] Invalid email format (e.g. `foo@`, `foo.com`) is blocked by the `type="email"` input before submit
- [ ] Password under 6 characters is blocked by `minLength={6}` before submit
- [ ] Very long input (email and password, e.g. 1000+ chars) doesn't crash the form or freeze the UI
- [ ] Special characters (`' " < > & ; --`) in email/password are handled without errors and don't inject into the UI (no XSS via error message rendering)
- [ ] SQL injection payloads (e.g. `' OR '1'='1`, `admin'--`) in email/password fail login normally — Supabase's parameterized `signInWithPassword` should not be bypassable
- [ ] Login attempt for an account with `profile.status = 'pending'` authenticates but is blocked at `AuthGuard` with the "Account Pending" screen, not given app access
- [ ] Login attempt for an account with `profile.status = 'rejected'` is blocked at `AuthGuard` with the "Account Rejected" screen
- [ ] Login as `admin` redirects to `/dashboard`
- [ ] Login as `bfp_responder` redirects to `/responder`
- [ ] Login as `resident` redirects to `/home` if `setup_complete`, otherwise to `/setup`
- [ ] Successful login redirect happens automatically once `session` + `profile` resolve (no manual navigation needed)
- [ ] Failed login displays the error banner above the form without clearing the email field
- [ ] Password input defaults to masked (`type="password"`) and the eye icon toggles visibility correctly
- [ ] Password value is never logged to the console or included in network responses beyond the Supabase auth request itself
- [ ] Repeated failed attempts trigger `check_login_lockout` and lock the account, showing the countdown timer and disabling the submit button
- [ ] Lockout of 900s+ replaces the whole page with the "Account Locked" screen
- [ ] Every login attempt (success and failure) is recorded in `login_attempts` (email + success flag)

## Logout

- [ ] Logout (via `signOut()`) clears the Supabase session and local `session`/`user`/`profile` state
- [ ] Session is destroyed server-side (Supabase auth token invalidated, not just cleared client-side)
- [ ] After logout, browser back button does not reopen a previously visited protected page (redirects to `/login` via `AuthGuard`)
- [ ] Direct URL access to any protected route (`/dashboard`, `/responder`, `/home`, etc.) after logout redirects to `/login`
- [ ] Idle timeout (`useIdleTimeout`) signs the user out and redirects to `/session-expired` after the role-configured duration with no activity
- [ ] Idle timer resets correctly on mouse move, click, keydown, touch, and scroll events
- [ ] Logging out from one tab reflects correctly in other open tabs on next navigation (no stale authenticated UI)

## Role-Based Access Control (cross-cutting)

- [ ] A `resident` cannot access `/dashboard` or `/responder` routes (redirected to their own home)
- [ ] An `admin` or `bfp_responder` visiting `/` is redirected to their correct role home, not left on a blank/generic page
- [ ] A `resident` with `setup_complete = false` is forced to `/setup` and cannot skip it by typing another URL
- [ ] A `resident` with `setup_complete = true` visiting `/setup` is redirected to `/home`
