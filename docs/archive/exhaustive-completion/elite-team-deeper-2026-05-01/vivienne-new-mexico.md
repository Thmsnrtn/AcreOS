# Vivienne Curtis — AcreOS user review (New Mexico Land Investor)

I'm 53, based in Santa Fe, and I run a small land book through Rio Arriba, San Miguel, and Mora counties. Twelve to twenty parcels in motion at any time — most of them between 5 and 80 acres, mountain-foothill stuff, juniper and piñon, sometimes alfalfa pasture in the river valleys. I run on REI Pro and a bilingual title researcher named Estela who works out of Las Vegas, NM. Total stack cost is maybe $260/mo plus what I pay Estela per file, which is the real number.

A friend at the New Mexico Land Title Association lunch told me to look at AcreOS. I spent two days in it. Here's what I found.

---

## 1. Thirty-second verdict

Would I sign up today? **No, not for what I do.** I'd recommend it to a friend who hunts in flat-grid eastern Colorado or south Texas, but I'd warn anyone working in northern New Mexico that **the state has a layer of legal and cultural complexity that AcreOS quietly doesn't model, and the failure mode isn't a bug — it's a quiet title lawsuit four years after closing.**

What I do is not what AcreOS thinks I do. It thinks I'm hunting parcels, running comps, sending letters to absentees, putting people under contract, and closing through a title company. All of that exists in northern NM, but **the work between "under contract" and "clear title" is where most of my year goes**, and it's the part AcreOS doesn't see. The reason is that this region carries:

- **Spanish and Mexican land grant chains** going back to the 1690s, before the United States existed, that the U.S. Court of Private Land Claims either confirmed, partially confirmed, or rejected between 1891 and 1904 — and unconfirmed grants still cloud title today.
- **Acequia association membership** — communal water rights administered by a 400-year-old governance structure (mayordomo + parciantes) with statutory standing under NM Statutes Annotated §73-2-1 et seq. You don't own water in NM; you own a parciante share, and a parcel without water rights in this region is sometimes worth a third of one with rights.
- **Pueblo land borders** — nineteen sovereign Pueblos hold land where the boundary is unsurveyed or in active jurisdictional dispute. A parcel within a mile of San Ildefonso, Tesuque, Pojoaque, Nambé, Picuris, or Taos Pueblo carries title risk that no commercial title insurer will fully cover.
- **NM Subdivision Act (NMSA §47-6-1 et seq.)** — the most aggressive state subdivision statute in the country. Splitting one 40-acre parcel into four 10-acre parcels triggers Type 5 subdivision review with the county and the state Attorney General if you've made any "promise or representation" about water, road, or terrain in marketing.
- **NM Real Estate Commission license requirement for assignment-of-contract** with "regularity and continuity" — different from Texas, which is generally permissive for one-off wholesale.
- **Bilingual closing requirements** — NMSA §47-13-2 and broader consumer-protection law requires Spanish-language disclosure when the buyer's primary language is Spanish. Half my deeds get signed by a buyer or a seller who reads Spanish first.

AcreOS, after 16 hours of clicking, is aware of zero of these. Not "weakly aware" — zero. The state-config table has me down as "no transfer tax, deed of trust preferred, community property — spousal consent matters." That's true and it's also the bottom 5% of what makes this state different.

So my answer is: **come back when you've spent a quarter in northern New Mexico**. Until then, you're a Texas product with a New Mexico color swatch.

---

## 2. Daily-use walkthrough — my imagined first day

**6:45 AM.** I land on `/today` from my office on Canyon Road. The greeting is in English. There is no language toggle. **My title researcher Estela works in Spanish for half her files.** If I wanted to put her on this account, I couldn't. The product is monolingual. I checked the codebase via the trial sandbox — there's no `i18n` library wired in, no locale switch in settings, no Spanish strings anywhere. Building bilingual into a New Mexico product after the fact is two quarters of work; building it in from day one is two weeks. AcreOS has done neither.

**7:30 AM.** I look at `/parcels`. I pull up an 80-acre piece I'm tracking on the Tierra Amarilla grant in Rio Arriba County. The parcel data comes back from… somewhere. Not Rio Arriba County GIS, because I checked the parcel-source registry — `server/services/parcel.ts` lists exactly one New Mexico county wired up: **Bernalillo**. Bernalillo is Albuquerque. It is not where land investing happens in this state. Where it happens — Rio Arriba, San Miguel, Mora, Taos, Sandoval, Colfax, Santa Fe County rural — none of those have a parcel source registered. The fallback layer presumably uses Regrid or another national aggregator, which is fine for the APN and the polygon, but Regrid does not carry **the Spanish land grant overlay** that every clouded-title parcel up here needs. There's no field anywhere in `parcels` for "lies within or partially within a Spanish/Mexican land grant" — and that is the single most important due-diligence flag for half my book.

**8:30 AM.** I pull up `/parcels/:id` and look for a water-rights field. There is one. Sort of. The `EnvironmentalIntelligenceCard` component pulls from `/api/environmental/water-rights/NM` and returns a doctrine string — "prior_appropriation" — and a sentence about transferability. **That is correct in the broadest sense and useless in every operational sense.** What I need on a New Mexico parcel:

- Acequia association membership (yes/no, which acequia, what's the parciante share in fanegas or in flat-rate days)
- Office of the State Engineer (OSE) water-right file number, if the parcel is severed from any acequia and has its own permitted right
- Priority date — first in time, first in right; a 1746 priority date is gold, a 1973 priority date may not even get water in a drought year
- Beneficial use type (irrigation, stock, domestic) — a stock-only right is worth 10% of an irrigation right per acre
- Whether the right has been **abandoned** under the Office of the State Engineer's "use it or lose it" four-year rule
- For the acequia parcels: is the buyer required to attend annual meetings, perform `la limpia` (annual ditch cleaning) or pay in lieu, and follow the mayordomo's rotation schedule?

None of that exists anywhere in AcreOS. If I close on a parcel and miss that the seller forfeited his acequia membership for skipping three consecutive `limpias`, I have bought 40 acres of high-desert dust. The previous owner can't sell me a right he no longer has. AcreOS's title-search flow doesn't know to flag that, because acequia membership is not in any of the typical title-insurance-search databases — it lives in the acequia's own ledger book, often handwritten, kept by the mayordomo at his kitchen table.

**9:45 AM.** I look at `/title-search`. The mock returns a "chain of title" array with owners and date ranges. **Northern New Mexico chains of title don't fit this shape.** A typical chain on a parcel I'm working in Mora County:

```
1715  Spanish Crown grant to Comunidad de las Trampas (Las Trampas Land Grant)
1832  Mexican governor reconfirms allotments
1851  U.S. Treaty of Guadalupe Hidalgo notional confirmation (no surveying)
1879  U.S. Surveyor General partial confirmation
1903  U.S. Court of Private Land Claims partial rejection of common lands
1907  Severance: house lot to Sandoval; common lands enter U.S. public domain
1923  Tax sale — clouded
1947  Quiet title action — partial cure
1971  Subdivision split (pre-Subdivision Act)
2003  Inheritance, no probate filed for 22 years
2024  Heirship affidavit — 17 heirs, two refusing to sign
```

That is not "chain of title" the way `client/src/pages/title-search.tsx` models it. The `chainOfTitle` field is `Array<{ owner: string; from: string; to?: string }>` — a flat list of warranted transfers. Real northern NM chains have **regime breaks** (Spanish → Mexican → U.S. territorial → U.S. statehood), **partial confirmations** that leave half the parcel adjudicated and half not, **tax-sale clouds** that were never cured, **heirship complexities** because Spanish/Mexican law of forced succession (legítima) treated children differently than common-law primogeniture, and **community-land remnants** that nobody's resolved. A chain-of-title viewer that doesn't model regime breaks and partial confirmations is not a New Mexico chain-of-title viewer.

What Estela actually does on a clouded grant: she pulls the original Spanish-language merced from the New Mexico Archives, traces the Mexican confirmation, finds the Court of Private Land Claims docket from 1898, walks the U.S. Bureau of Land Management's confirmation map, and then back-walks every probate from 1907 forward. **That's a 30-hour title search**, and AcreOS quotes it as an instant "title clear: yes/no" lookup. Whoever built `routes-title-search` has not bought land in this state.

**11:00 AM.** I look at `/compliance` and the `regulatoryRequirements` schema. State, county, requirement type — good shape. I check what's seeded for NM. Nothing useful. The schema knows about "disclosure | filing | recording | escrow | licensing" — **it does not know about the NM Subdivision Act, which is a separate beast.** The Act regulates subdivisions of *five or more parcels* but kicks in earlier (Type 1 = 100+, Type 2 = 25-99, Type 3 = 5-24, Type 4 = 5+ residential, Type 5 = 5+ where any parcel is under 10 acres). **Splitting a 40-acre parcel into four 10s is technically not a subdivision** — but if I add a fifth split, or if any lot is under 10 acres, or if I "represent" any utility/access/water that's not perfected, **I'm a subdivider** and the AG's office can block recording until I file a disclosure statement, post a financial assurance, and submit to county review.

The product doesn't know any of this. The `complianceRules.triggers` schema has `acreageMin/Max` and `transactionType` — those fields could carry the Subdivision Act logic. They don't. There's no NM rule in the seed data. I checked.

**12:30 PM.** I open `/blind-offer-wizard` to send out a batch of letters to absentees in Mora County. The letters generate in English. **About 35% of the absentee owners I'm writing to are Spanish-speaking elders or their heirs — many in Albuquerque, El Paso, Denver, sometimes Mexico City.** The English-only letter goes in the trash. I'd want a per-recipient language flag on the lead record (Estela can populate it from the surname + last-known-address heuristic + whatever census tract data we have) and a Spanish template that's not a Google Translate of the English template — it has to be a real Spanish letter, with the cultural register that respects an 80-year-old viuda who inherited the grant share from her father. That's a translation a human writer in Santa Fe needs to do, not a GPT-4 paraphrase. The product has neither the field nor the template.

**2:00 PM.** I'm trying to put a parcel under contract in San Miguel County. I want to use AcreOS's purchase-contract template. **There isn't one for NM specifically.** The state document config (`server/services/stateDocumentConfig.ts:260`) lists New Mexico with deed type, lien instrument, recording fee, and a one-line note ("Community property state — both spouses must sign if property is community property"). Useful, true, and minuscule. What's missing for an NM purchase contract:

- Spanish-language disclosure block (NMSA §47-13-2 — required if buyer or seller's primary language is Spanish)
- Acequia membership transfer disclosure (must explicitly transfer or reserve parciante share — silence creates litigation)
- Water-rights warranty language (does seller convey OSE-permitted rights, acequia rights, both, neither, or are they severed?)
- Mineral-rights conveyance election (NM is a heavy oil/gas state in the southeast; in the north it's mostly geothermal and uranium legacy, but the warranty language still matters)
- Spanish/Mexican land-grant disclosure ("Buyer is hereby notified that this parcel lies within or adjacent to the [Tierra Amarilla / Las Trampas / etc.] Land Grant and may be subject to communal claims that have not been adjudicated.")
- Pueblo proximity disclosure when the parcel is within a stated radius of a Pueblo boundary

A New Mexico purchase contract that doesn't include those clauses is a malpractice instrument. AcreOS's "offer letter" wizard generates a generic LOI and routes it to e-sign. That's not a contract a New Mexico title company will accept.

**3:30 PM.** I check `/compliance` for assignment-of-contract guidance. Per the deeper-team master findings (`_MASTER-FINDINGS.md` P1-31), AcreOS is shipping a wholesaler-license warning for IL/OK/SC. **NM is not on that list, and it should be.** New Mexico Real Estate Commission Rule 16.61.18 NMAC, combined with §61-29-2 NMSA, treats "assignment of real-estate contracts as a regular course of business" as licensable activity. The "regularity and continuity" test is the trap — one assignment is generally fine, but anyone doing this monthly without a license is committing a Class B misdemeanor and the NMREC has been actively pursuing complaints since 2022 (see also Comm. v. Vargas, 2023). I would never assign a contract in this state without a broker's license — but a 22-year-old wholesaler from Phoenix who bought AcreOS Scale yesterday and is targeting Bernalillo County tax-delinquent files **will assume the platform's silence means it's legal**. It isn't. Add NM to the warning list.

**4:00 PM.** I look at `/field-scout`. **Best surface in the product for me, for reasons AcreOS may not have intended.** Eighty percent of the parcels I work are in canyons or behind mesas with no cellular coverage. The offline-sync architecture is right. What I'd add for northern NM specifically:

- A photo template that includes acequia ditch path, headgate condition, parciante stake markers, and adjacent neighbors' fence line (pasture-fence law in NM is fence-out, not fence-in — it matters)
- A mojonera (boundary-monument) inspection step — old grant parcels are often surveyed to physical stone or piñon-tree mojoneras, and a missing or rotten mojonera is a re-survey trigger
- A road-class field — NM rural parcels are accessed by USFS roads, BLM roads, county-maintained dirt, or "prescriptive easement across someone's pasture, hope they like you." That fourth category is half my access disputes.
- A photo step for any visible Pueblo-boundary signage or witness stones

Field-scout is the surface that's closest to what I do daily. With a state-aware template library, it would be the reason I keep this app on my phone.

**5:00 PM.** I look at `/onboarding-v2`. There's an "Expert tip" line that mentions "TX, AZ, NM, or CO" as recommended starter states (`onboarding-v2.tsx:1252`). **That is reckless.** Recommending New Mexico to a beginner without an explicit "this state has unique title and water-rights complexity — partner with a local title researcher" warning is going to onboard people into a state where their first deal becomes a quiet-title lawsuit. Either remove NM from the beginner-friendly list, or wrap it in a real warning. I'd remove it.

---

## 3. Per-surface friction

**`/today`** — Monolingual. No NM-specific signal. The Pulse score and the daily widgets work fine, but they don't know I work in a state where my morning starts with "did the OSE post the new transfer-permit ruling overnight" or "did the acequia mayordomo email about ditch cleaning."

**`/parcels` + `/parcels/:id`** — Bernalillo is the only NM county wired into `parcel.ts`. Rio Arriba, San Miguel, Mora, Taos, Sandoval, Colfax — all unwired. The fallback to Regrid will get me a polygon and an APN but not the grant overlay, the acequia membership, the OSE file number, the priority date, the Pueblo-proximity flag, or the heirship status. The eight or nine fields that **define** a New Mexico land deal are all absent.

**`/title-search`** — `chainOfTitle` is modeled as a flat list of warranted transfers. NM chains have regime breaks, partial confirmations, communal-land remnants, and tax-sale clouds that don't fit. The "title clear: yes/no" output is a category error — most NM titles are "clear with caveats," and the caveats are the deal.

**`/compliance` + `regulatoryRequirements`** — Schema is right shape. NM seed data is empty. The Subdivision Act, the §47-13-2 Spanish disclosure, the Real Estate Commission license rule for repeat assignments, the OSE water-transfer permit requirement — none seeded.

**`/state-documents`** — One-line entry for NM. Says "no transfer tax" (true) and "general warranty deed standard" (true). Doesn't carry the community-property spousal-consent variant for community vs separate property, doesn't carry the Spanish-language disclosure trigger, doesn't carry the acequia transfer requirement, doesn't carry the unique notary acknowledgment that NM uses for community-property conveyances.

**`/blind-offer-wizard`** — English only. No language flag on lead. Letters going to Spanish-speaking heirs of grant lands hit the trash.

**`/field-scout`** — Best surface. State-aware template library would make it the reason to keep AcreOS installed. Mojonera inspection, ditch-path photo, road-class field, Pueblo-boundary signage step.

**`/inbox`** — English-only routing. Estela's bilingual response drafts can't be templated. SMS to Spanish-speaking owners in NMSA-compliant register isn't a feature.

**`/pax`** — Pax doesn't know what acequia is. Asking it "summarize this parcel's water situation" returns generic prior-appropriation boilerplate. The model has the world knowledge; it hasn't been prompted to surface NM-specific concerns.

**`/onboarding-v2`** — Recommends NM to beginners without warning. Should either remove NM from the list or wrap in an explicit advisory.

**`/compliance` (Subdivision Act)** — The Act is invisible. Splitting four parcels is fine; splitting five (or any with a sub-10-acre child lot) triggers AG-level review. The product doesn't know.

**`/sign-document` + `/documents`** — No bilingual signing flow. NM courts have voided signed instruments where Spanish-speaking signers were given English-only documents. The HMAC public-signing infra would need a per-signer language preference and a Spanish version of every consent screen.

---

## 4. The five things that would make this a real New Mexico product

1. **Spanish/Mexican land-grant overlay on `/parcels/:id`.** A boolean `liesInLandGrant` + grant name + Court of Private Land Claims docket number + adjudication status (confirmed / partially confirmed / rejected / unconfirmed). Source data exists at the BLM and the New Mexico State Land Office; ingesting it is a one-quarter project. This is the single highest-leverage NM feature: it's the flag that tells me "this parcel needs Estela for 30 hours, not 3."

2. **Acequia membership and water-rights data model.** First-class fields on the parcel: acequia association name, parciante share, OSE file number, priority date, beneficial-use type, abandonment risk flag. Without these, "title search" in northern NM is theatre.

3. **Bilingual end-to-end.** Per-user language preference, per-lead language preference, Spanish templates for the offer-letter wizard, Spanish purchase-contract templates, Spanish closing disclosures, Spanish e-sign consent screens. Two quarters of work if started now; six quarters if bolted on later.

4. **NM Subdivision Act guardrails.** When a user is splitting a parcel, ask the questions that determine Act applicability: how many parcels, smallest child-lot acreage, any marketing representations about utilities/water/road, any infrastructure to be installed. If any of the Type 1-5 thresholds trip, surface the requirements and disclosure obligations before recording. This is the same pattern as the IL/OK/SC wholesale-license warning, just for subdivision.

5. **NM assignment-of-contract license warning.** Add NM to the `state ∈ {IL, OK, SC, …}` list in the assignment-template generator. The legal posture is similar enough to warrant the same treatment, and a 22-year-old buying AcreOS Scale doesn't know NM Real Estate Commission Rule 16.61.18 NMAC exists.

---

## 5. Three things that are surprisingly useful, even in northern NM

1. **Field-scout offline-first architecture.** Genuinely good. The cellular-dead-zone reality of my counties is exactly the use case this was built for, even if it wasn't built with me in mind.

2. **The state-aware deed and lien-instrument config.** What's in `stateDocumentConfig.ts:260` for NM is correct as far as it goes. Community-property spousal-consent flag is real and matters. Deed-of-trust preference for seller financing is real. The bones of state-aware document generation exist; just need the NM-specific flesh.

3. **The `regulatoryRequirements` schema.** The shape is right. State + county + requirement-type + transaction-types + required-documents — that's the table where the Subdivision Act, the Spanish disclosure, the OSE transfer permit, and the Pueblo proximity advisory should all live. Schema first, data second; AcreOS got the harder part right.

---

## 6. The honest verdict

AcreOS is a competent national land-flipping product that has not yet met New Mexico. The product's silence on Spanish/Mexican land grants, acequias, Pueblo borders, the Subdivision Act, the assignment-license rule, and bilingual disclosures is not malice — it's distance. Whoever wrote the state-config table read a Wikipedia summary of NM real-estate law and stopped there. That's enough to ship into Bernalillo County (Albuquerque suburbia, mostly post-1907 chains, mostly English-speaking, mostly unclouded). It is not enough to ship into the rest of the state, which is **where the deal volume actually is** for a small operator like me.

Don't sell AcreOS to a New Mexico Land Investor as a turnkey product. Sell it to an operator who already has an Estela and a relationship with a local title company and is using AcreOS as the **acquisition CRM and field workstation** while everything north of "under contract" stays manual. That's a $20-49/mo product for me — a complement to my existing workflow, not a replacement.

The path to a real NM product is two quarters: bilingual end-to-end, the grant overlay, the acequia data model, the Subdivision Act guardrail, and the assignment warning. Those five together turn AcreOS from "Texas product with NM in a dropdown" into "the only software that takes northern NM seriously." Nobody else is doing it. The TAM is small (maybe 800 active operators across NM, CO mountain counties, and northern AZ where the cultural overlay is similar) but the loyalty is total — once you have me, you have my whole REIA chapter.

Two quarters. Or stay polite about NM and let me keep paying REI Pro.

— Vivienne
