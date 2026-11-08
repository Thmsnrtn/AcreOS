# Founder decisions — 2026-11-05 (buy-and-hold: held pending journey proof)

Recorded 2026-11-05, relayed by Muse (COO) under the founder's standing rule.
It answers the blocker on PR #458, the buy-and-hold release
(`docs/evidence/2026-11-03/buy-and-hold-release.md`, "Stop — the demotion
fence cannot hold on main"). The session recommended Option B, and this
records it.

## 1. A code-decided vertical may stay `beta` while its journey proof is pending

**Decision (Option B):** `tests/unit/verticalReadiness.test.ts` carries a
dated "held pending journey proof" register, `HELD_PENDING_JOURNEY_PROOF`. Its
one entry is `buy_and_hold`.

- **Why:** the readiness test measures evidence from source, so mounting the
  buy-and-hold desk makes the vertical `decided`. The OD-5 rules then forced
  the public demotion to be lifted, and the evidence ladder to be flipped, in
  the same commit as the mount. The public claim is meant to wait on journey
  evidence: the scripted staging run recorded in the Readiness Atlas. The
  register states that gap explicitly rather than hiding it.
- **What stays true for buy_and_hold:**
  - the public claim stays `beta` (`PUBLIC_CLAIM_DEMOTIONS.buy_and_hold`
    untouched);
  - the evidence-ladder entry stays "surfaced".
- **What the register enforces, each a failing assertion:**
  - the held vertical must measure `decided`;
  - its demotion must still be `beta`;
  - its ladder entry must not claim the loop;
  - the entry must cite this file and be inside its `reviewBy` date
    (2026-12-31);
  - the register is pinned to exactly `["buy_and_hold"]`.
- **How the hold ends:**
  - Leg 3's staging journey proof completes and the Atlas row is written;
  - then Tom decides the lift;
  - then one commit removes the demotion, flips the ladder entry to "decided"
    and deletes the register entry.
  - If `reviewBy` passes first, the gate fails until Tom either lifts the claim
    or re-dates the hold. Moving the date to get green is not allowed.

**Not decided here:** lifting the `beta` claim. That stays Tom's call, on the
Atlas evidence, after Leg 3.

## Addendum — 2026-11-05: the hold is lifted

**Decision:** the founder lifted the buy-and-hold `beta` demotion on
2026-11-05. The founder made this call; it was relayed in the build session
and carried out as §1 prescribes ("How the hold ends").

- **Evidence:** Leg 3's post-merge staging journey proof passed all 7 steps on
  the `c8fa715` deploy, on a fresh org: activate → intake → underwrite with a
  recorded decision → the decision persists → pipeline/units → review due →
  outcome recorded. The record is `postmerge-458-journey-proof-2026-11-05.md`,
  kept on the COO side (not in this repo). This meets the register's condition
  inside its 2026-12-31 `reviewBy` window.
- **What changed, in one commit:**
  - `PUBLIC_CLAIM_DEMOTIONS.buy_and_hold` removed
    (`shared/business-types/publicClaims.ts`);
  - the buy_and_hold evidence-ladder entry flipped from "surfaced" to "decided"
    (`shared/governance/evidenceLadder.ts`);
  - the buy_and_hold entry deleted from `HELD_PENDING_JOURNEY_PROOF`
    (`tests/unit/verticalReadiness.test.ts`). The register is now pinned empty,
    and the OD-5 assertions hold with no exemption: reinstating the demotion or
    a hold fails the gate until a new founder decision changes it.
- **Not changed:** product code, pricing, and every other vertical.
