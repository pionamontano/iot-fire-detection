# UI/UX Testing Checklist

Manual checklist for verifying the AgapSense frontend (`src/`) across its
three role-specific shells — Admin (`AdminLayout`), BFP Responder
(`ResponderLayout`), Resident (`ResidentLayout`) — plus the shared public
flows (`Login`, `RegisterResident`, `RegisterResponder`,
`PendingApproval`, `SessionExpired`, `NotFound`).

Run each section once per role where the layout differs, and at minimum at
these viewport widths: **375px** (mobile), **768px** (tablet, the `md:`
breakpoint used throughout the layouts), and **1440px** (desktop). The
sidebars use `absolute md:static` with a `translate-x` slide-in and a
`fixed inset-0` backdrop below `md:`, so mobile nav needs its own pass, not
just a resize of the desktop layout.

- [ ] Not yet run
- [ ] Run against a build (`npm run build && npm run preview`), not just `vite dev`
- [ ] Run against real Supabase data (live alert events, live device readings), not only empty/seed state

## 1. Navigation & Layout Shell

- [ ] **Header** — logo/title (`AdminLayout.tsx:40`) truncates or wraps sanely at 375px instead of overflowing the red header bar
- [ ] **Mobile menu toggle** — hamburger button (`md:hidden`, `AdminLayout.tsx:60`) opens/closes the sidebar; the `fixed inset-0 bg-black/30` backdrop appears behind it and tapping the backdrop closes the menu
- [ ] **Sidebar slide-in** — on mobile, sidebar transitions in from `-translate-x-full` to `translate-x-0` without a layout jump or scroll-lock leak on the page behind it
- [ ] **Sidebar persists open on desktop** (`md:static`, `md:translate-x-0`) with no residual backdrop or close button visible
- [ ] **Active route highlighting** — the current page's nav item is visually distinct in all three role sidebars
- [ ] **Role isolation** — an Admin never sees Resident/Responder-only nav items and vice versa; navigating directly to another role's route (typed URL) is blocked by `AuthGuard` and redirects appropriately, not just hidden in the nav
- [ ] **Map page layout exception** — `AdminLayout.tsx:155` gives `/admin/map` a different content wrapper (`flex-1 flex flex-col relative min-h-full` vs `p-6 md:p-10 flex-1`); confirm the map fills the viewport correctly and other pages still get their padding
- [ ] Logout (`AdminLayout.tsx:17` `navigate('/login')`) clears session state and back-button navigation after logout doesn't restore an authenticated view

## 2. Auth & Registration Flows

- [ ] **Login** (`Login.tsx`) — invalid credentials show a clear inline error, not a silent failure or raw Supabase error string
- [ ] Login form disables the submit button (or shows a spinner) while the request is in flight, so double-submitting doesn't fire two auth attempts
- [ ] **Account lockout** — after repeated failed logins (`login_attempts` / `login_lockout_overrides` per `ROLE_BASED_ACCESS_TESTING.md`), the UI communicates the lockout state and expected wait, not just a generic error
- [ ] **Register (Resident)** and **Register (Responder)** forms validate required fields client-side before submit, with errors attached to the specific field, not a single top-of-form banner
- [ ] Password fields have visible show/hide toggles and correct `type="password"` masking
- [ ] **PendingApproval** page clearly explains the account is awaiting admin approval and doesn't imply the user is stuck or the app is broken
- [ ] **SessionExpired** page appears when a JWT expires mid-session (not just at initial load) and its "log back in" action returns the user to a sane place, not a blank page
- [ ] Submitting a registration twice (double-click) doesn't create duplicate `registration_requests`

## 3. Real-Time Data & Live Updates

The dashboards, resident home, and map all open Supabase Realtime channels
(`Dashboard.tsx`, `ResidentHome.tsx`, `InteractiveMap.tsx`) rather than
polling. Verify the UI actually reflects pushed changes, not just
initial-load data.

- [ ] A new device reading pushed via `ingest-reading` updates `ResidentHome`'s chart/telemetry live, without a manual refresh
- [ ] A new Tier 1/Tier 2 alert pushed via `trigger-alert` updates the Admin dashboard, Responder dashboard, and the map's hotspot markers live, in all open tabs/sessions simultaneously
- [ ] Channels are torn down on unmount (`ResidentHome.tsx:147` `removeChannel`) — navigating away and back doesn't accumulate duplicate subscriptions or duplicate UI updates per event
- [ ] Losing and regaining network connectivity doesn't leave the UI silently stale — either it visibly reconnects or shows a "disconnected" indicator
- [ ] Rapid-fire updates (e.g. multiple readings in quick succession) don't cause visible flicker, layout thrash, or dropped renders in the chart

## 4. Alerts & the Tier 1/Tier 2 Distinction

Per `FEATURES.md`, Tier 1 (warning) and Tier 2 (fire alert) are
meaningfully different in severity — the UI must make that difference
obvious at a glance, not just in the underlying data.

- [ ] Tier 2 alerts are visually distinguishable from Tier 1 (color, icon, badge — not just text) on `Alerts.tsx`, `ResidentAlerts.tsx`, and `ResponderAlertLogs.tsx`
- [ ] A live Tier 2 alert produces a noticeable UI signal on the dashboard (not just a row appearing in a list a user has to scroll to find) — check `Dashboard.tsx` and `ResponderDashboard.tsx`
- [ ] The map (`InteractiveMap.tsx`) highlights an active Tier 2 hotspot distinctly from idle/normal device markers, and the highlight clears appropriately once resolved
- [ ] Alert detail (GPS, reverse-geocoded address, Google Maps link per `FEATURES.md`) renders correctly when present and degrades gracefully (no broken link, no "undefined") when geocoding data is missing
- [ ] Color choices for alert severity remain distinguishable for color-blind users (don't rely on red/green alone — check against a color-blindness simulator)

## 5. Loading, Empty, and Error States

`SkeletonLoaders.tsx` exists for a reason — verify it's actually used
consistently, not just on the first page anyone tested.

- [ ] Every data-fetching page (`Devices`, `Users`, `Logs`, `Alerts`, resident/responder equivalents) shows a skeleton or spinner during initial load, not a blank page or layout jump when data pops in
- [ ] Empty states are explicit and helpful: zero devices, zero alerts, zero users, zero registration requests — each says something (e.g. "No devices linked yet") rather than rendering an empty table/list with no explanation
- [ ] Failed fetches (Supabase error, network error) show a user-facing error state with a retry option, not a console-only failure with a stuck skeleton
- [ ] Forms show field-level validation errors (device thresholds, contact numbers, etc.) with correct copy — check `ResidentAlertSettings.tsx`, `ResponderSettings.tsx`, `Settings.tsx` threshold inputs against their actual bounds (0–100°C / 0–1000ppm per `ROLE_BASED_ACCESS_TESTING.md`)
- [ ] Submitting a form that the backend rejects (e.g. RLS denial, constraint violation) surfaces a readable message, not a raw Postgres/PostgREST error

## 6. Map (`InteractiveMap.tsx`, Leaflet/OpenStreetMap)

- [ ] Map tiles load correctly and the map container has a defined height at every breakpoint (Leaflet maps commonly render as 0-height/blank when a parent lacks explicit height — check especially the mobile layout)
- [ ] Device markers show correct GPS position and don't visually overlap illegibly when multiple devices are close together
- [ ] Marker popups/tooltips are readable and don't get clipped at the viewport edge on mobile
- [ ] Map pan/zoom gestures work on touch devices without fighting the page's own scroll
- [ ] Map performs acceptably with a realistic number of devices/markers (test with production-scale data, not just 2–3 seed devices)

## 7. Forms & Interactive Controls (Admin-heavy pages)

- [ ] `Devices.tsx` — create/edit/assign/regenerate-API-key flows give clear success/failure feedback and the `api_key` is never displayed in plaintext to non-admins (cross-check against `ROLE_BASED_ACCESS_TESTING.md` §1)
- [ ] `Users.tsx` — approve/reject registration actions are unambiguous (no accidental double-click reject) and update the list without a full page reload
- [ ] Destructive actions (delete device, delete user, reject registration) require a confirmation step before executing
- [ ] All primary buttons/links have a visible focus state and are reachable via keyboard `Tab` order alone, in the order a sighted user would expect
- [ ] Icon-only buttons (`lucide-react` icons used without adjacent text, e.g. the mobile menu toggle) have an accessible label (`aria-label` or equivalent) for screen readers

## 8. Responsive & Visual Consistency

- [ ] Spacing/padding scale consistently across breakpoints (`p-6 md:p-10`-style patterns) — no page looks cramped at 768px or has excessive whitespace at 375px
- [ ] Text truncation/wrapping is intentional everywhere, not accidental (long device names, long addresses, long user emails)
- [ ] Tables (`Devices`, `Users`, `Logs`, alert lists) are usable on mobile — either horizontally scrollable with a visible affordance, or reflow into cards; verify neither is silently broken (columns cut off with no way to see them)
- [ ] Consistent use of the red (`#B91C1C`) brand/alert color — confirm it's reserved for header/branding vs. actual alert severity, and the two uses aren't visually confusable
- [ ] No horizontal page scroll appears unintentionally at any tested width

## 9. Cross-Browser / Cross-Device Pass

- [ ] Chrome, Firefox, Safari (desktop) — layout, map rendering, and Realtime updates all work
- [ ] Mobile Safari (iOS) and Chrome (Android) — touch targets are large enough (≥44px), and the mobile nav/backdrop behavior matches desktop-simulated mobile testing
- [ ] Test on an actual low-end/throttled connection (Chrome DevTools network throttling) to confirm skeletons and real-time reconnect behavior hold up, not just on fast local dev

## 10. Regression Checks

- [ ] Switching between role accounts in the same browser session doesn't leave stale UI state (cached dashboard data, stale nav) from the previous role — same caution called out for the data layer in `ROLE_BASED_ACCESS_TESTING.md` §Cross-Role Regression Checks, but verified here at the UI level specifically
- [ ] Browser back/forward navigation after login/logout doesn't expose a previously authenticated page's content before `AuthGuard` redirects
- [ ] Resizing the browser window live (not just loading at a fixed width) doesn't break the mobile↔desktop sidebar transition mid-resize
