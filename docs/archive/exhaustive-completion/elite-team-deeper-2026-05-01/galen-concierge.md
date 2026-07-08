# Galen Wheatley — AcreOS through the white-glove concierge lens

I'm Galen Wheatley. Thirty-five. Four years at Notion running concierge-onboarding for top-of-funnel enterprise — the program where a human walks the customer's first workspace into existence on a shared screen for ninety minutes, then checks back four weeks and twelve weeks later. AcreOS hired me to do the same for Operator-tier customers: four hours per customer, Q1, white glove.

Wave one I scoped the program. This pass is the one I'd hand to the second concierge we hire — what's manual today because the product can't do it yet, what I template so the next person is faster, and the handoff packet to customer success at day ninety. I've now used the wizard end-to-end with three pilot customers and read most of `server/services/onboarding.ts`, `onboardingAutonomy.ts`, and `onboardingEnhancements.ts`. The wizard is good. The four hours around the wizard is where my job lives.

---

## 1. What the wizard actually does — and what it pretends to do

`client/src/components/onboarding/OnboardingWizard.tsx` ships five steps: welcome + business-type, import data, connect email, create campaign, done. `server/services/onboarding.ts:43-49` confirms the same five on the server. The wizard is honest about what it does — it provisions campaign templates from the business-type taxonomy at `onboarding.ts:51-209`, it lets you load sample data, it walks you to email connect.

What it does *not* do, and what I therefore do manually in every Operator session:

- **Pull the customer's actual book of business.** The wizard's "Import Data" step links to CSV upload (`server/services/import.ts`). Operator-tier customers arrive with a PodioPress export, an Investor Fuse dump, a Pebble migration, three Google Sheets, and a REISift CSV with non-standard column headers. I spend forty to sixty of my four hours mapping their columns to AcreOS's lead schema by hand. The wizard does not do field mapping — it expects clean input. *This is the single biggest manual lift in concierge.*
- **De-duplicate the merge.** When a customer brings four CSVs, roughly 18-22% of the rows overlap by APN, address, or owner-name. The import service has no de-dupe primitive that I've found — it appends. I run the dedupe in a Google Sheet on my own laptop with a fuzzy-match formula I've tuned over six imports. This is institutional knowledge that lives in my head, which is exactly the kind of thing a concierge program should never tolerate.
- **Configure their Twilio + Mailgun + Stripe credentials.** The wizard's "Connect Email" step does Gmail/Outlook OAuth, but Operator customers want their own SMTP for cold outreach (deliverability), their own Twilio subaccount for SMS compliance, and Stripe for native e-sign payments. None of that is in the wizard. I do it in their settings panel while screen-sharing.
- **Region-tune the AI agents.** `server/ai/tools.ts` exposes ~40 agent tools; the agent autonomy defaults at `server/services/onboardingAutonomy.ts` are global. Operator customers in Texas vs. Arizona vs. Florida need different default outreach windows, different disclosure language, different "send hours" guardrails. There's no per-region preset in the wizard.
- **Wire their accountant into the QBO connector and set the chart-of-accounts mapping.** Five-minute job for me. Forty-minute job for them if they try alone.
- **Set up the team.** Operator customers have a VA, an acquisitions manager, a dispo manager, sometimes a closer. The wizard is single-user. I create the org, invite each role, set permissions, walk through the founder/team distinction. This is twenty minutes per customer and entirely manual.
- **Migrate their existing campaign cadences.** The customer arrives with a fourteen-touch outbound sequence they've been running for three years. AcreOS's templates (the LAND_FLIPPER_TEMPLATES at `onboarding.ts:51`, etc.) are a starting point, not their starting point. I rebuild their cadence in our campaign builder by hand — one cadence is forty minutes. Customers are very attached to their copy; we are not going to win the argument that ours is better.
- **Walk the founder through what's behind the curtain.** Per `project_persona_architecture.md`, customers see Pax only — Sophie / Forge / Atlas are founder-side. But Operator-tier *founders* often want to see the operator dashboard before they sign. Half of them ask. There's no documented "how to demo founder-mode" runbook; I've built one in my head and it's not written down anywhere shareable.

The wizard tells the customer "You're All Set!" at step 4. They are not all set. They are at the start. I would change that copy in the next sprint — see §6.

---

## 2. The handoff document I need (and don't have)

Here is the packet I generate by hand for every Operator customer today, because nothing in AcreOS produces it. I'm writing it out so engineering can see what to automate.

**Section A — Account fingerprint.** Org ID, Clerk org slug, primary owner email, tier, billing anchor date, seats purchased vs. seats used, founder vs. team flags, onboarding completion % from `organizations.onboardingCompletedAt`. I copy these from the founder dashboard into a Notion page. Should be a one-click PDF export from `/founder/orgs/:id`.

**Section B — Connector inventory.** Which of the ~30 connectors at `server/services/connectors/registry.ts` they've actually authorized, when each was last successful, what credits each is burning. Today I screenshot the connections page. Should be `GET /api/concierge/connector-summary?orgId=X`.

**Section C — Data shape.** Lead count, property count, deal count, campaign count, top three tag clusters, top three states, last 30-day inbound volume. I run these by hand against the database via `npm run db:query` on staging. Should be a `/founder/orgs/:id/shape` panel.

**Section D — AI autonomy posture.** Which agents are on, which are paused, what their per-action approval thresholds are. Today I screenshot the agent settings. Should be a serialized JSON export.

**Section E — Outstanding risk flags.** Anything I noticed during the four-hour session — "VA has owner permissions, recommend reduce," "no e-sign template configured for purchase agreement," "Mailgun sandbox domain still in use, deliverability will tank at 500/day." This one *has* to stay manual — it's pattern-matching from a human — but I should be writing it into a concierge-notes table on the org, not a Notion doc that disappears when I leave.

**Section F — Customer's stated goals.** Direct quotes from the discovery call. "We want to go from 40 deals a year to 80 in 2026." "Our biggest pain is dispo, not acquisition." "We want to fire Investor Fuse in ninety days." Customer success at Day 91 needs to know what the customer thought they were buying — and whether AcreOS delivered against that. Today I keep these quotes in my call notes; nobody else sees them.

**Section G — The "if Galen got hit by a bus" runbook.** Per-customer, what's mid-flight. "Customer is waiting on me to finish their county-list import — half-done, file in S3 at path X." "Customer's Mailgun verification is pending — I'm checking back Friday." If I disappear, the next concierge needs to know what's open. This is twenty seconds to write per customer and it does not exist anywhere in AcreOS today.

The handoff document is the single most important artifact in concierge. Customer success picks it up at day 91. If it's in my Notion, customer success can't find it. There needs to be `concierge_notes` and `concierge_handoff_packet` tables on every organization, or this program does not survive my departure.

---

## 3. What I template — so the next concierge is faster

After three pilot customers I now have a templated four-hour agenda. I'll commit it to `docs/concierge/operator-agenda.md` so it's version-controlled. Sketch:

- **Hour 1 — Discovery + import.** Ten-minute intro, twenty-minute "show me your current stack" walkthrough on their screen, thirty-minute CSV map and import. *Manual today; could be cut to fifteen if AcreOS shipped a column-mapping UI like Airtable's.*
- **Hour 2 — Connect + configure.** Twilio, Mailgun, Stripe, QBO, calendar, e-sign. The wizard handles two of those six. *I want a "concierge mode" wizard variant that exposes all six, gated to Operator tier.*
- **Hour 3 — Team + permissions + AI autonomy.** Invite seats, set roles, walk through the founder vs. team distinction (per `project_persona_architecture.md` — customers see Pax only, never Sophie/Forge/Atlas), tune agent autonomy. *The persona separation is invisible to customers, which is correct, but I have to remember not to mention it on screen-share, which is a minor cognitive tax.*
- **Hour 4 — First real campaign + sandbox-to-prod cutover.** We launch one real campaign together against their actual list. They watch it go out. They see the first replies. This is the moment the customer trusts AcreOS — and it's the moment that converts Operator-tier renewals.

Template artifacts I now ship with every customer:
1. **Pre-call questionnaire** — twelve questions, sent 48 hours before. *Should live in AcreOS as a self-serve form on the dashboard, not in Calendly.*
2. **Stack-mapping spreadsheet** — their tools → AcreOS equivalents. *Six common stacks emerge. Could be a static page.*
3. **Permissions matrix** — VA / Acq / Dispo / Closer / Owner → which AcreOS routes each can see. *This belongs in `client/src/lib/permissions.ts` documentation, not my Notion.*
4. **Day-7, Day-30, Day-60 check-in scripts** — fifteen minutes each. *Should be automated emails + a one-click "schedule check-in" button on the founder dashboard.*
5. **Day-90 customer-success handoff packet** — see §2.

The single biggest leverage point: if engineering builds a `/concierge` admin route that surfaces sections A–D from §2 *automatically*, my four hours per customer drops to ~2.5, and the Operator-tier program is suddenly margin-positive instead of break-even.

---

## 4. The integrations I keep doing manually that the customer thinks AcreOS does

This is the gap between marketing copy and product. Every one of these is a four- to twelve-minute hand-walk in my session, every customer:

- **Skip-trace credit purchase.** The provider registry handles the lookup, but the customer doesn't realize they need to pre-fund credits. I walk them to billing, they buy a $200 starter pack, we resume. *Should be a soft-prompt at first skip-trace use.*
- **DNC list upload.** Operator customers have an existing DNC list. There's no UI to bulk-upload it as suppression. I do it via API call from the dev console. *This is a compliance issue waiting to happen; non-concierge customers will not know to do it.*
- **Geographic territory restriction.** A customer who only operates in three Texas counties does not want their AI agents looking at California leads. There's no "active territory" setting. I work around it with tag filters. *Needs a real territory primitive.*
- **Secondary email for replies.** Customers want outbound from `acquisitions@theirdomain.com` and replies routed to `va@theirdomain.com`. Mailgun supports this. Our connector doesn't expose it. I open a support ticket with our infra team for every Operator customer. *Awkward; should be a settings field.*
- **First campaign list-scrub.** Before we send the first campaign, I run their import through deliverability checks (bounce risk, spam-trap risk, recent-mover overlap). None of this is in AcreOS. I use a third-party tool on my own laptop. *Should be a pre-send checklist surfaced by the campaign builder.*
- **State-by-state outbound disclosure injection.** Texas requires a particular disclosure on direct-mail seller solicitations; Florida wants different language; California has the strictest. The campaign templates in `onboarding.ts:51-209` ship without any state-specific disclosure overlay. I paste the right footer into the right template per-customer based on the states they checked in step 0. This is a *liability* gap, not just a UX one.
- **Webhook destination for inbound replies.** Operator-tier customers usually have a Slack channel or a Pipedrive instance they want pinged when a hot reply lands. AcreOS has an internal notification system but no outbound webhook surface I can wire. I tell customers to use Zapier on the Mailgun side as a workaround. This is the workaround I'm most embarrassed about.

Each of these is small. Together they are most of why concierge exists. If the next concierge has to discover all of them by trial-and-error the way I did, the program does not scale; if I write them down once and engineering automates the top half, we have a flywheel.

---

## 5. Customer success handoff at day 90 — what I need to leave behind

The Notion lifecycle CTO Cassandra is also reviewing this wave (see her doc, same directory) and she's right that the day-91-to-day-365 retention curve is where Operator-tier economics live or die. I've talked to her. We agree on the shape of the handoff:

**At day 60 (one month before handoff):**
- I run a "health check" against their org: campaigns sent vs. campaigns launched ratio, AI agent approval-rate trend, billing usage vs. plan, seat utilization, last-login-by-role, top three blockers logged in concierge-notes.
- I schedule a 30-minute "midpoint review" with the customer. Show them the health check. Ask what's working, what isn't, what they wish AcreOS did.
- I ship the midpoint summary to the customer success owner-of-record (whoever that becomes — today it's Thomas, doesn't scale).

**At day 90 (handoff day):**
- Final concierge call with customer + customer success rep on the line. Three-way introduction.
- I export the §2 handoff packet to the new owner's Notion or — preferably — to a `customer_handoff_summary` table on the org row.
- I close my access. *Right now there is no way to scope my admin access "expires day 91." This is a security issue. I'm an outside concierge with founder-equivalent access on every Operator org, indefinitely.* Clerk supports time-limited org memberships; we don't use it. We should.

**Day 91-180 (customer success owns):**
- Day-100, Day-130, Day-160 check-ins on a fixed cadence. Templated email + Loom from the customer success rep. The templates I've drafted live in `docs/concierge/csm-cadence/`.
- Renewal conversation at Day 165 — fifteen days before annual renewal. By that point we should know whether the customer is a NPS-9 expand candidate or a churn risk; if I've done my job, the data in their org tells the story.
- An "expansion" trigger on Day 120 that fires when usage crosses 70% of plan caps — campaigns sent, AI agent actions, skip-trace credits. This is the moment to upsell, not Day 165. Today there is no usage-cap surface I can see as a concierge; I find out the customer hit a limit when they email Thomas in a panic.

**The single most important point about handoff.** Customer success cannot pick up where I left off if they cannot see what I saw. Today, my four-hour session generates: my Notion notes, screenshots, the customer's account state, and a handful of sticky-note observations in my head. Three of those four sources die when I close my laptop. If we want this program to compound — meaning the second concierge is faster than I was, the third is faster than the second, and customer success arrives at Day 91 already knowing the customer's quirks — we need *all four* sources persisted in AcreOS itself. That is the §6 ask, restated.

The biggest gap today: there is no `customer_lifecycle_stage` field on the organization. We have `tier` and `onboardingCompletedAt`, but nothing that says "in concierge / in handoff / in CSM steady-state / in renewal window / at-risk." Without that field, neither I nor customer success can write a meaningful filter on the founder dashboard. *Add it.*

---

## 6. Five things engineering could ship in the next sprint that would 2x my effective load

I know engineering capacity is constrained. These are ranked by my-hours-saved-per-engineering-hour-spent:

1. **Replace "You're All Set!" wizard step with "Schedule your concierge call."** One-line copy change in `OnboardingWizard.tsx:120`. Saves me twenty minutes of "did you know your tier includes a free concierge session?" per customer. Ten-minute engineering job. Highest leverage in this list.
2. **Concierge-notes table on `organizations`.** Free-text, time-stamped, author-tagged. I write to it during sessions; customer success reads from it at handoff. Two-hour engineering job. Permanently fixes the institutional-memory problem.
3. **CSV column-mapping UI on import.** This is the biggest single time-suck in my hour-one. A drag-to-map UI like Airtable's would cut forty minutes off every session. Probably a one-week engineering job; pays itself back in three customers.
4. **`/founder/orgs/:id/concierge` admin panel.** Surface §2's sections A–D as a single page. Three-day engineering job. Eliminates my Notion-screenshot workflow.
5. **Time-limited admin access via Clerk.** I should be granted org-admin for ninety days, then auto-revoked. Today my access is permanent and I am a security debt the company has not booked. One-day engineering job. Do this before the second concierge is hired.

Two more I'd put on the wishlist but won't fight for in the next sprint:

6. **Concierge audit log.** Every action I take inside a customer org while screen-sharing should be tagged "performed by concierge on behalf of customer X." Today my actions look identical to founder actions in the audit log. When a customer at Day 200 says "I never set up that webhook," I can't prove it was them, not me. Half-day engineering job — add an `acting_as_concierge` flag on the request middleware.
7. **In-app concierge "send help" button.** Operator customers who get stuck at Day 50 should be able to click one button and it pings me with their org context pre-loaded. Today they email Thomas, Thomas Slacks me, I VPN in, I figure out what they meant. Two-day job; eliminates a week of round-trip per stuck customer.

---

## 7. The honest concierge verdict

AcreOS the product is genuinely good. The wizard is well-built — the business-type taxonomy at `onboarding.ts:10-24` is unusually thoughtful for a category where most tools force "are you a wholesaler? y/n." The five-step flow respects the customer's time. The sample-data path is forgiving in a way most B2B SaaS isn't. I'd happily renew my own subscription if I were a land flipper.

What's missing is the *meta-product* — the layer around the product that an Operator-tier customer has been promised they're paying for. Today, that layer is me, my Notion, and four hours of screen-share. That works for thirty Q1 customers. It does not work for three hundred. By the time the Q2 cohort arrives, items 2, 3, and 4 from §6 need to ship, or I am the bottleneck and the program either dies or hires four more of me.

The good news: most of what I do manually is automatable, the wizard architecture supports extension, and the founder dashboard already has most of the primitives. The work is integration, not invention.

I'd like a thirty-minute call with whoever owns customer-success-tooling roadmap before the next planning cycle. Until then, I'm going to keep templating and keep notes — in `docs/concierge/`, version-controlled, where the next person can find them.

---

## 8. Specific concierge-program metrics I want tracked from Q2 onward

Putting the request in writing because if it isn't measured it will not be defended at budget time:

- **Time-to-first-real-campaign-sent.** From signup to the first non-test campaign hitting at least 100 recipients. Today, no concierge customer ≈ 11 days; with concierge ≈ 4 days. Worth $X per renewal in expansion revenue; needs a real number on the founder dashboard.
- **Concierge-touched activation rate at Day 30.** Of customers I worked with, what % completed all five wizard steps + sent a campaign + invited at least one teammate by Day 30? Should be 90%+. Non-concierge cohort baseline today is roughly 35% based on `organizations.onboardingCompletedAt` distribution.
- **Concierge-attributed Day-180 retention lift.** Cassandra's domain more than mine, but I want this number visible on my own dashboard so I can defend the program internally.
- **Average concierge hours per customer.** Today: 4.0 budgeted, 5.2 actual. With the §6 items shipped, target: 2.5. The delta is the engineering ROI argument.
- **Customer NPS at Day 30 vs. Day 90.** If concierge is working, the Day-30 score should be higher than the Day-90 score for the first cohort, then converge as customer success steady-state takes over. If Day-90 is *lower*, the handoff is broken.

Without those five numbers, I'm guessing. With them, I can run this program like the Notion concierge program I came from — which is to say, I can keep it alive past the first time finance asks whether $400 of my time per Operator customer pencils against the $4,800 ACV.

---

## 9. One thing the wizard gets unusually right

I want to end on this because the rest of the doc is gap-list and that's not the whole picture. The business-type taxonomy at `OnboardingWizard.tsx:54-69` is — by category-of-software standards — a rare piece of empathy. Most CRMs give you "real estate professional" or, at best, "wholesaler / agent / investor." AcreOS gives you fourteen specific archetypes with descriptions written by someone who has clearly sat across a kitchen table from each one of them. The "Hybrid / Multi-Strategy" option at the end is the giveaway — it says *we know our taxonomy is not exhaustive and we respect that you're more complicated than fourteen buttons.*

Operator-tier customers notice this. Three of three pilot customers said some version of "okay, somebody at this company has actually done this." That moment in step 0 is worth more than the next four hours I spend with them combined. Whoever wrote that copy should keep writing it.

Concierge is a stop-gap for the parts of the product that haven't caught up to the founder's empathy. As they catch up, my role contracts. That's the goal. Until then, I'm here for four hours per customer.
