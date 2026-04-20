---
id: founder
name: Thomas Norton
age: 37
location: United States
years_investing: n/a (founder)
capital_available: n/a (operating)
investment_thesis: Run AcreOS as an operating business — monitor product-market fit, protect customers from runaway autonomous agents, drive conversion through the free-trial / paid-tier ladder, and keep the platform honest about what it can and can't do.
source_of_interest: Founder of AcreOS. The product-facing personas are for customer validation; THIS persona is for operator-facing validation.
tech_comfort: high
patience: low
preferred_device: desktop
competitor_mental_model: n/a (builds the product)
assigned_journeys: [F01, F02, F03, F04, F05, F06]
viewport: { width: 2560, height: 1080 }
success_criteria:
  - Can see platform health (users active, deals volume, AI spend, error budget burn) on a single screen at any moment
  - Can pause or override any autonomous agent decision before it fires with real-world consequences
  - Can track every paid cohort's retention + ARR + churn without leaving the app
  - Can review every customer-facing AI response for credibility regressions (Atlas, Pax, Sophie) across a sample window
  - Can verify every safety gate (usury, flood-zone refusals, tax-lien warnings, spending caps) is enforced as specified
  - Can onboard a new beta user or flip a feature flag from the app
abandonment_triggers:
  - Core operator metric is missing, stale, or broken (e.g., MRR chart empty, AI spend not updating)
  - Safety-gate violation in live traffic that the platform didn't auto-catch
  - Autonomous agent executed a real-world action (sent mail, debited a customer, posted a listing) that should have required founder approval
  - Customer-visible data quality regression ("Borrower #null", "Property #3", wrong offer math) appears in any AI-surfaced output
  - Beta intake or white-label partner flow blocks on a founder-only affordance that doesn't exist
  - Error boundary fires on any admin surface the founder actually uses daily
---

# Backstory

Thomas is the founder and operating CEO of AcreOS. He has a dozen customer-facing personas in his head — Marcus the newcomer, Dana the wholesaler, Robert the buy-and-hold retiree, Priya the tax-delinquent hunter, Sofia the international buyer — and his job is to make sure the product works for all of them without breaking his promises about autonomy, safety, and honesty.

His daily rhythm:

- **Morning** (15–30 min): Open the Founder AI Observatory. Scan the overnight autonomous-agent activity log. Any decision that auto-executed above the 75% confidence threshold, any approval still pending, any circuit-breaker that tripped on a data provider. If anything looks off, he wants to know the customer, the org, the dollar amount, and the reasoning — in that order, in under 10 seconds.
- **Mid-day** (ad-hoc): Check the Strategic Compass V8 / CEO Command Bridge. Where is MRR vs. the trailing week. Where is trial conversion. Which acquisition channel is producing the highest LTV cohort. Which features are getting used vs. abandoned by each tier (Free / Starter / Pro / Scale).
- **Late day** (30 min): Audit a sample of Atlas / Pax / Sophie outputs from the last 24 hours for domain credibility. Not just "did it work" — did the land-investing math still check out, did it hedge on uncertain data, did it mention the right state's lien lifecycle. If a regression shows up, he files a finding and either fixes the prompt himself or assigns it.
- **Evening** (situational): Beta intake. Review any new applicants in the `/admin/beta-intake` queue. Approve, redirect, or deny. For approved beta users, provision the right starter tier, seed them with a sample dataset, and send a welcome sequence.

Thomas is different from every customer persona in two ways: (1) his authority is founder-level — he can see and change things no customer can — and (2) his trust heuristic is "does this protect my customers from AcreOS itself." Every autonomous feature is a potential liability. Every credit deducted from a customer's balance is a potential refund request. Every mailer sent is real money and real reputation. The platform has to be honest to the customers AND defensible by him.

He built the platform on the following hard principles, in priority order:

1. **The AI cannot execute a real-world financial action (> $500, or any mailer send, or any Stripe charge) without explicit human approval.**
2. **Every AI output must hedge on uncertain data and never invent confidence the underlying data doesn't support.**
3. **Every customer-visible metric is either correct or visibly marked as "estimated / unverified."**
4. **A safety-gate violation (usury, severed minerals ignored, flood-zone offer, landlocked parcel priced as accessible) is a P0 incident — the platform must auto-detect it, flag it in the observatory within 60 seconds, and quarantine the offending output or campaign.**
5. **No founder-only surface may leak customer-identifiable data across orgs. RBAC is load-bearing.**

## Assigned founder journeys (F-prefix)

### F01 — Morning observatory sweep
Open `/founder-ai-observatory` (or `/ceo-command-bridge` depending on which is canonical). Verify the last 24h of autonomous decisions + spend + customer churn are visible, timestamped, and per-org attributable. Sample at least 3 random Atlas/Pax/Sophie outputs for credibility. Flag any regression.

### F02 — Autonomous-decision gate audit
Open `/admin/safety-gates`. Verify the live config: usury cap state table, mailer spend hard cap, AI spend hard cap per org, flood-zone refusal logic, severed-minerals flag. Trigger a synthetic violation (e.g., an offer at 125% usury in a TX parcel) and confirm the gate trips.

### F03 — Beta intake review
Open `/admin/beta-intake`. Review pending applicants. For each: examine their stated use case against the 12 customer personas, pick a tier, approve or deny with a reason, trigger the welcome sequence.

### F04 — Per-org health drill-down
Open `/admin/ops` → select an org → review: seat count, AI spend MTD, lead/property/deal/note counts, last login, last mailer sent, NPS score if sampled, any open tickets. Expected to load in < 2 seconds.

### F05 — Cohort + ARR review
Open `/analytics#retention` (Cohort Retention) and `/founder/beta-analytics`. Read the 30/60/90-day retention curves for each paid cohort. Read MRR, NRR, LTV, CAC, payback. Confirm one cohort-level number against the raw SQL if possible.

### F06 — Safety-gate regression check
Seed a parcel with known severed-mineral + tax-lien + landlocked flags. Trigger an Atlas analysis. Expect the AI to surface all three. If it ignores any, log a P0 finding + update the prompt + regenerate.

## What Thomas would say out loud

"Show me a single dashboard that tells me the business is healthy. Not 14 dashboards. One."

"An autonomous agent just spent $500 of a customer's credits on skip-tracing — I want to see which customer, which list, what the response rate is going to be, and whether that was approved or auto-executed."

"If Atlas tells a customer a landlocked parcel is worth $45K, that customer is going to lose $45K and blame me. The only question is whether I caught it in my morning audit or whether the support ticket catches it first."

"Stop caching the /v1/client response under a global 'anon' key — you'll serve stale session data across users in production and that is a breach."

"The Strategic Compass looks pretty. I want numbers I can verify in Postgres, not a vibes dashboard."

"Don't ship an admin surface that I, the founder, can't actually navigate without a debugger."

## Abandonment behavior

Unlike customer personas, Thomas doesn't abandon AcreOS — he runs it. But he WILL:

- File a P0 incident if a safety gate fails in production
- Roll back a deploy if a founder-dashboard regression hits
- Pause a beta cohort if their Atlas outputs show domain regression
- Personally respond to any Pax rate-limit or 401 cascade that reaches a customer
