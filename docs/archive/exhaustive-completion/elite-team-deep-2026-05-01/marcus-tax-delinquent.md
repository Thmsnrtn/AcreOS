# Marcus Whitaker — AcreOS user review

I'm 55, work out of Memphis, and I buy tax-delinquent dirt. Two to three deeds a month, $5K to $40K a pop. I split my month between three things: pre-foreclosure outreach to owners behind on their county taxes, sitting in a folding chair on Tuesday morning at the Shelby County courthouse, and chasing the Florida certificate sales online in May/June. My stack today is TaxSale Resources for the calendars, TaxSaleSupport.com for the state-rules cheat sheets, the actual county website for everything that matters, and an Excel file named `redemption_clock.xlsx` that I will probably die holding.

I came into AcreOS because the pitch said "tax-delinquent specialist persona." That's me. So I went looking for the screws.

---

## 1. Thirty-second verdict

**Probably not yet, but close enough that I'm watching.** I'd take the 14-day trial. I would not pay full freight on month two unless somebody fixes the auction-calendar layer, because right now the data underneath it is a stub.

The persona vocabulary actually nails my world — it calls things "Tax-delinquent owner" and "Tax certificate" and even labels me "Tax-Delinquent Specialist" instead of generic "real estate professional." That's worth something. Whoever wrote `personaVocabulary.ts` understands that a Florida tax-certificate buyer and a Texas tax-deed buyer are not the same animal.

But the engine room? I opened `taxResearcher.ts` and the auction generator is producing **mock auctions with `Math.random()`** for parcel counts. The state-rules table has eight states in it, and Tennessee — where I live and work — isn't one of them. The pipeline service that powers `/tax-delinquent` is a stub that returns `[]`. So the page renders, the filters work, the Contact button has the right toast copy, but there's no there there yet.

If they wire this up to real county data and real auction calendars, this becomes my daily driver. If they don't, it's a pretty wrapper around the same county websites I'm already scraping.

---

## 2. Daily-use walkthrough — what my Tuesday looks like in AcreOS

**6:45 AM.** Coffee, then I open `/tax-delinquent`. First thing I want to know: **what auctions are happening this week and where am I supposed to be?** That's not on this page. The summary cards are Total leads / Critical / Avg equity. Equity matters but auctions matter *more* — equity is what I care about *after* I've decided I'm going to bid. Before that, I need a calendar.

The calendar lives at `/tax-researcher` instead. So now I'm bouncing between two surfaces. I have to remember which one is which. **Combine them.** A tax-delinquent specialist's home page is one screen with auctions on the left and delinquent-owner outreach on the right. Two separate pages with overlapping data is the kind of IA mistake that tells me a generalist team built this.

**7:10 AM.** I land on `/tax-researcher`. There's the gavel icon, the "Scan calendar" button, four tabs — Auctions, Delinquent properties, Watchlist, Alerts. Better. I type "TN" into the scan field and hit go. The toast says "Scan complete" and a bunch of results show up. Then I open the file. The auction generator writes synthetic auctions with `Math.floor(Math.random() * 200) + 50` listings and a `depositRequired: "500"` for every county. That's not data, that's a placeholder. **The day a competitor publishes the actual Shelby County tax-deed schedule, AcreOS loses me.**

**7:20 AM.** State-rules table. I find this in `taxResearcher.ts`:

```
TX: deed, 25%, 6mo redemption
FL: lien, 18%, 24mo
GA: redeemable_deed, 20%, 12mo
AL: ... not present
TN: ... not present
SC: ... not present
NC: ... not present
```

Eight states. **I work in Tennessee, Mississippi, Alabama, Georgia.** Three of my four states aren't here. Alabama matters specifically because of its three-year super-priority window on the redemption — if you don't know that, you bid wrong on Alabama tax-certificate stock. The fact that AL isn't even in the table tells me whoever wrote this looked up the FL/TX big-name ones and stopped. **You need all 50, not eight.** This is a database problem, not a code problem. Hire a paralegal for two weeks and let them fill it in.

**7:45 AM.** I switch over to `/tax-delinquent` to look at owners I should be calling before the September Shelby sale. The page shows a list with risk badges (critical / high / medium / low), equity %, days-until-tax-sale, score. Layout is fine — the lead card is dense in a good way, equity bar is right where my eye goes, MapPin icon orients me to county. The filters are state and risk-level pills. **I want a fourth filter: "auction date within X days."** Sort by `daysUntilTaxSale` ascending. That's how I prioritize calls. The 11-day-out owner is twenty times more motivated than the 180-day-out owner.

**8:00 AM.** I click Contact on a lead. Toast says "Lead added to outreach sequence." Cool, what sequence? Where did it go? **I don't know what just happened.** This is a tax-delinquent owner — TCPA matters here, fair-debt rules matter here (am I a debt collector under the FDCPA when I call about back taxes? Depends on state). I should be told: which sequence, which channel first (mail vs SMS vs call), what consent state the lead is in. The toast is too thin for a regulated communication.

**9:00 AM.** Auction prep. The watchlist tab on `/tax-researcher` is the right shape — list of listings with min bid and auction date. **What's missing for me: my max bid and a bid log.** Before every sale I build a list with three numbers per parcel — minimum opening bid, my walk-away max, and the assessed value. I do this in Excel because nothing exists for it. AcreOS could own this — `dealHunter.ts` already has a `maxBidAmount` field and a `requiresApproval` flag, the bones are there. Surface it on the watchlist as an editable column.

**10:30 AM.** The auction itself. Most of my Tuesday-morning auctions are still in-person at the courthouse. The Florida ones in May are online. Either way, **I need a mobile bidding worksheet.** Open my watchlist on my phone, see the list ordered by lot number, tap to mark "passed" / "bid" / "won," log my winning bid. Today there's nothing for that. I write it on a clipboard. I would pay $20/mo just for that screen, on its own, if it synced back to AcreOS.

**11:00 AM.** Won three deeds. Now I need to start the redemption clock. In Tennessee that's one year for owner-occupied, less for vacant. **AcreOS does not have a redemption tracker visible anywhere I can find.** The schema mentions `redemptionPeriodMonths` on auctions but I don't see a parcel-level "redemption ends 2027-05-01, X days remaining, owner can still redeem at $X.XX" view. That's the second-most-important number in this business. The most important is "did anybody else file a lien against my certificate."

**11:30 AM.** Florida certificate counter-example. I bought sixteen Florida certificates last May at the Marion County online sale. Florida is a tax-lien state — I'm not buying the property, I'm buying the right to collect 18% (or whatever the bidding-down rate I won at). Two years later, if the owner hasn't redeemed, I file an application for tax deed and the property goes to a separate sale. **AcreOS has no Florida-certificate workflow.** No "interest accrual" tracking, no "bid-down rate I won at" field, no "two-year application window opens 2027-05-12" reminder, no "apply for tax deed" button. The state-rules table even gets FL right (lien, 18%, 24 months) — but the workflow on top of it doesn't exist. So I'd still be in Excel for sixteen certificates that represent ~$48K of my capital. That's the sixteen reasons I'm not switching yet.

**12:15 PM.** Lunch. While I'm eating I check `/today` on my phone. The greeting and Pulse score are noise to me — I want to see "you have 2 mailers ready to print, 4 inbound replies waiting, 3 redemption windows closing this week." None of that's there. The persona system could rebuild this view per persona. I keep coming back to that — the *persona registry exists*, the vocabulary swap *works*, the only thing missing is the surfaces themselves swapping their priority order based on persona.

**1:00 PM.** Quiet-title prep. I bought three parcels. In a year, when the redemption window closes, I have to file quiet-title on each one to get a marketable title. AcreOS has a `titleChainService.ts` with risk scoring and a comment that says "Engage a real estate attorney to develop a title clearing plan." That's nice but it's not a workflow. **A tax-deed buyer's quiet-title workflow is: notify all interested parties of record (heirs, lienholders, neighbors with adverse-possession claims), publish notice, wait the statutory period, file petition, get judgment, record.** That's six tracked stages with deadlines on each. AcreOS could be the first platform to actually run that workflow. Right now it advises you to call a lawyer.

A workable middle ground: partner with a tax-deed-specialist law firm in each major state, expose them via the platform as a "filing service" with a flat fee per quiet-title, and AcreOS automates the document prep + service-of-process tracking. That's a marketplace play I'd happily use. Pricing: $500-$1,500 per quiet-title is what the market bears; AcreOS clips a service fee. Win-win-win.

**3:00 PM.** Door knocking on three pre-foreclosure leads. I open `/field-scout` (this is on Wendell's review and he's right, it's the surprise of the platform). Photo capture, GPS, offline sync. **Add a field for "owner contact attempted: knocked / left flyer / spoke / not home."** Right now field-scout is a parcel-inspection tool. Tax-delinquent fieldwork is half parcel and half door knock. The doorhanger I leave needs to be auto-generated from the lead record — owner name, parcel address, my phone, my LLC, and a one-sentence "we can help with your back taxes" pitch — and AcreOS has the document module, the lead record, and the field-scout tool but doesn't connect them.

**3:45 PM.** Skip-tracing the three "not home" addresses. I see `skipTracingService.ts` exists. I haven't tested it on a tax-delinquent lead yet. **The thing I care about specifically: phones for *current occupants of record*, not phones from a five-year-old credit-header file.** Tax-delinquent owners frequently aren't living at the property anymore; they inherited it from grandma in 1998, never changed the address, the appraisal-district mailing goes to an address that's also stale. If the skip-trace gives me a number that's been disconnected for three years I've wasted a TCPA-permissible call attempt. Let's see if Twilio's reassigned-number lookup is wired in here. (Searched. It isn't.)

Skip-trace cost matters too. Each lookup is $0.30-$1.50 depending on data depth. With 340 leads in my pipeline that's $100-$500 just to enrich the list. AcreOS should cap automatic skip-tracing to "leads with auction within 90 days" by default — that's where the call effort goes — and require an explicit "enrich entire pipeline" button before running the rest. Smart cost control. Right now I'd be afraid to import a 5,000-row Memphis delinquent list because I don't know if it'll auto-burn through my skip-trace credits.

**5:00 PM.** End of day. I'd like a one-screen view: "this week — 3 auctions, 47 leads in active outreach, 12 redemption-clock parcels with X days remaining each, 2 quiet-title actions ready to file." That's my dashboard. `/today` doesn't show me any of that — it's a generic CRM today-view. **Build a tax-delinquent variant of `/today` that the persona registry can swap in.** The infrastructure for that is already there.

**8:30 PM.** Spend an hour on the laptop reviewing the next sale. The thing I want here is an AI assistant trained on tax-deed law. Pax could do this if pointed correctly. Today, when I ask Pax "is this Madison County, MS tax certificate worth bidding on at $4,200 with $1,800 in back taxes," I'd want it to pull the assessed value, the comp sales, the redemption period, the interest rate, the title-chain risk, and answer with a number. That's where Pax earns Pro pricing for the tax-delinquent persona — not generic chat, not stale-lead reminders. **One narrow, deep use case: pre-bid analysis.** Get that right and I'll pay for it.

---

## 3. Per-surface friction

**`/tax-delinquent`** — Renders fine, copy is right, the lead-card information density is good. The problem is upstream: the service is a stub. `taxDelinquentPipeline.getLeads` literally returns `[]`. So the empty state ("No tax-delinquent leads found") is what I see no matter what I do, until I import a CSV. Which brings me to —

The page also has the right loading shape (Loader2 with role=status, aria-live=polite) and a sensible empty-state with copy that doesn't blame the user. The error-recovery toast on the mutation says "your existing leads are unchanged" which is the right reassurance. Eden's microcopy work (or whoever's) is showing. Underrated thing on the page: the `aria-pressed={riskFilter === risk}` on the filter buttons, the `autoCapitalize="characters"` on the state input, the `data-testid` on each lead card. This page is *built right*; it's just empty.

**Import flow** — There's a CSV importer that handles APN/Owner/Amount/Address column aliasing. The aliases list (`APN_ALIASES`, `OWNER_ALIASES`, etc.) is decent. But every county I work in publishes a different format and most of them are PDFs, not CSVs. **Mississippi land-roll exports as a fixed-width text file.** Memphis publishes a PDF with three-column layout. Until somebody writes a "PDF tax-roll → AcreOS" extractor, the import promise is half-met. I'd settle for a column-mapper UI like Wendell asked for, plus PDF support, plus a "I scraped the county website, here's the URL" mode.

The dedup-by-APN is the right design choice. APNs are stable per county, owner names mutate (Smith vs SMITH vs Smith Estate vs Smith Trust), so APN is the only honest unique key. One catch: APNs are *not* unique across counties. Two different counties in different states can both have an APN like `001-0001-001`. The dedup check uses `existingApnSet` keyed by APN alone, no county/state. **Bug — that'll silently merge or skip leads from different counties.** I noticed it because I import Marshall County MS and Marshall County KY and AcreOS would treat them as the same lead pool. Fix: the unique key should be `(state, county, apn)` not `apn`.

The score logic in the import is `score = delinquentYears > 1 ? 75 : 50`. That's the laziest possible scoring. **Real scoring needs:** years delinquent, equity %, tax-to-value ratio, owner age (older owners more likely to settle), absentee status (in-state vs out-of-state owner), prior cure history (chronic vs first-time), parcel size and zoning. The lead-scoring service exists separately; wire it in. Don't ship a 75-or-50 binary as the production scoring.

**`/tax-researcher`** — Better page than `/tax-delinquent` for my workflow. Four tabs is the right number. The "Surface to radar" button is interesting — I don't know what radar is yet, but I'd click it. **Critical: replace the synthetic auction generator with a real auction-calendar provider.** TaxSale Resources sells a feed for $99/mo. Buy it, mark up to $40/mo, pass the savings, ship. Don't try to scrape every county yourself — that's a five-engineer project and you'll get sued by counties.

**State-rules database** — This is the foundational thing. I want a `/state-rules/AL` page that says: redemption period 3 years, super-priority lien on year 4, foreclosure procedure under §40-10-180 et seq, sample notice-to-redeem template, sample quiet-title petition. **That single resource is a real product.** TaxSaleSupport sells this for $97/mo and they're a husband-and-wife shop with a static WordPress site. AcreOS can do better.

The thing nobody talks about: state rules *change*. Texas amended its tax-deed redemption rules in 2017. Florida's certificate sale process moved online county-by-county over the last decade. Each year there are 5-10 substantive amendments across the 50 states. **A static rules table goes stale immediately.** I want a "last reviewed by [attorney name] on [date]" stamp at the top of every state's page, plus a "report a change" link. That single dated review-stamp is the difference between trustworthy and not.

**TCPA on tax-delinquent specifically** — `tcpaCompliance.ts` exists, has STOP-keyword handling, has 8-9pm quiet-hours logic. Good bones. But tax-delinquent calling has a wrinkle: when I call an owner about their back taxes, I'm not selling — I'm offering to buy. That's *not* TCPA-regulated the same way a mortgage solicitor is, but the FCC's reassigned-numbers database and state-level robocall rules still apply. **What I want: a per-state compliance card on the lead-detail view that says "AL: cell calls require express consent, mail OK without consent, SMS requires written consent."** That should be derived from the state-rules database I just asked for.

**Bidding tooling** — `dealHunter.ts` has `maxBidAmount` and `requiresApproval`. That's the start of an auto-bid system. There's nothing in the UI exposing it for tax-sale auctions specifically. **A tax-deed bidder's must-have feature: a pre-auction worksheet that lets me set max bid + walk-away condition (e.g. "skip if anyone else over $5K") + partner split (Marcus 60%, partner 40% if over $10K).** Today this is paper.

**Syndicate / partner accounting** — When I bid with a money partner, the deed gets recorded in my LLC's name but he holds an undocumented (in his head) 40% beneficial interest. AcreOS has zero concept of "this parcel has two owners with a split." The schema treats organizationId as the owner. I'd want either a partner-ledger feature or, at minimum, a free-text field on the parcel that records the split, exports to a partner statement at year-end, and reminds me to issue a 1099 or K-1-equivalent. Hana's tax review gets at this from the CPA side; I want to flag it from the auction-floor side.

**Redemption tracking** — Doesn't exist as a surface. Schema has the field. UI doesn't. **Day-one feature for a tax-delinquent specialist is a redemption-clock dashboard.** Cards with: parcel, certificate number, redemption date, days remaining, current redemption amount (principal + statutory interest accrued), redeemer-of-record. Sort by days-remaining ascending. The math on the running redemption amount is non-trivial — TX uses a flat 25% in the first six months, FL uses bid-down interest, AL uses 12% simple, GA uses 20% simple-then-redeemable, IA uses 2% per month — and most of these have a minimum interest payment. The state-rules database needs to be the input to a `calculateRedemptionAmount(certificate, asOfDate)` function. Right now I don't see one.

**Quiet-title workflow** — Doesn't exist as a workflow. `titleChainService` reports risk, doesn't run the playbook. This is a **deferred feature** for a v1, but list it on the roadmap or you lose the Tier-2 customer who graduates from "buy 3 deeds a month" to "buy 30 a year and needs the legal pipeline managed." A real implementation looks like: per-state quiet-title checklist (notice to lienholders, notice to heirs, publication, statutory waiting period, petition draft, hearing date, judgment recordation), each with a deadline driven off the deed-recordation date, each with a generated document template, each with an audit trail when a step is completed and by which attorney. That's a 90-day-to-build feature that 100% of Tier-2 buyers would pay $30/mo more for.

**Tax-sale due-diligence checklist** — Wendell loves the parcel DD checklist (title clear / no liens / no environmental / access / taxes current). I do too. **For tax-deed buying, the checklist is different**: bankruptcy check on the owner of record (federal automatic-stay defeats my deed), IRS lien check (federal liens survive tax sale in most states), municipal-utility lien check (some states make these survive), prior tax-certificate check (somebody else may have a senior cert), HOA-lien check, environmental (do I want this gas-station site that's now back-tax delinquent — probably not). That's a separate checklist. The tax-delinquent persona should swap the DD checklist contents accordingly.

**Mobile experience** — A tax-deed bidder lives on the phone three days a month: courthouse Tuesday, drive-by Wednesday, online sale Friday. **The current AcreOS mobile experience is unknown to me.** I haven't tested it. If `/tax-delinquent` doesn't render usably on a 6.1" screen at the courthouse with one bar of LTE, I'm out. The fact that `/field-scout` has offline sync gives me hope. The fact that the rest of the app is web-only gives me concern.

**`/today` for the tax-delinquent persona** — Wendell complained about Pulse, AI sections, and goal bars. I'd add: "stale lead" makes no sense for a tax-delinquent lead. A delinquent owner doesn't have a freshness window; they have an *auction-date* window. The today page metric should be "leads with auction within 30 days," not "leads I haven't touched in 7 days." Re-derive the today-page widgets from persona-specific definitions and stop showing me Pulse score, ever.

**`/counties`** — This is interesting. Status, priority, FIPS code, data sources, response rate per county. **For a tax-delinquent operator this is the primary navigation.** I think in counties: Shelby, DeSoto, Tate, Madison. Make `/counties` the home page for the tax-delinquent persona. Click a county, see its auction schedule, its delinquent-owner list, its redemption clock, its mailer drops.

A specific request: per-county "clerk profile" notes. Free-text notes I add: "Shelby clerk's office accepts wires only, deposit due 24h before sale, opens at 10 AM Tuesday, lot list posted at 9:30 AM, no proxy bidding, deeds recorded next-day if paid by 2 PM." Every operator has these notes for every county. **Most operators keep them in a Word doc.** Putting them on the county detail page — searchable, mine, private — is a feature I'd notice within a week.

**`/direct-mail-campaigns`** — I haven't audited deeply but mail is my primary channel. The mailer has to handle: variable-data templates per state (the language to a Texas owner is different from the language to a Florida owner), address standardization (USPS CASS), return-mail tracking (so I know when an address is bad and don't waste another $0.65), and a "do not mail" suppression list that respects the same TCPA-style rules but for mail. I'd want one workflow: select N delinquent leads → drop into a "60-day pre-sale" mailer cadence (T-60, T-30, T-7) → measure response rate by county. If `direct-mail-campaigns.tsx` does that, I'd renew. If it queues into a console somewhere and I have to click "send" on each, I won't.

**`/documents` and signing** — Wendell loves the HMAC-link signing flow. For me the signing flow matters when an owner signs a quitclaim deed to me at the kitchen table for $1,200 instead of letting it go to auction. **The signer is often not tech-literate.** The HMAC public-link approach (no login) is exactly right for my world. Two adds: notarization workflow (most quitclaim deeds need notary — Notarize.com integration, not DocuSign-level), and a state-specific deed template library so I don't accidentally use a TX-style quitclaim in a state that requires a special-warranty.

**`/onboarding-v2`** — One of the personas listed is "Tax Lien / Tax Deed: Purchase tax liens and deeds at county auctions. Research-driven, high ROI." That's me. So the door is right. **Where it falls down: it doesn't ask "which states do you operate in" and then prefill the state-rules + auction calendar.** Easy fix.

**`/inbox`** — A tax-delinquent operator's inbox is dominated by two flavors: heirs of dead owners ("we got your mailer, my mother passed in 2019, what do we do") and confused owners ("am I going to lose my house"). Both require careful, specific replies — the first is an heirship/probate conversation, the second is a "here's what redemption means and here's what we can do" conversation. **A generic AI-drafted reply will fail both.** The drafted-reply quality on these has to be tuned for the tax-delinquent persona specifically, or the feature has to be off by default for this persona.

A specific failure mode I worry about: the AI drafts something that crosses into "unauthorized practice of law" — telling an owner what their redemption rights are in their state. If Pax tells a Mississippi owner "you have until X date to redeem at $Y," and that's wrong, who's liable? The platform should refuse to make legal claims on behalf of the user and instead say "Owner's question references redemption — Pax has flagged this for your review and not auto-replied." Defensive default. Get this wrong once and there's a state-bar complaint.

**`/parcel-detail`** — Best surface in the app per Wendell, and I agree the structure is good. **For tax-delinquent specifically I want a "Tax history" timeline:** assessment year, levy, paid date, delinquent flag, certificate sold to (if any), redemption history, current balance with interest. That's a single SQL view if the `propertyAssessments` data is in there. It would tell me at a glance whether this owner has been chronically delinquent (good lead, high motivation) or is in a one-time crisis (different conversation entirely).

Add a field for "neighbor parcels owned by same name." Adjoiners are gold in tax-delinquent — if the same family owns three parcels and is delinquent on one, the other two are signal. AcreOS already shows neighbors on the composed parcel view; tying it to ownership match is a small SQL step.

**`/pax`** — For me Pax should answer one question: "based on the auction calendar and the redemption clock and my outreach history, who do I call before lunch and what do I say." Not five tabs. One answer. The persona registry already exists; specialize Pax for the tax-delinquent persona.

---

## 4. The legal-compliance test — fail with caveats

When I close on a tax deed, I have nine compliance things to track. Here's how AcreOS does:

- **TCPA quiet hours on owner outreach** — *Pass.* `tcpaCompliance.ts` enforces 8 AM – 9 PM in the *recipient's* local time, not mine. STOP keyword handling is wired up. That's correct.
- **TCPA written consent for SMS to owners I haven't met** — *Pass-ish.* Lead has a `tcpaConsent` boolean. The gate refuses SMS if false. But the UI doesn't surface what the consent record is — was this consent collected by my predecessor, when, on what form? An audit trail is required if I ever get a TCPA letter. I see logging but no per-lead consent provenance view.
- **Reassigned-numbers database check** — *Fail.* No mention. The FCC requires a query before calling a cell; if the number was reassigned and I didn't check, I lose the safe harbor. AcreOS doesn't integrate with the FCC database. This is a $1.50/lookup paid API. **Add it.**
- **State Do-Not-Call lists** — *Unclear.* Federal DNC consent appears handled. State DNC (TX has its own, FL has its own) — not visible to me. Tennessee has a pretty strict one.
- **FDCPA disclosures when contacting about a debt** — *Fail.* Tax-delinquent solicitations can trigger FDCPA in some interpretations (especially if you're an LLC operating across state lines). No mini-Miranda template, no "this is an attempt to collect a debt" disclaimer logic. I write my own.
- **Notice of redemption rights to the prior owner** — *Fail/missing.* Most states require I send statutory notice within X days of taking my deed. AL requires it. TN requires it. AcreOS has a documents module but no template library for tax-deed statutory notices.
- **Notice to lienholders before quiet-title** — *Fail/missing.* Same as above.
- **Title-curative documentation** — *Partial.* `titleChainService` has a risk score. Doesn't ship the curative documents.
- **1099 issuance to redeeming owners** — *Unclear.* When an owner redeems and pays me principal + interest, I owe them a 1099 in some states. No mention.

**Net: this fails the compliance test for a multi-state tax-delinquent operator.** Hana's tax review covers the 1098-INT side; what I'm asking for is the *state-statutory-notice* side, which is different. If AcreOS wants Tier-2 tax-delinquent operators ($30K-$60K/yr software spend), this whole compliance layer needs to ship. For me at 2-3 deeds/month, I'd accept a roadmap commitment and a "we'll add your state by Q3" promise.

One more thing on consent. The TCPA gate refuses SMS without `tcpaConsent = true`. **For tax-delinquent leads I rarely have explicit consent** — I'm cold-mailing owners I scraped from the public delinquent-tax list. The right channel order is: mail first (no consent required), inbound call from owner who got the mailer (creates a consent moment), then SMS/calls from there. AcreOS's gate handles this correctly *defensively* (mail allowed without consent, the rest blocked) but the UI doesn't tell me where each lead is in that consent funnel. **Add a consent-state column on `/tax-delinquent`: Mail-only / Inbound-engaged / Express-consent.** Color-code accordingly.

---

## 5. What's missing — five things that would make me switch tomorrow

1. **Redemption-clock dashboard.** Every active tax certificate I hold, sorted by days-until-redemption-window-closes, with the running redemption amount calculated nightly using the per-state interest formula. This is *the* feature for a tax-certificate buyer. Today nobody offers it well — TaxSaleSupport has a spreadsheet template and that's the state of the art.

2. **All-50-states rules database, lawyer-reviewed.** Per state: type (deed / lien / redeemable deed / hybrid), interest rate, redemption period, statutory notice requirements, quiet-title path, foreclosure procedure citations. With downloadable form templates per state. This is the kind of asset that earns the "AcreOS is the platform for tax-delinquent investors" reputation.

3. **Auction worksheet + mobile bid log.** Pre-auction max-bid setting per parcel, partner-split rules, day-of mobile worksheet with "won / passed / outbid" tracking, post-auction CSV export to my CPA. Replaces my clipboard.

4. **Real auction-calendar feed for at least the top 15 tax-sale states.** Buy the TaxSale Resources feed if you have to. The synthetic generator is fine for a demo, not for a paying customer.

5. **PDF tax-roll extractor.** Half my counties publish delinquent-tax lists as PDFs. If AcreOS can OCR a county PDF into a normalized lead list, that's the import flow that wins. The OCR fixture file at `tests/e2e-intelligent/fixtures/ocr/tax-01-redemption-soon.json` suggests somebody started this. Finish it.

6. **(Bonus.)** Two-way sync with QuickBooks for tax-deed cost-basis. When I buy a deed at auction for $4,200, my CPA needs that recorded as a basis with breakout: bid amount, transfer tax, deed-recording fee, due-diligence cost (title search, drive-by gas), legal fees if any. AcreOS has a finance module; making it the system-of-record for deal basis and pushing clean entries to QuickBooks would replace another tool I'm using.

7. **(Bonus.)** Heir/probate workflow. Half my mailer responses come from heirs. The conversation needs: have they opened probate? Do they have authority to convey? Affidavit of heirship vs full probate? Per-state heir rules (homestead, community property, dower). A short heirs-questionnaire flow that pre-qualifies the conversation would save me a 45-minute call where I find out 30 minutes in that the heir can't actually sign anything.

---

## 5a. Data-source reality check

Every tax-delinquent SaaS pitch lives or dies on data. Here's where the real data actually is and what AcreOS needs to do about it:

- **Delinquent-tax lists.** Each county publishes its own. Most counties: PDF, posted around July or August for that year's June auction. Some counties: searchable web app with no export. A handful: clean CSV. **AcreOS needs at minimum a county-by-county scraper roster** — even if it starts with the top 50 tax-sale counties, that covers maybe 60% of national volume. The `delinquentListScraper.ts` filename suggests work has started; I'd want to know which counties are live.
- **Auction calendars.** TaxSale Resources sells a pretty good national feed — they aggregate county announcements. Negotiate a wholesale rate and resell. Don't try to scrape 3,000 counties.
- **Redemption status (per-certificate).** Most counties do *not* expose certificate-level redemption status in any structured way. I have to call the clerk every quarter on every certificate. **A nightly clerk-website scraper for the top counties would replace 4 hours/week of phone tag for me.** Selling this *alone* would justify the subscription.
- **Bankruptcy / federal lien status on owners.** PACER has the data, $0.10/page. Integrate. The `legalIntelligence.ts` file is in the repo — does it hit PACER? I didn't dig deep enough to find out.
- **Title chain.** Most counties' GIS/clerk websites have grantor-grantee indexes. `titleChainService.ts` is here — promising. I'd want it to flag whether the chain has any gap, mortgage, easement, or HOA reference for the last 30 years.

The reason this matters: a tax-delinquent operator's spend on data is real. I currently spend ~$200/mo on data alone (TaxSale Resources, county subscriptions, occasional skip traces). **AcreOS's pricing logic should assume I'd be willing to swap most of that to AcreOS if the data quality matches.** That's why "BYOK data providers" matters — let me bring my TaxSale Resources key, my PACER login, my DataTree key, route all the lookups through AcreOS, and only charge me for the platform.

---

## 5b. Florida-specific gap I want named separately

Florida is its own product within tax-delinquent investing. Not a state — a product. Here's why and what AcreOS misses:

- Florida runs annual tax-certificate sales (not deed sales) every May/June, online, county-by-county.
- Bidders bid the *interest rate down* from 18% — winner is whoever takes the lowest interest rate.
- Two years after the certificate is sold, the certificate holder can apply for a tax deed — *that* triggers a separate tax-deed sale where the property gets auctioned.
- **AcreOS has neither the bid-down workflow nor the two-year-clock-then-apply workflow.** A Florida-only investor who tries AcreOS today gets less than half a product.

That's a separate vertical inside tax-delinquent. There are people who run $2M of capital across nothing but Florida certificates. They'd pay $200/mo for the right tool. AcreOS could become it; today it isn't.

---

## 6. Three things that are surprisingly good

1. **The persona vocabulary actually maps to my world.** Calling the unit of inventory a "Tax certificate" instead of "Property" or "Listing" — that's the level of detail that tells me a real product person sat down with this. Most CRMs make you live in their nouns. AcreOS is willing to learn yours.

2. **TCPA quiet-hours enforcement on the recipient's timezone, not the sender's.** That's the correct read of the regulation and most platforms get it backwards. Whoever wrote `tcpaCompliance.ts` knew what they were doing. STOP-keyword handling, opt-out logging, blocked-reason copy that explains the rule — all good.

3. **`/counties` exists.** Most platforms organize around leads or properties or campaigns. For a tax-delinquent specialist, *the county is the fundamental unit*. Each county has its own auction schedule, its own clerk's office, its own quirks (Shelby is professional, DeSoto is a 1980s time capsule). Having a first-class county page with priority + status + per-county metrics is exactly the right shape. Now tie it to auction calendars and redemption clocks and you have a category-defining product.

4. (Bonus.) **The fact that the database has tables called `taxSaleAuctions` and `taxSaleListings` at all.** Most "real estate CRMs" don't model auctions as a first-class entity. They model parcels, leads, deals, and they make you shoehorn an auction into a "deal stage." AcreOS has the right data model. The query layer in `taxResearcher.ts` (`getUpcomingAuctions`, `getAuctionListings`, filters on state/county/saleType/format/status) is well-designed — it's the actual *contents* of those tables that's the problem, not the shape.

---

## 7. Pricing reaction

I haven't seen the pricing page through the tax-delinquent lens specifically. Wendell says four tiers, $20 / $49 / $79 / Scale, 14-day trial. For me:

- **$20 Starter** — I'd pay it on day one to use the lead pipeline and the persona vocabulary. Even with the auction layer being a stub, it's better than my Excel.
- **$49 Pro** — I'd pay this **only if** redemption tracking and the all-50-states rules database ship. Today, no.
- **$79 Scale** — Not me. I'm a one-man shop with a part-time researcher, not a 5-seat operation.

The "BYOK data providers" angle at Pro that Wendell flagged matters double for me — I already pay TaxSale Resources, I want to point AcreOS at my existing key, not pay them to resell it back to me with a markup.

**My fair price for what I want:** $59-$79/mo for a single-seat tax-delinquent specialist tier that includes the redemption clock, the all-50-states rules library, the auction calendar with real data, and the bid worksheet. I'd sign for two years at that price. I'm currently spending $97 (TaxSaleSupport) + $99 (TaxSale Resources) + $50 (DocuSign) + $40 (a CRM) = ~$285/mo on this stack. AcreOS replacing four of those at $79 is a ~$200/mo win for me, and worth it.

One more pricing note: the "AI requests / day" cap that Wendell flagged matters for me too, in a different way. A tax-delinquent operator hammers AI for two things — drafting outreach replies to confused owners, and summarizing title-chain documents. The latter is token-heavy. **Quote me a per-feature rate, not a per-request cap, or I won't know what I'm buying.** If I can summarize 200 deeds/month at Pro and that's enough, fine. If "request" means "any model call" and a title-chain summary burns 12 requests, I'll hit the cap before the second sale of the year.

---

## 8. The deal-killer if not fixed

**The redemption clock.** Everything else is a feature; the redemption clock is a fiduciary obligation. If AcreOS tells me "redemption window closes 2027-05-01" and the actual statutory deadline was 2027-04-15 because Alabama counts from the *first Monday after the sale* and not the sale date, **I lose a $40,000 property.** Once. Not twice. Once and I'm gone, and I'm telling every land investor I know.

That means three things have to be bulletproof:

1. The per-state redemption math is reviewed by a real attorney in each state. Not a Google search. A real lawyer.
2. The clock recalculates nightly and surfaces exceptions (holiday-extended deadlines, owner-occupied vs vacant, military-tolling under SCRA).
3. The redemption amount calculation matches the county clerk's calculation to the cent. If I quote a redeemer $4,732.18 and the clerk says $4,732.49, that's a real-money problem.

If you can show me one full year of accurate redemption tracking on a sample portfolio of TX/FL/GA/AL parcels, with the math reconciled against the county clerks at quarter-end — I'll move my whole operation onto AcreOS the next morning and I'll co-write a case study.

That's the test. Notes for Wendell, redemption clock for me. Different specialty, same bar: **the money math has to be right.**

A second-tier deal-killer if I'm being thorough: the pipeline service stub. `taxDelinquentPipeline.getLeads` returning `[]` is not a UI bug — it's a "the feature doesn't exist yet" signal. The page renders so beautifully that I assumed for the first ten minutes that I was just missing data. When I opened the file and saw `async getLeads(_opts: any) { return []; }` I lost some confidence that the pretty pages elsewhere in AcreOS are backed by real services. The tax-delinquent and tax-researcher routes both work, but if the Demo Tuesday is built on stub returns, somebody is going to demo this to a buyer who actually checks. Wire it up before the next big sales call.

The third-tier observation: the `tax_delinquent` persona is one of seven in the persona registry, the audit trail of recent commits shows real investment in the persona system, and the vocabulary work alone would take a generalist team three weeks. Whoever pushed this through cared. I'd rather see that team finish the tax-delinquent vertical end-to-end than ship two more half-finished personas. Pick one persona to make excellent. **Make it mine.**

If I had to give the team a 90-day plan from where I sit:

- **Day 1-30:** Replace the `taxDelinquentPipeline` and `taxResearcher` stubs with real implementations. Wire up the lead query, the scoring service, and one real auction-calendar feed (TaxSale Resources or equivalent) for ten priority states.
- **Day 31-60:** Ship the redemption-clock dashboard and the `(state, county, apn)` dedup fix. Expand the state-rules table to all 50 states with attorney-reviewed entries for at least the top 15 tax-sale states. Add the auction worksheet with max-bid + partner-split.
- **Day 61-90:** State-specific notice templates for top states. PDF tax-roll OCR for the top 25 counties by volume. Mobile bid-log screen. Heir/probate questionnaire. PACER bankruptcy-status check on every lead.

That's a single engineer + one paralegal + a half-time product designer. It's a real product by Q3. I'd buy the trial in week one and renew at the end of Q3.

A final note on positioning. The user-memory says "use 'Land Investors,' not 'real estate professional'" — agreed. But within Land Investors, "tax-delinquent specialist" is a real sub-vertical worth naming. The current persona-panel description ("Buy properties from owners behind on taxes (pre-foreclosure or at tax sale). Specialized auction calendar + state-rules.") is correct. Keep using it. Don't water it down to "real-estate-investor types" in the marketing.

— Marcus
