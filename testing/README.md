# Manual testing material

| Path | What it is |
|---|---|
| [`reports/*_TESTING.md`](reports) | Manual QA checklists: authentication, role-based access (RLS), database integrity, UI/UX, error and edge cases |
| [`reports/LIVE_*_VERIFICATION.md`](reports) | Logs of the checklists run against the live Supabase project and deployed app, kept apart so the checklists don't churn |
| [`reports/LIVE_TESTING_SUMMARY.md`](reports/LIVE_TESTING_SUMMARY.md) | One overview of every live pass: what was tested, what broke, what was fixed, what is open |
| [`postman/`](postman) | Postman collection and environment that simulate a device calling the Edge Functions (`ingest-reading`, `trigger-alert`, `get-device-config`, …). Fill in `base_url` and `device_api_key`; never commit real keys. |

The live reports are historical records: file paths and behaviour they describe are as of when each pass ran.
Most checklist items are now automated by the Playwright suite in [`../tests/e2e/`](../tests/e2e/README.md);
prefer running that against a local stack over repeating checks against production.
