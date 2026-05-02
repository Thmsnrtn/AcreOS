# North Carolina — Two-Market Audit

**Author:** June Whitfield, 52 — NC Land Investor (Asheville HQ; coastal OBX-adjacent + WNC mountain). Stack: NC Mountain Properties MLS + REI Pro + DocuSign. Wave 3 of the deeper persona audit.
**Date:** 2026-05-01
**Lens:** "North Carolina is two states pretending to be one. The buyer who calls about a 4-acre tract in Currituck and the buyer who calls about a 4-acre tract in Madison are different humans with different fears, different financing, different counsel, and different statutes wrapped around the dirt. AcreOS today sees one NC. That's the problem."
**Read in full:** `server/services/stateDocumentConfig.ts:300-319`, `server/services/regulatoryIntelligence.ts:131-158, 486-525`, `server/routes-platform-features.ts:1101-1104`, `server/routes-regulatory.ts:42-53`, `server/services/eSigningService.ts`, `shared/schema.ts:7944-8005` (buyer profiles), plus Marguerite §3.6 (witness gap) and Hessam §2.4 (e-sign webhooks).

---

## 1. One-line verdict

**AcreOS treats NC as a single jurisdiction with one disclosure form, one buyer mold, and one MLS feed. The reality is two markets — coastal CAMA-regulated parcels and mountain Ridge-Act-regulated parcels — that share neither buyer behavior, nor permit posture, nor closing rhythm.** The state-config file knows the right witness count (2) and the right primary deed type (general warranty), and that's roughly where the NC-specific intelligence ends. The CAMA flag in `assessDealRisk` only fires for Florida. The Ridge Protection Act is invisible. Wholesalers using AcreOS in NC are one Real Estate Commission complaint away from a cease-and-desist that the product gave them no warning about. The 2-witness requirement Marguerite already flagged remains uncovered. **Two weeks moves AcreOS from "Mountain MLS exporter pretending to be a CRM" to "credibly NC-aware on both halves of the state."**

---

## 2. The Coastal Area Management Act (CAMA) gap — `regulatoryIntelligence.ts:513`

CAMA (NCGS Ch. 113A Art. 7) regulates the 20 NC coastal counties — Currituck, Dare, Hyde, Tyrrell, Washington, Beaufort, Pamlico, Carteret, Onslow, New Hanover, Brunswick, plus the eight others. Any "development" within an Area of Environmental Concern (AEC) — which includes ocean erodible areas, estuarine waters, public trust shorelines, and inlet hazard areas — requires a CAMA permit (Major or Minor) before transfer of any structure, dock, septic, or grading. **For raw land sales, CAMA matters at four points:**

1. **Vacant-lot CAMA disclosure** — NCGS §113A-115.1 requires sellers of unimproved property in a CAMA county to disclose the AEC status to the buyer in writing before contract signing. This is a *separate* statutory disclosure from the standard residential property disclosure, and the form is prescribed by the Coastal Resources Commission.
2. **Setback recalculation** — The 2025 storm-assessment update (`regulatoryIntelligence.ts:351`) extended setbacks by 25 feet in Brunswick + New Hanover. AcreOS *knows* this — there's literal text describing it — but nothing in the dispatch flow blocks listing or sale of a parcel whose buildable area shrinks under the new setbacks.
3. **CAMA permit transferability** — Existing CAMA permits do not automatically transfer to a new owner. A buyer relying on the seller's permit needs to apply for transfer with the Division of Coastal Management within 60 days. AcreOS contracts say nothing about this.
4. **Inlet Hazard Area redesignation** — IHAs are redrawn periodically; a parcel that was outside an IHA at purchase can become inside one, which changes development rights overnight. Disclosure that the parcel *might* be redesignated is best practice but not surfaced.

**Concrete code finding:** `assessDealRisk(stateCode, {coastal})` at `regulatoryIntelligence.ts:486-525`. Line 513 reads:

```ts
if (opts.coastal && profile.code === "FL") {
  flags.push("Florida coastal land: CAMA setbacks and DEP permits likely required");
}
```

This is wrong on its face. **CAMA is North Carolina's statute, not Florida's.** Florida's analog is the Coastal Construction Control Line (CCCL) under Ch. 161 F.S. The label "CAMA" is being applied to the wrong state, and NC — the actual CAMA state — never gets the flag. A coastal NC parcel passed through this risk-assessment endpoint today emits zero coastal-specific warnings. The fix is two lines but the bug is a tell: nobody with NC coastal context has touched this file.

**Action:**

1. Rename FL flag to "Florida CCCL setbacks and DEP permits likely required."
2. Add NC branch: `if (opts.coastal && profile.code === "NC") { flags.push("NC CAMA permit + AEC disclosure required for coastal transfer"); recommendations.push("Verify county is on CAMA-20 list; order CAMA-AEC determination from local LPO before listing"); }`.
3. Extend the assessment input to accept `county`, then derive `coastal` automatically from a CAMA-20 county set rather than relying on the operator to remember to tick the checkbox in `regulatory-intel.tsx:686`.
4. Add a `requiresCAMADisclosure` flag to `STATE_DOCUMENT_CONFIGS["NC"]` (currently absent) and inject the CRC-form disclosure block into the doc-generator when `state==='NC'` and `county ∈ CAMA_COUNTIES`.

---

## 3. The Mountain Ridge Protection Act gap

The NC Ridge Law (NCGS §113A-205 et seq., enacted 1983 after the Sugar Top condo on Sugar Mountain became the public symbol of unregulated ridgeline development) prohibits structures over 40 feet tall on protected mountain ridges. Twenty-three of the WNC counties have enacted local ordinances under the Act; six have opted out. **For a Land Investor selling raw mountain tracts, the Ridge Law matters in three ways most CRMs miss:**

1. **Buildability disclosure** — A 5-acre tract on a protected ridge above 3,000 ft elevation in an Act-county may be *unbuildable for a typical mountain home* if the home would protrude above the ridgeline. Buyers don't learn this until their architect checks; sellers with no Ridge Law awareness routinely over-promise.
2. **Steep-slope ordinances** — Layered on top of the state Act, individual counties (Watauga, Avery, Buncombe, Macon, Jackson) have steep-slope ordinances that compound. AcreOS's `subdivisionRegulations: "moderate"` rating for NC at `regulatoryIntelligence.ts:153` is *true on average* and *false in WNC* where local rules can be the strictest in the state.
3. **Viewshed protection / scenic byway adjacency** — The Blue Ridge Parkway corridor and certain Cherokee National Forest adjacencies trigger NPS coordination on subdivision plats. This is a frequent surprise to investors who bought in Tennessee mountain markets and assume NC is similar.

The codebase has `practitionerNotes: "...Mountain land has strict subdivision rules. The Highlands/Cashiers area commands premium prices..."` — useful prose, zero programmatic effect. The Ridge Act is unmentioned anywhere. There is no county-level overlay layer feeding into parcel intelligence. The single `subdivisionRegulations` enum cannot represent "permissive in coastal NC, strict in mountain NC" simultaneously, which is the actual ground truth.

**Action:** Add a per-county overlay model — `state_county_overlays` table keyed `(state, county) → { ridgeProtectionEnacted, steepSlopeOrdinance, camaCounty, scenicCorridor }`. Surface in the parcel detail page as a "regulatory environment" panel. WNC investors are 35-50% of NC investor activity by parcel count; this is not a long-tail concern.

---

## 4. NC Residential Property Disclosure — the form is wrong-shaped for raw land

`routes-platform-features.ts:1101-1104` lists for NC:

> `{ name: "Residential Property Disclosure", required: true, description: "NC requires disclosure of known conditions affecting property value." }`

Two problems:

**4.1 Vacant land uses a different form.** The NC Real Estate Commission distinguishes the *Residential Property and Owners' Association Disclosure Statement* (form RPOADS) from the *Mineral and Oil and Gas Rights Mandatory Disclosure Statement* (form MOG). For unimproved land, the RPOADS is generally not required — but the MOG *is* (NCGS §47E-4.1) for any residential lot conveyance. AcreOS marks "Mineral Rights Disclosure" as `required: false` (line 1103). This is incorrect for residential-zoned vacant lots; the MOG is mandatory and the seller's failure to deliver it gives the buyer a 3-day right of rescission after delivery. **For a raw-land CRM in NC, the MOG is the disclosure that matters most often, and it's marked optional.**

**4.2 The disclosure-delivery clock is invisible.** NCGS §47E-5 gives the buyer the right to terminate within 3 calendar days of receiving the disclosure (or 5 if mailed). AcreOS has no field on `generated_documents` or `signatures` to track *delivery date* of the disclosure as distinct from contract execution. If a buyer contests delivery timing, AcreOS has no record. This is the same evidentiary gap Marguerite flagged for signing — the moment of *delivery* is the legally operative event, and the database doesn't capture it.

**Action:**

1. Flip MOG to `required: true` for NC residential parcels; add a `requiredFor: "residential" | "all"` discriminator to the disclosure schema.
2. Add `disclosureDeliveredAt` + `disclosureDeliveryMethod` to the contract/document workflow; surface a "3-day rescission window" countdown on the deal pipeline card.
3. The form text itself — both RPOADS and MOG are statutorily prescribed; AcreOS should generate them from a stored template rather than free-text. Currently neither template exists in `documentTemplates`.

---

## 5. The 2-witness requirement is still uncovered (regression check on Marguerite §3.6)

`stateDocumentConfig.ts:308` correctly states `witnessCount: 2` for NC. NCGS §47-38 makes a deed acknowledged before a notary self-proving without witnesses for *recording* purposes — but **two witnesses are required when the conveyance is not acknowledged**, and several mountain counties' Registers of Deeds (notably Avery and Watauga) historically prefer the witnessed form for grantor signatures by mark. More practically: NC seller-financed installment land contracts (NCGS §47G-2) require *acknowledgment* by both buyer and seller and recording within 5 business days; the witness-count discussion overlaps with notarization in a way the current `witnessCount: number` field cannot represent.

The native e-sign flow has no witness signer role despite `signatures.signerRole` accepting the value (Marguerite's §4.5). Same finding, two months later, still open. **Concretely:** `eSigningService.ts:dispatchDocument` — verify it reads `STATE_DOCUMENT_CONFIGS[state].witnessCount` and refuses to dispatch with fewer than the required additional witness signers. Today it does not.

For NC specifically: an installment land contract dispatched without witness/notary acknowledgment isn't void, but it cannot be recorded within the §47G-2 window, which exposes the seller to forfeiture-of-equity claims by the buyer down the line. The product silently produces unrecordable instruments.

---

## 6. NC riparian rights — different from CO/AZ, and AcreOS knows it but doesn't act on it

`regulatoryIntelligence.ts:146` has `waterRightsSystem: "riparian"` for NC. Correct. But the `assessDealRisk` function only fires water-rights warnings for `prior_appropriation` states (line 508-511). **Riparian rights have their own gotchas in NC that AcreOS misses:**

1. **Reasonable-use doctrine** — NC follows the modified reasonable-use rule. A buyer of a stream-frontage parcel inherits a use right but not a quantified allocation; if upstream use changes, downstream quantity can change. This matters most for cattle/agricultural buyers in WNC and for shoreline buyers along the Albemarle and Pamlico Sounds.
2. **Capacity Use Areas** — NCGS §143-215.13 designates CUAs (Central Coastal Plain CUA covers 15 counties); within a CUA, withdrawals over 100,000 gpd require a permit. A 50-acre tract in Beaufort or Craven County may be marketed as agricultural without surfacing this.
3. **Riparian buffer rules (Neuse, Tar-Pamlico, Catawba, Jordan watersheds)** — 50-foot minimum forested buffers along perennial streams. Affects buildable area on stream-frontage parcels.

**Action:** When `state==='NC' && nearWater===true`, emit flags for the watershed-specific buffer rule and the CUA designation if the county is in one. Today the function is silent unless the state is prior-appropriation.

---

## 7. NC Real Estate Commission rules for wholesalers — the regulatory tripwire

This is the one that ends careers, and AcreOS has zero coverage of it.

NC REC took the position in 2018 (Question 36 of the 2018 REC Q&A, reaffirmed multiple times) that **assigning a contract to purchase real property to a third party for compensation, when done routinely, constitutes brokerage activity requiring a license.** This is stricter than TX, AR, or TN. The "equitable interest" defense that works in other states is narrower in NC:

- A wholesaler may sell their *own equitable interest* in a contract once or twice a year without licensing — but must disclose to both parties that the wholesaler is selling *only the contract*, not the property.
- Repeat assignments (≥3 in a year per most REC interpretations) are unlicensed brokerage. Penalty: cease-and-desist, civil penalties up to $1,000 per transaction, plus referral to DA for unauthorized practice.
- The fix in NC is the "double close" structure — wholesaler funds the A→B closing, then immediately B→C — which is licensable activity in some other states but legal here if structured properly.

**Where AcreOS fails the NC wholesaler:**

- The org-onboarding flow accepts `"wholesaler"` as a strategy (`routes-persona.ts:31`, `contextProfile.ts:51`) without surfacing the NC licensure question.
- No field captures "transactions assigned this calendar year" — which is the metric that determines whether the next assignment is over the unlicensed-brokerage line.
- No template warns "in NC, your third assignment this year is a regulatory action waiting to happen."
- The contract-generation flow produces standard purchase agreements with assignment language; it doesn't produce double-close-friendly variants for NC.

**Action:**

1. On organization profile, add `nc_wholesale_license_status: "licensed" | "unlicensed" | "n/a"`. If unlicensed and operating in NC, cap assignment-strategy contracts at 2/year and surface a hard warning at the third.
2. Add a "double-close" doc template variant for NC (and similar-rule states: PA, IL after 2019).
3. Add the same gating for wholesaler-flagged orgs in OK, IL, PA which have similar frameworks. (June's lane is NC, but the same code change covers ~5 states for free.)

---

## 8. The two-market reality — buyer profile schema is too thin

`shared/schema.ts:7944-8005` defines `buyerProfiles` with `preferences.terrainTypes?: string[]`, `preferences.waterFeatures?: boolean`, `preferences.useTypes?: string[]`. This is a generic North-American schema. For NC, **the coastal buyer and the mountain buyer have non-overlapping mental models that the schema cannot represent:**

| Dimension | NC coastal buyer | NC mountain buyer |
|---|---|---|
| Origin | Northern Virginia, DC, NJ retiree | Florida retiree, Charlotte/Raleigh weekender, Atlanta professional |
| Primary fear | Erosion, hurricanes, flood insurance cost | Septic perc, road maintenance, well water |
| Financing | Cash for second-home; FHA/VA second home rare | Owner-finance for land bank; conventional for home build |
| Decision rhythm | Slow — visit windows tied to weather | Fast — drive up Saturday, decide Sunday |
| Counsel | Local NC attorney (mandatory at closing) | Same — but expects survey + perc test in advance |
| Listing channel | Local coastal-specific brokers, MLS | NC Mountain Properties MLS + Lands of America + LandWatch |
| What kills the deal | Wind/flood insurance quote arriving | Failed perc test; Ridge Act elevation issue |

The `buyerProfiles.preferences` JSON is too thin to capture the difference, and `buyer-property-match` scoring (`shared/schema.ts:8012-8048`) treats a coastal buyer and a mountain seller as compatible if `state==='NC'` and acreage matches. That's a wasted lead at best and an embarrassing email blast at worst.

**Action:**

1. Add a `regionTags: string[]` field to `buyerProfiles.preferences` with NC-specific values: `"nc-coastal"`, `"nc-piedmont"`, `"nc-wnc-mountain"`, `"nc-foothills"`.
2. Same on listings — derive automatically from county.
3. Buyer-match scoring: if buyer has `regionTags` and listing's region is not in the set, hard-reject (not score-penalty).
4. Marketing campaigns: surface "coastal vs mountain" as a first-class segmentation dimension, not a free-text filter.

---

## 9. NC attorney-state closing — workflow timing missing

`stateDocumentConfig.ts:313` correctly sets `attorneyStateForClosing: true` for NC. NC is one of ~22 attorney-required states (NCGS §84-2.1, *Carolina Beach v. Mahon*, 2003 NCBA opinion). This means:

- Title search, deed prep, and closing must be conducted by or under supervision of a NC-licensed attorney.
- An out-of-state investor cannot self-close.
- Title insurance commitments must come through an attorney's title-insurance program (Lawyers Mutual or similar).

**The product gap:** AcreOS's contract-to-close workflow doesn't model "attorney handoff" as a discrete pipeline stage. There's no field for `closingAttorney` on a deal; no template for the engagement letter; no warning that the operator can't legally do the closing themselves in NC. An out-of-state investor onboarding to AcreOS and selling NC parcels will run their first closing into a wall.

**Action:** Add a `closingAttorney` (name, bar number, firm, phone) optional field to deals; require it for state-attorney-state deals; surface a state-aware checklist in the deal sidebar that includes "attorney engaged" as a checkbox prior to "closing scheduled."

---

## 10. The 1-2 week NC-specific hardening sprint

Eight items. Each shippable independently. Cumulative effect: the NC investor experience stops being generic and starts being credibly two-market-aware.

**Day 1 — fix the CAMA mislabeling.** `regulatoryIntelligence.ts:513`: rename the FL branch to CCCL; add a parallel NC branch keyed on coastal counties. Add `CAMA_COUNTIES` constant (the 20-county list). 0.5 day.

**Day 2 — county-overlay model.** New `state_county_overlays` table; seed for NC: 20 CAMA counties + 23 Ridge-Act counties + 5 steep-slope counties. Plumb into parcel intelligence panel. 1 day.

**Day 3 — MOG mandatory + RPOADS template.** Flip `routes-platform-features.ts:1103` to `required: true`. Generate templates from REC's prescribed forms. Add `disclosureDeliveredAt` + 3-day clock. 1 day.

**Day 4 — Wholesale-license gating.** `nc_wholesale_license_status` on org; assignment counter; hard warning at 3rd assignment in calendar year for unlicensed NC orgs. 0.5 day.

**Day 5 — Double-close template variant.** New `nc_double_close` doc template. 0.5 day.

**Day 6 — Buyer-profile region tags.** Add `regionTags`; backfill from `buyerProfiles.preferences.counties` via a NC-counties→region mapping. Update match scoring to hard-reject region mismatch within state. 0.5 day.

**Day 7 — Witness signer flow (closes Marguerite §3.6 for NC + FL + AL + GA).** Implement multi-signer-role dispatch in `eSigningService.ts`; UI for adding witness signers; refuse dispatch when `STATE_DOCUMENT_CONFIGS[state].witnessCount > principalSigners + witnessSigners`. 1.5 days.

**Day 8 — Closing-attorney first-class field + checklist.** `closingAttorney` on deals; attorney-state checklist injection; engagement-letter template. 1 day.

**Day 9 — NC-specific deal-risk flags.** Capacity Use Areas (15 coastal-plain counties), riparian buffer rules (Neuse/Tar-Pamlico/Catawba/Jordan watersheds), Ridge Act enactment status. All driven from the new county-overlay model. 0.5 day.

**Total: ~7 engineer-days.** The work splits cleanly: one engineer on disclosure + doc-template work (days 3, 5, 8); one on data-model + risk-flag work (days 1, 2, 9); one on signing + buyer-match work (days 4, 6, 7). Reviewer is whoever owns the state-config file plus a NC attorney for the disclosure templates (NCREC publishes the forms; layout fidelity matters).

---

## Closing Note

The codebase already has a real-estate brain. `regulatoryIntelligence.ts` is a thoughtful file. `stateDocumentConfig.ts` knows witness counts. The disclosures registry exists. The CAMA storm-extension prose is in there as a regulatory update. **What's missing is that nobody has walked through the system as a NC operator and asked: "what would the product tell me right now?"** The answer is — generic stuff. CAMA bug fires for the wrong state. Ridge Act unmentioned. MOG marked optional. Wholesaler gets no licensure warning. Coastal buyer matched to mountain listing.

NC is 4-7% of US Land Investor activity by transaction count and disproportionately retiree-money — exactly the buyer who lawyers up first. The product is one bad closing away from a state-bar referral that AcreOS can prevent for under two engineer-weeks of focused work. The rest is post-launch. But this sprint is the difference between "we sell software in NC" and "we serve NC investors competently." That's the bar I'd hold the team to.

— June Whitfield
