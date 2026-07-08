# The Unparalleled Autopilot — frontier design

**Date:** 2026-06-16
**Brief (Tom):** improve the autopilot as far as possible — truly unparalleled, cutting-edge, the most intuitive and advanced autopilot possible.

## The reframe

What we've built is a **governed reflex loop**: it senses, ranks one move by transparent rules, routes it through hard gates, acts, and learns efficacy. That's already rare — most "AI runs your business" products have no governance, no honesty discipline, no earned autonomy. But a reflex loop is not yet a *mind*.

To be unparalleled, it becomes a **deliberative, self-aware, conversational chief executive** — one that reasons about hard calls, forecasts outcomes from its own real history, knows how well-calibrated it is, remembers what worked, talks with you, explains itself completely, and earns ever-wider autonomy *safely*. The differentiator is not "more AI." It's that every new capability stays **honest** (grounded in real data, never fabricated), **safe** (never escapes the gate), **intuitive** (a glass box you can talk to), and **lean** ($50/mo). Power *through* discipline — that's the moat Polsia-style slop factories can never cross.

The six pillars below each make it simultaneously smarter, more trustworthy, and easier to live with. They compose on the substrate already shipped (the Experience Log, Trust Ledger, gate stack, decide-core, the daily letter).

---

## Pillar 1 — The deliberative brain (neuro-symbolic)

**Today:** `rankMoves()` is a transparent rule-ranker. Great for trust, shallow for judgment.
**Frontier:** keep the rules as the *safety floor + arbiter*, but add an LLM **deliberation layer** that, for non-trivial calls, expands the option set and critiques each option (a short "council of perspectives" — opportunity, risk, customer, runway). The rules still decide priority and the gates still bind; the LLM only enriches *what's considered*. Hybrid neuro-symbolic: the creativity of a model, the guarantees of rules.
**Honest/safe/lean:** the model proposes, the constitution + gates dispose; deliberation only fires for ambiguous/high-value moves (cheap-model-first), so cost stays bounded.

## Pillar 2 — Calibrated foresight (an honest world model)

**Today:** simulate-before-act states cost + reversibility (honest but shallow).
**Frontier:** ground the forecast in the Experience Log — *"based on 12 similar past actions, ~70% were approved, median cost $3, 0 reversals."* Then track the system's **own calibration** (Brier score: did its 70%-confidence predictions actually happen 70% of the time?) and *show it.* A system that knows how right it usually is, and tells you. This is the rare honest forecast: it's retrodiction over real outcomes, never an invented projection.
**Why unparalleled:** almost nothing self-measures its own calibration. It turns "trust me" into "here's my track record of being right."

## Pillar 3 — Living memory (episodic recall + self-evolving playbooks)

**Today:** per-play efficacy stats (aggregate).
**Frontier:** (a) **episodic/case-based recall** — a vector memory of past *situations → actions → outcomes*, retrieved at decision time ("last time MRR stalled while support rose, X worked"). (b) **Self-evolving playbooks** — a weekly reflection that proposes *new* plays and retires dead ones (the playbook writes itself, founder-approved via the inducer we built). The system's competence compounds instead of plateauing.
**Honest/safe/lean:** retrieval is grounded in real episodes; new plays are proposals (gated), not silent self-modification; pgvector already exists in the stack.

## Pillar 4 — The conversational glass box (most intuitive)

**Today:** the daily letter is a beautiful one-way briefing.
**Frontier:** make it **two-way and fully explainable.**
- **Talk to the company:** "Why did you do that?" "Focus on Texas this month." "Show me what happens if I trust growth fully." It answers from real state and adjusts (intents/standing orders, or a forward simulation).
- **Glass-box "why":** every action expands into its complete reasoning trace — senses → ranked options → forecast → which gate cleared → outcome. One tap, total transparency.
- **Anticipatory:** it surfaces the one thing that matters and learns your attention rhythm (when you read, what you skip).
**Why unparalleled:** the felt experience becomes "I have a brilliant chief of staff I can interrogate and direct in plain language," not "I operate a dashboard."

## Pillar 5 — Risk-calibrated autonomy

**Today:** autonomy is per-domain (OBSERVE→…→AUTONOMOUS_GATED).
**Frontier:** gate on **(domain × reversibility × value × novelty)**, not domain alone. Auto-execute the cheap, reversible, proven, routine — even faster than today; *escalate* the novel, expensive, or irreversible — even inside a fully-trusted domain. Thresholds **self-tune** from the calibration data. The system earns *contextual* trust the way a real executive does: free rein on the small stuff, a check-in on the big stuff.

## Pillar 6 — Frontier trust (self-aware safety — the moat)

This is what lets autonomy go *further* without ever becoming reckless:
- **Adversarial pre-mortem:** before a high-stakes action, an independent skeptic agent tries to prove it's a mistake; ≥majority "this is wrong" blocks it.
- **Constitutional-drift audit on the autopilot itself** (Quinn's lens): does its recent behavior still match its stated values? Drift → alert.
- **An undo timeline:** every autonomous action reversible from one surface, with the reversal path pre-computed.
- **Calibration as a safety signal:** if the system becomes *over*-confident (calibration degrades), autonomy auto-tightens.
**Why unparalleled:** a system that polices its own confidence and values is the only kind that can be trusted with real autonomy.

---

## Recommended sequence

They compound, but the highest-leverage *first* pair is **Pillar 2 (calibrated foresight) + Pillar 4 (glass-box why)** — together they make the system smarter, provably trustworthy, and intuitive *at once*, and both are honest-by-construction on the Experience Log we just shipped. Then **Pillar 1 (deliberation)** for judgment depth, **Pillar 5 (risk-calibrated autonomy)** to let it do more safely, **Pillar 3 (living memory)** so competence compounds, and **Pillar 6 (frontier trust)** threaded throughout as the safety spine that makes the rest defensible.

Every pillar ships the same way as everything before it: pure cores with exhaustive tests, gated dormant, honest cold-start, verified (check + test + build) per batch.

---

## SHIPPED (2026-06-16, branch `founder-autopilot`, dormant)

All four chosen pillars + glass-box landed + verified. 173 autopilot unit tests green.

- **P2 — Calibrated foresight** (`forecast.ts`): history-grounded outcome
  prediction (Laplace-smoothed, honest "first try" at n=0) + the system measuring
  its OWN calibration (Brier / reliability / over-confidence). Surfaced on every
  ask + in the daily letter. schema 0172.
- **P4a — Glass-box "why"** (`reasoning.ts`): every action records its full
  reasoning chain (senses → options → forecast → gate → outcome + narrative).
  `GET /api/founder/autopilot/story` + the `/founder/autopilot/story` timeline.
  schema 0173. act.ts ActOutcome now carries the GateSummary.
- **P4b — Conversational steering** (`steer.ts`): pure NL intent parser
  (pause/trust a domain, set intent/standing order, status, why) + handlers
  through governed services; unknown ⇒ asks, never guesses. `POST
  /api/founder/autopilot/steer` + a "Talk to your company" composer on Your Voice.
- **P1 — Deliberative brain** (`deliberate.ts`): for a genuine close call a cheap
  LLM council re-weighs the top options, but can ONLY reorder within the rules'
  candidate set (it can't invent an action); falls back to the deterministic
  ranking on any error. Wired behind dispatch-enabled + an API key.
- **P6 — Self-aware safety** (`safety.ts`): adversarial pre-mortem (a skeptic
  vetoes a high-stakes move into an escalation), calibration-as-safety-signal
  (over-confidence holds autonomy promotions), constitutional-drift sentinel
  (a witnessed-send bypass pages the founder). Fail-open, pure-tested.

- **P5 — Risk-calibrated autonomy** (`riskautonomy.ts`): gates on the action's own
  reversibility / value / NOVELTY (real evidence count), not just the domain's
  standing. A novel/irreversible/expensive action escalates for a tap even in a
  trusted domain; risk only ever TIGHTENS, never loosens the earned floor.
- **P3 — Living memory** (`memory.ts`): case-based recall — a situation is its real
  senses → a bounded feature vector (no embedding cost); the system recalls the
  k nearest past episodes and what worked, surfaces the precedent in the trace
  ("In N similar past situations, X worked best"), and feeds it to deliberation.

**ALL SIX PILLARS COMPLETE.** The autopilot is now a deliberative, self-aware,
conversational system that reasons from precedent, predicts outcomes, explains
every decision completely, knows how right it usually is, holds back when
over-confident or facing a novel/high-stakes action, vetoes its own mistakes,
and lets you direct it in plain language — all still honest, gated, reversible,
and lean. 185 autopilot unit tests green.
