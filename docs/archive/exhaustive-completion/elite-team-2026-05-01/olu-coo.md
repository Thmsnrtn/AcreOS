# Olu Adebayo — COO audit (incoming)

**Lens:** scaling pain is operations failing in advance. Every customer-growth spike surfaces ops debt accumulated in the prior six months. I'm reading AcreOS as the COO who'd take the call at 2am when something breaks at 50 customers.

**Headline judgment:** AcreOS has a *remarkably* sophisticated agent layer doing ops work — Sophie auto-resolves >90% of tickets, the churn engine scores nightly, the onboarding journey is scripted day-by-day, the Operations Agent replaces an on-call engineer for data-source health. This is genuinely above-bar for pre-launch SaaS. The gap is not "ops automation" — it's the **fallback layer**: what happens when the agent is wrong, when a vendor goes down, when a customer hits a path no playbook covers. At 5 customers Thomas absorbs that personally. At 50 he won't be able to, and there is no second human in the loop today.

---

## 1. Founder bottleneck inventory

Surfaces today that **require the founder personally** (not the agent layer, not a teammate):

| # | Bottleneck | Where it lives | Why it's the founder |
|---|---|---|---|
| 1 | Escalated support cases (anything Sophie + Sophie-Genius can't auto-resolve) | `/admin/support` (admin-support.tsx) — escalated cases queue | No second human; founder is the entire L2 |
| 2 | Decisions inbox (`decisionsInbox.ts`) — borderline tickets Opus second-opinion couldn't close | `/admin/decisions` | Same — single reviewer |
| 3 | Safety-gate breaches before agent action | `/admin/safety-gates` (safety-gates.tsx) | Gate review is single-approver |
| 4 | "What needs you" todo on `/founder-home` | `useFounderTodo` → `/api/founder/intelligence/todo` | Aggregates everything that escaped automation |
| 5 | Beta intake / waitlist approval | `/admin/beta` (beta-intake.tsx, beta-dashboard.tsx) | Founder gates each beta slot |
| 6 | P0 + P1 alerts — `alertPolicy.ts` routes to single `FOUNDER_EMAIL` | server/services/alertPolicy.ts | Every infra alert goes to one inbox |
| 7 | Vendor outage triage (Stripe/Twilio/SES/Lob/OpenAI/Anthropic) | No surface — implicit | No vendor-status dashboard surfaced for non-engineers |
| 8 | GDPR delete / data-export requests | `gdprService.ts` exists but no admin UI | Manually invoked by founder |
| 9 | Account-merge / org-merge requests | `storage.mergeLeads` exists; no org-merge UI | Manual |
| 10 | Refund / dunning override | `dunning.ts` runs auto, overrides are manual | Stripe dashboard, not in-app |
| 11 | Trial extension on case-by-case basis | trial expiry is automatic, no extension UI | Manual via DB / Stripe |
| 12 | Founder-flagged onboarding journeys (`onboardingAutonomy.ts` lets founder flag a journey for personal attention) | `/founder/onboarding` | By design; doesn't scale past ~5 flagged at once |

**The pattern:** the agent layer handles the *common* path beautifully. Every *uncommon* path lands on Thomas. At 5 customers there are maybe 2–3 uncommon-path events per week. At 50 customers, with the same agent quality, that's 20–30 per week — roughly one per business hour. That's a full-time job, not a founder activity.

---

## 2. Support tooling — current vs. needed at 50

**Current (genuinely strong for pre-launch):**
- Sophie auto-resolver with confidence thresholds (`SOPHIE_CONFIDENCE_MODE` env: conservative=90 / balanced=70 / aggressive=60)
- Sophie Genius Mode (Opus) for borderline 40–89% confidence cases
- Decisions inbox catches the residual; founder reviews
- `/admin/support` has SLA tracking (on_track / at_risk / breached), priority badges, full conversation history, single-textarea reply with "send & resolve"
- `supportBrain.ts` does classification (category, confidence, sentiment, urgency)
- `support-playbook.md` documents top-10 canned responses for the human reviewer

**Gaps that bite at 50:**
1. **No customer-side ticket UI surfaced on the front-of-house** — "support" page is 12 lines, basically a stub. Customers route through email/Pax chat; there's no "my tickets" view. At 50 customers asking "did you get my message?" 3x/day is real cost.
2. **No internal macros / saved replies in admin-support** — every human reply is typed fresh. The playbook is in markdown, not in the textarea as a dropdown.
3. **No tagging / categorization editable by humans** — Sophie classifies; humans can't reclassify after the fact, so reporting on "actual" categories rots.
4. **No customer-context sidebar in admin-support** — opening a case doesn't show their plan, MRR, days-since-signup, last 5 actions, churn risk band. Reviewing requires a second tab.
5. **No "assign to" field** — even if a second human joins, there's no ownership concept on a case.
6. **No CSAT capture post-resolution** — `metrics.avgSatisfaction` is computed but I see no surface that prompts the customer for it.
7. **Reply channel is single (textarea)** — no email-vs-in-app branching, no SMS reply, no escalation-to-call.

---

## 3. Runbook gap — top 10 ops events

Status of written runbooks for the events most likely to fire in the 5→50 stretch:

| # | Event | Runbook status | Notes |
|---|---|---|---|
| 1 | Stripe webhook stops firing | **WRITTEN** | `docs/runbooks/stripe-webhook-stopped.md` |
| 2 | DB migration failed | **WRITTEN** | `docs/runbooks/db-migration-failed.md` |
| 3 | AI quota exceeded (OpenAI/Anthropic) | **WRITTEN** | `docs/runbooks/ai-quota-exceeded.md` |
| 4 | Redis connection lost | **WRITTEN** | `docs/runbooks/redis-connection-lost.md` |
| 5 | Runaway background job | **WRITTEN** (twice — `runaway-job.md` + `runaway-background-job.md`) | Dedupe these |
| 6 | Deal-hunter blocked | **WRITTEN** | `docs/runbooks/deal-hunter-blocked.md` |
| 7 | Valuation model drift | **WRITTEN** | `docs/runbooks/valuation-model-drift.md` |
| 8 | Data breach response | **WRITTEN** | `docs/runbooks/data-breach-response.md` |
| 9 | Failed customer payment / dunning escalation | **PARTIAL** | `dunning.ts` automates; no human-side runbook |
| 10 | E-sign stuck (`native esign` per memory) | **NOTHING** | Can't find a runbook |
| 11 | Mailer bounce / Lob direct-mail returned | **NOTHING** | `mailProvider.ts` exists; no runbook |
| 12 | Twilio SMS delivery failure / 10DLC reject | **NOTHING** | Top reason new SaaS gets brand-blocked |
| 13 | Clerk auth outage / SSO break | **NOTHING** | Critical — blocks 100% of customers |
| 14 | Cloudflare DNS / proxy outage | **NOTHING** | Per memory, this is the auth path |
| 15 | Fly.io region outage | **PARTIAL** | `disaster-recovery.md` covers DB, not regional |
| 16 | Customer requests GDPR delete | **NOTHING** (service exists, no runbook) | |
| 17 | Customer requests org-merge | **NOTHING** | |
| 18 | Agent runs amok (Sophie auto-resolves something it shouldn't) | **NOTHING** | The most-likely embarrassing failure |
| 19 | Provider circuit-breaker trips (Attom / BatchData / Regrid) | **NOTHING** | `provider-registry.ts` does the breaking; no human-side runbook |
| 20 | Founder is unavailable (sick / travel) | **NOTHING** | Single point of failure |

**Score:** 8 of the 20 events most likely to fire in the next 90 days are unrunbooked. That's a B-minus.

---

## 4. Vendor failure inventory

What AcreOS depends on, and what breaks:

| Vendor | Used for | Failure mode | Customer impact | Runbook |
|---|---|---|---|---|
| **Stripe** | Billing, dunning, subscription mgmt | Webhook stops, API down, account flagged | Billing actions fail; new signups can't pay | YES |
| **Clerk** | Auth (per memory) | Service down, SSO break | 100% lockout | NO |
| **Cloudflare** | DNS, proxy (per memory) | DNS resolver, edge outage | 100% lockout | NO |
| **Fly.io** | App hosting | Region outage, deploy break | App down | PARTIAL (`disaster-recovery.md`) |
| **OpenAI** | `supportBrain.ts`, classification, generation | Quota, latency spike, model deprecation | Sophie fails → everything escalates to founder | YES |
| **Anthropic** | Sophie Genius (Opus second-opinion), agent reasoning | Same as above | Borderline tickets all escalate | YES |
| **AWS SES** | Email send (per ops runbook) | Throttle, IP rep drop, suppression list growth | Onboarding emails don't arrive — invisible churn | NO |
| **Twilio** | SMS (per env) | 10DLC reject, A2P brand block | SMS campaigns silently fail | NO |
| **Lob** | Direct mail | API down, address validation fail | Mailers don't ship | NO |
| **ATTOM / BatchData / Regrid** | Property/parcel data (provider-registry) | Provider down, rate-limited, data drift | Enrichment empty → core product looks broken | NO (registry does fallback, no human-side runbook) |
| **Replit / DB host** | Postgres (per replit.md) | DB down, migration fail | Total outage | PARTIAL |

**The big tells:**
- Auth path (Clerk + Cloudflare) has zero runbook coverage. This is the single most-likely customer-visible outage and the one with no agent fallback.
- Email deliverability (SES) has no monitoring runbook. New SaaS dies silently from suppression-list bloat at exactly the 10–50 customer mark.
- Twilio 10DLC compliance is unclaimed — Land Investors send a lot of cold-text, this *will* trip.

---

## 5. Admin UX assessment — non-engineer-accessible?

Pages I'd hand to a non-engineering ops hire:

| Page | Verdict | Why |
|---|---|---|
| `/admin/support` | **Yes — usable** | Plain English, SLA badges, conversation view, single textarea. A trained ops person could work this on day 1. |
| `/founder-home` | **Yes — usable** | Greeting + "what needs you" + agent health. Friendly. |
| `/founder-dashboard` (legacy banner) | **No — overwhelming** | 7,369 lines. Everything-everywhere panel. Engineer-only. |
| `/admin/safety-gates` | **Borderline** | 301 lines, gate-rule semantics unfamiliar to a non-engineer. Needs a "what is a gate" preamble. |
| `/admin/decisions` (decision-queue.tsx) | **Borderline** | 552 lines, requires understanding what Sophie escalated and why. |
| `/admin/beta` | **Yes** | Intake list + approve. |
| `/admin/ops` | **Likely engineer-only** | (Inferred from name; haven't sampled.) |
| `/command-center` | **No** | 2,264 lines — power-user surface. |
| `/team-inbox` | **Borderline** | 538 lines, needs walkthrough. |

**The good news:** the founder-facing surfaces (`founder-home`, `admin-support`) are genuinely operable by a junior ops hire. The bad news: the *power* surfaces — command-center, agent-command-center, founder-dashboard — read as "engineer dashboards with React paint" not "ops product." When the first ops hire arrives at customer ~30, they'll either ignore those surfaces (in which case why ship them) or stall on them (in which case Thomas re-onboards them weekly).

---

## 6. The 5-to-50 stress-test failure modes — ranked

What breaks first, in likely order:

1. **Auth provider outage with no runbook** (Clerk / Cloudflare). Probability moderate, blast radius 100%, MTTR unknown — Thomas has to fight the vendor live. **Highest expected pain.**
2. **Email deliverability silent decline** — SES suppression bloat from bouncy investor email lists. Onboarding day-1/day-3/day-7 emails stop landing → activation rate drops → founder thinks the product is the problem.
3. **Sophie auto-resolves something embarrassing** — confidence threshold 70 in balanced mode means ~30% of borderline cases auto-close incorrectly without a human-visible "are you sure" loop on customer-sensitive topics (refunds, data deletion, contract terms). One screenshot on Twitter is real damage.
4. **Twilio 10DLC / A2P registration rejected mid-campaign** — Land Investors live on cold-text. SMS go through but at degraded throughput, no surface alerts the founder.
5. **Decisions inbox fills faster than founder drains** — at 50 customers with the same residual rate, expect 30–50 items/week landing on Thomas. This becomes the bottleneck before MRR ever does.
6. **Provider circuit breaker traps a bad fallback** — if Attom degrades and the registry fails over to Regrid, but Regrid returns subtly-wrong data, customers see broken enrichment and the agent layer can't tell. No data-quality SLO surface.
7. **Founder is unavailable for 48+ hours** — there is no second-human escalation path. Every P0/P1 alert goes to one inbox. If Thomas is on a flight, the system is functionally headless.
8. **Stripe webhook drift after a Stripe API version bump** — runbook exists, but no synthetic check that fires before customers notice.
9. **Onboarding cron stalls** (the day0/1/3/7/14/30 sweep). If the daily cron silently fails for 3 days, 3 cohorts get no day-1 email. No alert today is sized to "cron didn't fire."
10. **GDPR delete request lands with no UI** — manually invoked = forgotten. 30-day legal clock starts the moment they ask.

---

## 7. Pre-launch ops hardening sprint — 8 items, 2–3 weeks

Sequenced for impact-per-day. None of these require new infra, only ops scaffolding.

**Week 1 — close the runbook gap:**

1. **Write the missing 8 runbooks** (Clerk outage, Cloudflare outage, SES deliverability, Twilio 10DLC, e-sign stuck, GDPR delete, agent-misfire, founder-unavailable). One page each, same template as the existing 9. ~1 day.

2. **Add a "vendor status" tile to /founder-home** — green/yellow/red per vendor, last-checked timestamp, link to the vendor's status page. Pulls from existing `externalStatusMonitor.ts`. ~0.5 day.

3. **Add a P0/P1 escalation buddy** — second `FOUNDER_EMAILS` entry (a trusted advisor, even if read-only) plus an SMS escalation if the founder doesn't ack a P0 within 30 min. `alertPolicy.ts` already has the routing — just add a second channel and an ack-timer. ~0.5 day.

**Week 2 — close the founder-bottleneck gap:**

4. **GDPR + org-merge admin UIs** — thin wrappers around `gdprService.ts` and `storage.mergeLeads`. Two pages, ~1 day each. Without these, every legal request blocks on Thomas opening a SQL console.

5. **Customer-context sidebar in /admin/support** — when a case is selected, show plan / MRR / days-since-signup / churn risk band / last 5 activity entries. ~1 day. Cuts case-handling time roughly in half.

6. **Saved-replies dropdown in /admin/support** — load `support-playbook.md` into the textarea as a snippet picker. ~0.5 day. Materially reduces typing fatigue.

**Week 3 — close the silent-failure gap:**

7. **Synthetic checks** — a single cron that every 15 min: (a) sends a test email through SES and verifies receipt, (b) sends a test SMS through Twilio and verifies status, (c) hits the Stripe webhook receiver with a fixture event. Wire into existing `alerting.ts`. ~1 day. Catches deliverability + webhook drift before customers do.

8. **Sophie human-in-loop guard for customer-sensitive intents** — on classification, if `category ∈ {refund, account_deletion, contract_terms, data_export}`, route to decisions inbox even at 95% confidence. ~0.5 day in `customerSupportAutoResolver.ts`. Eliminates the embarrassing-auto-resolve risk.

**Optional 9–10 if time permits:**

9. **CSAT capture post-resolution** — one-click thumb survey appended to the resolution email. Persists into `support_metrics`. ~0.5 day.

10. **"On-call" toggle on /founder-home** — when Thomas flips to "off-call" before a flight, P0 alerts switch to the buddy + SMS path automatically. ~0.5 day.

---

## What I'd tell the board

AcreOS has built more ops automation pre-launch than most Series-A companies have post-launch. The agent layer is genuinely impressive. But automation without a fallback layer doesn't survive contact with a real customer base — it's a single layer of cheese, not Swiss-cheese-with-defense-in-depth. The 8-item sprint above adds the second layer cheaply (≤3 weeks) and turns the 5→50 stretch from "founder absorbs surprises personally" into "founder reviews surprises that the system already routed correctly." That's the difference between a COO-able company and a founder-bottlenecked one.

— Olu
