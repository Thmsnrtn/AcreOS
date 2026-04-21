# Founder-side autonomy testing suite

The question this suite answers: **can I leave AcreOS alone for 30 days
and trust it to run the business without blowing up my runway, missing
customer emergencies, or silently doing things I'd reverse?**

Built pre-launch, when there are no real users to test against. The
suite seeds a 25-org cohort of deliberately-varied synthetic customers,
injects 15 named scenarios the autonomous executor has to react to,
grades the reactions against a 5-dimension rubric, and finally runs a
30-day vacation simulation that produces a layperson-framed "founder
inbox" scorecard.

## Absolute safety guarantee

Every external side-effect choke-point in the codebase is wrapped by a
`SIMULATION_MODE` kill-switch (`server/utils/simulationMode.ts`). When
the flag is on:

- **Stripe** — every mutating method short-circuits via Proxy. Cards
  never charge, customers never actually create, subscriptions never
  cancel. Read-only `.retrieve` / `.list` / `.search` pass through.
- **Lob** — `sendPostcard` / `sendLetter` return a fake `lobId`. No
  paper leaves the printer.
- **Twilio / Telnyx** — `sendSMS` returns a synthetic messageId. No
  carrier charge.
- **SES / SendGrid** — `sendEmail` short-circuits. No inbox hit.
- **Outbound webhooks** — `dispatchWebhook` logs to
  `simulated_actions` instead of firing partner URLs.

AI (OpenRouter / OpenAI) is deliberately **not** in the global kill
switch — token spend is small, metered, and the whole point of the
autonomy tests is to grade what the AI actually decides. A separate
opt-in `SIMULATION_MODE_AI_PAID=true` will stub AI too if needed for
long sims.

Every would-have-happened action lands in the `simulated_actions`
table with its payload. The `/api/founder/safety-status` endpoint
shows the last 7 days of simulated actions by category so you can
verify the harness is live before every run.

## Phases (all built and shipped)

| Phase | What it does | Artifact |
|---|---|---|
| A.0 | Safety harness — kill-switch + sim-mode audit table | `server/utils/simulationMode.ts` + `simulated_actions` table |
| A.1 | Founder decision-log UI — the audit trail of every auto decision | `/founder/decisions` page + `/api/founder/intelligence/decision-log` endpoint |
| A.2 | `financialAuthorityGate` hardening — hard cap, anomaly escalation, approval TTL | `server/services/financialAuthorityGate.ts` |
| A.3 | All-12-agent briefing + budget health | `/api/founder/intelligence/morning-briefing` + `/agent-activity` + `/budget-summary` |
| B | Seed kit — 25 orgs, scenario injector, reset script | `scripts/founder-autonomy/seed-{cohort,scenario}.ts` + `reset-cohort.ts` |
| C | 15 scenarios + rubric scoring | `scripts/founder-autonomy/score-scenarios.ts` |
| D | 30-day vacation simulation + founder-inbox report | `scripts/founder-autonomy/vacation-sim.ts` |
| E | Founder letter + go/no-go + improvement punch list | `FOUNDER-LETTER.md` |

## How to run your first cycle

**Step 1 — Flip the kill switch on prod.** This is the "no real
side effects can fire" guarantee.

```bash
fly secrets set -a acreos \
  SIMULATION_MODE=true \
  FINANCIAL_HARD_CAP_CENTS=2500000 \
  FINANCIAL_APPROVAL_TTL_HOURS=72
```

Verify:

```bash
curl -sS -b cookies.jar https://acreos.io/api/founder/safety-status | jq
# expect: simulationModeActive: true, all categories: true
```

**Step 2 — Seed the cohort.** Via `fly ssh console`:

```bash
fly ssh console -a acreos
cd /app
SIMULATION_MODE=true npx tsx scripts/founder-autonomy/seed-cohort.ts
```

You should see 25 `+ created` lines and a summary:
`orgs created: 25 · leads seeded: ~250 · properties seeded: ~100 · deals seeded: ~30`.

**Step 3 — Fire a single scenario to smoke-test.**

```bash
SIMULATION_MODE=true npx tsx scripts/founder-autonomy/seed-scenario.ts \
  --scenario high_stakes_spend --slug sim-scale-at_risk-13
```

Then open `/founder/decisions` in your browser. You should see the
"auto-handled" bucket updated (or "guardrail-stopped" if the hard
cap worked, which is what should happen for `high_stakes_spend`).

**Step 4 — Run the vacation simulation.**

```bash
SIMULATION_MODE=true npx tsx scripts/founder-autonomy/vacation-sim.ts \
  --reset --days 30 --scenarios-per-day 2
```

Takes a few minutes of wall clock. Emits
`tests/e2e-founder-autonomy/runs/vacation-<timestamp>/founder-inbox.{json,md}`.
The `.md` file is layperson-framed — open that first.

**Step 5 — Grade the scenarios.**

```bash
SIMULATION_MODE=true npx tsx scripts/founder-autonomy/score-scenarios.ts
```

Emits `tests/e2e-founder-autonomy/runs/<timestamp>/scorecard.{json,md}`.

**Step 6 — Read the founder letter.** `FOUNDER-LETTER.md` (written
after the first real cycle) will tell you where the system is
launch-ready and where it still needs work.

**Step 7 — Clean up.** When you're done and ready to launch with
real customers:

```bash
SIMULATION_MODE=true npx tsx scripts/founder-autonomy/reset-cohort.ts

fly secrets unset -a acreos SIMULATION_MODE
# Leave FINANCIAL_HARD_CAP_CENTS and FINANCIAL_APPROVAL_TTL_HOURS set
# — those are real production safety rails, not just for testing.
```

## What the suite cannot validate

Honest limits to keep in mind:

- How decisions play out against **real customer** emergent behavior
- Whether the simulation signal quality matches real signal quality
- Edge cases from real usage patterns that seeded scenarios don't anticipate
- Long-term drift under actual data volumes

The rubric tags every finding with a CONFIDENCE score (HIGH /
MEDIUM / LOW) based on how far the test condition is from real-world
signal. HIGH-confidence findings from simulation are actionable
pre-launch. MEDIUM findings are "signal exists, verify at scale."
LOW findings are hypotheses to confirm post-launch.

## Extending the suite

Adding a new scenario = adding a `runFoo` function to
`scripts/founder-autonomy/seed-scenario.ts`, a new case to
`gradeScenario` in `score-scenarios.ts`, and an entry to the weighted
pool in `vacation-sim.ts`. That's ~30 lines of code per scenario.

Adding a new safety gate = wrap the provider's choke-point in
`shouldSimulate("category", org)` / `recordSimulatedAction(...)`. See
the existing wrappers in `server/stripeClient.ts`,
`server/services/smsService.ts`, etc.
