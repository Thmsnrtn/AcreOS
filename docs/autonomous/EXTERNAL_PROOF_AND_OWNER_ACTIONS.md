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
| X-4 | Full-project `tsc --noEmit` | **CORRECTED 2026-08-25 — the 2026-08-17 local proof was CONTAMINATED** | The 2026-08-17 entry read "LOCAL PROOF COMPLETE … It does NOT abort." That proof was taken in a dev container that exports an ambient `NODE_OPTIONS=--max-old-space-size=8192`, which every command after the `&&` in `npm run check` silently inherited. On that same day CI was aborting at exit 134 on this exact step, and had been since the gate was added. The genuine reproduction is **`env -u NODE_OPTIONS npm run check:tests`**, which aborted with 134 here too. Fixed 2026-08-25 by passing the ceiling at the spawn site (`scripts/lib/heap-ceiling.mjs`) instead of relying on shell propagation. What survives from the old entry: the run does complete when actually given ~5.1 GB, and it did find a real error (`dueDiligence.ts` returned a `dataSource` outside its own union, shipped in `26517723`). **A local proof of a MEMORY property must strip `NODE_OPTIONS` first, or it is measuring the container, not the code.** |
| X-11 | Migration 0237 (`opportunities`) applied against production | OWNER ACTION REQUIRED | REGISTERED in `migrate.mjs`, unlike 0236 — it is an idempotent `CREATE TABLE IF NOT EXISTS`, so the next deploy creates it. Additive and reversible by not writing to it; listed so the deploy is not a surprise. |
| X-12 | Existing `parcel_snapshots` rows written before normalisation | EXTERNAL PROOF REQUIRED | Both readers are deliberately suffix-TOLERANT (`LOWER(county) IN (canonical, canonical ‖ ' county')`) because rows predate either writer normalising. New writes are canonical. A one-time normalising UPDATE would let the tolerance be removed — needs `DATABASE_URL` and a row count first. |
| X-5 | Live-DB verification of `evidence_claims` / `decision_snapshots` / `scenarios` / `outcomes` | EXTERNAL PROOF REQUIRED | Proven by unit tests + the schema→migration mirror gate, never against real Postgres. BLOCKERS B1. |
| X-6 | Deliverability / 10DLC / provider approval | EXTERNAL PROOF REQUIRED | Cannot be established locally. |
| X-7 | Counsel review of disclosure surfaces | COUNSEL REVIEW REQUIRED | Reg Z §1026.41 statements and statutory disclosure dispatch both now refuse without org identity; the refusal copy is engineering's, not counsel's. |
| X-8 | Real DR restore against a production backup | EXTERNAL PROOF REQUIRED | — |
| X-9 | Customer #1 activation and outcome | CUSTOMER EVIDENCE REQUIRED | Calibration refuses below six compared outcomes by design. |
| X-10 | Marketplace / public API | SCALE TRIGGER NOT FIRED | ~25 and ~50 customers respectively. `server/api-v1/index.ts` is staged, unmounted, and test-guarded in both directions. |
| X-14 | Regrid API credential returning 401 in production | OWNER ACTION REQUIRED | Found 2026-08-31 by the E-2 production probe: `/api/health` reports `data:regrid` degraded with "Status 401" — the configured Regrid key is invalid or expired, so the selected parcel-data provider is silently collapsing to fallbacks (the exact DNC-precedent defect class: a chosen vendor failing quietly while everything stays green). Fix is a fresh key in Fly secrets; the session cannot mint provider credentials. Until then parcel lookups run without Regrid. |
| X-13 | `DEPLOY_BOT_TOKEN` secret unset — the in-app deploy ledger has been silently dead | OWNER ACTION REQUIRED | Discovered 2026-08-30 in deploy #44's log (and visible in every prior deploy): the "Record deployment in ledger" step sends `X-Deploy-Bot-Token: ` EMPTY and gets 403 from POST /api/admin/deployments, soft-failing every run — so the founder-plane deployments ledger records nothing. The server contract is ready (`routes-admin-compliance.ts:35-45`). Fix is one shared secret set in BOTH places: `gh secret set DEPLOY_BOT_TOKEN --body "<random>"` and `fly secrets set DEPLOY_BOT_TOKEN=<same>`. Session cannot mint or place secrets. |

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
