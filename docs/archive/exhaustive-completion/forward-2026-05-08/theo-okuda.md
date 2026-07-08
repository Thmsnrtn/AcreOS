# Theo Okuda — AI surface integrity & cost-per-inference

**Reading list (what I read before writing):**
- `docs/exhaustive-completion/MASTER-FINDINGS-RECONCILIATION.md` (P0-10 Dropbox idempotency, P0-18 LAR overlay open)
- `docs/exhaustive-completion/post-may1-resweep.md` (RS-1..RS-7 closed, tenant-screening permissible-purpose gate + adverse-action notice)
- `docs/exhaustive-completion/REMAINING-WORK-INVENTORY.md` (P1-35..46 cluster on AI/eval; P1-43 pgvector shipped, harness deferred)
- Theo-ai.md — original audit from 2026-05-01 (101 services bypass aiRouter; no eval harness; gpt-4-turbo-preview deprecated)
- `server/services/aiRouter.ts:330-340` (model catalog), `server/routes-ai-draft.ts:44` (Pax inbox prompt), `autonomousHealthMonitor.ts:235` (cost aggregator)
- `shared/billing/tier-pricing.ts` (P0-1 shipped — single source of truth)

---

## State read

Five weeks ago the audit found: zero eval infrastructure, ~101 service files bypassing the router entirely, no per-org cost ceiling, and a deprecated `gpt-4-turbo-preview` hardcoded in 4 places. RS-1..RS-7 closed today. The P0 surface is rock-solid (Dropbox idempotency is the only open blocker; white-label DNS deferred to July). Tier-pricing now has a single source of truth. What's missing is not the wiring — it's the guardrails for the wiring we built.

---

## Push forward — my 5 moves (ranked)

1. **Eval harness v0 with per-org cost ceiling** — wire per-model cost tracking into `autonomousHealthMonitor.ts` (currently sums global only); add `organizations.ai_cost_ceiling_cents` column; emit a `costCeilingBreached` event when daily org spend > threshold. The infrastructure is half-built (`aiTelemetryEvents` table is real, `recordAITelemetry` is already writing). Cage the Pax inbox draft and the board-vote features first — those two have the highest user-facing blast radius if hallucination or cost explodes. Three weeks of work. Blocks nothing; unblocks our compliance story for Series-A diligence (Ashok + Harlowe both ask this; Marisol needs it for CAC payback math).

2. **Deprecation playbook + model pinning** — today we have `gpt-4-turbo-preview` in production (4 callsites: `aiTutor.ts` × 2, `complianceAI.ts`, plus one legacy path). OpenAI's sunset timelines for old models are public; Anthropic just shipped Opus 4.7/Sonnet 4.6/Haiku 4.5 (the old Opus/Sonnet become EOL in Q4 2026). Build a `PINNED_MODELS.ts` constant with deprecation dates for each; CI rule that fails if any service hardcodes an unpinned model; a monthly calendar reminder to audit what hits EOL in the next 90 days. All deprecated-model callsites get migrated to the latest version in `aiRouter.ts:330` catalog. One week. Done before Series-A.

3. **Migrate top-10 direct-OpenAI bypass callsites into routeAITask** — the original audit said 101 services don't use `routeAITask`. Three weeks of audit shows the actual number is closer to 25 critical ones (the rest are older/lower-volume). Target: `supportBrain.ts`, `aiTutor.ts`, `aiOfferService.ts`, `leadNurturer.ts`, `complianceAI.ts`. This unifies observability (every call now hits `aiTelemetryEvents`), enables cascade quality-gating across the board (not just the 40% using the router), and makes cost-per-feature legible to the founder on the dashboard (which Ashok + Harlowe demand). Four weeks. Highest ROI on cost-observability per hour invested.

4. **Pax prompt versioned file + caching** — the inbox draft prompt (`routes-ai-draft.ts:44`) is good (Theo-ai called it tier-4). Move it from inline to `prompts/pax_draft.v3.md` with a header comment. Same for the Pax executive prompt (currently leaks "AI-powered" language and the Sophie persona, which violates Brief §1.2). Prompt changes become reviewable in diffs. Enable `enablePromptCaching` on system prompts >1024 chars. This saves ~20% of Pax chat tokens after the first message (cache hit on system). Two weeks. High-leverage for cost reduction + iteration velocity.

5. **Post-validator on compliance-disclosure AI output** — Marisol's audit called it "the highest-risk surface." A `complianceAI.ts:303` call generates a Texas Property Code §5.069 disclosure, a New York ESRA §307 disclosure, or a Florida statutory seller-disclosure form with zero deterministic post-check. Build a `validateDisclosureOutput()` function that asserts required sections (by state) are present in the generated text *before* the system serves it to the operator. If sections missing: emit to a review queue, flag as "attorney review required," do not send to customer. Pair with an Opus 4.6 + extended-thinking call instead of `gpt-4-turbo-preview` on this surface only. Two weeks. Blocks no customer but reduces founder personal-liability surface.

---

## What I'd defer (and why)

- **AI-as-a-service model (Stripe reselling).** Tempting ($X per API call, margin play). Real data on current cost-per-call variance (Pro customers range $200–$800/mo spend; we don't segment by feature-spend). Build the cost-ceiling + per-feature telemetry first. Can revisit at Series-A when we know our actual unit costs.
- **Hallucination eval set beyond Pax draft.** Pax draft is the highest-trust surface (goes out as customer voice). That's the one golden-set eval. Other features (board votes, self-assessment) have lower user-facing blast radius — validate via CI tests (format, logic) before investing in LLM-judge evals.

---

## What scares me most (one named risk + mitigation)

**Model API cost explosion if Anthropic pricing moves 5x mid-contract.** We've locked Pax/Atlas/Sophie onto frontier-model tier (Opus-class for complex decisions). If the cost-per-million-tokens doubles overnight, our gross margins on Pro tier evaporate. Mitigation: (a) the cost-ceiling column prevents org-level runaway (we hard-stop at $X/day); (b) move fallback logic into `aiRouter.ts` so we can A/B test downgrading a feature to Sonnet when costs spike; (c) contract in writing with Anthropic/OpenAI for 12-month price-lock before Series-A close. Theo-ai called this out; Series-A diligence will demand it.

---

**Bottom line for the founder:** The plumbing is built. What's missing is the visibility and the guardrails. Spend three weeks on eval + cost-ceiling + prompt versioning, and every AI feature that ships is defensible in a diligence room. That's the difference between "we have AI" and "we have AI we're willing to stake our reputation on." Series-A math works only if gross margins hold; margins hold only if cost-per-inference is legible and capped.
