# The Self-Running Company — Elite Autonomy Vision & Roadmap to 99.9%

**Date:** 2026-06-17
**Author:** AcreOS engineering (one intelligence, whole-system cold review)
**Status:** strategic — the north star + the honest gap + the horizon plan
**Predecessors:** `founder-autopilot-hands-and-limbs-2026-06-17.md` (the limbs), the autopilot frontier/learning-loop docs

---

## The reframe: AcreOS already has reflexes. It needs a nervous system and an immune system.

A full codebase audit (2026-06-17) corrects the premise. AcreOS is **not** a business waiting for autonomy to be built — it already runs a large amount of itself autonomously:

- **~118 registered jobs**, many fully closed-loop: churn scoring + rescue email (auto at risk≥85), lifecycle journeys (d7/d30/cancellation), dunning (auto-retry + stage escalation), trial conversion, NPS prompting, data retention/PII purge, TILA periodic statements, OFAC/sanctions refresh, disclosure timing, ledger dead-letter replay, daily backups + weekly restore-verify.
- **A self-healing ops layer** (`autonomousHealthMonitor`): requeues failed jobs, auto-downgrades the AI model tier when over budget, reconnects stale DB pools, prunes caches — all logged to `autonomous_decisions`.
- **A mature detection + alerting spine**: Sentry, Prometheus SLO alerts, the job deadman monitor, burn-rate monitor, release watchdog, deploy auto-rollback on failed health check.
- **The Solene autopilot** (what this session built on): the deliberative brain — senses everything, ranks moves, governs via earned autonomy + the policy-gate stack — but **think-only by default** and its hands can't yet fire.

So the right mental model for a self-running company is three layers, and AcreOS has very different maturity in each:

| Layer | Biological analogue | What it is | AcreOS today |
|---|---|---|---|
| **Reflexes** | Autonomic nervous system | The ~118 hardcoded jobs — fast, narrow, always-on loops that keep the business alive | **~70% closed-loop. Strong.** |
| **The brain** | Cerebral cortex | The autopilot — perceive everything, decide what matters, coordinate across functions, learn, govern | **Built, but disconnected** — think-only, hands can't fire, doesn't learn from or coordinate the reflexes |
| **Hands + healing** | Motor system + immune system | Outward action (comm/money/ads) AND self-repair of its own code | **Partial.** Hands built but gated/un-fired; the immune system can detect infection but can't get antibodies into the bloodstream (no code-fix→prod path) |

**The elite vision is not "build autonomy." It is: unify the reflexes and the brain into one organism, give that organism hands that actually fire, and grow it an immune system that heals its own code — so the founder becomes the board, not the operator.**

---

## What "running the business" actually means — the complete function map

To hold our reality against the goal, here is every function it takes to run AcreOS, with an honest closed-loop read: 🟢 closed-loop autonomous · 🟡 open-loop or built-but-gated · 🔴 absent/manual.

### Acquisition
- 🟡 SEO/owned content — `growthPlaybook` + publish; now proactive + conversion-weighted, but gated + publish-off
- 🟡 Outbound — P1 comm hands exist, gated, **can't fire** (no execution seam)
- 🟡 Paid ads — P4 hand built, dormant by absence (no provider)
- 🟡 Attribution — lower-bound, owned-channel only
- 🔴 Pricing/packaging experiments — fully manual
- 🔴 Conversion-rate / landing A·B optimization — manual

### Activation
- 🟢 Onboarding nudges — `onboarding_scheduler`, lifecycle d7
- 🟡 Activation sensing — built; not yet driving a closed optimization loop
- 🔴 Time-to-value optimization — manual

### Support
- 🟢 Ticket intake + Pax auto-resolve (confidence-gated) — autonomous
- 🟡 Satisfaction → learning — only the *reopen* signal feeds back; successful resolutions aren't graded
- 🔴 First-reply / resolution SLA — **not measured at all**
- 🔴 KB auto-draft from resolved tickets — columns exist (migration 0109), **job unwired**
- 🟡 NPS → action — collected on a queue, **no auto-action on a low score**

### Retention / Expansion
- 🟢 Churn scoring + rescue — autonomous at risk≥85
- 🟢 Lifecycle journeys — d7/d30/cancellation, idempotent
- 🟡 Winback (deep) — playbook exists, dispatch-gated
- 🟡 Expansion — radar detects candidates, **no auto-dispatch**

### Finance
- 🟢 Dunning — auto-retry + stage escalation
- 🟢 Billing/subscription/webhooks — autonomous
- 🟢 Revenue recognition + ledger dead-letter replay — autonomous
- 🟢 Reserve-floor check / runway envelope — autonomous
- 🟡 Reconciliation — detects drift, some classes need review
- 🟡 Unit economics (`economics.ts`) — built, not a closed control loop
- 🔴 Pricing strategy — manual

### Engineering / self-healing (the biggest structural gap)
- 🟢 Error + incident detection — Sentry, Prometheus, watchdogs, deadman, burn-rate
- 🟡 Ops self-heal — requeue jobs, throttle AI spend, reconnect DB
- 🟢 Deploy + auto-rollback on failed health
- 🔴 **Bug FIX → prod** — an agent can `file_write` + `git_commit` locally but **cannot push or deploy**; every structural fix needs the founder
- 🔴 Root-cause analysis loop — no auto "pull logs → reproduce → identify → fix"
- 🔴 Security patching — detect-only (npm audit / CodeQL / Trivy fail CI; nothing auto-patches)
- 🔴 Dependency updates — detect-only
- 🟡 Capability self-extension — `propose_capability` exists; implementation is manual

### Compliance / legal / risk (strong)
- 🟢 Constitutional guard, claims/land-safety gate, CAN-SPAM/TCPA, OFAC auto-refresh, TILA disclosures, data-retention purge, AI-safety pre-mortem + drift sentinel, native e-sign
- 🟡 Fair-lending audit — detects, pages

### Data / intelligence
- 🟢 Provider registry, telemetry/observability
- 🟡 Learning loop, forecasting/calibration — built, starved of real data (pre-customer)
- 🔴 County data co-op — strategic, not built

### Governance / meta
- 🟢 Trust Ledger (earned autonomy), self-monitoring watchdogs
- 🟡 Founder oversight UI — Control Center + `/decisions`, but the 88-door sprawl
- 🔴 **Cross-function coordination** — the brain ranks moves but treats domains independently; it doesn't model that growth raises support load raises infra cost
- 🟡 **Founder-attention economy** — everything customer-facing escalates (correct pre-trust, not yet calibrated to 0.1%)

**The pattern:** the autonomic layer is strong; the deliberative layer is built but disconnected; the immune system (code self-repair) and the measurement loops are the real holes.

---

## The 5 structural gaps that block 99.9% (these are not features — they are the architecture)

1. **Two disconnected autonomy systems.** The ~118 reflexive jobs and the autopilot brain run in parallel. The brain doesn't learn from the reflexes' outcomes, and the jobs don't consult the brain's coordination. *Elite:* one organism — the brain observes every reflex's outcome (feeds the learning loop) and arbitrates cross-function conflicts (don't fire a growth blast while support is underwater or an incident is open).

2. **The execution seam is open.** The brain's hands can't fire: witnessed-send for autopilot actions needs a *founder-scoped bound-action surface* (today's founder asks are yes/no, not bound to an executable hand+input; the mature `approvalKernel`/`pending_actions` is org-scoped to the customer's Pax UI, the wrong surface). Until this closes, the deliberative layer is advisory only.

3. **No immune system for code.** Detect→triage is closed; **fix→verify→deploy is open.** A business that "handles bug handling" must close this loop — gated: investigate → reproduce → fix on a branch → CI proves it → founder-approval queue (or *earned-autonomy auto-merge* for the safe class: dependency patch bumps, then small well-tested fixes) → deploy → confirm-resolved.

4. **Open measurement loops.** Many functions act without measuring the outcome (support SLA, satisfaction→learning, NPS→action, KB auto-draft, expansion result). **You cannot earn autonomy on a loop you don't measure.** Every function needs a real outcome signal feeding the learning loop.

5. **The founder-attention economy isn't calibrated to 0.1%.** Everything customer-facing escalates. 99.9% means the escalation ladder + earned autonomy route *only* genuine board-level decisions to the founder. This calibration **is** the definition of done.

---

## The horizon roadmap

### H1 — Connect & close (make the brain real)
*Turn the built-but-disconnected brain into an operating one. Highest leverage.*
- **Wire the execution seam (the keystone):** a founder-scoped bound-action surface so an approved `/decisions` item fires `executeHandWitnessed`. This is what makes every P1–P4 hand real instead of refused.
- **Unify reflexes + brain:** feed every autonomous job's outcome (`job_runs`, `autonomous_decisions`) into the experience log so the brain *learns from the reflexes*; add a cross-function arbitration gate so the brain can pause a reflex when a higher-priority function needs the room.
- **Close the cheap measurement loops:** support first-reply + resolution SLA timers; wire the KB auto-draft job (columns already exist); NPS-below-threshold → auto-outreach play; feedback sentiment → action. Each closes a loop the brain can then earn autonomy on.

### H2 — The immune system (handle bug handling for real)
*Close detect→fix→deploy so the company heals its own code.*
- **Root-cause loop:** a Sentry issue / error-rate spike dispatches an investigator agent — pull logs, reproduce, identify, draft a fix on a branch.
- **Gated code-fix-to-prod:** agent fix → CI proves green → founder-approval queue (same witnessed surface) → merge → deploy → confirm the error cleared. Start earned-autonomy auto-merge with the *safe class only* — dependency patch-version bumps (`npm audit fix` → branch → CI → auto-merge), then small, fully-tested, reversible fixes — expanding the class only as the Trust Ledger earns it.
- **Capability self-extension:** `propose_capability` → for low-risk tools, auto-implement behind the same gate. The system grows its own hands, witnessed.

### H3 — Coordinate & optimize (the brain runs the whole P&L)
*From "do the next sensible thing" to "run the business by the numbers."*
- **Cross-function model:** the brain models second-order effects (growth → support load → infra cost → runway) and allocates effort + budget across *all* domains by expected P&L impact (`economics.allocateByRoi` over the whole org, not just ads).
- **Objectives become a live OKR tree** the brain plans against and reports on in the daily letter (P5 substrate is built; make it the planning spine).
- **Forecasting drives proactivity:** predict churn, cost, and demand and act *ahead* of them, not just in reaction.
- **Pricing/packaging experiments** — the last manual growth lever — become governed experiments with real conversion measurement.

### H4 — The board-only founder (99.9%)
*Calibrate the system so the founder is the board, not the operator.*
- **Calibrate the founder-attention economy:** the escalation ladder + earned autonomy route only the irreducible 0.1% — irreversible high-stakes, constitutional changes, capital above threshold, genuinely-novel-no-precedent, and the human relationships. Everything else self-runs and self-corrects.
- **The daily letter becomes the board report:** what the company did, what it earned, what it's deciding, the one or two things that genuinely need you.
- **Compounding self-improvement:** the learning loop + capability discovery + policy inducer running continuously, so the organism gets measurably better each week without the founder in the loop.

---

## The honest ceiling — what 99.9% is and isn't

**99.9% ≠ 100%, and that's the design, not a shortfall.** The 0.1% is the irreducible founder reserve:
- **Constitution changes** — by definition cannot be self-modified (immutables).
- **Capital allocation above threshold** — the founder owns the balance sheet.
- **Genuinely novel, high-stakes, no-precedent calls** — the learning loop has nothing to draw on; a human decides.
- **Irreversible actions of consequence** — `riskautonomy` escalates these by construction, forever.
- **The human relationships** — key partnerships, the occasional VIP, the things that *are* the founder.

99.9% means the founder is the **board and the owner**, not the operator — they set the constitution and the capital, read the daily board report, and make the handful of genuinely-irreducible calls. Everything else the organism handles and corrects on its own.

**And the path is gated by EARNED trust on REAL outcomes — which requires customers.** Pre-customer, the honest ceiling is not "fully autonomous" but **"fully ready to earn"**: every loop closeable, every hand wired, the immune system in place, the founder-attention economy calibrated — so that the moment real outcomes start flowing, autonomy *accrues* across functions instead of having to be built. H1 + the publish-on switch get us most of the way to "ready to earn"; H2–H4 are what the first months of real customers unlock.

---

## The one-sentence north star

> AcreOS becomes a self-driving company: an organism whose reflexes keep it alive, whose brain coordinates and learns across every business function, whose hands act under earned trust and witnessed consequence, and whose immune system heals its own code — leaving the founder to be the board, contacted only for the 0.1% that is genuinely theirs to decide.

---

## Deferred — discrete focused sessions (each its own scoped, verified build)

These were deliberately *not* rushed into the horizon builds — each touches a real prod system (deploys, billing, the customer UI) or is the dangerous "act" half of a gate, and deserves a fresh session with its own verification. Listed in recommended order. Close each one as its own PR.

| # | Session | Scope | Why deferred |
|---|---|---|---|
| **D1** | **H2 last mile — the code-fix execution wire** | The gated `npm audit fix → branch → git push → open PR → CI → deploy` path for the *safe class only*, reusing the H1 seam + `codeChangeGate` + earned autonomy. The off-by-default git capability turns on here. Plus capability self-extension (`propose_capability` → auto-implement low-risk behind the gate). | The genuinely dangerous part — autonomous changes reaching prod. Needs its own careful, separately-reviewed build. The H2 *foundation* (guardrail, audit, plan, root-cause) is already shipped. |
| **D2** | **H1 measurement loops** | Support first-reply + resolution SLA timers; wire the KB auto-draft job (schema columns already exist, job unwired); NPS-below-threshold → auto-outreach play; feedback sentiment → action. | Each closes an open loop on a live prod system (support tickets, NPS queue). Discrete and independently shippable — could be 1–2 sessions. |
| **D3** | **H3 forecasting-driven proactivity + governed pricing experiments** | Turn `forecast.ts`/`contextualForecast.ts` predictions into pre-emptive moves (predicted runway breach / churn / demand spike → act ahead); pricing/packaging A·B as governed experiments with real conversion measurement. | Pricing touches billing; forecasting-to-action wants the H3 cross-function core (this session) landed first. |
| **D4** | **P3 follow-on — surface the deal-coach** | Render `dealActions.getDealActionsForOrg` inside the customer **Deals** door (a client UI surface, behind one of the five fixed doors). | A real customer-facing UI build needing viewport/theme/browser verification. |
| **D5** | **P4 follow-on — the real ad adapter + paid attribution** | A live Meta (then TikTok) adapter behind the `adProvider` seam + extend `attribution.ts` to carry ad `utm_content` into the conversion ledger. | A net-new external integration; earns autonomy last; only meaningful once owned-growth proves a real CAC. |
| **D6** | **P6 follow-on — the founder UI consolidation** | The page-merge (10 overview pages → one canonical home). **Empirical correction (2026-06-18):** the `/founder/*` redirects are NOT dead — they're intentional bookmark-compat infrastructure (`client/src/lib/route-redirects.ts`) and several are still linked, so they should be KEPT, not deleted. The real clutter was a handful of redundant `legacy` sidebar entries (2 removed this turn: "Operations console (legacy)", "What needs you"). The substantial remaining work needs an **IA decision first** — the four-door doctrine names The Letter `/founder/autopilot`, but the live home is `/founder/bridge` (everything redirects there); reconcile that, then merge the overlapping overviews. | A client refactor needing the elite-multi-dimensional verification AND a founder IA decision (which surface is the canonical home). The four-door *doctrine + ratchet* + the sidebar declutter are shipped. |

Each is gated/dormant-safe by construction (nothing goes live without the founder flipping a switch and a domain earning autonomy). The ordering reflects leverage: D1 completes the immune system; D2 closes the cheap loops; D3 finishes H3; D4–D6 are surface/integration polish.
