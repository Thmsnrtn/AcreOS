# The Cognition Layer — Architecting AcreOS's Right-Hand

**Date:** 2026-06-23 · **Status:** ARCHITECTURE (build phases C0–C5 below) · **Author:** systems-architect pass.
**Greenlight:** Tom, 2026-06-23 — "deeply architect this new vision of the autopilot… a right-hand that runs the business, makes decisions, escalates if necessary, reasons long-term with an eagle-eye perspective down to the minutia, and tends to it 24/7."

---

## 1. Thesis: a safe body that needs a real mind

AcreOS already has two intelligences that have never been the same thing:

- **The body** — the 24/7 governed loop (`server/services/solene/continuousLoop.ts` + `server/services/autopilot/*`). Sophisticated at *governance*: earned autonomy, the gate stack, witnessed-send, economics, calibration, pre-mortem, drift sentinel, the learning loop. This is the part that makes unattended operation *safe* — most "let an LLM run my business" attempts lack it entirely.
- **The mind** — Opus reasoning across the whole business in a founder session. Deep, eagle-eye, long-horizon, catches the minutia. But it only exists *when Tom is in a session*. It is not wired into the running app and it is not 24/7.

**The current decision-making in the body is shallow by construction:**
- `decide.ts` ranks **13 fixed move kinds** by transparent priority rules (`resolve_incident`→`protect_runway`→…→`grow_owned_channels`→`optimize`).
- `deliberate.ts` is the only LLM in the decision path. It fires *only* on a close discretionary contest (`shouldDeliberate`), feeds a **~6-field state line** to `gpt-4o-mini` (`AUTOPILOT_DELIBERATION_MODEL`), and may only **reorder within the rules' existing candidates** (`applyDeliberation`). It cannot reason about the funnel, the books, history, or strategy; it cannot propose anything new; it has no long-term memory.

So the answer to "is our approach already more intelligent than just letting Opus run it?" is: **more intelligent in governance, less intelligent in reasoning.** The Cognition Layer fuses them — Opus-grade reasoning *inside* the existing governance — so the mind gets deep without the body getting dangerous.

**Non-negotiable principle:** cognition never bypasses a gate. The smarter the mind, the *more* the scaffolding matters. Every plan the mind produces flows through the same compliance → eval → craft → economics → risk → witnessed-send stack that binds today.

---

## 2. Design principles

1. **Rides the scaffolding, never around it.** The Operator produces *plans*; the existing loop turns plans into *gated* actions. No new path to prod.
2. **Additive, gated, dormant-by-default** — exactly like every autopilot organ shipped to date. `COGNITION_ENABLED` (DB-backed master switch, env-safe-off default).
3. **Bounded creativity.** The mind may propose net-new actions, but a net-new action is treated as maximally novel by `riskautonomy.ts` → forced escalation/witnessed regardless of domain trust, until proven.
4. **Tiered cognition.** Cheap model for routine operational lift (today's deliberate, context-enriched); Opus for the strategic cycle. Cognition spend is itself budget-gated through `economics.ts`.
5. **Glass-box always.** Every cognitive plan emits a reasoning trace (`reasoning.ts`) to `/founder/autopilot/story`. No silent judgment.
6. **Honest context only.** The briefing is real signals or labeled absence — never fabricated, never fed the learning loop with attribution lower-bounds as if they were ground truth (the existing invariant holds).
7. **Multi-lens, one voice.** Reasons through CMO/CFO/CS/SRE/Product *lenses as review passes*, decides and speaks as one right-hand — per the retired-persona-ensemble doctrine (`feedback_unified_team_model`). Not a committee.

---

## 3. The four new organs

### Organ 1 — The Context Pack (`cognitionContext.ts`)
The eagle-eye briefing, assembled each strategic cycle from **real** sources (absence labeled, never invented):
- **Vitals:** MRR + WoW trend, trials by funnel stage, support backlog + first-response time, churn signals, runway/envelope, uptime, open incidents, compliance, deliverability.
- **The books:** effective monthly cap (now ramp-aware via `getEffectiveMonthlyCapUsd`), MTD spend, attributed CAC (lower-bound), reserve headroom.
- **The funnel:** discovery → trust → convert → pay conversion at each stage (real attribution + activation events).
- **History:** recent decisions + their realized outcomes (`experienceLog`), the calibration grade (`forecast`).
- **Attention:** open founder asks + their age.
- **Trust:** per-domain autonomy levels + decision-quality.
- **Intent:** standing orders + objectives (the founder's encoded will).
- **Recall:** k-nearest past episodes + what worked (`memory.ts`).
- **The thesis:** the current strategy memory (Organ 4).
Pure assembly, exhaustively testable, no model call. *This is the briefing the model has never had.*

### Organ 2 — The Operator (`operator.ts`)
The Opus-grade reasoning core. Input: the Context Pack. Output: a validated **Operating Plan** (StructuredOutput schema):
- `assessment` — the eagle-eye read: what matters most now, what's drifting, what's being neglected (the minutia).
- `lensReview` — the CMO/CFO/CS/SRE/Product passes, synthesized.
- `moves` — ranked recommendations, each either an existing `kind` OR a **net-new proposal** carrying a proposed binding (domain, outward-class, est. cost, reversibility).
- `escalations` — what genuinely needs Tom, each with the question + the Operator's own recommendation.
- `watchItems` — minutia/polish/risk to track across cycles (the long-tail eagle-eye).
- `strategyMemoryPatch` — proposed updates to the running thesis.
The Operator **never executes.** It reasons and proposes. The loop converts the plan into gated actions.

### Organ 3 — Net-new action handling (extend `act.ts` + `riskautonomy.ts`)
A proposed move outside the rule catalog gets `noveltyN = 0` and `reversible = false` unless proven otherwise → `assessRisk` escalates it to witnessed/founder regardless of domain trust. A net-new move approved repeatedly can be **promoted into the rule catalog** (founder-gated, via the existing `policyInducer` proposal pattern) — the system literally learns new plays from its own COO, then runs them cheaply forever after. This is how the action space *grows by evidence*, not by a developer editing `decide.ts`.

### Organ 4 — Strategy Memory (`strategyMemory.ts` + schema)
A persistent, Operator-maintained strategic narrative + objective tree that survives across cycles — distinct from `memory.ts` (episodic). The running thesis: where we are, the plan, the live bets, what we've learned, what we're deliberately *not* doing. Updated on the strategic cadence, fed back into the Context Pack. **This is the eagle-eye continuity** — what turns tick-by-tick reaction into long-horizon stewardship.

---

## 4. Cadences (this is the cost/safety lever)

- **Operational tick (30 min, existing):** the fast deterministic rule loop stays the floor. Optional cheap-model lift for close calls (today's `deliberate`, upgraded to read a *trimmed* Context Pack). Cheap, frequent.
- **Strategic cycle (daily):** the Operator runs on Opus — eagle-eye review, the day's operating plan, escalations.
- **Reflective cycle (weekly):** a deeper Opus pass — revise the Strategy Memory, re-derive objectives, the "what would an elite COO do this week / what's been neglected for a month" review.

Opus runs ~1–2×/day + weekly — not every 30 min — so the cost is bounded and the *expensive* cognition is reserved for where judgment compounds.

---

## 5. Safety & cost model (how the mind stays caged)

- **Master switch:** `COGNITION_ENABLED` (DB-backed `autopilot_settings`, env-safe-off). Dormant until Tom flips it.
- **Tiered + budget-gated:** `COGNITION_STRATEGIC_MODEL` (Opus) vs the cheap operational model; cognition spend passes `budgetGate`.
- **Every plan → the full gate stack.** Net-new → forced witnessed. Outward → witnessed-send until trust earned.
- **Pre-mortem** (`safety.ts`) on high-stakes auto-runs; **calibration** (`forecast.ts`) scores the Operator's predictions so it earns trust like a domain; **drift sentinel** unchanged.
- **Glass-box:** a reasoning trace per plan → the Story door. **Kill switch:** existing STOP + master switch.

---

## 6. It rides the bones that already exist

| Existing piece | Role in the Cognition Layer |
|---|---|
| `deliberate.ts` | becomes the cheap *operational* lift (context-enriched) |
| `decide.ts` | the deterministic floor + the catalog the Operator can grow |
| `memory.ts` | feeds episodic recall into the Context Pack |
| `safety.ts` | pre-mortems the Operator's high-stakes moves |
| `forecast.ts` | calibrates the Operator → trust-earning |
| `reasoning.ts` | traces the Operator's reasoning to the Story door |
| `escalation.ts` / `escalationLadder.ts` | the Operator's escalations ride these |
| gate stack (`policyGate`/`claimsGate`/`craftStandard`/`riskautonomy`/`economics`) | unchanged — everything flows through |
| `economics.ts` (+ the new budget-ramp wire) | budget-gates cognition spend and the moves it proposes |

We are deepening a seam that is already cut, not bolting on a new organism.

---

## 7. Build phases (gated, dormant, verified — like the original autopilot)

- **C0 — Context Pack.** Pure assembly from real senses + tests. No model. The briefing becomes real and viewable. *(Lowest risk; start here.)*
- **C1 — Operator contract.** The Operating Plan schema + a pure plan-validator + the prompt builder — fully testable with no model call (mirrors how `deliberate.ts` split pure logic from the model call).
- **C2 — Wire the Operator.** Tiered model, strategic cadence in the worker, `COGNITION_ENABLED` off by default. Plan → enqueue through the existing gates. Reasoning trace to the Story door.
- **C3 — Net-new proposals.** Forced-witnessed handling + the promote-to-catalog flow.
- **C4 — Strategy Memory.** Persistence + feedback into the pack + the weekly reflective pass.
- **C5 — Trust + cockpit.** Calibrate the Operator, let it earn autonomy; surface the plan, the eagle-eye assessment, and the strategy memory under the four founder doors.

Each phase ships gated and central-gated (tsc + lints + full vitest), dormant until switched on — identical discipline to how the autopilot itself was built and verified.

---

## 8. What this gives Tom

A right-hand that reasons like Opus, 24/7, over the whole business — from the strategic bet down to the unpolished empty state — that **acts within guardrails, escalates with genuine judgment, and thinks long-term**, without the risk of an ungoverned model ever touching prod. The body was built first on purpose. Now it gets a mind, and the body is exactly what makes giving it one safe.
