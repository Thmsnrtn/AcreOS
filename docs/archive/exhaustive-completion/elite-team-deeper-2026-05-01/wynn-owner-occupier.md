# Wynn Carrington — AcreOS, the owner-occupier lens

I'm Wynn. Thirty-nine, software engineer in Knoxville. I bought 12 acres outside Wartburg two years ago — first time using investor-grade tooling for what was, fundamentally, a personal purchase. It worked. I underwrote my own raw land like a flip, paid $38K cash, and the parcel is going to host a 900-sqft cabin once I save up. Now I'm staring at AcreOS and asking the question nobody on Wendell's or Cesar's level is asking: *should a person like me even be here?* I'm not the target customer, but I'm the customer the target customer's tooling accidentally serves. That's a real segment, and it's one AcreOS hasn't decided whether it wants.

---

## 1. Thirty-second verdict

I won't pay $49/mo, let alone $79/mo, for one parcel hunt every two to three years. The Free tier (3 properties, 25 AI requests/day) is the only honest fit for me, and it works for about six weeks of active hunting before the AI quota and the property cap pinch. There is no "personal-use," "owner-occupier," or "pause until I'm hunting again" SKU. There is no checkbox on a parcel that says "this is for me, not a flip." I am being charged an investor's price for a buyer's workflow, and the product knows it — the language, the dashboards, the metrics, the academy, the agent system are all built for somebody who sells the land, not somebody who lives on it.

The closest thing I've found to my SKU is *Land.com / LandWatch* — both free to a buyer, both terrible at the things AcreOS is actually good at (title chain, soil, zoning depth, well/septic flags, encroachment risk). If AcreOS shipped a **"Find My Land" mode** at $9/mo with a 90-day pause-anytime guarantee, I'd pay it tomorrow and tell three friends. As built, it's a $588/year Pro tier I'd cancel after closing — and feel guilty about while I had it, because I'm taking up a seat that should belong to a working investor.

---

## 2. Daily-use walkthrough — a Saturday morning in March

**8:00 AM.** Coffee. Laptop. I open `/dashboard`. I am *immediately* overwhelmed. Pulse score, Pax morning brief, decision queue, deal-flow metrics, agent activity, AI request budget, six dashboards stacked on each other. I bought 12 acres. I have one parcel. The dashboard is built for somebody managing 80 leads through a pipeline. **Owner-occupier needs a "Personal Mode" landing page**: my saved searches, my watched parcels, my open offer, county tax-due reminders, and nothing else. Wendell saw density and called it dense; I see density and call it *wrong-architecture-for-me.* He's a power user under-served. I'm a casual user mis-served.

**9:30 AM.** I'm hunting for cabin land in Sevier or Cocke County, TN. I want 5–15 acres, water on the property, road frontage, no HOA, no flood zone, ideally a south-facing slope with hardwood. I open `/parcels` and I'm staring at *my parcels* — the ones I already own. The "find new land" path goes through `/deal-feed` or `/acquisition-radar`, both of which talk to me like I'm running a buy-box across a county. I don't have a buy-box; I have a *dream.* I want a Zillow-style map with AcreOS's underwriting underneath, not a deal-feed pipeline. The product treats land discovery as a B2B function. For me it's a B2C function. The map exists somewhere — I find it under `/map-search` after two clicks too many — but the *primary* navigation pushes investor verbs first.

**10:30 AM.** I find a 9.4-acre parcel in Cocke County. AcreOS pulls the assessment, prior sales, soil survey, slope, FEMA flood, and adjacent ownership. **This is genuinely better than anything I had two years ago.** This is the moment AcreOS earns its place in my workflow. Free tier, 3-property cap, I just used one slot. If I want to compare three more candidates I'm out of slots and the upgrade modal pops. **The friction is wrong-shaped:** as a casual user I'd happily pay per-parcel — *$2 per full underwrite, no subscription* — instead of $49/mo. There is no per-parcel SKU. I either rent the firehose or I get the trickle.

**11:15 AM.** I want to model the buy. Cash purchase, no note, no tax-loss harvesting, no depreciation schedule (it's raw land for personal use — IRC § 1.263(a) capitalization, not § 167 depreciation). I open `/finance` and `/tax-optimizer` and they're both modeling me as an investor. The depreciation calculator is meaningless to me; my basis just sits there until I sell or build. **Owner-occupier tax model needed:** track basis additions (improvements, perc test, well drilling, road grading, surveying) so that when I eventually sell or convert to rental, I have a clean Schedule D / Form 8949 cost basis. None of that exists as a first-class surface. The system *can* hold the data — there's a `parcel_improvements` table somewhere — but the UI is built around investor verbs (rehab, comp, exit cap rate) instead of owner verbs (improvements, basis tracking, eventual sale or transfer).

**12:30 PM.** Lunch. I poke at `/academy`. The education layer is built for a first-time *investor* — Grace's persona — not a first-time *land buyer for personal use.* Every module assumes I'm planning to sell. There is no module on:
- "How to buy land for a personal cabin in Tennessee" (perc test, well permits, septic regs under TN Rules 0400-48-01, road frontage requirements, building setbacks, easements)
- Owner-occupier mortgage products (USDA Section 502, FHA construction-to-perm, raw-land construction loans)
- Homestead exemption filings (Tennessee TCA § 67-5-104 — yes I learned this the hard way after closing)
- Property tax appeal as an owner, not as an investor
- HOA / restrictive-covenant due diligence from a "I'm going to live here" angle, not a "I'm going to flip this" angle

The Academy is good — for the wrong audience for me. There's a real opportunity here: a six-module **"Buying Your Own Land"** track that doesn't exist anywhere else on the internet at this quality. Even if I'm not the paying customer, my brother-in-law (looking at land in NC) would pay $79 for that course alone, separate from the SaaS.

**2:00 PM.** Offer. I want to write a clean cash offer on the Cocke County parcel. The `/offer-wizard` defaults to investor language ("subject to acceptable inspection of title," "assignable contract," "earnest money $500") that screams *I'm an investor, mark up the price.* As an owner-occupier I want the *opposite* signal — I want the seller's grandmother to know I'm going to build a cabin and raise kids on this land, not flip it in 90 days. **Add a "personal use, intent to occupy" cover letter template.** Sellers of family land in East Tennessee respond to that letter the way Bay Area sellers respond to "love letters" on houses. It moves price down. The product currently has no toggle for it.

**3:00 PM.** I close the laptop. I've spent six hours and used 14 of my 25 daily AI requests. If I do this for ten Saturdays, I've burned my Free tier and have to upgrade. I don't *do* this for ten Saturdays in a row — I hunt for two months, find a parcel or don't, and disappear. **The product has no rhythm for that user.** It has a monthly cycle. I have a multi-year cycle.

---

## 3. The "this is overkill" inventory

What I, an owner-occupier, do NOT need and would happily hide forever:
- Pulse score / agent activity / morning brief
- `/deal-feed`, `/acquisition-radar`, `/buyer-network`, `/buyer-qualification`, `/blind-offer-wizard`
- `/campaigns`, `/sequences`, direct-mail anything
- `/cohort-analysis`, `/data-moat-dashboard`, `/anticipatory-enterprise`, `/conscious-organization`, `/board-of-directors`
- `/agent-collaboration`, `/agent-command-center`, `/agent-detail`, `/agent-performance`
- `/certification-leaderboard`, `/certification-requirements`
- `/cash-flow`, `/commissions`, `/borrower-portal`, `/buyer-network`, `/capital-markets`
- The Sophie/Forge/Atlas founder-persona surfaces (which I'm not supposed to see anyway, per the persona-architecture memory — but the navigation density tells me they exist)

What I DO need and is buried or absent:
- Map-first parcel discovery as the home screen
- Saved searches with email alerts at owner-friendly cadence (weekly digest, not real-time pings)
- Per-parcel deep underwrite, ideally pay-per-use
- Basis tracker and improvement log
- Personal-use offer templates and "intent letter" generation
- Property-tax due-date reminder + homestead exemption filing checklist for my state
- A "pause subscription for 90 days, reactivate any time" button

---

## 4. Pause/cancel UX — what I found

`server/routes-billing.ts` has a clean cancellation flow with a survey, a Stripe-portal redirect, and an audit trail (`cancellationSurveys` table). That part is correct. What it does *not* have is a **pause** primitive. Stripe supports `subscription.pause_collection` natively; AcreOS does not surface it. For an owner-occupier this is the single most important billing affordance: "I'm not hunting right now. Hold my data, stop charging me, let me come back in six months without losing my parcel history." Today the only path is full cancel → re-subscribe → hope my data is still there (it is, per the org-scoped data model, but the UX gives me no confidence in that).

Concretely: add `/api/subscription/pause` with a 30/60/90-day option, store pause-end timestamp on the org, suppress feature gates appropriately, and surface in `/settings/billing` as a button that looks at least as friendly as the upgrade CTA. This is a one-sprint feature with outsized retention impact for the casual segment.

The cancellation flow itself is also slightly hostile in the way modern SaaS cancellations always are: the retention offer surfaces *usage stats* (`/api/subscription/cancellation-context`) before letting me cancel, which for an investor is fair persuasion ("you closed 8 deals this quarter") but for an owner-occupier reads as guilt ("you watched 47 parcels"). Different copy needs to fire for the personal-use cohort. Today, copy is one-size.

---

## 5. Tax forms — personal residence vs investment

I checked `server/services/financialOSService.ts` references and the `/tax-optimizer` surface. The system is wired for:
- 1099-S issuance on closings
- 1098-INT batch on seller-financed notes (Wendell's deal-killer)
- Schedule E rental income
- Depreciation under § 167 / § 168
- Cost-segregation hooks
- Capital-gains modeling on dispositions

What it is *not* wired for (and what an owner-occupier needs):
- **§ 121 primary-residence exclusion tracking** for the eventual sale — the $250K/$500K exclusion if the cabin becomes my primary residence for 2-of-5 years
- **§ 1031 vs § 121 decision support** when I sell — most investor tools assume 1031; owner-occupiers need to know they shouldn't 1031 a primary residence
- **Basis additions ledger** specifically labeled "improvements (capitalize)" vs "repairs (expense, but only if rental)" — for raw land held personally, almost everything capitalizes
- **Property-tax deduction tracking on Schedule A** — capped at $10K under the SALT cap, but still relevant
- **No depreciation** (raw land doesn't depreciate; the system shouldn't *offer* it for a parcel marked personal-use)
- **Form 8949 / Schedule D** prep on eventual sale, with basis pulled from the improvements ledger

The fix isn't a separate product — it's a single `parcel.holdingPurpose` enum (`investment | personal_use | mixed`) that gates which tax surfaces show up. Two days of work, large clarity win.

---

## 6. Comparison to Land.com / LandWatch / Lands of America

Those sites are *buyer-side discovery* — free, ad-supported, listings-driven, no underwriting. AcreOS's discovery is investor-side — comp-driven, deal-flow-driven, off-market-driven. As a buyer for personal use I sit between them: I want the *coverage* of Land.com (every listing in three counties) plus the *underwriting depth* of AcreOS (soil, slope, flood, title, encroachment).

If AcreOS shipped a **buyer-mode** that scraped/syndicated public listings (Land.com, LandWatch, Zillow Land, county MLS via IDX) and overlaid AcreOS's underwriting on top, it would create a category that doesn't exist. None of the listing sites do underwriting; AcreOS does underwriting but doesn't show me listings I haven't already entered manually. A merged buyer-mode is the missing surface.

This is also a defensible position: the listings sites can't add underwriting (their margins are ad-thin), and the investor CRMs don't do listings (their customers don't want listings, they want off-market). AcreOS could own the in-between.

---

## 7. The ethics question — am I taking an investor's seat?

I asked myself this for real. Using investor-grade tools as an owner-occupier puts me on the same side of the table as the people Grace and Wendell and Cesar make their living from. Two years ago I was the *seller* on a Hays County parcel an Austin investor flipped — they paid me $24K, sold it for $51K, used tools probably equivalent to AcreOS to do it. I didn't begrudge them the spread; their tooling and capital earned it. But it does mean: *if I use AcreOS to underwrite a parcel, I'm using the same intelligence asymmetry against the seller that I once was on the wrong side of.*

Two thoughts on this:

1. **The asymmetry exists with or without AcreOS.** Land.com, LandWatch, county GIS portals, and Zillow's Zestimate all already exist for buyers. AcreOS doesn't create the asymmetry; it just makes it more usable. An owner-occupier informed enough to use AcreOS could pull the same data from a half-dozen free sources over a weekend. The product compresses time, not information access.

2. **AcreOS could lean into ethics as a feature.** A "fair-offer mode" that, given full underwriting, *recommends an offer 5-10% above the comp-driven floor* when the seller signals personal need (probate, tax-delinquent, elderly out-of-state owner) would be a remarkable differentiator and would put real distance between AcreOS and the sleazier corners of the land-flipping industry. Grace would use it. Wendell would use it. I would use it. The only persona who wouldn't is the one AcreOS shouldn't want as a customer anyway.

This is a brand opportunity hiding inside a UX feature.

---

## 8. Pricing fit — the actual number

For my use pattern (hunt 6-8 weeks every 2-3 years, 1-2 closings per decade), the math is:

- Free tier: works for 4-6 weeks of active hunting, then I hit the property cap.
- Starter $20/mo: $240/year × 3 years between hunts = $720 to find one parcel. Painful but plausible.
- Pro $49/mo: $588/year × 3 = $1,764. Indefensible.
- Scale $79/mo: not even a question.

The honest SKU for me:
- **"Find My Land" $9/mo** — 10 properties, 100 AI/day, 90-day pause-anytime, no campaigns, no automation, no founder agents. Cancel after closing without guilt.
- **"Per-parcel deep dive" $5 each** — full underwrite of a single parcel without a subscription, results saved to a free-tier account for 12 months.
- **"Owner-occupier track" $49 one-time** — six education modules, downloadable templates, no ongoing subscription.

If AcreOS shipped two of those three, I'd be a paying customer the rest of my life — and I'd send every friend who asks me about buying land their way, because *nothing* in this market serves us today. That's a real moat.

---

## 9. Per-surface friction (owner-occupier specific)

**`/dashboard`** — Wrong default. Should detect `holdingPurpose=personal_use` on any parcel in the org and switch to a quiet "your land" view: tax-due countdown, last GIS update, weather overlay (we get ice storms; my well freezes), homestead-exemption status, improvement-log button. No pulse score, no agent activity, no morning brief.

**`/parcels/:id`** — The detail surface is excellent (Cesar said it; he's right). For me it needs a tab called *Stewardship* — perc test results, well log (TN requires well logs filed with TDEC), septic permit, timber inventory if I'm in a managed-forestry program, easement recordings, and an upload slot for permits and survey PDFs that aren't deal documents. Right now the "documents" tab is deal-shaped.

**`/finance`** — Should detect personal-use parcels and hide the note ledger entirely. There is no note. There is a basis ledger. Show that.

**`/tax-optimizer`** — Needs a hard fork: investment vs personal-use mode. The investment mode is what's there. The personal-use mode is § 121, § 1014 (step-up at death), § 1031 *exclusion* (you can't 1031 a personal-use property), basis tracking, SALT cap considerations, and homestead exemption filing. Those are completely different conversations and they should not share a screen.

**`/academy`** — Add the *"Buying Your Own Land"* track. Six modules, 90 minutes total. Even if owner-occupiers never become paying SaaS customers, this is the single highest-leverage content asset AcreOS could ship for SEO and word-of-mouth. The keyword volume on "how to buy raw land for a cabin" is enormous and almost entirely served today by Reddit threads and YouTube videos of varying quality.

**`/settings/billing`** — Add Pause. I cannot stress this enough. Add Pause.

**`/onboarding`** — First question shouldn't be "what's your buy-box" — it should be "are you buying land for yourself, or to resell?" Branch hard from there. Today there's an investor-coded onboarding wizard and a vestigial "explore" path that doesn't really branch the experience.

**`/settings/profile`** — Add a "primary use" toggle on the org. Today the org is implicitly investor-coded everywhere. An owner-occupier shouldn't have to be an "organization" to use the product; the data model can stay org-scoped (per the project memory) but the UX shouldn't make me feel like I'm running a business when I'm buying a cabin lot.

---

## 10. The deal-killer

For me personally: not a single thing. I'm a casual user; I have no deal-killers because I have no deals. AcreOS won't lose me to a competitor's contract-for-deed bug or a missing 1098-INT — I'll never hit those surfaces.

For AcreOS *as a business*, my deal-killer is the SKU itself. Every owner-occupier who tries the Free tier and bounces because there's no $9 plan is an evangelist who didn't get made. Every casual user pushed into Pro and resentful of the $49 charge churns within 60 days *and tells people the product is overpriced*, because from their seat it is. The investor segments (Wendell, Cesar, Grace) won't notice or care. The civilian segment notices, cares, and talks. AcreOS is leaving the warmest word-of-mouth surface in the entire land industry on the floor.

Add the $9 SKU. Add the pause button. Add the `holdingPurpose` flag. Add the personal-use offer letter. Six weeks of work for a customer segment that, even if it never crosses 5% of revenue, will produce 50% of the public goodwill. That's the trade I'd take.

— Wynn
