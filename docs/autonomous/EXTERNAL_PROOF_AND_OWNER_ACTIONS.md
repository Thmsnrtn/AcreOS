# EXTERNAL PROOF / OWNER ACTION QUEUE

Work that cannot be proven inside a coding environment. Listed rather than
faked. Statuses: LOCAL PROOF COMPLETE · EXTERNAL PROOF REQUIRED · OWNER ACTION
REQUIRED · COUNSEL REVIEW REQUIRED · CUSTOMER EVIDENCE REQUIRED · SCALE TRIGGER
NOT FIRED.

---

| # | Item | Status | Note |
|---|---|---|---|
| X-1 | Migration 0236 applied against production | OWNER ACTION REQUIRED | Unregistered from `migrate.mjs` on purpose. See OD-1. |
| X-2 | BYO send-rail affected-org count | OWNER ACTION REQUIRED | Needs `DATABASE_URL`. See OD-2. |
| X-3 | `api_jobs` backlog for `type='lob'` | OWNER ACTION REQUIRED | B6: the `sendLetter` recovery op is deliberately unimplemented so dormant jobs cannot start printing physical mail on deploy. Inspect the backlog before implementing. |
| X-4 | Full-project `tsc --noEmit` | EXTERNAL PROOF REQUIRED | Aborts SIGABRT/OOM in this container (exit 134, zero diagnostics). Needs a bigger machine. |
| X-5 | Live-DB verification of `evidence_claims` / `decision_snapshots` / `scenarios` / `outcomes` | EXTERNAL PROOF REQUIRED | Proven by unit tests + the schema→migration mirror gate, never against real Postgres. BLOCKERS B1. |
| X-6 | Deliverability / 10DLC / provider approval | EXTERNAL PROOF REQUIRED | Cannot be established locally. |
| X-7 | Counsel review of disclosure surfaces | COUNSEL REVIEW REQUIRED | Reg Z §1026.41 statements and statutory disclosure dispatch both now refuse without org identity; the refusal copy is engineering's, not counsel's. |
| X-8 | Real DR restore against a production backup | EXTERNAL PROOF REQUIRED | — |
| X-9 | Customer #1 activation and outcome | CUSTOMER EVIDENCE REQUIRED | Calibration refuses below six compared outcomes by design. |
| X-10 | Marketplace / public API | SCALE TRIGGER NOT FIRED | ~25 and ~50 customers respectively. `server/api-v1/index.ts` is staged, unmounted, and test-guarded in both directions. |
