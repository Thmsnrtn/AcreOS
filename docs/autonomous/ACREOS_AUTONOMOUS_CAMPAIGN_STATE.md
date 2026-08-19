# AcreOS — the live frontier

**This is a FRONTIER, not a backlog.** It is recomputed from repository truth,
not worked through in order. Nothing here has to be finished before a
higher-value intervention discovered tomorrow. When an item stops being true,
it is edited out — not struck through and kept.

Read `docs/acreos-institution/DEVELOPMENT_INSTITUTION.md` first if you have not.

Branch: `claude/acreos-canonical-implementation-1asgvc`
Verified at: `33dbd74f`, 2026-08-19. Working tree clean, 924 test files /
12,444 tests green, 25 gates green.

---

## Where truth lives, in this order

1. **The repo at HEAD.** Everything below is a hypothesis until re-checked.
2. `CLAUDE.md` + `shared/governance/constitution.ts` — founder decisions.
3. `shared/architecture/canon.ts` — the machine-readable architecture: 7 layers,
   the 9-stage loop, 15 laws, 18 canonical objects, 12 fitness functions.
   `canonicalArchitecture.test.ts` proves every table it names exists and every
   enforcement ref resolves. Extend that registry; do not re-derive it.
4. `docs/acreos-institution/` — product, architecture, experience, data/AI/
   economics, proof, and current implementation state.
5. `docs/implementation/EXECUTION_LEDGER.md` — the long record of what landed.

---

## Current coherent work

**The Reality Graph is the unfinished layer.** 9 of 18 canonical objects have a
canonical home; the 9 that do not are almost all layer 2.

| status | objects |
|---|---|
| canonical (9) | organization, user, deal, evidence-claim, scenario, decision-snapshot, workflow-run, outcome, opportunity |
| conflated (3) | property, parcel, document — all inside the `properties` god table |
| role-table (5) | party, holding, instrument (layer 2) · plan, action-receipt (layer 6) |
| absent (1) | relationship (layer 2) |

Ratchet: `OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE = 9`, down-only.

Two facts that shape the work and were verified rather than assumed:

- **Both layer-6 role-tables are FOUNDER-PLANE ONLY.** `plan_proposals` has no
  `organization_id` at all, and every `proofReceipt` reference sits under
  `autopilot/` or `governance/`. The customer side of `plan` and
  `action-receipt` is unbuilt, not merely blurred — so that work is a build, not
  a refactor, and it can proceed in parallel with layer 2.
  `canonicalArchitecture.test.ts` pins the tenancy claim in both directions.
- **Parcel identity is addressed at the KEY level, not the table level.**
  `shared/parcel/parcelRef.ts` is the one definition of "the same parcel" and
  every call site routes through it (adoption ratchet at 0). What remains is
  that cadastral identity is still welded to economic state on `properties`,
  with direct `sellerId`/`buyerId` FKs into `leads`.

Until identity separates from economics: assemblage (one Property spanning many
Parcels) is inexpressible, `relationship` cannot be modelled without duplicating
the FK mess, and multi-strategy evaluation of one physical asset is not
representable at the PROPERTY level — though `opportunities` now expresses it at
the parcel level.

Dependency order: `parcel_snapshots`-as-evidence → `relationship` (needs a real
first consumer) → party/holding/instrument → a thin parcel identity table, only
if still needed by then.

---

## Highest-value frontier candidates

Not a queue. Each is a live gap with its evidence; pick by value at the time.

1. **The five verticals with dedicated schema but no pack contract.** 60 tables
   across fix-and-flip, notes, rental, subdivision and wholesale, six
   `businessTypeOnly` nav modules, and `businessType` as scattered conditionals
   in ~137 client and ~102 server locations — while `strategy_pack_id` exists on
   `decision_snapshots` and `scenarios` and every production caller writes
   `null`. Canon's own `profile-extensibility` fitness function says `partial`
   for exactly this reason. This is the highest-leverage architectural work
   available and the largest single item on this list.
2. **Should `governanceBrain` gate agent actions at all?** `governedExecute` —
   the unwired wrapper that would have done it — is deleted (deletion ledger,
   2026-08-19), because what it added was a fail-open check and a dead block. The
   INTENT is still open: the confidence cascade is now the only gate on an agent
   action, and a policy engine is a different question from a confidence
   threshold. A fresh design against the working gate, if it is worth it.
3. **`FOUNDER_ROUTE_BASELINE` does not ratchet down.** It asserts only
   `toBeLessThanOrEqual`, and the count equals the baseline at 82 — so a
   consolidation to 78 passes silently and hands the next session four free
   slots for new top-level founder routes, which is exactly the sprawl the
   four-door doctrine exists to prevent. Measured: of the 18 baseline-carrying
   test files, 7 assert stale-high and 11 do not. The registers driven by
   `ratchet.mjs` are fine; several hand-written test baselines are one-way.
4. **`NEVER_PROMOTE_ACTIONS` governs a namespace no live caller enters.** Live
   actions are `proactive:${id}` / `reaction:${id}`; the 15 hard-stop names have
   no executor anywhere, so nothing hard-stop-class currently executes. The
   ceiling proves nothing rather than being stepped over — a canonical-with-no-
   adoption instance that needs the vocabularies reconciled, not more names.
5. **`lint-reachability` does not scan `shared/**`.** A new shared module with no
   production caller is invisible to the built-but-unwired gate. Measured
   2026-08-17: the gate stayed at baseline with six new unadopted exports in the
   tree. Widening the roots will re-seed the count upward, which is why it has
   not been done casually.
6. **Land can now record a scenario — so close the loop.** As of 2026-08-19 the
   blind-offer exit model DELEGATES to `computeLandDeal` instead of computing
   its own, so the canonical `land_deal` engine has a real production caller for
   the first time. Its cost rules live on `underwritingDefaults.landDeal` with
   per-field provenance, and the wizard badges each "Your rule" or "Our
   default". The two customer-visible numbers that were optimistic — ROI on
   purchase price rather than total cost in, and a fabricated `0` where there is
   no cost basis — are corrected. Ledger entry 30.

   What remains is the loop itself. Land records no scenario and no decision, so
   its Today outcome prompt is structurally empty and calibration has nothing to
   grade. Follow the flip precedent exactly (`routes-flip-analyzer.ts:520-620`):
   record on a DELIBERATE act, not every recompute; let `recordScenario` compute
   from inputs rather than accept pre-computed numbers; best-effort in its own
   try/catch so a bookkeeping failure cannot cost the operator their offer.

   The open design question, and it is real: for flip the deliberate act is
   submitting an offer. For land, `POST /api/data-intel/blind-offer` is a
   CALCULATION the wizard re-runs as the user tunes inputs — recording there
   would fill decision memory with keystrokes. The candidates are generating the
   offer LETTER or adding to an offer batch. Confirm which against the wizard's
   real flow before writing anything.

   13 of 15 verticals still stop before a recorded decision (`readiness.ts`,
   frozen and down-only). The gap is the LOOP, not the surface.
7. **539 baselined tenancy entries are frozen DEBT, not fixed code.** Rule-2
   entries first: each is a live path where a caller-supplied id can reach
   another tenant's row (`campaignOptimizer.optimizeCampaign` UPDATEs `campaigns`
   by primary key alone with the org right there on the object).

---

## Recent verified changes

Most recent first. Each was falsified against the semantic defect before landing.

- `33dbd74f` — the institution's five missing documents, written from measured
  reality; `escalate_to_founder` permitted at every trust tier.
- `10447296` — the campaign state becomes a frontier instead of a diary.
- `5fa8ed62` — four places where omission was read as permission: the
  auto-approve ceiling, the absence grant that outlived its expiry, the
  delegation that conveyed unclassified actions, and the cascade check that
  proceeded on its own failure. Ledger 25–27.
- `2f10c1e5` — the autonomy risk classifier's residue resolved DOWNWARD, so any
  unrecognised action auto-executed at the default autonomy level. Ledger 24.
  Opened `docs/acreos-institution/`.
- `e783c716` — posture-gate exemptions were textual prefixes, not path prefixes.
  Ledger 23.
- `8737bfe9` — the restore drill found the gate that would have failed the
  outage.
- `819e4eec`, `2c6260a6` — one command rebuilds the database; the schema rebuild
  needs one SQL pass, not two.

---

## Blocked — owner

`docs/autonomous/OWNER_DECISIONS_PENDING.md`. The queue is currently **empty**:
all six decisions are made, OD-2/3/4/5 implemented, OD-1 a live hold (0236 stays
unregistered), OD-6 needed no code and names Customer #1 as the trigger to
revisit.

Two items are recorded there awaiting a ruling rather than blocking work:
`scoreCountyForTargeting` (sellerMotivationEngine.ts:703) and the five
`campaignEnhancements.ts` exports.

## Blocked — external

`docs/autonomous/EXTERNAL_PROOF_AND_OWNER_ACTIONS.md`. The S3 fetch half of the
DR RTO remains unmeasured — no bucket access from this container.

## Proof debt

- `lint-reachability` scan roots exclude `shared/**` (see frontier candidate 5).
- The measurement-defaults register still holds its baseline; the largest
  remaining family is LLM-parse confidence (`parsed.confidence || 50`), which is
  also the lowest individual consequence.
- A deliberate NEGATIVE result, recorded so it is not re-litigated: the
  fail-open catch class was surveyed (524 empty catches, 133 in gate context)
  and is handled correctly almost everywhere. No gate was built — a register of
  133 mostly-correct sites would freeze noise. Individual instances are fixed as
  found, which is how ledger 27 happened.

---

## Next session starts here

**Stand up a local PostgreSQL first if the work touches schema, migrations, or
the release path.** Every material finding in the 2026-08-17/18 rebuild work came
from standing one up and RUNNING the release command, not from reading it. The
static gates were green over all four defects it found.

```bash
apt-get install -y postgresql-16-pgvector
useradd -m pgtest
su pgtest -c "initdb -D /home/pgtest/pgdata -U postgres --auth=trust"
su pgtest -c "pg_ctl -D /home/pgtest/pgdata -o '-p 55432 -k /tmp' -l /tmp/pg.log start"
# rebuild procedure: docs/reliability/dr-runbook-postgres-restore.md
```

Otherwise: ORIENT on this file and `docs/acreos-institution/IMPLEMENTATION_STATE.md`,
VERIFY the frontier candidates above still hold at HEAD, and pick by value.

Historical phase write-ups from the 2026-08 campaign are archived at
`docs/archive/autonomous/CAMPAIGN_PHASES_2026-08.md`. They are evidence, not
context — read one when you need the reasoning behind a specific change.
