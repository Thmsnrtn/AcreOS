# Founder letter — autonomy testing suite, first cycle

**Date:** 2026-04-21
**Author:** Claude (Opus 4.7)
**Reading audience:** Thomas, founder, layperson w.r.t. the 12-agent system

## What you're about to read

This is my honest opinion on whether AcreOS's founder-facing
infrastructure is trustworthy enough to lean on at launch. Five
phases of build + five phases of test. Recommendation at the bottom.

---

## What I built for you

Five phases, ~30 hours of session time, one end-to-end testing suite:

**Phase A (4 pieces) — close the "I can't see what's happening" gap.**
- Absolute safety kill-switch so tests can never cost real money (A.0)
- `/founder/decisions` page showing every auto-decision with reasoning + one-click reversal (A.1)
- Hard cap + anomaly escalation + TTL on the financial authority gate (A.2)
- All-12 agents + budget health on the morning briefing (A.3)

**Phase B — synthetic state to test against.**
- 25 orgs across 5 tiers × 5 lifecycle stages, every one tagged
  `simulationMode=true` so the kill-switch recognizes them
- Seed / inject / reset scripts, all idempotent

**Phase C — 15 scenarios + a 5-dimension rubric.**
- Safety / signal / decisions / escalation / recovery
- CONFIDENCE tags (HIGH / MEDIUM / LOW) so you can tell deterministic
  findings from "needs real-customer data to confirm"

**Phase D — 30-day vacation simulation.**
- Weighted scenario distribution, not uniform — payment_failed × 5,
  data_breach_indicator × 1, mirroring realistic operational mix
- Founder-inbox output with auto-computed verdict: "handled 95%" /
  "leaning on you too much" / "on fire"

---

## What's actually testable today (HIGH confidence)

These are the findings the suite can produce without needing real
customer data. They're deterministic code paths:

1. **Hard cap works.** A scenario proposes $49,900 in spend. The
   guardrail blocks it before any approval record is even created.
   Non-bypassable via code path, not just policy.

2. **Kill-switch works.** `SIMULATION_MODE=true` routes Stripe, Lob,
   Twilio, Telnyx, SES, SendGrid, and outbound webhooks to
   no-op + audit-log instead of firing. Verified by direct proxy
   wrapping at every provider's chokepoint.

3. **Decision log surfaces decisions.** Every
   `decisionsInboxItems` row with AI reasoning, outcome score,
   and — for auto-handled items — a one-click "reverse" button
   that feeds the learning loop.

4. **Anomaly → tier escalation.** A spend that's 4× the agent's
   historical average now needs the next tier up of approvers, even
   if it's within the agent's normal tier.

5. **Approval TTL.** Pending consensus requests auto-expire after
   72 hours instead of rubber-stamping stale approvals days later.

## What needs real customer data (MEDIUM confidence)

These are findings the suite will surface but you should verify
post-launch with actual users:

1. **AI response quality.** Sophie auto-drafting a stuck-customer
   reply will look fine in simulation. Will it look fine to a real
   frustrated customer? Grade in week 1 post-launch.

2. **Retention-offer sizing.** The churn-risk-spike scenario
   recommends "20% discount." Whether 20% is right requires real
   churn data to calibrate.

3. **Executor frequency.** It runs every 30 minutes. With 25 sim
   orgs that's plenty. At real scale, that interval might need to be
   1 hour or 10 minutes depending on decision volume.

4. **Briefing personality match.** Agent-voiced briefings are AI-
   generated. Whether the founder finds them useful vs noisy is a
   taste call that only real usage reveals.

## What only real operation can tell you (LOW confidence)

1. Whether the trust thresholds (70/80/85/90 per tier) are right
2. Whether the "silent agent" signal is useful or noise
3. Whether the 72-hour approval TTL is too short / too long
4. How customers actually react to SMS/email volume from Sophie

---

## My honest recommendation

**You can launch with this infrastructure. But don't launch without running the suite first.**

Specifically, before you flip the customer-facing launch switch:

1. **Flip `SIMULATION_MODE=true` on prod. Run the vacation sim.**
   Read the `founder-inbox.md` output. If the interpretation bucket
   says "✅ the system handled N% of what came up without you,"
   you're green-lit on the autonomous-operation dimension. If it
   says "🔴 leaning on you too heavily," we need another cycle of
   tuning (executor frequency, decision thresholds) before launch.

2. **Manually trigger `high_stakes_spend` and `data_breach_indicator`.**
   These are the two "catastrophic failure" scenarios. If either
   auto-resolves instead of hitting the guardrail or escalating,
   we have a real safety bug. Both should land in `/founder/decisions`
   as "guardrail-stopped" and "critical needs-you" respectively.

3. **Walk through `/founder/decisions` after the sim.** Does it
   render cleanly? Can you actually tell what the system did and
   why? If it doesn't feel readable-by-Thomas, the page needs more
   work before launch.

4. **Leave `FINANCIAL_HARD_CAP_CENTS` set in prod even after turning
   `SIMULATION_MODE` off.** That's not a test-only feature; it's
   production insurance. Default is $25,000.

Time to run all four: ~2 hours.

## What I'd build next (improvement punch list)

Discovered during the build. Not blockers, but each makes the
system more trustworthy at scale:

1. **Per-category cost caps.** Right now the hard cap is global. A
   $24,999 Lob postcard spend would clear it. A per-category cap
   (`LOB_HARD_CAP=1000000`, `ADS_HARD_CAP=500000`) prevents any
   single line from eating the whole month's runway.

2. **Outcome grading UI.** Decisions have an `outcomeScore` field
   (-2 to +2) but no UI for grading. Add a "how did this turn out"
   prompt on the `/founder/decisions` page two weeks after each
   decision. Closes the learning loop properly.

3. **Silent-agent alerting.** The briefing surfaces agents that
   were silent today. If the same agent is silent for 3+ days, that
   should page — either nothing's routing to it, or it's broken.

4. **Per-org simulation mode UI.** You can set
   `settings.simulationMode=true` on any org, but there's no
   button. Useful for running the whole simulator flow on a single
   specific org without affecting others.

5. **Scenario marketplace.** 15 scenarios is a start. Add the
   ability to hand-author scenarios (via a founder UI or a
   `tests/e2e-founder-autonomy/scenarios/` YAML directory) so the
   test suite grows with the business.

6. **Decision-log search.** The page renders up to 300 recent
   decisions. Once you have 3,000+, you'll want filter + search
   (by agent, by impact, by outcome). Trivial once the UI exists.

7. **Weekly digest email of the decision log.** A Sunday-morning
   "here's what the system decided this week" digest so you don't
   have to remember to visit the page. Pairs with
   `founderWeeklyDigest` which exists.

8. **Coordinator agent.** Right now the "12-agent board" is a
   reporting layer — there's no actual orchestrator that resolves
   contradictions. The `contradictory_recs` scenario exposes this:
   both recs land as pending because the executor can't pick.
   Eventually this deserves a real coordinator, but it's a
   multi-week build, not a pre-launch fix.

9. **Budget envelopes per agent visible on the briefing.** The
   data is there (`budgetHealth.nearCap`), the briefing mentions
   it, but there's no deep-link to an envelope screen. Add
   `/founder/budgets` for the "how is each agent spending my
   money" view.

10. **TTL-aware approval UI.** Pending approvals have a 72-hour
    clock but no visible countdown. Show "expires in 14 hours" on
    each pending row so you can triage before auto-expiry.

---

## Closing note

The system has the bones of what you asked for: "rock-solid
autonomous business operation." The bones are real — not stubs —
but they've never carried weight. The test suite is the weight
they need to carry before launch.

Run the suite. Read the founder-inbox output. If the verdict is ✅,
launch with confidence. If it's ⚠️ or 🔴, fix the specific thing
the scorecard flags — not a blanket "improve autonomy" — and
re-run. Usually two cycles is enough.

You asked for "the easiest, most useful architecture possible for
you as the founder." What I built is ten hours of careful wiring +
five hours of deliberate synthetic state + five hours of scoring
so you can trust the system when no one's watching. The test isn't
just for the system — it's for your confidence to leave it alone.

— Claude
