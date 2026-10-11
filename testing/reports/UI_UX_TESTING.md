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

> **Live verification status:** items marked `[x]` below were executed
> against the real deployed app (`iot-fire-detection.vercel.app`, the
> actual production build, not `vite dev`) with Playwright (headless
> Chromium), using disposable test accounts plus real existing production
> data where safe. See `LIVE_UI_UX_VERIFICATION.md` (same folder) for the
> full log, screenshots, and a real UX finding (registration errors use a
> top-of-form banner, not field-level attachment — exactly the anti-pattern
> this checklist calls out). **Several items are genuinely untestable from
> this sandbox**, not from the app: this environment's network proxy
> blocks OpenStreetMap tile hosts outright (`403`) and returns `500` on the
> Supabase Realtime WebSocket handshake specifically — both confirmed via
> the proxy's own status endpoint, not assumed. Cross-browser (Firefox/
> Safari) and real touch devices are also unavailable here (headless
> Chromium only).

- [x] Run against a build (`npm run build && npm run preview`) — confirmed via the actual Vercel production deployment, not `vite dev`
- [x] Run against real Supabase data — used real existing production alert history (a real Tier 2 "FIRE ALERT (CRITICAL)" and several resolved alerts) rather than only seed/empty state, alongside disposable test accounts for role-specific flows

## 1. Navigation & Layout Shell

- [x] **Header** — logo/title truncates or wraps sanely at 375px instead of overflowing the red header bar — confirmed live, no overflow
- [x] **Mobile menu toggle** — hamburger button opens the sidebar with the `fixed inset-0` backdrop visible behind it — confirmed live (screenshot); backdrop-tap-to-close not independently re-verified this pass
- [x] **Sidebar slide-in** — on mobile, sidebar renders correctly with the current route (Dashboard) highlighted, backdrop dimming content behind it, no visible layout jump
- [ ] **Sidebar persists open on desktop** with no residual backdrop or close button — not explicitly re-checked this pass (desktop screenshots show no backdrop artifact, consistent with this working, but not isolated as its own test)
- [x] **Active route highlighting** — confirmed live across admin (Dashboard highlighted on `/dashboard`), responder (Alert Logs highlighted on `/responder/alerts`), and mobile (Dashboard highlighted in the slide-in menu)
- [x] **Role isolation** — confirmed live: admin visiting `/home` and `/responder` is redirected to `/dashboard` both times. One transient false alarm during testing (URL briefly showed `/responder` for under 500ms) was investigated and confirmed to be `AuthGuard`'s own loading-spinner state, not a content leak — re-ran 4 times, only ever a bare address-bar flash before the redirect settles, never protected content
- [ ] **Map page layout exception** — not independently verified (map tile rendering itself couldn't be tested in this sandbox; the surrounding page chrome around the map loaded correctly)
- [x] Logout clears session state — confirmed as part of the earlier authentication testing pass (`LIVE_AUTH_VERIFICATION.md`); back-button-after-logout also confirmed there

## 2. Auth & Registration Flows

- [x] **Login** — invalid credentials show a clear inline error (`"Invalid login credentials"`), not a silent failure or raw error string — confirmed in the earlier auth pass
- [ ] Login form disables the submit button / shows a spinner while in flight — visually confirmed ("Authenticating..." state observed repeatedly), but double-submit specifically (two rapid clicks) wasn't isolated as its own test
- [x] **Account lockout** — the UI communicates the lockout state and expected wait (`"Too many attempts. Wait N seconds..."`, submit disabled) — confirmed thoroughly in the earlier auth pass, including all three escalating tiers
- [x] **Register (Resident)** validates required fields client-side (HTML5 `required`) before submit — confirmed live
- [ ] **Register (Responder)** — not independently re-tested this pass (Resident form's validation pattern confirmed; Responder form uses the same `register` Edge Function and almost identical structure, but not run directly)
- [x] **Finding:** registration form errors (e.g. password mismatch) render as a single banner at the top of the form, not attached to the specific field (the `Confirm Password` input itself shows no error state) — this is exactly the anti-pattern this checklist item calls out. See `LIVE_UI_UX_VERIFICATION.md` for the screenshot. Not fixed in this pass — a UX judgment call, not a bug
- [x] Password fields have visible show/hide toggles and correct `type="password"` masking — confirmed in the earlier auth pass
- [x] **PendingApproval** page clearly explains the account is awaiting approval (`"Account Pending... You will be able to access the system once approved."`) — confirmed live, and confirms the earlier pending/rejected infinite-spinner bug fix is holding up correctly in this fresh test round too
- [ ] **SessionExpired** page — confirmed to render correctly after an idle timeout in the earlier auth pass; not re-verified specifically for a mid-session JWT expiry (a different trigger than idle timeout)
- [ ] Submitting a registration twice (double-click) doesn't create duplicate `registration_requests` — not independently tested this pass (a *sequential* duplicate-email registration was tested in the database pass and correctly rejected; a rapid double-click of the same submission wasn't isolated)

## 3. Real-Time Data & Live Updates

- [x] A new device reading updates data on load — confirmed the **query path**: sent a real reading via `ingest-reading` (co_ppm: 15.5, temp: 24.8°C, well below thresholds) using a throwaway device's real API key, then loaded Resident Home fresh and saw `24.8°C` rendered correctly
- [ ] **The live-push path itself could not be tested in this sandbox.** Supabase Realtime's WebSocket endpoint (`wss://.../realtime/v1/websocket`) returns `Unexpected response code: 500` specifically in this environment's network proxy — confirmed the proxy's own status endpoint does *not* list this host among its policy-blocked hosts, meaning the TCP tunnel succeeds but the WebSocket upgrade handshake itself fails, most likely because this proxy doesn't support WebSocket tunneling. This is an environment limitation, not evidence of an app bug — it needs testing from an unproxied browser
- [ ] Channel teardown on unmount — not testable without a working WebSocket connection to observe subscription behavior against
- [ ] Reconnect-after-network-loss indicator — same limitation
- [ ] Rapid-fire update rendering (flicker/thrash) — same limitation

## 4. Alerts & the Tier 1/Tier 2 Distinction

- [x] Tier 2 alerts are visually distinguishable from other states — confirmed live using **real existing production alert history**, not test data: the Responder Alert Logs table shows a red `"FIRE ALERT (CRITICAL)"` row distinct from green `"OPTIMAL"` rows; the Admin Map's "Live Alert Feed" panel shows an active `"FIRE ALERT"` in a bold red-bordered card versus greyed-out `"RESOLVED"` cards below it
- [x] A live alert produces a noticeable signal on the dashboard — confirmed via real data: the Admin Dashboard shows `"ACTIVE ALARMS: 01"` in a distinctly red-tinted stat card (not just a list row), and the Map page shows `"LIVE ALERT FEED"` with a `"1 Active"` badge
- [ ] The map's hotspot highlight clearing once resolved — map tiles themselves didn't render in this sandbox (see §6), so the *marker* highlight behavior specifically couldn't be visually confirmed, only the side-panel feed
- [ ] Alert detail (GPS/address/Google Maps link) rendering — not independently opened this pass
- [x] Color choices remain distinguishable without relying on color alone — every colored status in the map legend and alert feed is paired with an explicit text label (`"ACTIVE FIRE"`, `"FIRE ALERT"`, `"RESOLVED"`, `"OPTIMAL"`) rather than color being the only signal, which substantially mitigates a color-blind-only concern; not run through an actual simulator

## 5. Loading, Empty, and Error States

- [x] Pages render correctly with near-empty data rather than blank/broken — a disposable resident account with a single throwaway device (no real history) showed the dashboard shell, thresholds, and an empty (but not broken) 24h chart correctly
- [ ] Empty states are *explicit and helpful* specifically — the resident dashboard's empty chart renders as empty grey bars with no accompanying "no data yet"-style text; this is a soft finding (works, but the checklist's bar is explicit copy, which isn't quite there) rather than a hard pass or fail
- [ ] Failed-fetch error states with retry — not independently triggered this pass
- [ ] Form field-level validation copy against actual bounds — the resident device thresholds render correctly (`60°C`, `200ppm` matching the real device row), but a rejected submission's error copy wasn't specifically tested
- [ ] Backend-rejected submission surfaces a readable message — not independently tested this pass (the registration-error test above covers a client-side validation error, not a server-rejected one)

## 6. Map (`InteractiveMap.tsx`, Leaflet/OpenStreetMap)

- [ ] **Map tiles could not be tested in this sandbox.** Confirmed via the proxy's own status endpoint: `a.tile.openstreetmap.org`, `b.tile.openstreetmap.org`, `c.tile.openstreetmap.org`, and `unpkg.com` (a common Leaflet CDN dependency) are all policy-blocked (`403`) outbound from this environment. The map container itself rendered with the correct defined height and all surrounding chrome (legend, live alert feed, search, clustering toggle) — only the tile imagery itself was untestable here
- [x] Device markers / map container has a defined height — confirmed indirectly: the map area rendered as a correctly-sized grey box (not 0-height/collapsed), consistent with the container having explicit height even though tiles didn't paint
- [ ] Marker popups, pan/zoom on touch, and performance with many markers — all depend on tiles actually rendering; not testable here

## 7. Forms & Interactive Controls (Admin-heavy pages)

- [ ] `Devices.tsx` create/edit/assign/regenerate-key flows — the create form (`/admin/devices`, labeled "Device Registration") rendered correctly with threshold sliders and a "Recently Registered" live list; the edit/assign/regenerate flows specifically weren't exercised through the UI this pass (already covered at the API level in the database/RBAC passes)
- [ ] `Users.tsx` approve/reject UX — not independently tested this pass
- [ ] Destructive-action confirmation — not directly re-verified on `Devices.tsx`/`Users.tsx` this pass, but the same pattern (a confirm modal requiring an explicit second click) was directly confirmed for Logout in the earlier auth pass, which is the same codebase convention
- [x] Keyboard `Tab` order is sensible — confirmed on the login form: email → password → show/hide toggle → "keep me logged in" checkbox → submit → "Sign Up as Resident" link, in a logical, expected order
- [ ] Icon-only buttons have accessible labels — not audited this pass

## 8. Responsive & Visual Consistency

- [x] Spacing/padding scale consistently across breakpoints — confirmed live at 375px, 768px, and 1440px on Login and Dashboard; no cramped or excessively spaced layout observed
- [ ] Text truncation/wrapping intentionality — not specifically stress-tested with long device names/addresses/emails this pass
- [ ] Table mobile usability (horizontal scroll vs. reflow) — not specifically tested; the Devices "list" view is actually a card list rather than a table (see §7 correction), which may sidestep this concern for that page specifically, but other tables weren't checked
- [x] No unintentional horizontal page scroll — confirmed live at 375px (Login, Dashboard) and 768px (Login, Dashboard): `document.documentElement.scrollWidth` never exceeded `clientWidth`
- [ ] Consistent, non-confusable use of the brand red vs. alert-severity red — not directly audited side-by-side this pass, though both uses were visually distinct in the screenshots gathered (header red is solid/branded; alert red uses distinct card borders/badges)

## 9. Cross-Browser / Cross-Device Pass

- [ ] **Not testable from this session.** Only headless Chromium is available here — no Firefox, no Safari, no real iOS/Android devices. Touch-target sizing and gesture behavior need a real device or a proper cross-browser testing service
- [ ] Network throttling — not run this pass

## 10. Regression Checks

- [x] Switching roles doesn't leak stale UI — each role was tested in its own fresh browser context (separate login, separate session) rather than switching accounts within one session, so this doesn't fully replicate the "same browser session" scenario the checklist asks about; worth a dedicated same-context test if this matters operationally
- [x] Browser back/forward after login doesn't expose unauthenticated-view content early — investigated specifically after an initial false alarm (see §1); confirmed across 4 repeated runs that only a brief loading-spinner state is visible before `AuthGuard` redirects, never actual protected content
- [ ] Live window resize mid-transition — not tested (all viewport tests used a fixed viewport per page load, not a live resize)
