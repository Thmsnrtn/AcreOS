# Autopilot — elite teardown (fresh eyes, highest scrutiny)

**Date:** 2026-06-16
**Lens:** a panel — elite AI/ML engineers, seasoned SaaS founders, and land/property investors across every type (flippers, wholesalers, seller-finance/note investors, buy-and-hold, subdivide/develop, tax-delinquent/auction). Holding what we built to the highest bar.

## The honest headline (the two gaps the elegance hides)

The machinery is genuinely strong — governed loop, earned autonomy, calibrated foresight, glass-box reasoning, self-aware safety. But with fresh eyes, two **load-bearing gaps** mean it isn't yet elite where it counts:

### Gap 1 — It DRAFTS; it doesn't DISTRIBUTE. The last mile is open.
The growth engine produces *content drafts* (county guides, explainers). Drafting is not growing. The chain **draft → publish → traffic → signup → activation → revenue** is not wired, and there is **no attribution** tying any autopilot action to a real funnel outcome. Consequence: the bandit, the forecast, the calibration, the episodic memory — all of it — has **no real signal to learn from**. It is sophisticated learning machinery idling on synthetic ground. Until a real outcome closes the loop, "efficacy" is mostly "did the dispatch run + did Tom approve the draft," which is not business value. **This is the #1 thing standing between "impressive" and "moves the needle."**

### Gap 2 — It's GENERIC business-ops, not LAND-INVESTING-NATIVE.
AcreOS is a land-investing platform. The flywheel that grows a vertical SaaS is **customer success** — investors closing more deals → retention, word-of-mouth, expansion. Our autopilot optimizes *company chores* (publish content, answer tickets), not *customer outcomes*, and it encodes **zero land-domain expertise or compliance**. A land investor doesn't care that AcreOS published a county guide; they care whether the platform helped them find, evaluate, and transact land. The single highest-leverage autonomous action for this business — *help customers win deals* — is entirely absent.

Everything below is downstream of these two.

---

## Lens-by-lens scrutiny

### Elite AI/ML engineer
- **Reorder-only "intelligence."** The deliberative brain can only re-rank ~7 fixed move kinds. That's arbitration, not planning. No multi-step lookahead, no campaign-level planning, no goal decomposition. The founder's *intents* are injected as prompt strings, not operational objectives the system plans toward (the north-star OKR idea was never built).
- **Forecast isn't contextual.** `forecastMove` predicts P(success | play) from the play's marginal history — it ignores the situation. Episodic memory does context-similarity but lives *separately*. These should be one model: **P(success | situation, action)**. Right now the system can't say "this play works when support is low but not when runway is red."
- **Calibration is diagnosed, not corrected.** We measure Brier/over-confidence and hold promotions — but never *recalibrate* the predictions (Platt/isotonic). It knows it's wrong and keeps being wrong.
- **No causal measurement.** Everything is observational. No holdouts, no counterfactual — so "this play succeeded" can't distinguish causation from "it ran on a good day." For allocation decisions that's a real flaw.
- **Tiny action space starves the bandit.** Thompson sampling over 5 static plays has almost nothing to learn. The learning sophistication outstrips the thing being learned.

### Seasoned SaaS founder
- **Acquisition-only, and even that is half-built.** No activation intervention, no retention/churn, no expansion, no pricing — the autopilot ignores ~half the business. And acquisition itself stops at "draft," never "distribute + attribute."
- **Approval burden doesn't scale.** Every customer-facing action is a witnessed-send tap. At any real support/outreach volume the "0.01% attention" promise inverts into tap-fatigue. There's no batching, no trusted-lane, no digest approval, no one-tap-from-notification.
- **Dormant = unproven.** The elaborate apparatus has produced zero outcomes. Real risk of over-building ahead of signal. The disciplined move is to get the *smallest real loop* producing a *real* signup, then let the machinery earn its complexity.

### Land/property investors (every type)
- **Generic content ≠ land expertise.** County guides and parcel explainers are commodity SEO. A flipper wants deal flow + comps + buyer lists; a note investor wants payment/default tooling; a subdivider wants zoning/entitlement; an auction investor wants lien/tax-delinquent data. The autopilot speaks to none of them.
- **It optimizes the company, not the customer's deals.** For a land SaaS the autonomous superpower would be: surface hot parcels, auto-run comps, flag a stalled deal, nudge a cooling lead, draft the next best action on a customer's pipeline. That *is* growth for this business — and it's absent.
- **No land-grounded compliance.** Customer-facing land content carries liability (acreage, legal access, zoning, flood, easements, title, state-specific disclosure rules). The eval/craft gates are generic. A confidently wrong "buildable, paved access" is a lawsuit, not a slop-factory annoyance.

### Red team / risk
- **Founder-absence deadlock.** The ultimate safety valve is "ask Tom." If Tom is unavailable, critical asks just sit. No escalation ladder, no time-boxed auto-conservative fallback, no secondary approver.
- **Shallow success signal in high-consequence domains.** "Clean cycle" = ran + maybe approved. A legally-risky-but-approved customer message still counts as success. The signal doesn't capture the consequence.
- **Prompt-injection surface.** The support engine drafts replies to *customer-controlled text*. Without hardened input handling on the autopilot path specifically, a malicious ticket could try to steer the agent. (sanitizePrompt exists in the codebase — verify it's wired into this path.)
- **Partial-wedge blind spot.** The stall watchdog catches a dead worker (no heartbeat). A worker that heartbeats but whose tick is silently stuck mid-loop may not trip it.

### Product / UX
- **Approval fatigue** (above) is also a UX failure: the decision card is gorgeous for *one* decision; it doesn't degrade gracefully to twenty.
- **No one-tap mobile approval** from the ntfy notification — the witnessed-send loop should close from the phone in a single tap.

---

## The elevation path (prioritized — what actually makes it elite)

**T0 — Close the last mile + make success causal (THE unlock).**
Wire one real channel end-to-end: draft → publish (owned surface / SEO submission) → instrument → **attribute a signup to the action** → learn from the *real* conversion, not the approval. Add a holdout so efficacy is causal. Without this, nothing else compounds.

**T1 — Make it land-investing-native.**
(a) Point the autopilot at **customer deal success** (the real flywheel): a per-customer "next best action" engine over their pipeline/parcels — surface hot parcels, run comps, nudge stalled deals — gated + tasteful. (b) Encode **land-grounded compliance/craft**: a land-fact eval (acreage/access/zoning/flood/title/state-rule checks) that customer-facing content must pass.

**T2 — Contextual intelligence + planning.**
Unify forecast + memory into a contextual outcome model P(success | situation, action); recalibrate predictions; expand + let the playbook grow; turn founder *intents* into operational **OKRs** the brain plans multi-step campaigns toward (not single reflex moves).

**T3 — Graceful human-in-the-loop.**
Batch/digest approvals, trusted lanes (auto-approve a class once its calibration is proven), one-tap mobile approval from the notification, and an **escalation ladder** so founder-absence fails conservative, never deadlocks.

**T4 — Full-funnel economic intelligence.**
Activation/retention/expansion/pricing in the loop; CAC/ROI-aware budget allocation across moves; meta-reasoning (deliberation/pre-mortem) cost budgeting.

---

## ELEVATION PATH — SHIPPED (2026-06-16, all gated/dormant, 226 autopilot tests)

- **T0 — close the last mile (DONE, end-to-end):** claims gate + 3-layer publish
  gate + publish to the /field-notes rail + marketing_artifacts + the
  agent-output contract + maybePublishFromDispatch + /sitemap-notes.xml +
  attribution off the witnessed touch chain → founder dashboard. + the Control
  Center (DB-backed master switches). + the witnessed-send broadcast fix.
- **T1 — land-native (DONE, core):** dealActions.ts — the deal-coach
  (under-contract→close, stalled negotiation→follow up, hot→contact, new→first
  contact, cold→requalify/drop) over the real `leads` pipeline.
- **T2 — contextual intelligence (DONE, core):** contextualForecast.ts —
  P(success | situation, action) shrinkage blend of forecast + memory; empirical
  recalibration of over/under-confidence.
- **T3 — graceful human-in-the-loop (DONE, core):** escalationLadder.ts —
  absence fails safe (re-page → a decision auto-declines to the safe side; a
  draft never times out).
- **T4 — full-funnel economics (DONE, core):** economics.ts — budgetGate (reserve
  protection), allocateByRoi (expected value per dollar over real efficacy),
  shouldRampBudget (ramp only on proven healthy CAC).

The two load-bearing gaps the panel found are both addressed: it now DISTRIBUTES
(T0) and it is LAND-NATIVE (T1), with the contextual/graceful/economic
elevations (T2–T4) layered on. Remaining integration polish: surface the
deal-coach to customers; wire the ladder into the ask-expiry job; feed
economics into the brain's grow-gate; seed content eval cases.

## The one-sentence verdict
What we built is an unusually well-governed, self-aware *operating loop* — but to be elite it must (1) **close the last mile so it actually moves a real metric**, and (2) **become land-investing-native by optimizing the customer's deals, not the company's chores** — and everything else (contextual learning, graceful approvals, economic intelligence) compounds on those two.
