# Ezra Lipscomb — AcreOS paid-acquisition readiness audit (B2B SaaS, 39, agency principal)

I'm Ezra. I run a 22-person performance-marketing agency in Austin — Google, Meta, LinkedIn, retargeting, the whole stack. We work almost exclusively with B2B SaaS. The shops we accept are typically post-PMF, $1–10M ARR, and we either get them to $5M ARR or we get fired. I do the conversion-readiness audit before we sign. AcreOS asked me to do that audit. This is it. I am not pulling punches because the founder pays me to find every dollar before I light up a paid budget against a leaky funnel.

The 30-second verdict: **don't spend a dollar on paid yet.** The product is real, the messaging is unusually good for an early-stage SaaS, and the audit log + agent positioning is the kind of differentiator agencies pray for. But the conversion plumbing is partial-to-missing in seven places that will turn a $50 CAC into a $400 CAC the day we turn the spigot. Fix the seven things in section 4 and I will personally light $25K/mo against this in week one.

---

## 1. The full picture — what I looked at

I walked the live funnel as a stranger would, then pulled the wrappers off and looked at the code.

- **Public landing.** `client/src/pages/landing.tsx` — section composition is Hero → HowItWorks → Agents → DayInLife → Features → Quotes → FounderNote → Pricing → FAQ → FinalCTA → Footer. The voice is the founder's letter (`client/src/pages/landing/copy.ts`), which is the best founder voice I have read on a SaaS landing in twelve months. Real differentiator.
- **Hero CTAs.** `Hero.tsx` lines 81–88 — primary "Start free trial" → `/auth?mode=register`, secondary "Read the letter" → `#founder` anchor. CTA-sub: "No credit card. Email me with questions: thomas@acreos.io." Trust pill: "12 investors in private beta. $1.4M closed. 0 of them have left."
- **Pricing — landing version.** `client/src/pages/landing/Pricing.tsx` — Solo $199, Operator $499, Operation $1,290 monthly. Annual saves 17%. Toggle works. Foot copy: "14 days free, no setup fees, migration help from a real human."
- **Pricing — standalone page.** `client/src/pages/pricing.tsx` — Free, Starter $20, Pro $49, Scale $79. Annual saves 20%. Same trial copy.
- **Auth/signup.** `client/src/pages/auth-page.tsx`. Trial provisioning happens server-side in `server/middleware/getOrCreateOrg.ts` line 80.
- **Index head.** `client/index.html` — OG tags, Twitter card, JSON-LD SoftwareApplication. No analytics. No GTM. No pixels.
- **Robots + sitemap.** `client/public/robots.txt` and `sitemap.xml` exist.
- **Adjacent personas.** I read Asher's account-takeover audit, the trial-UX persona drafts, and the existing attribution-analytics component for in-app campaign ROI (`client/src/components/attribution-analytics.tsx`) — that one is for the customer's outbound, not for us.

What I didn't find: a `/demo` route, a `/contact` route, a Calendly or sales-call surface, any analytics SDK, any remarketing pixel, any GTM container, any consent-mode banner, any UTM capture on the client, any landing-variant infrastructure, any conversion-event endpoint, any server-side conversion API wiring (CAPI/Enhanced Conversions). The Operation tier's "Talk to us" CTA links to `/contact` — `/contact` is not a registered route in `client/src/App.tsx`. That is a 404 on the highest-LTV tier's only conversion path.

---

## 2. What's working — the assets I'd actually use in ad creative

1. **The founder letter voice.** The hero copy ("I built this because I needed it. Maybe you do too.") and the FounderNote section are the best ad-creative source material on this site. I would lift sentences directly into Meta primary text and LinkedIn sponsored-content body. "I've closed 200 land deals. The last 50 were on AcreOS." is a 4–6% CTR hook in the SaaS-for-investor niche, easily.
2. **The trust pill.** "12 investors in private beta. $1.4M closed. 0 of them have left." is a cold-traffic credibility line. It tells me retention is honest. I can use it on cold and on retargeting.
3. **The six beta quotes** in `Quotes.tsx`. They are specific (90-second seller reply, replaced four tools, services-notes-better-than-I-did), they have first-name + role + state ("Marcus K., Solo investor · Texas"), they are not generic. This is video-ad and carousel-ad gold.
4. **OG / Twitter card meta is correct.** Image is set, dimensions 1280×720, alt text is real, title and description match the landing voice. Most pre-seed SaaS landings ship a broken OG card. AcreOS does not.
5. **JSON-LD SoftwareApplication block** is present and correctly typed with `applicationSubCategory: "CRM"` and a price=0 offer pointing at /pricing. Good for organic SERP rich results — not directly load-bearing for paid but a free win.
6. **Self-hosted fonts** with `<link rel="preload">` for Fraunces + Inter. LCP impact will be smaller than a Google Fonts pull. Important when paid traffic from low-bandwidth zip codes hits the page (and rural land-investor audiences over-index there).
7. **Server-side trial provisioning is automatic.** `getOrCreateOrg.ts` sets `trialStartedAt`, `trialEndsAt`, `trialUsed`. No human gate between auth and trial start. That's correct for a low-friction paid funnel — every dollar I spend pushes someone into a trial without a sales call required.
8. **Schema captures UTM.** `organizations` has `utmSource`, `utmMedium`, `utmCampaign`, `utmContent` columns. The plumbing target exists. The client just isn't writing to it.

---

## 3. The seven things that will burn paid budget on day one

### **(1) The trial length is a lie.** This is the worst single thing on the site.

The landing footer says "14 days free." `pricing.tsx` line 127 says "14-day free trial." Every CTA promises 14 days. The server code in `getOrCreateOrg.ts` line 80 sets `trialEnds = now + 7 * 24 * 60 * 60 * 1000` — **seven days**. Every single user who signs up from a paid ad clicking "Start your 14-day free trial" gets a 7-day trial. They will notice on day 8 when they can't log in. They will charge back. Stripe will see the dispute pattern. We will lose merchant trust. Paid acquisition cannot survive this. **Fix today**: change `7 * 24` to `14 * 24` in `getOrCreateOrg.ts` line 80, or change the marketing copy to "7 days free" everywhere. I would pick 14 — 7 is too short for B2B SaaS evaluation in a multi-county workflow.

### **(2) Two pricing pages with non-overlapping price ladders.**

`landing/Pricing.tsx` shows $199 / $499 / $1,290. `/pricing` (the standalone, linked from the nav) shows Free / $20 / $49 / $79. These are not remotely the same product. A prospect sees $199 in the hero scroll, clicks the nav, sees $20, and either thinks they're being baited or that the product is two products. Either way the click does not convert. **Fix this week**: pick one ladder, replace the other, and wire both to a single source — there's a `/api/config/pricing` endpoint per the comment in `landing/Pricing.tsx` line 8–11. Use it. Until this is unified I refuse to send paid traffic.

### **(3) Zero analytics. No GTM, no GA4, no Meta pixel, no LinkedIn Insight tag.**

`client/index.html` has none of the four. There is no client-side analytics file under `client/src/lib/`. We cannot run paid without:

- **GTM container** (server-side preferred — Anthropic-tier privacy hygiene plus iOS 17 link-tracking-resistance) for tag orchestration.
- **GA4** with a conversion event on `sign_up`, `trial_start`, `subscription_start`.
- **Meta Pixel + CAPI** so iOS 14.5 attribution doesn't kill us. CAPI needs a server endpoint that posts trial_start and subscription_start with hashed email + click_id (`fbp` + `fbc`) within 24h.
- **LinkedIn Insight tag** for the agency-and-team segment we'll target on LI ($499/$1,290 tiers — that audience lives on LinkedIn).
- **Google Ads conversion tracking** with Enhanced Conversions for Web (server-side, hashed email).

Without those tags, every campaign I run is flying blind. Optimization algorithms need 30 conversions in 7 days to exit the learning phase. We can't deliver any. **Fix this sprint**: install GTM (1 day), wire GA4 + Meta Pixel + LinkedIn Insight via GTM (1 day), build a `/api/conversions/capi` endpoint that mirrors `sign_up` and `trial_start` to Meta CAPI + Google Ads server-side conversions (2 days). Total: 4 engineer-days, then I can spend.

### **(4) UTM capture is not wired to the client.**

The `organizations` table has `utmSource / utmMedium / utmCampaign / utmContent` columns and `getOrCreateOrg.ts` line 93–96 explicitly writes `null` to all four. There's no client-side capture grabbing `?utm_*` and `?gclid` and `?fbclid` out of the URL on landing, stashing them in a first-party cookie or `localStorage`, and POSTing them with the signup. **Fix this sprint**: small `client/src/lib/attribution.ts` that captures and persists for 30 days, then the auth flow reads it and sends it on the create-org call. Without this we cannot tell which campaign drove which paid customer 60 days later. ROAS-by-campaign is impossible.

### **(5) `/contact` 404s. The Operation tier ($1,290/mo or $12,900/yr) has no demo path.**

`landing/Pricing.tsx` line 115 sends "Talk to us" to `/contact`. `App.tsx` does not register a `/contact` route. I clicked it. Browser shows 404. Our highest-LTV cohort — multi-state operators — reach for that CTA and bounce. **Fix this week**: ship a `/contact` page (or `/demo`) with three fields (name, email, current portfolio size), an embedded Cal.com or Savvycal scheduler, and a server-side route that emails Thomas + drops the lead in the org table with `subscriptionTier="lead-enterprise"`. Or, minimally, change the CTA to `mailto:thomas@acreos.io?subject=AcreOS%20Operation%20tier`. Either is better than 404 today. Without a working enterprise path I won't run LinkedIn ABM at all.

### **(6) No retargeting infrastructure, no audience exclusions, no consent banner.**

Even if the pixels existed, the supporting structure doesn't:
- **No retargeting audiences.** Without Pixel data flowing for 30+ days I have no remarketing pool to bid against. Cold-only paid is 3–5x more expensive.
- **No exclusion list.** I cannot exclude existing customers from Meta cold campaigns because there's no customer-list export to a Meta Custom Audience. Wasted spend.
- **No consent banner.** Hitting EU/UK traffic without a consent-mode v2 banner means Google Ads downgrades or refuses to record those conversions. Even a 3% EU traffic share moves CPA visibly. CookieYes / Osano / Cookiebot or a self-built minimal one — pick one this month.
- **No GDPR/CCPA "do not sell" surface.** Privacy-page text alone is not consent infrastructure.

**Fix in 2 sprints**: Klaro or Cookiebot (1 day), GA4 consent mode (0.5 day), Meta + LinkedIn audience-sync from `organizations` table on a daily cron (1 day), CRM-export endpoint to feed Meta Customer Lists (0.5 day). 3 engineer-days.

### **(7) No B2B SaaS metrics dashboard for paid optimization decisions.**

There's a beautiful in-app `attribution-analytics.tsx` for the customer's outbound campaigns. There is nothing for the operator side — no surface where Thomas (or his agency, me) can see:
- CAC by channel (paid-search / paid-social / organic / referral / direct).
- Trial-to-paid conversion rate by tier.
- 30-day, 60-day, 90-day retention by acquisition cohort.
- Payback period by channel.
- LTV:CAC ratio rolling 90-day.

These five numbers are the agency-client dashboard. Without them I cannot defend my retainer. **Fix in 4–6 weeks**: a `/founder/acquisition-metrics` page reading from `organizations` (with UTM populated per #4), `subscription_events` (already tracking `signup / upgrade / trial_start / trial_end` per `shared/schema.ts` line 5503), and Stripe MRR. The data is in the database. The dashboard is not. This is the agency reporting view.

---

## 4. The first 90 days I would actually run

If the seven blockers above ship, here is the budget plan.

**Weeks 1–2 — instrumentation freeze.** No spend. Verify GA4, Meta Pixel + CAPI, LinkedIn Insight, Google Ads + Enhanced Conversions, UTM capture end-to-end with test conversions. Verify trial-length copy matches code (14 days everywhere). Verify `/contact` works. Pick one pricing ladder.

**Weeks 3–4 — $5K/wk discovery.** Google Search on bottom-funnel land-investor terms ("CRM for land flipping," "land investor software," "PropStream alternative" — competitor terms with cold caveats). Meta cold using the founder letter voice as primary text and the six beta quotes as creative. LinkedIn ABM dark posts to job titles "Land Investor / Real Estate Investor / Owner" at companies with 1–10 employees in TX/AZ/NM/FL. Goal: 30 trial_starts/wk to exit Meta + Google learning phases.

**Weeks 5–8 — $15K/wk scale.** Add retargeting on 7-day pixel pool. Add YouTube short-form repurposing of the founder letter (shot from Thomas's desk — same voice that's on the landing). Test high-intent search at higher CPC. LinkedIn lead-gen forms feeding `/contact` schedule for the Operation tier.

**Weeks 9–12 — $25K/wk + creative refresh.** New creative cohort every 2 weeks. Beta-quote video testimonials. Cohort retention dashboard online so we can prove payback per channel. Drop the channel that's failing payback at day 60.

**Targets** I would commit to publicly: blended CAC under $250 for Solo+Operator, under $1,800 for Operation. Trial-to-paid above 28%. 90-day retention above 80%.

---

## 5. The smaller paper cuts

Things I'd fix but won't block spend over.

- **Hero CTA-sub** says "No credit card." The /pricing page's trial copy doesn't reinforce no-card. Repeat it everywhere — "no credit card required" cuts trial-start friction 8–15% on B2B SaaS landings I've measured.
- **Trust pill at 12 beta investors / $1.4M closed** is great today but will date by Q3. Auto-pull from production via `/api/public/proof` so the number compounds.
- **No social-proof logos.** "As featured in" or partner-logo bar is missing. If REtipster, Land Academy, Land Investor's Magazine, etc. have featured the product, get a row in.
- **No "compare to PropStream / REISift / DataTree" page.** Comparison-LP traffic from Google Search converts at 3–5x landing rate. The Tasha B. quote already names REISift + Pebble + Mailchimp + spreadsheet — that's a pre-built comparison page write itself.
- **FAQ section** is rendered (`FAQ.tsx`) but I didn't open the content. Confirm the FAQs answer "how is this different from PropStream," "is my data safe," "what happens after the trial," "do I need to be technical." Those four cover 70% of cold-traffic objections.
- **No exit-intent capture.** A single modal offering the founder letter as a PDF in exchange for an email captures 2–4% of bouncers. That's a retargeting pool worth $20K/mo of paid against.
- **Mobile hero hides the floating cards** (`Hero.tsx` comment lines 16–18). That's correct for layout but the prospect on a phone sees only copy. A static composite of the three cards as a single image would restore the product-feel without the rotation cost. Mobile is 55–70% of paid-social traffic.
- **No status page link** in the LandingNav. `/status` exists in the footer. Status pages on the landing nav are a Cloudflare/Twilio-grade trust signal. Move it up.

---

## 6. Attribution windows — the boring math that decides whether we scale

Most agencies skip this section. It's the single highest-leverage decision after pixel install, so I'm writing it out.

- **Meta default click-through is 7-day-click + 1-day-view.** For a B2B SaaS with a trial-to-paid lag of 5–14 days *after* trial start, the paid conversion frequently lands outside that window and Meta credits zero. We need the conversion event split: optimize on `trial_start` (in-window, fires the day of click) and report on `subscription_start` separately (out-of-window, only visible via CAPI server-side with the original `fbc` click_id stored in the org row at signup). This is why UTM capture (#4) is non-negotiable — `fbc` is the field, and we must persist it.
- **Google Ads uses a 30-day click-through default.** That's fine for trial_start. Enhanced Conversions for Web (server-side hashed email upload of `subscription_start`) is what closes the loop on the paid event 7–14 days later. Without ECfW, Google Ads optimizes on the wrong event and CPA reporting reads as 2–3x the truth.
- **LinkedIn windows are 30/7.** LI's audience cost is 4–8x Meta CPM, so we cannot afford to misattribute. Insight tag must be on every page, conversion event must fire on `trial_start`, and the offline-conversions API must post `subscription_start` weekly with `liFat` cookie hash.
- **Self-reported attribution survey on signup.** Every B2B SaaS over $20M ARR I've worked with adds a single "How did you hear about us?" question to the post-signup welcome screen. Free-text plus 6 buckets. It fills the hole between Meta-says-X and Google-says-Y, which will diverge by 30%+ at scale. Cheapest reconciliation tool I know. Add it to the trial-onboarding step (`OnboardingWizard.tsx` per memory note).
- **Iron-clad signal definitions.** `trial_start` fires server-side on org create with `trialStartedAt` set. `subscription_start` fires from the Stripe webhook on `customer.subscription.created` where `status === "active"` and `trial_end` has elapsed. `subscription_upgraded` fires on tier change. These three events are the entire conversion API surface. Don't fire from the client. Don't fire on trial end alone (some trials don't convert and we'd pollute the audience with negatives).

---

## 7. Cross-reads with the rest of the team

I read the trial-UX and pricing-friction drafts in parallel and they overlap with my findings. Sharpening here so the founder doesn't get conflicting recs.

- **Yuna's trial-UX audit (free-trial flow).** She'll find what I found from the conversion side: the 7-vs-14-day mismatch turns trial day 8 into a customer-support fire. She'll also flag the trial-progress surface (or lack of one) — there's no dashboard widget I saw saying "X days left, Y of Z setup steps complete, here's the next thing to do." That widget plus a day-3, day-7, day-12 lifecycle email tied to `trialStartedAt` doubles trial-to-paid in every B2B SaaS I've measured. From paid-acq side, that doubling means a $250 CAC becomes a $125 CAC — same ad spend, twice the LTV. Yuna's fix is also my fix. Ship it.
- **Tegan's pricing-page friction audit.** She'll hit the two-pricing-pages problem from the UX angle (mine is the conversion angle — same root). She'll likely also flag that `/pricing` shows Free/$20/$49/$79 but the landing scroll shows $199/$499/$1,290 — and that the Stripe price IDs in `subscription.ts` need to match whichever ladder we keep. From paid-acq, the consequence is that the ad-to-landing-to-pricing journey breaks the price expectation set in the ad creative. We anchor on $199 in Meta primary text, the user lands, scrolls, sees $199, clicks the nav, sees $20, and either thinks they got bait-and-switched or that we have two products. Either kills conversion. Tegan and I are aligned: collapse to one ladder, today, before any spend.
- **Asher's account-takeover audit.** Adjacent, not paid-acq directly, but the trust-signal implication is real: if we're buying paid traffic and a meaningful percentage of new accounts get phished within 90 days, our churn cohort math destroys the unit economics regardless of CAC. The 2FA rollout Asher recommends is paid-acq-relevant in that it preserves the 90-day retention number I'm committing to publicly (>80%). Without it, my retention promise is uncalibrated.
- **Thomas (founder).** He should personally write three pieces of ad creative before we hire a creative agency: a 60-second founder-letter video shot at his desk, a written long-form Meta ad in his voice (we already have the source — `copy.ts`), and a LinkedIn long-form post tied to the "I closed 200 land deals, the last 50 on AcreOS" hook. Founder-voice ads outperform agency-creative on cold by 40–60% in pre-PMF and early-PMF SaaS. We don't get this voice back if we hand it to an agency on day one. Use it now.

---

## 8. The contract terms I'd ask for

If the seven blockers ship and we sign a retainer, here's what I'd put in the SOW so the founder knows what he's buying.

- **Month 1**: $0 media, $8K services. Instrumentation + creative production + audience build.
- **Month 2**: $20K media, $8K services. Discovery spend across Google Search, Meta cold, LinkedIn ABM. Weekly reporting dashboard.
- **Month 3**: $60K media, $10K services. Scale on the winner, retargeting layer on, YouTube short-form launches.
- **Month 4 onward**: $100K+/mo media, $12K services. Creative refresh every 14 days. Cohort retention review monthly. Channel kill/scale decisions every 30 days based on day-60 payback.
- **Reporting cadence**: weekly Loom from me, monthly written brief, quarterly cohort retention review with Thomas.
- **Kill criteria**: if blended payback exceeds 14 months at month 4, we pause and reassess product-market-message fit. If trial-to-paid drops below 18% for two consecutive weeks, we pause new spend and investigate trial UX (Yuna's surface). If a single channel's CPA exceeds 1.5x blended for 14 days, we cut it.

---

## 9. What I'd say to Thomas if he asked me one thing

Fix the trial-length lie today. Everything else can wait a sprint. Shipping software that contradicts the marketing copy on the most-used CTA is the one mistake that compounds — every paid click from now until that fix lands is a chargeback and a churn note. Twelve characters in `getOrCreateOrg.ts` and you can sleep tonight.

I'll come back in two weeks. If the seven items in section 3 are green, I light up the budget on a Monday. The product is good enough that I will eat my retainer if I can't hit the targets in section 4 — that's how confident I am in the underlying message-market fit. Just don't make me spend a dollar against a 7-day trial that promises 14.

— Ezra
