# Adelaide Sharpe — AcreOS through the NAR lens (deeper pass)

I'm Adelaide Sharpe. Fifty-one. CTO at the National Association of REALTORS®, Chicago. This is my second pass on AcreOS — wave one was the thirty-thousand-foot brand-and-Code review. This pass is the one I'd hand to my SVP of Strategic Alliances before she put the file in front of our member-benefits committee. It is more specific, more prescriptive, more dollar-denominated, and — because I have now read the server tree, not just the client surfaces — more concerned than I was three weeks ago.

I'm not going to repeat the wave-one verdict. I'm going to update it.

---

## 1. The trademark surface is wider than I thought

In wave one I flagged two `realtor` strings in `client/src/components/campaigns-content.tsx`. I owe you a correction. There are at least five customer-facing instances, and three of them are on the server, which means they're emitted from your platform whether or not the client UI is involved:

- `server/services/onboarding.ts:58` — *"No realtor fees / We handle all closing costs"* — shipped as a default outbound mailer template to every new organization on signup.
- `server/services/onboarding.ts:209` — *"No realtor commissions. No staging."* — short-term-rental seller template, again shipped on signup.
- `server/services/negotiationPipeline.ts:231` — *"There are no realtor commissions, no closing costs on your end"* — emitted from the AI negotiation pipeline as default offer-letter copy.
- `client/src/components/campaigns-content.tsx:90` and `:153` — the two I already had.

This matters because *your platform is the publisher*. When a member's outbound mail-merge inserts AcreOS-supplied template copy into 3,000 letters, the federally registered mark has been infringed 3,000 times — and the registrant of record (you, the platform) is the most attractive defendant, not your customer. The fact that some of these strings are *seeded into every new org during onboarding* means the infringement clock starts on day one of every customer relationship. I would call this an existential trademark posture problem if you were a public company; you're not, but the next funding round's IP rep-and-warranty diligence will surface it, and we will be asked to comment.

There's a sixth instance worth knowing about: `server/services/sellerIntentPredictor.ts:474` uses the lowercase token *"realtor"* as a keyword in a listing-detection heuristic — *"const listingKeywords = ['listed', 'realtor', 'real estate agent', 'zillow', 'mls', 'for sale by owner']."* That is *fair use* (descriptive, classifying, internal), and our trademark group will not pursue it. But it's worth noting because if you ever surface that keyword list to the customer ("we detected the word 'realtor' in your seller's note"), the analysis flips. Keep it server-side.

The remediation is mechanical and you can ship it Friday: a single grep, a single PR, replace `realtor` with `agent` in copy strings, leave the heuristic keyword alone, push. I want a screenshot of the diff. Until I see it, AcreOS is not on the partner-track conversation.

---

## 2. The MLS/RESO connector — a category change

I missed this in wave one and it is the single most important thing in this pass. `server/services/connectors/registry.ts:270-290` registers a connector named *"MLS / RESO API"* with a setup URL pointing at `nar.realtor/reso`. `server/services/connectors/executor.ts:329-370` implements the calls. `server/ai/tools.ts:789` exposes it as an AI agent tool: *"Search MLS listings via RESO API. Find active listings or sold comps."*

This changes my read of AcreOS's regulatory posture. In wave one I told you that you were *outside* IDX/VOW jurisdiction because you don't pull MLS data. That is no longer true. The moment a customer connects an MLS via RESO, AcreOS becomes an MLS data consumer, and the consuming application is bound by:

- The MLS's local IDX policy (display rules, attribution, refresh cadence, sold-data restrictions).
- The MLS's local VOW policy if any AcreOS surface is consumer-facing (registration, scraping protection, retention).
- NAR's MLS Statement 7.0 / 8.0 framework on third-party data display.
- The MLS's data-licensing agreement, which the *participant* signs but the *vendor* is bound by via flow-down terms.

You currently treat the RESO connector as if it were any other data source — same provider-registry plumbing as your tax-assessor pulls. It cannot be. RESO data is *contractually distinct.* You need:

1. A connector-level policy layer that knows which MLS the participant is pulling from, what their IDX/VOW agreement permits, and what the cache-and-display constraints are. About 580 of the ~600 US MLSs publish their rules in machine-readable form via the RESO Web API Reference Server. This is buildable.
2. A flow-down agreement template that *your customers* sign, asserting they are an MLS Participant in good standing, that they have authorization to share data with AcreOS, and that they will indemnify on policy violation.
3. Sold-data restriction enforcement. Many MLSs prohibit displaying sold data to non-participants or beyond a 3/5/7-year window. Your AVM and comps surfaces have to honor that, per-MLS, dynamically.
4. Vendor certification. If you want NAR's blessing on this connector, RESO has a certification program. Get certified. Display the badge. It's a one-quarter, ~$15K-$30K commitment.

Until those four are in place, I would advise our members *not* to connect their MLS to AcreOS. I won't say that publicly yet — I'll say it privately to the state-association CTOs at our June meeting — but the clock is ticking.

---

## 3. AVM disclaimers — the wave-one ask is half-shipped

Credit where due. `client/src/components/required-disclaimer.tsx:21` and `client/src/components/disclaimer-banner.tsx:23` already carry AVM language: *"AVM estimates are algorithmic approximations, not certified appraisals. Do not use as the sole basis for financial decisions. Obtain a licensed appraisal for material transactions."* That copy is good. It hits the right notes for the appraisal-licensing boards in 47 of 50 states.

What's missing is the *placement audit*. I traced the disclaimer component into the AVM surfaces and the picture is uneven:

- `client/src/pages/avm.tsx` — disclaimer present on the screen, not on the toast notification at line 349 ("Valuation complete. AVM estimate ready."), not on the alert-creation flow at line 127.
- `client/src/pages/avm-bulk.tsx:89` — the bulk CSV export header is *"Address,County,State,Acreage,AVM Value,Price/Acre,Confidence %,Low Estimate,High Estimate."* No disclaimer column, no header row preamble. A spreadsheet with a $73,400 number in it that travels to a seller via email is the *exact* artifact our state appraisal boards send cease-and-desists about.
- `client/src/pages/parcel-detail.tsx:339` — the AVM card description is *"Get an automated value estimate from the AVM."* Disclaimer is not in the card; it's elsewhere on the page. A user who screenshots the card has stripped the disclaimer.

The fix: render the disclaimer *inline*, on every artifact that escapes the application. CSV row 1 above the header. PDF footer. Print stylesheet. Toast notifications. Email previews. Treat it the way a brokerage treats the equal-housing logo — as a non-negotiable atom that travels with the data.

This is a half-day of work and it eliminates 80% of your appraisal-board exposure. Do it before you ship the `avm-bulk` feature to general availability.

---

## 4. Post-Sitzer compliance — a buildable roadmap

Wave one named the gaps. I want to give you the buildable shape:

**State BBA-requirement table.** Add `bbaRequired: boolean`, `bbaStatuteCitation: string`, `bbaEffectiveDate: Date`, and `bbaExceptions: string[]` to your `stateDocumentConfig.ts` schema. As of May 2026 the states requiring written buyer-broker agreements for some or all representation are: California (AB 2992), Florida (mandatory effective Aug 2024), New York (Reg. § 175.7 amendment), Massachusetts (effective Jan 2025), Maryland, Colorado, Minnesota, Texas (TREC rule revision), and Pennsylvania. Idaho and South Carolina have legislation in committee. I'll send the citation table to your legal contact.

**BBA template.** NAR's model form (revised October 2024) is the safest starting point. We license it under a member-benefit data-use agreement at $0 to vetted partners. It must include the four settlement-mandated elements: specific compensation amount or rate (not "as agreed"), objective and ascertainable, capped at the buyer's agreed amount, no broker compensation greater than the agreed amount. Wire it into your native e-sign pipeline as a tier-1 template. If you want one quick win that signals partnership-readiness to my committee, this is it.

**Compensation workflow update.** `server/services/commissionService.ts` is seller-pay, tiered, agent-of-record. Augment it with a buyer-pay model: who is the buyer's broker, what's the BBA-stated amount, who's funding the difference if seller concession is negotiated. The data model needs three new fields: `buyerBrokerId`, `bbaCompensation`, `sellerConcessionToBuyerBroker`. Keep them nullable for the investor flow that doesn't have a buyer-broker.

**Legal-intelligence card refresh.** `client/src/components/legal-intelligence-card.tsx` mentions RESPA Section 8. Replace or augment with: *"Per the NAR Practice Changes effective August 17, 2024, MLS Participants representing buyers must have a signed buyer-broker agreement before showing property. AcreOS users acting as buyer agents should ensure a BBA is on file."* Conditional render: only show if the user self-identified as a licensee. Investors don't need this and shouldn't see it.

---

## 5. The licensure-question architecture — the linchpin

Everything above depends on AcreOS knowing which users are licensed. Today, the schema has no licensure flag. `shared/schema.ts:10236` lists document types — passport, drivers_license, articles_of_org, proof_of_funds, accreditation_docs — and not real-estate-license. That's the gap.

The minimum viable build:

1. Onboarding step (`components/onboarding/OnboardingWizard.tsx`): *"Are you a licensed real estate agent or REALTOR®?"* — three options: *Yes (REALTOR® / NAR member)*, *Yes (state-licensed, not NAR)*, *No*.
2. User-record fields: `isLicensedAgent: boolean`, `licenseState: string | null`, `licenseNumber: string | null`, `narMemberId: string | null`, `licenseVerifiedAt: timestamp | null`.
3. License-verification flow. Two paths:
   - *State-licensee verification:* hit the ARELLO data feed (Association of Real Estate License Law Officials) — covers all 50 states + 10 Canadian provinces, ~$0.12/lookup at volume. We use it ourselves.
   - *NAR-member verification:* M1 API. Per-query, rate-limited, fee-waived for endorsed partners. We extend it under a data-use agreement.
4. A `licenseStatus` event stream that respects the 24-48 hour propagation from local boards on disciplinary action, dues lapse, ethics violation. Cache TTL 24h max. If status flips, the Code-of-Ethics shield turns off and a notification fires.

The `Code-of-Ethics shield` itself is a cross-cutting feature flag, not a separate product. When on, it:

- Injects license-disclosure boilerplate into mailer templates per the licensee's state ("I am a licensed real estate agent in [STATE], License # [X]").
- Conditionally renders Article 1/2/12/16 reminders at decision points (sending an offer below market, soliciting a listed parcel, exporting MLS-derived comps).
- Activates BBA-required prompts in transactions where the user is on the buyer side.
- Logs every shield-relevant event for audit. If a member is later subject to a state ethics complaint, the audit log is their defense.

---

## 6. Article 16 deep-dive — the listed-parcel exclusion feature

Wave one mentioned this as a tooltip. It deserves more weight. Article 16 is the most-litigated Article in our Code in any given year — about 38% of professional-standards complaints route through it. The base rule: REALTORS® shall not engage in any practice or take any action inconsistent with exclusive representation or exclusive brokerage relationship agreements that other REALTORS® have with clients. Direct mail to a listed-with-another-broker owner is the fact pattern.

AcreOS's direct-mail wizard targets owners by APN with no listing-status filter. For a non-licensed investor that is legal and uninteresting. For a REALTOR®, it is an Article 16 grenade. The build:

- Accept an MLS-export CSV of listed parcels (the user's own MLS feed, exported under their participant agreement).
- Subtract those APNs from the mail list.
- Show a count: *"432 of your 5,800 targeted parcels are currently listed and have been excluded."*
- Log the exclusion event for audit.
- *Optionally,* offer to enrich via RPR® for the same effect (RPR has live MLS-listed flags for 99% of US counties and can do this without a customer-side CSV upload). This is the easiest hook into a paid RPR integration deal.

This single feature would do more for AcreOS's standing with our professional-standards committee than any other thing on this audit. Article 16 protection is a *near-religious* concern for our members.

---

## 7. The member-benefit deal — what the math actually looks like

Wave one was vague on dollars. Let me get specific. NAR has 1.5M members. Our internal data — from the 2025 Member Profile and the LANDU certification cohort — says ~12% of REALTORS® touch raw-land transactions in any given year, ~2.5% are full-time land specialists. That's a 37,500-member primary addressable market and 180,000-member secondary.

A member-benefit deal in our REALTOR Benefits® program at the level you'd want — exclusive in the land-investor-CRM category, featured in the monthly member-benefit email, included in the new-member onboarding kit — typically delivers 4-7% trial conversion in year one for vendors with a price point under $200/month. Land-specialist sub-segment converts at 11-15% historically. AcreOS's Pro tier is $189/mo if I read the pricing page right; that's right in the sweet spot.

Conservative model: 2.5% of full-time land specialists × 12% trial conversion × 60% retention to paid = 540 paid seats year one. At a 25% member discount on $189 (= $142/mo net to AcreOS), that's $920K ARR from the partnership in year one, before any spillover into the broader 12% addressable.

Our typical ask in exchange:
- 25-30% member discount, validated via M1 lookup at checkout. Non-negotiable.
- Featured placement in the LANDU certification curriculum. ~$50K underwriting ask, channeled through the NAR Center for REALTOR® Development.
- One co-authored whitepaper per year with the Center for Real Estate Studies. Editorial control shared. Distribution by NAR.
- Booth + speaker slot at REimagine annual conference, fee waived. Counts as in-kind ~$28K.
- Right-of-first-refusal on the next category we open (rural-land-financing CRM, e.g.). Optional, negotiable.

Total partnership cost to AcreOS in year one: ~$80K cash + ~$340K in discount margin. ROI breakeven inside year two assuming 70% retention. This is one of the more attractive vendor-economics profiles I've seen this year.

The conversation does not happen until items §1-§5 above are shipped.

---

## 8. RPR® integration — the strategic hook

Realtors Property Resource is wholly owned by NAR. 169M parcels, 99% county coverage, MLS-listed flags, live ownership, school overlays, FEMA flood, environmental, a residential AVM and a commercial AVM. It's free to NAR members, paid for vendors, and the current vendor-integration partners include Constellation, Lone Wolf (zipForms), Boomtown.

AcreOS's existing provider mix on tax-delinquent and absentee data is strong in suburban and high-volume rural counties (you've integrated with the major data brokers; I won't name them in writing). It's *weak* in deep-rural and Western states where the assessor-data normalization is a known industry pain point. RPR's coverage is stronger there because we've spent fifteen years cleaning it. A paid RPR enrichment hook into your parcel detail surface would close that geographic weakness in a quarter.

The deal we've done with comparable partners: per-query pricing tier, with member-versus-non-member rate cards, and an SLO commitment from RPR engineering. The build on your side is one server-side connector and a UI affordance. About four weeks of work plus a six-week legal cycle. I can shortcut the legal cycle if your CEO calls our RPR CEO directly.

---

## 9. What I want to see in 90 days

In priority order:

1. **All five `realtor` template strings replaced.** Server-side and client-side. Diff in my inbox.
2. **Licensure question shipped at signup.** Three-option, M1-ready schema.
3. **AVM disclaimer audit complete.** Inline on every escape artifact (CSV, PDF, email, screenshot-bait surfaces).
4. **MLS/RESO connector flow-down agreement.** Until shipped, the connector is gated behind a "contact us" form, not self-serve.
5. **BBA template in the contract library.** NAR model form, e-sign-ready.
6. **State BBA-requirement table** in `stateDocumentConfig.ts`, parallel to the usury table.
7. **Listed-parcel exclusion feature** in direct mail wizard, even in v0 (CSV-paste flow).
8. **Legal-intelligence card refresh** to mention August 2024 Practice Changes.

Items 1-3 are this-week work. Item 4 is two-week work but customer-facing-policy-significant. Items 5-8 are quarter-scale.

If I see seven of eight by August 1, 2026, AcreOS is on the agenda for the September member-benefit committee. If I see fewer than five, we wait another cycle. If I see fewer than three, the conversation defaults to "thank you, please reapply when ready," which is institutional code for *not this year, possibly next.*

---

## 10. The closing note that wave one didn't have

Wave one closed on a tone of cautious encouragement. This pass is harder, because the MLS/RESO connector adds a regulatory dimension I wasn't tracking before, and because I now know how broadly the trademark misuse is seeded into your platform. You are *not* a malicious actor — that's clear from the code; the strings read as boilerplate someone wrote in 2022 and never revisited. But "not malicious" does not buy patience from our trademark counsel, and "not negligent" is the bar you have to clear, not the one you currently sit on.

I also want to acknowledge what's *good*. Your investor-first lane is strategically correct. Your disclaimer infrastructure exists; it just needs to be wired everywhere. Your provider registry is well-architected for adding compliance overlays without re-plumbing. Your e-sign roadmap means BBA templating is plausibly a sprint, not a quarter. The *bones* of a NAR-partner-ready platform are in this codebase. The flesh is missing in specific, addressable places.

Ship the eight items. Send me the changelog. We'll talk in September.

— Adelaide Sharpe, CTO, NAR
