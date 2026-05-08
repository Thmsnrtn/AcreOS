# asher-klein — Narrative Architecture Under Vertical Pressure

**Reading list:**
- MASTER-FINDINGS-RECONCILIATION.md (21/24 P0s shipped)
- post-may1-resweep.md (RS-1..RS-7 closed; RS-4..RS-7 account-security)
- Original: elite-team-2026-05-01/asher-ceo.md

**State read:**

May 1 I reported: one voice on the landing, three inside. RS-4..RS-7 hardened the account-security surface (email alerts, rate-limits, dual-control). The 6 vertical PRs landed clean—no persona-architecture leaks in `routes-notes.ts` or `routes-bh.ts`. But the leak isn't gone; it's *morphing*. Every new vertical tempts engineers to write "Forge logs note-capture" or "Sophie surfaces adverse-action notices" in customer surfaces. The founder-to-customer narrative journey *still* breaks at `/today` because the product doesn't know it's shipping 6 distinct audiences (Land Investor, Note Investor, BH Operator, etc.) under one brand.

**Push forward — my 5 moves (ranked):**

1. **Make the ESLint rule `no-founder-codenames-in-customer-jsx` a hard error, not advisory.** Pre-commit hook. Every new vertical will leak without enforcement. Effort: 4 hours. Cost of deferred: 2 days per vertical spent reworking customer surfaces.

2. **Define "voice anchor" surfaces per vertical, not inherited.** Land has `/why` + landing voice. Note Investor doesn't. Each vertical needs its own philosophy page (`/founder-notes/about`, `/bh-customers/how-to-screen`) authored by the vertical owner in the founder-voice style guide, not copy-pasted. Effort: 3d per vertical + 1d wiring.

3. **Audit `/founder-dashboard` monolith for persona leaks before extraction.** 7,379 lines—`investorType`, `autonomyScore`, `agentLifecycle` mixed with feature flags and admin. If these remain post-extraction, you're building the ops console on ambiguity. Clarity-doc + 2d audit prevents them leaking into customer code later.

4. **Ship a "BRAND-VOICE.md" style guide.** Rules ("every empty state names the agent"), examples, commit links. Living doc, quarterly refresh. Makes onboarding and code-review simpler than ESLint alone. Effort: 1d.

5. **Defer the two-pricing-model decision 30 days, but document explicitly.** Run prosumer pricing ($20–$79) through A/B gates on new signups for 2 weeks, measure CAC + Day-30 retention. Document rationale in `PRICING-DECISION.md`. Don't guess; let data converge the story.

**What I'd defer:**
- Full FOUNDER-DASHBOARD-V2-PLAN extraction queue (7–9 days). Real debt, not blocking growth.
- Cancellation-flow polish. FCRA/RESPA on BH matters more to LTV than founder email.

**What scares me most:**

*Each vertical becomes a daughter brand instead of cohesive multi-vertical story.* Five products instead of one. By the time Cuthbert (white-label) ships, the founder's original voice is buried. Mitigation: ESLint (move #1) + voice anchors (move #2) + style guide (move #4) create three-layer guardrail. **The hard call: narrative first (consolidate voice, then verticals) or execution first (ship verticals, polish voice in Q3).** I'd choose narrative first—you've paid 90% of the cost.

— Asher
