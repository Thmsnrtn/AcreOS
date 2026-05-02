# Marisol Tan — AcreOS user review (California)

I run a small CA Land Investor shop out of Bakersfield. Eleven years buying desert and Central Valley parcels in Kern, Tulare, and Kings — five-figure dirt mostly, a few six-figure ag flips when an almond farmer wants out. My stack right now is Realeflow + LandGlide + a CA-licensed RE attorney on retainer + QuickBooks. Most operators won't touch California — too many disclosures, too many ways to get sued, Prop 13 quirks that make every transfer a trap door. That's exactly why my margins are what they are.

So when the team handed me AcreOS to look at, I didn't open `/today`. I opened the disclosure tables, the usury checker, and the assignment-contract template. If a platform doesn't know California, I find out in twenty minutes.

Here's what I found in a half day.

---

## 1. Thirty-second verdict

Would I sign up today? **Maybe — on the $20 Starter, on a 14-day trial, with the explicit understanding that I keep my attorney in the loop on every assignment.** I won't move my live deals over until I see CA-specific guardrails actually fire on a CA-specific situation, not a generic 50-state lookup that happens to include "CA."

At **$49/mo Pro** I'd switch *if* the platform can handle: (a) a Mello-Roos warning the moment I tag a parcel inside a CFD, (b) a Prop 13 reassessment estimator on transfer, (c) a wholesaler-licensing gate before it lets me assign a CA contract, and (d) a CEQA flag the moment I check "subdivide" on a parcel. None of those are visible to me yet at the surface I touched.

At **$79/mo Scale** — not for me. CA inventory is thinner than TX or FL; I do 30–50 deals/year, not 200.

What stops me from going all-in: the platform treats California like a row in a state table. It is not a row. CA is the regulatory equivalent of a separate country embedded inside the United States, and the only way to ship a product CA Land Investors trust is to model that explicitly.

---

## 2. Daily-use walkthrough — what a CA operator actually hits

**8:10 AM.** I land on `/today`. Same firehose Wendell hit. Fine for a Texas guy. For me the missing tile is **"CA Regulatory Watch"** — Mello-Roos updates, CEQA bulletin changes, DRE advisories, the next AB-2424 deadline. CA changes the rules every legislative session. If AcreOS isn't tracking that for me, I'm still paying my attorney $400/hr to track it.

**8:30 AM.** I import a CSV of 180 Kern County tax-default parcels from LandGlide. The import goes through. **Nothing flags that 22 of these are inside Mello-Roos CFDs.** I checked one manually against Kern County's CFD viewer — it's a known CFD parcel. The platform happily ingested it as a normal lead. That's a disclosure landmine. **A CA-aware import should overlay the parcel against the state CFD database (or county-by-county equivalent) and tag every match.** Right now I have to do that lookup myself. I already do that in LandGlide. AcreOS adds nothing.

**9:00 AM.** I open `/parcels/:id` on a Tulare County alfalfa parcel I'm in DD on. Composed view is genuinely good — the DD checklist is the right shape. **What's not on the checklist for CA:**
- Mello-Roos / CFD status
- Williamson Act contract status (huge in Tulare/Kings — locks ag use for 10 years; cancellation triggers penalty)
- NHD report ordered? (Natural Hazard Disclosure — required by CA Civ. Code § 1103)
- PCOR (Preliminary Change of Ownership Report) prepared
- SB 800 / construction-defect statute relevance if any structure exists
- CEQA review needed? (only if you're subdividing or seeking entitlements, but worth a flag)

I see in `routes-platform-features.ts` that CA disclosures *exist* — Natural Hazard, Environmental Hazard, Mello-Roos. Good. **They aren't surfaced on the parcel DD checklist.** They live in a disclosure module the operator has to remember to visit. That's the bug. The disclosures need to be on the parcel surface where I do my work, not in a compliance tab I forget to open.

**10:00 AM.** I check the usury rate on a Kings County deal where I'm carrying paper. I find the usury checker — `server/services/usury.ts` and `server/services/usuryCeiling.ts`. I see CA flagged at **10%** civil ceiling. That's correct on the surface but **dangerously incomplete.** Cal. Const. art. XV § 1 actually has two limits: 10% for personal/family/household, **and the higher of 10% or 5% over the SF Fed discount rate for non-consumer loans.** *And* there's a major exemption for seller-carried purchase money on property the seller previously owned — meaning if I sold the parcel and carry paper, I can usually charge what I want. The `usuryCeiling.ts` notes file mentions this in passing (`"Complex rules"`). That's not enough. **A CA Land Investor who relies on the bare 10% number will under-price every note they carry.** I'd want the checker to ask: was this seller financing on property you owned? Is the borrower a natural person? Is it consumer-purpose? Then route to the right ceiling. Right now it's a single number and that single number is wrong half the time.

**11:30 AM.** I try to **assign a Kern contract** to a buyer in my list. I see `Assignment Contract` in `storage.ts:5317`. The template is clean — Assignor, Assignee, Assignment Fee, original contract. **Nothing in the platform warns me that under Cal. Bus. & Prof. Code § 10131, marketing real property for compensation without a DRE license is a misdemeanor — and "wholesaling" via assignment is a known DRE enforcement target.** Texas just passed a wholesaler-disclosure statute; CA has been quietly enforcing for years. The Atlas context for "residential wholesaler" exists (`atlasContextInjector.ts:69`) but it's persona vocabulary, not a licensing gate.

What I want at the moment I click "Assign Contract" on a CA parcel: a modal that asks (1) are you a CA-licensed broker/salesperson? (2) if no, are you the principal in the transaction with equitable title and full assumption of risk? (3) have you disclosed your principal status to the seller in writing? **If the answer to #1 is no and #3 is no, the platform should refuse to render the assignment doc and instead route me to a double-close template or a JV agreement.** This is exactly the kind of guardrail my attorney would build for me. It's also the difference between AcreOS being a CRM and AcreOS being a CA Land Investor's operating system.

**1:00 PM.** Field trip to a 40-acre Tulare parcel. `/field-scout` works as advertised — offline sync, GPS, photos. Surprisingly good. **What I want for CA: a "Williamson Act overlay" toggle on the map** so I can immediately see which parcels in my drive-by zone are under contract. In Tulare/Kings, getting that wrong burns 18 months while you wait out non-renewal.

**3:00 PM.** I try to estimate post-transfer property tax on a parcel I'm acquiring. **There is no Prop 13 reassessment estimator anywhere I could find.** Tax-optimization page mentions Prop 13 in a one-line note (`tax-optimization.tsx:583`) — "Prop 13 limits reassessment at 2% annually." That's the *holding* rule. The *transfer* rule is what I need: when I buy, the parcel reassesses to current fair market value, supplemental tax bill arrives 6–12 months later, and the new base is locked at that point. **A CA buyer who doesn't model the supplemental tax bill against deal IRR is leaving 5–15% of margin on the table or worse, signing a deal that no longer pencils.** I'd want this on the parcel-detail page next to the valuation: "Current assessed: $X. Estimated post-transfer base: $Y. Supplemental tax bill estimate: $Z. Annual tax change: +$W."

Prop 19 (the 2020 successor) also matters — limits parent-child reassessment exclusions to primary residences only. If a seller is inheriting and trying to flip, the deal economics shift the moment they take title. That's not modeled either.

**4:30 PM.** I look for **CEQA flags** on a 240-acre parcel I'm considering subdividing. Search the codebase — single hit in `environmentalIntelligence.ts:160` mentioning CEQA in a mineral-extraction note. Nothing in the parcel DD flow. **CEQA review is mandatory for any discretionary government approval — including a subdivision map under the Subdivision Map Act.** If a CA Land Investor checks "subdivide" as part of their exit, they have just signed up for a CEQA initial study, possibly a Negative Declaration, possibly an EIR. Cost range: $5K (Cat Ex) to $250K+ (full EIR). A platform that lets me model subdivision IRR without flagging CEQA cost is selling me a lie.

**5:30 PM.** I check the **Subdivision Map Act** awareness. Nothing. The `subdivisionRegulations` field in `regulatoryIntelligence.ts` doesn't even have a CA entry — CA is missing from the file entirely. Texas, Florida, Georgia, NC are there. **California is not.** That's the single most damaging gap in the audit. Whoever built `regulatoryIntelligence.ts` skipped the most regulated state in the country.

The Subdivision Map Act (Gov. Code § 66410 et seq.) draws the line at four lots: divide a parcel into 2–4 lots, you file a Parcel Map; 5+ lots, you file a Tentative Tract Map and trigger a much heavier review including CEQA. Local jurisdictions add their own slope, density, and setback overlays on top. A platform that lets a CA operator model "split this 240 into 6 ranchettes" without surfacing the tract-map threshold is selling fiction. I want the parcel surface to ask one question — "exit strategy?" — and if the answer involves a split, the platform tells me which map applies, the rough timeline (12–36 months for a tract map in Kern; 24–48 in Tulare's stricter zones), and the CEQA tier most likely to attach.

**6:00 PM.** I check what happens when I tag a parcel as "1031 exchange replacement." `routes-exchange-1031.ts` exists and tracks identification dates. Good. **What's missing for CA: state-level non-conformity tracking.** California conforms to federal 1031 generally but has its own clawback rule for out-of-state replacement property (FTB Form 3840). If I exchange CA-source gain into Nevada land, I owe an annual filing to FTB until I dispose of the replacement. The platform tracks the federal 45/180-day windows. It doesn't track the FTB 3840 calendar. For a CA operator who exchanges out of state, that's a missing recurring tax obligation the platform should be reminding me about every January.

---

## 3. Per-surface friction (CA-specific)

**`/today`** — Needs a CA Regulatory Watch tile if my org's `defaultState` is CA. Generic "compliance alerts" won't cut it. I want CFD updates, Williamson Act non-renewal deadlines, CEQA bulletin changes, DRE advisories.

**`/pipeline` + `/leads`** — CSV import should overlay CFD, Williamson Act, NHD-required, CEQA-relevant flags as it ingests. Right now it eats CA leads identically to TX leads. That's the problem in one sentence.

**`/parcels/:id`** — Best surface, but the DD checklist needs CA-specific items injected when state = CA: Mello-Roos status, Williamson Act, NHD ordered, PCOR drafted, supplemental tax estimate, CEQA-trigger check.

**`/finance` (notes)** — Usury check needs to ask the three CA questions (seller financed prior-owned property? consumer? natural person?) and route to the right ceiling. Single-number check is misleading.

**`/documents`** — Assignment template should refuse to render for CA orgs without a DRE license attestation OR a principal-disclosure attestation. Equitable-title double-close should be offered as an alternative path.

**`/money` → tax pack** — Needs a CA supplemental tax module. Needs Prop 13 reassessment estimator. Needs Prop 19 inheritance-flip flag.

**`/onboarding-v2`** — There should be a CA-operator path that asks at signup: "Are you a DRE licensee? What counties? Do you operate inside CFDs?" and configures the platform accordingly. Right now I get the same onboarding as someone in Lubbock.

**`/pax`** — Pax should be CA-aware. If I'm asking about a Tulare parcel, Pax should bring up Williamson Act before I do. If I'm drafting an assignment, Pax should ask about my license status. Pax is currently state-agnostic. CA operators need a state-aware copilot or Pax is just decoration.

**`/sign-document`** — The HMAC e-sign flow is good. **CA-specific concern:** AB-2424 (RON) and SB-303 govern remote online notarization in CA — only effective Jan 2030 with conditions. Until then, CA still requires wet-ink for most recordable instruments. **The platform should not let me e-sign a grant deed for a CA parcel and pretend it's recordable.** I didn't see a check for this. If a CA operator e-signs a deed and tries to record it at the County Recorder, it bounces. That's a refund-and-lawsuit moment. The right fix: a doc-type taxonomy that tags each template "e-signable in CA: yes / no / yes-with-RON-after-2030" and gates the signing flow accordingly. Purchase agreements, options, JV agreements: e-sign fine. Grant deeds, deeds of trust, reconveyances, anything destined for a County Recorder: hard stop with a "wet-ink required" notice and a courier integration.

**`/portfolio`** — The aging-bucket / delinquency view is the right shape, but a CA operator needs **county-of-record breakdowns** because property tax delinquency rules vary at the county tax-collector level — Kern's auction calendar is not Tulare's. A single "CA" filter rolls up 58 counties into one number that means nothing operationally. I want to see "5 notes in Kern, 2 90+ DPD, next tax sale May 18" not "7 notes in CA."

---

## 4. The CA attorney test — partial pass at best

My attorney bills me by the question. Here's what she'd need every CA deal:

- **NHD report ordered and attached** — *Not on parcel DD.* Manual.
- **Mello-Roos / CFD status verified** — *Disclosure exists in compliance module, not on parcel.* Manual.
- **Williamson Act contract status** — *Not anywhere.* Manual.
- **PCOR prepared at recording** — *Not in document templates I could find.* Manual.
- **Wholesaler licensing posture documented per assignment** — *No gate, no log, no attestation.* High legal exposure.
- **Usury check that knows CA's seller-finance exemption** — *Single-number check that flags compliant deals as warnings and waves through actual violations.* Misleading.
- **Subdivision Map Act / CEQA pre-flight on subdivisions** — *Absent.* High exposure.

**Net: this is a fail for a CA operator who actually subdivides or assigns. It's a marginal pass for a buy-and-hold CA operator who doesn't do anything aggressive.** The platform doesn't know what California is.

---

## 5. Five features that would make this a no-brainer for CA

1. **CA-aware parcel DD module.** When state = CA, the DD checklist injects: CFD status, Williamson Act, NHD report tracker, PCOR draft, supplemental tax estimator, CEQA trigger check. One pane of glass for what I currently track in three places.
2. **Prop 13 / Prop 19 transfer estimator** on every CA parcel. Show current assessed, post-transfer base, supplemental tax bill, annual delta. Roll the supplemental tax into deal IRR automatically.
3. **DRE wholesaler-license gate** on the assignment-contract flow for CA orgs. Refuse to render the doc without an attestation; offer double-close or JV as alternatives. Log every attestation. Cite Bus. & Prof. § 10131 in the modal so my attorney can see exactly what the platform's posture is.
4. **Subdivision Map Act + CEQA pre-flight.** When I check "subdivide" as exit on a CA parcel, surface: parcel map vs. tentative tract map threshold (4 lots), local jurisdiction's CEQA classification, estimated review cost range, lead-agency contact. Stop me from modeling a $400K profit on a deal that needs a $180K EIR.
5. **CA Regulatory Watch feed** as a first-class tile on `/today` for CA orgs. CFD updates, Williamson non-renewal calendar, DRE enforcement bulletins, AB/SB legislative session changes. The platform tracks federal stuff (Dodd-Frank) — it should track CA legislative sessions with the same rigor.

---

## 5b. The "CA Land Investor doesn't exist" myth, briefly

Every horizontal CRM I've evaluated assumes CA Land Investors are unicorns. They're not. There are hundreds of us in Kern County alone — Bakersfield is full of operators flipping desert lots between $3K and $40K, Central Valley ag pros assembling distressed almond and pistachio acreage, mountain-county tax-default specialists in Tuolumne and Mariposa, Inland Empire industrial-flex flippers, Imperial Valley solar-lease assemblers. We exist because the regulatory complexity scares off the casual operator and leaves margin for the disciplined one. What we don't have is software that respects the work.

The platforms we end up using — Realeflow, Pebble, Land.com, even raw LandGlide — all treat CA like an edge case. Result: we run hybrid stacks (CRM + attorney + GIS + spreadsheet). If AcreOS becomes the first horizontal CRM that ships a real CA layer, you don't need to "find" CA Land Investors. We will find you. Word spreads in this community fast — there's a Slack of about 90 of us, and the moment one operator confirms a platform actually models Mello-Roos correctly, the rest of us trial it that month.

The myth is a self-fulfilling prophecy: nobody serves us, so nobody knows we exist, so nobody serves us. Break that loop with the CA layer in §5 and the demand surfaces.

---

## 6. Three things that are surprisingly good

1. **The CA disclosure list in `routes-platform-features.ts:1081` is correct as far as it goes** — NHD, Environmental, Mello-Roos. Whoever wrote it knew enough to include the three that matter most. The bug is that it doesn't reach the parcel surface, not that the data is wrong.
2. **`stateDocumentConfig.ts` got the grant-deed-vs-warranty-deed thing right.** "Never use warranty deed — grant deed is the equivalent." That single line tells me an actual CA operator or attorney touched this file. Most generic CRMs ship warranty-deed templates and ruin their first CA closing.
3. **The persona vocabulary registry treating "land investor" as the default.** I'm not a "real estate professional." I don't sell houses. I buy dirt. The fact that the platform calls me a Land Investor without me having to set anything tells me Thomas is paying attention to who his actual customers are.
4. **The `dealFeedEngine.ts` actually has a Kern row** — I checked. `{ state: "CA", county: "Kern" }` is in there as a real ingestion target. Combined with the Kern ArcGIS endpoint in `routes-admin.ts:1403`, it tells me parcel data ingestion for my home county is genuinely wired up rather than hand-waved. That's table stakes I expected to be missing and was happy to find. Now extend it to Tulare and Kings.
5. **`stateDocumentConfig.ts` notes "PCOR (Preliminary Change of Ownership Report) required at recording"** — that single line on CA's row tells me whoever wrote the file knew CA mechanics. PCOR is the form 95% of out-of-state operators forget about until the County Recorder's office bounces their deed back. The line is correct. **It just needs to become an actual generated document in the closing flow, not a footnote.**

---

## 7. The deal-killer if not fixed

**California cannot be a row in a 50-state table.** The single highest-priority engineering investment for CA market entry is a *CA-specific regulatory layer* that:

- Recognizes Mello-Roos / CFD parcels at ingestion and at parcel-view
- Recognizes Williamson Act contracts and surfaces non-renewal timelines
- Models Prop 13 / Prop 19 transfer reassessment as a first-class deal economic
- Gates wholesaler assignments behind a license/principal attestation per § 10131
- Flags CEQA + Subdivision Map Act exposure on any parcel where exit involves subdivision
- Asks the right three questions for usury and routes to the correct ceiling

If even one of these is wrong on a real deal — say, the platform silently lets me assign a contract for compensation without a DRE license, or it under-states my supplemental tax bill by $8K, or it lets me e-sign a deed that won't record — I am not in Excel by Friday. I am sitting across from a complainant at a DRE hearing, or I'm eating the loss on the deal, or I'm on the phone with my attorney at $400/hr explaining what AcreOS told me. **In CA, "the platform was wrong" is a defense that costs $40K to mount and never fully wins.**

Get the CA layer right and you don't just win me. You win every CA Land Investor who currently believes (correctly, today) that CA is too regulatory for any horizontal CRM to handle. There are more of us than the platform thinks. The myth that "CA Land Investors don't exist" is just the myth that "no platform serves us." Fix the second; the first goes away.

---

## 8. Build order I'd suggest

If I were running engineering and had a quarter, I'd ship the CA layer in this order:

1. **Add CA to `regulatoryIntelligence.ts`** with accurate fields (subdivisionRegulations: "strict", usuryCeiling: structured rather than scalar, requiredDisclosures: NHD + Mello-Roos + Williamson + supplemental tax). Two days of attorney review, half a day to encode. This is the foundation everything else hangs off.
2. **Refactor `usury.ts` to take a context object** (sellerFinancedPriorOwned, consumerPurpose, naturalPersonBorrower) instead of a scalar rate, and route CA through the multi-ceiling logic. Backfill all existing usury checks.
3. **Inject CA-specific DD items into the parcel detail page** when state = CA — drive everything off the regulatoryIntelligence row so the surface stays generic.
4. **Wholesaler-licensing gate** on the assignment-contract render path. Modal, attestation, audit log row, double-close fallback. This is the single highest legal-exposure item in the audit.
5. **Prop 13 / Prop 19 supplemental tax estimator** as a parcel-detail card and as an input to deal IRR. Pull current assessed from county assessor data already in the broker.
6. **CEQA + Map Act pre-flight** triggered by exit-strategy = subdivide. Surfaces required map type, CEQA tier, rough cost band.
7. **CA Regulatory Watch** ingestion job — DRE bulletins, FTB notices, CFD updates from county data — surfaced as a /today tile for CA orgs.

Ship those seven and you have the only CA-aware Land Investor CRM in the market. That's a moat.

— Marisol
