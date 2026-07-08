# Cesar Reyes — AcreOS, the Texas lens

I'm Cesar. Forty-six. Austin. Twelve years buying raw land in Hays, Williamson, and Travis — $30K to $120K parcels, mostly seller-finance because that's how Texas works for a guy who didn't want to be a landlord. My stack is REI Pro for the pipeline, Pebble for the mail, Excel for the books, and a small title company off Brodie Lane that knows me by my truck. I read Wendell's review. He's right about most of it. I'm here to stress-test the Texas-specific corners of this thing because if AcreOS can't survive Texas it can't survive — half the seller-finance land business in this country happens between Houston and Lubbock.

---

## 1. Thirty-second verdict

Trial it on Starter, yes. Move my live deals over? Not until I see how it handles a §5.069 and §5.072 disclosure on a real contract for deed, and I see a Travis County recording packet come out the back end formatted the way the clerk on the seventh floor of 1000 Guadalupe will accept it. Until then it's a very pretty demo.

The good news: AcreOS *knows Texas exists.* `server/services/usury.ts` line 46 has me at 18% with the Tex. Fin. Code § 302.001 cite. `server/services/stateDocumentConfig.ts` knows my deed type is general warranty with vendor's lien, knows my lien instrument is a deed of trust, knows the recording office is the County Clerk, and — this surprised me — has a CAUTION note on contract-for-deed pointing at Property Code 5.061-5.086. Somebody read the statute. That's better than 90% of the CRMs I've used.

The bad news: knowing the statute exists is not the same as generating a compliant document. There is no §5.069 seven-day disclosure form in the document templates. No §5.072 financing-statement disclosure. No TREC 9-16 (unimproved property contract). No Texas homestead designation flow. The platform knows enough to warn me — not enough to *protect* me.

At $49 Pro: trial. At $79 Scale: not for one operator and a part-time bookkeeper.

---

## 2. Daily-use walkthrough — Tuesday in Buda

**6:45 AM.** Coffee. Phone. I open `/today` on my truck console. Wendell already complained the dashboard is too dense; he's right. For me the only thing that matters at 6:45 is "did anybody from yesterday's mail drop call back overnight?" I need a *Texas-flavored* dashboard widget — *callbacks from this week's mailer, sorted by county, with the appraisal district link one tap away.* That doesn't exist. Pulse score doesn't help me call Mrs. Garza in San Marcos.

**8:30 AM.** New lead from a probate attorney in Round Rock — 14 acres in Williamson. I add the parcel. The DD checklist is good. **What I want and don't see:** a "homestead status?" field on the property. In Texas this is the difference between a clean closing and a six-month nightmare with a surviving spouse. The 10-acre rural / 100-acre urban homestead rules under Tex. Const. Art. XVI § 51 are *the* gotcha for raw land flips, and AcreOS doesn't ask the question. I would bake a homestead-checkbox into the parcel intake and a corresponding notice on the closing checklist. Right now I'd track it on a Post-it stuck to my monitor, which is exactly what I'm trying to leave.

**10:00 AM.** Title chain. I want to pull deed history on this Williamson parcel. AcreOS has provider integrations — I can see the registry exists at `server/services/providers/`. But Williamson County's clerk records search is its own portal; Travis runs through Travis Central; Hays is on a third system. Does AcreOS pull from the county clerks directly or only the appraisal districts? I couldn't tell from the surface. **The honest test for a Texas tool: type a parcel, get back the chain of title with grantor/grantee/instrument number/recording date going back to the last warranty deed.** If AcreOS can't do that, my title company on Brodie still earns its $300/closing.

**11:30 AM.** I draft an offer. This is where I get nervous. In Texas an unimproved-land purchase contract should be TREC 9-16 (or the parties' own contract — but realtors and most attorneys reach for 9-16). I see `offer-wizard.tsx` exists. Is the output a TREC form? Or a generic land-contract template AcreOS wrote in-house? **If it's the second, my title company will hand it back and ask me to rewrite it on 9-16. That's a daily-use blocker.** I would ship a Texas template pack: 9-16 unimproved, 11-7 farm and ranch, 36-9 financing addendum, 39-9 amendment, all variable-data filled from the parcel record.

**1:30 PM.** Seller-finance terms. Borrower wants 0% down, 9% interest, 30-year amortization with a 5-year balloon on a $58K parcel in Hays. I run it past `/finance`. The note ledger lets me set it up. **Critical for Texas:** does it warn me about Dodd-Frank SAFE Act applicability? I'm a single-property-per-year seller, I'm probably exempt under the 3-property safe harbor, but a software that lets me set up ten of these without a peep is going to put somebody in CFPB territory. I see `server/services/doddFrankChecker.ts` exists. Good. I'd want that warning *in the note creation flow,* not buried in a compliance tab.

**2:30 PM.** Usury check. 9% on a Texas note is fine — 18% is the cap under Fin. Code § 302.001. I set the rate, AcreOS doesn't flinch. Good. But what about late fees? Texas has its own late-fee jurisprudence (§ 302.103 mostly), and a "5% of payment after 10 days" late fee is standard. Does the platform enforce that as a soft ceiling? I didn't see it.

**3:00 PM.** I sign the contract for deed. **Stop.** Texas Property Code § 5.069 requires the seller to give the purchaser, *before* execution, a written notice with seven specific items including the property's recorded liens, tax status, insurance status, survey, and a financing disclosure. § 5.072 requires it be in 14-point bold or larger. **There is no surface in AcreOS that produces this notice.** None. The state config file even *flags* the risk in `landContractNotes`. Knowing the risk and not generating the doc is the worst possible position — it's like a smoke detector that beeps but doesn't have a battery slot.

If I sign a contract for deed in Texas without the §5.069 disclosure, the buyer can cancel and rescind for two years, and the court can award them attorney's fees. AcreOS is one bad closing away from a customer lawsuit on this. Fix it.

**4:30 PM.** Recording. My title company files at the Travis County Clerk. Travis charges $26 first page + $4 each additional, e-filing through Simplifile. Williamson is similar. Hays is similar but their staff is slower in person. AcreOS has `recordingFeeBase: 25, recordingFeePerPage: 4` for TX in the config. Close enough — but per-county is what matters, and the test in `tests/unit/countyRecordingFees.test.ts:198` does pass `Travis`. So *somebody* has thought about this. Question is whether the **recording packet** comes out as a PDF I can hand to my title company or whether it's just a number on a screen.

**6:00 PM.** Mailer drop. I run 1,200 letters/month through Pebble for the absentee-owner list filtered by Hays and Caldwell. AcreOS has `direct-mail-campaigns.tsx`. Does it actually drop mail or queue it for me to drop somewhere else? If the latter, Pebble stays. If the former — and the variable-data templates handle a Texas-specific motivation script (probate, tax-delinquent, out-of-state owner, post-foreclosure) — I'd cut my Pebble cord and save $180/month. Big if.

**8:30 PM.** I sit on the porch with a Lone Star and check `/portfolio`. I have 11 active notes across three counties, total UPB about $480K. The aging buckets (current / 30 / 60 / 90+) are right. What I want and don't see: a Texas-specific delinquency playbook. In Texas, foreclosure on a deed of trust is non-judicial, twenty-one-day notice posted at the courthouse, sold first Tuesday of the month at the courthouse steps. AcreOS should know this — the platform should generate a Tex. Prop. Code § 51.002 notice of trustee sale on demand. I didn't see that template either. It's the same gap as §5.069 — knowing about the statute, not generating the document.

**9:30 PM.** Bookkeeping. I export to QuickBooks. Texas has no state income tax, so the categorization at the federal level is what matters, but my CPA splits land carry costs (property tax, mowing, ag-exemption maintenance) by parcel. Does AcreOS export each note's escrow disbursements as separate line items? Don't know yet. Wendell flagged the same concern.

---

## 3. The Texas-compliance test — what passed, what didn't

**Pass:**
- 18% usury cap recognized for TX, with statute cite (`server/services/usury.ts:46`)
- Warranty deed with vendor's lien recognized as the right Texas instrument (`stateDocumentConfig.ts`)
- Deed of trust as the lien instrument (correct — Texas is a deed-of-trust state, not a mortgage state)
- Contract-for-deed CAUTION flag pointing at Prop. Code 5.061-5.086
- 2-year homestead redemption / 6-month non-homestead recognized in tax-sale logic
- Travis County recording fees referenced in tests
- Dodd-Frank checker service exists

**Fail or Missing:**
- **No §5.069 disclosure document generator.** This is the biggest hole. Statute is cited; the form is not produced.
- **No §5.072 14-point bold formatting** on contract-for-deed output (if such output exists).
- **No TREC form library.** Specifically 9-16 (unimproved), 11-7 (farm and ranch), 36-9 (third-party financing), 39-9 (amendment). Land investors use these every week.
- **No homestead-status field on parcels.** This is THE Texas raw-land question and it's not asked at intake.
- **No Texas late-fee ceiling enforcement** under Fin. Code § 302.103.
- **No county-clerk title-chain pull** for Travis / Williamson / Hays — at least not surfaced. Appraisal-district data is not the same as the deed chain. They're different databases with different counties' quirks.
- **No "homestead waiver" language** auto-included in the deed of trust. In Texas a vendor's-lien purchase money note has homestead protection; if you're refinancing or doing a junior lien, the homestead waiver matters.
- **No surface for Texas Property Tax Code § 23.51** ag-exemption / wildlife-exemption tracking. A huge slice of Texas raw-land deals turn on whether the 1-d-1 ag valuation transfers.

Net: AcreOS *knows about* Texas. It does not yet *operate in* Texas the way a Texas operator needs.

---

## 4. Per-surface friction (Texas-specific)

**`/parcels/:id`** — Best surface, like Wendell said. But for Texas I need: homestead status, ag-exemption status with effective date and rollback risk, current CAD account number (Travis CAD vs WCAD vs HaysCAD), and a "is this property in a flood-prone Hill Country drainage easement" field. I work in flash-flood country. Buyers ask.

**`/finance` (note creation)** — Add a TX-specific block: "is this a contract for deed?" If yes, force the §5.069 disclosure generation. If "deed of trust + warranty deed with vendor's lien" (the safer path the config already recommends), nudge me toward it.

**`/documents`** — Need a Texas template pack. I'd pay $20/mo more for a Texas pack alone. Other operators in CA, FL, NC would pay for theirs.

**`/onboarding`** — When I pick "Texas" as my state, the wizard should *immediately* surface "Do you do contracts for deed?" If yes, gate it behind a "you should review §5.061-5.086" modal. That's customer-protection.

**`/inbox`** — Drafts need to know that "Mrs. Henderson" in Texas is not "Mrs. Henderson" in California. Texas is more direct, less floral. The drafted reply tone matters. I'd want a "voice: plainspoken Texas" toggle.

**`/field-scout`** — Wendell loved this; so do I. Hill Country has zero AT&T coverage on half of FM-1626. Offline sync is correct. **Add: a "post photo to county appraisal district complaint form" for when I find evidence of overvaluation.** That's a TX-specific play that would save me $400/year per parcel I dispute.

**`/pricing`** — Honest, but no state-specific add-on tier. I'd happily pay $129/mo for "Texas Pro" with the disclosure pack, TREC forms, county clerk integration, and CAD pulls. Don't bury the Texas value in the generic Pro tier — sell it as the differentiator it could be.

**`/pax`** — Pax is fine but it doesn't speak Texan. When Pax surfaces a stale lead in Lockhart, the suggested follow-up reads like a SoCal AI: "Hi Mrs. Garcia, I hope you're having a wonderful day!" In South Texas that gets ignored. The right opener is shorter, drops the small talk, mentions her property and her likely concern (taxes, an heir who doesn't want it, a fence dispute with the neighbor). A "regional voice" toggle is a 2-week feature that materially raises my reply rate.

**`/deals`** — A Texas closing has a runway: option period (typically 7-10 days), title commitment from the title company, survey if not in the seller's possession, financing approval if applicable, then funding. The deal stages in AcreOS need a Texas-flavored option-period clock with auto-reminders 2 days and 24 hours before expiration. Missing an option-period termination is how operators eat earnest money in this state.

---

## 5. What's missing for Texas — in priority order

1. **§5.069 / §5.072 contract-for-deed disclosure generator.** Generate the seven-item notice in 14-pt bold, signed by purchaser before execution, stored in the deal audit log. This is the highest-leverage compliance feature for the Texas market.
2. **TREC form library.** At minimum 9-16, 11-7, 36-9, 39-9. Variable-data filled from parcel/deal records. PDF output that title companies will accept without modification.
3. **Homestead-status field at parcel intake** with downstream effects on closing checklist, deed of trust language, and 2-year redemption logic at tax sale.
4. **Ag/1-d-1 / wildlife-exemption tracking** with rollback warning. Buyers ask whether their exemption transfers; sellers panic about rollback taxes (5-year retroactive). Bake it into the parcel valuation.
5. **County-clerk title-chain pull** for Travis / Williamson / Hays at minimum, then Bexar / Harris / Dallas. This is the test-bed for whether AcreOS can replace a title company's preliminary report on small deals.
6. **Late-fee compliance enforcement** under Fin. Code § 302.103 in the note builder.
7. **Pebble alternative.** Texas-specific motivated-seller list filters: probate (county probate court records), tax-delinquent (per-county lists), absentee out-of-state, ag-exemption pending rollback, post-foreclosure. If AcreOS can drop mail tomorrow with one of these filters, Pebble's gone for me.
8. **Notice of Trustee Sale generator** under Tex. Prop. Code § 51.002. When a borrower goes 90+ days delinquent, I should be able to generate the 21-day posting notice with one click, with the courthouse address pre-filled by county. Travis posts at the courthouse at 1000 Guadalupe; Williamson posts at the Justice Center in Georgetown; Hays posts at the courthouse in San Marcos. Bake the locations in.
9. **Survey integration.** Half my Hays parcels get a new survey at closing. Pulling a survey PDF into the parcel record and overlaying it on the title commitment is a feature my title company would actually thank you for.
10. **Texas Mineral / Surface estate severance flag.** Most rural raw land in Texas has the minerals severed. Buyers ask, sellers don't always know. A simple "minerals: owned / severed / unknown" field with a note in the title-chain pull would head off three conversations per deal.

---

## 6. Pricing reaction (Texas operator math)

I run ~36 deals/year, ~$2.6M GMV. My current annual stack:
- REI Pro: $97/mo = $1,164
- Pebble: $180/mo postage + $80/mo subscription = $3,120
- DocuSign: $40/mo = $480
- QuickBooks: $90/mo = $1,080
- Title-chain pulls (per-deal): ~$15 × 36 = $540
- Excel: free, but costs me 6 hours/week ≈ $9,000/year of my time at $30/hr blended

Total: ~$15,400/year, of which $9,000 is my time. AcreOS at $79 Scale is $948/year. Even at $129/mo Texas-Pro it's $1,548/year. The math works *if* it actually replaces the stack — meaning:
- 1098-INT batch in January (Wendell's deal-killer, mine too)
- §5.069 disclosure generation
- TREC 9-16 output
- Mail drop end-to-end
- Title-chain pull on at least Travis / Williamson / Hays
- E-sign that grandmothers can sign

Miss two of those six and I'm still paying my current stack. Ship five of six and I switch.

---

## 7. The deal-killer

For Texas specifically: **the §5.069 disclosure.** If I sign a contract for deed in Texas through AcreOS without the seven-item statutory disclosure, and a buyer's plaintiff lawyer figures out AcreOS knew about the statute (the cite is right there in `stateDocumentConfig.ts:landContractNotes`) and didn't generate the form, AcreOS gets named in the suit. That's not a Cesar problem, that's an AcreOS-as-a-business problem. Fix this *before* you onboard your tenth Texas customer.

For me personally: same deal-killer as Wendell — the note ledger has to be right to the penny. Add to it: **the disclosure paper trail has to be airtight.** In Texas the contract-for-deed buyer gets a two-year rescission window if disclosure is defective. AcreOS should be storing every disclosure with a tamper-evident hash, signed by purchaser, timestamped, and recoverable two years later when somebody's lawyer subpoenas it. The HMAC-link signing flow Wendell loved is the right primitive. Wire it to the §5.069 form and you've got the strongest contract-for-deed compliance posture of any platform I've seen — including the title-company software my closer uses.

Until then: I'd run AcreOS in shadow mode against my next three deals. If it produces clean disclosures, clean notes, and clean recordings, I cut my stack the same week.

---

## 8. One last thing — the "Texas operator" market is bigger than you think

There are roughly 15,000 active land investors in Texas at any given time, by my back-of-the-napkin count from the LANDIO meetups, the Texas Land Network groups on Facebook, the people who show up at the first-Tuesday courthouse-step auctions in Austin, San Antonio, Houston, and Dallas. Maybe 4,000 are doing more than ten deals a year. That's the serious slice — and roughly half of them are seller-financing because Texas is *the* seller-finance state for raw land. Hill Country, Trans-Pecos, the Piney Woods, the Rio Grande Valley — every region has its own ecosystem of small operators doing $30K-$200K parcels on owner financing because the banks won't touch them.

If AcreOS becomes the de facto Texas operator's tool — TREC forms, §5.069 disclosures, deed of trust + warranty deed with vendor's lien, county-clerk integration, ag-exemption tracking, courthouse-step trustee-sale notices, Texas-flavored mailer drops — you'd capture maybe a thousand of those four thousand serious operators in the first 18 months. At $129/mo Texas-Pro that's $1.5M ARR from one state. Texas would be your beachhead. From there, replicate the pattern in Florida (different statute pack, same playbook), then Arizona, then North Carolina.

The platform already shows it can think state-specific. The state document config file is a 50-state scaffold. Now go deep on the one state where the seller-finance volume justifies the engineering. Ship the Texas pack. The rest of the country watches Texas — that's just how it is in this business. Get Texas right and the marketing writes itself, because every land-investor podcast in this country has a Texas guest on once a quarter.

— Cesar

— Cesar
