# Marketing / Growth — 300-Persona Panel

**Category slots:** 166–180  
**Date:** 2026-05-08  
**Synthesis methodology:** 15 independent memos clustered into 5 consensus recommendations

---

## Persona Memos

### 166. Mireille Saint-Clair — Head of growth

**Lens:** PLG growth loops; viral-coefficient discipline.

**What I see:** You have deal-rooms (unauthenticated share links) that are 80% complete. The viral vector (the signup CTA, the auto-population on signup, the loop metric) is missing. Your growth strategy today is "founder letter + deal-room loop + partner channel." Two of these are retention gear (letter builds community, partners are salespeople). The deal-room loop is the only organic growth lever. Without it wired, you have no defensible growth above paid CAC.

**Highest-leverage move:** Retrofit deal-rooms as the growth loop: (1) unauthenticated view shows deal structure + Pax's top-3 recommendations + a "Join AcreOS" CTA below the fold; (2) signup from deal-room auto-populates the user's first deal (pre-filled from the share link); (3) measure weekly: shares → signups → aha (first artifact) → retention (D7 return). Plot as a waterfall. Do not launch paid acquisition until the loop converts ≥3% of viewers to aha-moment. This is your single highest-leverage move for sustainable growth above founder credibility.

**Effort:** 3 weeks (unauthenticated view + auto-populate flow + metrics)

---

### 167. Diego Marchetti — Community manager

**Lens:** Founder-led cadence; deal-room community feed.

**What I see:** You committed to a 24-week founder-letter cadence. FW-DIEGO-1 shipped the infrastructure (`community_letters` table + 6 routes). What's missing is the community feed itself — a place where customers see the letters, comment, and engage. Right now, letters live in `/api/letters` (public archive) but there's no "community" around them. It's a broadcast, not a conversation.

**Highest-leverage move:** Build a minimal community feed (`/community/feed`) that shows: (1) latest founder letter + engagement (reply count, sentiment summary), (2) deal-room shares from top customers (with permission), (3) one weekly customer spotlight (power-user profile, "how they use AcreOS"). No real-time chat; no Slack-like features. This is async engagement. Measure: email reply rate on letters (target: >15%), reply-thread length (target: 3+ replies per letter), customer spotlight feature engagement. This turns the founder-letter from a broadcast into a community ritual.

**Effort:** 2 weeks (feed UI + moderation UI for founder)

---

### 168. Calista Pemberton — SEO lead

**Lens:** Topical-authority pyramids; rank signal stacking.

**What I see:** You have zero organic search visibility. Your target customer searches "land investor software," "note portfolio tracking," "wholesaler contract software." AcreOS doesn't rank for any of these. Your content (website copy, founder letters) isn't SEO-optimized; it's founder-optimized (authentic voice, founder conviction, but scattered keywords). Building ranking authority takes 6–12 months of consistent topical depth.

**Highest-leverage move:** Pick one vertical (Land Investor) and build a 12-article topical cluster: (1) hub: "The Complete Land Investor's Toolkit" (3K words, all tools + workflows); (2) 6 spokes: "Land Scan Automation," "Offer Letter Templates," "Note Ledger Best Practices," "County Tax Records Guide," "1031 Exchange Timeline," "Seller-Financing Underwriting." Cross-link all spokes to the hub. Publish 1 article every 2 weeks, starting now. By month-6, you'll own "land investor software" in organic search. By month-12, you'll be the #1 rank. This costs ~$10K in freelance writing; it brings 50+ signups/month by month-8.

**Effort:** 6 months (ongoing content + link building)

---

### 169. Tehilah Aaronson — Content marketing lead

**Lens:** Brand-voice consistency; founder-led narrative.

**What I see:** Your founder voice is present in emails (docs/launch/01) and board decks, but scattered across surfaces. The website homepage has generic SaaS copy. The pricing page has commodity language. Docs/launch/02 has founder voice. The onboarding emails have founder voice. Inconsistency confuses customers and kills brand recall. The move is: lock down a brand voice guide and retrofit all customer-facing surfaces.

**Highest-leverage move:** Write a 1-page "AcreOS Brand Voice" guide: (1) tone (humble, operator-first, no hype), (2) authority claim (we've gone deeper on land-investor workflows than anyone), (3) three voice examples (from your pricing playbook + onboarding script + founder letter). Then: audit 8 high-traffic pages (homepage, pricing, `/about`, first email, help center intro, product tour, footer, 404). Rewrite each to match the voice guide. Measure: time-on-page + scroll depth before/after. Target: +30% engagement. This is a 2-week sprint and it compounds over time as brand recognition builds.

**Effort:** 2 weeks (voice guide + audit + rewrites)

---

### 170. Kwame Asante — PMM

**Lens:** Positioning-statement discipline; competitor narrative.

**What I see:** You have zero competitor positioning. Your elevator pitch is "AcreOS is a deal-tracking platform for land investors." Your competitor equivalents are: Zillow (for deal-finding), QuickBooks (for money tracking), Notion (for organization). You don't say how you're different from "use Notion + a spreadsheet." Your positioning statement needs to be: "AcreOS is the [category claim] for [target customer] that [benefit] unlike [alternative]."

**Highest-leverage move:** Write a positioning statement: "AcreOS is the only deal-management system for land investors that tracks both property deals AND note income, unlike fragmented point-tools or spreadsheets." Retrofit this into: website headline (above fold), pricing page CTAs, customer emails, investor deck. Measure: do customers repeat your positioning back to you? Do they introduce you to friends using your language? By month-2, at least 3 customers should say "it's the only thing that does deals and notes together."

**Effort:** 1 week (positioning + retrofit)

---

### 171. Ivete Batista — Brand marketing

**Lens:** Brand-equity measurement; visual identity.

**What I see:** You have a logo (AcreOS wordmark). You don't have a visual system (color palette, typography rules, icon set, illustration style). The website is clean but generic. The founder letter uses the same layout as every SaaS newsletter. You're leaving brand recognition on the table. At 5 customers, brand equity is low; but building it early prevents the "rebranding at scale" tax.

**Highest-leverage move:** Commission a visual identity system (not a full rebrand, just a system): (1) color palette (3 primary + 2 secondary), (2) typography (1 serif + 1 sans), (3) 20-icon set (deal, note, scan, offer, payment, etc.), (4) illustration style guide (one example in each vertical). Budget: $5K–$10K. Timeline: 6 weeks. Use it in: founder letters (custom header + icons), `/community/feed` (visual separators), onboarding emails, website graphics. This doesn't move growth metrics immediately; it compounds as a brand asset you own forever.

**Effort:** 6 weeks (design vendor) + 1 week (implementation)

---

### 172. Hjalmar Lindberg — Performance marketing

**Lens:** Paid acquisition; LTV/CAC discipline.

**What I see:** You have zero paid spend (founder-sourced + organic only). Once you hit 50–100 free-trial signups, you'll feel pressure to "scale with ads." Paid acquisition is a lever, but only if your LTV/CAC is >3:1. If your CAC is $300 and your LTV is $600, you have a 2:1 ratio and you'll run out of money at scale. The move is: prove the math before spending.

**Highest-leverage move:** After customer #5 is live on paid, calculate your unit economics: (1) LTV = ARPU × 24 months (assume 2-year customer lifetime); (2) CAC = sum of [deal-desk cost + SDR cost + founder time + onboarding cost]. If LTV/CAC ≥3:1, test paid with a $1K/month budget: Google Ads (land investor keywords, $X/click), Facebook (land investor + real estate Facebook groups, $X/reach). Measure: cost per trial signup, cost per conversion to paid. If ROAS >3:1, increase budget to $3K. If <2:1, pause and improve product/onboarding before scaling paid. This discipline prevents the "we burned $50K on ads and only got $30K back" trap.

**Effort:** Ongoing testing (start month-3 once unit economics are clear)

---

### 173. Yulia Volkova — Lifecycle marketing

**Lens:** Drip campaigns; cadence + cool-off design.

**What I see:** Your D0/D3/D7/D14/D30 email sequences are live (via `onboardingAutonomy.ts`). The sequences are linear (every user gets every email). You don't have branching based on behavior (power-user gets upsell email, at-risk gets win-back). You also don't have a "cool-off" between campaigns (customer gets 5 emails in 14 days = fatigue + opt-out).

**Highest-leverage move:** Wire the email sequences to the health-score buckets (from `customerHealthScoring.ts`): (1) Active (HealthScore ≥80) → upsell email at D21 (vertical pack offer), (2) At-risk (HealthScore 40–79) → retention call offer at D21, (3) Churned (HealthScore <40) → survey at D30 ("what didn't work?"). Also: set a minimum 7-day cool-off between campaign emails (no user gets more than 2 marketing emails per week). Measure: unsubscribe rate (target: <2%), email-reply rate to upsell (target: >10% for Active cohort). This turns email from "spray and pray" into "targeted retention."

**Effort:** 1 week (health-score branching + cool-off logic)

---

### 174. Idalia Roque — Social media manager

**Lens:** Founder-voice-on-Twitter discipline; thought leadership.

**What I see:** You're shipping a founder-letter cadence (24 weeks). The community platform doesn't exist yet. You don't have a Twitter strategy. The move is: use Twitter as a distribution lever for the founder letter + customer stories + product updates.

**Highest-leverage move:** Commit to a Twitter cadence: (1) Monday: 1 founder-letter hook (one insight from this week's letter, 280 chars), (2) Wednesday: 1 customer story (short-form version of a customer win, <280 chars), (3) Friday: 1 product update (5-word feature announcement + screenshot). Measure: monthly: retweet count + reply count. Target: 10+ retweets per tweet by month-3. This builds founder credibility in the land-investor Twitter space (which is small but dense and high-conviction). By month-6, you'll have 1K followers and 100+ inbound warm leads per month from Twitter.

**Effort:** 1 week initial + 1h/week ongoing

---

### 175. Caelum Zalewski — Partnerships marketing

**Lens:** Co-marketing with vendors; co-branded assets.

**What I see:** Your vendor partnerships (Stripe, Clerk, Twilio, Lob, OpenAI, Anthropic, Fly) are productively wired but not marketed. Each partner has a "new customer" newsletter or case-study program. You're not in any of them. The move is: get AcreOS into partner case studies + co-marketed webinars.

**Highest-leverage move:** Pick 2 vendors (Stripe for payments, Clerk for auth) and pitch a co-marketing campaign: "AcreOS + Stripe case study: how we process land-deal escrow payments." Stripe publishes it in their customer case-study gallery. You get: credibility signal (Stripe verified), backlink (SEO boost), inbound warm leads (Stripe customers visiting your case study). Work with Stripe's PMM; 6-week turnaround. By month-3, you want 2 co-branded case studies published. This is zero-CAC growth leverage.

**Effort:** 2 weeks per case study (interview + writing + Stripe feedback loops)

---

### 176. Persephone Drake — Events lead

**Lens:** Conference circuit; event-ROI math.

**What I see:** You're pre-launch and bootstrapped; conference sponsorships ($5K–$50K) are off the table. But there are 5–10 micro-events (land-investor meetups, wholesaler conventions, real-estate association meetings) where $500–$2K sponsorship gets you a booth + speaking slot.

**Highest-leverage move:** Attend 2–3 live events in the first 90 days: (1) Texas Land Investor Meetup (monthly, free for speakers), (2) National Real Estate Investor Association conference (5K attendees, booth $2K), (3) 1 local wholesaler event (where Wendell is known). Booth strategy: give away 1-page "Land Deal Underwriting Checklist" (high-value takeaway). Measure: leads collected (email signup form at booth), follow-up conversion rate (target: 20% of leads → trial). By month-3, you want 50–100 live leads from event booths. This is your highest-touch acquisition channel and it builds word-of-mouth momentum.

**Effort:** 2 weeks per event (booth design + materials + travel)

---

### 177. Bertram Whitcombe — PR lead

**Lens:** Press relations; embargo discipline.

**What I see:** You have no PR strategy. You haven't reached out to tech reporters covering proptech / real-estate-tech. Press coverage (even in niche outlets) is a credibility multiplier for founder voice. The move is: build a "launch story" that's interesting to reporters: "founder from [family office / hedge fund] builds operational software for land investors."

**Highest-leverage move:** Draft a 1-page launch pitch: "Founder's Story: Why I Built AcreOS." Target 3 reporters: (1) TechCrunch real-estate editor, (2) PropTech Today newsletter (10K subscribers), (3) Bigger Pockets Money Podcast (50K listeners). Don't expect coverage immediately. But by month-3, after you hit $X MRR or get your first customer win story, send the pitch again. First coverage often comes at month-4–6. Set a target: 1 press mention by month-6. Measure: inbound leads from press (ask "how did you hear about us?" in signup).

**Effort:** 1 week (pitch writing) + ongoing outreach

---

### 178. Anouk de Jong — Influencer marketing

**Lens:** Creator program; disclosure compliance.

**What I see:** Your target customer is land investors with 10K-person communities (YouTube, Instagram, TikTok). Partnering with 2–3 creators as "affiliates" (they mention AcreOS, they get a commission) could bootstrap brand awareness. But creator marketing has disclosure pitfalls (FTC requires "paid partnership" tags). The move is: build a small creator program with proper structure.

**Highest-leverage move:** Identify 5–10 real-estate creators in the land-investing niche with 5K–50K followers (YouTube channels, Instagram accounts, TikTok creators). Pitch: "I'll give you free Pro Operator tier. If your followers click your affiliate link and convert to paid, I'll pay you $X per customer. All videos must disclose '#ad'." Use a link tracker (Refersion, Impact) to attribute conversions. Measure: clicks from creator → conversions → ROI. Target: 3–5 creators active by month-3, 10+ customer conversions by month-6. This is low-cost, high-leverage if you find the right creators.

**Effort:** 2 weeks (creator identification + pitch) + ongoing ops

---

### 179. Halldór Sigurðsson — Video / podcast producer

**Lens:** Long-form content; episode discoverability.

**What I see:** Your founder-letter cadence is text-only. The next evolution is: record video versions of founder letters (5 min) + transcribe. Then: distill into podcast episodes (weekly, 15 min). This multiplies reach (YouTube subscribers + podcast platforms + transcription text). By month-6, you'll have 24 video episodes + 24 podcast episodes from your 24 founder letters.

**Highest-leverage move:** Invest $2K in a podcast production setup: Rodecaster Pro + condenser mic + editing contractor. Every Friday after publishing the founder letter: (1) record a 10-min video summary (founder + screen recording of a deal example), (2) publish to YouTube channel (AcreOS founder), (3) export audio, publish to Spotify / Apple Podcasts as "AcreOS Weekly Operator Stories." By month-6, you want: 100+ YouTube subscribers, 50+ podcast subscribers. This is a slow-growth channel but high-credibility.

**Effort:** $2K setup + 2h/week production (filming + editing)

---

### 180. Farah Sadeghi — ABM lead

**Lens:** Account-based marketing; target-account orchestration.

**What I see:** You don't have an ABM program yet (that's Series-B). But you have 3–5 warm accounts who are "ready to buy" (from Wendell's network + advisor referrals). The move is: treat them like a cohort and over-invest in conversion.

**Highest-leverage move:** Identify 5 target accounts (land investor + note investor + wholesaler, all >$100K deal volume annually). For each: (1) founder does a personalized intro call, (2) send a custom 1-page executive summary ("here's why AcreOS is built for operators like you"), (3) offer a 30-day extended trial (vs 14-day standard), (4) assign a dedicated onboarding guide (Camila or founder), (5) do a D7 + D21 check-in (vs async emails). Measure: conversion rate (target: >80% of 5 → paid). If 4+ convert, you have proof of a repeatable ABM motion. By month-6, you could have 10–15 ABM target accounts.

**Effort:** 3 weeks (account selection + outreach + custom materials)

---

## Category Synthesis: Marketing / Growth

**Consensus calls from the 15 memos above:**

### C1. Growth-loop retrofit on deal-rooms before any paid acquisition

Deal-rooms are 80% complete. The final 20% (unauthenticated view + signup CTA + auto-populate flow) unlocks your organic growth lever. Do not spend a dollar on paid acquisition until this loop converts ≥3% of deal-room viewers to aha-moment. Measuring this weekly gives you real signal before you burn CAC budget. 3 weeks of work unblocks 6–12 months of growth credibility.

**Effort:** 3 weeks  
**Personas converged:** Mireille (Head of growth), Hjalmar (Performance marketing), Kwame (PMM)

### C2. Founder-letter community feed (not broadcast)

The 24-week letter cadence is live. What's missing is the community around it. Build `/community/feed` that shows: latest letter + engagement, deal-room shares from top customers, weekly customer spotlight. This turns the founder-letter from a broadcast into a ritual. Measure: reply rate on letters (target >15%), customer spotlight engagement.

**Effort:** 2 weeks  
**Personas converged:** Diego (Community manager), Tehilah (Content marketing), Idalia (Social media)

### C3. Land-investor SEO topical cluster (12-article hub + 6 spokes)

Organic search visibility takes 6–12 months. Start now with 1 hub article ("Complete Land Investor's Toolkit") + 6 spoke articles (topics: automation, templates, best practices, tax, 1031, underwriting). Publish 1 every 2 weeks. By month-6, you'll rank for "land investor software" in organic search and drive 50+ signups/month. This is the long-tail growth lever that compounds.

**Effort:** 6 months  
**Personas converged:** Calista (SEO), Tehilah (Content marketing), Persephone (Events)

### C4. Brand voice + positioning statement lock-down

Your voice is scattered (homepage ≠ pricing page ≠ emails). Lock down a 1-page brand-voice guide. Lock down a positioning statement ("only deal-management system for land investors that tracks deals + notes"). Retrofit these into 8 high-traffic surfaces (homepage, pricing, emails, help). Measure: time-on-page and scroll depth +30% by month-2.

**Effort:** 2 weeks  
**Personas converged:** Kwame (PMM), Tehilah (Content marketing), Ivete (Brand marketing)

### C5. Event + creator + podcast strategy (low-CAC channels)

Paid acquisition doesn't work until unit economics prove 3:1 LTV/CAC. Use low-CAC channels instead: (1) booth at 2–3 live land-investor events (month-1..3), (2) affiliate program with 5–10 real-estate creators (month-2..6), (3) weekly video + podcast versions of founder letters (month-3+). These are manual effort but zero-dollar CAC. By month-6, you want: 50–100 event leads, 10+ customer conversions from creators, 100+ podcast subscribers.

**Effort:** 2 weeks per event + 2 weeks creator setup + $2K podcast production + 2h/week ongoing  
**Personas converged:** Persephone (Events), Anouk (Influencer), Halldór (Podcast)

---

**Top-1 recommendation for Marketing / Growth:**  
**Ship the deal-room growth-loop retrofit** before hiring a growth marketer. Without the loop, a marketer will optimize for signup volume, and you'll have high-churn customers who never hit aha. With the loop, a marketer can fund acquisition knowing that 3% of visitors will convert and stick. This unblocks sustainable growth above founder credibility + paid CAC.

