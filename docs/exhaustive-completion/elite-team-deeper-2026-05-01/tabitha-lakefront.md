# Tabitha Vine — AcreOS user review (vacation/lakefront specialist)

I'm 44. Traverse City, Michigan. I sell waterfront and water-access — Lake Michigan and Lake Huron frontage on the west and east sides of the mitten, plus the inland lakes that everybody who couldn't afford the Big Lake actually closes on: Torch, Glen, Crystal, Walloon, Mullett, Burt, Houghton, Higgins, the chains in Cass and Cheboygan. Parcels run $80K for a back-lot with a 25-foot deeded easement to the water, up to $800K for 200 feet of clean Lake Michigan beach in Leelanau County. My buyers are 90% out-of-state — Chicago, Indianapolis, Cincinnati, the Detroit suburbs, increasingly Nashville and Atlanta. They're emotional. They make life decisions in a weekend. My stack today is Lakehome.com (the only listing site Up North people actually search), LandWatch (back-lot inventory), the Northern Michigan MLS (Leelanau, Grand Traverse, Antrim, Charlevoix, Emmet, Cheboygan, Otsego, Kalkaska, Crawford), LandGlide for parcel boundaries on a phone in the field, EGLE's Wetlands Map Viewer for shoreline regs, and a ten-year filing cabinet of high-water-mark surveys, septic permits, and well logs.

I picked the Land Investor persona in the AcreOS settings panel because no other option fit. There is no "Vacation/Recreational" persona. There is no "Waterfront Specialist" persona. The closest the dropdown gets is "Short-Term Rental," which is about *operating* an Airbnb, not *selling* lake lots to people who'll go build a cottage. So I'm a Land Investor, allegedly, the same as a tax-delinquent flipper in West Texas. Half a day inside the product, here's what landed.

---

## 1. Thirty-second verdict

Would I sign up today? **Probationary yes — at $20/mo Starter, as a deal-tracking spine for the inland-lake business.** At $49/mo Pro, no, because the features I'd pay extra for (riparian-rights parsing, EGLE wetland overlays, township STR registries, lakefront-comp normalization for frontage-feet-not-acres) don't exist, and the features I'd be paying for (note ledger, drip sequences, blind-offer mailers) don't apply to my buyer.

The platform is *competent* for general parcel work. The map is good. The DD checklist is honest. The document signing flow is better than DocuSign for what I do. **What it does not understand is that on a lakefront deal, the parcel is half the asset and the water is the other half — and the water is the half my buyers are buying.** AcreOS treats lake frontage as a checkbox (`hasWater: boolean`) and a flag (`waterDetected: boolean`). That's not a model of a waterfront sale. That's a yes/no button.

For my work, the gap isn't "missing features." It's that the buyer-side and the regulatory-side of waterfront have no schema at all. Everything below is what would fix that.

---

## 2. The seven things I need — and what AcreOS actually has

### **(1) Riparian rights — who owns what part of the water.**

In Michigan, riparian rights are *littoral* on the Great Lakes (different doctrine) and *riparian* on inland lakes (different doctrine), and the rights vary by whether the parcel is a "true riparian" (frontage on the water) versus a "back-lot easement holder" (deeded path to the water across someone else's land). Pricing differs by 3-5x between those two classes for otherwise identical lots. The buyer's question on every showing is: *Can I put in a dock? Can my kid's family put in a second dock? Can the back-lot people who bought from the developer in 1962 keep crowding my shore?* The answer lives in the deed, the plat, the recorded easement, and a hundred years of Michigan riparian case law (the Thies v. Howland line, the dock-crowding doctrine in Ouderkirk, the bottomland cases).

What AcreOS has: nothing. There's a `hasWater: boolean` on the property table and a `waterFeatures?: boolean` on enrichment. No schema for frontage feet. No schema for riparian class (true riparian / back-lot / easement / deeded access / association membership). No schema for dock rights. No way to attach the easement document to the parcel and link it to the buyer-disclosure flow.

What I need:
1. `frontage_feet` (numeric), `frontage_water_body` (text — "Lake Michigan", "Torch Lake", "Boardman River"), `riparian_class` (enum: `true_riparian`, `back_lot_easement`, `deeded_access`, `association_member`, `none`) on the property table.
2. A "Water rights" subsection on `/parcels/:id` that surfaces those fields prominently, not buried under enrichment.
3. A document-type tag for "easement document," "plat showing access," "riparian rights opinion letter" so my Michigan land-use attorney's $400 opinion letters file in a known place and travel with the parcel through closing.
4. **Comp normalization by frontage feet, not acres.** A 0.4-acre lot with 100 feet of frontage on Torch is a different animal from a 0.4-acre lot with 30 feet on a back channel. The AVM and comp surfaces today key on acreage and zoning. For waterfront, the dollars-per-frontage-foot is the only number that matters, and AcreOS can't compute it because the schema doesn't carry frontage feet.

Not built. This is the single biggest gap for my vertical.

### **(2) Bottomland ownership — the ground under the water.**

In Michigan, on inland lakes, the riparian owner generally owns to the center (or to a pie-slice toward the center) of the lakebed — but on the Great Lakes, the state owns the bottomland lakeward of the ordinary high-water mark. This sounds academic. It is not. It controls whether my buyer can drive a permanent dock pile, whether the back-lot people can build a permanent boat hoist, whether the seller can sell "the marina" or only the structures on it, and whether the title insurer will write a clean policy. I have killed three deals in five years over bottomland disputes the buyer's title attorney caught the week before closing.

What AcreOS has: nothing on bottomland. Nothing on ordinary high-water mark. The compliance engine in `complianceGuardian.ts` is geared at sale-disclosure rules (Dodd-Frank for seller financing, Arizona-style unsubdivided-land affidavits) and acreage-min triggers. It does not know what an OHWM is.

What I need: a bottomland-status field on properties touching navigable water — three values, `riparian_owned` / `state_owned` (Great Lakes) / `disputed` — with a free-text note for the case-specific weirdness, and a flag that pushes the title-search workflow to require an OHWM survey before the DD checklist closes. The DD checklist already exists (`useDueDiligenceChecklist`) and supports custom items. Add the OHWM gate as a templated item that auto-injects when the property has Great Lakes frontage. A day's work.

### **(3) High-water-mark surveys + septic + well — the four documents that close a lake deal.**

Every clean lakefront closing has, in my filing cabinet: an OHWM survey (or boundary survey clearly showing the high-water line), a septic permit history with the most recent inspection, a well log from the Michigan EGLE Wellogic database, and a riparian/easement opinion if the access pattern is unusual. These four documents *are* due diligence on a lake property. Without all four, the deal doesn't close — or closes ugly and comes back six months later as a lawsuit.

What AcreOS has: a generic document-versioning system (`documentVersions` table, versionNumber, restore-previous-version mutation) — genuinely good infrastructure. Documents can be uploaded, versioned, attached. What it does *not* have: a document-type taxonomy that knows about the lakefront four.

What I need:
1. Document-type enum extended with: `ohwm_survey`, `boundary_survey_with_water`, `septic_permit`, `septic_inspection`, `well_log`, `well_completion_report`, `easement_opinion`, `dock_permit`, `seawall_permit`, `bottomland_lease` (Great Lakes commercial). The `documentType` enum apparently doesn't exist as a constrained list yet — it's free-text in the model I read.
2. A "lakefront DD" template for the DD checklist that requires those documents before status can advance to `under_contract`. Templated by water-body type — Great Lakes triggers the bottomland-lease item, inland lake triggers the dock-permit item, river/stream triggers the easement-opinion item.
3. **Wellogic and EGLE permit lookups, ideally automated.** Michigan's EGLE Wellogic database is a free public well log lookup by parcel — `https://secure1.state.mi.us/wellogic/`. Same EGLE has a Geowebface viewer for septic permits in some counties. A connector that pulls these by APN is a one-engineer-week build and would replace 30 minutes of manual lookup per parcel, every parcel.

This stretch — the document side — is where AcreOS is closest to ready. The bones are right; the taxonomy is missing.

### **(4) Septic + well requirements — the inland-lake deal-killer.**

Most inland-lake parcels in Northern Michigan are not on municipal sewer. Septic is mandatory. Michigan's septic regulation is *delegated to the local health department* — there's no statewide septic code (unique among states; advocates have been pushing for one for forty years) — which means Grand Traverse County health department rules differ from Leelanau differ from Antrim differ from Charlevoix. The county health department determines minimum lot size for a septic system based on soil type, slope, and lake setback. **In Leelanau County, a parcel under 0.5 acres often cannot get a permit for a new septic at all.** Many older lakefront cabins were built before the rules existed and grandfathered; sell that parcel and the buyer cannot expand the cabin without bringing the septic to current code, which on a 60-foot-wide lot is usually impossible.

What AcreOS has: the zoning-lookup surface returns `setbackFront/Rear/Side` and `minLotSize` for the parcel's zoning code. Useful — but it's *zoning* setback, not *septic* setback. The septic setback to the water (typically 50-75 feet in Michigan, plus 50 feet to the well, plus 10 feet to the lot line) is a health-department code, not a zoning code, and AcreOS does not know it exists.

What I need:
1. A "septic feasibility" screen on the parcel — given county, lot size, soil type (already pulled from USDA), slope, and water frontage, return an estimated buildable envelope and a "permit likely / permit uncertain / permit unlikely" verdict. The data exists. The county health department septic rules are public PDFs. Seed Leelanau, Grand Traverse, Antrim, Charlevoix, Emmet, Cheboygan, Otsego, Kalkaska, Benzie, Manistee, Wexford for the Northern Michigan corridor and you've covered 80% of my deals.
2. Well-setback overlay on the map — visible 50-foot circle from the property line and the water, so the buyer can see why the cabin can't expand toward the lake.
3. A flag for "grandfathered nonconforming" parcels — most pre-1972 lakefront cabins are nonconforming, and the disclosure obligation on me as the listing agent is real. AcreOS has a Dodd-Frank disclosure engine; bolt grandfathered-nonconforming onto it.

Not built. The pieces are adjacent — soil from USDA, slope from USGS DEM, zoning setbacks, both already in the platform — but nothing has been wired into a septic-feasibility view.

### **(5) Township vs county zoning — the Michigan tax.**

Michigan zoning is *township-administered* in most rural counties. There are 1,240 townships in this state. Each one writes its own zoning ordinance. Two parcels on opposite sides of a township line on the same lake can have wildly different setbacks, allowed structures, dock regulations, and short-term-rental rules. The county-level zoning lookup that works in Tennessee or Texas does not work here. The data I need lives in the township ordinance binder at the township hall, often photocopied from 1987.

What AcreOS has: a `zoning-lookup` surface that returns a zoning code, allowed uses, and setbacks. I tried it on a parcel in Long Lake Township (Grand Traverse County) and on a parcel in Acme Township (also Grand Traverse County, different ordinance entirely). The lookup returned the same generic zoning data for both — it appears to be keyed at the county or city level, not township.

What I need:
1. Township-level zoning rules in the data model. The schema's `zoning_lookups` table (or whatever caches the lookups) needs a township foreign key, not just county.
2. A seeding effort for the top 50 lakefront townships in Michigan. This is a research project — somebody calls or visits each township, captures the ordinance, normalizes it. 50 townships × 4 hours each is a six-week sprint. I'd contribute mine if there's a structured intake.
3. A "this lookup is at the county level — verify with the township" disclaimer when the township-level data isn't available, instead of returning false confidence.

The zoning surface today reads as nationally complete and is regionally lossy. That's worse than admitting the gap.

### **(6) Short-term rental restrictions — the new deal-killer.**

In the last three years, half my buyers have asked the same question on the dock: "Can I rent it on Airbnb when we're not here?" The answer in 2023 was usually yes. The answer in 2026 is *it depends on the township, and changes every six months.* Garfield Township banned new STRs in 2024. Acme limited them by zone. Peninsula Township (Old Mission) caps total STR licenses. Leelanau County's townships are a patchwork — Suttons Bay allows, Bingham bans, Centerville caps. **A buyer who pays $600K expecting $80K/year in STR income and then discovers the township just banned new licenses is a buyer who calls the State Real Estate Commission and files a complaint against me.**

What AcreOS has: an onboarding option called "Short-Term Rental" (operating Airbnbs, not selling parcels with STR potential), and a `layout-sidebar.tsx` mapping that routes that persona to `/maps` and `/land-credit`. Nothing in the property model captures STR status. Nothing in the township-zoning lookup surfaces STR rules — partly because the zoning lookup doesn't know townships exist.

What I need:
1. An `str_status` field on the property — values `allowed`, `allowed_with_permit`, `capped` (and current cap utilization if known), `banned`, `unknown`. With a "rule effective date" so I can disclose accurately when the rule changed.
2. STR registry data for the top townships, refreshed quarterly. Most townships now post their STR ordinance and a permit roster on their website.
3. **Mandatory STR disclosure injected into the buyer disclosure packet** when the parcel is in a township with restrictive rules. The compliance engine already supports rule-triggered disclosures; this is a new ruleType — `str_restriction` — added to the existing infrastructure.

Not built. And the litigation risk on the listing-agent side is real and growing. I would pay for this feature alone.

### **(7) Out-of-state, emotional buyers — the sales motion is different.**

A waterfront buyer is not a land-investor buyer. Land investors run AVMs and blind-offer wizards and care about cap rates. Lakefront buyers see the photo, fly to Traverse City Friday, walk the parcel Saturday, write an offer Sunday morning before they get on the plane. Most have never bought property out of state. They don't know what a riparian opinion is. They are emotionally committed before they understand what they're buying. **My job is half realtor, half educator, half therapist** — and the sales surface I need is a buyer-facing portal that walks them through the purchase, document by document, with explainers, before they panic.

What AcreOS has: `borrower-portal.tsx` (for note-investor seller-financing borrowers — wrong audience), `shared-deal.tsx` (for sharing a deal with a co-investor — closer, but not buyer-shaped), `sign-document.tsx` (HMAC-link public signer, no login required — *this is excellent*, and I'd use it from day one). The HMAC signer specifically — anonymous link, audit row, signer order, expiry — solves the "Cincinnati buyer can't figure out DocuSign on a phone in an Airport Marriott" problem better than any tool I've used.

What I need: a **buyer portal** distinct from borrower-portal — purpose-built for lakefront buyers — that gives the buyer:
1. A property summary with the photos, the four documents (OHWM/septic/well/easement), the riparian opinion in plain English, the township STR status, and the disclosure packet.
2. A "what is riparian" / "what is bottomland" / "why does septic matter" explainer library, written for somebody who's never bought rural property.
3. A timeline view: where we are in the contract, what's next, what they need to do, when their wire transfer is due.
4. A messaging channel back to me that's not text-message-on-my-personal-phone-at-9pm-from-an-emotional-buyer.

The sign-document HMAC infrastructure is the foundation. The buyer portal is two weeks on top of it. **The persona registry should add "vacation_specialist" or "recreational_land" so the workspace shape can light up these surfaces by default.**

---

## 3. The day-in-the-life test — where AcreOS would slot in

**Tuesday morning.** I have a new listing coming Friday — 122 feet of frontage on Long Lake, 0.6 acres, asking $485K. Seller is in Florida. I need to do my listing-prep DD before I show up at the property to take photos.

**Where AcreOS helps today:** the map with FEMA flood + USGS topo + USDA cropland is genuinely useful. I can see the wetland indicator, the 50-foot setback line conceptually, the topography off the lake. The DD checklist gives me a frame. The property record holds the seller info, the photos, the asking price.

**Where it doesn't:** the township zoning lookup returns generic county data. The well log search — I do that in EGLE Wellogic in another tab. The septic permit history — I call the Grand Traverse County Health Department, a phone call AcreOS can't make. The frontage feet, the riparian class, the dock-rights status — I add as free-text notes because there's no field for them. The OHWM survey — I store as a generic PDF because there's no document type for it. By the end of an hour I've used AcreOS as a parcel viewer and done all the actual lakefront-specific work in seven other places.

**Tuesday afternoon — buyer call.** A Cincinnati family I sold to two years ago wants to upgrade. They want a true Lake Michigan parcel, $500-$700K, that they can rent for the summers when their kids are in school. STR permitting is non-negotiable for them.

**Where AcreOS helps:** the listings surface with syndication targets (LandWatch, Lands of America, Zillow). Reasonable. **It does not know about Lakehome.com**, which is where 70% of my actual lakefront leads come from. The syndication target list is a generic-rural-land list, not a vacation list.

**Where it doesn't:** I cannot filter listings by "STR-allowed townships in Leelanau County, true riparian on Lake Michigan, frontage 100ft+." I can filter by acreage and price. The buyer's actual filter set requires fields the schema doesn't have.

**Wednesday — under contract on the Long Lake parcel.** Buyers from suburban Chicago, never bought in Michigan. Riparian opinion needed. Township confirmed STR-allowed (Long Lake Township still permits, capped at 60). Septic feasibility verified — existing 3-bedroom system, good for the cabin as-is, won't permit expansion.

**Where AcreOS helps:** the document signing flow (HMAC, audit, signer order) is genuinely better than what I'm using. I'd put the purchase agreement through it tomorrow. The document version history would handle the riparian opinion's three revisions cleanly.

**Where it doesn't:** there's no buyer portal that walks the Chicago family through what they're signing. They get the documents; they don't get the explainers. By Friday they've called me four times asking what an OHWM is. That's a buyer-portal feature gap, not a fault of the signing tool.

**Friday — closing prep.** Title attorney finds the 1971 dock-share easement that runs to a back-lot association down the road. Three days of phone calls to confirm the easement is in good standing, the assessments are paid, and the buyers' new dock won't trigger a crowding-doctrine claim. Resolved. Closing happens.

**Where AcreOS helps:** holding the easement document in version-tracked storage and attaching it to the parcel record. Fine.

**Where it doesn't:** there's no way to flag the easement as "unresolved — dock-crowding risk" on the DD checklist, no template item for "back-lot easement review," no way the next agent who lists this property in 2031 will see the 2026 dock-share resolution attached. The institutional memory leaks.

---

## 4. Per-surface friction (for the surfaces a vacation specialist would touch)

**`/maps` and `property-map.tsx`** — Strong general map. FEMA flood, USDA cropland, USGS topo, hillshade, satellite, NLCD. Measurement tools work. **What's missing for me:** Michigan EGLE Wetlands Map Viewer overlay (the canonical wetland boundary in this state, different from the federal NWI), NHD hydrography overlay (so I can see river outlets, channel widths, lake-chain connections — a Torch Lake parcel that connects via channel to Clam Lake and Skegemog is a different asset), and the OHWM line for Great Lakes parcels (USACE publishes this). Add three layers, don't redesign.

**`/parcels/:id`** — Composed view, DD checklist, neighbors. Good frame. **A "Waterfront" tab with frontage feet, riparian class, water body, bottomland status, dock permits, septic feasibility, STR status, and the four-document checklist would change my life.** One tab. The most-used tab in my workspace.

**`/zoning-lookup`** — Returns county-level data. In Michigan's township-zoning regime, that's wrong by default. Fix the schema to support township-level rules and seed the top 50 lakefront townships. Until then, add a "this lookup may be at the county level — verify locally" disclaimer.

**`/regulatory-intel` / `/regulatory-intelligence` / `/compliance` / `/state-documents`** — Four overlapping surfaces. None of them know about Michigan riparian law, EGLE wetland rules, township STR ordinances, or county health department septic codes. The compliance engine's structure is right (rule triggers, ruleType enum) — it just hasn't been seeded with the rules I work with daily. Pick one surface, rename it, make it the regulatory hub, and seed a Michigan ruleset.

**`/documents` + `/document-versions`** — Genuinely good. Add the lakefront document-type taxonomy (`ohwm_survey`, `septic_permit`, `well_log`, `easement_opinion`, `dock_permit`, etc) and this becomes my filing cabinet for real.

**`/listings` syndication** — Targets are LandWatch, LandFlip, Lands of America, Zillow, Facebook Marketplace, Craigslist. **No Lakehome.com, no LandSearch, no Lakefront Living, no recreational-land-specific feeds.** For my buyer pool the targets are wrong. Add Lakehome and the recreational feeds, and let me untoggle the wholesaler-focused ones.

**`/blind-offer-wizard`** — Buy-side tool. The output for a vacation-land scout should consider frontage-foot pricing, not just acreage. Today the wizard treats a 0.4-acre back-lot the same as a 0.4-acre true-riparian parcel. Wrong by 3x.

**`/avm`** — Per-acre model. For waterfront, the dollars-per-frontage-foot ladder is the only valuation that holds. Until the AVM accepts a frontage-feet input and a riparian-class adjustment, it's a generic-land AVM with a confidence interval that's too tight on lakefront comps.

**`/buyer-network`** — Categorizes buyers by "Recreational" already (good), and the bones are here. **What's missing:** the out-of-state filter that lets me match a Cincinnati buyer to a parcel that fits "STR-allowed, septic permittable, riparian-clear" — the actual filter set my buyers use.

**`/today` and `/pax`** — Pulse score, AI suggestions. None of it is shaped around "what showings do I have this weekend, which buyers are flying in, which septic permits are pending review at the health department." A vacation-specialist /today would be: showings calendar, fly-in buyer prep, document-deadline tracker, township STR rule changes since last week. Pax should be off by default for me — I do not want an AI guessing at riparian opinions.

**Settings → Workspace shape (PersonaPanel)** — Seven personas, none of which describe my work. Add `vacation_specialist` or `recreational_land`. The vocabulary registry already supports per-persona term swaps; this is a one-day add to the persona enum and a one-week add to seed the vocabulary.

**`/onboarding-v2`** — The "active investor" path assumes single-parcel transactional flow. There's no question that asks "do you sell waterfront / vacation land," which would route a vacation specialist to a different first-day screen, with riparian + septic + STR fields enabled and the note-ledger surfaces hidden. Persona-aware onboarding is the gating fix.

**`/founder-*` surfaces** — Hidden for me, please. Not noise I need.

---

## 5. The data-model gap, in plain words

The vacation-land model is **parcel + water + buyer-emotion**, where the water carries half the value, the regulatory complexity is double the inland equivalent, and the buyer needs hand-holding the wholesaler model doesn't budget for.

What needs to land:
1. `frontage_feet`, `frontage_water_body`, `riparian_class`, `bottomland_status`, `dock_permit_status`, `str_status`, `septic_feasibility` columns on the property table.
2. `township` field on properties (currently I see it on PLSS enrichment but not as a first-class location field). And a `township_zoning_rules` table separate from `county_zoning_rules`.
3. Document-type enum extended with the lakefront eight: OHWM survey, boundary-with-water survey, septic permit, septic inspection, well log, well completion, easement opinion, dock/seawall permit.
4. A `vacation_specialist` (or `recreational_land`) persona, with vocabulary registry entries and a sidebar mapping that surfaces the right tools.
5. A buyer-portal surface — distinct from the borrower-portal — built on the HMAC-signing infrastructure.
6. A `lakefront` ruleset in the compliance engine — seeded with Michigan riparian law, EGLE wetlands, township STR registries, county septic codes.
7. Lakehome.com and recreational-land syndication targets in the listings flow.

Eight tables of changes, one persona addition, one syndication target list update, one new portal surface. Three weeks for one engineer who knows the domain. Most of the infrastructure (DD checklist, document versioning, HMAC signer, compliance engine, persona registry) is already shipped — it just hasn't been pointed at waterfront.

The persona panel today reads as "we know seven kinds of investors exist." For my market that's three kinds (land, fix-flip, landlord) and four kinds I will never be (note, tax-delinquent, wholesaler, subdivider). The omission of vacation/recreational is the single biggest market-coverage hole on the dropdown — and Northern Michigan alone has more land transactions per year than half the personas you're already supporting.

---

## 6. Three things AcreOS has built that I'd actually use

1. **HMAC-link document signing.** The anonymous-link signer with audit row, signer order, and expiry — better than DocuSign for what I do, because my buyers struggle with login flows in airports. I'd cancel my DocuSign subscription day one and the savings would pay for AcreOS Pro for the year.
2. **Map layer infrastructure.** FEMA flood, USDA cropland, USGS topo, hillshade, satellite — toggleable, performant. Add EGLE Wetlands and NHD hydrography overlays and this is the best lakefront-prep map in the industry. The bones are right.
3. **Document versioning.** Plats, surveys, riparian opinions cycle through revisions. The existing `documentVersions` table and restore mutation handle the workflow correctly. Add a document-type enum tuned to lakefront artifacts and this is my filing cabinet.

Honorable mention: the DD checklist. The schema supports custom items, the UI supports per-property overrides. Templated lakefront DD (OHWM, septic, well, easement) is a one-day extension on existing infrastructure.

---

## 7. The deal-killer

**Waterfront has a water side and a land side, and AcreOS only models the land side.**

A vacation specialist does not need new infrastructure. We need the existing infrastructure pointed at the water — frontage feet on the schema, riparian class on the parcel, bottomland status on the title workflow, septic feasibility on the DD checklist, STR status on the disclosure packet, township-level zoning, and Michigan's regulatory rules in the compliance engine. Eight tables, one persona, one portal. Three weeks of work.

I will keep AcreOS open as a deal-tracking spine at $20/mo Starter, because the map and the document signer pay for themselves. I will not move my listing prep, my buyer-portal handoff, or my DD into AcreOS until at least four of the seven gaps above are filled. Most importantly: I will not recommend AcreOS to the other twenty waterfront agents I know across Northern Michigan, Wisconsin, Minnesota lakes, the Finger Lakes, the Lake of the Ozarks, Lake Norman, the Texas Hill Country lakes, the Florida lake belt, and coastal Maine — and there are *thousands* of us, working a vertical that nobody has built a real CRM for — until the vertical has a real schema.

One more thing: when you build it, do not call it "AI-powered lakefront platform." My buyers do not want AI-generated riparian opinions. My buyers want a deterministic OHWM survey, a known septic feasibility, a township-confirmed STR status, and a paper trail that survives the title attorney's review. Sell me the schema. Sell me the document taxonomy. Sell me the township-level zoning. Sell me the buyer portal that holds the Cincinnati family's hand at 11pm the night before they wire $485,000 to a Michigan title company. The features will sell themselves.

— Tabitha Vine
   Vacation/Lakefront Specialist, Traverse City MI
   Lake Michigan / Lake Huron / inland Northern Michigan lakes
