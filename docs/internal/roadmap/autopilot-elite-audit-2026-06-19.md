# Autopilot — Elite Panel Audit & Path to "Turn It On and Trust It"

**Date:** 2026-06-19
**Method:** six independent fresh-eyes adversarial reviews of the real code on `main` — a staff AI/ML engineer, a principal SRE, a seasoned SaaS CEO/operator, a security/compliance/AI-safety lead, a 20-year land investor, and a product/UX trust lead. None built the system; each was told to assume it's worse than it looks and find what breaks.
**Status:** the honest blind-spot map + the prioritized path to a system the founder can turn on, watch live, and trust.

---

## The meta-finding (all six converged, from different angles)

**The autopilot is a beautifully-engineered, unusually-honest scaffolding of intelligence — but the marquee intelligence, learning, P&L, and board-reporting modules are DEAD CODE with zero production callers.** Three reviewers independently grepped and confirmed the same list of written-tested-and-never-invoked modules:

- `decisionEval.ts` (the "intelligence keystone" eval harness) — **no callers**
- `learnedGates.ts` / `currentAutoResolveThreshold` ("Leap 1: rules→learning") — **no callers**; the support gate still uses the typed `0.8`
- `contextualForecast.ts` (P(success|situation) — the fix for the marginal-forecast flaw) — **no callers**; the live loop still uses the marginal `forecastMove`
- `economics.ts` (`budgetGate`/`allocateByRoi`/`shouldRampBudget` — the P&L brain) — **no callers**; referenced only in a comment
- `okr.ts` (`buildOkrTree` + the binding-constraint — the most board-relevant concept) — **no callers**
- `composeBoardReport` (the board packet) — **no callers**; the founder gets the operator-grade `narrate.ts` brief instead
- `seedGrowthObjectives` — **never called**, so the objectives table is empty at runtime and the "move these numbers" weighting is inert (`domainUrgency` returns neutral 1.0 for everything)

This is the builder's-bias blind spot in its purest form: the dominant pattern in the codebase is *well-tested code with no production caller.* Much of it was built this very session. **The gap to elite is overwhelmingly INTEGRATION + HARDENING + SURFACING, not invention** — and that's good news, because wiring is cheaper than inventing.

The honest one-liners the panel landed on:
- AI/ML: *"a rules engine wearing the vocabulary of a learning system… the scaffolding is good scaffolding; it is not yet a learning system."*
- CEO: *"a tireless, well-guardrailed head of operations — but not a CEO, and it can't show me it's a good one. The danger isn't recklessness; it's diligent irrelevance."*
- UX: *"a trustworthy report ABOUT an autopilot, not an autopilot you fly with."*
- Land investor: *"generic SaaS automation dressed in land vocabulary — sitting on a land-data platform that is the real thing."*
- SRE: *"the decision logic is more trustworthy than the substrate it runs on."*
- Security: *"the safety story is told around the hand harness while the real blast radius sits outside it."*

---

## What's genuinely excellent (credit, honestly)

The panel was adversarial but unanimous on the bright spots:
- **The honesty discipline is best-in-class.** Cold-start-honest ("no track record yet — couldn't predict honestly"), no fabricated data, the truth-ratchet. *"Most products would have faked it"* (UX). This is the foundation everything else can earn trust on.
- **The governance DESIGN is unusually thoughtful.** The composed gate stack, the earned-autonomy ladder, safe-off-by-default, the witnessed-send approval kernel (hash-bound, atomic claim, append-only audit) — *"real, not theater."*
- **The data-co-op moat is real and being built correctly from day one.** Append-only `parcel_observations` on every sighting (one async insert), privacy-correct k≥5 rollups, sale-history back-dated to deed date. *"The one asset you cannot buy retroactively"* — and it's accreting now. The single unambiguous strategic win.
- **`selfPatch` (PR-not-merge) + `codeChangeGate`, the deploy auto-rollback, the Thompson/Brier math** — all real and well-built.

---

## The blind spots, ranked by severity

### 🔴 P0 — hard blockers for "turn it on and walk away"

**1. The `bash` blast radius is the real perimeter, and it's wide open** (SRE + Security, both flagged #1). Every autopilot-initiated dispatch gets `bash -lc <arbitrary>` with the **full production `process.env`** (Stripe keys, `DATABASE_URL`, the encryption key, the deploy token) and **no command allowlist** — guarded only by ~7 brittle constitutional regexes. The elegant witnessed-send wall, `codeChangeGate`, and per-domain Trust Ledger are all **bypassable via bash**: `git push origin main` → auto-deploys to prod; `curl https://api.stripe.com/...` → moves money outside the hand harness; `psql $DATABASE_URL` → exfiltrates data. The gates protect *which move runs*, not *what the agent does inside the move*. `server/services/solene/dispatchToolExecutor.ts:710`.

**2. Per-domain autonomy is an illusion at execution time** (Security). Autonomy is earned per-domain, but a dispatch enqueued for the *safest* domain runs a general-purpose agent that can call **any** hand/tool from **any** domain (including `dunning_action`/finance and `bash`). Earning trust in `growth` unlocks the full toolset. `act.ts:86` binds the gate to the move's domain, not the hand's.

**3. The reward signal is process, not value — so autonomy is earned on useless-but-clean work** (AI + CEO). `outcomeOf` rewards "the dispatch ran without erroring," not "the business outcome happened." A domain can earn its way to `execute_gated` by reliably completing dispatches that produce zero results. `mrr` is sensed and **ignored** by every decision rule. This is the deepest correctness flaw: the system optimizes permission + completion, never value.

**4. Money gates fail OPEN; caps are per-call, not per-window** (SRE + Security). `assertWithinEnsembleCap` and `aiCostCeiling` explicitly fail-open on read error — a DB hiccup silently passes all spend. Refund/ad caps are $50 *per call* with no cumulative ledger (100 × $49.99 = $4,999, each passing). No enforced daily spend/dispatch envelope.

### 🟠 P1 — required for trust + observability

**5. There is no "what is it doing right now" — and the approval queue has no UI** (UX + SRE, devastating). The home is 5-min stale (no `refetchInterval`), the Control Center doesn't auto-refresh, transcripts live in `/tmp` (gone on restart), and — the killer — the **pending-actions witnessed-send queue ("here's the email I drafted, approve before I send") has zero frontend.** The single most trust-critical surface is server-only and unreachable. The "pending decisions" tile even links to a dead redirect. The founder can *audit* the autopilot but cannot *watch it work* or *approve before it acts.*

**6. The watchdog shares fate with what it watches; one alert channel** (SRE). The loop-stall watchdog runs in the same worker process as the loop; ntfy is the sole alert transport; the external uptime probe is dormant. No out-of-process liveness check today.

**7. Audit gap on autonomous hands** (Security). `autopilot_sends` is written only on the *witnessed* path. A `requiresApproval:false` hand (e.g. `dunning_action`, which re-charges cards) executes with no audit row — and `bash` side-effects are only free-text transcripts. No invariant test enforces "finance/customer-facing hands MUST require approval."

### 🟡 P2 — the exponential elevations (good → elite)

**8. Wire the dead intelligence + make autonomy earn on value** (AI + CEO). Connect `decisionEval` (gate promotion on *decision quality*, not clean cycles), `learnedGates`, `contextualForecast`, `economics`, `okr`, `composeBoardReport`, and `seedGrowthObjectives` into the live loop. Make reward value-based via real attribution (action → measured business delta over a window). This converts "scaffolding" into a learning system — and it's mostly *plumbing the code that already exists.*

**9. Make it land-native** (Land investor). The brain has **zero** land awareness; the real land logic (`landCredit.ts`, `comps.ts`) is quarantined and never consulted; `dealActions.ts` is generic CRM follow-up named "land-native"; comps aren't even vacant-land-filtered; there's no buy-box and no due-diligence tied to contingency expiry. Wire the land data + co-op into the brain, and turn the tenure/tax-delinquency observation graph into a cross-county **lead engine** (the un-buyable moat doing customer-visible work).

**10. Give it a P&L brain + a strategic horizon** (CEO). 100% intraday triage; growth only fires when everything's calm; no pricing/positioning/segment reasoning; no weekly strategic cadence; no visible decision track-record/scorecard. A board-grade system needs a planning horizon and a batting average the founder watches climb.

**11. Compliance hardening** (Security). Run `claimsGate` on outbound email/SMS bodies (not just broadcasts); add TCPA consent + quiet-hours + STOP handling to `send_sms` before it can ever send.

---

## The path to "turn it on and trust it" — three workstreams + two elevations

The findings collapse into a clean program. The first three are the path to *trustworthy*; the last two are the path to *elite*.

### Workstream A — HARDEN THE PERIMETER (P0; the hard blockers)
1. **Sandbox `bash`** for autopilot dispatches: scrub the env (no Stripe/DB/encryption/deploy secrets), allowlist commands (or remove `bash`/`file_write`/`git_commit` from loop-spawned agents entirely — role-gate `getDispatchToolSchemas()`), block network egress.
2. **One gated door:** run the full gate stack *inside* `executeHand`, keyed off the hand's own domain. Add the invariant test (finance/customer-facing hand ⇒ `requiresApproval`).
3. **Fail-closed money gates + a hard daily envelope** (`AUTOPILOT_MAX_SPEND_PER_DAY`, `MAX_DISPATCHES_PER_DAY`) consulting a cumulative spend ledger.
4. **Append-only `autopilot_actions` audit** for every autonomously-executed hand + bash side-effect.

### Workstream B — BUILD THE COCKPIT (P1; the trust surface)
5. **The "About to act" live approval queue UI** — the missing #1 surface: auto-refreshing, shows the actual draft, one-tap Approve/Reject, countdown to escalation. The server is done; build the client.
6. **A live decision stream** (SSE/5s): "current tick → considered moves → chosen → gate verdict → in-flight dispatch + live cost." Make `home.tsx` a living dashboard (add `refetchInterval`, render `focusLine`, a heartbeat).
7. **Surface the trust ladder's earning** (`cleanCycleCount/threshold` progress), recommend graduations, add a consequence-preview on Grant and a global **STOP** button. Durable transcripts (S3/DB). Out-of-process watchdog + second alert channel.

### Workstream C — ENERGIZE THE BRAIN (P1→P2; wire the dead code)
8. **Value-based reward via attribution** (the gate on all learning) — feed `outcomeOf` a measured business delta, not dispatch-success.
9. **Connect the dead limbs:** `contextualForecast` → the live forecast; `learnedGates` → `SupportCtx`; `decisionEval` → **gate autonomy promotion on decision quality**; `economics` → the act path; `okr` + `composeBoardReport` → the founder surface; **call `seedGrowthObjectives`** + add real revenue/retention/runway/CAC objectives and make `rankMoves` consume them.

### Elevation 1 — LAND-NATIVE INTELLIGENCE
Wire `landCredit`/`comps`/the co-op into `decide.ts`/`dealActions.ts`. Make the deal-coach reason about offer-vs-comp, due-diligence-vs-contingency, buy-box, county-relative pricing. Turn the tenure/tax-delinquency graph into a proactive lead engine. Fix comps to be vacant-land-native + add legal-access reasoning.

### Elevation 2 — THE P&L + STRATEGIC BRAIN
A weekly strategic tick distinct from intraday triage: objectives-vs-target, 1–2 strategic decisions surfaced (pricing, segment, channel bet) as founder-reserve. A visible decision scorecard (predicted → actual → hit-rate) the founder watches climb — *that* is what earns the keys.

---

## Honest verdict

**Turn it on TODAY in its safe-off / OBSERVE posture — yes, confidently.** That's exactly what flipping the switch does on day one: every domain blocks, customer-facing escalates, nothing acts outwardly, and the founder watches the brain think and build a record. The cold-start design is genuinely safe-by-construction and the honesty discipline is real.

**Promote domains to `execute_gated` and walk away — not yet.** Not because it would be reckless (the guardrails are conservative and real) but because (a) the `bash` perimeter is wide open, (b) autonomy is earned on process-success not value, and (c) the founder can't *see* it work or *approve before it acts*. None of these are rewrites — they're a hardening pass, a cockpit, and a wiring pass on an architecture whose *design* is, at the governance layer, better than most production AI systems.

**The distance to "turn it on and trust it to run AcreOS while I'm the board" is Workstreams A + B + C — perimeter, cockpit, and energizing the brain that's already built but unplugged.** The elevations (land-native, P&L/strategic) are what make it not just trustworthy but genuinely elite. The bones are unusually good. The connective tissue between *can-compute* → *decides-on* → *acts-safely* → *shows-me* is the work.

### The single highest-leverage next move
**Sandbox `bash` (A1) and build the live approval-queue UI (B5), in that order.** A1 is the one true safety blocker; B5 is the one surface that converts "trust a black box" into "watch it draft, approve with a tap, watch it act." Everything else compounds off those two.
