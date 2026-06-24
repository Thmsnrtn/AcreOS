# Vertical-Eligibility Rubric — which domains a Foundry pack may serve

**Status:** living spec · **Established:** 2026-06-24 · **Companion to:** `kernel-pack-contract.md`

The governed-autonomy kernel is powerful precisely because it acts in the world. That is also why **not every vertical is eligible.** This rubric is the gate a candidate pack must pass before it is built — it protects the customer (who stays the legal principal), AcreOS (which must never become a deployer-of-record for catastrophic-blast-radius actions), and the category itself.

## The trust-band test (all five must hold)

A candidate vertical is eligible only if its autonomous actions are:

1. **Reversible or witnessable** — an action can be undone, or it passes a human tap before it lands (witnessed-send). No fire-and-forget irreversibles.
2. **Illiquid-asset / low-velocity** — the domain doesn't move fungible value at machine speed. (Land: a parcel changes hands over weeks, not milliseconds.)
3. **Document-heavy, single-owner-of-record** — one accountable principal per record; the work is correspondence, listings, filings — not multi-party real-time settlement.
4. **Bounded blast radius** — the worst plausible autonomous action is an embarrassing email or a wasted ad dollar, not a wired payment, a medical decision, or a securities trade.
5. **Regulatable by content rules** — the domain's prohibited claims can be expressed as a `regulatoryProfile` (deterministic patterns + required disclosures) the kernel claims-engine can screen.

## Hard exclusions (never, regardless of demand)

- **Lending / credit decisions** — ECOA/FCRA adverse-action liability; a wrong call is a federal matter.
- **Health / medical** — irreversible, life-safety, HIPAA.
- **Securities / investment advice** — fiduciary + SEC exposure; note AcreOS already *hard-darks* securities rails.
- **Money transmission / payments-as-the-product** — becoming a regulated MTL/MSB.
- **Anything where the autonomous action is itself the regulated act** (not correspondence *about* it).

## How land passes (the reference pack)

Land acquisition sits squarely in the band: parcels are illiquid + single-owner-of-record; the autopilot's outward actions are *content* (county guides, witnessed outreach) screened by `LAND_REGULATORY_PROFILE` (determinations must be attributed, no investment/fair-housing claims, disclosure required); money only moves through witnessed-send + the fail-closed budget gate; the worst autonomous action is a held draft. Reversible, witnessable, bounded.

## Process

A candidate pack is scored against the five-point test BEFORE any code. A "no" on any point is disqualifying. A "yes" on all five earns the cheap in-repo smoke test (per `kernel-pack-contract.md`) — and only a real buyer pulling earns it funding as a live vertical.
