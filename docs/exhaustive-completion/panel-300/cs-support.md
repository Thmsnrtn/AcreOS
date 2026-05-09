# Customer Success / Support — 300-Persona Panel

**Category slots:** 181–195  
**Date:** 2026-05-08  
**Synthesis methodology:** 15 independent memos clustered into 5 consensus recommendations

---

## Persona Memos

### 181. Camila Reyes — Head of CS

**Lens:** Health-score taxonomy; activation verdict branching.

**What I see:** You have `customerHealthScoring.ts` wired and D0/D3/D7/D14/D30 email sequences live. Health scores classify customers as `active` / `at_risk` / `churned`, but the three diverging email branches are half-built. You know who's about to churn; the customer doesn't. The asymmetry is the gap. Also: there's no `/admin/power-users` dashboard or NPS micro-survey UI, so data collection is incomplete.

**Highest-leverage move:** (1) Complete the D30 activation-verdict branching: `active` → upsell email + Feature-Flags unlock, `at_risk` → "quick 15-min call?" email, `churned` → single-question survey. (2) Ship `/admin/power-users` dashboard: query HealthScore ≥80 for 14 consecutive days + 5+ features used + 10+ artifacts + 5+ logins/week. (3) Ship in-product NPS at D7 (slider + open text, one-shot). Wire all three into `/founder-home` to surface cohort trends. By month-2, you'll have real branching logic and activation data.

**Effort:** 2 weeks (branching + dashboard + NPS UI)

---

### 182. Søren Christensen — CSM SMB

**Lens:** 1:many CSM motion; 80-account coverage model.

**What I see:** At 5 customers, you don't need a CSM. At 50 customers, you have a choice: hire 1 CSM per 15 accounts (expensive) or build 1:many automation (scalable). The move is: pre-build the 1:many motion so that when you hire a CSM, they inherit repeatable workflows.

**Highest-leverage move:** Design a 1:many CSM motion: (1) Friday health-score digest (Sophie gets a report: top 80 accounts ranked by HealthScore + week-over-week trend), (2) pre-churn ladder automation (5d/10d/14d/21d/30d no-login escalation, conditional on prior rungs not converting), (3) D7/D14/D21 checkpoint emails (auto-fire based on health score band, but CSM can override), (4) one monthly "power-user spotlight" email (Sophie picks 1 power user, writes a 100-word profile of how they use AcreOS). By month-3, Sophie owns 40 accounts using this motion; by month-6, she owns 80.

**Effort:** 3 weeks (automation engine + digest + spotlight template)

---

### 183. Aditi Bhattacharyya — CSM enterprise

**Lens:** QBR cadence; multi-threaded relationships.

**What I see:** You don't have enterprise customers yet (Series-B). But when you do, the QBR (Quarterly Business Review) is the motion that retains them. The QBR is: founder + enterprise customer + CFO, 45 minutes, quarterly. Agenda: (1) review NRR / usage trends for their seats, (2) highlight power users + underutilized seats, (3) pitch vertical-pack expansion, (4) collect feedback for roadmap.

**Highest-leverage move:** Design a QBR template (1-page): sections for account health (NRR, seat-utilization, power-user count), product feedback (bug reports + feature requests), expansion opportunities (unused verticals + co-investor/team add-ons). Wire a `/sales/enterprise-qbr` route that pre-populates the template with real data (from `/api/founder/financials/by-org`). By month-6, when your first enterprise customer ships, you'll have a repeatable 45-min ritual that builds trust.

**Effort:** 1 week (template + data wiring)

---

### 184. Marcel Kowalski — Support engineer

**Lens:** Tier-2 support; reproducer quality.

**What I see:** You'll have tier-1 support (founder answers urgent customer emails). When you scale to 30+ customers, you'll have 5–10 "stuck" tickets per week (customer can't figure out how to export, note ledger isn't calculating, etc.). Without a tier-2 support engineer who can reproduce bugs + trace logs, you'll spend 2h per ticket.

**Highest-leverage move:** Design a support ticket workflow: (1) customer emails [support@acreOS.io](mailto:support@acreOS.io), (2) founder's autoresponder: "thanks, I'll look into it in 24h." (3) If it's a usage question, founder answers directly. If it's a bug, founder opens a Slack channel (#support-ticket-XXX) + tags Marcel. Marcel's job: reproduce the bug using the customer's account data (with permission), trace the root cause (logs + schema), open a GitHub issue. Measure: MTTR (mean time to resolution, target: <24h for bug tickets, <1h for usage questions). By month-3, Marcel is the expert; founder is the communicator.

**Effort:** Ongoing (as tickets arrive, hire Marcel month-2 when volume justifies)

---

### 185. Petronella Rietveld — Onboarding specialist

**Lens:** First-30-day onboarding; milestone discipline.

**What I see:** Your customer-launch kit has D0/D3/D7/D14/D30 emails. The onboarding itself (what the customer does each day) is implicit in the FW-YUNA-1 persona-aware checklist. What's missing is a dedicated onboarding specialist who does day-1 provisioning (create account, auto-populate initial deal, send welcome video link).

**Highest-leverage move:** Build a `/onboarding/welcome` flow that fires on signup: (1) Day-1: auto-send welcome email + 2-minute video (vertical-specific), (2) Day-3: "have you scanned your first county / uploaded your notes yet?" nudge email + offer a 15-min walkthrough call, (3) Day-7: checklist progress update (x% complete). When Petronella is hired, she owns the walkthrough calls + personalized help. Measure: % of day-1 signups who complete the checklist by day-10 (target: >70%). By month-3, Petronella's job is "hand-hold the 5% who need help"; 95% self-serve.

**Effort:** 2 weeks (welcome flow + nudge automation)

---

### 186. Anouk Dewulf — Training engineer

**Lens:** Customer training; curriculum design.

**What I see:** You don't have formal training yet. When you scale to 50+ customers, requests like "can you train my team on the deal-room feature?" will multiply. Without a curriculum + video library, you'll be on 10 training calls/week.

**Highest-leverage move:** Build a training library (3 modules per vertical): Land Investor: (1) "Parcel Scanning 101" (5 min), (2) "Offer Letter Generator (Pax) Tutorial" (5 min), (3) "Note Ledger Walkthrough" (10 min). Each video: screencast + transcript + quiz (3 multiple-choice). Wire into `/academy` (new section). When a customer asks for training, Anouk sends them the link + offers 1 live 30-min followup. Measure: % of customers who watch ≥1 video (target: >40%), quiz completion rate (target: >60%). By month-6, 80% of training is self-serve.

**Effort:** 3 weeks (scripting + recording + quiz authoring)

---

### 187. Yael Ben-David — Knowledge base author

**Lens:** KB searchability; documentation structure.

**What I see:** You have a help center (nascent). You don't have a "how do I..." KB. Customers will search for "how do I bulk-export leads?" or "what's the difference between a note and a deal?" Without good KB hits, they'll email support.

**Highest-leverage move:** Build a 30-article KB focused on the wedge: Land Investor: (1) "Parcel Scanning: What It Is & How It Works" (covers how AcreOS scans counties), (2) "Offer Letters: Generating Pax Drafts" (step-by-step UI walkthrough), (3) "Note Ledger: Tracking Payments" (covers amortization + 1098-INT), (4) "Bulk Export: Downloading Your Data" (CSV export options), (5–30) edge cases. Each article: title + 1-paragraph summary + 5–7 steps + screenshots. Optimize for search (target: "land investor [feature]" queries → Acre OS KB in top-3 Google results by month-6). Measure: article views + % of tickets that mention "I looked at the KB" (target: >30%). By month-4, 40% of support volume is self-serve KB lookups.

**Effort:** 4 weeks (article authoring + screenshot/GIFs)

---

### 188. Tomohiro Sato — Community manager (paid)

**Lens:** Paid community engagement; lurker vs reader math.

**What I see:** The founder-letter cadence is free community. At scale (50+ customers), a paid community (Discord, Circle, Mighty Networks) becomes a retention lever. But paid community needs moderation + engagement ops, which founder can't do alone.

**Highest-leverage move:** Don't build paid community yet. Instead, measure the free community (founder-letter + `/community/feed` + Twitter replies) and see if engagement justifies a paid tier. Metric: what % of customers are "active" in free community (open letter email + reply or share at least once per month)? If >40% by month-4, pilot a Discord with a gating: "free customers can read #announcements; $199+/mo customers get access to #ask-founder + #deal-showcase." Tomohiro's job: moderate + seed conversations. Measure: activity (posts/week), retention (% of members who return next month). Target: >80% retention. By month-6, you'll know if paid community has legs.

**Effort:** Defer until month-4 (measure free community first)

---

### 189. Aurelio Castaño — Voice-of-customer lead

**Lens:** Feedback aggregation; feedback-to-roadmap loop.

**What I see:** You have 5 customer calls + D30 verdict data + support tickets, but no "voice of customer" synthesis. Feedback lives in: Slack (#customer-1, #customer-2), your founder notes, support emails, Camila's dashboard. No single source of truth.

**Highest-leverage move:** Create a `/founder/customer-feedback` dashboard: (1) weekly digest of feedback themes (top 5 requested features, top 3 reported bugs, top 2 praise points), (2) feedback source tracking (which customer + which week), (3) roadmap linkage (which feature request is mapped to which backlog item). Wire into a weekly retro: founder + Camila + Sophie (CSM) read the digest aloud, discuss, update backlog. Measure: % of roadmap decisions that cite customer feedback (target: >80% by month-2). By month-3, you'll have a clear feedback loop that customers feel heard.

**Effort:** 1 week (dashboard) + 1h/week ongoing synthesis

---

### 190. Esmé Dansereau — NPS analyst

**Lens:** NPS instrumentation; sentiment-tagging discipline.

**What I see:** FW-CAMILA-2 ships the in-product NPS micro-survey at D7. But the NPS data lives in a table with no aggregation. You don't know: which verticals have higher NPS? Which features correlate with NPS >8? What specific feedback comes from detractors?

**Highest-leverage move:** Wire `/api/founder/nps/recent` to return: (1) weekly NPS trend (by vertical + overall), (2) sentiment tagging (automate: positive keywords like "love" / "faster" → sentiment +1, negative like "bug" / "slow" → sentiment -1), (3) detractor feedback clustering (which 3 themes come up most in NPS <6 responses?). Create a `/founder-home` tile showing "NPS trend: 45 → 52 (up 7 points this week)." Measure: NPS velocity (trending up = retention is working). Target: NPS ≥50 by month-3, ≥60 by month-6. This is your primary retention metric.

**Effort:** 2 weeks (NPS aggregation + sentiment tagging + UI)

---

### 191. Lakshman Reddy — Expansion CS

**Lens:** Expansion-only motion; feature-adoption as leading indicator.

**What I see:** Your tier-pricing (`$49/$99/$199/packs`) has 5 upgrade paths (Solo→Operator, Operator→Pro, add-on packs). But you have no motion that says "customer, you're using deal-rooms 3x/week; you should upgrade to Operator to add your partner." Expansion is organic (customers self-upgrade) or it doesn't exist.

**Highest-leverage move:** Build a feature-adoption leading indicator: Land investor using deal-rooms ≥2x/week + hasn't invited anyone yet = high expansion risk. Send them a 2-minute video: "Here's how to invite your partner in AcreOS. Operator tier ($99/mo) lets you both see the same deals in real-time." Track: which customers have "invitation sent" event in the last 30 days? If they don't, they're not going to expand. Target: 30% of Solo customers upgrade to Operator by month-4. Measure: expansion MRR (sum of tier-ups). Target: $200+ expansion MRR by month-3.

**Effort:** 2 weeks (feature-tracking + upgrade-nudge automation)

---

### 192. Brid O'Connor — Retention CS

**Lens:** "Save the customer" motion; churn-call cadence.

**What I see:** Your pre-churn ladder (5d/10d/14d no-login escalation) fires emails. But the emails have no teeth. The customer hasn't logged in for 14 days + they get an email saying "we miss you!" — the only real intervention is a founder phone call. Without a dedicated "save the customer" ritual, churn is inevitable.

**Highest-leverage move:** Design a 3-tier save motion: (1) Tier-1 (7d no-login): auto-email "did something break? here's the most common issues," with a 2-min help video. (2) Tier-2 (14d no-login): founder sends a personalized email: "Hey [Name], I noticed you haven't been in AcreOS for 2 weeks. What's going on? I want to help — let's jump on a call." (3) Tier-3 (21d no-login): founder calls directly (no email first). Brid's job: screen tier-2/3 customers before founder calls (collect any context from logs/usage + prep talking points). Measure: % of at-risk customers who return after intervention (target: >50%). By month-6, 80% of "saves" happen at tier-1 (self-serve help) and tier-2 (founder email), not tier-3 (phone call).

**Effort:** 2 weeks (save motion automation + context dashboard)

---

### 193. Magnus Ingvarsson — Escalation manager

**Lens:** Top-of-pyramid customer issues; executive comms.

**What I see:** You don't have top-of-pyramid customers yet (that's enterprise). But when a $500K+ ACV customer reports a P0 bug (note ledger calculation error), the response time is 15 minutes, not 24 hours. The exec comms (incident updates to the customer's CFO) requires a dedicated person.

**Highest-leverage move:** Design an escalation playbook (pre-ship): (1) customer reports P0 (data loss / security / calculation error), (2) founder gets a Slack alert (tagged @founder), (3) founder has 30 min to triage (is it real P0? which system affected?), (4) if yes: founder opens `/founder/escalations` dashboard and creates an incident (title + impact assessment + ETA), (5) Magnus sends an auto-email to customer: "We've confirmed your report. Here's what we found + what we're doing. Next update in 2h." (6) Magnus sends 2-hour updates until resolved. Measure: MTTR for P0s (target: <1h triage + fix), customer satisfaction with comms (target: customer says "you were transparent the whole time"). By month-6, you'll have handled 2–3 P0s and customers will trust your emergency response.

**Effort:** 1 week (escalation workflow + customer template)

---

### 194. Yui Nakahara — Support ops

**Lens:** Support tooling; response-time SLA.

**What I see:** You have a Slack channel (#support) where customers DM you. There's no ticket system, no SLA tracking, no queue. As you scale, support becomes chaos without tooling.

**Highest-leverage move:** Integrate a lightweight support system: Intercom or Zendesk (free tier). Route emails to Intercom → Slack alert → founder/Marcel responds → Intercom auto-closes after 7d inactivity. Measure: first-response time (target: <4h during business hours), CSAT score (ask "did we help?" at ticket close, target: >4.5/5). By month-2, you'll have SLA discipline. By month-3, if support volume grows to 10+ tickets/week, Yui's job is ops: triaging incoming + ensuring no ticket falls through cracks.

**Effort:** 1 week (Intercom setup + routing + SLA definition)

---

### 195. Cyril Béjart — CS-product liaison

**Lens:** Feedback-prioritization framework; CS + product alignment.

**What I see:** Camila (CS head) will be saying "customers want bulk actions in `/leads` and map-view on `/properties`." Wendell's memo says the same. But you have 50 backlog items and 8 eng weeks. Which ones ship first? Without a framework, it's a shouting match.

**Highest-leverage move:** Design a CS-product feedback framework: each feature request gets scored on 4 axes: (1) customer count affected (1–5 scale), (2) churn risk if not fixed (1–5 scale), (3) expansion opportunity (1–5 scale), (4) eng effort (1–5 scale). Sum = priority score. Top scores get queued for sprint planning. By month-2, you have a 1-page "customer-requested features" chart that shows why bulk actions in `/leads` (affects 5 customers, high churn + expansion, 2w effort) ranks higher than a 404-page redesign (affects 0 customers, low churn, 3d effort). Measure: % of shipped features that came from customer requests (target: >40%). By month-6, customers will feel heard.

**Effort:** 1 week (framework + dashboard)

---

## Category Synthesis: Customer Success / Support

**Consensus calls from the 15 memos above:**

### C1. Complete D30 activation-verdict branching + power-user identification

Health scores are live but branching is half-built. Complete: (1) branching logic (active → upsell, at-risk → call offer, churned → survey), (2) `/admin/power-users` dashboard (HealthScore ≥80 for 14d + usage signals), (3) in-product NPS at D7. Wire all three into `/founder-home`. This closes the feedback loop and turns data into action. 2 weeks of work, massive payoff on retention.

**Effort:** 2 weeks  
**Personas converged:** Camila (CS head), Søren (CSM SMB), Esmé (NPS analyst)

### C2. 1:many CSM automation before hiring any CSM

The 1:many motion (health-digest + pre-churn ladder + checkpoint emails + power-user spotlights) is the foundation. By the time you hire Sophie (CSM #1), she inherits repeatable workflows that let her own 40–80 accounts. Without automation, 1 CSM can only own 15–20 accounts (expensive unit economics).

**Effort:** 3 weeks  
**Personas converged:** Søren (CSM SMB), Lakshman (Expansion CS), Brid (Retention CS)

### C3. Support ticket workflow + KB library + Intercom integration

Pre-hire support structure: (1) Intercom routing + SLA tracking, (2) 30-article KB (vertical-specific), (3) tier-2 reproducer workflow for bugs. By month-3, 40% of incoming support is self-serve (KB) and 30% is handled by tier-1 (founder). Only 30% needs tier-2 (bug investigation). This scales support without hiring headcount until month-4.

**Effort:** 1 week (Intercom) + 4 weeks (KB) + 1 week (tier-2 workflow) = 6 weeks total  
**Personas converged:** Marcel (Tier-2), Yael (KB), Yui (Support ops)

### C4. Voice-of-customer synthesis dashboard + feedback-to-roadmap framework

Customer feedback lives scattered (Slack, emails, notes). Centralize via `/founder/customer-feedback` dashboard + weekly synthesis ritual. Wire into a CS-product prioritization framework (4-axis scoring: customer count + churn risk + expansion + eng effort). This makes roadmap decisions transparent + traceable to customer needs.

**Effort:** 1 week (dashboard) + 1 week (framework) = 2 weeks  
**Personas converged:** Aurelio (Voice of customer), Cyril (CS-product liaison), Camila (CS head)

### C5. Onboarding + training + escalation playbooks (pre-hire structure)

Design (but don't fully build) three playbooks: (1) onboarding (day-1 provisioning + day-3/7 nudges), (2) training library (3 videos per vertical + quizzes), (3) escalation (P0 triage + customer comms + 2h updates). By the time you have customers needing these, the motions are repeatable. 1 week of design now saves 4 weeks of chaos later.

**Effort:** 1 week (design phase)  
**Personas converged:** Petronella (Onboarding), Anouk (Training), Magnus (Escalation)

---

**Top-1 recommendation for Customer Success / Support:**  
**Complete the D30 activation-verdict branching + ship the 1:many CSM automation** in parallel. Without branching, you have data but no action. Without 1:many automation, hiring your first CSM creates an expensive bottleneck. Together, these two moves turn CS from reactive (fire-fighting churn) to proactive (predicting and preventing churn). 2–3 weeks of work unblocks 3–4 months of CS maturity.

