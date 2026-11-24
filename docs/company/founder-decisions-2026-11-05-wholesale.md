# Founder decisions — 2026-11-05 (residential wholesaler: held pending journey proof)

Recorded 2026-11-05 by the implementing session. The source is the founder's
wholesale implementation package (relayed to the session 2026-11-05 21:09 ET;
Muse holds the full package on file). It is not a new ruling: it writes down
what the package already decided, in the form the readiness gate checks.
**Muse confirms this reading when auditing the Leg 1 PR.**

## 1. The wholesale claim stays `beta` until the wholesale journey walk passes

**What the package says:** Leg 5's staging journey walk is "the evidence for a
later, separate beta-demotion-lift PR", and no leg PR may touch the claims or
evidence-ladder files.

**Why this needs a register entry:** `tests/unit/verticalReadiness.test.ts`
measures evidence from source. Leg 1 mounts a reachable wholesale decision
desk (`POST /api/wholesale/underwrite`, engine `wholesale_mao`), so
`residential_wholesaler` measures `decided`. Without a hold, the OD-5 rules
then require lifting `PUBLIC_CLAIM_DEMOTIONS.residential_wholesaler` and
flipping its ladder entry in the same commit as the mount — exactly what the
package forbids. This is the buy-and-hold situation
(`founder-decisions-2026-11-05-buy-and-hold.md`, Option B), so it gets the same
mechanism.

**Decision:** `residential_wholesaler` joins `HELD_PENDING_JOURNEY_PROOF`:

- held since 2026-11-05, review by **2026-12-31**;
- the public claim stays `beta` (`publicClaims.ts` untouched);
- the ladder entry stays "surfaced" (`evidenceLadder.ts` untouched);
- `MATURITY_OVERCLAIM_BASELINE` 11 → 10, because the wholesaler's declared
  `core` is now supported by measured evidence.

The register's own assertions apply unchanged: the entry must measure
`decided`, keep its `beta` demotion, not claim the loop on the ladder, cite
this file, and expire on its date.

**How the hold ends:** the Leg 5 walk passes on staging → the founder decides
the lift → one commit removes the demotion, flips the ladder entry and deletes
this register entry. If 2026-12-31 passes first, the gate fails until the
founder lifts the claim or re-dates the hold. Moving the date to get green is
not allowed.

**Not decided here:** lifting the `beta` claim.

## Addendum — 2026-11-18: the hold is lifted

The scoped Wholesale revenue-loop journey walk passed green end-to-end on
staging across the first walk, the post-fix re-walk, and the send-half run
(walk record: journey-walk-wholesale-2026-11): buyer profile created through
a customer-facing path with its buy box stored, buyer match fired, blast sent
on the org's own verified sending identity, contract assigned with
`assignmentFeeCents` recorded, and the fee surfaced in Finance and on the
wholesaler dashboard. Under the founder rule of 2026-11-16 (core is earned per
vertical by full journey proof), `residential_wholesaler` is lifted
`beta` → `core` in `shared/business-types.ts`, its ladder entry flips to
`decided`, and its `HELD_PENDING_JOURNEY_PROOF` register entry is deleted —
the same one-commit path this file prescribed. Honest scope: the walk proved
the scoped revenue loop only; legs outside it were not walked and are not
claimed by the lift.
