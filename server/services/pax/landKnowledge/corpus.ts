// ============================================================================
// SERVER/SERVICES/PAX/LANDKNOWLEDGE/CORPUS.TS
// ----------------------------------------------------------------------------
// Andrei (Tahoe elevation idea #5) — curated, CITED land-investing knowledge
// corpus. ~60 short, mechanics-first cards covering the land DOMAIN knowledge
// Pax is otherwise generic on: FEMA flood-zone semantics, USDA SSURGO/soil
// meanings for septic & perc, seller-finance / note / usury mechanics, and the
// classic diligence traps (landlocked / no legal access, back-taxes, easement-
// only access, mineral severance, etc.).
//
// WHY this is DISTINCT from parcel-fact retrieval
// ───────────────────────────────────────────────
// The DataSourceBroker + research_property tools retrieve PARCEL-SPECIFIC facts
// ("this parcel is in Zone AE"). This corpus retrieves GENERAL land knowledge
// ("what Zone AE means for building"). The grounding contract (see prompt.ts)
// keeps these strictly separated: a card's general statement must NEVER be
// blended into a parcel-specific assertion, and every explanatory claim sourced
// from a card must cite that card.
//
// TRUTH-ENGINE DISCIPLINE
// ───────────────────────
// Every card is mechanics-first and sourced. `citation` names the authority
// (FEMA / USDA-NRCS / state statute / IRS / standard practice) so Pax can
// attribute the claim. Cards deliberately avoid jurisdiction-specific numbers
// that vary by county; where a number is cited (e.g. a usury cap) the card
// flags that it is state-specific and must be locally verified. Cards never
// give legal or investment advice — they explain a mechanism and point the
// reader at the authority of record.
//
// STORAGE
// ───────
// Cards are embedded via the Voyage client and stored in the existing generic
// pgvector registry (solene_embedded_records) under namespace
// LAND_KNOWLEDGE_NAMESPACE with organization_id = NULL (team-shared / global
// corpus, identical for every tenant). See ingest.ts + retrieval.ts.
// ============================================================================

/**
 * The pgvector namespace these cards live under in solene_embedded_records.
 * NULL organization_id (global corpus). Kept here so ingest + retrieval +
 * tests share one constant.
 */
export const LAND_KNOWLEDGE_NAMESPACE = "land_knowledge";

/** Corpus version — bump when cards are added/edited so re-ingest is detectable. */
export const LAND_KNOWLEDGE_CORPUS_VERSION = "lk-v1";

/**
 * A single land-knowledge card.
 *
 *  - id            stable slug; also the source_ref in pgvector.
 *  - topic         coarse grouping for retrieval diagnostics + recall eval.
 *  - title         human-readable headline (embedded + surfaced).
 *  - body          mechanics-first explanation. ≤ ~700 chars to keep the
 *                  retrieved block token-cheap on the hot Pax path.
 *  - citation      the authority of record Pax must cite when using this card.
 *  - tags          retrieval aids (lowercase keywords); embedded alongside body.
 */
export interface LandKnowledgeCard {
  id: string;
  topic: LandKnowledgeTopic;
  title: string;
  body: string;
  citation: string;
  tags: string[];
}

export type LandKnowledgeTopic =
  | "flood"
  | "soil"
  | "access"
  | "title"
  | "seller_finance"
  | "zoning"
  | "water"
  | "mineral"
  | "tax"
  | "survey"
  | "utilities"
  | "diligence";

/**
 * The text that actually gets embedded for a card. Concatenates title + tags +
 * body so a query like "septic perc test" matches a card whose body discusses
 * percolation even if the literal title doesn't. Exported for the ingest path
 * and the recall eval (both must embed identically).
 */
export function cardEmbeddingText(card: LandKnowledgeCard): string {
  return `${card.title}\n${card.tags.join(", ")}\n${card.body}`;
}

// ----------------------------------------------------------------------------
// The corpus.
// ----------------------------------------------------------------------------

export const LAND_KNOWLEDGE_CARDS: ReadonlyArray<LandKnowledgeCard> = [
  // ── FEMA flood zones ──────────────────────────────────────────────────────
  {
    id: "flood-zone-ae",
    topic: "flood",
    title: "FEMA Zone AE — a high-risk flood area with a known base flood elevation",
    body:
      "Zone AE is a Special Flood Hazard Area (SFHA): a 1%-annual-chance (\"100-year\") floodplain for which FEMA has published a Base Flood Elevation (BFE). In an SFHA, federally backed mortgages require flood insurance, and most counties require new habitable structures' lowest floor to be at or above the BFE (often plus a freeboard margin). It constrains where and how high you can build, not whether the land has value. The controlling document is the parcel's FEMA Flood Insurance Rate Map (FIRM) panel.",
    citation: "FEMA, National Flood Insurance Program — Flood Zone definitions & FIRM panels",
    tags: ["zone ae", "sfha", "base flood elevation", "bfe", "100-year floodplain", "flood insurance", "firm", "build"],
  },
  {
    id: "flood-zone-a",
    topic: "flood",
    title: "FEMA Zone A — high-risk floodplain with NO published base flood elevation",
    body:
      "Zone A is a 1%-annual-chance floodplain where FEMA has NOT determined a Base Flood Elevation. It carries the same SFHA insurance and elevation obligations as Zone AE, but because there is no published BFE, the builder typically must establish one via an engineering study or use the community's best-available data before permitting. Practically, Zone A often means an extra survey/engineering cost to determine buildable elevation.",
    citation: "FEMA, National Flood Insurance Program — Zone A (approximate) definition",
    tags: ["zone a", "no bfe", "approximate floodplain", "sfha", "engineering study", "elevation certificate"],
  },
  {
    id: "flood-zone-x",
    topic: "flood",
    title: "FEMA Zone X — outside the high-risk floodplain (moderate-to-minimal risk)",
    body:
      "Zone X covers areas outside the 1%-annual-chance floodplain. \"Shaded X\" denotes the 0.2%-annual-chance (\"500-year\") floodplain or areas of reduced 1% risk; \"unshaded X\" denotes minimal risk. Flood insurance is not federally mandated in Zone X, though lenders may still require it and risk is never zero. Zone X is generally the least flood-constrained for building, but the parcel's own FIRM panel is the authority — flooding can still occur outside mapped zones.",
    citation: "FEMA, National Flood Insurance Program — Zone X definition",
    tags: ["zone x", "shaded x", "500-year", "minimal risk", "outside floodplain", "no mandatory insurance"],
  },
  {
    id: "flood-zone-ve",
    topic: "flood",
    title: "FEMA Zone VE / V — coastal high-hazard zone with wave action",
    body:
      "Zone VE (and V) is a coastal SFHA subject to high-velocity wave action (≥3 ft waves) during the base flood. Construction rules are stricter than AE: structures generally must be elevated on open pilings/columns with the lowest horizontal member at or above the BFE, with breakaway walls below and no fill used for structural support. VE building costs are materially higher, and insurance is mandatory for federally backed loans.",
    citation: "FEMA, National Flood Insurance Program — Coastal V Zone construction standards",
    tags: ["zone ve", "v zone", "coastal", "wave action", "pilings", "breakaway walls", "high hazard"],
  },
  {
    id: "flood-letter-of-map-change",
    topic: "flood",
    title: "LOMA / LOMR — how a parcel can be removed from a mapped flood zone",
    body:
      "If a parcel (or structure) sits above the floodplain despite being inside the mapped SFHA, the owner can petition FEMA for a Letter of Map Amendment (LOMA) using an elevation certificate, or a Letter of Map Revision (LOMR) when fill or physical changes alter the floodplain. A granted LOMA/LOMR can remove the mandatory-insurance requirement. This is a recognized path to correct a mapping error — not a guarantee of approval.",
    citation: "FEMA — Letter of Map Change (LOMA/LOMR) process",
    tags: ["loma", "lomr", "map amendment", "elevation certificate", "remove from floodplain", "letter of map change"],
  },

  // ── USDA soils / SSURGO ───────────────────────────────────────────────────
  {
    id: "soil-ssurgo-overview",
    topic: "soil",
    title: "USDA SSURGO — the soil survey behind perc, septic, and farmability questions",
    body:
      "SSURGO (Soil Survey Geographic Database) is USDA-NRCS's detailed county soil mapping. For each map unit it publishes interpretations: depth to water table, drainage class, hydric status, slope, and septic/dwelling/agriculture suitability ratings. SSURGO is a planning-grade screen, not a substitute for an on-site soil/perc test — county health departments require an actual field test for septic permitting. Use SSURGO to flag likely problems early.",
    citation: "USDA-NRCS, Soil Survey Geographic Database (SSURGO) / Web Soil Survey",
    tags: ["ssurgo", "soil survey", "web soil survey", "nrcs", "drainage class", "septic suitability", "perc"],
  },
  {
    id: "soil-capability-class",
    topic: "soil",
    title: "Land Capability Class (I–VIII) — what the Roman numeral means",
    body:
      "USDA's Land Capability Classification rates soils I–VIII by limitations for cultivation. Classes I–IV can support cultivated crops with increasing management/limitations; classes V–VIII are generally unsuited to cultivation and better for pasture, range, woodland, or wildlife. A subclass letter flags the dominant limitation: 'e' = erosion, 'w' = wetness/drainage, 's' = shallow/rocky/droughty root zone, 'c' = climate. So 'IIe' = good cropland with an erosion limitation.",
    citation: "USDA-NRCS, Land Capability Classification (Agriculture Handbook 210)",
    tags: ["land capability class", "capability subclass", "iie", "erosion", "wetness", "cropland", "roman numeral"],
  },
  {
    id: "soil-perc-test",
    topic: "soil",
    title: "Percolation (perc) test — the gate for a conventional septic system",
    body:
      "A perc test measures how fast water drains through the soil at the proposed drainfield; it determines whether a conventional septic system is feasible and how large the drainfield must be. Soils that drain too slowly (heavy clay, high water table) or too fast (sand/gravel) can fail, forcing an engineered/alternative system or making the lot unbuildable for a residence on septic. A failed or absent perc is a top reason a rural lot can't be built on — verify before relying on septic.",
    citation: "Standard county health-department septic permitting practice; US EPA onsite wastewater guidance",
    tags: ["perc test", "percolation", "septic", "drainfield", "leach field", "water table", "clay", "buildable"],
  },
  {
    id: "soil-hydric-wetlands",
    topic: "soil",
    title: "Hydric soils & wetlands — a federal-permitting constraint, not just wet ground",
    body:
      "Hydric soils form under saturated, anaerobic conditions and are one of three indicators (with hydrology and hydrophytic vegetation) of a jurisdictional wetland. Wetlands are regulated under the federal Clean Water Act (Section 404, Army Corps of Engineers) and often state law: filling or grading them can require a permit and mitigation. A SSURGO hydric rating or a National Wetlands Inventory flag is a screen — a delineation by a qualified consultant determines the actual jurisdictional boundary.",
    citation: "US Army Corps of Engineers / EPA, Clean Water Act §404; USFWS National Wetlands Inventory",
    tags: ["hydric soil", "wetlands", "clean water act", "section 404", "army corps", "delineation", "nwi", "mitigation"],
  },
  {
    id: "soil-prime-farmland",
    topic: "soil",
    title: "Prime farmland & ag designations — value and possible development friction",
    body:
      "USDA designates certain soils as 'prime farmland' or 'farmland of statewide importance' based on productivity. The label raises agricultural value but can also trigger review under state farmland-preservation programs or local right-to-farm and ag-zoning rules, which may limit subdivision or non-farm development. It is informational for an investor: a positive for farm use, a possible friction point for development. Confirm local ag-protection rules.",
    citation: "USDA-NRCS, Prime and Important Farmlands definitions (7 CFR Part 657)",
    tags: ["prime farmland", "statewide importance", "ag zoning", "farmland preservation", "right to farm", "subdivision"],
  },

  // ── Access / legal access ─────────────────────────────────────────────────
  {
    id: "access-landlocked",
    topic: "access",
    title: "Landlocked parcel — no legal access is a value-killer, not a detail",
    body:
      "A parcel is 'landlocked' when it has no legal right of access to a public road — it is surrounded by land owned by others with no recorded easement crossing them. Physically driving across a neighbor's field is not legal access. Without legal access a lot is usually unbuildable, unfinanceable, and very hard to resell. Remedies (a negotiated easement, or in some states an 'easement by necessity' lawsuit) are slow, costly, and uncertain. Always confirm recorded legal access before buying.",
    citation: "Common-law property doctrine (easement by necessity); standard title-examination practice",
    tags: ["landlocked", "legal access", "no access", "easement by necessity", "public road", "unbuildable", "right of access"],
  },
  {
    id: "access-easement-appurtenant",
    topic: "access",
    title: "Easement appurtenant — a recorded right to cross another's land",
    body:
      "An easement appurtenant grants the owner of one parcel (the 'dominant estate') a right to use part of an adjacent parcel (the 'servient estate'), e.g. an access driveway. It runs with the land — it transfers automatically to future owners — when properly recorded. The key diligence questions: is it recorded in the chain of title, what exactly does it permit (access only? utilities too?), and is its location defined? An unrecorded or vague easement is a real risk.",
    citation: "Standard real-property easement law; county recorder / title commitment as the record",
    tags: ["easement appurtenant", "dominant estate", "servient estate", "recorded easement", "runs with the land", "driveway"],
  },
  {
    id: "access-prescriptive-easement",
    topic: "access",
    title: "Prescriptive easement — access by long use, but unrecorded and contestable",
    body:
      "A prescriptive easement can arise when someone uses another's land openly, continuously, and without permission for a statutory period (varies by state). It is the access analog of adverse possession. The catch for an investor: it is generally NOT recorded, so it does not show on a title commitment and a court action is usually required to establish or defend it. Relying on a 'we've always used that road' claim without a recorded easement is risky.",
    citation: "State-specific prescriptive-easement statutes and case law",
    tags: ["prescriptive easement", "adverse use", "unrecorded access", "always used the road", "quiet title", "statutory period"],
  },
  {
    id: "access-frontage-flag-lot",
    topic: "access",
    title: "Road frontage & flag lots — frontage minimums can block a build or split",
    body:
      "Many zoning codes require a minimum amount of public-road frontage for a lot to be buildable or to be subdivided. A parcel with little or no frontage may need a variance, a 'flag lot' configuration (a narrow access strip to a public road), or a recorded access easement. Insufficient frontage is a common reason a seemingly fine parcel can't get a building permit or be split as the buyer assumed. Confirm the local frontage minimum.",
    citation: "Local zoning/subdivision ordinance (frontage minimums vary by jurisdiction)",
    tags: ["road frontage", "flag lot", "frontage minimum", "variance", "subdivide", "buildable lot", "access strip"],
  },

  // ── Title / ownership ─────────────────────────────────────────────────────
  {
    id: "title-commitment",
    topic: "title",
    title: "Title commitment — the document that tells you what you're actually buying",
    body:
      "A title commitment (preliminary title report) is the title company's promise to insure, listing what it found: the vested owner, the legal description, and exceptions — liens, easements, mineral reservations, CC&Rs, and requirements to clear before closing. The investor's job is to read Schedule B exceptions, because the policy will NOT cover them. Many land surprises (an easement across the building site, a mineral reservation, an old judgment lien) are sitting in plain sight in the commitment.",
    citation: "Standard ALTA title-commitment practice (Schedule A vested owner; Schedule B exceptions)",
    tags: ["title commitment", "preliminary title report", "schedule b", "exceptions", "title insurance", "alta", "liens"],
  },
  {
    id: "title-quiet-title",
    topic: "title",
    title: "Quiet title action — clearing a clouded title through the court",
    body:
      "A quiet-title lawsuit asks a court to resolve competing or unclear claims to a property and declare clean ownership. Investors encounter it when a parcel has a 'cloud' — a missing heir, an old unreleased lien, a tax-deed chain, or a boundary dispute — that a title company won't insure over. It can cure a title but is time-consuming and costs legal fees; price and timeline that in if a deal depends on quieting title (common with tax-deed purchases).",
    citation: "State civil-procedure quiet-title statutes",
    tags: ["quiet title", "cloud on title", "tax deed", "missing heir", "marketable title", "lawsuit", "insurable"],
  },
  {
    id: "title-tax-deed-vs-lien",
    topic: "tax",
    title: "Tax lien vs. tax deed — two very different things you can buy at a tax sale",
    body:
      "A tax-lien certificate is a claim against a property for unpaid taxes; you earn interest and the owner can usually redeem by paying it off within a redemption period — you may never get the land. A tax deed conveys the property itself after the taxing authority forecloses, but title is often uninsurable until quieted and may be subject to a redemption window or surviving liens. They are different instruments with different risk profiles — know which your state and sale uses before bidding.",
    citation: "State tax-sale statutes (tax-lien certificate vs. tax-deed states)",
    tags: ["tax lien", "tax deed", "tax sale", "redemption period", "tax certificate", "foreclosure", "uninsurable title"],
  },
  {
    id: "tax-back-taxes",
    topic: "tax",
    title: "Back taxes & delinquent assessments — they attach to the land, not the seller",
    body:
      "Unpaid property taxes and special assessments are a lien on the parcel that generally survives a sale and must be paid to deliver clear title; they travel with the land, not the prior owner. Title companies pull a tax certificate at closing to catch them. Beyond ad valorem taxes, watch for special assessments (paving, water/sewer districts, drainage) and back HOA/POA dues, which can also be liens. Always reconcile the full tax + assessment picture before closing.",
    citation: "State property-tax lien statutes; title-company tax certificate at closing",
    tags: ["back taxes", "delinquent taxes", "tax lien", "special assessment", "hoa dues", "lien survives sale", "tax certificate"],
  },

  // ── Seller financing / notes / usury ──────────────────────────────────────
  {
    id: "sf-note-and-security",
    topic: "seller_finance",
    title: "Seller-financed note — the promissory note vs. the security instrument",
    body:
      "Seller financing splits into two documents: a promissory note (the borrower's promise to pay — principal, interest rate, term, payment) and a security instrument (a mortgage or deed of trust) that pledges the land as collateral and lets the seller foreclose on default. The note is the debt; the security instrument is the remedy. Both must be drafted and recorded correctly — a note with no recorded security instrument leaves the seller an unsecured creditor.",
    citation: "Standard seller-financing practice (promissory note + mortgage/deed of trust)",
    tags: ["seller financing", "promissory note", "deed of trust", "mortgage", "security instrument", "owner financing", "collateral"],
  },
  {
    id: "sf-contract-for-deed",
    topic: "seller_finance",
    title: "Contract for deed (land contract) — buyer doesn't get the deed until paid off",
    body:
      "In a contract for deed (a.k.a. land contract / installment land contract), the seller keeps legal title and the buyer takes possession and makes installment payments, receiving the deed only after the final payment. It's common in low-dollar land. The tradeoffs: it's simpler/cheaper to set up than a note-and-deed-of-trust, but buyer protections on default vary widely by state (some require foreclosure-like process, some allow faster forfeiture), and the buyer holds only equitable, not legal, title meanwhile.",
    citation: "State installment-land-contract statutes (forfeiture vs. foreclosure remedies vary)",
    tags: ["contract for deed", "land contract", "installment contract", "equitable title", "forfeiture", "owner financing", "deed at payoff"],
  },
  {
    id: "sf-usury-cap",
    topic: "seller_finance",
    title: "Usury caps — the legal ceiling on the interest rate you can charge",
    body:
      "Usury laws set a maximum legal interest rate; charging above it can void the interest, trigger penalties, or worse, and the cap is STATE-SPECIFIC (and sometimes differs for individuals vs. licensed lenders, or has carve-outs for seller financing). There is no single national number — a rate that's fine in one state is illegal in another. Treat any specific cap as something to verify against the current statute of the state where the land sits before setting a seller-finance rate.",
    citation: "State usury statutes (caps and exemptions vary by state; verify locally)",
    tags: ["usury", "interest rate cap", "maximum interest", "legal rate", "seller finance rate", "state-specific", "exemption"],
  },
  {
    id: "sf-dodd-frank-safe-act",
    topic: "seller_finance",
    title: "Dodd-Frank / SAFE Act limits on seller-financing owner-occupied homes",
    body:
      "Federal rules (the Dodd-Frank Act and the SAFE Act, via the CFPB) restrict seller financing when the property is a DWELLING the buyer will occupy: depending on volume, the seller may need a mortgage-loan-originator license and the loan must meet ability-to-repay and other rules. RAW LAND with no dwelling is generally outside these consumer-mortgage rules, which is one reason vacant-land seller financing is simpler. If a home is involved, confirm the federal limits and any state analog.",
    citation: "Dodd-Frank Act / SAFE Act; CFPB seller-financer exclusions (12 CFR 1026)",
    tags: ["dodd-frank", "safe act", "cfpb", "loan originator", "ability to repay", "owner-occupied", "raw land exemption"],
  },
  {
    id: "sf-amortization-balloon",
    topic: "seller_finance",
    title: "Amortization, balloon, and APR — what actually drives a note's economics",
    body:
      "A note's monthly payment is set by principal, interest rate, and amortization term. A 'balloon' shortens the actual payoff: the payment may be calculated on a 30-year amortization but the full remaining balance comes due at, say, year 5 — useful to limit the seller's exposure but a refinance risk for the buyer. Longer amortization lowers the payment but raises total interest paid. Model the schedule (the calculate_amortization tool does this) before agreeing to terms.",
    citation: "Standard amortization mathematics; Truth-in-Lending APR concept (Regulation Z) for consumer loans",
    tags: ["amortization", "balloon payment", "apr", "interest", "term", "monthly payment", "refinance risk", "note terms"],
  },
  {
    id: "sf-down-payment-default",
    topic: "seller_finance",
    title: "Down payment & default remedies in seller financing",
    body:
      "A larger down payment lowers the seller's risk (more buyer equity, less incentive to walk) and is the main protection in low-documentation land deals. On default, the seller's remedy depends on the instrument: a deed of trust allows (often non-judicial) foreclosure; a mortgage usually requires judicial foreclosure; a contract for deed may allow forfeiture. Each has a different timeline and cost. Match the down payment and remedy to the risk and the state's process.",
    citation: "State foreclosure/forfeiture statutes (judicial vs. non-judicial vary by state)",
    tags: ["down payment", "default", "foreclosure", "non-judicial", "judicial", "forfeiture", "buyer equity", "remedy"],
  },

  // ── Zoning / land use ─────────────────────────────────────────────────────
  {
    id: "zoning-basics",
    topic: "zoning",
    title: "Zoning — what use is allowed, before you ever think about the building",
    body:
      "Zoning is the local government's rule for how a parcel may be used (residential, agricultural, commercial, industrial) plus dimensional limits (setbacks, minimum lot size, height, density). A use that isn't permitted requires a rezoning or a variance — neither guaranteed. The investor's first land-use question is always 'what does the current zoning permit, by right?' Check the zoning designation and the permitted-use table for that district with the county/municipal planning office.",
    citation: "Local zoning ordinance and zoning map (municipal/county planning authority)",
    tags: ["zoning", "permitted use", "setback", "minimum lot size", "variance", "rezoning", "land use", "by right"],
  },
  {
    id: "zoning-nonconforming-use",
    topic: "zoning",
    title: "Legal nonconforming use ('grandfathering') — lawful, but fragile",
    body:
      "A legal nonconforming use is a use that was lawful when established but no longer complies with current zoning; it's typically allowed to continue ('grandfathered') but usually cannot be expanded, and may be lost if abandoned for a set period or if a structure is substantially destroyed. Don't assume a current use can be enlarged or rebuilt freely just because it exists today — confirm the local nonconforming-use rules before pricing in that use.",
    citation: "Local zoning ordinance nonconforming-use provisions",
    tags: ["nonconforming use", "grandfathered", "legal nonconforming", "abandonment", "expansion", "rebuild", "zoning"],
  },
  {
    id: "zoning-subdivision-split",
    topic: "zoning",
    title: "Splitting / subdividing land — minimum lot size and platting rules govern",
    body:
      "Whether you can split a parcel into smaller saleable lots depends on the zoning district's minimum lot size, frontage requirements, access, and the local subdivision/platting process (which can require surveys, road/utility improvements, and government approval). A 'lot split' (a few parcels) is often simpler than a full 'subdivision' (a platted development). Many buyers overpay assuming a split is automatic — verify the minimum lot size and the platting threshold first.",
    citation: "Local subdivision ordinance and minimum-lot-size requirements",
    tags: ["subdivide", "lot split", "minimum lot size", "platting", "subdivision", "frontage", "parcel split"],
  },
  {
    id: "zoning-cc-and-r",
    topic: "zoning",
    title: "CC&Rs & HOA/POA — private deed restrictions that bind beyond zoning",
    body:
      "Covenants, Conditions & Restrictions (CC&Rs) are private, recorded deed restrictions — separate from public zoning — that can limit building size, materials, animals, mobile homes, short-term rentals, and more, and may be enforced by a homeowners'/property-owners' association with dues and liens. They run with the land and bind future owners. Read the recorded CC&Rs (they appear as a title exception): a parcel can be zoned for your use but privately restricted against it.",
    citation: "Recorded CC&Rs in the chain of title; state HOA/POA statutes",
    tags: ["cc&r", "covenants", "deed restriction", "hoa", "poa", "private restriction", "mobile home ban", "association dues"],
  },

  // ── Water rights ──────────────────────────────────────────────────────────
  {
    id: "water-rights-doctrines",
    topic: "water",
    title: "Water rights — riparian (East) vs. prior appropriation (West)",
    body:
      "How water rights attach to land splits roughly by region. Eastern states largely follow 'riparian' doctrine: rights to use water come with land touching the water, shared reasonably among owners. Western states largely follow 'prior appropriation': water rights are separate property granted by permit on a 'first in time, first in right' basis and can be lost by non-use ('use it or lose it'). In the West especially, a parcel's water right (or lack of one) can dominate its value — verify with the state water authority.",
    citation: "State water-law doctrines (riparian vs. prior appropriation); state water-rights agency",
    tags: ["water rights", "riparian", "prior appropriation", "first in time", "use it or lose it", "permit", "western water"],
  },
  {
    id: "water-well-groundwater",
    topic: "water",
    title: "Well & groundwater — the practical water question for a rural build",
    body:
      "A rural parcel without a public water hookup usually needs a well. Key diligence: is groundwater present and at what depth (drilling cost rises with depth and dry holes happen), what's the expected yield (gallons per minute) and quality, and does the state/county require a well permit and registration. SSURGO depth-to-water and neighboring well logs (often public via the state geological survey) are useful screens. A bad or absent water supply can make a residential lot impractical.",
    citation: "State well-permitting agency; state geological survey well-log records",
    tags: ["well", "groundwater", "well permit", "gpm", "yield", "water table", "dry hole", "rural water"],
  },

  // ── Mineral / surface rights ──────────────────────────────────────────────
  {
    id: "mineral-severance",
    topic: "mineral",
    title: "Severed mineral rights — you can own the surface but not what's under it",
    body:
      "Mineral rights (oil, gas, coal, hard minerals) can be legally 'severed' from the surface estate and owned separately, often by a prior owner who reserved them decades ago. A severed mineral owner generally has the right to access the surface to extract — which can mean wells, roads, or equipment on your land. Worse for development, the mineral estate is usually 'dominant' over the surface. A mineral reservation shows as a title exception; always check who owns the minerals before assuming quiet enjoyment.",
    citation: "Common-law severed-mineral-estate doctrine; title commitment mineral reservations",
    tags: ["mineral rights", "severed minerals", "surface rights", "dominant estate", "oil and gas", "reservation", "subsurface"],
  },
  {
    id: "mineral-dominant-estate",
    topic: "mineral",
    title: "Mineral estate is dominant — what that means for a surface owner",
    body:
      "Where minerals are severed, the mineral estate is typically 'dominant': the mineral owner (or their lessee) may make reasonable use of the surface to develop the minerals, even over the surface owner's objection, subject to accommodation doctrines that vary by state. For a land investor planning to build or farm, this is a real constraint — a surface-use agreement or a check of existing leases is prudent. Don't assume surface ownership gives total control of the parcel.",
    citation: "State oil-and-gas/mineral law (accommodation doctrine varies by state)",
    tags: ["dominant estate", "mineral owner", "surface use", "accommodation doctrine", "lease", "drilling", "severed estate"],
  },

  // ── Survey / boundaries ───────────────────────────────────────────────────
  {
    id: "survey-plss",
    topic: "survey",
    title: "PLSS legal descriptions — section, township, range (and why acreage is approximate)",
    body:
      "Most land outside the original colonies is described under the Public Land Survey System (PLSS): township and range grids divided into 1-square-mile sections (~640 acres), then quarter-quarters (~40 acres). An 'aliquot' description like 'the NE 1/4 of the SW 1/4' is a nominal 40 acres but the actual surveyed acreage often differs because sections aren't perfectly square. Treat PLSS acreage as approximate until a survey confirms it; pricing per-acre on the nominal figure can be off.",
    citation: "BLM, Public Land Survey System (PLSS) / Manual of Surveying Instructions",
    tags: ["plss", "section township range", "aliquot", "quarter quarter", "40 acres", "640 acres", "legal description", "acreage"],
  },
  {
    id: "survey-types",
    topic: "survey",
    title: "Boundary survey vs. ALTA survey — and when each matters",
    body:
      "A boundary survey locates the parcel's corners and lines on the ground and is the way to confirm true acreage and catch encroachments or a fence that isn't on the line. An ALTA/NSPS survey is a more detailed standard (often for commercial deals or title-insurance extended coverage) that also shows easements, improvements, and flood/zoning notes. For most raw-land buys a boundary survey resolves the 'what am I actually buying' question; order one when acreage, boundaries, or encroachment are in doubt.",
    citation: "ALTA/NSPS Land Title Survey standards; standard boundary-survey practice",
    tags: ["boundary survey", "alta survey", "encroachment", "corners", "acreage verification", "fence line", "nsps"],
  },
  {
    id: "survey-encroachment",
    topic: "survey",
    title: "Encroachments — a structure or use crossing the boundary line",
    body:
      "An encroachment is when an improvement (fence, shed, driveway, building eave) sits over the property line onto a neighbor's land or vice versa. Encroachments can cloud title, complicate financing, and occasionally ripen into adverse-possession or prescriptive-easement claims if long-standing. A current boundary survey is how they're found; a title commitment may except them. Resolve via agreement, a boundary-line adjustment, or removal before relying on the disputed area.",
    citation: "Standard survey/title practice; state adverse-possession statutes",
    tags: ["encroachment", "boundary line", "fence dispute", "adverse possession", "boundary adjustment", "survey", "property line"],
  },

  // ── Utilities / development cost ───────────────────────────────────────────
  {
    id: "utilities-availability",
    topic: "utilities",
    title: "Utility availability — 'at the road' is not the same as 'connected'",
    body:
      "For a buildable lot, confirm power, water, sewer/septic, and (optionally) gas/internet. 'Utilities available' often means lines run near the parcel, not that a connection exists or is cheap — line-extension and tap/impact fees can run into five figures, and distance to the nearest connection drives the cost. A truly off-grid parcel needs a well, septic, and power solution. Price the actual cost to make the lot buildable, not just the raw land.",
    citation: "Local utility providers and county permitting offices (extension/tap/impact fees vary)",
    tags: ["utilities", "power", "water", "sewer", "tap fee", "impact fee", "line extension", "off grid", "buildable cost"],
  },
  {
    id: "utilities-impact-fees",
    topic: "utilities",
    title: "Impact & tap fees — the permitting costs that turn raw land into a buildable lot",
    body:
      "Beyond utility hookups, building often triggers one-time fees: water/sewer tap fees, system-development or 'impact' fees (schools, roads, parks), and permit fees. They vary widely by jurisdiction and can materially change a project's economics on a low-cost parcel. They're knowable in advance — the local building/utility department publishes a fee schedule. Total them into the all-in cost before treating a cheap lot as a cheap build.",
    citation: "Local building-department and utility-district fee schedules",
    tags: ["impact fee", "tap fee", "system development charge", "permit fee", "building cost", "fee schedule", "raw land"],
  },

  // ── General diligence framing ─────────────────────────────────────────────
  {
    id: "diligence-buildability-checklist",
    topic: "diligence",
    title: "Buildability — the stacked conditions that all must be true",
    body:
      "Whether a parcel can be built on is a chain, not a single fact: legal road access, zoning that permits the use, adequate frontage/lot size, a water source (well or hookup), a sewage solution (sewer or a passing perc/septic), buildable ground outside wetlands and the floodway, and no fatal title or easement problem. Any one broken link can make a lot unbuildable. Treat 'buildable' as a checklist to verify, not an assumption — the cheap lots are often cheap because one link is broken.",
    citation: "Composite of FEMA, USDA, local zoning/permitting authorities (verify each link locally)",
    tags: ["buildable", "buildability", "due diligence", "checklist", "access zoning water septic", "unbuildable", "land diligence"],
  },
  {
    id: "diligence-floodway-vs-floodplain",
    topic: "flood",
    title: "Floodway vs. floodplain — the floodway is the part you usually can't fill or build",
    body:
      "The 'floodway' is the channel plus the adjacent land that must stay clear to carry the base flood without raising flood heights; the broader 'floodplain' (floodway fringe) is the rest of the 1%-chance inundation area. Communities generally PROHIBIT new construction or fill in the regulatory floodway, while the fringe may be buildable with elevation. So 'in the floodplain' is survivable for building; 'in the floodway' often is not. Check whether the building site is in the floodway specifically.",
    citation: "FEMA NFIP floodway definition (44 CFR 59.1); local floodplain ordinance",
    tags: ["floodway", "floodplain", "floodway fringe", "no fill", "encroachment", "base flood", "buildable floodplain"],
  },
  {
    id: "diligence-wetland-screen",
    topic: "diligence",
    title: "Screening for wetlands before you commit",
    body:
      "Before buying land you intend to develop, screen for wetlands using the USFWS National Wetlands Inventory and SSURGO hydric-soil ratings as free first passes. Both are screens, not determinations — only a wetland delineation by a qualified consultant, and ultimately an Army Corps jurisdictional determination, establishes the regulated boundary. If a parcel screens 'wet,' budget time and cost for a delineation, because wetlands can sharply limit the developable footprint.",
    citation: "USFWS National Wetlands Inventory; USDA-NRCS hydric soils; US Army Corps jurisdictional determination",
    tags: ["wetland screen", "national wetlands inventory", "nwi", "hydric", "delineation", "jurisdictional determination", "developable area"],
  },
  {
    id: "diligence-environmental-phase-1",
    topic: "diligence",
    title: "Phase I Environmental Site Assessment — screening for contamination liability",
    body:
      "A Phase I ESA is a non-intrusive review (records, site visit, interviews) by an environmental professional to identify 'recognized environmental conditions' — signs of possible contamination from past use (old gas stations, dumping, agricultural chemicals, underground tanks). It matters because environmental liability can attach to the owner. It's standard for commercial/industrial land and prudent for any parcel with a suspect history. A Phase II (sampling) follows only if Phase I flags something.",
    citation: "ASTM E1527 Phase I ESA standard; CERCLA 'all appropriate inquiries' (40 CFR 312)",
    tags: ["phase i esa", "environmental site assessment", "contamination", "rec", "cercla", "underground tank", "astm e1527"],
  },
  {
    id: "diligence-conservation-easement",
    topic: "diligence",
    title: "Conservation easements & deed restrictions limiting development",
    body:
      "A conservation easement is a recorded, often perpetual restriction that limits development to preserve agricultural, open-space, or habitat value, typically held by a land trust or government. It can sharply reduce or eliminate building rights (and may have given the prior owner a tax benefit). It runs with the land and binds you. Like CC&Rs and mineral reservations, it surfaces as a title exception — read the actual easement terms before assuming you can develop.",
    citation: "State conservation-easement statutes; recorded easement terms in the title commitment",
    tags: ["conservation easement", "land trust", "deed restriction", "development rights", "open space", "perpetual restriction", "title exception"],
  },
  {
    id: "diligence-survey-vs-gis-acreage",
    topic: "survey",
    title: "GIS/county acreage vs. surveyed acreage — why the numbers disagree",
    body:
      "County GIS and tax-assessor acreage are computed from parcel-mapping polygons and legal descriptions, not from a current on-the-ground survey, so they're approximate and can differ from surveyed acreage by a few percent (more for old or PLSS-aliquot descriptions). For most screening, GIS acreage is fine; when you're pricing per acre on a large or expensive parcel, or the deal hinges on exact size, order a survey. Don't treat the assessor's acre figure as surveyed truth.",
    citation: "County GIS/assessor parcel data vs. licensed boundary survey",
    tags: ["gis acreage", "assessor acreage", "surveyed acreage", "approximate", "per acre pricing", "parcel polygon", "survey"],
  },
  {
    id: "diligence-easement-utility",
    topic: "access",
    title: "Utility & drainage easements — strips you own but can't fully build on",
    body:
      "Recorded utility, pipeline, drainage, or access easements give a third party (a utility, district, or neighbor) rights over a strip of your parcel — and typically bar you from building permanent structures within them. They can cross exactly where you wanted to build. They appear as title-commitment exceptions, often with a recorded width and location. Map them against your intended building envelope before assuming the whole parcel is usable.",
    citation: "Recorded easements in the title commitment (Schedule B exceptions)",
    tags: ["utility easement", "drainage easement", "pipeline easement", "building envelope", "no build strip", "title exception", "easement width"],
  },
  {
    id: "diligence-flag-cheap-land",
    topic: "diligence",
    title: "Why land is cheap — the usual reasons to investigate",
    body:
      "Unusually cheap land usually has a reason worth finding before, not after, buying. The common culprits: no legal access (landlocked), no buildable ground (wetlands, steep slope, floodway), failing or impossible septic (perc), severed minerals or a heavy easement burden, back taxes or a clouded title, restrictive zoning/CC&Rs, or no feasible water/utilities. A low price isn't a red flag by itself — but it's a prompt to verify each of these, because a broken one is often what set the price.",
    citation: "Composite diligence framing (verify each item with the authority of record)",
    tags: ["cheap land", "too good to be true", "red flags", "why is this cheap", "diligence", "landlocked perc wetlands minerals", "discount reason"],
  },
  {
    id: "diligence-floodplain-vs-insurance",
    topic: "flood",
    title: "Flood mapping vs. flood insurance vs. actual risk",
    body:
      "Three distinct things often get conflated. The FIRM map sets the regulatory zone (which drives building rules and mandatory insurance for federally backed loans). Flood insurance is the financial product (NFIP or private), priced increasingly by FEMA's Risk Rating 2.0 on a property's specific risk, not just the zone. Actual risk is physical and can exist outside mapped zones. Don't assume 'not in a flood zone' means 'no flood risk' or 'no insurance ever required' — they're separate questions.",
    citation: "FEMA NFIP FIRM mapping; FEMA Risk Rating 2.0 insurance pricing",
    tags: ["flood map", "flood insurance", "risk rating 2.0", "nfip", "flood risk", "firm", "mandatory insurance", "outside flood zone"],
  },
  {
    id: "zoning-setbacks-envelope",
    topic: "zoning",
    title: "Setbacks & the buildable envelope — the usable area is smaller than the lot",
    body:
      "Setbacks are the minimum distances a structure must sit from front, side, and rear property lines (and sometimes from water, wells, or septic). Combined with easements, slope, and floodway, they define the 'buildable envelope' — the actual area where you can put a structure, which is often much smaller than the parcel. A small or oddly shaped lot can have almost no buildable envelope once setbacks are applied. Sketch the envelope before assuming a given build fits.",
    citation: "Local zoning ordinance setback requirements",
    tags: ["setback", "buildable envelope", "front side rear setback", "lot coverage", "small lot", "where can i build", "zoning dimensional"],
  },
  {
    id: "access-road-maintenance",
    topic: "access",
    title: "Private-road & shared-access maintenance — who pays to keep the road usable",
    body:
      "Many rural parcels reach a public road via a private or shared road. Beyond the legal right to use it (the easement), ask who is obligated to MAINTAIN it: a recorded road-maintenance agreement (RMA) allocates cost among users; without one, maintenance can be a recurring dispute and an unmaintained access road can become impassable or block financing (some lenders require an RMA). Confirm both the access right and the maintenance arrangement.",
    citation: "Recorded road-maintenance agreements; lender private-road requirements",
    tags: ["private road", "shared access", "road maintenance agreement", "rma", "maintenance cost", "impassable road", "lender requirement"],
  },
  {
    id: "tax-greenbelt-ag-exemption",
    topic: "tax",
    title: "Ag / greenbelt tax valuation — a tax break with a rollback catch",
    body:
      "Many states tax qualifying farm/timber/open-space land at a lower 'use value' (often called greenbelt, ag-use, or current-use valuation) rather than market value, sharply lowering property tax. The catch: converting the land to a non-qualifying use (e.g. development) commonly triggers a 'rollback' — back taxes for several prior years plus interest. An investor should know whether a parcel carries an ag/greenbelt assessment and what rollback would apply on a change of use before pricing a development play.",
    citation: "State current-use / greenbelt assessment statutes (rollback provisions vary)",
    tags: ["greenbelt", "ag exemption", "current use valuation", "use value", "rollback tax", "agricultural assessment", "tax break"],
  },
  {
    id: "zoning-mobile-manufactured",
    topic: "zoning",
    title: "Mobile / manufactured-home placement — frequently restricted, check first",
    body:
      "Placing a mobile or manufactured home is governed by BOTH zoning (some districts prohibit or restrict them, or require a minimum size/HUD code) and private CC&Rs (which often ban them outright), plus septic/utility permitting. Many cheap lots are bought to 'just put a trailer on it' only for the buyer to find it's not allowed. Confirm the parcel's zoning permits the specific home type and that no CC&R bars it before counting on that use.",
    citation: "Local zoning ordinance + recorded CC&Rs; HUD manufactured-home code",
    tags: ["mobile home", "manufactured home", "trailer", "hud code", "zoning restriction", "cc&r ban", "tiny home", "rv living"],
  },
  {
    id: "diligence-slope-topography",
    topic: "diligence",
    title: "Slope & topography — steep ground raises cost and can block a build",
    body:
      "Slope drives buildability and cost: gentle ground is cheap to build on; steep slopes mean expensive grading, retaining walls, harder septic siting, erosion controls, and sometimes a grading-permit or geotechnical study, and some jurisdictions restrict building on slopes above a threshold. USGS/contour data and the parcel's elevation give a first read. A low price on 'scenic mountain acreage' can reflect ground too steep to build on affordably — check the slope of the intended building site.",
    citation: "USGS elevation/contour data; local grading and hillside-development ordinances",
    tags: ["slope", "topography", "steep", "grading", "retaining wall", "geotechnical", "hillside", "buildable site", "erosion"],
  },
  {
    id: "water-floodplain-buffer",
    topic: "water",
    title: "Riparian buffers & shoreland setbacks — building back from water",
    body:
      "Parcels along streams, rivers, lakes, or wetlands frequently carry a required vegetated buffer or shoreland setback under state/local rules to protect water quality — barring or limiting structures, clearing, and impervious surfaces within a set distance of the water. Waterfront can be a premium feature and a constraint at once: the usable building area excludes the buffer. Check the applicable shoreland/riparian-buffer rule before pricing in a waterfront build.",
    citation: "State shoreland-zoning / riparian-buffer regulations (vary by state and water body)",
    tags: ["riparian buffer", "shoreland setback", "waterfront", "buffer zone", "stream setback", "lakefront", "impervious limit"],
  },
  {
    id: "title-marketable-vs-insurable",
    topic: "title",
    title: "Marketable vs. insurable title — and why it matters for resale",
    body:
      "'Marketable title' is title free enough of defects that a reasonable buyer would accept it; 'insurable title' is title a company will insure, sometimes by insuring OVER a known defect rather than curing it. They're not identical: a title insured over an old defect may still be hard to resell or finance later because the defect remains. For an investor planning to resell, prefer title that's genuinely marketable (or cured), not merely insurable around a problem.",
    citation: "Standard title-examination practice (marketable vs. insurable title distinction)",
    tags: ["marketable title", "insurable title", "title defect", "insure over", "resale", "clear title", "title cure"],
  },
  {
    id: "seller-finance-wraparound",
    topic: "seller_finance",
    title: "Wraparound & subject-to financing — when an underlying loan still exists",
    body:
      "A wraparound mortgage layers seller financing on top of an existing underlying loan the seller keeps paying; the buyer pays the seller, who pays the original lender. 'Subject-to' means the buyer takes title and makes payments on the seller's existing loan without formally assuming it. Both can trip a 'due-on-sale' clause that lets the original lender call the loan on transfer. These are advanced structures with real risk — they need careful drafting and an understanding of the underlying loan's terms.",
    citation: "Standard wraparound/subject-to practice; due-on-sale clause (Garn-St Germain Act)",
    tags: ["wraparound", "subject to", "due on sale", "underlying loan", "wrap mortgage", "garn-st germain", "creative financing"],
  },
  {
    id: "zoning-paper-subdivision",
    topic: "zoning",
    title: "Platted 'paper' subdivisions — lots that exist on paper but not in reality",
    body:
      "Some cheap lots come from old recorded 'paper' subdivisions — platted decades ago into many small lots that were never developed: no built roads, no utilities, sometimes access only by undeveloped easement, and lots often below today's minimum size so they can't be built on individually. They're a classic low-dollar land trap. Before buying a lot in one, verify it's a legal buildable lot of record today, with real access and a path to utilities — not just a line on an old plat.",
    citation: "Recorded plat + current zoning/lot-of-record rules (county planning office)",
    tags: ["paper subdivision", "paper lot", "antiquated subdivision", "lot of record", "platted lot", "no roads", "unbuildable lot", "cheap lot trap"],
  },
];

/**
 * Lookup a card by id. Returns undefined if absent. Used by retrieval to
 * re-hydrate full card content from a pgvector source_ref hit.
 */
export function getLandKnowledgeCard(id: string): LandKnowledgeCard | undefined {
  return LAND_KNOWLEDGE_CARDS.find((c) => c.id === id);
}
