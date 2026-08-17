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

**The Reality Graph is the unfinished layer.** 8 of 18 canonical objects are
canonical; the 10 that are not are almost all layer 2:

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

**Parcel is the blocking dependency.** Cadastral identity (APN, legal
description) is welded to economic state (purchase price, market value) and to
pipeline status on one table, with direct `sellerId`/`buyerId` FKs into `leads`.
Until identity separates from economics:

- one Property spanning many Parcels is inexpressible (assemblage);
- `opportunity` has nothing to attach to;
- `relationship` cannot be modelled without duplicating the FK mess;
- multi-strategy evaluation of the same physical asset is not representable,
  which is the whole premise of composable Strategy Packs.

---

## READY WORK (unblocked, dependency-ordered)

1. **Parcel as a canonical object** — separate cadastral identity from
   `properties`. Blocks opportunity, relationship, assemblage, Strategy Packs.
2. **Opportunity** — needs Parcel.
3. **Relationship** — needs Parcel + Party.
4. **Party / holding / instrument** — role-table → canonical.
5. **Plan / action-receipt** (layer 6) — independent of the reality graph; can
   proceed in parallel when layer 2 is blocked.

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
   which row is which. Adoption ratchet in `parcelRefAdoption.test.ts`: **4**,
   down-only. The remaining four are `taxSaleCsvImport.ts` ×2 (dedup on
   `apn.toUpperCase()` with NEITHER state nor county in the key) and
   `parcel.ts` ×2 (upstream query fan-out reinventing `parcelMatchKey`).
2. **`opportunity` is canonical** — `opportunities`, migration 0237 REGISTERED,
   exported, read by `decisionStore` and written by `routes-opportunities.ts`.
   It fixed a real cross-entity defect: `decisionStore` resolved an
   `opportunity` subjectId AS a `properties.id`, so a decision against
   opportunity #5 froze PROPERTY #5's evidence into an immutable record.

**Do not build a new `parcels` table as the first move.** Parcel identity still
has TWO owners: `properties` and `parcel_snapshots`. A third makes it worse.

The work package, in dependency order:

1. **Re-frame `parcel_snapshots` as observation, not identity.** It is
   vendor-sourced with a `source` column already ("county_gis", "regrid",
   "manual"). That is precisely an evidence claim with provenance and observation
   time, and the Evidence Fabric (`evidence_claims`) already exists to hold it.
   Until then two tables assert cadastral facts with no conflict resolution
   between them — the thing `resolveClaims` was built to do.
2. **Retire the last four open-coded parcel keys** (above). `taxSaleCsvImport`
   is the sharp one: a key with no county cannot be right.
3. **`relationship`** — the last `absent` object, and the one BI184 says the
   role-table sprawl is waiting on.
4. **Party / holding / instrument** — role-table → canonical. Needs 3.
5. **Only then** consider a thin parcel identity table, if 1–2 leave a real need.

Layer 6 (`plan`, `action-receipt`) is independent of the reality graph and can
proceed whenever layer 2 is blocked — but note the correction above: on the
CUSTOMER plane both are absent, not partial, so that work is a build and not a
refactor of what Solene/autopilot already has.
