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
| X-4 | ~~Full-project `tsc --noEmit`~~ | **LOCAL PROOF COMPLETE (2026-08-17)** | It does NOT abort. It completes under `npm run check` (`--max-old-space-size=6144`, `--incremental false`) and found a real error that had been hiding behind the earlier aborts: `dueDiligence.ts` returned a `dataSource` outside its own union, shipped in `26517723`. Do not assume the OOM; run the gate. |
| X-11 | Migration 0237 (`opportunities`) applied against production | OWNER ACTION REQUIRED | REGISTERED in `migrate.mjs`, unlike 0236 — it is an idempotent `CREATE TABLE IF NOT EXISTS`, so the next deploy creates it. Additive and reversible by not writing to it; listed so the deploy is not a surprise. |
| X-12 | Existing `parcel_snapshots` rows written before normalisation | EXTERNAL PROOF REQUIRED | Both readers are deliberately suffix-TOLERANT (`LOWER(county) IN (canonical, canonical ‖ ' county')`) because rows predate either writer normalising. New writes are canonical. A one-time normalising UPDATE would let the tolerance be removed — needs `DATABASE_URL` and a row count first. |
| X-5 | Live-DB verification of `evidence_claims` / `decision_snapshots` / `scenarios` / `outcomes` | EXTERNAL PROOF REQUIRED | Proven by unit tests + the schema→migration mirror gate, never against real Postgres. BLOCKERS B1. |
| X-6 | Deliverability / 10DLC / provider approval | EXTERNAL PROOF REQUIRED | Cannot be established locally. |
| X-7 | Counsel review of disclosure surfaces | COUNSEL REVIEW REQUIRED | Reg Z §1026.41 statements and statutory disclosure dispatch both now refuse without org identity; the refusal copy is engineering's, not counsel's. |
| X-8 | Real DR restore against a production backup | EXTERNAL PROOF REQUIRED | — |
| X-9 | Customer #1 activation and outcome | CUSTOMER EVIDENCE REQUIRED | Calibration refuses below six compared outcomes by design. |
| X-10 | Marketplace / public API | SCALE TRIGGER NOT FIRED | ~25 and ~50 customers respectively. `server/api-v1/index.ts` is staged, unmounted, and test-guarded in both directions. |

---

## §54 final local completion — NOT reached, and which criteria are open

The directive asks for a final completion report only once all 26 criteria in
§54 hold. They do not, so no report is produced — writing one now would be the
fabrication §54's own preamble forbids ("do not interpret 'final state' as
permission to fabricate … production evidence").

What IS true is narrower and checkable: **criterion 25** (full validation,
schema→migration mirror, ratchets, golden journeys, security tests and claim
checks green) holds at HEAD — all 24 gates exit 0 and the suite is 880 files /
12,017 tests / 0 failing.

Materially open, from this campaign's own measurements:

- **Criterion 1** (repo maps cleanly to canonical ownership/layers). 8 of 18
  canonical objects still lack a canonical home: `property`/`parcel`/`document`
  conflated in the `properties` god table, `party`/`holding`/`instrument`/
  `plan`/`action-receipt` as role-tables, `relationship` absent.
- **Criterion 2** (no known tenancy/authority bypass). **335 async function
  bodies are invisible to the tenancy gate** — measurable today with
  `check-org-scoped-fetch.mjs --blind-spot`. The corrected finder is written and
  tested; wiring it needs sign-off (OD-3) because it re-baselines four frozen
  registers. Until then, coverage is overstated by that amount and criterion 2
  cannot honestly be called met.
- **Criterion 5** (the canonical loop through coherent vertical journeys). The
  loop runs evidence → scenario → decision → outcome, and `opportunity` now has
  a home, but `plan` and `action-receipt` exist ONLY on the founder plane —
  verified, both lack customer tenancy — so the customer-side Plan/Action legs
  are unbuilt rather than partial.
- **Criterion 24** (every surviving audit recommendation dispositioned). The
  §55 reconciliation is in progress, not finished. One material survivor found
  and fixed so far: "no new persona verticals" had never reached the
  constitution registry.
