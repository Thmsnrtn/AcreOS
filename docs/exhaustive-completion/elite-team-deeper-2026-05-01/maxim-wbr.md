# Maxim Atwell — Weekly Business Review design, AcreOS

**Lens:** Ex-Stripe ops lead, 47. I ran the WBR for a payments line that scaled from 8 to 800 customers; my entire job was teaching founders to read their own business in 30 minutes a week so the rest of the week could be spent building. Thomas asked: what 30 minutes of metrics, in what format, on what cadence. The answer is below.

**Constraint frame Thomas gave me:**
- **Mondays-only.** One sit-down per week. No daily standup with himself.
- **30-minute time-box.** Hard. If a metric needs more than 90 seconds of staring it doesn't belong on the WBR — it belongs on a deeper drill page.
- **Single founder.** No staff to prep the deck. Everything renders itself.

That last constraint is the one that kills most WBR designs in the wild. A WBR built for a CFO's analyst to assemble each Friday will never get assembled. Mine renders at 7:00am Monday, lands in Thomas's email + `/founder-home`, and is reviewable from a phone over coffee.

---

## 1. The 30-minute Monday WBR — fixed agenda

Five blocks, six minutes each. Same order every week, forever. Repetition is the whole point — variance against last week is the signal, not the absolute number.

| Min | Block | Question being answered |
|---|---|---|
| 0–6 | **Revenue pulse** | Are we growing, and is the growth real? |
| 6–12 | **Retention pulse** | Are we leaking, and is the leak accelerating? |
| 12–18 | **Cost pulse** | Is the cost-to-serve compatible with the price-to-serve? |
| 18–24 | **Reliability pulse** | Did we keep the promise we made to customers? |
| 24–30 | **Bottleneck pulse** | What is queueing in front of the founder personally? |

Each block has 3–4 metrics. Total: ~18 numbers. That is the hard cap. Stripe's internal WBR has 16. Anything more and the founder reads the first page and skims the rest, which is worse than not reading.

---

## 2. Block 1 — Revenue pulse (6 min)

Surfaces the four answers an investor will ask first.

| Metric | Definition (canonical) | Source | WoW threshold |
|---|---|---|---|
| **MRR** | Sum of `subscription_history.committed_mrr_cents` for orgs with `status='active'` at the snapshot, valued at the **single tier-pricing source** Marisol mandates (`shared/billing/tier-pricing.ts`). Net of discounts. Comp orgs reported separately. | `subscription_history` ledger | Yellow if WoW change <−2%, red if <−5% |
| **ARR** | MRR × 12 **only** for monthly-billed orgs, plus annualized contracted value of annual orgs (recognized + deferred portions both rolled in). Never `MRR × 12` blanket. | Same ledger | Same band |
| **NRR (90d)** | Same-cohort dollar retention: (starting MRR − contraction − churn + expansion) / starting MRR, on a trailing 90-day cohort. Includes credit-pack expansion at recognized value. | Same ledger + `creditTransactions` recognition | <100% yellow, <90% red |
| **GRR (90d)** | Same as NRR but **excluding** expansion. Floor metric. | Same | <85% yellow, <75% red |

Why both NRR and GRR: NRR can mask leakage if expansion is hot. GRR is the truth-teller. Stripe-style: report both, side-by-side, every week.

**What's on `/founder-home` today:** `mrr` (computed off the wrong tier table — see Marisol §1), `churnRate` (backward), `churnRisk` (forward bands). No NRR, no GRR, no ARR, no expansion/contraction decomposition. **Build gap: medium.** The cohort math exists in `routes-founder-intelligence.ts`; expansion/contraction needs decomposition and a single tier-price source. ~3 days of focused work after Marisol's #1 lands.

---

## 3. Block 2 — Retention pulse (6 min)

Today the dashboard shows 30d backward churn and forward churn-risk bands. That's necessary but not sufficient for a Monday review — neither tells the founder *which customers* and *why*.

| Metric | Definition | WoW threshold |
|---|---|---|
| **Logo churn (30d)** | Count of orgs that moved from `active` → `cancelled/suspended` in the trailing 30 days, divided by orgs `active` at start of window. | >5%/mo yellow, >8%/mo red |
| **Revenue churn (30d, gross)** | Sum of MRR lost from churned orgs in window, divided by starting MRR. | >5% yellow, >8% red |
| **Churn-risk movers (WoW)** | Net change in `bands.critical + bands.red` count vs prior Monday. | +3 yellow, +6 red |
| **Top-3 at-risk orgs by MRR-at-risk** | Listed by name, MRR, last activity, primary risk factor. One-click jump to the org. | n/a — review item |

Note the *movers* metric. The absolute count of at-risk orgs is volatile; the WoW delta is the actionable signal — "we added four red-band orgs this week" is something Thomas can intervene on. The data exists (`churnRiskScores` table); the weekly delta view does not.

**The Top-3 list is the most important single component on the entire WBR.** Founders fix retention by talking to specific customers, not by reading rates. Surfacing three names with one-click context shrinks the gap between "I noticed" and "I called them" to under a minute.

---

## 4. Block 3 — Cost pulse (6 min)

This block does not exist on `/founder-home` today and is the largest single gap. Marisol's COGS-per-customer rollup feeds this directly.

| Metric | Definition | WoW threshold |
|---|---|---|
| **AI cost rollup (7d)** | Sum of `usage_records` where `category ∈ {ai_paid, ai_free}`, valued at upstream provider rates (OpenAI + Anthropic). Reported as absolute $ and as % of MRR. | >18% of MRR yellow, >25% red |
| **Data-provider cost (7d)** | Sum of paid-lookup deductions through `provider-registry` (Attom, BatchData, Regrid). | >5% of MRR yellow, >10% red |
| **Comm cost (7d)** | Twilio SMS + SES email + Lob postcards, summed. | >3% of MRR yellow, >6% red |
| **Per-customer COGS (top-5 burners)** | Top 5 active orgs by trailing-7d cost, with their tier price. Flag any where 7d cost > 30d revenue. | List, not threshold |

Why these four and not more: AI cost is the existential one (an Opus token spike can erase a quarter), data-provider is the volatile one (a single agent loop gone wrong = $4k overnight), comm is the silent one (10DLC / SES bills accrue without a per-message UI). Per-customer rollup catches the specific Pro-tier customer pulling 30k AI requests Marisol warned about.

**Implementation note for Thomas:** the `simulatedActions` schema already has the categories. The production `usage_records` table needs the same shape with real upstream cost. ~2 days to wire, then this block renders itself forever.

---

## 5. Block 4 — Reliability pulse (6 min)

What promise did we make, and did we keep it. Olu's vendor-failure inventory and Ines's reliability work feed this.

| Metric | Definition | WoW threshold (error budget) |
|---|---|---|
| **Uptime (7d, customer-facing)** | % of 5-minute windows in the last 7 days where `/api/health` returned 200 across regions. | <99.9% yellow, <99.5% red |
| **P95 API latency (7d)** | 95th percentile of authenticated request latency, customer routes only. | >800ms yellow, >1500ms red |
| **Webhook success rate (7d)** | Stripe + Twilio + SES webhook handler 2xx / total received. | <99% yellow, <97% red |
| **Sophie auto-resolve rate (7d)** | Resolved-by-agent / total tickets touched, vs the 7d target band per `SOPHIE_CONFIDENCE_MODE`. | Below target band = yellow |
| **Support ticket volume (7d)** | Count of opened tickets, with WoW delta and per-100-active-orgs normalized rate. | >+30% WoW yellow, >+60% red |
| **SLA breaches (7d)** | Count of cases that crossed `breached` per `/admin/support` SLA logic. | >0 yellow, >3 red |

The error-budget framing matters: Thomas should *not* be staring at uptime % every week — he should be staring at the **remaining error budget** for the quarter. If 99.9% is the target, the quarter has 13 minutes of allowable downtime. The WBR shows: "you've burned 7 of your 13 minutes; 6 left, 8 weeks to go." That's a decision-relevant frame; raw 99.94% is not.

**Build gap on the dashboard side: medium.** Uptime + latency + webhook health all exist as raw signals (`alerting.ts`, monitoring); none are surfaced as a 7d budget burn-down on `/founder-home`. Sophie auto-resolve and support ticket volume are computed in `support_metrics` but not weekly-WoW. Ticket-volume normalized to active-org count is the metric that catches "product is silently breaking" — one ticket per 5 customers per week is sustainable; one ticket per active customer per week is a fire.

---

## 6. Block 5 — Bottleneck pulse (6 min)

This one is AcreOS-specific and I think the most valuable. Olu's founder-bottleneck inventory makes this concrete: every uncommon path lands on Thomas. The WBR has to surface *whether the queue depth is growing* — because if it grows three Mondays in a row, Thomas needs to hire or change the agent thresholds, not work harder.

| Metric | Definition | WoW threshold |
|---|---|---|
| **`/founder/todo` queue depth** | Total items returned by `/api/founder/intelligence/todo` at WBR snapshot. | >15 yellow, >25 red |
| **Decisions inbox depth** | Pending items in `decisionsInbox.ts`. | >10 yellow, >20 red |
| **Safety-gate breaches (7d)** | Count of agent actions held at a safety gate awaiting review. | >5 yellow, >15 red |
| **P0/P1 alerts to founder (7d)** | Count routed via `alertPolicy.ts` to `FOUNDER_EMAIL`. | >3 yellow, >8 red |
| **Median time-to-ack on P0** | P50 minutes from alert fire to founder ack. | >20m yellow, >60m red |
| **Founder-only-path actions (7d)** | Count of GDPR delete, org-merge, refund override, trial extension performed manually. | List, not threshold |

The last metric is Olu's killer insight made measurable: every action only Thomas can perform is a future hire's job description. After 6 weeks of WBRs the list itself becomes the org chart for the first ops hire.

---

## 7. Format — what the surface actually looks like

Three concrete deliverables, each a thin extension of `/founder-home`:

**(a) `/founder-home/wbr` — the 30-minute view itself.**
- Five collapsible blocks in fixed order, each rendering the metrics above.
- Each metric shows: current value, **WoW delta**, **4-week sparkline**, threshold-tinted border (green/yellow/red), one-line "what this means" tooltip.
- Top of page: a "this week vs last week" diff banner — three bullets the system pre-writes ("MRR +$340 (+2.1%); GRR held at 92%; AI cost % of MRR up 4 pts — investigate").
- Single export-to-PDF button so Thomas can drop the snapshot into a board update verbatim.

**(b) `wbr-snapshot` table (immutable).**
Every Monday 7:00am UTC, a worker writes one row capturing every metric value from the five blocks. WBR-over-WBR comparison, 4-week sparklines, and quarter-end retros all derive from this single table. Without immutability, "what did MRR look like 3 Mondays ago" can't be answered — Marisol's reproducibility point applies here too.

**(c) Monday 7:00 email (plaintext-first).**
Subject: `WBR W18 2026 — MRR $X (+Y%), GRR Z%, 3 reds`. Body: 18 metrics, one per line, threshold-tinted with unicode bullets. Phone-readable. Link at bottom: "open WBR view." A founder who reads only the email subject line still gets the three numbers that matter most.

---

## 8. What's on `/founder-home` today vs needed — gap matrix

| WBR metric | On founder-home today? | Build gap |
|---|---|---|
| MRR | Yes (off wrong tier table) | Fix in Marisol §7 #1 |
| ARR | Implicit via × 12 | Same fix |
| NRR | No | Decompose cohort logic, ~2d |
| GRR | No | Same module |
| Logo churn 30d | Yes (`churnRate`) | Already there |
| Revenue churn 30d | No | ~0.5d |
| Churn-risk movers WoW | Bands present, no WoW | ~0.5d after snapshot table exists |
| Top-3 at-risk orgs | No | ~1d |
| AI cost rollup | No | ~2d (depends on COGS work) |
| Data-provider cost | No | Same |
| Comm cost | No | Same |
| Per-customer COGS top-5 | No | Same |
| Uptime budget | Raw, not budget | ~1d burn-down view |
| P95 latency | Raw | ~0.5d |
| Webhook success | Raw | ~0.5d |
| Sophie auto-resolve | In `support_metrics` | ~0.5d to surface WoW |
| Support ticket volume | In `support_metrics` | ~0.5d to add /100-orgs |
| SLA breaches | In admin-support, not founder-home | ~0.5d |
| `/founder/todo` depth | Yes (count visible) | Already there |
| Decisions inbox depth | No | ~0.5d |
| Safety-gate breaches 7d | No | ~0.5d |
| P0/P1 to founder 7d | No | ~0.5d |
| Median P0 time-to-ack | No | ~1d (needs ack-timer from Olu §7 #3) |
| Founder-only-path actions 7d | No | ~1d |

Total build: ~12 engineering-days, sequenced after Marisol's tier-pricing source-of-truth (1d) and subscription event ledger (3d) — both of which the WBR depends on. Realistic delivery: 3 weeks alongside the Marisol/Olu hardening sprints, not in addition.

---

## 9. Cadence rules — the boring part that makes WBR work

1. **Same time, same place, same order, every Monday.** Variance is the metric; if the format varies, you can't read variance.
2. **Snapshot freezes 7:00am Monday UTC.** Numbers don't drift mid-meeting. The `wbr-snapshot` row is the source of truth for that week, forever.
3. **Threshold tints are committed in code, reviewed quarterly.** No moving the goalposts mid-quarter to make a metric look green.
4. **No new metrics added mid-quarter.** Anything new goes in a "candidate metrics" panel for one full quarter before promotion. Stripe rule. Prevents WBR-bloat.
5. **One metric retired per metric added.** Hard cap of 18.
6. **If a block goes red, the next WBR opens with that block first** — agenda mutation rule. Forces direct attention.
7. **Quarterly "WBR retro"** — review which thresholds fired, which didn't, what the system missed. Drives the next quarter's threshold tuning.

---

## Bottom line

Thomas already has 60% of the WBR shipped — `/founder-home` after d255dfe has the bones. The gap is: (a) Marisol's pricing-truth + ledger work, without which Block 1 is fiction; (b) COGS rollup, without which Block 3 is missing entirely; (c) the wbr-snapshot table, without which week-over-week is uncomputable; (d) ~6 small additions to surface metrics that already exist in the database but don't appear on the founder-facing page.

Three weeks of focused work, sequenced behind the CFO + COO sprints, gets Thomas to a 30-minute Monday review that he won't dread, that scales from 5 to 500 customers without redesign, and that produces a board-ready snapshot as a free byproduct. The discipline of doing it the same way every Monday is worth more than any individual metric on it.

— Maxim
