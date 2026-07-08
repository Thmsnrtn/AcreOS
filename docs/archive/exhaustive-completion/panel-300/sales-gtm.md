# Sales / GTM / Revenue — 300-Persona Panel

**Category slots:** 151–165  
**Date:** 2026-05-08  
**Synthesis methodology:** 15 independent memos clustered into 5 consensus recommendations

---

## Persona Memos

### 151. Hollis Marbury — AE SMB

**Lens:** $5K–$25K ACV closings; discovery-question repeatability.

**What I see:** The onboarding script (docs/launch/01) is founder-led, not founder-scalable. It pivots on vertical-wedge storytelling ("land investor, note investor, wholesaler"), but the discovery-question ladder in your script is 4 questions + active listen, which takes 30 minutes and requires founder presence. At $5K ACV, you need a 10-minute async-first discovery flow that qualifies before the founder call.

**Highest-leverage move:** Build a `/sales/discovery-intake` form (3 questions: vertical, portfolio size, current tool) that populates a scoring rubric (0–100 scale). Score ≥70 → route to founder. Score 40–70 → async followup with SDR + 5-min video. Score <40 → nurture sequence via email. Wire this to a founder dashboard showing "qualified this week: 12, conversion rate: 67%" (`routes-acquisition-radar.ts` equivalent). This unblocks your ability to hire a second AE without founder bottleneck.

**Biggest risk:** If the rubric mis-calibrates (scoring SMB users as Enterprise), you'll lose AEs to low-conversion rage.

---

### 152. Soraya Mahmoud — AE mid-market

**Lens:** $50K–$250K ACV; multi-threading on org size.

**What I see:** You have 5 friendly customers launching; none are mid-market yet. The mid-market buyer (10+ person team, formal procurement) has a different DPA requirement, a contract review timeline (15–30 days), and a "we need to see your SOC 2" gate that doesn't exist for SMB. Your `/legal/sub-processors` page shipped; your SOC 2 Type I package is still open.

**Highest-leverage move:** Before hiring a mid-market AE, complete SOC 2 Type I (external audit, 4–6 weeks). Simultaneously, pre-write a template "standard" MSA that references your standard DPA + sub-processor list. Wire a `/sales/enterprise-package` route that returns: DPA template, sub-processor list, SLA addendum, security questionnaire answers (auto-generated from your audit). When a mid-market prospect asks "can you sign our MSA?", the AE responds "our template is at [link]." This collapses sales cycle by 2 weeks.

**Biggest risk:** A mid-market customer signs an expensive custom MSA with liability caps you didn't budget for, creating E&O exposure.

---

### 153. Geoffrey Pendlebury — AE enterprise

**Lens:** $500K+ ACV; security-review cycle time; multi-year commitments.

**What I see:** Enterprise deals don't start with a $500K ask; they start with a 6-month POC at 20% discount, then a 3-year true-up. Your pricing today is flat tier ($49/$99/$199); you have no "enterprise agreement" tier or POC pricing path. The customer-launch kit assumes 5 $100-$200 ACV customers; an enterprise buyer is a different beast.

**Highest-leverage move:** Design (but don't sell yet) an Enterprise tier: flat fee $5K/mo + per-seat overage ($500/seat/mo for seats 6+). Wire this into `shared/billing/tier-pricing.ts` as a new tier enum `ENTERPRISE` (no Stripe Price object yet, just schema). Create `/sales/enterprise-iq` form: "How many concurrent users? Multi-region requirement? Custom SLA needed?" Scoring populates a POC proposal template with pre-filled pricing / SLA / timeline. This is your credibility surface once you have 1–2 pilot Land-investor customers vouching for stability.

**Biggest risk:** An enterprise buyer expects 24/7 phone support; you don't have a support org yet.

---

### 154. Brielle Kowalczyk — SDR lead

**Lens:** Built SDR org 0 → 30; cadence-tool ergonomics.

**What I see:** You're founder-doing-outreach until month-2 (per the forward synthesis). When you hire the first SDR, they'll inherit a Slack-based list of "warm leads from Wendell + podcast listeners + LinkedIn network." No CRM, no cadence tracking, no conversion metrics. The dialer (if you use Twilio) is wired; the workflow is not.

**Highest-leverage move:** Before hiring the first SDR, set up 3 Slack channels: #sdrs-qualified (leads ready for first touch), #sdrs-in-cadence (sent intro, no response yet), #sdrs-disqualified (passed, churned, or not-a-fit). Wire a simple CLI or Slack command: `/qualify-lead [email] [vertical]` → auto-populates the lead record + logs to #sdrs-qualified. Create a `/founder/sdrs/weekly` dashboard: outreach count, reply rate, booked calls, cost-per-call. This isn't a full SDR CRM; it's enough structure to hire your first SDR without chaos.

**Biggest risk:** SDR cadence misalignment with founder availability (SDR books 10 calls/week, founder can only take 3).

---

### 155. Aaron Yamashita — BDR

**Lens:** Outbound prospecting; personalization at scale.

**What I see:** Your warm network (Wendell + advisors + podcast listeners) is finite (~50–100 people). Once those are exhausted, you need cold outbound to land-investor Facebook groups, LinkedIn land-investing communities, real-estate wholesaler forums. The cold-outbound playbook today is 1) find 500 emails from a bought list, 2) craft 10 variants of "hey, are you a land investor?", 3) send via Twilio SMS or SES email. No personalization, no intent signal.

**Highest-leverage move:** Before cold outbound, build 3 micro-verticals of outbound personas: Land Investor (pulls from Facebook groups + LinkedIn), Note Investor (pulls from lending forums + private label lenders), Wholesaler (pulls from wholesaler networks + postcard-list brokers). For each, write 1 hook-line that's vertical-specific: Land: "land deals under $X in [county]?" Note: "yield >X% on your portfolio?" Wholesaler: "assignment deals >$X?" Wire into a `/sales/outbound-sequencer` form: choose vertical, upload lead list (email), run cadence. Track reply rate + booked meetings by vertical + hook. This turns cold outbound into an A/B testable lever instead of spray-and-pray.

**Biggest risk:** You buy a bad email list and hit spam filters at scale, damaging sender reputation.

---

### 156. Camila Espinosa — Sales engineer

**Lens:** Pre-sales SE; PoC-to-paid conversion.

**What I see:** PoC in your world is simple: "use AcreOS free for 14 days on your real deals." For a land investor, that's scanning 1 county, importing 1 note, and drafting 1 offer. For a note investor, it's uploading a portfolio CSV and running 1 payment cycle. The PoC is the product itself. The SE motion is: founder does the discovery call, SE (or founder) sets up the initial data, founder follows up at day-7. No dedicated "PoC success playbook" exists.

**Highest-leverage move:** Write a `/sales/poc-playbook.md` (1 page) that defines PoC success by vertical: "Land investor PoC success = scanned ≥1 county, imported ≥5 leads, generated ≥1 offer by day-10." "Note investor PoC success = uploaded ≥10 notes, ran ≥1 payment cycle, viewed yield report." Wire these as automated milestones that fire notifications in `/founder-home` ("PoC cohort X is on track: 4/5 hit day-7 checkpoint"). When PoC converts to paid, log the PoC duration + artifact count + day-of-conversion. This data feeds back into the next PoC refinement.

**Biggest risk:** A customer completes PoC, sees the note ledger has a rounding bug, and doesn't convert, creating a permanent "AcreOS doesn't work" narrative.

---

### 157. Rohan Mahapatra — RevOps engineer

**Lens:** Sales infra; attribution model integrity.

**What I see:** Your customer-launch kit has 5 customers launching; you're measuring NRR, concentration, and loop conversion weekly. But you have zero clean attribution model. Did customer #1 come from Wendell referral, podcast, or LinkedIn? The `organizations.utmSource` field captures the signup source, but it's coarse ("organic", "deal-room-share", "founder-network"). When you hire AEs, the question "which AE sourced which customer?" has no clean answer.

**Highest-leverage move:** Before hiring sales, schema-tighten attribution. Add a `customers.sales_attributed_account_id` column (nullable; defaults to null if sourced organically). When an AE books a meeting that converts, log the AE's account_id. Wire `/founder-home` to show "AE performance: [name] → X deals, Y conversion rate, Z CAC." This is your first RevOps artifact. As you scale, swap this for a real CRM (HubSpot, Pipedrive); for now, this schema + a weekly manual update unblocks founder transparency on "which channel / person is driving revenue?"

**Biggest risk:** Attribution games (AE claiming credit for a customer who was already warm) kill team trust.

---

### 158. Saskia Wojcik — Sales enablement

**Lens:** AE training; ramp-time reduction.

**What I see:** Your discovery script (docs/launch/01) is founder-authored and founder-assumptive. It works for Wendell-tier operators, but when you hire an AE who hasn't run land deals, the script becomes "here's what the founder says" instead of "here's why this works." The AE doesn't internalize the wedge; they memorize lines.

**Highest-leverage move:** Convert the discovery script into a 2-week AE ramp curriculum: Day-1: read `/founder-home` + customer financials (NRR, concentration, deal-room loop). Day-2: shadow 1 founder call. Day-3: run the discovery form yourself on 5 prospects (founder gives feedback). Day-4: own 2 customer onboarding calls (founder observes, gives notes). Day-5: own 5 discovery calls. Wire ramp milestones into onboarding: "ramp week 2 complete: AE closed 1 deal", which surfaces in `/founder-home` + Slack. Measure ramp-time: days-to-first-closed-deal. Target: <14 days. This turns script memorization into product knowledge.

**Biggest risk:** A high-ego AE skips the shadow phase and pitches wrong, losing a warm lead.

---

### 159. Eli Sutherland — Pipeline analyst

**Lens:** Forecast accuracy; stage-conversion truth.

**What I see:** Your 5-customer launch has a linear pipeline (founder calls a lead, lead converts or churns). No deal stage (discovery, PoC, negotiation, closed). No forecast accuracy goal. Once you hire AEs, you'll have 20+ open deals at any given time; "how many will close this month?" becomes a material question for runway planning.

**Highest-leverage move:** Design a 4-stage pipeline: Discovery (founder call booked), PoC (customer using product on real data), Negotiation (customer interested but price/terms open), Closed (customer on paid plan). Wire each stage to a conversion probability: Discovery → PoC: 40%, PoC → Negotiation: 80%, Negotiation → Closed: 90%. Create `/sales/forecast` endpoint: [stage breakdown] + weighted forecast ("this month: 3 closed deals, $15K revenue"). Update it weekly. Track historical vs forecast to measure forecast accuracy. By month-6, you'll know which AE / vertical is predictable and which is just noise.

**Biggest risk:** Forecast becomes a CYA artifact that nobody believes because AEs game it.

---

### 160. Brigid O'Halloran — Customer evangelist

**Lens:** Field marketing; customer-story production.

**What I see:** You have Wendell Hart (the legendary 12-year operator) as a customer. You should have a 10-minute video of him explaining "why I use AcreOS" and what problem it solved. Instead, you have zero case study, zero customer quote, zero social proof. At 5 customers, each one is a potential brand asset.

**Highest-leverage move:** Before month-end (when customer #1 goes live), schedule a 30-minute video call with the power-user (whoever closes first on paid). Ask: "What was the problem you had before AcreOS? Walk me through a before/after with a real deal you're working on right now." Record + transcribe. Clip the best 2-min moment: "I can't go back to spreadsheets now. The time savings alone is worth it." Post to `/founder/testimonials` (new page) + Twitter + website homepage. Measure LinkedIn clicks + direct mentions of the quote. By month-3, you want 3 customer videos, 1 per vertical, each <5 min. This is your top-of-funnel social proof while you're too small to have reviews on G2.

**Biggest risk:** Customer says something harsh on video ("the note ledger broke once and I almost lost a deal") that you can't un-publish.

---

### 161. Yannis Kazantzakis — Partnerships lead

**Lens:** Channel programs; co-sell motion.

**What I see:** Your vertical is land-investing; your adjacent channels are: title agents (who refer deals to flippers), 1031 exchange intermediaries (who refer note investors), real-estate attorneys (who close deals). None of them know about AcreOS. The co-sell motion is simple: "when you refer a customer, they get $X discount; you get $Y commission."

**Highest-leverage move:** Design a 2-tier partner program: Referral partner (no commitment, $500 per referred customer who pays for 3 months), Master partner (dedicated relationship, 10% of ACV, training + co-branded materials). Reach out to 10 title agents in Texas (Wendell's network) + 5 1031-exchange intermediaries (easy intro). Offer: "I'll give you a demo and a referral link. If any of your clients ask about deal tracking, send them to us. If 3 of them pay, I'll send you $1.5K." Measure: referrals booked, conversion rate, partner NPS. This unblocks a channel that's 0 effort for you and high-leverage for partners.

**Biggest risk:** You pay a partner for a referral that you would have gotten organically anyway (partner claimed credit).

---

### 162. Marit Larsen — Channel sales

**Lens:** Reseller margins; distribution network.

**What I see:** You're not yet at the reseller stage (that's Series-B). But pre-launch, you have a distribution opportunity: the real-estate software platforms (MLS data providers, appraisal software, title software) who already sell to your target customer. They have 1,000s of users; you have 5. A co-distribution deal could bootstrap your CAC by 70%.

**Highest-leverage move:** Identify 3 "soft partner" opportunities in the next 60 days: one title-software vendor (Catic, Simplifile shape), one MLS aggregator (Bridgure, Investview shape), one direct-mail platform (Pebble, SendGrid shape). Pitch: "We fill a gap in your product suite. If you white-label our note-ledger feature or refer your users to AcreOS, we'll give you a 20% referral fee or 50% co-revenue on white-label customers." No formal contract yet — just a pilot letter of intent. This positions you for a Series-B channel partnership without the overhead of building a full reseller program.

**Biggest risk:** A partner white-labels your product, then decides to build their own note-ledger and drops you.

---

### 163. Devereux Holloman — Sales coach

**Lens:** Deal-review inspection; AE coaching.

**What I see:** You're founder-selling right now; you have raw data (5 calls, time-to-aha measured, one script variant that works). Once you hire an AE, you'll have 2 people selling using different playbooks (founder's scripted approach vs AE's gut feel). Without a deal-review discipline, the AE's misses become invisible until they're churn.

**Highest-leverage move:** Start the habit now: every Friday, founder does a 30-min "deal review" (Slack note summarizing the week's calls: customer name, vertical, aha moment, objections, conversion yes/no). By month-2 when you hire an AE, this becomes a 1-hour group ritual (founder + AE + Camila). Each person reads their deals aloud (5 min each). The group identifies the pattern: "AE is letting prospects object to price without the payoff-math script." Next week, AE tweaks the script, re-tests. By month-6, you have a 12-week coaching flywheel. Measure: AE conversion rate improvement (baseline week-1, target week-8). This is your sales culture starting point.

**Biggest risk:** AE resents coaching and quits after 1 month.

---

### 164. Ananya Reddy — Deal desk

**Lens:** Non-standard pricing approval; discount discipline.

**What I see:** You have a pricing playbook (docs/launch/02) that says "no discounts, flat-tier, same for everyone." This works at 5 customers. At 50 customers, you'll have a prospect asking "can you do $79/mo instead of $99?" or "I'll commit to annual if you give me 20% off." Without a deal-desk process, the founder approves ad-hoc discounts that compound into a Frankenstein pricing landscape.

**Highest-leverage move:** Create a `/sales/deal-approval` form (internal, founder-only) with three checkboxes: (1) Customer contract value >$50K/yr? (2) Multi-year commitment? (3) Strategic channel opportunity? If all three: founder approves non-standard pricing up to 15% discount. If one: founder declines with a canned response ("we keep pricing flat to ensure fairness"). Wire a weekly digest: "discounts approved this week: $X, impact on blended CAC." This creates a paper trail that you'll need for Series-A fundraising ("we maintained 85% list price across our customer base despite churn pressure").

**Biggest risk:** The process becomes security theater, and the founder approves discounts anyway because of social pressure.

---

### 165. Ezekiel Faulkner — Sales-marketing alignment lead

**Lens:** SLA between sales + demand gen; lead-quality scoring.

**What I see:** You're not yet at the SLA stage (demand gen is founder writing in Twitter / founder letter, not a marketing engine). But you'll hire a growth marketer in month-2. Without a sales-marketing SLA, the marketer will optimize for signup volume, the AEs will complain about "bad leads," and the collaboration will fracture.

**Highest-leverage move:** Before hiring a growth marketer, document a draft SLA: "Marketing commits to 10 qualified leads per month (Discovery-stage, landed on website via campaign, spent >2 min on pricing page). Sales commits to responding within 24h and reporting back: 'contacted, booked, or disqualified.'" Define "qualified lead" using the rubric from 151 (vertical + portfolio size + current tool). Wire `/founder/marketing-sla` dashboard: leads sourced, contacted, booked, converted. Measure pipeline contribution by source (organic, paid, referral). This is your founding alignment document; grow it as you scale.

**Biggest risk:** SLA becomes a blame-fest (marketing blames sales for low conversion, sales blames marketing for low-intent leads).

---

## Category Synthesis: Sales / GTM / Revenue

**Consensus calls from the 15 memos above:**

### C1. Attribution clarity before hiring sales

Before your first AE, lock down `organizations.utmSource`, `organizations.sales_attributed_account_id`, and a 4-stage pipeline (Discovery → PoC → Negotiation → Closed). Wire `/founder-home` dashboard showing weekly conversions by source. This is non-negotiable for founder transparency and later Series-A fundraising; it also prevents AEs from gaming credit.

**Effort:** 3 days (schema + endpoint)  
**Personas converged:** Rohan (RevOps), Eli (Pipeline analyst), Geoffrey (Enterprise AE)

### C2. Discovery-intake rubric to unblock founder from 100% sales

The 30-min founder-led discovery call is the bottleneck. Build `/sales/discovery-intake` form that scores leads 0–100 based on vertical, portfolio size, current tool. Score ≥70 routes to founder call. Score 40–70 routes to SDR async followup + video. Score <40 enters nurture. This unblocks founder availability and lets you hire an AE without founder immediately hitting a wall.

**Effort:** 1 week (form + scoring logic + routing)  
**Personas converged:** Hollis (SMB AE), Brielle (SDR lead), Saskia (Sales enablement)

### C3. SOC 2 Type I completion gates mid-market sales motion

You cannot credibly sell to mid-market (10+ seats, formal procurement) without SOC 2 Type I. Your timeline: external audit 4–6 weeks. In parallel, pre-write standard MSA template + DPA, wire `/sales/enterprise-package` route that returns auto-generated artifacts (SLA, sub-processor list, security questionnaire answers). This collapses mid-market sales cycle by 2–3 weeks once the audit lands.

**Effort:** 4–6 weeks external audit (parallel), 2 weeks template work  
**Personas converged:** Soraya (Mid-market AE), Geoffrey (Enterprise AE)

### C4. Partner co-sell program (title agents, 1031 intermediaries) as Day-1 channel

You have zero channel sourced revenue. Your adjacent verticals (title agents, 1031 exchange shops, attorneys) have 1,000s of prospect relationships. Design a 2-tier partner program: Referral ($500 per 3-mo customer), Master ($10% ACV, co-branded). Launch with 10 title agents in Texas, 5 1031 intermediaries. Measure: referrals booked, conversion, partner NPS. This is zero-incremental-cost distribution that scales.

**Effort:** 1 week (partner program design), 2 weeks (outreach + pilots)  
**Personas converged:** Yannis (Partnerships lead), Marit (Channel sales), Aaron (BDR cold outbound)

### C5. Customer story production (1 per vertical) as social proof

You have Wendell + 4 other early customers. At least one is a power-user who should be on a 5-min video explaining their problem and how AcreOS solved it. By month-3, you want 3 customer videos (Land, Note, Wholesaler). These are your top-of-funnel social proof while you're too small for G2 reviews. Schedule video calls with power-users in week 4 of their usage.

**Effort:** 1 week (3 videos shot + edited) per month  
**Personas converged:** Brigid (Customer evangelist), Aaron (BDR), Ananya (Deal desk)

---

**Top-1 recommendation for Sales / GTM / Revenue:**  
**Ship the discovery-intake rubric + SDR routing** to unblock founder availability before hiring your first AE. Without it, the founder becomes the full-time sales person and can't build product. The 1-week effort unblocks 3–4 months of founder time and lets you hire a second person into a repeatable motion.

