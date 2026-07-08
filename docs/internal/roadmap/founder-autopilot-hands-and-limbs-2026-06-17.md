# Founder Autopilot — Hands & Limbs Roadmap

**Date:** 2026-06-17
**Author:** AcreOS engineering (one intelligence, 7-lens cold review)
**Status:** proposed — dependency-ordered, gated-dormant by construction
**Predecessors:** `founder-autopilot-2026-06-16.md`, `-frontier-2026-06-16.md`, `-teardown-2026-06-16.md`, `-t0-lastmile-2026-06-16.md`

---

## The reframing: the organs exist, the nerves don't

The earlier teardown said the autopilot "has a brain and no hands." A full codebase map (4-agent sweep, 2026-06-17) corrects that in an important way:

**The limbs already exist as production-grade services. They are not wired to the brain.**

| Organ | Already built | File |
|---|---|---|
| Email send | AWS SES + CAN-SPAM footer + RFC-8058 unsubscribe + suppression list + soft-bounce strikes + IP warmup quotas + SES/SendGrid event webhooks | `server/services/emailService.ts`, `emailSuppressions.ts`, `unsubscribeTokens.ts`, `routes-sendgrid-events.ts` |
| SMS send | Twilio + Telnyx via cost-routed `commsRouter` + TCPA STOP handling + consent ledger + financial_ledger cost posting | `server/services/smsService.ts`, `comms/router.ts` |
| Push | Web Push (VAPID) per-user/per-org + auto-prune expired | `server/services/pushNotificationService.ts` |
| Direct mail | Lob letters + postcards + cost model + BYOK | `server/services/mailProvider.ts` |
| In-app inbox | `inbox_messages` table + threading + read/archive | `shared/schema.ts`, `routes-communications.ts` |
| Money ops | Stripe customer/checkout/portal/pause/resume + **dunning engine** (5-stage) + refunds (auto ≤$50) + trials + Connect + idempotent webhooks | `server/stripeService.ts`, `services/dunning.ts`, `stripeConnect.ts`, `trialService.ts`, `webhookHandlers.ts` |
| Lifecycle automation | multi-channel sequences w/ branching | `server/services/lifecycleProgram.ts` |
| Notification routing | per-event, per-channel prefs + global mute | `server/services/notificationPreferences.ts` |

And the **governed action seam** is already built and tested:

- `policyGate.ts` — 5-gate stack: compliance → quality → budget → autonomy → witnessed-send. Returns `pass | block | escalate`.
- `act.ts::planAndAct()` — `pass`→enqueue to `solene_dispatch_queue`; `escalate`→`askFounder()` into `solene_founder_asks` + pager; `block`→suppress.
- `dispatchToolExecutor.ts` — the tool registry the dispatched agent can call. **Today: 16 tools, all internal** (file/git/agent-msg/record-*). This is the empty hand.
- `approvalKernel.ts::APPROVAL_REQUIRED_TOOLS` — already lists `send_email, send_sms, send_gmail, send_slack_message, create_stripe_payment_link` — **the witnessed-send contract is pre-declared for hands that don't exist yet.**
- `settings.ts` — DB master switches (`dispatchEnabled`/`publishEnabled`), env-safe-off default, 5s cache, flippable from `/founder/autopilot/control`.

**So the work is not "build limbs." It is: (1) expose each existing service as a governed dispatch tool behind the gate that's already waiting for it; (2) grow the senses so the brain perceives the outside world these limbs act on; (3) close the loop so outcomes feed learning; (4) collapse the 88-door founder UI so autonomy reduces surface instead of adding to it.**

Everything below is gated-dormant by construction: a new hand does nothing until (a) its domain earns autonomy past OBSERVE on the Trust Ledger, AND (b) `dispatchEnabled` is on, AND (c) — for any outward send — a founder tap clears witnessed-send. Three independent locks. We are pre-customer; the goal is **readiness to earn**, not switched-on autonomy.

---

## Architecture: one "hand" pattern, applied N times

Every hand follows the identical 6-point integration seam (verified against `act.ts` + `dispatchToolExecutor.ts` + `policyGate.ts`). This is the template each phase instantiates:

1. **Tool schema** in `DISPATCH_TOOL_SCHEMAS` (`dispatchToolExecutor.ts`) — name, description, input_schema.
2. **Executor handler** — `case "send_email":` → `toolSendEmail(input, ctx)` that calls the *existing* service (e.g. `emailService.sendEmail`). The handler is a thin, auditable adapter — never new send logic.
3. **Move binding** in `MOVE_BINDINGS` (`act.ts`) — `{ domain, agentRole, isCustomerFacing, surface }`. `isCustomerFacing` / `outwardClass` decide witnessed-send.
4. **Approval-set membership** (`approvalKernel.ts`) — already declared for the 5 known send tools; new tools added here force witnessed-send regardless of domain autonomy.
5. **Craft + claims** — `dispatchPromptFor()` already injects `craftStandardPrompt(surface)`; outward marketing also runs `screenForPublish()` / `claimsGate`.
6. **Feedback + sense** — `applyAutonomyFeedback()` already fires post-dispatch; each hand additionally emits an outcome sense (delivery/bounce/conversion) so the loop closes.

**The invariant (must hold for every hand):** there is *no* code path from model→outward-send that bypasses the founder tap while the domain is below AUTONOMOUS_GATED. The witnessed-send gate is the wall; hands are doors in it, never holes around it.

---

## Phase 0 — Foundation: the action-tool framework + outward perception

*Nothing outward ships until this is in place. ~1 build-session. No new external integrations.*

### 0.1 — Hand harness (`server/services/autopilot/hands/`)
A new directory: one file per hand, each exporting a `ToolHandler` (`(input, ctx) => Promise<ToolExecutionResult>`) and a `HandSpec` (schema + move-binding + approval-membership + outcome-sense emitter). `dispatchToolExecutor.ts` imports the registry instead of growing a 30-case switch. This keeps each hand a small, reviewable, individually-gateable unit and lets us add a per-hand kill switch in `autopilot_settings` later.

- **Acceptance:** registry-driven dispatch; existing 16 tools migrated unchanged; `npm test` green; zero behavior change (still no outward hands registered).

### 0.2 — Outward perception bus (the senses the brain lacks)
Today senses read AcreOS's own DB (`senses.ts`: pulse, support count, leads). The brain is blind to the outside. Wire the **webhooks that already land** into autopilot senses:

- `routes-sendgrid-events.ts` (bounce/complaint/unsub) → `emailHealthSense` (deliverability, complaint rate).
- `webhookHandlers.ts` Stripe events (`invoice.payment_failed`, `subscription.deleted`, `trial_will_end`, `charge.dispute`) → `revenueSense` (MRR delta, dunning pressure, churn signal, dispute risk).
- `smsService.ts::handleIncomingSMS` STOP/reply → `inboundSense` (opt-out rate, live inbound).
- `usageLimits.ts` → `activationSense` (orgs hitting limits = expansion signal; orgs at zero = activation stall).

These become inputs to `decide.ts::rankMoves` so the brain reacts to the market, not just to itself. **This is the single highest-leverage Phase-0 item** — without it, every hand acts blind and the learning loop has nothing real to learn from.

- **Acceptance:** each webhook handler emits one append-only `autopilot_sense` row (new table, schema 0177); `sensesFromPulse` reads them; pure functions, unit-tested; no behavior change to the webhooks themselves (best-effort, wrapped in try/catch so a sense write can never break a payment webhook).

### 0.3 — Outcome ledger generalization
`experienceLog.ts::outcomeOf()` currently derives a vote from strict internal signals. Extend (don't loosen) it to ingest the new outward senses as outcome evidence: an email that bounced is a *negative* outcome for the move that sent it; a dunning action followed by `invoice.payment_succeeded` is a *positive* outcome. This is what makes hands learnable.

- **Acceptance:** outcome derivation still refuses to invent signal (truth-ratchet); new evidence sources are additive and individually unit-tested for both directions.

---

## Phase 1 — The Communication Limb (highest leverage, lowest new risk)

*Every service here is production-grade with compliance already built. We are wiring, not building. Each hand starts at OBSERVE and is witnessed-send-locked.*

### 1.1 — `send_email` hand → `emailService.sendEmail`
The flagship. Thin adapter; **must** route through the existing `filterSuppressed()` + CAN-SPAM footer + unsubscribe-token path (the adapter calls `sendEmail`, which already does all of this — do not bypass). `isCustomerFacing: true` ⇒ always witnessed-send. `send_email` is already in `APPROVAL_REQUIRED_TOOLS`.

- First real closed loop: brain decides → drafts → **founder taps** → `sendEmail` → SendGrid webhook bounce/open → `emailHealthSense` → `outcomeOf` → Trust Ledger. End to end, witnessed, learnable.
- **Acceptance:** suppression honored (test: suppressed recipient → hand returns blocked, never sends); footer present on non-transactional; witnessed-send escalation proven by test (mirrors `policyGate.test.ts`); cost/audit logged.

### 1.2 — `send_sms` hand → `smsService.sendOrgSMS` / `sendSMSToLead`
Adapter must respect `leads.doNotContact` + TCPA consent before send (the service enforces STOP on inbound; the hand must *check consent* before outbound). `send_sms` already in approval set. Cost posts to `financial_ledger` automatically.

- **Acceptance:** `doNotContact` / `tcpaConsent=false` → blocked at the hand; consent-checked path unit-tested; quiet-hours guard (no autonomous SMS outside recipient-local 8am–9pm) added to the adapter.

### 1.3 — `send_push` hand → `pushNotificationService.sendPushToUser`
Lowest-risk outward channel (opt-in subscription, no regulatory surface). Good candidate to be the *first* channel a domain is allowed to act on autonomously once it earns EXECUTE_GATED, because a push is reversible-class and low-blast-radius.

### 1.4 — `send_letter` / `send_postcard` hand → `mailProvider`
Direct mail is the land-investor-native channel (this is how land deals actually get sourced). Higher cost ⇒ `assessRisk` (`riskautonomy.ts`) escalates on value; always witnessed-send + budget-gated. Lob test-mode by default until founder flips live.

### 1.5 — Channel-choice intelligence
`notificationPreferences.ts::shouldNotify(userId, orgId, eventId, channel)` already exists. The brain must consult it before picking a channel so an autonomous message respects the recipient's per-channel opt-outs. Wire `shouldNotify` into `act.ts` move→channel selection. **No autonomous message may pick a channel the recipient muted.**

- **Phase-1 acceptance (whole limb):** the four send hands exist, each gated three ways, each with a passing suppression/consent test; one fully-witnessed email loop demonstrated end-to-end in a test harness; `decide.ts` can select a compliant channel. All domains still OBSERVE ⇒ zero autonomous sends in prod.

---

## Phase 2 — The Money Limb (highest business leverage)

*Revenue operations are the highest-value autonomy. Stripe stack is mature; dunning is a 5-stage engine already. We expose governed money hands — every one reversible-class-aware and witnessed for irreversible moves.*

### 2.1 — `dunning_action` hand → `dunningService.retryPayment` / `resolveCase`
Failed-payment recovery is the safest money hand: the *outcome* (payment succeeds or doesn't) is self-verifying, and retrying a card is reversible/non-destructive. This is the ideal **first money domain to earn EXECUTE_GATED**: it acts on the `revenueSense` dunning-pressure signal, and `invoice.payment_succeeded` closes the loop cleanly.

- Witnessed-send for the *customer-facing dunning email* (already templated in `dunning.ts`); the *retry-charge* itself is internal/reversible and can graduate to autonomous-gated first.
- **Acceptance:** hand can retry a failed invoice and resolve/cancel a case via existing service methods; never escalates dunning stage autonomously past `payment_recovery_2` without a tap (suspension is high-blast-radius); outcome sense wired.

### 2.2 — `change_plan` / `apply_credit` hand
Plan changes + courtesy credits for retention saves. **Irreversible-class** (a refund/credit moves real money) ⇒ `riskautonomy.ts` forces escalation even in a trusted domain. Auto-refund ≤$50 already exists in `routes-billing.ts`; the hand exposes it under the same threshold + the same 30-day rate limit, never looser.

### 2.3 — `trial_nudge` hand → `trialService` + `send_email`
Composes the comm limb: trial-ending sense (`trial_will_end` webhook) → drafted nudge → witnessed send → conversion sense. The first **revenue-closing** loop. Pre-customer this is dormant but ready the instant trial #1 starts.

### 2.4 — Economics feedback into the grow-gate
`economics.ts` (`budgetGate`, `allocateByRoi`, `shouldRampBudget`) exists but is open-loop. Feed real `revenueSense` MRR + the new `autopilot_conversions` attribution into `decide.ts`'s growth-move ranking so spend decisions are EV-grounded. **`shouldRampBudget` may only ramp on proven-healthy CAC from real attributed conversions** — never on projection.

- **Phase-2 acceptance:** dunning + plan + trial hands exist, money moves are irreversible-class-escalated, ≤$50/30-day refund ceiling preserved, economics reads real revenue signal. All dormant until a customer exists.

---

## Phase 3 — The Customer-Lifecycle Limb

*Compose Phases 1–2 into the serve→retain→expand loop. These are not new hands; they're plays that orchestrate existing hands + the deal-coach.*

### 3.1 — Support auto-reply (witnessed) → `supportPlaybook` + `send_email`/inbox
`supportPlaybook.ts` + `senses.ts::getOpenSupportCaseCount` already sense the backlog. Wire the draft→witnessed-send→`inbox_messages` reply path. First-reply-time is a measurable objective (Phase 6). Always witnessed until support domain earns trust.

### 3.2 — Onboarding activation nudges → `activationSense` + comm limb
Orgs that signed up but hit zero usage (the activation stall sense from 0.2) get a drafted, witnessed nudge. Closes the dormant-journey gap the meta-lens review flagged.

### 3.3 — Surface the deal-coach to customers → `dealActions.ts`
`getDealActionsForOrg` already scores next-best-actions over the real `leads` pipeline. It's dark to customers. Surface it inside the **Deals** door (one of the five fixed customer doors — no new nav). This is the land-native "hands" customers feel directly, and it generates the witnessed actions (send offer, follow up) that the comm limb executes.

### 3.4 — Expansion + win-back plays
`usageSense` (org at limit = expansion candidate) → drafted upgrade offer; churn-risk sense (`subscription.deleted` imminent, dunning final-notice) → win-back. Both compose money + comm hands, both witnessed, both learnable via conversion sense.

- **Phase-3 acceptance:** four lifecycle plays exist as `growthPlaybook`/`supportPlaybook` entries composing real hands; deal-coach visible in Deals door; every customer-facing action witnessed; conversion/retention outcomes feed learning.

---

## Phase 4 — The Growth/Distribution Limb (the one genuinely-new limb)

*Owned-channel publish already ships (`publishArtifact.ts` → /field-notes). Paid + earned distribution is the real gap.*

### 4.1 — `run_ad_campaign` hand (NEW external integration)
The `/founder/cmo` page already references a Meta + TikTok ad-engine surface. Build the actual adapter: a `comms/providers`-style pluggable ad-platform interface (Meta Marketing API, then TikTok). **This is the only net-new external limb in the whole roadmap.** Ad spend is irreversible-class + budget-gated + witnessed (spending real dollars) until growth domain earns deep trust. `economics.allocateByRoi` governs allocation; `shouldRampBudget` governs scale; both read real attributed CAC.

- Start in **draft-only** (autopilot proposes a campaign + creative + budget; founder approves each) for a long earn period. Ad spend is the highest-blast-radius hand in the system — it earns autonomy last.

### 4.2 — Syndication / earned distribution
Beyond owned `/field-notes`: cross-post to where land investors actually are. Witnessed, claims-gated (the same `screenForPublish` 3-layer gate), owned-link-allowlist enforced.

### 4.3 — Real conversion attribution closes the growth loop
`attribution.ts` (`attributeSignup`, off the witnessed `marketing_touch` chain → `autopilot_conversions`) exists but only fires for owned field-notes. Extend the touch chain to carry ad `utm_content=art_<id>` and syndication slugs so paid/earned distribution attributes too. **Remains a lower bound, founder-dashboard-only, NEVER fed to the learning loop as ground truth** (absence ≠ failure — the frozen invariant).

- **Phase-4 acceptance:** ad hand exists draft-only + budget/risk-gated; syndication claims-gated; attribution spans owned+paid+earned; spend gated behind proven CAC. Dormant pre-customer.

---

## Phase 5 — Objectives: from "do sensible things" to "move these numbers"

*The brain narrates goals as strings. For 99.9% autonomy it must hold structured objectives it plans against and measures toward.*

- **`autopilot_objectives` table** (schema 0178): `{ key, target, current, owning_domain, deadline, source }`. e.g. `activated_orgs`, `support_first_reply_minutes`, `trial_to_paid_rate`, `monthly_recurring_revenue_cents`.
- `decide.ts::rankMoves` weights moves by *expected objective movement* (using `contextualForecast` P(success|situation,action)), not just the static priority ladder.
- `narrate.ts` reports objective progress in the daily letter: "first-reply time 4.2h → target 2h, the support play moved it 1.1h this week."
- Objectives are set in **Your Voice** (`standingOrders.ts`) — the founder declares targets; the system decomposes them into plays. This turns "operate the business" into "move these N numbers," which is what makes autonomy *measurable* and therefore *grantable*.

- **Acceptance:** objectives table + planner weighting + letter reporting; objectives editable from `/founder/autopilot/voice`; pure forecast-weighted ranking unit-tested.

---

## Phase 6 — Founder UI: 88 doors → 4 doors + 1 instrument panel

*The clutter is not cosmetic. Every extra door is a place the system asks the founder to be the operator. Autonomy must reduce surface, not add to it.* The customer side is disciplined to five fixed doors by CLAUDE.md rule; the founder side has had no such discipline and has 88 routes (32 already dead redirects, ~10 overlapping "overview" pages).

### Target IA — four primary doors (mirroring the five-door customer discipline):

1. **The Letter** (`/founder/autopilot`) — the home. What happened, what it decided, what it needs you for, what's working. 90% of days: read and close. Absorbs `/founder/today`, `/now`, `/feed`, `/command`, `/bridge`, `/daily-digest`, `/letter`, `/steering`, `/cockpit` — the ~10 overlapping overviews collapse into one.
2. **Decisions** (`/founder/decisions`) — the ONLY place the founder is a required participant: witnessed-send queue + asks + appeals + recourse. Absorbs `/asks`, `/appeals`, `/recourse`, `/agent-queue`, `/dispatches`, `/market-reports` (draft review).
3. **Controls** (`/founder/autopilot/control`) — master switches, per-domain Trust Ledger, budgets, **objectives + Your Voice**, per-hand kill switches. Absorbs `/voice`, `/features`, `/keys`, `/trust-graduation`, `/studio`, `/providers`.
4. **Story** (`/founder/autopilot/story`) — glass-box audit timeline, for verifying not operating. Absorbs `/traces`, `/event-log`, `/governance`, `/memory`, `/prompt-*`.

### Everything else → `/founder/admin/*` instrument namespace
The ~22 deep panels (telemetry, costs, ETL, ml-snapshots, unit-economics, paid-data-eval, recovery-console, inspector, etc.) move under one `/founder/admin` index — visited deliberately, never competing for daily attention. `FounderAllToolsPage` becomes that index.

### Cleanup debt
Delete the 32 dead redirect routes + their stale page bundles once inbound links are updated (ratchet: a test asserting no `/founder/*` route resolves to a redirect-only component). Remove `founder-dashboard.DELETED.bak` references per CLAUDE.md.

- **Acceptance:** four primary doors + one admin index; the 10 overview pages genuinely merged (not just re-linked); dead routes deleted with a guard test; nav model documented in CLAUDE.md the way the five customer doors are; viewport/pointer/theme parity verified (elite-multi-dimensional standard).

---

## Dependency order (the critical path)

```
Phase 0 (harness + senses + outcome ledger)   ← EVERYTHING depends on this
   ├─ Phase 1 (comm limb)            ← needs 0.1 harness, 0.2 senses
   │     └─ Phase 3 (lifecycle)      ← composes Phase 1 + dealActions
   ├─ Phase 2 (money limb)           ← needs 0.2 revenueSense
   │     └─ Phase 4.3 (attribution)  ← needs Phase 2 conversion signal
   ├─ Phase 4 (growth/ads)           ← needs Phase 2 economics + 4.3 attribution
   ├─ Phase 5 (objectives)           ← needs 0.3 outcome ledger + contextualForecast
   └─ Phase 6 (UI consolidation)     ← independent; can run in parallel any time
```

**Recommended sequencing:**
1. **Phase 0** in full (the foundation — no outward risk).
2. **Phase 6** in parallel (UI consolidation is independent and reduces operator burden immediately, pre-customer).
3. **Phase 1** comm limb (highest leverage, compliance already built, lowest new risk).
4. **Phase 5** objectives (makes everything measurable).
5. **Phase 2** money limb (highest business value — but only meaningful once a customer exists).
6. **Phase 3** lifecycle (composes 1+2).
7. **Phase 4** growth/ads last (highest blast radius; earns autonomy slowest).

---

## What "99.9% self-operation" actually requires (honest, pre-customer)

1. **You cannot reach 99.9% on zero data, and that's correct.** Autonomy is *earned* through the Trust Ledger; with no customers there are no clean cycles to promote on. The pre-customer goal is **readiness to earn**: a loop that *can* close end-to-end the instant customer #1 lands. Phases 0–1 + 6 deliver exactly that.
2. **The loop must be closeable, not closed.** One real witnessed loop (Phase 1.1 email) proves the whole machine works against the outside world. Until one loop genuinely closes, everything upstream is simulation.
3. **Perception before action.** Phase 0.2 (outward senses) matters more than any single hand — a hand that acts blind can't learn. Build the senses first.
4. **Objectives before broad autonomy.** Autonomy toward *nothing* is just activity. Phase 5 gives the system numbers to be autonomous *toward* — and gives you a way to judge whether it's earning trust.
5. **Surface shrinks as trust grows.** Phase 6 is the physical expression of autonomy: the more the system does, the fewer doors you need. A self-operating business needs you to have *fewer* places to look, not 88.

The shape to keep in view: today the loop is `sense → decide → [FOUNDER] → measure`. Every phase here is about replacing that `[FOUNDER]` bottleneck — first with a witnessed tap (you stay in the loop but the work is drafted), then, as each domain earns it on real outcomes, with a gated autonomous hand. The founder becomes the **bottleneck-of-last-resort**, not the daily operator.

---

## Invariants (must survive every phase)

- **Three-lock dormancy:** no outward action without (domain past OBSERVE) AND (`dispatchEnabled`) AND (witnessed-send tap, until AUTONOMOUS_GATED). Independent locks.
- **No path around the wall:** witnessed-send is a wall with doors, never holes. Every hand proven by a `policyGate`-style escalation test.
- **Compliance is the service's job, not the hand's:** hands call existing services (`sendEmail`, `sendOrgSMS`) that already enforce CAN-SPAM/TCPA/suppression. Hands never reimplement send logic.
- **Truth-ratchet holds:** outcome derivation never invents signal; attribution is a lower bound and never feeds the learning loop as ground truth.
- **Irreversible/high-blast-radius escalates regardless of domain trust:** `riskautonomy.ts` gates on reversibility/value/novelty, not just domain. Ad spend and refunds earn autonomy last.
- **Every hand is individually kill-switchable** from the Control Center.
```
