# ACREOS AUTONOMOUS CAMPAIGN STATE

**Operational file. Kept short on purpose — git history is the diary and
`docs/implementation/EXECUTION_LEDGER.md` is the long record. Do not turn this
into a novel.**

Branch: `claude/acreos-canonical-implementation-1asgvc`
Restarted from `origin/main` after PR #279 merged (main `4b6b9557`).

---

## Where truth lives (read in this order)

1. The repo at HEAD.
2. `CLAUDE.md` + `shared/governance/constitution.ts` — founder decisions.
3. `shared/architecture/canon.ts` — the machine-readable architecture: 7 layers,
   the 9-stage loop, 15 laws, 18 canonical objects, 12 fitness functions. It is
   verified by `tests/unit/canonicalArchitecture.test.ts`, which proves every
   table it names exists and every enforcement ref is a real file.
4. `docs/implementation/NEXT_UP.md` — narrative frontier.
5. `docs/implementation/EXECUTION_LEDGER.md` — what landed and what proves it.

The autonomous directive's seven layers and canonical loop are ALREADY encoded
in canon.ts. Do not re-derive them; extend that registry.

---

## CURRENT FRONTIER

**The Reality Graph is the unfinished layer.** 9 of 18 canonical objects are
canonical; the 9 that are not are almost all layer 2:

| status | objects |
|---|---|
| canonical (9) | organization, user, deal, evidence-claim, scenario, decision-snapshot, workflow-run, outcome, **opportunity** |
| conflated (3) | property, parcel, document — all inside the `properties` god table |
| role-table (5) | party, holding, instrument (layer 2) · plan, action-receipt (layer 6) |
| absent (1) | relationship (layer 2) |

Ratchet: `OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE = 9`, down-only.

**Both layer-6 role-tables are FOUNDER-PLANE ONLY — verified, not assumed.**
`plan_proposals` has no `organization_id` at all (agent_role, dispatch ids, cost
estimate: the Solene orchestration plane), and every `proofReceipt` reference is
under `autopilot/` or `governance/`, with `actions/outwardAction.ts` explicitly
disclaiming being a receipt. So the CUSTOMER side of both objects is unbuilt,
not merely blurred. `canonicalArchitecture.test.ts` pins the tenancy claim in
both directions so the gap text cannot rot.

**Parcel identity is now addressed at the KEY level, not the table level.**
`shared/parcel/parcelRef.ts` is the one definition of "the same parcel" and
every call site routes through it (adoption ratchet at 0). What remains is that
cadastral identity is still welded to economic state on `properties`, with
direct `sellerId`/`buyerId` FKs into `leads`. Until identity separates from
economics:

- one Property spanning many Parcels is inexpressible (assemblage);
- `relationship` cannot be modelled without duplicating the FK mess;
- multi-strategy evaluation of the same physical asset is not representable at
  the PROPERTY level — though `opportunities` now expresses it at the parcel
  level, which is what BI93 actually asked for.

---

## READY WORK (unblocked, dependency-ordered)

See "NEXT SESSION START HERE" below for the current package and what is already
done. In short: `parcel_snapshots`-as-evidence, then `relationship` (needs a real
first consumer), then party/holding/instrument, then — only if still needed — a
thin parcel identity table. Layer 6 (`plan`, `action-receipt`) is independent and
can proceed in parallel; note both are FOUNDER-PLANE ONLY today, so that work is
a build, not a refactor.

## BLOCKED — OWNER
See `OWNER_DECISIONS_PENDING.md`.

## BLOCKED — EXTERNAL
See `EXTERNAL_PROOF_AND_OWNER_ACTIONS.md`.

## PROOF DEBT
- `lint-reachability` scans `server/services/**` and `server/jobs/**` for
  exported symbols — **`shared/**` is not scanned at all**. A new shared module
  with no production caller is therefore invisible to the "built but unwired"
  gate (directive §33). Measured 2026-08-17 while adding
  `shared/parcel/parcelRef.ts`: the gate stayed at baseline 1401 with six new
  unadopted exports in the tree. Adoption there has to be checked by hand until
  the scan roots widen — and widening them will re-seed the count upward.
- ~~Full-project `tsc --noEmit` cannot complete in this container~~ —
  **RESOLVED 2026-08-17.** It completes under `npm run check`
  (`--max-old-space-size=6144`, `--incremental false`) and found a real error
  that had been hiding: `dueDiligence.ts` returned a `dataSource` value outside
  its own union, shipped in `26517723` while tsc was OOMing. Run the full gate,
  do not assume it will abort.
- **335** `async function`s with an inline `): Promise<{ … }> {` return type are
  invisible to `check-org-scoped-fetch.mjs` — its body-finder lands on the
  return type's brace. Tenancy coverage is overstated by that amount. Measure it
  with `node scripts/check-org-scoped-fetch.mjs --blind-spot`, which reports
  without touching the verdict. The corrected finder is written and tested;
  wiring it is one line in `main()` and needs sign-off because it re-baselines
  four frozen registers (OWNER_DECISIONS_PENDING OD-3).

## NEXT SESSION START HERE

Read this file, then `shared/architecture/canon.ts` — the `parcel`, `plan` and
`opportunity` entries were all CORRECTED or landed on 2026-08-17.

**DONE so far in this campaign** (each verified against code, not against a
report — the `parcel` and `plan` entries were both WRONG when checked):

1. **`shared/parcel/parcelRef.ts` — one definition of "the same parcel."**
   Replaced FOUR competing normalisations. Adopted at `dueDiligence.ts`,
   `publicParcelReport.ts`, `taxDelinquentPipeline.ts` and `storage/gisRepo.ts`.
   Two live defects fixed: dueDiligence wrote duplicate snapshots into the
   null-org SHARED cache, and gisRepo merged "12-345" with "12345" while
   dueDiligence kept them apart — two writers to one table disagreeing about
   which row is which. Adoption ratchet in `parcelRefAdoption.test.ts`: **0**,
   down-only, from 10.
2. **`opportunity` is canonical** — `opportunities`, migration 0237 REGISTERED,
   exported, read by `decisionStore` and written by `routes-opportunities.ts`.
   It fixed a real cross-entity defect: `decisionStore` resolved an
   `opportunity` subjectId AS a `properties.id`, so a decision against
   opportunity #5 froze PROPERTY #5's evidence into an immutable record.

3. **Every open-coded parcel key is retired** — the adoption ratchet reached 0
   from 10, across five files and four mutually-inconsistent rules. Two of those
   were DROPPING REAL ROWS, not just untidy: the tax-sale import deduped on the
   APN alone, so a state-level list rejected the second county's identically
   numbered parcel as "already on this worksheet"; the lead CSV import did the
   same across STATES. Both fixed with tests in both directions.
4. **§55 reconciliation started.** First material survivor: "no new persona
   verticals" — a DO-NOT-DO founder decision that had never reached
   `shared/governance/constitution.ts` at all. Registered, and the structural
   hole closed (the DO-NOT-DO bullet count is now pinned, so a new standing
   decision cannot be added to CLAUDE.md without being mirrored).

**Do not build a new `parcels` table as the first move.** Parcel identity still
has TWO owners: `properties` and `parcel_snapshots`. A third makes it worse.

**`relationship` is now the ONLY `absent` object, and its premise is verified:**
`properties.sellerId` and `properties.buyerId` BOTH reference `leads.id`
(shared/schema.ts:1228-1229), so one real person in two roles needs two rows,
and 13 role-specific person tables exist (`borrower_*`, `buyer_*`, `seller_*`,
`investor_profiles`). It was deliberately NOT built in this campaign: a
`relationships` table with no first consumer is the built-but-unwired defect
this repo keeps finding, and its only honest first consumer is the
`properties` dual-FK migration — a large, risky refactor of a live god table
that deserves its own wave rather than a tail-end addition.

The work package, in dependency order:

1. **Re-frame `parcel_snapshots` as observation, not identity.** It is
   vendor-sourced with a `source` column already ("county_gis", "regrid",
   "manual"). That is precisely an evidence claim with provenance and observation
   time, and the Evidence Fabric (`evidence_claims`) already exists to hold it.
   Until then two tables assert cadastral facts with no conflict resolution
   between them — the thing `resolveClaims` was built to do.
2. **`relationship`** — the last `absent` object, and the one BI184 says the
   role-table sprawl is waiting on. Needs a real first consumer; see above.
3. **Party / holding / instrument** — role-table → canonical. Needs 2.
4. **Only then** consider a thin parcel identity table, if 1 leaves a real need.

Layer 6 (`plan`, `action-receipt`) is independent of the reality graph and can
proceed whenever layer 2 is blocked — but note the correction above: on the
CUSTOMER plane both are absent, not partial, so that work is a build and not a
refactor of what Solene/autopilot already has.
