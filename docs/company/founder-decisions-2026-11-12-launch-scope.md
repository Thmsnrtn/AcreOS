# Founder decisions — 2026-11-12 (FD1: launch scope & registry)

Recorded 2026-11-15 by the P1-11 S1 implementing session. The source is the
conceptual-gap roadmap's decision set (FD1–FD5), adopted 2026-11-12 and held in
the roadmap execution tracker ("Decisions in force"). This file writes FD1 down
in the form the registry gates check; it is not a new ruling.

**Membership corrected 2026-11-16 (founder ruling, delegated and decided per
the PR #592 auditor's recommendation).** The original S1 recording swapped
Land and Buy-and-Hold: it pinned Land core and Buy-and-Hold beta. Every
2026-11-12 decision record names Note Investor + Buy-and-Hold as the
full-strength pair and Land, Tax-Lien/Deed, Wholesale as beta; the swap first
appeared in a 2026-11-15 lane-slicing prep doc with no cited decision. The
table below now states the ratified membership. Governing rule, stated by the
founder with the ruling: core is *earned* per vertical by full journey proof —
the earning order is not fixed — and this table is the launch-day snapshot of
what is proven so far, not a ranking. Buy-and-Hold holds core because its
journey is proven (demotion lifted 2026-11-05/07); Land does not hold core
because its journey is not yet proven.

**Membership lifted 2026-11-18 (Wholesale beta → core).** Residential
wholesaler's journey-proof hold (founder-decisions-2026-11-05-wholesale.md)
ended: the scoped Wholesale revenue-loop walk passed green end-to-end on
staging across the first walk, the post-fix re-walk, and the send-half run
(walk record: journey-walk-wholesale-2026-11) — buyer profile created through
a customer-facing path with its buy box stored, buyer match fired, blast sent
on the org's own verified sending identity, contract assigned with
`assignmentFeeCents` recorded, and the fee surfaced in Finance and on the
wholesaler dashboard. Under the governing rule above, Wholesale has *earned*
core — the second of the five public verticals to do so (Notes was first).
Honest scope: the walk proved the scoped revenue loop only; legs outside it
(the buy-box surface, the underwriting decision, contract-chain compliance in
both directions, the org's own e-sign rail, outcome grading, bundle evidence)
were not walked and are not claimed by this lift. The table below now states
the lifted membership: 3 core + 2 beta.

## FD1 — the public promise is 3 core + 2 beta; ten types are registry-only

**Decision (corrected framing, as lifted 2026-11-18).** Of the fifteen registered business types:

| Presentation | Types |
|---|---|
| **Core** (full workflows, sold as such) | Note investor, Buy-and-hold rentals, Residential wholesaler |
| **Beta** (offered, labelled Beta) | Land flipper, Tax lien / deed |
| **Registry-only** (built, kept, not in the public promise) | Land + notes (hybrid), Fix-and-flip, Short-term rentals, Commercial, Creative finance, Developer / entitlements, Subdivider, Multifamily, Mobile home / park, Agent-investor |

Fix-and-Flip and Subdivider are named registry-only explicitly: the original
"2 full + 3 beta + 8 leave" arithmetic left them unassigned, and both were
among the four types strangers saw as publicly core.

**What registry-only means.** The type stays registered with its data intact —
label, workflow templates, spotlight modules, routes, tables. Every existing
book of that type keeps working exactly as before. It is not offered to new
signups (`isProductionReady` is core|beta, so vertical profiles and onboarding
read false), and a stranger is told "not sold" (the landing's muted third
tier). Nothing is deleted.

**What this supersedes.** OD-5 (2026-08-17) kept the registry at `core` for
all fifteen and lowered the PUBLIC claim through an eleven-row demotion table.
FD1 moves that conservatism into the registry itself; the table is empty and
pinned empty. The 2026-11-05 buy-and-hold release stands in substance:
Buy-and-Hold is a `core` launch type by this decision, consistent with its
demotion having been lifted on journey proof; it still measures `decided`.
The wholesaler's journey-proof hold ended with the 2026-11-18 lift above: it
is a `core` launch type, still measures `decided`, and its ladder entry now
claims the loop.

**The one gap this decision owns.** `note_investor` is promised as core on
evidence that reaches `surfaced` (real modules and templates, no production
decision desk yet). The readiness ratchet counts it (baseline 10 → 1, measured)
and names it in a dated register; the gap closes when the notes vertical
records a decision, and the register entry must go in that commit.

## Where it is enforced

- `shared/business-types.ts` — the 15 `maturity` values; `registry_only` is a
  first-class tier; `registryPublicTier` is the one registry→public mapping.
- `shared/business-types/publicClaims.ts` — `publicMaturityOf` derives from the
  registry (plus the Evidence Ladder cap); `PUBLIC_CLAIM_DEMOTIONS` is `{}`.
- `shared/business-types/readiness.ts` — `registry_only` requires `surfaced`.
- `shared/governance/evidenceLadder.ts` — vertical caveats read their
  public-tier wording from the registry.
- `scripts/audit-public-claims.ts` — the business-types source paragraph is
  registry-derived.
- Tests: `fd1LaunchScope.test.ts` (exact 15-row pin), `verticalReadiness.test.ts`
  (ratchet 1 + the FD1 register), `publicMaturityRendered.test.tsx`,
  `landingVerticalTiers.test.ts`, `evidenceLadder.test.ts`,
  `verticalSelectability.test.ts`, and the per-vertical gates that pinned the
  old `core` label.

## Follow-ups (not this slice)

- **Landing copy.** Registry-only types render in the landing's third tier,
  whose copy reads "On the roadmap — promised, not sold" (`landing/copy.ts`).
  They are not roadmap items; the wording needs a founder-approved line.
- **Onboarding (P1-11 S2)** and **in-product labels (S3)** read the registry
  next; this slice changed data only.
