# Fix-and-Flip V1 — Step 0 record (2026-11-05)

- **Package:** `claude-package-fix-and-flip` (Muse draft, 2026-11-05).
- **Base:** read on main `da74f12e` (#457). The spec was verified at `f7f2e3f3`. The 20 files that changed in between include no flip, rehab, ARV, kit, claims or ladder file (`git diff --stat`).
- **Method:** each verdict is marked **read** (source/git), **ran**, or **unverified**. There is no staging access from this session, so every staging fact is unverified.
- **Outcome:** **STOP before any build commit.**
  - §2.2 hits a named stop condition for Leg 1.
  - §2.6 and §2.7 contradict §0 premises that Legs 3–4 stand on.
  - Leg 2 has no contradiction, but the spec orders legs 1 → 2 → 3 → 4 and the dispatch says to stop and report. I have not started it.

## Verdicts

| § | Item | Verdict |
|---|---|---|
| 2.1 | Decision-recording census | **A live surface exists, so the `core` claim has a loop behind it.** Details below. Only partly contradicts §0. |
| 2.2 | Kit fit for the evidence payload | **STOP (§10).** The evidence rides neither home the spec names. Details below. |
| 2.3 | Head + census | Read: all nine FF tables are in `shared/schema/fix-and-flip.ts`, the newest migration is 0300, and the table-count ratchet reads 748 (CI log, PR #458). Unverified: staging row counts. |
| 2.4 | Analyzer contract / ARV rows | Partly fits. Details below. |
| 2.5 | Bid → line linkage | **Matches §0's anticipated case.** Details below. |
| 2.6 | Draws + holding meter | **Contradicts §0/§5.3.** Details below. |
| 2.7 | Status-machine discipline | **Contradicts the premise Legs 3–4 hang on.** Details below. |
| 2.8 | Outcome loop | Holds (read, re-checked in the buy-and-hold package): no pack filter, and the smallest review offset is 14 days. |
| 2.9 | ATTOM on staging | The code reads `process.env.ATTOM_API_KEY`. Whether staging sets it is unverified. Leg 5 scripts manual comps either way. |
| 2.10 | Ladder vs Atlas | Ladder rates the vertical `decided` and is green; the Atlas measurement is unverified. Details below. |
| 2.11 | Contractor tax surface (read-only) | A live 1099-NEC generator exists. Reported for the tax lane, untouched. Details below. |
| 2.12 | Activation | Signup goes through `/onboarding-v2` and finishes at `/rehabs`. Details below. |

### 2.1 — Decision-recording census

- **Where flip decisions are recorded today:** `POST /api/flip-analyzer/offer` (`server/routes-flip-analyzer.ts` ~L550–630). It:
  - calls `recordScenario` with engine `flip_mao`;
  - then calls `recordDecision` with pack `"fix_and_flip"`, kind `offer`, the operator's own `reviewDueAt` (required-nullable) and the scenario cited.
- **Where §0 is wrong:** §0 says "the analyzer does not record a decision."
- **Where §0 is right:** it is not a *kit* decision. The route calls the stores directly, with no runtime ownership guard, as a best-effort side effect: a failed recording still returns the draft offer.
- **What it can't record:**
  - Its `rationale` is a sentence the platform writes, not the operator's own.
  - Only `offer` is ever recorded; `acquire` and `pass` never are.
- **Other writers:** none for this pack. `routes-data-intelligence.ts` (blind offer, land) and `routes-lot-pricing.ts` (subdivider) write under other packs.

### 2.2 — Kit fit (STOP)

- **Scenario inputs: no.**
  - The flip engine's `normalisedInputs` keeps only its 11 numeric inputs.
  - `computeScenario` stores *those*, by design: "an extra field in the request must not read later as an input to the maths". An ARV id, a comp set or a SOW reference would be silently dropped.
- **Snapshot evidence field: no.** `recordDecision` builds it only from the claims resolver (`resolveSubject` over the predicate registry). Neither callers nor the kit can pass evidence.
- **Options for Muse** (none taken):
  - **(a)** Caller `ScenarioAssumption`s, which the kit already accepts (`assumptions?`, values string/number/boolean, with a `basis`). They could carry:
    - the ARV row id and its low/mid/high;
    - the comp count and the comp-source posture;
    - the SOW source (`sow`/`operator_stated`), with the rehab id and line count.

    Each with an honest `origin`. No kit change.

    Two points make an id reference durable here: `arv_calculations.comps_used` is never mutated after insert, and no route deletes ARV rows. Supersession only flips `is_current`; the cascade on property/org delete is the exception.

    The cost: the full per-comp grid is either referenced by id, not copied, or flattened to strings.
  - **(b)** Register an ARV predicate so the ARV route writes evidence claims and `resolveSubject` freezes them automatically. This is the canonical evidence channel, but it is a registry change ("add a predicate when a real source starts producing it"). The ARV route is such a source.
  - **(c)** A kit change, for example an evidence/references parameter. The spec forbids this here.

  **Recommendation: (a).** It is the smallest change, keeps the kit as it is, and gives the decision a durable pointer to an immutable comp set. Copying the grid in full can follow later, through (b), as its own package.

### 2.4 — Analyzer contract / ARV rows

- **How rows behave:**
  - `POST /api/parcels/:id/arv` inserts a new row and marks the previous `is_current=false`; history is kept.
  - `loadCurrentArv` in the analyzer selects no `id`, so the MAO and the offer carry only the number.
- **Where the ARV can come from:** the client may send `arvCents` directly, so the ARV behind an offer may be operator-typed and tied to no calculation row.
- **What Leg 1 must do:** label which case applied, since there may be no row to cite.

### 2.5 — Bid → line linkage

- **Bid schema:** `bid_estimates` has `isAccepted`, `rejectedAt` and a per-category `categoryBreakdown`.
- **What accepting does:** `POST /api/bids/:id/accept` writes `bid_estimates` only; nothing reaches `rehab_line_items`.
- **Line-item `committedCents`:** operator-editable, defaulting to 0, so a stored 0 cannot be told apart from "not committed".
- **Granularity:** bids are per category, but lines are per category plus scope. Several lines can share a category, so "the accepted bid's amount for that line" needs an explicit operator act per line, which the spec allows.
- No contradiction.

### 2.6 — Draws + holding meter (contradicts §0/§5.3)

- **Draws:** `construction_draws` is the lender's draw schedule (planned/funded %), not holding cost.
- **The "holding accrued" figure:** computed in `GET /api/rehabs/:id` as `holdingCostMonthlyCents / 30 × days since startedAt`. That is an operator-entered **rate projected over elapsed days**, not recorded spend.
- **What this means:** no holding actuals exist anywhere. §5.3's "holding cost actual-to-date" can only be shown as *accrued at your stated rate* — or it needs a holding-spend record, which is new schema.

### 2.7 — Status-machine discipline (contradicts the Legs 3–4 premise)

- **How transitions happen:** a bare `status` PATCH on `PATCH /api/rehabs/:id`.
- **What gets dated:** **no transition date is recorded.** The only date anywhere is the operator-entered `startedAt`.
  - `actualListingDate` and `closedAt` exist as columns but **no route writes them** (not in the PATCH allowlist or anywhere else).
  - There is no status-history table.
- **What depends on it:**
  - §5.2 (schedule variance from transition dates);
  - §5.1 (a baseline record);
  - §6.2 ("actual hold days derived from recorded dates").
- **Why this stops those parts:** all of them need new schema — a transition log and a baseline record. That goes beyond the two candidates §9.3 pre-names (change orders, realized-economics columns), so it is a stop.

### 2.10 — Ladder vs Atlas

- **Ladder:** `verticalReadiness` measures from source. `tests/support/verticalEvidence.ts` does an AST walk for `recordDecision` with a literal pack citing a `recordScenario` whose engine declares that vertical. The offer route in 2.1 satisfies it, so the ladder reads `decided` and is green.
- **Atlas v1.3 (staging-journey "unproven"):** not in the repository. Its definition is **unverified** here.
- **Reconciled reading:** code-decided, journey-unproven. This is the same split the buy-and-hold hold names.

### 2.11 — Contractor tax surface (read-only)

- **What exists:** a live 1099-NEC generator — `GET`/`POST /api/contractors/1099-nec-batch`, owner/admin; `form1099NecPayer.ts`, `form1099NecPdf.ts` — which refuses a placeholder payer.
- **How it differs from 1099-INT:** it has no qualified-output gate like `requireQualified1099Output`.
- Reported for the tax lane (§10.6). Untouched.

### 2.12 — Activation

- **Path:** `/onboarding-v2` (the gated path).
- **Provisioning:** fix-and-flip provisioning creates template campaigns and tags (`server/services/onboarding.ts`).
- **Finish:** lands on **`/rehabs`** (`onboarding-verticals.ts`).
- **Staging walk:** unverified.

## What can proceed, and what each blocked part needs

| Leg | Status | Needs |
|---|---|---|
| 1. MAO with evidence | **Stopped** (§2.2) | Muse/Tom ruling on the evidence carrier: (a) assumptions, (b) an ARV evidence predicate, or (c) a kit change. Also: does Leg 1 move the existing offer-route recording onto the kit with the operator's own rationale/kind, or add a separate "Record decision" action beside it? |
| 2. Variance completion (§4.1, 4.3–4.5) | Unblocked on existing schema | Leg-order waiver to start before Leg 1. Change orders (§4.2) still wait on §9.3. |
| 3. Timeline truth | **Stopped** (§2.6, §2.7) | A §9.3-style approval for a status-transition log and a baseline record (not pre-named). Holding shown as "accrued at stated rate" unless a holding-spend record is approved. |
| 4. Exit + realized | Partly stopped (§2.7) | The exit decision itself can ride the Leg 1 machinery once Leg 1 is ruled. Realized economics and derived hold need the realized columns (pre-named) and recorded listed/closed dates (not pre-named). |
| 5. Staging proof | Waits on 1–4 | — |

No code changed. No tables or migrations were added. `publicClaims.ts`, `evidenceLadder.ts`, the tax surface and all money paths are untouched.
