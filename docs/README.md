# AgapSense documentation

Where to look, by what you need. File names are kept as they are because code comments, tests and other
documents link to them.

## Using and running the system

| Document | For |
|---|---|
| [`USER_MANUAL.md`](USER_MANUAL.md) | Residents and BFP responders: the device, its lights, and the web app. The `.md` is the source; rebuild `USER_MANUAL.pdf` after every edit with [`tools/build-user-manual-pdf.sh`](tools/build-user-manual-pdf.sh) (needs pandoc and Chromium). |
| [`MIGRATION_GUIDE.md`](MIGRATION_GUIDE.md) | Setting up a new Supabase project, Edge Function secrets, and deploying the web app |
| [`FIRMWARE_GUIDE.md`](FIRMWARE_GUIDE.md) | ESP32 hardware, firmware structure, alert logic, configuring, building, flashing and OTA (version history is in `firmware/agapsense-firmware/src/config.example.h`) |
| [`HARDWARE_BENCH_TEST.md`](HARDWARE_BENCH_TEST.md) | Checklist to run on a real node before installing it or pushing an OTA update |
| [`STAGING_DRY_RUN_RUNBOOK.md`](STAGING_DRY_RUN_RUNBOOK.md) | Rehearsing migrations on a throwaway Supabase project before production |

## How the system works

| Document | For |
|---|---|
| [`FEATURES.md`](FEATURES.md) | Current features and every Edge Function, kept in step with the code |
| [`ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md`](ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md) | Alert delivery semantics (at-least-once), incident invariants and the writer audit |

## Baseline and change control

An evidence-based baseline of what the repository contains, separated from what is approved, deployed and
tested. These are point-in-time documents: file names and line numbers they cite are accurate as of the
commit each one names, not a live guarantee.

| Document | For |
|---|---|
| [`system-specification.md`](system-specification.md) | The detailed baseline specification (draft v0.3), including the status-tracked Known Issues list and the audit-remediation record (Appendix B) — the only specification; `FEATURES.md` is the short overview |
| [`scope-boundary-register.md`](scope-boundary-register.md) | What is in scope, unverified, defective or excluded (Deliverable B) |
| [`requirements-traceability.md`](requirements-traceability.md) | Each requirement mapped to its implementation and verification (Deliverable C) |
| [`open-questions-and-decisions.md`](open-questions-and-decisions.md) | Questions only the project owner can decide (Deliverable D) |
| [`change-request-template.md`](change-request-template.md) | Form to fill in before changing behaviour (Deliverable E) |

## Testing

Testing material lives outside this folder:

- [`../testing/`](../testing) — manual QA checklists and live verification reports, plus a Postman collection
  that simulates a device.
- [`../tests/e2e/README.md`](../tests/e2e/README.md) — the automated Playwright black-box suite that covers
  those checklists.
- [`../firmware/agapsense-firmware/host_tests/README.md`](../firmware/agapsense-firmware/host_tests/README.md) —
  firmware logic tests.
