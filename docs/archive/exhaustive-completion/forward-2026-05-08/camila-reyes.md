# camila-reyes — Customer Success & NPS Architect

**Reading list:**
- `docs/exhaustive-completion/post-may1-resweep.md` (RS-4, RS-5, RS-6, RS-7 shipped; customer-side security surfaces now live)
- `server/services/customerHealthScoring.ts` (health score implementation, 0–100 scale)
- `server/services/onboardingAutonomy.ts` (D0–D30 journey handlers; email transport is now wired, 2026-05-08)
- `docs/exhaustive-completion/elite-team-deep-2026-05-01/camila-cs.md` (original audit: two parallel health systems, zero email transport, no NPS loop)

**State read (1 paragraph):**
The transport layer is now wired. `onboardingAutonomy.ts` handlers fire real emails (D0, D1, D3, D7, D14, D30) after the RS-1..RS-7 sprint. The health-scoring formula unified into `customerHealthScoring.ts` with event-driven recompute. What's missing is the *branching* at the end of the journey: D30 activation verdict classifies customers as `active` / `at_risk` / `churned` but the three diverging email branches (power-user unlock, pre-churn ladder, win-back sequence) are half-built. Camila's 2-week CS sprint is now a 1.5-week sprint because email transport is no longer the blocker. The real work: *closing the loop between health scores and customer-visible action.* The customer still has no `/account/security` page, no in-product NPS survey, no power-user identification dashboard. Sophie knows who's about to churn; the customer doesn't. That asymmetry is the gap.

**Push forward — my 5 moves (ranked):**

1. **Ship the D30 activation verdict branching (active / at_risk / churned)** — three email sequences, conditional on health score band. `active` → "unlock advanced features" email + Feature-Flags toggle for Deal-Hunter + mailer campaigns. `at_risk` → "quick 15-min call?" with Calendly link and real-human assurance. `churned` → single-question survey ("what didn't work?") with no hard sell. 2d build, unblocks the entire CS funnel from pre-churn through win-back. — *Why now: we're shipping customer surfaces (RS-4, RS-5) in the same sprint; activation verdict is the feedback edge that lets CS act on data the customer sees.*

2. **Commit to 3 customer calls per week, forever** — this is the only moat at pre-launch. Founder calls 3 customers weekly (power-user, at-risk, newly-activated). Sophie pre-screens and suggests. Record + synthesis into `customer_interviews` table. Monthly clustering on Sophie generates product roadmap input. It's discipline, not infrastructure — but document it as a standing sprint item so it never gets bumped. — *Why now: post-launch roadmap decisions are made in isolation unless there's a feedback loop; the loop is three human conversations a week.*

3. **Ship `/admin/power-users` dashboard + nightly cohort query** — query: HealthScore ≥80 for 14 consecutive days AND used ≥5 features in last 7d AND 10+ artifacts generated AND 5+ logins in last 7d. Surface as a table with cohort comparison ("power users did X first, at-risk users did Y"). Friday Sophie digest clusters patterns. 1d build, this is the data that drives the rest of CS forward. — *Why now: expansion revenue targets power users; without identifying them, we're guessing at who to ask for upsells.*

4. **Implement in-product NPS micro-survey (D7 trigger, not D14)** — backend exists; UI doesn't. One slider 0–10, one open-text field, fires on D7 when value memory is fresh. Dismissible, one-shot per-user, persisted. Wire into the customer-health scoring so NPS response moves the score immediately. — *Why now: we measure NPS via email forms today (low response rate). In-product capture at the value-moment captures sentiment when it's real, not 3 weeks later.*

5. **Pre-churn ladder automation (5d → 10d → 14d → 21d → 30d no-login escalation)** — wire into unified health score "Watching" / "At-risk" / "Critical" bands. Each tier conditional on prior not converting (soft email doesn't fire if user already returned on day 6). This is the layer Mireille will push back on — she'll say "build growth loops, not customer success ops." But churn prevention is the growth loop we have today; loops are month-3+ work. Ship the ladder now, measure what converts. — *Why now: first customers are landing now; the ones who don't come back in week 2 are the ones we lose forever unless we close the pre-churn gap.*

**What I'd defer (and why):**
- Estate-executor review queue (RS-8) until a real founder asks for it (it's a founder-side feature; customers don't see it yet)
- Chat-bot escalation layer until support volume justifies it (pre-launch, every customer is a phone call; chatbots are month-2+ scaling work)
- CSM hiring trigger until we hit $50K/mo net MRR (the automation above does CSM work; a human CSM becomes ROI-positive only past that threshold)

**What scares me most:**
Mireille's right that loops > CSM. But we're a vertical SaaS at 5 customers, not a horizontal platform at 50K signups. The growth loops (referral, shared deal-rooms, network effects) are year-one work; churn prevention is week-one work. I'm not arguing against loops — I'm arguing for doing churn prevention now so we have a base to loop from. Mireille will say "growth loops are the only thing that scales past $100M." True. But growth loops on a 50% churn base is just pouring water into a bucket with a hole. Plug the hole first (3 weeks of work above), *then* build the loop. The winning move is both, in sequence, not either/or.

— Camila
