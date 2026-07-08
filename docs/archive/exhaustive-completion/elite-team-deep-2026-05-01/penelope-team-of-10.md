# Penelope Forth — Team of 10, Live Fire

**Persona:** Penelope Forth, 51, Houston. CEO of a 10-person Land Investing operation.
**Roster:** 4 acquisitions reps, 2 paralegals, 1 dispo manager, 1 marketing manager, 1 ops manager, me.
**Volume:** ~$12M/yr revenue, ~200 deals/yr.
**Wave:** 87-persona AcreOS audit, mid-size team operator voice.
**Date:** 2026-05-01.

I read Vincent's "team of 3" note — or I tried to; it isn't written yet, so I'm flying without his contour. I'll write mine straight and let him slot underneath. The shape of the problem at 3 and at 10 is different anyway. At 3, you can hold the operation in one head. At 10, the operation has to be the system. AcreOS is being asked to *be* that system. Here's how it holds up.

---

## 1. The 30-second verdict

AcreOS is **a brilliant solo cockpit being asked to behave like a team OS, and the seams show under load**. The single-operator surfaces are world-class — deal feed, AVM, founder-v6 through v14 dashboards, the autonomous agent layer, the founder intelligence routes. There are more than a hundred route files in `server/`. The ambition is real.

But when I drop ten people into it on Monday morning, four things break:

1. **There is no "manager dashboard."** `team-dashboard.tsx`, `team-kpi.tsx`, and `team-leaderboard.tsx` exist as pages, but `team-kpi.tsx` is 94 lines of placeholder cards rendering em-dashes if the API doesn't respond. I am not running my $12M operation off em-dashes.
2. **Round-robin lead assignment doesn't exist for leads.** I grepped for it. The only `round_robin` string in the codebase is in `routes-call-routing.ts` — a strategy *flag* for inbound calls, not actual lead-to-rep assignment with workload balance.
3. **There's no Slack/Teams integration.** Zero hits for "slack" in the server routes outside of call-routing. `routes-team-messaging.ts` is 1,103 lines of *internal* messaging — AcreOS reinventing Slack rather than integrating it. At 10 people, my team already lives in Slack. Asking them to also live in AcreOS-the-chat-app is a non-starter.
4. **Per-seat pricing is missing entirely.** `client/src/pages/landing/Pricing.tsx` has three flat tiers — Solo ($199/mo), Operator ($499/mo), Operation ($1,290/mo). At 10 seats, $1,290/mo is so cheap I'm suspicious. There's no enterprise tier, no per-seat add-on, no SSO line item, no admin-controlled seat provisioning. Tegan flagged some of this from the pricing-strategy angle; I'm flagging it from the buyer's seat. **You are leaving money on the table and signaling "we don't actually do teams."**

Verdict: I would buy AcreOS for me personally tomorrow. I would **not** roll it out to my 10-person team in its current shape without a vendor commitment to ship six specific things in 90 days. List below.

---

## 2. The "we'd outgrow this" risk

This is the one that keeps me up. Software for solo operators that *almost* scales to teams is the worst category to buy into, because the migration off it costs more than starting elsewhere would have.

Here's my outgrow-this checklist, rated as of today:

| Capability | Status | What I see |
|---|---|---|
| Per-rep pipeline view | Partial | `team-dashboard.tsx` exists at 249 lines; haven't validated whether it actually filters deals by `assigned_to`. |
| Round-robin lead assignment | **Missing** | Only inbound-call routing has round-robin. Leads from direct mail / cold call / web → no auto-assignment surface. |
| Workload balance ("least-busy" rep) | **Missing** | Strategy flags exist as comments in call-routing only. |
| Manager-only override of rep assignments | Unknown | RBAC is patchy per Liana's audit; if I can't gate "reassign lead" to managers, it's a control problem. |
| Approval workflow on offers | **Missing as a workflow** | Approvals exist as billing/autonomy concepts (`routes-billing.ts`, `routes-autonomous-agent.ts`); not as "every offer >$X requires dispo manager sign-off." |
| Commission tracking | **Backend exists, UI thin** | `routes-commissions.ts` is solid (config, records, payments, agent summaries, statements). `commissions.tsx` is 604 lines. Need to verify it covers tiered/sliding-scale comp plans, not just flat %. |
| Per-rep activity feed for daily standup | **Missing** | No async-standup surface, no "what did each rep do yesterday" digest. |
| Slack/Teams hand-off | **Missing entirely** | No webhook out to Slack, no "send this lead to #acquisitions-pod" action. |
| Org-wide monthly report (export-ready) | Partial | Hassiba's reporting audit covers the gaps; I won't repeat them. From my seat: I want a "monthly all-hands deck" PDF I can hand to my partners. Doesn't exist yet. |
| Seat-based pricing + admin-controlled provisioning | **Missing** | No per-seat tier. No "invite 4 acquisitions reps, 2 paralegals" admin UX I've been able to find as a first-class surface. |

If I sign for 10 seats today, in ~6 months I'm going to hit at least three of these walls hard. The migration off would be brutal — I'd have data in deals, leads, communications, commissions, documents, and contracts all in AcreOS. **The lock-in is high. The team-fitness is moderate.** That's an uncomfortable place for a buyer to be.

---

## 3. The manager-dashboard gap (this is the headline)

I want to be precise here, because "manager dashboard" gets thrown around loosely.

**What I need every Monday at 8am:**

- Each acquisitions rep's pipeline, by stage, with $-weighted forecast.
- Each rep's response-rate-to-new-lead (in <15 min, <1 hr, >1 hr).
- Each rep's offer-sent count, offer-accepted count, conversion %, week-over-week.
- Each rep's commission accrued MTD and projected EOM.
- Outliers flagged: stalled deals (>14 days no contact), leads the rep hasn't touched in 48 hrs, offers expiring this week.
- Drill-down from any rep card → that rep's deals → individual deal.

**What AcreOS gives me today:**

- `team-dashboard.tsx` — 249 lines. Likely renders something. I haven't audited the shape, but the file size suggests "card grid" not "manager command center." I'd expect a manager dashboard for 10 people to be 800–1,500 lines minimum, with at least three nested data queries.
- `team-kpi.tsx` — 94 lines. Six placeholder cards. The empty state literally says "Team KPI tracking coming soon." That's a *feature flag in a UI shell*, not a feature.
- `team-leaderboard.tsx` — 268 lines. Leaderboards are gamification, not management. Useful, secondary.
- `routes-analytics.ts` likely exposes `/api/analytics/team-kpi` — that's the URL `team-kpi.tsx` calls. Whether it actually returns data and whether that data is correct, I haven't validated. The page handles "API not ready" by showing dashes, which suggests the team has shipped this defensively, knowing the backend isn't fully wired.

**The honest gap:** AcreOS has the *bones* of a manager dashboard but it isn't fleshed out. Hassiba's reporting audit covers org-wide reporting. The manager dashboard is a different animal — it's per-rep, it's daily, and it has to update fast enough that I'll actually open it before my 9am standup.

**My ask:** Build `manager-dashboard.tsx` (or rename `team-dashboard.tsx` to it and triple its content). Anchor it on **the four metrics that matter for acquisitions reps in land**: response time, offer ratio, conversion %, accrued commission. Let me click any rep and drill to their pipeline. Add a "stalled deals" widget that shows me, in one glance, which deals each rep has let drift. That's how I run the room.

---

## 4. Commission tracking

Good news first: `server/routes-commissions.ts` is 121 lines of clean, structured route-handling. Config, records, deal-recording, payment-recording, agent summaries, statement generation. That's not a placeholder — that's a real service.

The UI side is `commissions.tsx` at 604 lines, which suggests something substantive.

**What I'd press on as a CEO who actually pays commission to four people every month:**

1. **Comp-plan complexity.** My acquisitions reps are on a tiered structure — 10% on first $50k profit, 12% on next $50k, 15% above. Plus a $500 spiff for any closed deal in 30 days. Plus a quarterly bonus pool. Does `getCommissionConfig` model that? The route exists. The *shape* of the config object is what I'd want to verify — does it support tiers, spiffs, splits (paralegal gets 1% of dispo profit), and clawbacks (deal closes then unwinds)?
2. **Statement period accuracy.** `generateCommissionStatement(orgId, agentId, from, to)` is the right signature. The question is whether the underlying data captures *attributable* deal economics correctly — net profit after marketing cost allocation, after closing-cost allocation, etc. If commission is calculated on gross, my reps will overpay themselves. If on net, the net calculation has to match my books.
3. **Audit trail for changes.** When I retroactively fix a commission rate, does AcreOS log who changed what when? Compliance for commission disputes. I'd want this in `audit-log.tsx`.
4. **Pay-period workflow.** "Run commissions for April" should be a button that produces (a) per-rep statements, (b) ACH file or QBO export, (c) "approved" toggle for me to gate before payments fire. Currently I see the *records* and the *payments*, but not the *batch run* surface.
5. **Rep-facing visibility.** Reps want to see their own running total *in real time* — what they've earned MTD, what's pending, what's been paid. That's a motivation lever. The leaderboard touches this; commission needs its own "my earnings" surface for each rep.

**Net:** Commission has the *most credible team-OS bones* in AcreOS. It's the one place I'd say "yes, this team built for teams, at least once." But I'd want to validate items 1–3 before I migrate my reps onto it.

---

## 5. Slack / Teams integration need

I cannot overstate this. **At 10 people, Slack is the operating system.** Not AcreOS. Not Notion. Slack.

The pattern I need:

- New high-priority lead arrives → posts to `#acquisitions-pod` with a "Claim" button → first rep to claim gets it assigned → AcreOS records the assignment. (This *is* round-robin's natural alternative — claim-based assignment, surfaced where reps actually live.)
- Offer accepted → posts to `#wins` with deal link.
- Title issue flagged on a deal → DMs the assigned paralegal.
- Stalled-deal alert → posts to the rep's DM, escalates to manager DM after 48 hrs.
- Daily 8am digest → posts to `#standup` with each rep's yesterday-output summary.

**What AcreOS has today:**

- `routes-team-messaging.ts` — 1,103 lines. This is *internal* team messaging. AcreOS-the-chat-app. I respect the engineering effort but **at 10 people this is wrong**. My team will not adopt a second chat app. I have tried this on prior platforms. It fails 100% of the time.
- Zero Slack webhooks in server routes (grepped).
- Zero Microsoft Teams adapter.
- `routes-integrations.ts` and `routes-founder-integrations.ts` exist — I haven't audited whether they include Slack adapters, but the `grep -i slack` returned nothing in those files either.

**My ask:** Re-position `routes-team-messaging.ts` as the *event bus*, and ship a **Slack webhook adapter** as the primary delivery channel. Reuse the message envelope, fan out to Slack via incoming webhooks (read-only) for v1, then bidirectional via Slack app for v2. Hessam's webhooks audit may overlap here — coordinate. The point is: AcreOS shouldn't *replace* Slack, it should *talk to* Slack.

If you don't ship Slack/Teams in 90 days, I personally will build a Zapier shim for it. Many of your team-of-10 customers will. That's a bad look — your customers integrating around you, not with you.

---

## 6. Pricing — the multi-seat enterprise gap

Tegan's audit is the canonical pricing piece. From the buyer's seat at 10 people, here's what's wrong:

**Current tiers** (from `Pricing.tsx`):

| Tier | Monthly | Annual | Pitch |
|---|---|---|---|
| Solo | $199 | $1,990 | "1–4 deals/mo" |
| Operator | $499 | $4,990 | "Partnerships and small teams" |
| Operation | $1,290 | $12,900 | "Full-time operations & multi-state" |

I'm a 10-person, 200-deal/yr, $12M-rev operation. I land on "Operation" at $1,290/mo. That's $15.5k/yr — **0.13% of my revenue**.

Two problems:

1. **It's underpriced for what I get** (or what I should get). At $15.5k/yr I'd expect a CSM, a quarterly business review, SSO, an admin console with seat provisioning, audit-log export, and a dedicated implementation onboarding for my 10 people. None of that is in the tier description. The $1,290 number signals "tool" not "platform." I'm willing to pay $40–80k/yr for a platform that runs my $12M operation. **You're under-monetizing your best-fit segment.**
2. **There's no "per-seat" line.** What if I add an 11th person? A 25th? My shop is going to grow. I want a clean "$X base + $Y/seat" structure so I can budget. Flat-tier pricing breaks at the team boundary because I can't predict my cost as I scale. Sales-led "Talk to us" works for enterprise, but I want to *self-serve* up to ~25 seats before you make me jump on a call.

**My ask:** Add an explicit **Team / Enterprise tier** with per-seat pricing, SSO, admin console, audit-log export, dedicated CSM. Price the base at $2,500/mo + $150/seat. That puts a 10-person shop at $4,000/mo, $48k/yr — appropriately monetized, still well below the all-in Salesforce+REI Reply+Podio stack I'd build otherwise.

Tegan should validate the dollar amounts against your COGS. The structural ask — **per-seat line, admin console, SSO** — is non-negotiable for the segment.

---

## 7. The deal-killer at scale

If I had to pick one thing that, **left unfixed, would prevent me from rolling AcreOS to my 10-person team**, it's not commission, it's not Slack, it's not even the manager dashboard.

It's **RBAC**.

Liana's audit is the canonical document. The summary as it lands on my desk: "AcreOS RBAC limited. Most endpoints unguarded." That sentence, for a team-of-10 buyer, is **disqualifying**.

Here's why it's specifically disqualifying for me:

- My 4 acquisitions reps must not be able to see each other's commission accruals. (Morale, comp confidentiality.)
- My paralegals must be able to read deals but not change offer terms.
- My marketing manager must be able to launch campaigns but not see individual deal P&L.
- My dispo manager must be able to approve offers but not modify the commission config.
- My ops manager needs everything except commission config.
- I (CEO) need everything.

That's six distinct role profiles. AcreOS today, per Liana, ships RBAC that mostly works in the founder-vs-customer dimension but **does not durably enforce role-based access within an org's team**. In other words: if a curious paralegal pokes at the URL bar, they probably can see commission data they shouldn't. I cannot deploy that into a 10-person team. It's a lawsuit waiting to happen.

**The deal-killer reframed:** AcreOS at the team-of-10 boundary needs to ship, in priority order:

1. **Per-route role guards** with a default-deny posture (Liana's #1 ask).
2. **A team admin console** where I configure roles and assign team members to them.
3. **Commission-data isolation** so reps can see their own, managers can see all, paralegals can see none.
4. **Deal-level assignment + visibility rules** so reps see their pipeline, managers see all, paralegals see what they're attached to.
5. **Audit logging of permission changes** so I can prove governance to my partners.

Without these, I'm a single bad headline ("rep sees commission on deal that wasn't theirs and quits") away from churning off the platform.

---

## What I'd ship in 90 days, if I were Thomas

In rough priority for the team-of-10 ICP — not the whole roadmap, just the team-OS readiness path:

1. **Week 1–3: RBAC hardening + admin console.** Liana's plan. Default-deny on routes. Team admin UI. Six default role templates.
2. **Week 3–6: Manager dashboard.** Real `manager-dashboard.tsx`. Per-rep cards, pipeline drill-down, stalled-deal widget, response-time metric, accrued-commission chip.
3. **Week 4–7: Slack adapter.** Webhook out for events: lead-claimed, offer-sent, offer-accepted, deal-stalled, commission-statement-ready. Skip Teams for v1.
4. **Week 6–8: Round-robin / claim-based lead assignment** with workload balance. Surface in both AcreOS UI and Slack `#acquisitions-pod`.
5. **Week 7–9: Approval workflow on offers** — dispo manager gate for offers >$X, with override + audit trail.
6. **Week 8–10: Per-seat pricing tier** + Stripe wiring (Vikram's audit) + self-serve seat provisioning UI.
7. **Week 10–12: Org-wide monthly report** — exportable PDF/PPT for all-hands.

If those seven ship by August, I sign for 10 seats and become a reference customer. If they don't, I stay on my Frankenstack of Podio + REI Reply + Excel until something else fits.

---

## The "I'd write this in the buyer email" version

> Hey Thomas — I love what AcreOS is doing for solo operators. I'm at 10 people and what I need is a team OS, not a brilliant cockpit. The RBAC, manager dashboard, Slack integration, and per-seat pricing are the four things blocking me from rolling this to my team. If you can commit to those in Q3, I'll be your design partner and your loudest reference. If not, I have to stay on what I have. Either way, rooting for you.
>
> — Penelope

---

*Filed under wave 2 (mid-size team operator voice). Sibling docs to read alongside this one when they exist: `vincent-team-of-3.md` (one tier smaller), and any wave-2 doc covering teams of 25+ (one tier larger). Liana's `liana-rbac.md`, Hassiba's `hassiba-reporting.md`, Tegan's `tegan-pricing.md`, Vikram's `vikram-stripe.md`, and Hessam's `hessam-webhooks.md` are the canonical companion pieces from wave 1.*
