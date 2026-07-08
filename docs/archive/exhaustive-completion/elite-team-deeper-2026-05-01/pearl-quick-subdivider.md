# Pearl Donato — AcreOS, the quick-cycle subdivider lens

I'm Pearl. Forty-nine. Reno. I do what Brigid does, except I don't. She buys 200 acres, hires Earl, fights Williamson County for two years, and walks away with thirty lots. I buy forty acres in Lyon or Storey, cut it into eight lots, and I'm done in nine months. Minor subdivision. The Nevada minor-subdivision threshold is four lots in a 24-month window in most jurisdictions; some counties go to nine. I sit *right under* that ceiling on purpose. No public hearings, no environmental impact statement, no road bond on a county road I'm not building. Surveyor stamps the parcel map, planning department checks the boxes, recorder's office takes my $50 plus $1 per lot, and I'm selling.

I read Brigid's review. She's right that AcreOS doesn't do subdivision. She's also reviewing it from the wrong end of the telescope. Her problem is *fourteen permit gates over thirty-six months*. My problem is *nine months, four gates, and I sell Lot 3 of 8 before the parcel map records*. Different gravity. Different software needs.

---

## 1. Thirty-second verdict

Trial it on Starter, $20. Move my work over? Closer than I thought I'd say. Here's the thing — most of what AcreOS gets wrong for Brigid (no polygon drawing, no fourteen-step permit tracker, no road-bond ledger) I don't actually need. I'm not building roads. I'm not platting public infrastructure. My map is *eight lots and an existing county road frontage.* So the absence of a heavyweight subdivision module doesn't kill me the way it kills her.

What does kill me: AcreOS treats every transaction as one-parcel-in, one-parcel-out. My transaction is *one parcel in, eight parcels out, sold over six months, three of them before the map records.* That data model gap shows up everywhere — pipeline, financials, notes, taxes. Fix the parent-to-children relationship at the parcel level and I'm 70% home.

At $49 Pro: trial. At $79 Scale: trial *if* the parent-child parcel model ships. Without it I'm back to a spreadsheet for the per-lot tracking and AcreOS becomes the deal-finding tool only.

---

## 2. Daily-use walkthrough — Wednesday in Dayton, NV

**6:30 AM.** Coffee on the back deck. Sun's already on the Pine Nuts. I open `/today` on the iPad. The dashboard is built for a flipper holding twelve assignments — *whose contract closes Friday, whose seller went silent.* My equivalent question is **"which of my eight Dayton lots have a buyer's lender ordering an appraisal this week?"** That's not a flipper question. It's a quick-subdivider question. Eight active children under one parent, each in its own micro-funnel, all of them moving on different timelines because Lot 1 went under contract in week 6 and Lot 7 still has a sign in the dirt at week 22.

I see the `/parcels` list. Each one is a row. If I add my eight Dayton lots as separate parcels, my parcel list explodes — I'm running three projects of 6-8 lots each, that's 24 rows for what I think of as three deals. If I add them as one parent parcel, I lose the per-lot tracking. **There is no third option.** Brigid hit the same wall. Mine just hits faster because I cycle three times a year, not once every two.

**8:00 AM.** New deal — 38 acres in Lyon County off Como Road. Owner wants out, his kids don't want it, asking $185K. Comp on minor-sub'd 5-acre parcels in that pocket is $52-58K. Eight lots × $54K avg = $432K gross, minus $185K acquisition, minus ~$28K survey + parcel map fees + recording, minus $14K marketing, minus carry — pencils to about $190K net over nine months. Fine deal. I want to load it.

**The intake screen asks me about acquisition price, county, APN, acreage. Good. It does not ask me: "do you intend to subdivide?" If yes, "into how many lots?" If yes, "minor or major sub?"** That fork should drive the entire downstream UI. Right now everything assumes I'll resell the 38 acres as 38 acres. I won't. Nobody on Como Road wants 38 acres in one chunk; they want 4.75.

**9:30 AM.** Surveyor call. Mark from Carson Valley Survey says he can shoot it in three weeks, draft parcel map two weeks after that, signatures and recording another four. Total: 9 weeks to recorded map. That's the critical-path schedule for the *whole* project. **AcreOS has nothing for this.** I want a `/projects/:id/timeline` Gantt-ish surface with the four real gates: (1) survey complete, (2) parcel map drafted, (3) planning department approved, (4) recorded with county recorder. Each gate has a date, a vendor, a fee, a doc. That's *it*. Quick-cycle subdivision is dramatically simpler than Brigid's fourteen gates — but the four gates I have are non-negotiable and they need a screen.

**10:30 AM.** Per-lot pricing strategy. Of my 8 lots, 2 will be corner lots (premium $4K each), 1 has a clear view of the Pine Nuts (premium $6K), 1 backs to BLM with no neighbor (premium $5K), 4 are interior standard. Total premium: $19K. I price them: Lot 1 (corner, view) $62K. Lot 2 (corner) $58K. Lot 3 (BLM-back) $59K. Lot 4 (view) $60K. Lots 5-8 standard at $54K. Average $58.5K, gross $468K — better than my $432K conservative.

I want a **per-lot pricing matrix** at the parent-parcel level. Columns: lot number, base price, corner premium, view premium, BLM-adjacency premium, paved-road premium, listed price, status (available / reserved / under contract / closed). Stretch goal: an "auto-suggest" column that pulls comps from `/comps` filtered to similar acreage in the same county and ranks each lot's premium against actual sold premiums. AcreOS has `comps-engine.tsx` — I haven't gone deep but if it's parcel-level it can be lot-level for me with a parent-child link.

**12:00 PM.** Pre-recording sale. Here's the move that makes quick-subdivision work: I list Lot 1 the day the parcel map goes to planning department review. I sell it on a *conditional purchase contract* that says "closing contingent on recordation of parcel map within 90 days." Buyer puts $2,500 earnest in escrow, I tie up their interest, by the time the map records I have 3 of 8 lots already under contract. **This is a Nevada-quick-cycle play. AcreOS doesn't know about it.** The deal-stage model assumes the parcel exists as a recordable legal description. My Lot 1 doesn't yet — it exists as "the southwest corner of APN 029-021-08 per draft parcel map dated 2026-04-15." A conditional contract on a not-yet-legal lot is a real instrument with a real escrow holder, and the platform should let me create it.

What I want: a deal stage called **"conditional / pre-recording"** that flags the contract as non-recordable until the parent parcel map records. When the map records, the system should prompt me to substitute the now-real legal description into the contract addendum, re-sign if necessary, and move to standard closing. That's a six-week feature for a developer who understands the workflow.

**1:30 PM.** Owner-finance per lot. Of my 8 lots, I expect 5 cash and 3 owner-financed. Typical Nevada land note: 15% down, 9% interest, 10-year amortization, no balloon, late fee of 5% of monthly payment after 10 days, recording the deed of trust at Lyon County recorder. AcreOS has `/finance` and the note ledger. **The ledger handles one note per parcel cleanly. It does not handle three notes against three different child lots that all came from one parent.** When I run my January 1098-INT batch, my CPA needs interest reported per note (per child lot), not consolidated to the parent. Same gap as Brigid flagged. Mine breaks at 3 notes per parent; hers breaks at 12. Same fix.

**2:30 PM.** Nevada usury. State maximum is 12% for non-licensed lenders, 36% for licensed. I'm not licensed. I run notes at 9%. AcreOS has `usury.ts` — I checked, Nevada is in there at the right cap. Pass.

**3:00 PM.** Recording. Lyon County is $50 base + $1 per page for parcel map; deed of trust is $40 first page + $1 each additional. Carson City and Storey are similar. Washoe is its own animal — they want e-recording through Simplifile and they reject anything that isn't in the exact margin spec. AcreOS has `recordingFeeBase` per state but not per-county for Nevada. **Nevada needs per-county overrides — Lyon, Storey, Washoe, Douglas, Carson City, Lyon, Churchill at minimum.** Same architectural gap Cesar flagged for Texas. Same fix: county-level fee table override.

**4:30 PM.** The parcel map itself. This is *the* document for a Nevada minor subdivision. NRS 278.471-471.460 covers it. Format: 24"×36" mylar, scale 1"=100' typical, surveyor's seal, owner's certificate, planning director's signature block, recorder's filing block. Every county has minor format quirks. **AcreOS has no parcel-map template generator.** I don't expect it to draft the survey itself — Mark does that — but the *cover sheet* with owner certificate, dedication language ("we hereby make and certify this parcel map..."), and county-specific signature blocks is boilerplate. A template pack for the top 5 Nevada counties would save me $200/project in surveyor cover-sheet drafting time.

**5:30 PM.** Planning department speed. Lyon County planning turns minor sub'd parcel maps in 4-6 weeks if your packet is clean. Storey is 6-8. Washoe is 8-12. **The single biggest determinant of my profit per project is speed-to-recording** — every week I'm carrying that $185K acquisition I'm bleeding interest. I want a `/projects/:id/speed-tracker` showing days since survey complete, days since map submitted, days since planning approval, with the county's average benchmark in red if I'm over. That's the *whole quick-cycle subdivider's KPI in one widget.* It does not exist anywhere in AcreOS today.

**7:00 PM.** Marketing. I drop signs at Lots 1, 4, and 8 the week the survey shoots. I list on Land.com and Lands of America, plus my own one-page WordPress site. I do *not* mail. My buyer is a Bay Area family wanting a weekend acreage, not an absentee owner I'm cold-mailing. So the entire `direct-mail-campaigns.tsx` surface that AcreOS leans on is irrelevant to me. **The buyer-side marketing surface — Land.com listing sync, lead capture from a public listing page, "interested buyer" pipeline parallel to the seller pipeline — is where I'd actually use AcreOS.** I see `lead-management` exists but it's framed as inbound-from-mail. I want inbound-from-listing.

**9:00 PM.** Books. Each lot is its own basis allocation problem. I bought 38 acres for $185K plus $12K closing = $197K total basis. I allocate basis to each child lot by a method my CPA blesses — usually relative acreage with a premium adjustment. Lot 1 (5.2 acres, premium) gets $28.4K basis. Lot 5 (4.6 acres, standard) gets $22.1K. When Lot 1 sells for $62K, gain is $33.6K *on that lot*. AcreOS has no concept of basis allocation across child parcels. This is the *core* accounting problem of subdivision and it lives in my Excel file. If the parent-child parcel model ships, basis allocation is the second feature off the rank.

---

## 3. The quick-subdivider test — what passed, what didn't

**Pass:**
- Nevada usury cap (12% non-licensed) recognized
- Mapbox map with measurement (good for "sketch a lot, get acreage")
- Document version infrastructure (parcel map revisions are real)
- Note ledger handles one note per parcel cleanly
- Comps engine exists; could be re-pointed at child-lot scale
- `/parcels/:id` is the strongest surface (Wendell, Cesar, Brigid all agree, and I do too)

**Fail or Missing:**
- **No parent-child parcel relationship.** Killer. Same as Brigid. Mine breaks faster.
- **No "intend to subdivide?" fork at parcel intake.** Should drive UI.
- **No four-gate quick-sub timeline** (survey → map drafted → planning approval → recorded).
- **No per-lot pricing matrix** with corner/view/BLM premium columns.
- **No conditional / pre-recording deal stage** for selling Lot 1 of 8 before the map records.
- **No basis-allocation accounting** across child parcels.
- **No Nevada per-county recording fee table** (Lyon, Storey, Washoe, Douglas).
- **No parcel-map cover-sheet template pack** for Nevada minor subs.
- **No speed-to-recording KPI widget** — the *primary* quick-sub metric.
- **No buyer-side listing-pipeline surface** parallel to the seller pipeline.
- **No 1098-INT consolidation per child lot** (same as Brigid; Cesar flagged at parent level).

Net: AcreOS is closer to working for me than for Brigid because my workflow is 4 gates not 14 — but the parent-child gap blocks the same percentage of value. Different denominator, same fraction.

---

## 4. Per-surface friction (quick-subdivider lens)

**`/parcels/:id`** — Add a "subdivision" tab. Inside: subdivision type (minor / major), lot count, per-lot table with pricing matrix and status, link to the parcel-map document, four-gate timeline. That's the surface I'd live on.

**`/finance`** — When I create a note against Lot 3 of an 8-lot subdivision, the note should know its parent. 1098-INT batch in January should produce 3 separate forms for the 3 financed lots, not one consolidated for the parent.

**`/deals`** — Add the "conditional / pre-recording" stage. Auto-promote to "under contract" when the parent parcel map records. That single state machine is the quick-cycle subdivider's secret weapon.

**`/today`** — Replace the Pulse score with a *speed-to-recording* counter for active subdivisions. "Como Road project: 47 days since survey, 21 days since map submitted, 3 days into Lyon's 28-42 day approval window." That's my Tuesday morning question, every Tuesday.

**`/comps`** — Filter by minor-subdivision-derived lots specifically. The comp set for a 5-acre lot in a 6-lot minor sub is *not* the same as raw 5-acre tracts. Buyers pay differently. The data is in there if AcreOS can tag it.

**`/onboarding`** — When I pick "Subdivider" persona, ask the follow-up: "minor (under 10 lots) or major?" Pearl-flow and Brigid-flow diverge from there. Different timelines, different document packs, different financial models. Don't lump us.

**`/pricing`** — At $49 Pro the value-prop is unclear for me. At $79 Scale with the parent-child model and basis allocation I'd pay it without blinking. A "Subdivider" tier at $99/mo with parcel-map templates, four-gate timeline, and per-lot 1098-INT would be the easiest yes of my year.

**`/pax`** — Pax is fine for buyer-side messaging. Nevada-Bay-Area buyers respond to short, factual, no-fluff. Pearl voice = direct. The same regional voice toggle Cesar wanted, with a "high-desert plainspoken" preset.

**`/inbox`** — Buyer-side inbox is more important to me than seller-side. The drafts should know I'm replying to a *buyer* asking about Lot 4, not a *seller* asking about acquisition. Different scripts.

**`/field-scout`** — Lyon and Storey have spotty cell. Offline-sync is right. Add: a "lot pin" mode where I drop GPS pins for each child lot's corners as I walk the parcel pre-survey. Mark uses my pins as a sanity check against his survey. Saves a $400 re-shoot when something doesn't pencil.

---

## 5. What's missing for quick-cycle subdivision — priority order

1. **Parent-child parcel relationship in the data model.** Without this, nothing else lands. Same priority Brigid put on it.
2. **Per-lot pricing matrix** with corner / view / BLM-adjacency / paved-road premium columns and status per lot.
3. **Four-gate quick-sub timeline** (survey complete → parcel map drafted → planning approval → recorded) with county benchmarks.
4. **Conditional / pre-recording deal stage** with auto-promotion when parent records.
5. **Basis allocation across child lots** at the accounting layer.
6. **Per-lot 1098-INT** for owner-financed children.
7. **Nevada per-county recording fees** (Lyon, Storey, Washoe, Douglas, Carson City, Churchill).
8. **Parcel-map cover-sheet template pack** for Nevada minor subdivisions.
9. **Buyer-side listing pipeline** with Land.com / Lands of America sync.
10. **Speed-to-recording KPI widget** on `/today`.

---

## 6. Pricing reaction (Reno operator math)

I run 3 projects/year × 7 lots avg = ~21 lot transactions. ~$1.1M GMV. Annual stack:
- LandGlide: $499
- DocuSign: $40/mo = $480
- QuickBooks: $90/mo = $1,080
- Land.com Pro listings: $59/mo = $708
- Surveyor cover-sheet drafting: $200 × 3 = $600
- Excel: my time, ~5 hours/week × $40/hr = ~$10,000/year

Total ~$13,367/year, of which $10K is my time. AcreOS at $79 Scale = $948. At a hypothetical $99 Subdivider tier = $1,188. The math works *if* it actually replaces:
- Excel basis allocation
- Excel per-lot pricing matrix
- DocuSign for conditional contracts
- Land.com listing management
- Surveyor cover-sheet drafting

Ship parent-child + per-lot pricing + the four-gate timeline + conditional deal stage and I switch this quarter. Without parent-child, I'd open AcreOS twice a week to look up comps and that's it.

---

## 7. The deal-killer

The conditional / pre-recording contract. If I'm going to use AcreOS to sell Lot 1 of 8 before the parcel map records — and that single move is *the* working-capital lever in quick-cycle subdivision — the platform has to handle the not-yet-legal-description problem cleanly. Either it lets me create a deal against a draft child-lot-pending-recordation, or it doesn't and I fall back to DocuSign and a Word template. If it doesn't, I'm running two systems for the same project: AcreOS for the parent, DocuSign+Excel for the children. That's worse than just running DocuSign+Excel for everything.

The parent-child data model is the foundation. The conditional deal stage is the column it holds up. Get those two right and Brigid and I both come on board, even though our timelines look nothing alike.

I'd run AcreOS in shadow mode against my next project — the Como Road forty — for the next nine months. If by recording day it's tracked all four gates, priced all eight lots, handled three conditional contracts, and produced clean per-lot 1098-INTs in January — I cancel my LandGlide and my Land.com Pro the same day.

— Pearl
