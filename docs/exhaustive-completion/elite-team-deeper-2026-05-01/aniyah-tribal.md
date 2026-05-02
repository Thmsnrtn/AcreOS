# Aniyah Two-Hawks — AcreOS user review (tribal-land specialist)

I'm 38. Albuquerque. Citizen of the Cherokee Nation. I close land transactions that nobody else in this industry will touch — trust land, restricted fee, allotted land with sixty heirs spread across four states, Indian Country Land Consolidation Act buyouts. I run my deals through the Bureau of Indian Affairs Realty Office, the Office of the Special Trustee, the relevant tribal land office, and — when the parcel is on the checkerboard — sometimes a county recorder too. My typical close runs eleven to eighteen months. My typical commission is real, because the next operator who can do this work in northwestern New Mexico is two hours away and overbooked.

So when somebody hands me AcreOS and says "land platform" — I'm not looking for AI. I'm looking for whether the database can hold a parcel that the United States holds in trust on behalf of a tribe or an individual Indian, with thirty-eight undivided fractional interests, requiring BIA approval and a tribal right of first refusal before anything can move. I spent a half-day inside the product. Here is what I found.

---

## 1. Thirty-second verdict

Would I sign up today? **No. Not at any tier. Not even as a county-lookup tool, because the title search will mislead me on Indian Country parcels and that is worse than no tool at all.**

AcreOS is built for fee-simple transactions in state-and-county jurisdictions. That's a reasonable choice — it's most of the market. **What is not reasonable is that the product has no awareness it has made that choice.** There is no warning, no flag, no exclusion when a parcel sits on a reservation, an allotment, or a restricted-fee tract. The system will happily run an AVM, generate a blind offer, build a purchase agreement, and route it through e-signature on a parcel that legally cannot be sold without the Secretary of the Interior's signature. That is not a missing feature. That is a wrongness — the platform produces output that is confidently incorrect on the highest-risk transactions in my book.

I would not trust it to stay out of trouble on its own. Which means I cannot use it for any deal where a parcel might be in Indian Country, which in my service area is roughly half of them.

---

## 2. The seven things I need — and what AcreOS actually has

### **(1) Trust-vs-fee classification on the parcel.**

The single most important question on any land transaction in or near Indian Country is: **what is the legal status of this parcel.** The answers are not binary. They are:

- **Tribal trust** — held by the United States in trust for the tribe. Cannot be alienated. BIA approval required for leases, rights-of-way, mortgages.
- **Individual trust (allotted)** — held by the United States in trust for an individual Indian or their heirs. Subject to BIA Realty approval and the Indian Land Consolidation Act of 1983, as amended by AIPRA 2004.
- **Restricted fee** — held in fee by an individual Indian but with a federal restriction against alienation. Looks like fee in the recorder's office; isn't.
- **Fee land owned by a tribe** — alienable, but tribes rarely sell.
- **Fee land owned by a non-Indian within reservation boundaries** — the checkerboard. Alienable, but jurisdiction questions follow the buyer.
- **Off-reservation trust acquired under 25 CFR 151** — same as tribal trust.

What AcreOS has: a property table with `state`, `county`, `parcelNumber`, an `ownerType` enum of `individual / llc / trust / estate` (where `trust` here means a private revocable trust like a Smith Family Trust, **not** a federal trust patent), and an `owningEntity` text field for "Smith Land LLC, Smith IRA LLC, etc." There is no field for trust-vs-fee status. There is no field for the BIA agency or tribal land office of jurisdiction. The `data-source-broker` enumerates federal-land categories — `public_lands, blm, usfs, nps, federal_lands` — and **Indian Country is conspicuously absent from the list.** That is the omission that tells me nobody on the data team has thought about this.

What I'd build, in priority order:
1. A `landStatus` enum on properties: `fee / tribal_trust / individual_trust / restricted_fee / fee_within_reservation / off_reservation_trust / unknown`. Default `unknown` for parcels whose status hasn't been verified, **not** `fee`. Defaulting to fee is the bug.
2. A reservation-boundary overlay on the map, sourced from the BIA's Land Area Representation (LAR) shapefile — public, free, refreshed annually. When a parcel's centroid falls inside any LAR polygon, raise a "verify land status" flag in the parcel detail view.
3. Block downstream actions on `unknown` or trust-status parcels: no auto-AVM (the comps don't apply), no blind-offer wizard, no auto-generated purchase agreement, no e-signature flow. A red banner that says "this parcel may be in Indian Country — manual review required before any transactional action."
4. Integration with the BIA's Trust Asset Accounting Management System (TAAMS) is out of scope as a v1 — TAAMS is a federal system not designed for third-party API access — but a manual "land status verified by [user] on [date], confirmed [tribal_trust] with [BIA Northern Pueblos Agency]" record on the parcel is a one-day surface and would resolve the audit-trail question.

This is the foundational fix. Without it, items 2 through 7 can't be built, because the system doesn't know which parcels they apply to.

### **(2) BIA approval workflow on transactions.**

A trust-land transaction is not a contract. It's a federal application. The buyer or lessee submits a request to the BIA Realty Office of the agency with jurisdiction. The Realty Officer collects a title status report from the Land Titles and Records Office (LTRO), an environmental review under NEPA, an appraisal that meets Uniform Standards of Professional Appraisal Practice and the additional BIA appraisal handbook standards, consent from the Indian landowner or — on allotted land — consent from the requisite percentage of undivided interests under 25 USC 2218, and tribal council resolution if the tribe holds an interest. The Realty Officer prepares a recommendation. The Superintendent or the Regional Director — depending on dollar value — signs the approval. **Then** the deed or lease can be recorded.

That is fourteen to twenty-six months on the median. There is no shortening it.

What AcreOS has: a `closingChecklistGenerator` service, a `documents` surface, version-tracked documents, a deal pipeline with statuses `new / mailed / responded / negotiating / accepted / closed / dead`. The closing checklist is a fee-simple closing checklist — title commitment, payoff letter, deed prep, settlement statement. **None of the BIA-specific gates exist as templates.** Nothing in the schema can express "Title Status Report requested from LTRO Albuquerque on March 4, expected return 90 days, currently at day 47."

What I need: a parallel `bia_transaction_workflow` template — applicable when `landStatus` is anything but `fee` — with the actual gates (Realty application submitted, Title Status Report requested/received, NEPA categorical exclusion or full review, Phase I environmental, BIA appraisal ordered/received, consent gathered with running percentage tally, tribal resolution if applicable, Realty Officer recommendation drafted, Superintendent signature, recording with the BIA and county if checkerboard). Each gate carrying status, date submitted, expected return, owning agency, document attachments. The same shape Brigid wants for her permit tracker, but for a different workflow with different gates.

The bones for this are present — the document-versioning surface is solid, and the deal-room workflow could be templated. **Nothing has been wired into a BIA workflow because nobody has written the template.** Two weeks for an engineer paired with an Indian-law paralegal who knows the gates.

### **(3) Fractionated heirship — undivided interest tracking.**

This is the one that breaks every CRM I have ever tried. An allotted parcel granted to one head of family in 1898 under the Dawes Act passes by intestate succession through five generations. The 160-acre allotment now has 187 owners holding fractional undivided interests ranging from 1/2 (the one heir who got it cleanly) down to 1/52,488 (the great-great-great-grandchildren). Some heirs are deceased with probates not yet completed. Some are in IIM (Individual Indian Money) accounts. Some are minors with court-appointed guardians. Some live in Anchorage, some live in Tahlequah, some live in cities I have never heard of. **My job is to negotiate a sale or consolidation across as many of those interests as I can reach, file the AIPRA 25 USC 2204 purchase application or the 25 USC 2206 consolidation, and get to the consent threshold the statute requires.**

What AcreOS has: a `leads` table where each row is one seller. A property has one `ownerType`, one `owningEntity`. The schema cannot express thirty-eight fractional interests in a single property. If I tried to use it, I would create thirty-eight separate property records with the same APN — losing the parcel relationship — or thirty-eight leads with no link to the parcel they jointly own. Either workaround discards the data shape that matters: which interests have I contacted, which have responded, which have signed, what percentage of the undivided whole have I aggregated, am I above or below the AIPRA threshold for the action I'm trying to take.

What I need:
1. A `fractional_interests` table — many-to-one with properties — holding `interest_holder_lead_id`, `numerator`, `denominator`, `simplified_fraction`, `decimal_share`, `status` (uncontacted / contacted / negotiating / consented / declined / unreachable / deceased-probate-pending), `iim_account_flag`, `minor_with_guardian_flag`.
2. A rollup on the property: total consents collected as a percentage of undivided whole; threshold-met flags for each AIPRA action (50% for sale to co-owner, varied thresholds for sale to non-owner, 100% for partition).
3. A "missing heirs" view — interests whose holders I have not located. This drives my probate-research workload.
4. Probate linkage — when an interest holder dies, their fraction subdivides among their heirs at the conclusion of a federal probate (handled by the Office of Hearings and Appeals). The system needs to support converting one interest row into many on probate completion.

The data model here is genuinely different from the existing CRM. It is closer to a cap table than a contact list. **A 1/52,488 interest holder is still a legal owner whose consent matters, and treating them as a "lead" with a generic status enum will not survive contact with the work.**

### **(4) Tribal jurisdiction and right of first refusal.**

When trust or restricted-fee land is offered for sale, the tribe with jurisdiction has a right of first refusal under 25 USC 2204(b). The tribe also has zoning and land-use authority over its territory. The tribal land office may impose a transfer fee. Some tribes — Navajo, Cherokee, the Pueblos of New Mexico — have their own internal lease and homesite assignment systems that operate parallel to the BIA system. Others have compacted land management functions out of the BIA under self-governance.

What AcreOS has: the `complianceAI.monitorJurisdiction` service takes `state` and `county` parameters. Two parameters. **Tribal jurisdiction is a third axis that the schema doesn't have a slot for.** The compliance rule library has a `subdivision` ruleType, a `seller_disclosure` ruleType, a Dodd-Frank ruleType. Nothing on tribal codes, nothing on 25 CFR, nothing on the Indian Land Consolidation Act.

What I need: jurisdiction as a polymorphic concept. A parcel can be subject to (state + county) jurisdiction, or (state + county + tribal) jurisdiction, or (federal + tribal) jurisdiction in the case of pure trust land where state and county have no authority. The compliance engine needs to query the right rule set for the right jurisdiction. A right-of-first-refusal gate should appear on the BIA workflow whenever the tribe with jurisdiction has not waived its ROFR for the parcel's land class.

This is not exotic. The same architecture would let the system handle parcels in U.S. territories, on military reservations, or under federal mineral splits — all of which are out of scope today and all of which sit in the same blind spot.

### **(5) Title — and why the existing title search will hurt me.**

AcreOS has a `routes-title-search.ts` and a title-company integration path. For fee-simple parcels in state-and-county recording systems, that is fine and useful. **For trust land, it is dangerous.** Trust-land title is not held at the county recorder. It is held by the BIA's Land Titles and Records Office in one of seven regional offices. A title search at the county will return either nothing (the federal patent never went to county) or out-of-date records (from before the parcel was taken into trust). A buyer who reads "clear title" from a county search on a trust parcel and proceeds is buying a lawsuit.

The existing title-search surface has no concept of "this parcel's title is not held at the county; route to LTRO." It will return whatever the county returns and call it a day. **That is a confidently-wrong output, which is worse than no output.**

What I need: when `landStatus` is `tribal_trust / individual_trust / restricted_fee / off_reservation_trust`, the title search must (a) refuse to run a county search alone and present a result, (b) display a banner explaining that title for this parcel is held at LTRO, (c) provide the contact information for the relevant LTRO regional office, (d) accept a manual upload of the Title Status Report when it arrives back, with versioning, and (e) flag any conflict between LTRO records and county records (because checkerboard parcels and former-trust parcels do appear in both, and the discrepancies matter).

The honest version of this: until the system can route to LTRO, the title-search surface should be locked off entirely for any parcel with non-fee status. Hiding the button is better than wrong answers.

### **(6) Cultural and contextual sensitivity in the surfaces.**

This one I will say carefully because it matters to my customers and it gets dismissed by people who don't have to live with the consequences.

The language across AcreOS is wholesaler-flipper-friendly: "stale leads," "hot prospects," "blind offer," "Pulse score," "send aggressive follow-up." That register is a mismatch for tribal-land work, which moves on relationship time, not pipeline time. An elder I am working with on a consolidation buyout is not a "stale lead" who needs an "aggressive follow-up sequence" because they didn't return my call in fourteen days. They are deciding whether to sign over an interest in land that has been in their family for 127 years. **The system actively pushing me to harass them is worse than passive — it actively damages the trust I have spent years building.**

What I need: a mode toggle — call it whatever you want, "high-relationship mode," "trust-land mode," "long-cycle mode" — that mutes the urgency UI, lengthens the cadence defaults from days to weeks or months, removes the leaderboard-style metrics, and reframes the workflow around milestones rather than velocity. This is partly UX, partly defaults configuration. It is not large in code. It is large in whether the platform is usable for relationship-based land work, which includes most tribal work but also (Brigid would tell you) most subdivision work and most agricultural work.

A specific request: when `landStatus` is set to anything but `fee`, default the lead-cadence sequences to "off." Do not auto-generate follow-ups. Do not auto-suggest "this lead has gone cold." If the founder team wants Pax (the assistant) to remain on, scope it to administrative drafting tasks — never to outreach decisions on trust-land parties.

A second specific request: do not generate AI summaries of communications with tribal-land sellers. Some communications cover sacred sites, burial grounds, ceremonial use of the land. Those are not for an LLM to summarize, store, and resurface as "key insights." The simple fix is to mark properties with non-fee land status as `ai_processing_disabled = true` by default and let the user opt in per parcel after explicit consent from the seller.

This is not a checkbox feature. This is a default. The default is what protects the user when they forget the checkbox.

### **(7) The forms that don't exist in your library.**

A handful of documents drive trust-land transactions and none of them are in AcreOS:
- BIA Form 5-5515 (Application for Land Sale or Exchange) — the canonical AIPRA sale application
- BIA Realty business lease application
- Right-of-way application packet (varies by region)
- Tribal council resolution template (consent or non-objection to transaction)
- Notice of Right of First Refusal
- Consent to Sale form (per 25 CFR 152)
- AIPRA Section 207 partition request
- Agricultural lease (Indian Land Working Group templates)

What AcreOS has: a documents library with templates for purchase agreements, deeds, seller-finance notes, options, assignments. All fee-simple.

What I need: a tribal-land template library, seeded by an Indian-law attorney, with merge fields for tribal name, BIA agency, allotment number, fractional interest table. **Same engine you already have. Different content.** Two-week build for the engine integration, plus eighty hours of legal time for the templates. Less than the cost of one bad transaction.

Same warning Brigid gave on her CC&Rs: no AI drafting on these. They get filed with a federal agency. They need to be exactly correct. A template engine with merge fields, full stop.

---

## 3. The data-model gap, in plain words

The fee-simple model AcreOS has built assumes: one parcel, one owner (or one owning entity), one transaction, one recording office, one jurisdiction. Every persona AcreOS supports today fits that shape with the existing schema, more or less. **Trust-land transactions break four of those five assumptions.** Many owners (fractional interests). Many transactions running in parallel (consents, applications, NEPA review, appraisal). Two recording offices (LTRO + county on checkerboard). Two-to-three jurisdictions (federal + tribal + sometimes state). Adding tribal-land support is not a feature shelf bolted to the side. It's a second schema that runs parallel to the first.

That is a real lift. Probably twelve tables, six to eight weeks for one engineer with an Indian-law consultant on retainer for advisory hours, followed by careful pilot testing with one or two practitioners. Not three weeks. **Don't underprice this.**

The reasonable alternative — and I will say this honestly — is to **explicitly scope tribal land out of the product, surface that scope decision to users, and refuse to operate on parcels that fall inside reservation boundaries.** That is a respectable choice. It is a much cheaper choice than building real support. What is not a respectable choice is the current state, where the product silently handles trust parcels as if they were fee, and the user finds out at recording.

---

## 4. The day-in-the-life test — where AcreOS would slot in

Let me walk through one consolidation buyout the way I actually run it.

**Month 0 — referral.** A woman from the Jicarilla Apache Nation calls me. Her grandfather's allotment near Dulce has 41 owners now. Her mother — one of the larger interest holders at 1/16 — wants to consolidate. She wants to know if I can help.

**Where AcreOS helps today:** nothing. I take notes in a Word doc.

**Where AcreOS could help if built:** a new workflow type — "AIPRA consolidation buyout" — with a parcel record carrying `landStatus: individual_trust`, BIA agency = Jicarilla Agency, allotment number, and an empty fractional-interests table to populate.

**Months 1-3 — title status and heir research.** I request a Title Status Report from LTRO Albuquerque. It comes back ninety-three days later with 41 named interest holders and three open probates. I cross-reference with the tribal enrollment office (with permission) and start locating heirs.

**Where AcreOS helps today:** document version-tracking would hold the TSR. That's it.

**Where AcreOS could help:** if I could ingest the TSR into the fractional-interests table — even by manual entry — I would have a working contact list with running consent percentages from day one.

**Months 4-12 — outreach.** I write letters. I make calls. I drive to Farmington, Cortez, Page, Phoenix, Tahlequah. Some heirs sign quickly. Some take six months to decide. Two refuse. One can't be located. One dies during the process and the interest fragments further.

**Where AcreOS helps today:** if I turned on the standard CRM cadence, it would email harassment messages on behalf of my clients to ninety-year-olds in tribal communities. **I would lose every relationship I have.** The product is, on default settings, a liability here.

**Where AcreOS could help:** the long-cycle mode I described above, with consent percentage tracking and gentle milestone reminders rather than leaderboard urgency. A view of "interests still uncontacted" so I know where my next phone call should go.

**Months 13-15 — application and approval.** I file the AIPRA Section 207 application with the BIA. They route it through Realty Officer review, NEPA categorical exclusion, appraisal, Superintendent approval. The mother pays the consolidation price into IIM accounts for each consenting interest.

**Where AcreOS helps today:** the documents surface holds the filed application and the supporting exhibits. Useful.

**Where AcreOS could help:** the BIA workflow gates I described in section 2 — submitted, under review, recommended, approved, recorded. Today nothing tracks the gates.

**Month 16 — recording.** BIA records the deed at LTRO. The parcel moves from 41 fractional interests to 1. The mother's interest is now whole. We are done. Eighteen months in.

**Where AcreOS helps today:** the closing-cost surface, if I bend it into a different shape than it was designed for.

**Where AcreOS doesn't help:** the rollup. I want a project record showing 41 → 1, total dollars disbursed across IIM accounts, time elapsed, gates closed, documents filed. That is the case study I show the next family. Today there's no place for it.

---

## 5. Per-surface friction (for the surfaces a tribal-land specialist would touch)

**`/maps`** — Mapbox with FEMA, USGS, USDA layers. **No reservation-boundary overlay.** No LAR shapefile. No "this parcel may be in Indian Country" indicator. The single most useful overlay for my work is missing. Public, free, BIA-published shapefile. One day of integration work.

**`/parcels/:id`** — Fee-simple parcel detail. No `landStatus` field. No BIA agency. No allotment number. No fractional-interests tab. For my workflow this surface is empty calories.

**`/title-search`** — As built, will return county data on trust parcels and present it as authoritative. **Highest-risk surface in the product for an Indian Country deal.** Either route to LTRO, refuse to run, or surface a clear warning. Currently does none of the three.

**`/blind-offer-wizard`, `/avm`, `/price-optimizer`** — All assume a market for the parcel. There is no market for trust land. AVMs do not apply; comps do not apply; blind offers cannot be made. These surfaces should be disabled when `landStatus` is non-fee, or they will produce numbers that mislead users who don't know better.

**`/compliance` / `/regulatory-intel` / `/regulatory-intelligence` / `/state-documents`** — Four surfaces (I see Brigid noticed too) covering state-and-county compliance. None covers 25 CFR, AIPRA, or tribal codes. The `complianceAI.monitorJurisdiction` API takes `state` and `county` as parameters with no slot for tribal jurisdiction. The framework needs a third dimension before any tribal compliance content can land.

**`/documents` / `/document-versions`** — The one place I'd be glad to use today, with no tribal-specific work needed. Drop a Title Status Report, drop a BIA application, drop a tribal council resolution, version it. The versioning surface is solid.

**`/tasks`** — Generic. Could carry a BIA workflow checklist if templated. Out of the box, no.

**`/leads`** — Single seller per row. Cannot represent fractional interests. Workaround attempts will deform the data.

**`/today` / `/pax`** — The default urgency UI is actively harmful for relationship-based work, as described in section 2.6. Pax doing AI summaries on tribal-land communications is a data-handling hazard I do not consent to on behalf of my clients.

**`/onboarding-v2`** — `businessType` enum: `land_flipper, residential_wholesaler, note_investor, fix_and_flip, buy_and_hold, commercial, short_term_rental, creative_finance, developer, tax_lien_deed, multifamily, mobile_home, agent_investor`. **Indian Country specialist is not present.** Neither is "agricultural broker" or "conservation easement specialist." The persona registry has scope decisions baked into it that the rest of the company may not have made consciously.

---

## 6. Three things AcreOS has built that I'd actually use, if the foundation were fixed

1. **Document versioning.** Title Status Reports come back with corrections. BIA applications cycle through Realty review with comments. Tribal council resolutions sometimes get amended. The existing version-tracking handles this correctly. No tribal-specific work needed — it's already shape-correct.
2. **Map-layer infrastructure.** Once the BIA LAR overlay is added, the existing layer toggling and `useDynamicMapLayers` hook handle the rest. The plumbing is sound; the data is missing.
3. **HMAC-signed link signer for documents.** Useful for fee-side closings on checkerboard parcels and for tribal-business-entity contracts that don't go through BIA. The audit-row + signer-order + expiry surface is genuinely good for low-stakes signing. (It is not appropriate for BIA-filed documents, which need wet signatures and federal recording.)

---

## 7. The deal-killer

**The product does not know that Indian Country exists, and it produces confidently wrong outputs on parcels inside it.**

Until that changes, I cannot use AcreOS for the half of my pipeline that runs through trust or restricted land. And — this matters — **I cannot recommend it to other tribal-land practitioners**, because the fee-simple-default behavior is a liability for any of us. We are a small community. We talk. The reputational cost of one platform-driven error on a trust parcel propagates through every Realty office in the country and every tribal land office that hears about it.

The minimum viable version of "AcreOS supports tribal-land practitioners" is:

1. A `landStatus` enum on parcels, defaulting to `unknown` for any parcel inside an LAR polygon.
2. The BIA LAR shapefile as a map overlay.
3. A hard block on AVM, blind-offer, title-search, and e-signature actions when `landStatus` is anything but `fee`.
4. A clear banner on those parcels explaining the status and routing the user to manual review.
5. Long-cycle defaults — no automated outreach cadences, no AI summaries — on non-fee parcels.

That alone — five items, maybe two engineering weeks — would move the product from "wrong by default" to "honest about its scope." It would not let me run my full workflow inside AcreOS. It would let me use AcreOS for the rest of my work without it tripping into Indian Country and embarrassing me.

The full version — fractional-interests table, BIA workflow templates, LTRO-aware title search, tribal-council document templates, jurisdiction-polymorphic compliance — is six to eight weeks for an engineer paired with an Indian-law consultant. That's the real version. Whoever ships it first owns a niche the larger CRMs will never touch, because the diligence cost is too high relative to the addressable market for them. **For us, the addressable market is the work, and there is nobody serving it.**

One last thing. If you build this, do not call it an "AI-powered tribal land platform." Do not market it with stock photography of feathers, drums, or sunsets. Do not use the word "tribe" in branding. Build the schema, build the workflow, ship the LAR overlay, write the templates with an Indian-law attorney, and let practitioners find it through the federal-bar channels we actually read. Quiet, accurate, and respectful is the brand. The features will sell themselves to the people who need them, and you will not embarrass yourself with the people who will hold you to a standard.

— Aniyah Two-Hawks
   Tribal-land transactions, Albuquerque NM
   Citizen, Cherokee Nation
