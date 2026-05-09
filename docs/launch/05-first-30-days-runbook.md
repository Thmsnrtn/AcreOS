# First 30 Days Runbook — Day-by-Day for Customer #1

**Audience:** Founder.  
**Context:** You've just had your first paid customer (or your first seriously-committed free-trial customer). This is your playbook for the next 30 days.  
**Goal:** Get them to D30 verdict of "active" (retained + expanded or committed to continue) instead of "at_risk" or "churned."

---

## Day 1: Provision + Welcome + Start Timer

**Morning (30 min after they sign up):**

1. **Check `/founder-home`**
   - Org created? Count incremented? ✅
   - Endpoint: `/api/founder/executive-dashboard` shows new org.

2. **Open their org settings (`/settings/:orgId`)**
   - Persona set? (land_investor / note_investor / wholesaler)
   - Region set? (county, state)
   - Billing status? (trial active, day 14 timer started)
   - Endpoint: `/api/organizations/:orgId/settings`.

3. **Send the Day-0 welcome email (manually or via automation)**
   - Subject: *"Welcome to AcreOS — your first results arrive tomorrow"*
   - Body:
     ```
     Hey [NAME],
     
     Welcome to AcreOS. Here's what happens next:
     
     - **Today:** You're set up. Your county scan [starts at 11pm PT / uploads processing].
     - **Tomorrow:** You'll get an email with [RESULT TYPE] — check it out.
     - **Day 3:** I'll email: "How's it going? Stuck on anything?" — that's when we fix rough edges.
     - **Day 7:** I'll check in again. At this point you're probably [COMFORTABLE / CONFUSED].
     - **Day 14:** Your free trial ends. If you've used it, we move to $49/month. If not, no charge.
     
     Questions? Slack me @[FOUNDER_NAME] or reply here.
     
     [FOUNDER_NAME]
     Founder, AcreOS
     ```
   - Endpoint: `welcome email is the existing emailService.sendTransactionalEmail("welcome", ...) — no separate scheduled-email function; the D7/D14/D30 cadence fires from sweepAndFireDueSteps() in onboardingAutonomy.ts`.

4. **Start their wedge journey**
   - **If land investor:** Trigger their county scan via `/api/organizations/:orgId/start-scan?county=[COUNTY]`. (Runs tonight.)
   - **If note investor:** Queue a welcome + CSV-upload guide email. Endpoint: `/api/organizations/:orgId/send-csv-guide`.
   - **If wholesaler:** Send a demo deal (pre-built sample deal-room) so they can see what a deal-room looks like before creating one.

5. **Set a calendar reminder for Day 7**
   - Title: "Customer #1 — D7 check-in"
   - Task: Check `/today` activity for this org. If dormant: send "stuck?" email today instead of waiting.

6. **Log in Slack (#customer-1)**
   ```
   ✅ Customer #1 onboarded (Day 1)
   - Name: [NAME]
   - Vertical: [VERTICAL]
   - Persona: [PERSONA]
   - County/region: [REGION]
   - Day-0 email sent
   - D7 reminder set
   - Scan/upload queued
   ```

---

## Day 3: Check Activity + React

**Morning (before 10am PT):**

1. **Open `/today` for their org**
   - Endpoint: `/api/organizations/:orgId/today` or click their org from `/founder-home` → `/today`.
   - Question: Did they log in since yesterday?

2. **If YES (they're active):**
   - Send a short Slack to yourself: "Customer #1 is active on Day 3. Good sign."
   - No action needed. Move on.

3. **If NO (dormant):**
   - Send them an email TODAY (don't wait for Day 7):
     ```
     Subject: Stuck on anything? (AcreOS)
     
     Hi [NAME],
     
     I looked at your AcreOS account and it looks like you haven't logged back in since yesterday. Just checking:
     
     - Did [RESULTS] arrive? (Check your email if you're not sure.)
     - Is there something broken, or is it just not the right time?
     - Want me to walk you through [NEXT_STEP] over Slack or a quick call?
     
     Reply here or let me know. I'm here to help.
     
     [FOUNDER_NAME]
     ```
   - Endpoint: Manual email or `server/services/onboardingAutonomy.ts:sendPersonalizedEmail()`.

4. **Log to `your founder notes` table:**
   - Date: Day 3
   - Customer: [NAME]
   - Status: "Active" or "Dormant"
   - Notes: One sentence. E.g., "Logged in twice, ran county scan, seems engaged" OR "Haven't returned; dormancy risk early."

---

## Day 7: NPS Micro-Survey + Health Check

**Morning (before 9am PT):**

1. **Check `/today` activity again**
   - Total logins (cumulative)?
   - Features used? (scan, pax draft, note upload, deal-room, etc.)
   - Artifacts generated? (count of drafts, deals, notes reviewed)
   - Endpoint: `/api/organizations/:orgId/activation-summary?period=7d`.

2. **Send the Day-7 NPS survey**
   - Payload: Send via in-product survey (if 180-7 ships) or via email link.
   - **In-product (preferred):** `client/src/pages/today.tsx` or `/nps-survey/:orgId` shows a slider (0–10) + text field.
     - Endpoint fires on day 7: `/api/nps-survey/send?orgId=[:orgId]&trigger=d7`.
   - **Via email (fallback):** Link to a survey form (Google Form or Typeform embed).
   - Question: *"How likely are you to recommend AcreOS to another [VERTICAL] operator? (0–10)"*
   - Text: *"What could we improve?"*
   - Endpoint: `server/services/customerHealthScoring.ts:captureDaySevenNPS(orgId)`.

3. **Send the Day-7 check-in email (personalized)**
   - Subject: *"You've used AcreOS for a week — here's what you've done"*
   - Body:
     ```
     Hi [NAME],
     
     One week in. Here's what I'm seeing:
     
     - You've logged in [X] times
     - You've [RUN X SCANS / UPLOADED X NOTES / CREATED X DEALS]
     - You've generated [Y ARTIFACTS]
     
     That tells me [POSITIVE OBSERVATION: "you're comfortable navigating" or CONCERN: "you're testing the waters"].
     
     **Next step:** [SUGGESTION BASED ON USAGE]
     
     If you're stuck or things aren't working the way you expected, reply here or Slack me. I'd rather fix it now than have you ghost on Day 14.
     
     [FOUNDER_NAME]
     ```
   - Endpoint: `D7 check-in is a manual founder send for now (use template 4 in 04-intro-email-templates.md). Auto-send wires through onboardingAutonomy.ts:sweepAndFireDueSteps()`.

4. **Log to `your founder notes`:**
   - Date: Day 7
   - Customer: [NAME]
   - Usage summary: "3 logins, 1 county scan, 2 pax drafts generated"
   - NPS score (if submitted): [NUMBER]
   - Sentiment: "Engaged" / "Cautious" / "Lukewarm"

---

## Day 14: Check-In Call + Upgrade Decision

**Morning (before 10am PT):**

1. **Book a 15-minute call with them**
   - Don't ask if they want to. Say: *"I want to check in with you on Day 14 — let's grab 15 minutes Thursday at 2pm PT."* (Give them 2–3 options.)
   - Why: This is decision day (Day 14 = end of trial). A personal check-in has 5x higher commitment than an email.

2. **Before the call, prep:**
   - Open `/today` for their org. Scan their full activity (logins, features used, artifacts).
   - Pull their NPS response (if they submitted on Day 7).
   - Endpoint: `/api/organizations/:orgId/activation-summary?period=14d`.
   - Prepare 1 observation + 1 question:
     - **Observation:** "You've run 5 county scans and generated 8 offer letters. That tells me you're really using the core."
     - **Question:** "What's one thing that's not working the way you'd expect?"

3. **During the call (15 min):**
   - **First 2 min:** "Thanks for committing to the trial. What's been helpful so far?"
   - **Next 5 min:** Listen. Let them talk about what's working and what's not.
   - **Next 5 min:** "Here's what I'm seeing from your account: [OBSERVATION]. Does that match your sense of it?" → "What would make it perfect?"
   - **Last 3 min:** "Here's the deal: Trial ends today. If you're using this, we move to $49/month starting tomorrow. If you're not, no charge. What do you want to do?"

4. **Call outcomes:**
   - **They say "yes, convert to paid":** Celebrate. Send upgrade confirmation email with payment details. Endpoint: `stripe.createSubscription(orgId, 'solo')`.
   - **They say "let me think about it":** "Fair. I'll give you 48 hours. I'll follow up Friday morning. If you want to stay on the trial a bit longer to test something specific, let me know — I can extend it."
   - **They say "not right now":** "No problem. Let's keep your data safe for 90 days in case you want to come back. I'll check in with you in 6 weeks."

5. **Log to `your founder notes`:**
   - Date: Day 14
   - Customer: [NAME]
   - Call notes: 3–5 bullet points of what they said.
   - Decision: "Converted to paid" / "Paused" / "Churned"
   - Next action: If paused → set a 6-week follow-up reminder.

6. **Post-call email:**
   - If converted: *"You're all set. Welcome to paid AcreOS. Your first invoice is attached. Here's [NEXT FEATURE TO TRY]."*
   - If paused: *"I appreciate your honesty. Let's revisit in 6 weeks. I'll check in via email."*
   - Endpoint: `D14 is a manual founder send for now (template 4). Wires through sweepAndFireDueSteps() once cron is live`.

---

## Day 30: D30 Verdict Email (Automated)

**Morning (auto-fires via cron):**

1. **D30 verdict logic fires (FW-CAMILA-1)**
   - Endpoint: `server/jobs/d30-verdict-cron.ts:evaluateD30Verdicts()` (runs at 6am PT).
   - Logic:
     ```
     IF logins_d30 >= 5 AND artifacts_generated >= 3 AND health_score >= 60:
       verdict = 'active'
       email_template = 'power_user_unlock'
       action = 'flag feature unlock'
     ELSE IF logins_d30 >= 2 AND health_score >= 40:
       verdict = 'at_risk'
       email_template = 'quick_call'
       action = 'flag for retention call'
     ELSE:
       verdict = 'churned'
       email_template = 'win_back'
       action = 'pause account, log churn reason'
     ```

2. **Email dispatched based on verdict:**

   **Active (Power-User Path):**
   ```
   Subject: You've unlocked advanced features 🚀
   
   Hi [NAME],
   
   You've been using AcreOS hard for 30 days. Here's what you've done:
   - [X logins]
   - [Y artifacts generated]
   - [Z features used]
   
   That tells me: you're a power user. We're unlocking:
   - Deal-Hunter Priority (get new deals first)
   - Mailer Campaigns (send blind offers at scale)
   - Deal-Room Network (invite co-investors)
   
   These are free for the next 30 days on your account. After that, they're part of [NEXT TIER NAME] at $[PRICE]/mo.
   
   Want to talk about how to use these? Let me know.
   
   [FOUNDER_NAME]
   ```
   - Endpoint: `D30 active arc fires automatically inside handleActivationVerdict() (FW-CAMILA-1) when sweepAndFireDueSteps() processes the d30 step`.
   - Follow-up: Schedule a 30-min strategy call in the next week.

   **At Risk:**
   ```
   Subject: Quick check-in — is AcreOS working for you?
   
   Hi [NAME],
   
   It's been 30 days. You've logged in [X times] and used [FEATURES]. 
   
   I don't want to guess if something's not clicking. Want to hop on a 15-minute call this week and tell me what's missing?
   
   [2–3 calendar options]
   
   Even if you're not sure, let's talk. That's why I'm here.
   
   [FOUNDER_NAME]
   ```
   - Endpoint: `D30 at-risk arc fires automatically inside handleActivationVerdict() (FW-CAMILA-1)`.
   - Follow-up: Founder calls them within 24–48 hours.

   **Churned:**
   ```
   Subject: Quick question for you
   
   Hi [NAME],
   
   You signed up for AcreOS 30 days ago, but I notice you haven't logged back in since [DAY]. Just want to understand: was it timing, or did something not work?
   
   No hard feelings either way. But I'd rather hear it from you than wonder.
   
   One-line reply would be helpful for me.
   
   [FOUNDER_NAME]
   ```
   - Endpoint: `D30 churned arc fires automatically inside handleActivationVerdict() (FW-CAMILA-1)`.
   - Follow-up: If they reply with a reason, log it in `founder notes (a structured churn-taxonomy table is post-pilot).

3. **Log the verdict:**
   - Table: `onboarding_journeys` (organizationId, activationStatus ∈ {pending, active, at_risk, churned}, activationDeterminedAt) — same shape, real table.
   - Endpoint: `server/db/migrations/[timestamp]-d30-verdicts-table.sql` (should already exist from FW-CAMILA-1).

4. **Founder action based on verdict:**
   - **Active:** Schedule a 30-min call to discuss expansion (vertical packs, higher tier). Log in Slack: "Customer #1 is ACTIVE 🎉. Schedule pack pitch."
   - **At Risk:** Call them within 48h. Ask: "What's one thing that would make you want to keep using this?" Log their answer.
   - **Churned:** Wait for their reply. If they reply with a reason, log in churn taxonomy. If no reply, send a one-time win-back email in 2 weeks.

---

## Throughout Days 1–30: Ongoing Monitoring

**Every 3–5 days, check `/today` for their org:**
- Logins trending up or down?
- Features being used or ignored?
- Any errors in their activity log? (User stuck, feature broken?)
- Endpoint: `/api/organizations/:orgId/today` or `/api/organizations/:orgId/activity-log?period=7d`.

**If you notice a drop-off:**
- Day 5–7 (dormancy): Send the "stuck?" email immediately (don't wait for Day 7).
- Day 10–12 (silence after slight use): Send a "here's what you could try next" email with a specific feature demo link.
- Day 15–17 (before the call): Prepare a 1-on-1 conversation starter based on their account.

**If something breaks:**
- Customer reports a bug or confusing UX → log in Slack + prioritize fix for this week.
- They ask a question → answer within 2 hours (not 2 days).
- They get stuck on a feature → schedule a 5-min Slack screen-share to unblock them.

---

## Metrics to Track (Day 30)

| Metric | Endpoint | What it tells you |
|--------|----------|-------------------|
| Total logins (D0–D30) | `/api/organizations/:orgId/activation-summary?period=30d` | Engagement level |
| Features used (list) | Scan activity, Pax drafts, note uploads, deal-rooms, etc. | Which wedge is working |
| Artifacts generated (count) | Count of pax_drafts, note_uploads, deal_rooms created | Depth of usage |
| NPS score (D7) | `nps_responses` table WHERE org_id = [:orgId] AND response_date = day7 | Early sentiment signal |
| Health score (D30) | `customer_health_scores` table WHERE org_id = [:orgId] | Algorithm verdict |
| D30 verdict | `onboarding_journeys.activationStatus` for this org | Retention signal |
| Time-to-aha | Minutes between signup and first artifact | Onboarding quality |

**Record in `/founder-home` → "Customer #1 Summary" (for your own reference):**
```
Customer #1: [NAME]
Vertical: [VERTICAL]
Signup date: 2026-05-XX
D30 verdict: [ACTIVE / AT_RISK / CHURNED]
D30 logins: [X]
D30 NPS: [X]
D30 artifacts: [X]
Next step: [EXPANSION CALL / RETENTION CALL / CHURN RECOVERY]
```

---

**Version:** 2026-05-08  
**Owner:** Founder  
**Dependency:** `onboardingAutonomy.ts` email transport wired, `customerHealthScoring.ts` live, `onboarding_journeys.activationStatus` populated by FW-CAMILA-1 logic, `/today` activity page live, `activation_events` telemetry live

