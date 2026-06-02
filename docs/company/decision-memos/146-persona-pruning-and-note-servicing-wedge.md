# Decision Memo — #146 · Persona Pruning + Repricing + Note-Servicing Wedge

**Author:** Solene (COO) · **For:** Tom (CEO) · **Date:** 2026-06-02 · **Status:** awaiting founder decision

This memo prepares you to engage with #146 in one page. It does *not* make the call — this lands in the constitutional category of strategic positioning, which is founder-only. My job is to frame the trade-off honestly so the call you make is informed.

---

## The question

Paul Graham's Wave 3 review (synthesized from session #138) argued that AcreOS's current shape — 15 declared business types, 3 core + 5 beta + 7 roadmap — is **too wide to be a wedge**. He framed the choice as:

> *"You can have a feature menu or you can have a moat. If note-servicing is the regulated, sticky, recurring-revenue lane, position the company around that wedge, prune the rest, and reprice up to match the actual product. If land-investor SaaS is the company, kill note-servicing's complexity tax and run it lean. Don't do both at half-strength."*

Three concrete sub-questions:

1. **Persona pruning.** Do we keep all 15 business types declared, or aggressively cut the beta + roadmap tiers?
2. **Repricing.** Current tiering anchors at SaaS pricing. Does AcreOS reprice up as a regulated-financial-services platform?
3. **Wedge positioning.** Does "note-servicing" become the lead story, or stays "land investor + adjacent verticals"?

---

## Current state, factually

| Vertical                | Maturity | Notes                                                                  |
|-------------------------|----------|------------------------------------------------------------------------|
| land_flipper            | core     | The original surface. ~80% of likely Phase 0 customers.                |
| note_investor           | core     | The wedge candidate. Schema + workflows shipped.                        |
| hybrid                  | core     | Land + notes combined. Bridges the two.                                 |
| residential_wholesaler  | beta     | Shipped surfaces, no dedicated marketing.                                |
| fix_and_flip            | beta     | Shipped surfaces, no dedicated marketing.                                |
| creative_finance        | beta     | Schema only.                                                            |
| subdivider              | beta     | Schema only.                                                            |
| tax_lien_deed           | beta     | Feeds note-investor pipeline (tax-delinquent → note holder).            |
| buy_and_hold            | roadmap  | Suppressed.                                                              |
| short_term_rental       | roadmap  | Suppressed.                                                              |
| commercial              | roadmap  | Suppressed.                                                              |
| developer               | roadmap  | Suppressed.                                                              |
| multifamily             | roadmap  | Suppressed.                                                              |
| mobile_home             | roadmap  | Suppressed.                                                              |
| agent_investor          | roadmap  | Suppressed.                                                              |

Source of truth: `shared/business-types.ts`. Soren's landing positioning already tiers Land Investor as core + the rest as beta/roadmap per `feedback_landing_voice`. So the *outward* surface is already wedge-ish; the question PG raises is whether the *internal* surface area (workflows, schema, ongoing maintenance) matches.

---

## PG's case, written out

**1. Note-servicing is structurally better revenue than land-investor SaaS.**
- Recurring per-loan fee (~$5–15/loan/mo industry rate) > one-time deal commission.
- Sticky: servicers don't switch casually; data migration is painful.
- Compliance moat: Reg Z §1026.41 + §1026.36(c), RESPA, state servicer licensing in ~30 states. Casual competitors can't enter without burning 6 months on compliance scaffolding. (Beatrice's deferred work — #144 + #145 — is the floor for this.)
- Higher pricing anchor: "regulated financial platform" justifies $99–299/mo per active portfolio. "Land-investor CRM" tops out around $79.

**2. Persona scatter is a maintenance tax that compounds.**
- 15 business types means 15 onboarding paths, 15 vocabulary sets, 15 sets of edge cases in every new feature. Iris's velocity is measurably reduced by it.
- Customers using beta personas get half-finished experiences that hurt retention.
- Marketing dilution: "Built for property investors. Land Investors today; note investors, fix-and-flippers..." reads as *anything to anyone* rather than a sharp wedge.

**3. The connective tissue between personas is mostly note-servicing.**
- tax_lien_deed → note holder (after redemption fails)
- creative_finance → seller-financed notes
- land_flipper → seller-financed notes (significant overlap)
- note_investor + note_originator + note_servicer are the same buyer at different lifecycle stages

The wedge isn't arbitrary — it's the substrate the other personas connect through. PG's read: cut everything that doesn't flow through that substrate.

---

## The Adversary case (counter-arguments worth taking seriously)

**1. Multi-vertical IS the differentiator.** LoanPro, LendKey, FICS — single-vertical servicing platforms with deep pockets. AcreOS as "regulated servicing platform" walks into their fight. AcreOS as "multi-vertical operating system for property investors" is a category you mostly own. Pruning to note-servicing trades a defensible position for a contested one.

**2. Land investors are the *actual* customer base.** Zero paying note-servicing customers exist today. The community Tom has access to (REtipster, BiggerPockets land-investor circles, etc.) is land-investor-shaped. Pivoting hard to note-servicing throws away the warm distribution.

**3. State servicer licensing is a real $30–80k Phase 2 cost.** Becoming a regulated servicer (vs. positioning as a tool that servicers use) introduces licensing in every state where the platform processes payments on consumer-purpose dwelling loans. The "tool, not servicer" positioning the constitution currently holds is what *avoids* this cost. Repositioning around the wedge may force the regulated path.

**4. Phase 0/1 cash flow shape.** Note-servicing customers are slower to acquire (longer sales cycles, more compliance scrutiny, higher anchor price = more proof needed). Land-investor SaaS customers convert faster at lower ACV but bigger TAM in the bootstrap window. Aggressive pruning may slow the trickle.

**5. Reversibility.** Pruning a persona is hard to reverse — once you cut it from positioning, customer perception is sticky. Adding personas later requires a re-launch story. The 15-vertical posture preserves optionality.

---

## Three options, framed honestly

### Option A — Stay (no change)
- 15 personas remain declared. Marketing leads with land-investor + beta-badges the rest. Pricing unchanged. Iris continues building cross-persona.
- *Strength:* preserves optionality, doesn't kill any path.
- *Weakness:* the PG complaint stands — no sharp wedge, maintenance tax compounds.

### Option B — Full PG (prune + reprice + reposition)
- Cut to 3 core: land_flipper + note_investor + hybrid. Move 5 betas to roadmap. Suppress all roadmap.
- Reprice: anchor tier moves from ~$79 to ~$179/mo, with per-loan-serviced overage at $9/loan/mo above 50 loans.
- Marketing reposition: "AcreOS is the operating system for note-servicing land investors." Land-investor SaaS sits *inside* that frame.
- *Strength:* sharp wedge, compounding moat, higher revenue per customer.
- *Weakness:* throws away warm land-investor distribution; introduces state licensing exposure at Phase 2; harder to reverse if wrong.

### Option C — Hybrid wedge (my read of the safest credible path)
- Don't cut the persona declaration in `shared/business-types.ts` — but cut active engineering investment in beta personas (no new features unless customer-pulled).
- Keep "land investor" as the top-of-funnel acquisition story (warm distribution, faster trickle).
- Position note-servicing as the *in-product upsell* / second-act: "Start with land deals → graduate to your own note book → AcreOS services them."
- Repricing: keep entry tier at current price; add a "Servicing Pro" tier at $199/mo for note-servicing customers, gated on per-loan compliance features. This bypasses the "are we a servicer or a tool" question by being a tool that *the customer* uses to service their own notes.
- *Strength:* preserves both fronts. Doesn't burn the warm channel. Compounds note-servicing where the moat is real.
- *Weakness:* still slower than full-wedge, and the maintenance tax of 15 personas doesn't fully go away.

---

## What I would do if forced to choose

Not the founder call, but you asked the team to be opinionated, so:

**Option C, with a hard ramp toward B by Phase 2.**

Reasoning:
- Phase 0/1 cash flow needs land-investor warmth; cutting it now risks no trickle.
- Note-servicing as an upsell *is the wedge* — same lock-in, same compliance moat — but you don't have to throw away land-investor positioning to get there.
- By Phase 2 ($1k MRR), we'll have evidence: if note-servicing upsell takes, lean further in (move toward B). If land-investor SaaS dominates, the "operating system for land investors" frame is the real shape.
- Letting the market tell you which wedge is real is cheaper than picking now.

The Adversary case for *not* doing C: it's the "do both at half-strength" path PG warned against. Honest reservation. The mitigation is "C is a 6-month experiment with a clear decision point at Phase 2, not a permanent fence."

---

## Constitutional dependencies

If you pick B or C, two constitutional items need your attention:

1. **The "tool, not advisor" rule** (Beatrice's Five-Pillar Doctrine, position 1). If we lean into servicing, the customer becomes the servicer using our tool — not us servicing on their behalf. This must be enforced in product UX, ToS, and marketing copy. Beatrice has the language ready.
2. **Persona-Pax separation** (`project_persona_architecture`). Customer-facing AI stays Pax-only regardless of business-type pruning. Internal codenames stay internal.

---

## What I need from you to act on this

One of:
- **"Option A"** — I do nothing, surface the question again at Phase 1.
- **"Option B"** — I dispatch Iris + Beatrice + Soren on a 2-week repositioning sprint (persona prune in code + repricing + marketing reposition + state-licensing readiness audit).
- **"Option C"** — I dispatch the Servicing Pro tier definition with Beatrice's compliance layer, and we tag the Phase 2 decision point in the charter as an explicit re-evaluation.
- **"Hold, I want to talk through it"** — I prep a 30-min synchronous walk-through with the team's analysis behind it.

No urgency from my side. This is a 3-month-window decision, not a today decision. But the longer it sits, the more code accretes in the wide-persona direction, which makes the eventual cut more expensive.

— Solene
