# RFC-D8: AI Eval-Harness Ownership — Engineering vs Compliance vs Hybrid

**Status:** Draft (open for comment until SOC 2 Type II audit kickoff, 2026-10)
**Author:** Engineering leadership panel (panel-300 H7 recommendation)
**Decision-owner:** Founder
**Forcing date:** SOC 2 Type II audit kickoff (2026-10) or model deprecation event
**Decision-after:** G1 (eval-as-gate) shipped and seeded with 5+ test cases per surface; first compliance-audit dry-run complete; Theo + Indira capacity mapped

## Background

The AI eval harness (FW-THEO-1 + FW-INDIRA-1) is v0: schema (`ai_models`, `ai_test_cases`, `ai_test_runs`, `ai_cost_ceiling_overrides`) is shipped. But there are zero test cases seeded, no "block model swap until pass-rate ≥98%" gate, and no SOC 2 audit is scheduled. Theo's lens: the harness is an engineering cost-discipline + quality tool; ship it as part of the dev loop and let model changes be driven by latency + cost targets. Indira's lens: the harness is compliance evidence (FCRA explainability + bias audit); block model swaps until harness passes and audit-log the rejection.

By 2026-10 (SOC 2 Type II kickoff), the choice matters: if ownership flips to Indira, the harness becomes a compliance gate that could slow deployment. If it stays with Theo, it's a velocity tool that doubles as Series-A credibility ("we gate all AI outputs").

## Options

### Option A — Engineering Ownership (Theo's choice)
30 days: Theo seeds 5 baseline test cases per surface (Pax inbox, Pax executive, complianceAI). Engineering owns the corpus. 60 days: cost-ceiling alerting wired to `/founder-home`; latency P95 metrics shipped per model. 90 days: A/B model rollout via the harness — "swap claude-opus-4-7 for sonnet-4-6 if pass-rate stays ≥95% and cost drops ≥20%." Defers SOC 2 audit-evidence prep until Q3. Owner: Theo + his team; compliance consults but doesn't gate.
**Cited by:** theo-okuda (cost-discipline + quality metrics), ai-ml-eng (eval scaling), product-leadership (velocity unblocked), vendor-partners (Anthropic/OpenAI deprecation playbook)
**Trade-off:** Harness becomes a developer-experience tool, not compliance evidence. SOC 2 auditor (Ravi, from security-compliance panel) will need to rebuild the artifact as "evidence" in Q3 2026, adding work. Model-swap decisions are engineering-driven; compliance has consult, not veto.

### Option B — Governance Ownership (Indira's choice)
30 days: Indira seeds compliance-shaped test cases (FCRA disclosure correctness, TX §5.069 inclusion, no-codename-leak). Compliance owns the corpus. 60 days: hard gate: "no model swap unless harness pass-rate ≥98% on critical-severity cases." Founder gets paged on a red. 90 days: SOC 2 Type I evidence package starts pulling harness reports as the "AI controls" section. Owner: Indira + compliance team; engineering consults. Risk: harness becomes a velocity bottleneck if test-case authoring is slow or model swaps are blocked for weeks waiting on compliance sign-off.
**Cited by:** indira-lockwood (compliance-mandatory framing), security-compliance (SOC 2 + FCRA evidence precedence), adversarial-stress (bias audit + explainability in discovery)
**Trade-off:** Model-swap velocity is constrained by harness test-case quality + compliance review time. If a new Anthropic model is released and we want to test it, the 98% pass-rate gate could delay adoption by 2-4 weeks. Engineering morale risk: "we want to ship faster but compliance is blocking us."

### Option C — Hybrid Stage: Theo now (30-90d), Indira at 90-day flip
Theo owns the harness infra + cost-ceiling for the next 90 days (gets test cases seeded + cost alerting wired). At 2026-08-08 (verification gate), flip ownership to Indira's compliance frame as part of SOC 2 prep. The artifact is the same; the consumer changes from engineering-quality-gate to compliance-evidence.
**Cited by:** eng-leadership (staged ownership pragmatism), security-compliance (90-day cadence aligns with audit prep), ai-ml-eng (early velocity unlock + late governance rigor), executive-strategy (Series-A credibility from both angles: engineering discipline + compliance evidence)
**Trade-off:** Ownership transfer at 90d requires clear handoff docs + Indira onboarding on Theo's corpus. If transfer is sloppy, the harness becomes abandoned (nobody owns it) by month-4.

## Five questions reviewers must engage

1. **Test-case authoring velocity (Caelan's lens from ai-ml-eng):** Caelan (eval-scaling engineer) says "scaled an eval corpus from 10 → 10,000 cases." How many test cases do we need per surface (Pax inbox, Pax executive, complianceAI) to make the harness credible? 5? 20? 100? If Indira authors compliance-focused cases (FCRA correctness, disclosure inclusion), how many can one compliance engineer write per week? If the answer is "10/week," then 100 cases = 10 weeks = blockage risk.

2. **Model-deprecation trigger:** When does the harness *need* to gate a model swap? Is it every monthly model release (Claude 4.5 → 4.6)? Or only major tier changes (Opus → Sonnet)? Or only when a model is deprecated by Anthropic (GPT-3.5 end-of-life)? If we're gating every monthly release, the pass-rate gate becomes friction; if we're gating once per year, it's a non-issue.

3. **False-positive cost (for compliance-flavored test cases):** If Indira authors a test case "complianceAI must include TX §5.069 verbatim," and the new Claude model includes it *semantically* (same meaning, different wording), does the case pass? If the case fails, we've blocked a model upgrade for a false positive. How do we prevent test-case brittleness?

4. **Series-A credibility angle:** Both Theo and Indira claim the harness is Series-A credibility. Theo's angle: "we gate deployment on cost + latency targets; operational discipline." Indira's angle: "we gate model swaps on compliance pass-rate; evidence of SOC 2 controls." Which narrative is more compelling to Series-A investors? Do they care about both?

5. **Compliance-audit dry-run timeline:** Indira needs to run a "compliance-audit dry-run" before SOC 2 auditor Ravi does the real thing. When does that happen? By 2026-06-08 (30-day gate)? By 2026-08-08 (90-day gate)? The answer determines when ownership needs to flip. If dry-run is at 90d, Theo owns until then. If dry-run is at 30d, Indira needs to start owning sooner.

## What needs to be true to decide

- **G1 shipped + seeded with test cases (2026-06-08):** The eval harness must be in production, evaluating every Pax + complianceAI generation. At minimum, 5 test cases per surface (15 total). Theo + Indira collaborate on seeding; ownership question is deferred.
- **Eval pass-rate trend measured (2026-08-08):** The `/founder/compliance-dashboard` should show eval pass-rate trend for each surface. If trend is stable (>95%), governance overhead is justified. If trend is noisy (<85%), governance gates will block deployment; engineering ownership is more pragmatic.
- **First compliance-audit dry-run complete (2026-08-08):** Indira runs a "mock SOC 2 Type I audit" of the harness. What gaps does Ravi (real auditor) surface? If gaps are major, harness ownership must flip to Indira by 2026-09-01 to remediate before real SOC 2 audit (planned 2026-10).
- **Theo + Indira capacity check (2026-08-08):** Theo has finite engineering-leadership bandwidth; Indira has finite compliance bandwidth. Both can't own the harness equally. By 2026-08-08, we know: if Theo is at 100% on other eng-leadership work, Indira takes over. If Indira is at 100% on SOC 2 prep, Theo owns. If both have capacity, hybrid is feasible.
- **Model-deprecation event or Series-A close (2026-10 or 2026-12):** The "true" forcing function is: (a) Anthropic deprecates Claude 4.5 and we need to swap to Claude 5.0, triggering the harness gate, or (b) Series-A closes and investor counsel reviews the harness as evidence of AI controls, or (c) SOC 2 Type II audit kicks off and auditor (Ravi) requires the harness to be in compliance shape.

## Recommendation

**Indira's governance framing wins long-term, but Theo's engineering ownership wins near-term.** Here's the hybrid proposal:

**Months 1-3 (2026-05-08 → 2026-08-08): Theo owns.** The harness is a velocity tool. Seed test cases (15 minimum), wire cost-ceiling alerting, ship model-swap A/B capability. Engineering controls model decisions. Compliance reviews the output, but doesn't gate.

**Months 4-6 (2026-08-08 → 2026-10-08): Ownership flips to Indira.** At the 90-day verification gate, Theo hands off to Indira. The harness infrastructure stays the same; the *consumer* changes. Indira owns the test-case corpus, gates model swaps, and feeds harness reports into SOC 2 Type I evidence package. Theo + AI team consults, but Indira has the final say on model changes.

**Rationale:** By 2026-08-08, the harness has shipped and matured. Theo's "engineering discipline" job is done. Indira needs the harness to be governance-shaped before the 2026-10 SOC 2 audit. This staged handoff prevents the harness from becoming a victim of unclear ownership ("who maintains this?") and gives both Theo and Indira the support they need in their peak windows.

## Comment thread

(Reviewers add comments below this line. Founder owns the resolve.)

---
