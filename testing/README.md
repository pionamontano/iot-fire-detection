# Manual testing material

| Path | What it is |
|---|---|
| [`reports/*_TESTING.md`](reports) | Manual QA checklists: authentication, role-based access (RLS), database integrity, UI/UX, error and edge cases |
| [`reports/LIVE_TESTING_SUMMARY.md`](reports/LIVE_TESTING_SUMMARY.md) | Overview of every live test pass against the production project and deployed app: what was tested, what broke, what was fixed, what is open. The four detailed per-area logs were removed on 2026-10-16; they remain in git history (`git show d74dc81:testing/reports/LIVE_RBAC_VERIFICATION.md`, likewise `LIVE_AUTH_`, `LIVE_DATABASE_`, `LIVE_TESTING_SUMMARY.md` (detailed `LIVE_UI_UX_VERIFICATION.md` log in git history at `d74dc81`)) |
| [`postman/`](postman) | Postman collection and environment that simulate a device calling the Edge Functions (`ingest-reading`, `trigger-alert`, `get-device-config`, …). Fill in `base_url` and `device_api_key`; never commit real keys. |

The live summary is a historical record: file paths and behaviour they describe are as of when each pass ran.
Most checklist items are now automated by the Playwright suite in [`../tests/e2e/`](../tests/e2e/README.md);
prefer running that against a local stack over repeating checks against production.
