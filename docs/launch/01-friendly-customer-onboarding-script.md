# Friendly Customer Onboarding Script — First 5 Customers

**Audience:** AcreOS founder, doing the first 5 customer calls (May–June 2026).  
**Duration:** 30 minutes total (hard stop).  
**Goal:** Get the customer to first aha moment + commit to 14-day trial + gather feedback for D30 verdict.

---

## Pre-Call Prep (30 seconds)

**Do this 5 minutes before the call:**

1. Open `/founder-home` (your dashboard).
2. Search for the customer's org in the sidebar. Click it.
3. Scan their org settings (`/settings/:orgId`):
   - How many leads do they have? (cold start vs migrating)
   - What vertical did they pick? (land_investor / note_investor / wholesaler)
   - Has anyone logged in since signup? (tells you if they're active)
4. If they picked "land_investor," have 1-2 local county names ready (ask them where first).
5. If they picked "note_investor," have a sample CSV column mapping in mind.

**Why:** You're personalized, not generic. They feel seen.

---

## Part 1: Hello + Context (5 minutes)

**Opening (verbatim):**

> "Hey [Name]! Thanks for signing up for AcreOS. I'm the founder. I'm doing these calls for the first five customers because I want to make sure we're actually solving the right problem. Before I talk about the product, I want to understand what you're trying to do. How'd you hear about us?"

**Listen. Don't pitch yet.** If they say:
- "Wendell Hart referred me" → *You have credibility; skip the problem validation.*
- "Found you on [some podcast]" → *Take a note for the synthesis; you have a channel.*
- "Random Google" → *They're still evaluating; you're one of five options.*

**Then ask (one of these):**

> "What's the land deal you're working on right now that made you sign up?"

OR

> "Walk me through what you do with your notes portfolio today — how do you track payments, yields, all of it?"

OR

> "You picked wholesaler. Walk me through your last assignment deal — how'd you structure it, who got what?"

**Why:** The next 15 minutes are wedge-specific. You need to know if they're a buyer (cold start), a holder (note investor migrating from spreadsheet), or a dealmaker (wholesaler doing three deals a month). Ask once, listen for 90 seconds. They'll tell you everything you need to know.

---

## Part 2: Walk Through Their Wedge (15 minutes)

### If they're a **Land Investor** (most likely for first 5):

**Say:**

> "So you've got that land deal in [county]. Let's build it in AcreOS real quick, and you tell me if this is faster than what you're doing today."

**Do this:**

1. **If they have zero leads in the system:** 
   - Walk them to `/properties` (the map tab should be default by June).
   - Say: *"This is where you'd search for properties. Pick a county you know. I'll walk you through the scan."*
   - Click a county. Show the scan-start button.
   - Say: *"AcreOS runs a night scan on all tax-delinquent, distressed parcels in that county. By tomorrow morning, you'll see 200–2,000 parcels depending on county size. Sound useful?"*
   - **Don't run the scan in the call.** Say: *"I'll start it after we hang up. You'll get an email tomorrow with results."*

2. **If they already have leads:**
   - Go to `/leads` and find one of their leads.
   - Click into the lead detail. Say: *"This is the one you mentioned, right?"*
   - Show the Pax draft (offer-letter generator). Say: *"Pax analyzed the comps, the holdout price from the county, what you'd need to close in 30 days. He drafted an offer letter for you. Want to see it?"*
   - Click "Generate Pax Draft." (This fires in real-time; show them.)
   - Say: *"You download this, print it, mail it, or email it. How does this compare to what you write by hand?"*
   - **Listen for the objection.** If they say "my offers are more aggressive," say: *"That's the one-line diff we'd add. What's the aggression factor? I'll build it into the next draft."*

3. **Then ask about money:**
   - Say: *"Now, you're tracking payments on this deal, right? How are you doing that today?"*
   - If they say "spreadsheet": *"Show me the columns you track."* Let them describe it (payoff amount, payment date, extra principal, late fees, yield).
   - Say: *"We build all of that into a note ledger. You upload your notes, we track every payment, and every January we generate your 1098-INT for the IRS. That's the missing piece for land investors today."*
   - Say: *"That's where we're different from Zillow / Redfin / other platforms. We care about what happens after you buy — the notes, the payments, the money."*

### If they're a **Note Investor** (less likely, but possible):

**Say:**

> "You've got [X] notes in a portfolio. Let's upload them in AcreOS and I'll show you what you can't see today."

**Do this:**

1. Go to `/money/notes` (or `/portfolio` if they're coming in via `onboarding-v2.tsx:1030`).
2. Say: *"You have a CSV of notes, right? Borrower, principal, rate, payment schedule?"*
3. Walk them to the upload button (in `PortfolioImportStep` in `onboarding-v2.tsx:288-480`).
4. Say: *"Upload it. We'll map columns, and within 30 seconds you'll see all your notes. Then we calculate: yield-to-maturity, cash-on-cash, at-risk borrowers (late >90 days), and we flag which notes are due to mature in the next 12 months."*
5. If they ask about payment tracking: *"Every month, you tell us what you got paid. We update the yield, we recalculate maturity, and we flag if a borrower is behind. That's the part you do in a spreadsheet today, right?"*
6. Say: *"For a note investor, we're not the deal-finder like we are for land. We're the ledger you don't have to maintain by hand."*

### If they're a **Wholesaler**:

**Say:**

> "You close three deals a month? Walk me through the last one — who was the buyer, how'd you structure the fee?"

**Do this:**

1. Go to `/deals` (or build the flow in real-time if `/deals` isn't live yet).
2. Say: *"An assignment. You controlled the property with a lock, found a buyer, assigned your interest, kept the fee."*
3. Say: *"In AcreOS, you'd model that: purchase price, ARV, your assignment fee, buyer's closing costs. We spit out: 'This deal is $X profitable for you at a $Y fee.' So you know your walk-away number before you're in the room with the buyer."*
4. If they ask about co-wholesalers: *"You can invite them into the deal in AcreOS, so you're both tracking the same numbers. No more 'I thought you owned 50%' fights."*
5. Say: *"For wholesalers, we're the deal-math tool. The thing you do in a napkin calculation today."*

---

## Part 3: Pricing Conversation (5 minutes)

**After they've seen the aha moment, pause and say:**

> "Okay, so the question is: do you want to use AcreOS for the next two weeks? It's free. No credit card. Just log in and try."

**If they say "yes immediately":** 
→ Go to Part 4. (They're sold.)

**If they hesitate or ask "how much does it cost?":**

Say: *"After the 14-day trial, it's $49 a month for Solo (you, all the tools). If you bring someone else in — a VA, a co-investor, a partner — it's $99 a month for Operator."*

**Possible push-back #1:** *"That's expensive for a spreadsheet."*

**Response (verbatim):**

> "I get it. Here's the difference: a spreadsheet is a flat file. We're a system. We talk to the county (scan, comps, tax data), we talk to e-sign (Pax offers your customers can sign), and we talk to your calendar (reminders for payment due dates, tax deadlines). A spreadsheet doesn't do those things. It's not $49/month to organize; it's $49/month to automate the three things that eat your time every week. The deal-hunter, the offer-writer, and the payment-tracker."

**Possible push-back #2:** *"I'm trying three products right now. I need to see if this one sticks before I commit."*

**Response (verbatim):**

> "Perfect. Use it free for 14 days. On day 14, I'll reach out, and you tell me: did you come back? If yes, we'll switch to paid, and you'll never think about it again ($49/month on auto-pay). If no, we call it here, no hard feelings. The question I want to answer is: do *you* keep coming back? That's the only metric that matters."

**Possible push-back #3:** *"Can you do a custom price for me?"*

**Response (verbatim):**

> "I could. But here's the thing: if I cut you a deal, the next customer wants a cut too. So I don't do custom pricing for the first year. If you use AcreOS and hit $50K ARR in land deals, we'll talk about a higher tier at a better price. But right now, the pricing is what it is, and it's the same for everyone. Fair?"

**Why these words?** You're not selling; you're educating them on the unit economics. You're betting on their usage, not your discounting power.

---

## Part 4: Commit or Pause (5 minutes)

**Say:**

> "So, two options: one, you start the 14-day trial right now, I'll send you a welcome email with the first steps, and I'll check in on day 7 to see if you're stuck. Or, two, you need to think about it, and that's fine — I'll follow up next week. Which one?"

**If they say "let's do it now":**

1. Have them confirm their email address.
2. Send the welcome email (`server/services/onboardingAutonomy.ts` fires at signup, not at call end — **fix this in the FW if needed**).
3. Say: *"You'll get an email from us in the next 30 seconds with your first steps. The free trial is 14 days. On day 7, expect a 'how's it going?' email from me. On day 14, if you're using it, we turn on billing. If you're not, no charge."*
4. Say: *"What county / vertical are you starting with first?"*
5. Say: *"I'm going to run your scan / start your upload right now. You'll wake up tomorrow to results."*

**If they say "let me think about it":**

1. Say: *"Fair. I'm going to send you a 2-minute video showing what we just walked through. And next Tuesday, I'll ping you — just a quick 'ready to give it a shot?' text."*
2. Take their preferred contact method (email, text, Slack if they have it).
3. **Send the video within 1 hour.** (Async follows-up. 2-min max. Route: [TBD; Asher's team should film 5 vertex-specific demos by launch].)

---

## End-of-Call Action Items (from your side)

**For both of you (say these out loud):**

| You | Them |
|-----|------|
| "I'm starting your [scan/upload/deal-create] right now — you'll get an email tomorrow morning." | "Check your email tomorrow morning and take a look at the results." |
| "Day 7: I'll send you 'how's it going?' email + we check in if needed." | "Log in at least 3 times in the first 7 days (it takes 5 min each). Just get comfortable." |
| "Day 14: D30 verdict email lands (this auto-fires; tells us if you're a fit)." | "If you're using it, we'll bill you. If not, we don't. No friction." |
| "I'm in Slack [link]. DM me if you're stuck." | "If something breaks or doesn't make sense, message me. I'll fix it or explain it." |

---

## Call Debrief (you, after they hang up)

1. **Log to `customer_interviews` table:**
   - Customer name, vertical, org_id
   - Wedge articulated (what problem they're solving)
   - One sentence of feedback (e.g., "Wanted map view first instead of table — we need that sooner")
   - Stumbling blocks (e.g., "confused about payment tracking vs lead tracking")

2. **Slack note to the team:**
   - Tagging: #customer-1, #customer-2, etc.
   - One line: "Wendell-style operator, deep on note ledger, wants paranoid amortization testing"
   - This feeds into the synthesis / weekly retro.

3. **Set a calendar reminder for day 7:**
   - Check `/founder-home` → click their org → scan `/today` activity.
   - If they haven't logged in: send the "stuck?" email immediately (don't wait for day 7).

---

## Common Objections + Comebacks

### "Why should I trust you with my deal data?"

**Response:** *"Three things: one, we encrypt everything (RSA-256, not plaintext). Two, we don't sell your data to lenders or brokers — that's built into our terms. Three, you own your data; if you leave, we export it as CSV in 24 hours. You're in control. That's the contract."*

### "Do you integrate with [Zillow / MLS / my CRM]?"

**Response:** *"Not yet. That's our roadmap for month-3. Right now we're focused on getting the core (deal-finding, offer-writing, payment-tracking) perfect. Integrations come after we know the core works for you."*

### "What if I want to bring my team in?"

**Response:** *"You upgrade to Operator ($99/mo). You can add 2-5 people depending on your tier. Each person gets a login. You share leads, notes, deals, and run bulk actions together. That's the difference between Solo ($49, you only) and Operator ($99, you + team)."*

### "Can I use this for [not your vertical]?"

**Response:** *"We built this for [your vertical]. If you want to use it for [other vertical], it'll work for the [core tool], but we haven't built the [vertical-specific feature]. If you're serious about [other vertical], let's talk in month-2 after you've used us for your main vertical."*

---

## Metrics to Track

After each call, record in your weekly founder summary (to be shown to the board):

- **Time-to-aha:** How long did they spend before they saw the first artifact (Pax draft / scan results / note yield)?
- **Drop-off point:** Where did they ask "wait, how do I do X?" (identifies confused UX).
- **Vertical penetration:** Land / Note / Wholesale ratio in your first 5.
- **Immediate commitment rate:** How many said "yes, start now" vs "let me think"?

After 5 calls, you'll know which wedge is sticking and which needs rework.

---

**Version:** 2026-05-08  
**Owner:** Founder  
**Dependency:** `/founder-home` exists, org settings surface live, persona-aware checklist live by 2026-06-08
