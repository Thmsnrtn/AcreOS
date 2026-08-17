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
| canonical (8) | organization, user, deal, evidence-claim, scenario, decision-snapshot, workflow-run, outcome |
| conflated (3) | property, parcel, document — all inside the `properties` god table |
| role-table (5) | party, holding, instrument (layer 2) · plan, action-receipt (layer 6) |
| absent (2) | relationship, opportunity (layer 2) |

Ratchet: `OBJECTS_WITHOUT_CANONICAL_HOME_BASELINE = 10`, down-only.

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
- Full-project `tsc --noEmit` cannot complete in this container: it aborts
  SIGABRT/OOM (exit 134, zero diagnostics). That is the truncated-run shape
  `scripts/check-tests-typecheck.mjs` refuses to report on. Type safety is
  currently proven by the test suite + by-hand call-site checks, NOT by a full
  compile. Any session with more memory should run it and record the result.
- ~348 `async function`s with an inline `): Promise<{ … }> {` return type are
  invisible to `check-org-scoped-fetch.mjs` — its body-finder lands on the
  return type's brace. Tenancy coverage is overstated by that amount.

## NEXT SESSION START HERE
Read this file, then `shared/architecture/canon.ts`. The active work package is
**Parcel**. If it is already landed, the next unblocked dependency is
**Opportunity**.
