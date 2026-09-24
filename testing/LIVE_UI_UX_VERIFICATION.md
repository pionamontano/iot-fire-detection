# Live UI/UX Verification Log

Record of UI/UX checks (see `UI_UX_TESTING.md` for the checklist) executed
against the real deployed production app (`iot-fire-detection.vercel.app`
— the actual Vercel build, not `vite dev`), driven with Playwright
(headless Chromium). Kept separate from the checklist so that file stays
a clean list rather than churning with every pass.

## Setup

Three disposable accounts were created via the app's real `register` Edge
Function and approved via `manage-registration`/`assign-device`, plus one
throwaway device (`QA-UITEST-DEVICE`):

- **QA UI Resident** — approved, `setup_complete: true`, linked to the throwaway device
- **QA UI Responder** — approved
- **QA UI Pending** — left unapproved, used only for the `PendingApproval` screen check

Where safe, **real existing production data** was used instead of
fabricating test data — notably a real historical Tier 2 fire alert and
several resolved alerts already in the database, used to verify the
Tier 1/Tier 2 visual distinction without creating any new alert.

**One safe device telemetry call** was made via `ingest-reading` (real
device API key, `co_ppm: 15.5, temp_celsius: 24.8` — both far below the
device's 200ppm/60°C thresholds) to test the resident dashboard's data
path. `ingest-reading` was chosen deliberately because it never calls
`trigger-alert` itself (confirmed by reading its source first) — no real
SMS/Telegram notification was ever at risk of being sent. `trigger-alert`
itself was deliberately never invoked.

**Cleanup:** all three disposable accounts were deleted via
`manage-registration`. The throwaway device could **not** be fully
deleted — the one `ingest-reading` call left a `sensor_readings` row that
only the service role can delete (confirmed: this table has no
admin-reachable DELETE policy, correctly, per the RBAC testing pass), and
the FK on `sensor_readings.device_id` correctly blocks deleting a device
that's still referenced. Deactivated (`is_active: false`) and relabeled
(`"[QA TEST - safe to delete via SQL editor]"`) instead so it's clearly
marked and harmless, but **it's still visible in the admin device list**
until someone with SQL access deletes the `sensor_readings` row and then
the device row.

## Environment limitations (confirmed, not assumed)

Two things don't work in this sandbox specifically, verified via the
network proxy's own status endpoint (`$HTTPS_PROXY/__agentproxy/status`)
rather than guessed from symptoms:

1. **OpenStreetMap tiles and `unpkg.com` are policy-blocked.** The proxy's
   `recentRelayFailures` list shows `403` rejections for
   `a/b/c.tile.openstreetmap.org` and `unpkg.com` — these hosts aren't on
   this environment's outbound allowlist. The map page's surrounding
   chrome (legend, live alert feed, search bar, container sizing) all
   rendered correctly; only the tile imagery itself couldn't load here.
2. **Supabase Realtime's WebSocket handshake returns `500`.** Unlike the
   map tile hosts, `fnfgakcmdosxsthvekwj.supabase.co` does **not** appear
   in the proxy's blocked-hosts list — the TCP tunnel succeeds, but the
   `wss://.../realtime/v1/websocket` upgrade itself fails with
   `Error during WebSocket handshake: Unexpected response code: 500`.
   Most likely this specific proxy doesn't support WebSocket tunneling.
   This blocks testing the entire live-push half of §3 of the checklist
   from this session — the query/data path was confirmed instead (see
   below).

Neither of these is evidence of an app bug. Both need testing from a
browser with a direct, unproxied connection.

## Results

| # | Test | Result | Verdict |
|---|---|---|---|
| 1 | Admin login → `/dashboard` | Redirected correctly | Pass |
| 2 | Admin visits all 7 admin pages (Dashboard, Map, Devices, Users, Alerts, Logs, Settings) at 1440px | All loaded, no page crashes | Pass |
| 3 | Console errors on each admin page | Only WebSocket (env limitation, see above) and, on the Map page, `ERR_TUNNEL_CONNECTION_FAILED` for blocked tile hosts | Both attributed to the sandbox, not the app |
| 4 | Admin visits `/home` (resident route) | Redirected away from `/home` | Pass |
| 5 | Admin visits `/responder` | **Initially looked like a fail** — see #6 | Investigated |
| 6 | Re-ran test #5 four times with 500ms-granularity URL polling | 3 of 4 runs: URL never left `/dashboard`. 1 of 4 runs: URL showed `/responder` for under 500ms, then settled on `/dashboard` | Pass, confirmed — this is `AuthGuard`'s loading-spinner state (renders a spinner, not protected content, while `loading` is true), not a content leak. The original single-run "fail" was sampling bad luck, not a bug |
| 7 | Responder login → `/responder`, visits all 5 responder pages at 1440px | All loaded, zero `pageerror` events | Pass |
| 8 | Resident login → `/home`, visits all 5 resident pages at 1440px | All loaded, zero `pageerror` events | Pass |
| 9 | Login page at 375px | No horizontal scroll (`scrollWidth` never exceeds `clientWidth`) | Pass |
| 10 | Dashboard at 375px | No horizontal scroll; header/stat cards stack cleanly (screenshot) | Pass |
| 11 | Mobile hamburger menu click | Sidebar slides in, `fixed inset-0` backdrop dims content behind it, active route highlighted, close (X) button visible in header | Pass (screenshot) |
| 12 | Login and Dashboard at 768px | No horizontal scroll at either | Pass |
| 13 | Register (Resident): submit with all fields empty | Blocked by HTML5 `required` before any request | Pass |
| 14 | Register (Resident): mismatched passwords | `"Passwords do not match"` shown, but as **a banner at the top of the form**, not attached to the Confirm Password field itself (screenshot) | 🟡 **Finding, not fixed** — exactly the anti-pattern `UI_UX_TESTING.md` calls out. UX judgment call, left for a decision |
| 15 | Login as the disposable pending account | Reached the `"Account Pending"` screen correctly, with clear explanatory copy | Pass — also confirms the earlier pending-account infinite-spinner fix (`20260924070000`) is holding up in a completely fresh test round |
| 16 | `ingest-reading` with a safe, below-threshold reading (`24.8°C`, `15.5ppm`) using the throwaway device's real key | `200 {"success":true}` | Pass |
| 17 | Resident Home, fresh page load, after test #16 | Shows `24.8°C` correctly | Pass — confirms the query/data path; the live-push path is the untestable half (see Environment limitations) |
| 18 | Responder Alert Logs page, real production data | A real historical alert shows in red, bold, `"FIRE ALERT (CRITICAL)"`, clearly distinct from green `"OPTIMAL"` rows | Pass — real data, no test alert created |
| 19 | Admin Map page, "Live Alert Feed" panel, real production data | Active alert shown in a bold red-bordered card (`"FIRE ALERT"`, `"CRITICAL HEAT/CO RISE"`); resolved alerts shown grayed-out below it, `"1 Active"` badge on the panel header | Pass — real data |
| 20 | Admin Dashboard, real production data | `"ACTIVE ALARMS: 01"` shown in a distinctly red-tinted stat card, not just a list row | Pass |
| 21 | Map legend color usage | Every color (`ACTIVE FIRE`/red, `NORMAL`/green, `FAULT`/orange, `OFFLINE`/gray) is paired with an explicit text label, not color-only | Pass by inspection; not run through an actual color-blindness simulator |
| 22 | Keyboard Tab order from the login email field | email → password → show/hide toggle → "keep me logged in" checkbox → submit button → "Sign Up as Resident" link | Pass — logical order |
| 23 | Attempted a destructive-action-confirmation check on `/admin/devices` | Test script targeted the wrong page — `/admin/devices` is actually the device *creation* form ("Device Registration"), not the device list/table with edit/deactivate icons (that's a separate view, seen incidentally in an earlier screenshot as "System Overview") | Inconclusive — not re-run against the correct page this pass; the equivalent confirm-modal pattern was already directly confirmed for Logout in the auth testing pass |

## Not yet run / needs a different environment

- The entire live-push half of §3 (real-time chart/dashboard/map updates, channel teardown, reconnect behavior, rapid-update rendering) — needs a browser with a direct connection to Supabase, not this sandbox's proxy
- Map tile rendering, marker popups, touch pan/zoom, marker-density performance — needs `openstreetmap.org`/`unpkg.com` reachable, not blocked by policy here
- Cross-browser (Firefox, Safari) and real mobile devices — only headless Chromium is available in this session
- Network throttling — not attempted this pass
- `Devices.tsx`/`Users.tsx` edit/assign/regenerate-key flows and destructive-action confirmations, specifically through the correct list view
- Empty-state copy audit, backend-rejected-submission error copy, icon-only `aria-label` audit, long-text truncation stress test, live window-resize mid-transition
