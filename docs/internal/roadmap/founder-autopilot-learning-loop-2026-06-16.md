# Founder Autopilot — The Learning Loop (design)

**Date:** 2026-06-16
**Brief (Tom):** design the learning loop; make this system as intelligent and geniusly designed as possible.

The governed loop already *acts* safely. This is how it gets *smarter* — honestly,
transparently, and without ever loosening a gate.

---

## The central discipline: learn only from real signals

The failure mode of every "self-improving AI" is fabricated efficacy — claiming a
growth action "worked" when nothing measured it. This design is built around the
opposite rule:

> **The system may only learn from signals that genuinely happened.** No invented
> attribution, no made-up forecasts. An action's efficacy is the *recorded* human,
> eval, and mechanical outcome — never a guess about cause and effect.

That single rule shapes everything below.

## Two orthogonal axes (why this isn't redundant with the Trust Ledger)

- **Trust Ledger = reliability/safety.** "Can this domain act without breaking
  things?" Earned by clean dispatches, lost on anomalies. Governs *autonomy*.
- **Learning loop = efficacy/preference.** "Which actions actually work, and which
  does the founder want?" Governs *selection* and *proposed policy*.

A domain can be fully reliable yet running an ineffective play — the learning loop
deprioritizes that play without touching the domain's autonomy. Clean separation;
both needed.

---

## The four components

### 1. The Experience Log (procedural memory) — `autopilot_experiences`

Every autopilot action writes one experience row, then *accretes real signals* as
they arrive (each field null until its signal genuinely lands — never fabricated):

| field | source | when |
|---|---|---|
| `moveKind`, `domain`, `playId?` | the decision | at act-time |
| `outcome` (acted / escalated / suppressed) | planAndAct | at act-time |
| `dispatchId?`, `askId?` | act | at act-time |
| `dispatchSuccess` (bool) | the consumer (runDispatch) | on completion |
| `evalScore` (0–1) | aiEvalHarness | on generation |
| `founderVerdict` (approved / declined) | the ask answer | when Tom answers |
| `resolution` (resolved / reopened), `satisfaction` (1–5) | support_cases | for support plays |
| `costUsd` | dispatch result | on completion |

Append-only, lean. This is the honest substrate — a true record of what was tried
and what actually happened.

### 2. The Efficacy Model — a Beta-Bernoulli bandit (Thompson sampling)

For each candidate play, success/failure are defined from **real** signals only:

- **success** = founder *approved* **OR** (dispatch clean **AND** eval passed)
- **failure** = founder *declined* **OR** eval failed **OR** dispatch failed
- unresolved experiences simply don't count yet (no signal → no vote)

Each play gets a Beta(α, β) posterior (α = 1 + successes, β = 1 + failures). Selection
uses **Thompson sampling**: draw one sample from each play's posterior, pick the
highest. Why this is the right primitive, not a gimmick:

- It is the provably near-optimal explore/exploit strategy and needs **zero tuned
  hyperparameters** (no hand-set epsilon).
- **Cold-start = today's behavior.** With no data, every posterior is the uniform
  prior, so selection is effectively the current rotation. Learning only emerges as
  real outcomes accrue — nothing changes on day one.
- **No starvation.** A wide prior guarantees under-tested plays still get explored;
  a play can't be killed by one bad draw.
- **Transparent.** The founder can always see the track record (e.g. "parcel-check
  explainer: approved 4/4") behind any preference.

Determinism for tests: the sampler takes an injected RNG (seeded), so unit tests are
exact; in production the seed varies by tick.

This replaces the growth playbook's blind rotation with **evidence-weighted
selection**, and generalizes to any move that has variants.

### 3. The Policy Inducer (the genius layer)

The system watches the experience log for patterns that deserve a *durable* decision,
and offers to codify them — turning repeated micro-decisions into macro-policy:

- **Repeated decline** → "You've declined `<play>` the last N times. Want me to stop
  proposing it?" → an *induced standing order* (lands in Your Voice on approval).
- **Consistent approval** → "`<play>` has been approved M times running. Want me to
  trust it to run without asking?" → a proposed autonomy bump (still gated).

These surface as a distinct, calm founder ask. The founder's answer writes a real
standing order / autonomy change. **This is the loop that reduces founder load over
time** — the system literally learns its founder's implicit policy and asks to make
it permanent. Deeply aligned with the 0.01%-attention north star.

Guardrails: induction only *proposes* (never self-authors policy); thresholds are
conservative (N≥3 declines, M≥ the promotion threshold); each proposal fires at most
once per pattern (dedup), so it never nags.

### 4. The Reflection (narration)

The learning is surfaced honestly in the daily letter + the Trust Ledger strip:
> *"Growth: parcel-check explainers are landing best (approved 4/4) — I'm favoring
> them. I've noticed you've declined cold-outreach three times; want to make that a
> standing rule?"*

The founder sees *what* the system learned and *why*, and can override anything.

---

## Safety / honesty invariants (non-negotiable)

1. **Learning never bypasses a gate.** It only biases *selection* and *proposes*
   policy. Every action still clears compliance → eval → budget → autonomy →
   witnessed-send.
2. **No fabricated attribution.** Efficacy = recorded human/eval/mechanical signals
   only. (Downstream metric deltas — MRR/trials after a play — are noisy and
   non-causal; see decision #1.)
3. **Exploration floor.** Thompson sampling keeps trying under-tested options; no
   premature lock-in, no starvation.
4. **Transparent + reversible.** Every preference shows its evidence; the founder can
   pause/force a play and delete any induced rule.
5. **Honest cold-start.** No data ⇒ identical to today's behavior. Learning is purely
   additive.
6. **Bounded.** Small play sets, append-only log, lean footprint — fits the $50/mo
   envelope.

---

## Decisions (locked, Tom 2026-06-16)

1. **Strict signals only.** Efficacy learns from human approval + eval + mechanical
   outcome + support resolution. NO downstream metric-delta attribution — cleanest
   honesty, every signal directly attributable.
2. **Proactively propose.** The inducer fires one calm, dedup'd ask when it spots a
   pattern, and writes a real standing order / autonomy change on approval.
3. **Thompson sampling.** Principled Bayesian explore/exploit, seeded RNG for tests.

---

## Build plan (once decisions land)

1. `autopilot_experiences` table (migration 0169) + `experienceLog.ts` (record + accrete).
2. Wire signal capture: act-time write; consumer updates dispatchSuccess/cost; ask-answer
   updates founderVerdict; eval hook updates evalScore; support resolution updates resolution/satisfaction.
3. `efficacy.ts` — pure Beta-Bernoulli + seeded Thompson sampling + `scorePlays()`. Heavy unit tests.
4. Swap growth play selection from rotation → efficacy-weighted (keep rotation as the cold-start equivalent).
5. `policyInducer.ts` — pattern detectors → proposal asks (dedup'd) → Your Voice / autonomy on approval.
6. Reflection: surface the track record + any proposal in the daily letter.

Each ships as a verified batch (check + test + build) on `founder-autopilot`, gated
dormant like the rest. Cold-start-safe, so it can ship before switch-on.

---

## SHIPPED (2026-06-16, branch `founder-autopilot`, dormant)

All five batches landed + verified:

- **L1 — efficacy core** (`efficacy.ts`). Beta-Bernoulli + seeded Thompson
  sampling. Proven by test: cold-start = rotation, exploits a winner (>80%),
  still explores the untested (>20%), deterministic per seed. Zero tuned knobs.
- **L2 — Experience Log** (schema 0169 + `experienceLog.ts`). `outcomeOf()` —
  the pure, honesty-critical signal→vote (founder verdict > support resolution >
  eval > mechanical; no signal ⇒ pending, no fabricated attribution).
- **L3 — wiring.** Growth selection is now Thompson-weighted over the real track
  record; every act opens an experience row; dispatch result + founder verdict
  accrete onto it. RNG is a seeded mulberry32 (lint-clean, no `Math.random`).
- **L4 — Policy Inducer** (schema 0170 + `policyInducer.ts`). Decline-streak ⇒
  propose STOP (→ standing order); success-streak ⇒ propose TRUST (→ autonomy
  bump). One ask per pattern, ever; every applied change reversible.
- **L5 — reflection.** The daily letter's "What's working" strip shows top plays
  by real efficacy. Honest cold-start (empty until data accrues).

124 autopilot unit tests green. The system now learns *efficacy* (what works +
what the founder wants) atop the Trust Ledger's *reliability* — and converts
repeated decisions into durable, founder-approved policy.
