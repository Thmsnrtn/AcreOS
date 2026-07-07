# Founder-Ops Audit

**Walked:** 2026-04-29 · static read across `client/src/pages/founder*.tsx`,
`client/src/pages/founder/*.tsx`, `client/src/pages/{sovereign-dashboard,
board-of-directors,executive-dashboard,proactive-monitor,queue-monitor,
ops-dashboard,safety-gates,admin-support}.tsx`, plus
`server/services/{autonomyScoreV14,reactiveOrchestrationV14,feedbackLoopV14,
confidenceCascadeV14,founderIntentV14}.ts` and the Phase A–H docs.

**Scope honesty.** Static reads only. I did not authenticate to a live org,
so I cannot quantify (a) actual queue depths Thomas sees in his daily use,
(b) which agents are paused vs running, (c) how many of the surfaces
listed below are currently empty/zero-state vs full. Numbers like "queue
depth" or "frequency" below are inferred from refresh intervals, payload
shapes, and persona context, not measured.

**Persona discipline.** Recommendations name founder-roster agents
(Sophie/Forge/Atlas/Shield/Gabriel/Beacon/Ledger). Pax appears here only
as the customer-facing mask — never proposed for founder-mode automation.

---

## Top automation gaps (ranked by founder-time cost, top 10)

### 1. "What needs you" feed presents work, doesn't pre-decide it
- **Surface:** `/founder/todo` (`founder-todo.tsx`) and the *What needs you*
  card on `/founder-home`
- **Current manual flow:** Seven sources (decisions, prompt evolutions,
  strategic moves, tool proposals, expansion candidates, onboarding
  rescues, experiment promotions) all queue into the same ranked list.
  Each row links the founder to the source page where the actual
  approve/reject lives. Thomas must context-switch into 7 different
  pages, read context, and click approve.
- **What the agent should auto-do:** Auto-approve proposals where (a)
  agent confidence ≥ threshold, (b) `confidenceCascadeV14` already
  resolved at memory_lookup or strategy_consult layer, (c) historical
  override rate for this proposal pattern (via
  `feedbackLoopV14.getOverrideAnalytics`) is < 5%. Surface only the
  residual to the feed. Add a "what got auto-approved while you were
  away" review tab so reversal stays one click.
- **Confidence threshold:** ≥85 for tool/strategic proposals; ≥75 for
  prompt-evolution; ≥90 for any expansion offer that costs money.
- **Agent owner:** Atlas (synthesis) feeding the feed; Sophie owns
  expansion-candidate auto-handling (renewal-adjacent); Shield gates
  monetary thresholds.
- **Effort:** M

### 2. Strategic-proposals page surfaces ALL weekly raw proposals
- **Surface:** `/founder/strategy` (`founder-strategy.tsx`) — "All
  weekly raw proposals (to see what the system is thinking before
  the monthly synthesis)" is explicitly a transparency view, not a
  decision view.
- **Current manual flow:** Founder eyeballs a long list of weekly raw
  proposals plus the monthly synthesis. Approve/reject buttons on each.
- **What the agent should auto-do:** Synthesis pass should already
  collapse the weekly raw list. Hide the raw view by default behind
  "show what was synthesized from" details disclosure. Auto-defer
  proposals with confidence < 50 (they're noise). Auto-promote
  proposals with confidence ≥ 90 *and* category=ops AND impact <
  $1k to "approved" status without founder ever seeing them.
- **Confidence threshold:** ≥90 + monetary impact < $1k for
  auto-approval; <50 for auto-defer.
- **Agent owner:** Atlas (synthesis); Forge (revenue-category proposals
  must always escalate).
- **Effort:** S

### 3. Prompt-evolution proposals require manual review for low-risk diffs
- **Surface:** `/founder/prompt-evolutions`
- **Current manual flow:** Meta-agent files prompt revisions monthly;
  Thomas reads each diff, performance snapshot, reasoning, then
  approves or rejects. Every revision treated equally.
- **What the agent should auto-do:** Auto-promote when (a) diff is
  bounded (e.g., <10% character delta), (b) prior canary test on the
  revision shows outcome score ≥ existing prompt, (c) no founder
  override on similar past evolutions for this agent. Only escalate
  diffs that change agent persona, expand action scope, or modify
  monetary thresholds.
- **Confidence threshold:** Outcome-score lift ≥ 0.5 (Brier-calibrated)
  with n ≥ 30 canary trials.
- **Agent owner:** the meta-agent itself (auto-promotion authority);
  Shield gates persona/scope changes.
- **Effort:** M

### 4. Decisions page "Auto-handled" bucket invites browse-mode
- **Surface:** `/founder/decisions`, "Auto-handled" tab
- **Current manual flow:** Tab shows every auto-handled decision in
  the window (default 30d). Thomas browses, expands rows, optionally
  hits "I don't like this — don't do it again" reverse button.
- **What the agent should auto-do:** Auto-handled decisions where
  outcome score ≥+1 should not show by default — they're working.
  Surface only (a) auto-handled with outcome ≤ 0 or not-yet-graded,
  (b) auto-handled where the *category* has a high override rate
  even if this specific row scored well, (c) auto-handled where
  estimated impact > $X. Everything else collapses to a single
  "1,247 routine auto-handled · all green" pill that expands on click.
- **Confidence threshold:** outcome score ≥+1 → hide; ≤0 → show;
  pending grade > 7 days → show.
- **Agent owner:** Atlas (decision orchestration); the page itself
  is a sense-making surface, not a queue, so the change is presentational.
- **Effort:** S

### 5. Agent on/off toggle requires AlertDialog confirmation every time
- **Surface:** `/founder-home` → AgentCards, `/founder/agents`
  (`founder-agents.tsx`)
- **Current manual flow:** Toggling any agent triggers an AlertDialog
  ("Enable X?" / "Disable X?"). Multiple agent toggles = multiple
  modals.
- **What the agent should auto-do:** Toggle is a 1-click reversible
  action. Confirmation should be inline ("Pause Sophie? · Confirm /
  Cancel" inline on the card) for routine toggles, AlertDialog only
  if there are ≥ N pending decisions queued for that agent that the
  pause would strand. The current pattern treats every toggle as
  high-risk; in practice most are noisy reflexes.
- **Confidence threshold:** N/A — pattern fix.
- **Agent owner:** N/A — UI affordance.
- **Effort:** S

### 6. Onboarding rescue is signaled but rescue itself is manual
- **Surface:** `/founder/onboarding` (`founder-onboarding.tsx`)
- **Current manual flow:** Page lists journeys with `at_risk` status
  and `founderFlag`. The page is *diagnostic* — Thomas reads, then
  presumably reaches out manually.
- **What the agent should auto-do:** Sophie already does customer
  success. `at_risk` should auto-fire a Sophie outreach (drafted,
  queued for review) BEFORE it surfaces here as a founder rescue.
  This page should only show journeys where Sophie's first attempt
  failed and the system has decided escalation needs the founder
  voice — i.e., Tier-2 rescue, not Tier-1.
- **Confidence threshold:** Auto-escalate to founder when Sophie has
  attempted ≥2 outreaches with no engagement signal in 5 days.
- **Agent owner:** Sophie (Tier-1 rescue, auto); founder (Tier-2
  only).
- **Effort:** M

### 7. Expansion candidates require founder approval for low-tier upsells
- **Surface:** `/founder/expansion`
- **Current manual flow:** Forge proposes candidates (score, signals,
  proposed tier). Founder approves → Forge queues offer. Even tiny
  free→pro upgrades require Thomas's nod.
- **What the agent should auto-do:** Forge auto-fires upgrade offer
  when: candidate score ≥ 80, current tier = free, proposed tier =
  pro (smallest jump), no founder override on similar candidates in
  prior 60d, sim-mode disabled. Founder reviews quarterly batch, not
  per-candidate.
- **Confidence threshold:** score ≥ 80 + same-customer-no-override
  + tier delta = 1.
- **Agent owner:** Forge (revenue).
- **Effort:** M

### 8. Tool proposals queue conflates "build now" with "interesting later"
- **Surface:** `/founder/tools`
- **Current manual flow:** Agents file tool proposals. Founder
  approves / rejects / moves to "building". No prioritization signal
  beyond a complexity badge.
- **What the agent should auto-do:** The synthesis pass should rank
  proposals by (estimated impact ÷ complexity) and auto-defer the
  bottom decile. Auto-merge duplicates (same `capabilityGap` from
  multiple agents). Surface only the top 5 with a "and N more,
  ranked, expand to see" disclosure.
- **Confidence threshold:** Auto-defer when score < 25th percentile
  of last 90d proposals.
- **Agent owner:** Atlas (synthesis); Gabriel (capability planning,
  if that's the codename's owned domain).
- **Effort:** S

### 9. Provider-degradation requires Thomas to notice
- **Surface:** `/founder/providers`
- **Current manual flow:** Page shows 30-day lookup volume, success
  rate, latency, cost per provider. Brief notes "if a provider
  degrades quietly, the success-rate column surfaces it here." That
  surfaces it *if Thomas opens the page*.
- **What the agent should auto-do:** Operations agent should fire
  an alert when success rate drops > 10pp week-over-week, OR when
  cost-per-successful-lookup increases > 25%, AND auto-deprioritize
  the provider in the registry's tiebreak (this already happens
  passively via tier+cost ranking but should be explicit). The page
  becomes "what auto-changed in the last week" rather than browse-mode.
- **Confidence threshold:** Auto-deprioritize on ≥10pp success drop
  with n ≥ 50 lookups; auto-disable on ≥30pp drop or 3 circuit-breaker
  trips.
- **Agent owner:** Operations agent (the page already mentions an
  "operations" agent); Atlas if data-quality is in scope.
- **Effort:** S

### 10. Queue-monitor failed-job retry is manual per-queue
- **Surface:** `/admin/queues` (`queue-monitor.tsx`)
- **Current manual flow:** BullMQ failed jobs show per queue. Thomas
  clicks "retry failed" or "clear failed" per queue.
- **What the agent should auto-do:** Self-healing mesh
  (`selfHealingMeshV13`) already exists — wire it to auto-retry
  failed jobs with exponential backoff (max 3 attempts), auto-clear
  jobs failed > 7 days where the cause was a known transient
  (network timeout, 5xx from external). The queue monitor becomes a
  *recoverable failures* surface only.
- **Confidence threshold:** Auto-retry transient failures ≤3 times;
  auto-clear permanently-failed > 7d old where retry-count exhausted.
- **Agent owner:** self-healing mesh (no codename; infra layer).
- **Effort:** M

---

## Notification & decision noise (top 5)

### N.1 — Daily digest is informational, not actionable
- **Source:** `/founder/daily-digest` (`founder-daily-digest.tsx`)
- **What it shows:** Growth (signups, MAU), Revenue (MRR, paying
  count), Customers (emails sent/queued), Operations (data sources,
  services), and a *Needs your attention* card if non-empty.
- **Why it doesn't move work forward:** First four cards are
  metric-staring. *Needs your attention* is the only actionable
  block, and it's a generic `{action, reason}` list that doesn't
  link to anywhere. Current API: `/api/admin/digests/latest` — note
  this is admin-namespaced for a *founder* surface, suggesting a
  legacy mount that hasn't been refactored.
- **Fix:** Collapse the four metric cards into a single 1-line
  delta strip ("MRR +2.3% · 12 new orgs · 0 ops alerts") and
  promote *Needs your attention* to the page hero, with each item
  linking to the source page (which today, it doesn't — it's plain
  text).

### N.2 — `/api/founder/executive-dashboard` returns metrics whose UI fields don't exist
- **Source:** `/founder-home` (`founder-home.tsx:103-128`)
- **What it shows:** MetricCards expects `nps.score`, `churnRate`,
  `churnedOrgsLast30Days`. The actual API response is missing all
  three; the page hard-codes `?? 0` fallbacks. Per the inline
  comment: *"Future fields (not currently returned)"*.
- **Why it doesn't move work forward:** Thomas sees zeros for
  Customer satisfaction (NPS) and Churn risk every day. They aren't
  zero — they're missing. False reassurance.
- **Fix:** Either ship the missing API fields or hide the cards
  until they're real. Showing 0/0% with no provenance breaks the
  "honesty" voice rule from design-system §1.1.

### N.3 — Proactive-monitor alerts have no auto-resolve
- **Source:** `/founder/monitor` (`proactive-monitor.tsx`)
- **What it shows:** System alerts (info/warning/critical), with
  manual run + manual resolve buttons. Refetch every 60s.
- **Why it doesn't move work forward:** Self-healing mesh exists
  in code (`selfHealingMeshV13`) but the page UI implies founder
  resolves manually. Critical alerts wake Thomas up; info/warning
  alerts accumulate.
- **Fix:** Auto-resolve `info` severity after 24h with no recurrence;
  auto-resolve `warning` after self-healing mesh's mitigation
  succeeds; only `critical` reaches Thomas. Show auto-resolved
  alerts in a collapsed "resolved without you" section.

### N.4 — `/api/admin/agents/status` polled at 10s, identical surface mounted in 2 places
- **Source:** `/founder-home` AgentCards + `/founder/agents`
- **What it shows:** Same agent health table — name, status, last
  run, last error, enable toggle. Both refetch at 10s.
- **Why it doesn't move work forward:** Two surfaces means two
  sources of glance-noise; the data is the same. 10s polling is
  expensive given the page has no real-time signal that warrants it
  (agents run on cron schedules measured in hours/days).
- **Fix:** Drop poll interval to 60s. Pick one canonical surface
  (founder-home cards are sufficient; `/founder/agents` becomes
  per-agent deep view only).

### N.5 — Decision-row "I don't like this — don't do it again" buries the learning
- **Source:** `/founder/decisions` row reverse button
- **What it shows:** Records founder reversal as feedback signal;
  toast "Recorded. The system noted you'd rather it didn't do this."
- **Why it doesn't move work forward:** The reversal feeds
  `feedbackLoopV14` but the founder gets no closing-the-loop
  signal — was this learning extracted? Was a rule synthesized?
  Without that loop visible, the button feels like a void.
- **Fix:** After N reversals on the same pattern, surface a
  generated rule ("Sophie won't auto-send re-engagement emails to
  customers > 18 months silent — based on 4 of your reversals")
  with one-tap accept. Show the *outcome* of feedback, not just
  the input.

---

## "Information without action" surfaces (top 5)

### I.1 — `/founder/trends` (System trends meta-dashboard)
- **What's shown:** 90-day charts of outcome score, override rate,
  auto-resolved ratio, calibration Brier score, safety-rail trips,
  decision volume; per-agent trust trajectories; a verdict string.
- **What action it should suggest:** When a trend inverts (override
  rate climbing, outcome score falling) the page should propose
  *what to investigate* — link to the agent whose calibration is
  worst, the decision category with rising overrides, the canary
  prompt that appears causal.
- **Where the action lives today:** Nowhere — verdict is a
  paragraph, not a link.

### I.2 — `/founder/traces` (Agent traces)
- **What's shown:** Every LLM call with prompt, response, model,
  latency, cost. Filter by agent.
- **What action it should suggest:** A "flag this trace" or "this
  reasoning is wrong" affordance that feeds the feedback loop. A
  per-agent "trace cost trending" callout when an agent's avg
  cost-per-call spikes vs its 7d baseline.
- **Where the action lives today:** Nowhere — read-only forensics.

### I.3 — `/founder/prompt-history` (per-agent prompt timeline)
- **What's shown:** Versions, diffs, who promoted, when rolled back.
- **What action it should suggest:** "Roll back" button next to any
  prior version (with safety check). "Compare outcomes between v3
  and v5" button. Today the page is a museum.
- **Where the action lives today:** Rollback presumably lives
  somewhere else (admin DB, ops); page implies founder must leave
  the surface to act on what they learn.

### I.4 — `/founder/ai-observatory` (`client/src/pages/founder/ai-observatory.tsx`)
- **What's shown:** Total LLM calls today, cost today, avg latency,
  cache hit rate, recent telemetry rows, model distribution.
- **What action it should suggest:** "Cost spiked +40% today — N
  candidates: Atlas's market-research call (unbounded loop?), or
  org #47's bulk import (rate-limit?). Investigate." Today: just
  numbers.
- **Where the action lives today:** Nowhere — observability without
  a routing recommendation.

### I.5 — `/admin/queues` (queue-monitor.tsx)
- **What's shown:** Per-queue waiting/active/completed/failed counts
  with sample failed jobs.
- **What action it should suggest:** "5 jobs failed with same error
  signature in last hour — auto-grouped, retry all / clear all /
  send to investigation" instead of per-queue retry buttons.
- **Where the action lives today:** Manual per-queue retry/clear,
  no grouping.

---

## Decision-queue bottlenecks (top 3)

### Q.1 — Sovereign dashboard agent-negotiation queue
- **Surface:** `/sovereign-dashboard` → NegotiationCard rows fed by
  `useAgentNegotiations`, resolved via `/api/founder/v11/negotiation/:id/resolve`.
- **Current pattern:** Two agents reach impasse on a negotiation,
  founder resolves with approve/reject. Each negotiation is a
  multi-turn dialogue snapshot.
- **What should batch-resolve:** Negotiations where both agents
  ultimately recommend the same decision (low-conflict noise).
  Negotiations whose subject category has resolved 4+ times the
  same way historically — the cascade should remember the precedent
  via `cognitiveMemoryV13` and not re-escalate.
- **What should escalate:** Genuine disagreement with monetary
  exposure, novel-pattern negotiations, anything where governanceBrain
  flags policy ambiguity.
- **Agent owner:** confidenceCascadeV14 (memory layer); Shield
  (governance layer).

### Q.2 — Founder-decisions "Needs you" bucket
- **Surface:** `/founder/decisions` "Needs you" tab
- **Current pattern:** Every decision agents flagged for human
  review lands here, ungrouped except by status.
- **What should batch-resolve:** Same `itemType` + same
  `riskLevel` + same `recommendedAction` across multiple
  organizations should batch into one founder action ("Approve
  Sophie's churn-save discount for these 7 customers · same
  template, same threshold").
- **What should escalate:** Anything novel (no historical analog),
  anything `riskLevel === "critical"`, anything where confidence
  score < 60.
- **Agent owner:** Atlas (decision aggregation); Sophie (CS-category
  batching).

### Q.3 — Tool-proposals + strategic-proposals duplication
- **Surface:** `/founder/tools` + `/founder/strategy`
- **Current pattern:** Two separate decision queues. A "we need
  Apollo enrichment" idea can land as both a strategic-move (rev
  category) and a tool-proposal (integration). Founder reviews
  twice.
- **What should batch-resolve:** Synthesis pass dedupes across
  surfaces — the *Atlas* identity should own a single proposal
  registry that both pages render different views of, not two
  sources.
- **What should escalate:** Novel proposals only. Repeats of an
  earlier rejected idea should be auto-suppressed for 90d.
- **Agent owner:** Atlas (single source of synthesis).

---

## Repetitive patterns ripe for automation (top 5)

### R.1 — "Run now" buttons on every founder page
- **Pattern:** `/founder/strategy`, `/founder/expansion`,
  `/founder/onboarding`, `/founder/prompt-evolutions`, `/founder/letter`
  all have a "run now" / "run weekly" / "sweep now" button.
- **Frequency:** Hard to estimate without telemetry. Smell: every
  founder-only page has one, so founder uses them as anxiety-relief
  ("did the agent run today?"). Cron should make this unnecessary.
- **Automation sketch:** Replace per-page "run now" with a single
  "system status" line in the founder shell ("All weekly runs
  complete · last sync 06:14 UTC"). Buttons remain for true ad-hoc
  but live behind a "manual" disclosure.

### R.2 — Reassurance toast pattern is identical across 12+ pages
- **Pattern:** Every mutation has `onError: toast({ title:
  "Couldn't X", description: "${e.message}. ${reassurance}",
  variant: "destructive" })` where `reassurance` is "Your settings
  are unchanged — try again." or near-identical phrasing.
- **Frequency:** Every founder page that mutates.
- **Automation sketch:** Single `useFounderMutation()` hook that
  encodes the pattern; copy lives in one place. Already a partial
  pattern but not yet abstracted.

### R.3 — `relative()` + `dollars()` repeated formatting on every list
- **Pattern:** Each list row formats `relative(createdAt)` and
  `dollars(estimatedImpactCents)`. Copy-pasted across todo,
  decisions, expansion, strategy, tools, traces.
- **Frequency:** Every page with a list.
- **Automation sketch:** A `<ListRowMeta>` component encapsulating
  the impact-pill + relative-timestamp pattern. Already low-effort.

### R.4 — Confirmation AlertDialog for every reversible action
- **Pattern:** Agent toggle, expansion approve, experiment abort,
  prompt-evolution apply — all guard with AlertDialog. Most are
  reversible.
- **Frequency:** Multiple times per founder session.
- **Automation sketch:** Reversible actions get inline confirm
  ("Pausing Sophie · undo") not modal. Modals reserved for
  destructive/irreversible (delete, abort experiment with running
  cohorts). Drops 5-10 modal taps per session.

### R.5 — Manual sweep on `/founder/onboarding`, `/founder/expansion`,
`/founder/strategy`
- **Pattern:** "Sweep now" / "Run weekly" / "Run scan" — founder
  asking "did this run?".
- **Frequency:** Probably daily anxiety-tap.
- **Automation sketch:** `/founder-home` already shows agent
  health; add "last completed run" timestamp visible per agent
  (Sophie · last sweep 04:00 UTC, next 16:00 UTC). Founder doesn't
  need to wonder.

---

## Single biggest leverage move

**Wire `confidenceCascadeV14` + `feedbackLoopV14.getOverrideAnalytics`
into the `/founder/todo` and `/founder/decisions` "Needs you" feeds as
a pre-render filter — not a post-hoc dashboard.**

Reasoning. The autonomy infrastructure is *built*: cascade resolution
through five layers (memory → strategy → peer → governance →
escalation), feedback-loop pattern detection from overrides, autonomy
score snapshots that already track founder-time-spent and override
frequency. But the *consumer* of that infra is currently `/founder/decisions`
as an audit log, and the autonomy health card on `/founder-home` as a
status pill. The "Needs you" feed itself does NOT consult the cascade
before queuing an item, and does NOT consult historical override
analytics to suppress already-learned patterns. So the founder still
sees patterns the system has been told ten times to handle a certain
way, plus items the cascade could have resolved at memory_lookup.

If `/founder/intelligence/todo` (the API behind the feed) is rewritten
to call `confidenceCascadeService.resolve()` for each candidate item
and only enqueue items whose cascade returned `escalated`, with the
cascade's threshold tuned per-category from
`feedbackLoopService.getOverrideAnalytics()`, the founder-as-bottleneck
problem mostly evaporates without building a new feature. The
infrastructure is paid for; it's just not in the critical path of the
surface that costs Thomas the most time.

This is also the precondition for items 1, 2, 3, 6, 7 above — they
all become trivial once the feed itself filters intelligently. Build
this first; the rest are configuration.

**Effort:** M (one focused day) — primarily route handler changes in
`server/routes/founder/intelligence.ts` (or wherever
`/api/founder/intelligence/todo` lives) plus per-category threshold
defaults; no new tables, no new agents.

---

*Audit caveats: cannot quantify queue depths, current override rate,
or auto-handled volume without authenticated DB access. Recommendations
above are pattern-level, not numerically-tuned. Founder should pick
the top 3 and have those instrumented for 14 days before tightening
thresholds.*
