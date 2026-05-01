# Trey Morales — AcreOS user review (Wholesaler)

I run a residential wholesale shop out of Phoenix. Six deals a month, $8K to $25K assignment fees, no rehab risk because I don't actually own the houses. My stack: PropStream for skip traces, Lead Sherpa for SMS blasts, Pipedrive for the pipeline, DocuSign for the assignment-of-contract, and an Excel sheet of 240 cash buyers I've spent four years building. That spreadsheet is my retirement plan. Anybody who wants to replace it has to earn it.

I spent a half day clicking through AcreOS. Here's the report.

---

## 1. Thirty-second verdict

Would I sign up today? **Trial-only, $20 Starter, no card moved off REI Pro.** I'd wholesale-test it on two real deals before I trust the assignment paperwork to it.

At **$49/mo Pro** I'd switch *if* the buyer-matching engine actually distinguishes a cash buyer from a tire-kicker, the assignment-of-contract template holds up in front of a title company, and the platform lets me push a property out to my buyer list without uploading a CSV. I see two of those three. The third (push-to-buyer-list) is unclear.

At **$79/mo Scale** — not for one wholesaler. The seat math doesn't work unless I'm running a 4-acquisition-manager team, which I'm not.

What stops me: AcreOS thinks the world ends at "seller closed and we recorded the deed." **I don't ever record a deed.** I assign a contract. The whole Notes/Portfolio/Cash-flow scaffolding is built for somebody who keeps inventory. I flip paper. So 60% of `/money` and 100% of `/portfolio` are wallpaper for me.

---

## 2. Daily-use walkthrough — my imagined first day

**7:45 AM.** I land on `/today`. Pulse score, AI actions, expiring offers. Fine for a buy-and-hold guy. **I want one number — assignments closed this month — and one list, "buyers I haven't called in 30+ days."** Not here on the default. The dashboard is built for a portfolio operator, not a transactional wholesaler.

**8:10 AM.** I switch persona to "Wholesaler" in settings. Vocabulary changes — leads become "Motivated sellers," properties become "Subject properties," deals become "Assignments," and the closed-stage rename flips to "Assigned." That's actually the right move. I noticed it immediately. **Whoever wrote `personaVocabulary.ts` understood the word "assigned" matters.**

What I also got: a `WholesalerWidgets` component on the dashboard with **Assignment Fees, Speed to Close, Buyer List Health (active/stale), and a Deal Funnel (Leads → Under Contract → Assigned → Closed).** That's exactly the four tiles I'd build. I was impressed.

Then I looked at the file. **It's hardcoded mock data.** `WHOLESALER_MOCK = { assignmentFees: 187_500, avgAssignmentFee: 12_500, speedToClose: 14, buyerListHealth: { total: 248, active: 189, stale: 59 } }`. Those are the same numbers every wholesaler will see on day one until somebody wires them to real org data. **That's a demo, not a feature.** If I see those exact numbers and I have zero deals in the system, I lose trust in everything around it. Replace the mock or hide the widget until you have data.

**8:45 AM.** I go to `/leads`. CSV import. Lead Sherpa exports a CSV with phone, owner name, property address, "motivation" tags. Does the column-mapper handle it? Wendell asked the same question — same answer matters to me. **The hot/warm/cold/dead icons map fine to my "answered/callback/not-interested/dead" buckets.** The bigger question: when a motivated seller calls back from one of my SMS blasts, does the inbound get attached to the existing lead automatically, or do I have a new orphan record? Couldn't tell from skimming.

**10:00 AM.** I open `/parcels/:id` on a subject property I'm trying to lock up. The composed view is fine for raw land. **For my use case — a 3-bed/2-bath in Maryvale built in 1972, ARV $310K, repairs $45K — most of these tiles don't help.** I want: ARV, repair estimate, comp sales, current owner equity, lien status. The "DD checklist (title clear, no liens, no environmental, access verified)" doesn't quite fit residential wholesale either. I want **clear title + no judgment liens + clean payoff + assignable contract** as my checklist. Not the same thing.

**10:30 AM.** The AcreOS Wholesale Deal Checklist (`shared/schema.ts:2890`) — six items: Assignment contract prepared, End buyer verified, Earnest money deposited, Assignment fee confirmed, Original contract assignable, Closing coordinated. **That's actually correct.** Whoever wrote this read at least one wholesale-deal walkthrough. The "Original contract assignable" item is the one most non-wholesalers miss — your seller contract has to *not* contain a non-assignment clause, or the whole deal dies. Points for that.

**11:30 AM.** I look at the assignment-of-contract template (`server/storage.ts:5316`). Standard recital, ASSIGNOR/ASSIGNEE clause, assignment fee variable, signature block. **It's a clean template.** It's also **state-generic** — Arizona is fine, but **if I try to use this in Illinois, Oklahoma, or South Carolina I commit a misdemeanor.** Those states require a real-estate license to assign for a fee unless you take title (i.e., double-close). The template doesn't warn me. The state field is just text — no validation. **That's a compliance bomb.** Either show a warning when state ∈ {IL, OK, SC, …} or refuse to render the assignment template and recommend a double-close path. I'll come back to this.

**12:30 PM.** Lunch. I check `/inbox` on my phone. Lead Sherpa pumps 80 SMS replies/day during a campaign. **Can the inbox handle that volume? Can I bulk-archive the "stop / not interested / wrong number" replies?** Unclear. If the inbox shows me 80 unread without a "respond / dismiss / mark not-interested" triage flow, I close the tab.

**2:00 PM.** I go to `/matching-engine` (yes, AcreOS has one — `client/src/pages/matching-engine.tsx`, 248 lines). I see "Buyer matching engine," propertyId/buyerId inputs, a "Run" mutation that hits `/api/matching/run`. **This is the feature I came for.** I open the underlying schema (`shared/schema.ts:7944` `buyerProfiles`). Profile types are individual / **investor** / developer / builder. Financial info has `financingType` field with values **cash, owner_finance, conventional, hard_money**. Intent has `investmentGoal: flip / hold / develop / recreation`.

So the answer to my big question — **does AcreOS support cash-buyer matching, not just seller-financed end-buyer matching** — is **yes, it does**, both at the schema level (`financingType: 'cash'`) and in the matching algorithm (`buyerMatchingAI.ts:649` — `if (financingType === "cash") { reasons.push("Buyer has cash to purchase") }`). That's a meaningful surprise. I expected to find a seller-finance-only engine and didn't.

**Caveat:** the matching is property-driven, not buyer-driven. I want to drop a new subject property in and have it **blast my matched cash buyers automatically** — email/SMS, "got a new one in 85016, $185K assignment, ARV $310K, repairs $45K, want to see it?" I see `runMutation` and "matches found" but I don't see a one-click "notify all matched buyers." That's the wholesaler workflow. Without it, I'm exporting matches to a CSV and going back to Mailchimp.

**3:30 PM.** I try to model a **double-close**. Some deals you can't legally assign (FHA-financed seller, IL/OK/SC, MLS-listed property where the seller agent flagged the contract non-assignable). I have to buy at 9 AM and sell at 9:01 AM through a transactional funder. **AcreOS doesn't have a double-close flow.** I searched — `pipelineIntelligence.ts:113` literally says "Quick turn with assignment or double-close" as text in a comment, but there's no actual A→B→C deal structure in the data model. The deal model is one buyer, one seller. Double-close needs A-B contract + B-C contract + transactional funding tracking. That's a missing primitive.

**4:30 PM.** Earnest money. I find references to `earnestMoney` everywhere — offer letters, settlement statements, deal records. **What I don't find: an earnest-money state machine.** EMD goes to the title company on Day 0, sits in escrow during the inspection period (typically 7–10 days), is refundable to me until inspection-period expiration, then becomes non-refundable. **Where in AcreOS does that timeline live?** Nowhere I could find. My biggest financial risk on a wholesale deal is forgetting I'm past inspection and can't get my $1,000 EMD back. A simple "Inspection period ends in 2 days — EMD becomes non-refundable" notification would save me $200+/year. Doesn't exist.

**5:00 PM.** Days on contract — my single most important KPI. AcreOS has `daysOnMarket` everywhere (12+ files), but **days-on-contract is something else entirely**. From the moment I lock up a seller to the moment I assign to a buyer — average is 7 days for me, target is 3, dead deal at 14. AcreOS tracks contract dates and closing dates but I didn't find a single dashboard tile that says "Lot X has been under contract for 9 days, 5 days until inspection expires." Compared to the hardcoded `speedToClose: 14` in `WHOLESALER_MOCK`, it's clear the team thought about the metric but didn't wire it.

**5:45 PM.** Buyer match rate. My rule of thumb: if I list a deal to my 240-buyer list and fewer than 8 reply, I've priced it wrong. I went looking for a "match rate" or "buyer response rate" view in AcreOS and found `buyer_property_matches` table with a `status` enum (pending, presented, interested, not_interested, purchased) — that's exactly the right state machine. Whoever modeled the schema knew what they were doing. **What I can't find: the analytics view that turns those statuses into a "this deal got 14 presented, 6 interested, 1 purchased — 43% interest rate, above average" tile.** The data is there. The chart isn't. Build it.

**6:15 PM.** Title company integration. Every wholesale deal I do hits a title company twice — once for the A→B contract review and once for the assignment closing. I see scattered references to `titleCompany` strings on deal records but no integrated workflow — no "send wire instructions to title," no "request preliminary title report," no "assignment-fee disbursement instructions." I do all of that today by emailing PDF attachments to a single closer at Old Republic. AcreOS could plausibly streamline this; right now it's a free-text field on a deal record and that's it.

---

## 3. Per-surface friction

**`/today`** — Wrong default for me. Built for a portfolio holder, not a transactional wholesaler. I want: assignments closed this month, EMD-at-risk, buyers not contacted in 30 days, hot leads waiting on me. Those four tiles. The Pulse score I will literally never look at.

**`/leads` (Motivated sellers, with the persona swap)** — The vocabulary swap is correct. The hot/warm/cold/dead icons map fine. **My ask: bulk SMS-blast directly from a filtered list, with a script template, response-tracking, opt-out compliance (TCPA + 10DLC).** Without that, Lead Sherpa stays in my stack.

**`/parcels/:id`** — Surfaces are okay but **residential-wholesale-specific data fields are missing**: ARV, repair estimate, current loan balance, equity %, motivation tags from the SMS campaign. The DD checklist is land-investor-flavored. Add a residential-wholesale variant.

**`/deals` (Assignments)** — The Wholesale Deal Checklist (6 items) is the right shape. **Critical add:** an "Original contract assignable?" boolean on the parent contract record, with a hard warning if I try to create an assignment when it's set to false. Right now it's just a checklist item — easy to lie to yourself. Make it data.

**`/matching-engine`** — Best surprise in the audit. Cash buyer support is real. **What's missing: one-click "blast matched buyers"** for a property. Email blast with property card + photos, SMS with "interested? reply YES." Track replies inline. Without this, I'm exporting matches to a CSV.

**`/documents` + `/sign-document`** — The HMAC-link signing flow is excellent (Wendell flagged this — agreed). The assignment-of-contract template (`server/storage.ts:5316`) is clean. **Critical add: state-aware compliance warnings.** If `state ∈ {IL, OK, SC}` or any state with active wholesaler-licensing rules, refuse to render the assignment template and surface a "double-close required in this state" banner. AcreOS already has a Dodd-Frank checker (`server/services/doddFrankChecker.ts`) — same architecture, different rule set. Build the wholesale-licensing checker.

**`/money`** — Empty for me. Notes are for note investors. Portfolio is for hold investors. Cash flow is for hold investors. Forecast same. Capital Markets — even less. **Hide the whole `/money` surface for the wholesaler persona, or replace it with Assignments Ledger (assignments closed, fees collected, fees outstanding, EMD at risk, refundable vs non-refundable) and a 1099-MISC pack at year-end.** Year-end wholesale tax is 1099-MISC for assignment fees, not 1098-INT.

**`/portfolio`** — Hide it for wholesalers. I don't have a portfolio.

**`/inbox`** — Acceptable for low-volume. **For Lead Sherpa-volume SMS replies (50–100/day during a blast), I need a triage view: bulk archive "stop / wrong number / not interested," auto-detect TCPA-opt-out keywords (STOP / UNSUBSCRIBE / QUIT), one-click "warm" tag.** I also need a daily 9 AM "do not call before" guardrail — TCPA limits SMS to 8 AM–9 PM in the recipient's local time. If AcreOS isn't enforcing this, I'm one complaint away from a $500/text class action.

**`/field-scout`** — Wendell loved this. I'm lukewarm. Wholesalers don't usually do drive-bys on raw land. We do drive-bys of distressed houses to confirm the photos in the listing aren't lies and to figure out repair scope. **The offline sync is fine, but the inspection checklist is land-investor-flavored ("access verified," "boundary fence visible") and not residential-flavored ("roof condition," "foundation cracks visible," "obvious water damage").** Add a residential checklist variant.

**`/campaigns` (direct mail)** — I don't actually use direct mail much; my volume is SMS. But for the wholesalers in my mastermind who do mail, AcreOS' campaign module is a Pebble-replacement story, not a Lead Sherpa-replacement story. The SMS-blast tooling I'd need (10DLC registration, A2P compliance, scheduled drips, opt-out enforcement) is a different feature set. Don't conflate them.

**`/pax`** (the AI assistant) — `paxPersona.ts:30` already adapts to wholesaler vocabulary: "Use 'motivated seller,' 'buyer list,' 'assignment,' 'EMD,' 'contract-to-close.' Avoid 'hold period' or 'cash flow' — wholesalers flip contracts, not properties." That's the right framing. I'll find out if the actual responses respect it. If Pax tells me to "track cash flow," I turn it off.

**`/onboarding-v2`** — `value: "residential_wholesaler"` is in the wizard. Good. The wizard pre-populates a sample lead "Wholesale — targeting $15k assignment fee" (`server/services/onboarding.ts:823`). That's a thoughtful seed. Keep it.

**`/dashboard` Wholesaler widget** — Replace mock with real data or hide until org has 1+ assignment recorded. Showing $187,500 in assignment fees on a brand-new account is a credibility-killer.

---

## 4. The wholesale tests — pass / partial / fail

1. **Cash-buyer matching (vs. seller-financed end-buyer matching only)** — *Pass.* `buyerProfiles.financialInfo.financingType` accepts `cash`, and `buyerMatchingAI.ts` scores cash buyers correctly. Unexpected.

2. **Assignment-of-contract paperwork** — *Pass on template, fail on compliance.* Template (`server/storage.ts:5316`) is well-formed and has the right variables (assignment_fee, original_contract_date, parcel_number). State field is freeform with zero validation against jurisdictions where assignment-for-fee requires a license.

3. **Double-close flow** — *Fail.* Mentioned in a comment (`pipelineIntelligence.ts:113`) but not modeled. No A→B→C deal structure. No transactional-funding tracking. I'll lose every IL/OK/SC deal or have to leave the platform mid-deal.

4. **Earnest-money state machine (refundable → non-refundable)** — *Fail.* `earnestMoney` is a number on records. There's no inspection-period timer, no refundability flag, no notification when I'm 48 hours from non-refundable. This costs me real money.

5. **State-by-state assignment legality warnings** — *Fail.* Compliance Guardian exists for general rules but I found nothing wholesale-licensing specific. IL and SC have material restrictions; OK and a few others have advertising/marketing restrictions. The platform should know.

6. **Days-on-contract KPI** — *Fail.* Hardcoded `speedToClose: 14` in `WHOLESALER_MOCK`. No live computation. The data is in the deal record (contract date, expected close date) — wire it up.

7. **Buyer-match notify-and-track** — *Partial.* Matching exists. Outreach trigger from a match doesn't. I can't blast my matched buyers in one click.

**Net:** AcreOS is **about 50% there for residential wholesalers**, which matches what's in the vertical-expansion plan. The 50% that's done is well-done (vocabulary, persona switching, schema, the matching engine, the assignment template). The 50% that's missing is the operational core — double-close, EMD timer, state compliance, days-on-contract, push-to-buyer-list. Without those five, I keep Pipedrive and DocuSign.

---

## 5. Five features that would make this a no-brainer switch

1. **Push-to-buyer-list with one click** from `/parcels/:id`. Hit a button, AcreOS pulls matched cash buyers from `buyer_property_matches`, sends an email + SMS with property card and photos, tracks who opens, who replies, who books a walkthrough. Replaces my Mailchimp + manual CSV exports. **This is the single feature that flips me from $20 trial to $49/mo paying.**

2. **State-aware assignment compliance.** When I create an assignment-of-contract document, AcreOS checks `state` against a wholesaler-licensing matrix. If IL/OK/SC: hard-stop with "this state restricts wholesale assignment-for-fee — switch to double-close path?" link. The matrix is public information (NAR + state licensing boards). Codify it once, never get sued.

3. **EMD inspection-period timer.** When I record EMD on a deal, I pick an inspection-period length (default 7 days). On day 5, push notification: "EMD becomes non-refundable in 48 hours — confirm inspection results or back out." Saves me $1,000 per blown deal. Zero technical risk to build.

4. **Double-close primitive.** First-class deal type with A-B contract, B-C contract, transactional-funder field, same-day closing logic. Without it I cannot use AcreOS in regulated states or on non-assignable contracts.

5. **Days-on-contract dashboard tile** — real, not mock. From contract execution to assignment-recorded. Show me current cycle, 30/60/90-day rolling average, and which active deals are over my target. This is the wholesaler equivalent of "monthly cash flow" for a buy-and-hold.

6. **(Bonus, nice-to-have)** Buyer-match analytics rollup. Given the `buyer_property_matches.status` enum is already there, surface a "deal X had 14 buyers presented → 6 interested → 1 purchased" funnel per assignment. Then aggregate: "your 30-day average is 38% buyer interest rate; market average is 24% — you're priced well."

7. **(Bonus, nice-to-have)** A "buyer profile freshness" check. My buyer list goes stale fast — 30% of buyers I emailed 18 months ago aren't buying anymore. AcreOS has `engagement.lastContactDate` and `responsiveness` already in the schema. Flag buyers I haven't pinged in 90 days; auto-send a re-engagement email; auto-deactivate after 180 days of silence with my approval. Saves my deliverability and keeps the list useful.

---

## 6. Three things that are surprisingly good

1. **`personaVocabulary.ts` and `paxPersona.ts` together.** When I switch to "Wholesaler," "Closed" becomes "Assigned," "Lead" becomes "Motivated seller," and the AI assistant explicitly avoids saying "hold period" or "cash flow" to me. That's a thoughtful, consistent, mostly-zero-effort UX move. Most platforms would force me into land-investor language.

2. **Cash buyer matching is real.** I expected `buyerProfiles.financialInfo.financingType` to be `cash | owner_finance | hard_money` only on paper, with the matching algorithm only optimizing for owner-finance. It actually scores cash buyers correctly (`buyerMatchingAI.ts:649`). Whoever built this wasn't thinking land-only.

3. **The Wholesale Deal Checklist's "Original contract assignable" item.** Most wholesale-CRM checklists I've seen don't include this and it's the single most common deal-killer. The `shared/schema.ts:2898` line tells me somebody on this team has been on the receiving end of a busted assignment.

4. **(Honorable mention)** The Pax persona vocabulary file (`paxPersona.ts`) explicitly tells the AI not to say "cash flow" or "hold period" to a wholesaler because we flip contracts, not properties. That's the single most thoughtful AI-product detail I've seen in any CRM I've trialed. It signals the team understood that the *language* of the persona shapes whether the AI feels useful or generic. Don't lose that as the platform scales — it's a moat.

---

## 7. The deal-killer if not fixed

**State-by-state assignment legality.** Illinois passed wholesale-licensing rules in 2019. Oklahoma in 2021. South Carolina restricts marketing of properties you don't own. Pennsylvania has a pending bill. **If AcreOS lets me generate and send an assignment-of-contract document in a regulated state without a warning, and I get caught, the platform is materially complicit in my legal exposure.** I'll never sign a SaaS contract that doesn't at minimum *try* to keep me in compliance, because every minute I spend defending a complaint is a minute I'm not closing deals.

The fix is small: a JSON file of state rules, a check in the assignment-template generator, and a warning banner. Maybe four hours of engineering. Until that ships, I keep the assignment-of-contract paperwork in DocuSign with a checklist taped to my monitor and a phone number for my real-estate-licensed business partner saved in my contacts.

Everything else — the matching engine, the persona vocabulary, the deal checklist, the dashboard widgets when they're wired to real data — is already a credible wholesale CRM. Get the compliance bit right and add the double-close flow and you've taken Pipedrive's lunch for half my peer group.

— Trey
