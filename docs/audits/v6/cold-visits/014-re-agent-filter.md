# Cold Visitor Simulation 014: Real Estate Agent (Non-Target Filter Test)

**Visitor profile:** Licensed residential real estate agent, 8 years experience. Works at a Keller Williams office. Uses kvCORE as her primary CRM. Manages 20-30 active buyer/seller clients at any time. Heard "AcreOS" mentioned at a real estate networking event and Googled it out of curiosity. Has never done a land deal, does not invest in land, and has no interest in land investing. Her business is 100% residential buyer/seller representation.

**Date:** 2026-04-18 (re-score round)
**Pages visited:** Landing only (did not proceed to Pricing)
**Source URL:** https://acreos.fly.dev/
**Landing page version:** v6 (post-headline change, post-badge removal)

---

## FILTER TEST: Does the new headline correctly filter out non-target visitors?

**Result: YES. This visitor self-selects out within 8 seconds.**

---

## Question 1: CATEGORY (60 seconds on landing page)

**Score: 5/5 (as a filter -- the product correctly signals "not for you")**

### What this visitor sees

Headline: **"The AI-Powered Platform for Land Investors."** Subhead: *"Find motivated sellers. Analyze parcels. Send direct mail. Close deals. All in one platform."*

### What the visitor says out loud

> "'The AI-Powered Platform for Land Investors.' Land investors. I'm not a land investor. I'm a real estate agent."

> "Done. Next."

> "Wait, let me scroll for 5 seconds to make sure I'm not missing something..."

> "'Find motivated sellers. Analyze parcels. Send direct mail.' Parcels. Direct mail. This is a land flipping tool. I don't flip land. I represent buyers and sellers of houses."

> "'How AcreOS Works: Import or Find Parcels, AI Analyzes Each Parcel, Launch Direct Mail Campaigns, Close Deals.' This is a land acquisition funnel. My job is not acquisition -- it's representation."

> "I see the features: Portfolio Mapping, AI Valuations, AI Deal Intelligence, Document Generation, Campaign Automation, Compliance. Every single one of these is framed around land investing, not agent work. 'Visualize every parcel on interactive maps' -- I use MLS for that. 'AI copilot scores leads' -- my leads come from Zillow and referrals, not from cold outreach. 'Campaign Automation with SMS, email, and direct mail sequences' -- I use kvCORE for email drips to my sphere of influence."

> "The bottom CTA says 'Ready to close more land deals with less effort? Join land investors who are finding better parcels and closing faster with AcreOS.' Land deals. Land investors. Not agents. Not brokers. Not residential."

> "This is not for me. Clear as day. Closing the tab."

### Assessment

This is the critical test case. In the initial scoring round, Visitor 001 (real estate agent) encountered the headline "The operating system for real estate professionals" and spent a full 5 minutes before concluding the product was not for them. The broad headline wasted their time and created a negative impression.

With the new headline "The AI-Powered Platform for Land Investors," this visitor self-selects out in under 10 seconds. The word "Land Investors" is unambiguous. There is no cognitive overhead, no confusion, no wasted time. The visitor does not feel misled -- they feel correctly informed.

This is exactly what good positioning should do: attract the right people AND repel the wrong people quickly and respectfully.

---

## Question 2: VALUE PROP (next 60 seconds)

**Score: N/A -- Visitor has already left**

### What the visitor would say if forced to read

> "None of these features apply to my job. Portfolio Mapping with parcel boundaries? I have MLS. AI Valuations powered by comps? I have CMA tools in kvCORE. AI Deal Intelligence that 'scores leads and drafts offers'? My leads don't need scoring -- they called me because they saw my listing. Document Generation? I use Dotloop through KW."

> "There is zero overlap between what I do (represent buyers and sellers in residential transactions) and what this product does (help investors find, evaluate, and acquire vacant land). Zero."

### Assessment

Value proposition is irrelevant. This visitor would not engage with it because the category filter already worked. This is correct product behavior.

---

## Question 3: PRICING (2 minutes)

**Score: N/A -- Visitor never reached pricing page**

### Assessment

The visitor closed the tab before clicking "View Pricing." The pricing page was never tested. This is the ideal outcome -- a non-target visitor should not waste time evaluating pricing for a product that is not for them.

---

## Question 4: SIGNUP READINESS (5 minutes total)

**Score: N/A -- Visitor would not sign up**

### Would you sign up?

**No. Not even for Free.**

### What the visitor says out loud

> "I have absolutely no reason to sign up. This is a land investor tool. I am not a land investor. The headline told me that immediately. I respect that they're clear about what they are."

> "If someone at my office asks about AcreOS, I'll say: 'It's a CRM for land investors. If you flip land, check it out. If you're an agent, it's not for you.'"

### Assessment

The visitor would not sign up but has a neutral-to-positive impression of the brand. They were not misled. They were not confused. They would accurately describe the product to others. This is a successful filter interaction.

---

## Question 5: FIRST-RUN MENTAL MODEL (hypothetical)

**Score: N/A -- Visitor would never reach this stage**

### Assessment

Not applicable. The filter worked correctly.

---

## Summary

| Question | Score | Notes |
|----------|-------|-------|
| 1. Category | 5/5 (filter) | "Land Investors" in headline = instant self-selection out |
| 2. Value Prop | N/A | Never engaged; would see zero relevance if forced |
| 3. Pricing | N/A | Never reached pricing page |
| 4. Signup Readiness | N/A | Would not sign up; zero interest |
| 5. First-Run | N/A | Would never reach this stage |

**Filter Effectiveness: PASS**

**Comparison to Visitor 001 (initial round, also RE agent):**

| Metric | Visitor 001 (old landing page) | Visitor 014 (new landing page) |
|--------|-------------------------------|-------------------------------|
| Headline | "The operating system for real estate professionals" | "The AI-Powered Platform for Land Investors" |
| Time to self-select out | ~5 minutes | ~8 seconds |
| Pages visited | Landing, Pricing, Auth | Landing only |
| Category score | 2/5 (confused, eventually figured it out) | 5/5 as filter (immediately clear) |
| Emotional response | Frustrated ("The broad positioning wasted my time") | Neutral ("Not for me, clear as day") |
| Word-of-mouth | Negative ("land investor tool pretending to be for all RE professionals") | Neutral-positive ("CRM for land investors, not for agents") |
| Overall score | 1.75/5 | N/A (correctly filtered) |

**Key insight:** The old headline "real estate professionals" created a 5-minute negative experience where the visitor felt misled. The new headline "Land Investors" creates an 8-second neutral exit. The visitor's time is respected, the brand impression is positive, and word-of-mouth (if any) is accurate rather than hostile.

This is the single most important improvement from the landing page changes. A non-target visitor who feels misled will warn others away. A non-target visitor who is correctly filtered will either say nothing or accurately describe the product, potentially referring it to someone in their network who IS a land investor.

**Meta tag discrepancy:** Worth noting that the `<title>` tag still reads "AcreOS -- The Operating System for Real Estate Professionals" and the `<meta name="description">` still says "The operating system for real estate professionals." If this visitor found AcreOS via Google, the search snippet would show the old "real estate professionals" language, potentially attracting non-target clicks. The meta tags should be updated to match the rendered headline: "The AI-Powered Platform for Land Investors."
