# Founder Autopilot — Making AcreOS Operate Itself (For Real)

**Date:** 2026-06-16
**Origin:** Tom wants AcreOS to run itself on the founder side the way Polsia *claims* to — but actually delivering: legal, safe, self-marketing, self-supporting, self-growing, and needing ~0.01% of founder attention. Polsia's teardown showed the concept is real but its execution has no governance spine (no authority gate, no fabrication control, no budget discipline, no real founder control). AcreOS already has that spine; this plan closes a self-operating loop around it and adds the two missing engines (growth, support) on those rails.

**Founder decisions locked (2026-06-16 quiz):**
1. **Autonomy model = Earned autonomy** — each domain starts supervised, auto-promotes on a clean track record, auto-demotes on anomaly.
2. **Founder-side gate = Policy-gated auto-execute** — AcreOS's own outward actions fire automatically iff they pass compliance + truth/eval + budget gates; only novelty/over-threshold/risk escalates. (Customer-facing Pax keeps witnessed-send regardless.)
3. **Growth = Owned-first, earn into paid** — $0 paid initially; scale owned loops; unlock a hard-capped paid budget only once CAC:LTV proves out.
4. **Activation = Pull growth + support forward now** — activate self-marketing + auto-support immediately; keep heavier dormant agents on their MRR gates.

---

## 0. North star + the founder contract

**North star metric:** *founder actions required per week of healthy operation → approaching zero*, where every required action is genuinely high-stakes (money / legal / safety / direction), never mechanical.

**The founder's entire job collapses to four things — only the first is routine:**
1. **One daily glance** at `/founder/today` (green/amber/red + the single thing, if any, that needs a tap). All-green = do nothing.
2. **Approve only constitution-gated decisions** (capital past threshold, legal/securities/strategic, phase-gate crossings, kill-switch) — target a handful per *month*, each a one-tap witnessed approval.
3. **Set direction quarterly** — the constitution + a short intent statement *is* the standing instruction set.
4. **Nothing else reaches you** — only (a) gated approvals, (b) detector anomalies, (c) money/legal/safety events surface. Routine growth/support/deploys/ops stay invisible.

---

## 1. The governance spine (the rails — already built)

Everything below rides these. The build is mostly *wiring + two new engines*, not new safety primitives.

| Capability | Existing component | Role in autopilot |
|---|---|---|
| Authority gating | Constitution + permission ladder + autonomy levels (assisted/supervised/autonomous, circuit-breaker downgrade) | Grants/limits what each domain may do; the earned-autonomy ladder |
| No unauthorized outward action | Witnessed-send + approval kernel (`approvalKernel.ts`) | Customer actions always human-tapped; founder-side actions policy-gated |
| No slop / fabrication | Truth-ratchet, eval-gates (CI + runtime), honest-null grounding, hallucination guard, voice-linter | Quality gate on every outward artifact (ads, replies, code) |
| Never upside-down economics | Ensemble cost cap, provider free-first registry, phase-gate budget discipline | Hard envelopes on AI + growth spend |
| Founder never loses control | Kill-switch, circuit breakers, founder-override audit | Auto-demote autonomy on anomaly; hard stop available |
| Observability + self-policing | Detectors + auto-dispatch guardrails, alignment detectors + continuous audit, deploy/release watchdog, morning pulse, `/founder/Command` | The loop's senses + the founder's glance surface |
| Compliance | Beatrice layer — CAN-SPAM, OFAC, securities-dark, land-investor positioning, no-competitor-refs | Legal gate before any outward claim/spend/comms |
| Gets smarter + cheaper with scale | Data-coop (k-anon county rollups), provider intelligence routing | The growth/intelligence flywheel |

---

## 2. The four build pillars

### Pillar A — The Governed Operating Loop (the "CEO brain")
A continuous + scheduled loop that senses real state, decides the single highest-value move against the constitution + budget, and dispatches the right team member — **every dispatch inheriting the permission ladder and the policy-gate stack.** This is Polsia's nightly CEO, except it physically cannot take an ungated high-stakes action.

- **Senses (read-only):** MRR, churn, runway, uptime, AI-cost-ceiling %, support backlog + first-response SLA, growth funnel (traffic→signup→activation→paid), open bugs/incidents, alignment drift, deploy health.
- **Decides:** ranks candidate moves (fix-incident > unblock-activation > grow > optimize) via a reasoning agent (Solene/Opus-tier) constrained by the constitution + the active budget envelope + current per-domain autonomy levels.
- **Dispatches:** creates governed tasks routed to the team agents; each task carries its domain's autonomy level and must clear the gate stack (§4) before any outward effect.
- **Cadence:** event-driven (detectors fire → immediate) + a daily plan/summary cycle (morning plan, evening reconcile) — *not* a single all-powerful nightly job.
- **Reuses:** `runScheduledJobs`, auto-dispatch guardrails, detectors, morning pulse, `/founder/Command`. **New:** the closed decide→dispatch→measure controller + the earned-autonomy state machine (§3).

### Pillar B — The Growth Engine (owned-first, earn-into-paid allocator)
Soren's domain. A **governed growth allocator** that runs a closed CAC loop and *earns its way* into paid spend.

- **Channels, in priority order:** owned loops first — programmatic SEO (the `/learn` + county pages), parcel-check virality, the Land Credit Score hook, community, listing syndication. Paid (Google/Meta) is **locked at $0 until CAC:LTV proves out**, then unlocked under a hard monthly ceiling.
- **The loop:** generate + A/B test creative & landing variants → measure CAC by channel against LTV (Lena's unit economics) → kill unprofitable, scale profitable → never exceed the budget envelope, never buy below the CAC:LTV floor.
- **Gates before any spend or send:** compliance (Beatrice: claims truthful via truth-ratchet, CAN-SPAM, positioning, no competitor refs) → eval-gate on copy quality → budget envelope check → autonomy level. Polsia ships claims raw; AcreOS ships none unvetted.
- **Earned-paid unlock rule:** paid budget unlocks only after owned-channel CAC:LTV clears the floor for K consecutive weeks; the cap then ramps as the ratio holds and auto-freezes if it breaks.
- **Reuses:** the growth loops, listingSyndication, financial_ledger, provider/cost discipline. **New:** the allocator + CAC:LTV instrumentation + paid-channel connectors (built but dormant until unlock).

### Pillar C — The Autonomous Support Surface
Rafe's domain (pulled forward). Grounded auto-resolution + a demand→roadmap loop.

- **Resolve:** auto-answer tickets with grounded, cited responses (reuse `supportFirstResponse`, `customerSupportAutoResolver`, `paxSupportResolver`); **policy-gated outbound** (compliance + eval + grounding pass = auto-send; novel/high-stakes/refund/legal escalates).
- **Escalate sparingly:** only genuinely-novel or high-stakes cases reach a tiny founder/queue; everything routine resolves silently within SLA.
- **Feed the roadmap:** recurring issues become ranked demand tickets → the operating loop prioritizes → engineering builds (grounded + eval-gated, so it builds the *right* thing, not slop). This is Polsia's demand→build loop, governed.
- **Reuses:** Pax, the support resolver primitives, eval-gates. **New:** the full-autonomy resolution policy + the demand-aggregation→roadmap bridge.

### Pillar D — The Learning Loop + Founder Cockpit
- **Learning loop:** every outcome (which ads convert, which answers resolve, which features retain) writes to procedural memory + tightens the eval-gate ratchet, so playbooks improve and quality only ratchets up. The data-coop + provider routing make it cheaper/smarter per customer.
- **Founder cockpit:** `/founder/today` is the single 0.01% surface — green/amber/red + the one decision (if any). The escalation policy (§5) governs what's allowed to interrupt the founder.

---

## 3. Earned-autonomy state machine (decision #1)

Per domain (growth, support, deploy, ops, finance), autonomy is a level that moves on evidence:

```
OBSERVE → DRAFT → EXECUTE_GATED → AUTONOMOUS_GATED
   ▲                                      │
   └──────────── auto-demote ◀────────────┘   (on circuit-breaker / anomaly / gate-failure spike)
```

- **Promotion:** a domain auto-promotes one level after **N consecutive clean cycles** (no gate failures, no escalations overturned by the founder, outcomes within expected bounds). N is conservative early, configurable.
- **Demotion:** any circuit-breaker trip, anomaly detector, compliance/eval gate failure rate over threshold, or founder override instantly demotes the domain (mirrors the existing assisted/supervised autonomy downgrade on >5% override rate).
- **Every level still passes the gate stack (§4)** — higher autonomy means *less human escalation*, never *fewer gates*. AUTONOMOUS_GATED ≠ ungoverned; it means "self-approves within policy, escalates only exceptions."

---

## 4. The policy-gate stack (decision #2) — what every action passes

Founder-side outward action = auto-execute **iff** it clears, in order:

1. **Compliance gate** (Beatrice): truthful claim (truth-ratchet), CAN-SPAM/OFAC/securities-dark/positioning as applicable. Fail → block + log.
2. **Quality gate** (eval-gate + grounding): artifact meets the eval floor; facts cited/grounded; no fabrication. Fail → block or revise.
3. **Budget gate**: within the active envelope (AI cost ceiling + growth allocator cap). Fail → block + escalate if material.
4. **Autonomy-level gate**: domain's current level permits this action class. Below level → drop to DRAFT + escalate.
5. **Witnessed-send (customer-facing only)**: any action touching a *customer's* assets/comms still requires the human-tap kernel — unchanged.

Exceptions (novelty, over-threshold $, legal, refunds, irreversible) skip auto-execute and escalate (§5).

---

## 5. Escalation policy — what is ALLOWED to reach the founder

Default "always escalate" set (everything else runs silent):
- **Money** above a founder-set threshold (a charge, refund, spend commitment, or budget-ceiling change).
- **Legal / securities / compliance** decisions or flags.
- **Phase-gate crossings** and constitution-locked items.
- **Kill-switch / sev-1 incident** conditions.
- **Anomaly detector** findings the system can't self-resolve.
- **Autonomy demotions** (FYI digest, not a blocking action).

Everything else (routine ads, support replies, deploys within policy, optimizations) → silent, visible only in the audit trail / `/founder/Command` if he looks.

---

## 6. Phased rollout (incorporating "pull growth + support forward now" + earned autonomy)

Each phase ships **wired + alerted + measured** and starts its domain at OBSERVE/DRAFT, earning up.

- **P0 — The spine wiring (foundation).** Close the operating loop (sense→decide→dispatch→measure controller) + the earned-autonomy state machine + the policy-gate stack as a reusable middleware every domain action flows through. Founder cockpit escalation policy. *Nothing acts autonomously yet — everything DRAFTs and surfaces.*
- **P1 — Autonomous support (pull-forward).** Light up Pillar C at DRAFT → EXECUTE_GATED. Grounded auto-resolution with policy-gated outbound; demand→roadmap bridge. Lowest-risk outward domain to prove the gate stack.
- **P2 — Owned-growth engine.** Light up Pillar B owned-channels at EXECUTE_GATED (paid stays $0/locked). CAC:LTV instrumentation live; the allocator scales SEO/parcel-check/community/syndication.
- **P3 — Paid unlock (earned).** Once owned CAC:LTV clears the floor for K weeks, unlock the hard-capped paid envelope; allocator spends across paid + owned, auto-freezing if the ratio breaks.
- **P4 — Full loop + auto-promotion.** Operating loop runs continuously; domains auto-promote toward AUTONOMOUS_GATED on clean track records; learning loop tightens playbooks. Founder attention asymptotes to the escalation set only.

Heavier dormant agents (Tess/Iyari/Quinn/Andrei) stay on their existing MRR gates throughout.

---

## 7. Definition of done (per pillar) — wired + alerted + measured

- **A (loop):** every dispatch carries an autonomy level + passes the gate stack; the loop's decisions are auditable; a detector alerts if the loop stalls or a domain's gate-failure rate spikes.
- **B (growth):** CAC + LTV measured per channel; spend provably cannot exceed the envelope; paid cannot unlock without the earned rule; every claim compliance+eval-passed.
- **C (support):** first-response SLA met autonomously; auto-resolution rate + reopen rate tracked; zero unvetted outbound; demand→roadmap items ranked.
- **D (learning/cockpit):** outcomes feed procedural memory; eval baselines only ratchet up; `/founder/today` shows the true green/amber/red + the one decision; escalation policy enforced.

---

## 8. Numbers the founder still needs to set (defaults proposed)

| Knob | Proposed default | Notes |
|---|---|---|
| CAC:LTV floor for paid unlock | LTV:CAC ≥ 3:1 sustained | Standard SaaS health bar; allocator won't buy below it |
| Weeks of clean owned-CAC before paid unlock (K) | 4 | Conservative; proves the ratio isn't noise |
| Paid monthly envelope on unlock | e.g. $500/mo hard cap, ramping | You set the real number; allocator can never exceed it |
| Money-escalation threshold | e.g. $100 single / $1,000 cumulative/day | Above → founder tap; below → silent |
| Clean cycles to auto-promote a domain (N) | 10 | Configurable per domain risk |
| AI cost ceiling (existing) | current ensemble cap | Already enforced |

---

## 9. Risks → mitigations (the Polsia failure-modes, pre-empted)

| Risk (Polsia got burned) | AcreOS mitigation in this plan |
|---|---|
| AI takes unauthorized outward action | Policy-gate stack + witnessed-send (customer) + escalation set |
| Fabricated claims / slop | Compliance + truth-ratchet + eval-gate before any outward artifact |
| Overspends / unprofitable CAC | Hard budget envelope + CAC:LTV floor + earned-paid unlock + auto-freeze |
| Founder loses control | Earned autonomy + circuit-breaker demotion + kill-switch + audit trail |
| Legal/regulatory exposure (ads, comms, payments) | Beatrice compliance gate; securities-dark; CAN-SPAM/OFAC |
| Silent reliability failures | Detectors + deploy/release watchdog + loop-stall alerts |
| Cost fragility (Polsia's flat-rate-CLI hack) | Provider free-first registry + ensemble cost cap + model routing |

---

---

## P0 reality update (post-survey + lean-mode, 2026-06-16)

**Survey verdict: P0 is "unify + extend," not build-from-scratch.** Every governance primitive already exists and is production-grade: earned-autonomy algorithm + circuit breaker (`autonomyGuardrails`), witnessed-send (`approvalKernel`), eval gate (`aiEvalHarness`), budget gate (`aiCostCeiling`), constitution gate (`solene/constitutionalGuard`), escalation queue + pager (`solene/founderCollab` + `pagerService`), cockpit (`/founder/today` + `/command` + morning-pulse), cadence (`runScheduledJobs`), and a dispatch queue + runner (`solene/dispatchQueue` + `dispatchRunner`).

**🔴 KEYSTONE GAP (the dark wire):** `dispatchRunner.ts` is documented as "Called by the worker's `runSoleneDispatchLoop`" — **but that function does not exist in `server/worker.ts`.** The worker only drains the `outbox` table; the `solene_dispatch_queue` has no production consumer (only the test file calls `claimNextDispatch`). The brain decides + enqueues; nothing runs it. **This is why nothing happens, and it's the first, free fix.**

**De-confliction required (survey warning — do NOT add a 4th of anything):**
- Two 30-min decision loops exist: `autonomousDecisionExecutor` (customer-facing `decisions_inbox_items` auto-resolver) and Solene's `continuousLoop` tick (founder-ops). Keep them separate by domain; the Solene loop is the founder-ops controller, the decision-executor stays customer-facing.
- Three `AutonomyLevel` models exist (`autonomyGuardrails` assisted/supervised/autonomous per-org Pax-send; `autonomousAgentEngine` full_auto/supervised/manual per-VA-agent; this plan's per-domain 4-state). Generalize `autonomyGuardrails`' algorithm into ONE per-domain model; map/retire the others via adapters.
- Gates are scattered (constitution / eval / budget / autonomy / witnessed-send each invoked at different call sites). P0's new abstraction = compose them into ONE ordered `runPolicyGateStack` middleware every dispatch + outward action flows through.

**Lean operating mode (founder budget = $50/mo, low capital, owns the platform):**
- The platform's growth machinery (programmatic SEO, public LCS reports, parcel-check viral loop, data-coop) is already built and ~$0 to operate — the autonomous system **tends and amplifies** it rather than buying growth.
- $50/mo ≈ almost entirely AI tokens. So: **cheap-model-first, Opus-rare** (tune `modelRouter`/cost-tiers aggressively); the `aiCostCeiling` enforces the $50 hard cap in code.
- **No paid ads until revenue earns it.** Owned + free channels only: SEO content, parcel-check/LCS loops, free-tier outbound (Apollo free tier + a free ESP tier like Resend 3k/mo), community.
- **Defer the dedicated agent machine** (run on the existing worker) to save ~$20/mo; it becomes a reinvestment once revenue exists.
- **Budget auto-ramps with revenue** (founder approves each lift). The system grows its own budget.
- Only real cash cost to start: **one sending domain (~$10/yr)** for outbound.

**Revised Step-1 build order (free, no keys):**
1. **Wire `runSoleneDispatchLoop` in the worker** — poll `claimNextDispatch` → `runDispatch`, respecting the stopping/drain lifecycle + cost caps. (The keystone; lights the hands.) Verify no double-dispatch vs the decision-executor.
2. **`runPolicyGateStack` middleware** — compose constitution→eval→budget→autonomy→(witnessed-send) into one choke point; route every dispatch through it.
3. **Per-domain autonomy state machine** — generalize `autonomyGuardrails` to a `domain_autonomy_level` table (OBSERVE→DRAFT→EXECUTE_GATED→AUTONOMOUS_GATED) with its promotion/demotion algorithm reused.
4. **Decide-and-dispatch body in `runContinuousTick`** — replace the count-only stub + the `DEFAULT_` sensed-metric stubs (MRR/uptime/horizon) with real senses; rank moves; enqueue governed dispatches.
5. **Escalation classifier** in front of `askFounder` (money-threshold/legal/phase-gate/anomaly per §5).
6. **Loop-stall + gate-failure-spike detector** (DoD §7A).
Each ships as a verified batch (check + test + build) on the `founder-autopilot` branch.

---

## The one-paragraph synthesis
AcreOS becomes self-operating by closing a **governed loop** (sense → decide against the constitution+budget → dispatch through the permission ladder → every outward action clears a compliance+eval+budget+autonomy gate → measure → learn), with a **growth engine** that earns its way from owned loops into a hard-capped, CAC-gated paid budget, and a **support surface** that auto-resolves grounded + feeds the roadmap — all under **earned autonomy** that promotes on evidence and demotes on anomaly. The founder's job shrinks to a daily glance + a handful of constitution-gated approvals a month. It works where Polsia's doesn't precisely because autonomy never outruns the governance: it's legal because compliance gates every claim, safe because authority is earned and revocable, sustainable because spend is capped and CAC-gated, and valuable because quality only ratchets up.
