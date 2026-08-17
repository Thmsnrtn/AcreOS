/**
 * Central copy for the public landing page.
 *
 * Voice: mechanics-first, third-person. Describes what the system
 * does, not why it was built. No "I built this", no founder-letter
 * tone, no audience-flattering rhetorical hooks.
 *
 * Positioning (founder ruling #12(a), 2026-07-29): AcreOS speaks to
 * PROPERTY INVESTORS generally — land flippers, note investors,
 * wholesalers, tax-auction buyers, subdividers, flippers, landlords,
 * commercial, creative-finance, agent-investors. Land remains the
 * DEEPEST wedge and the page says so honestly ("deepest in land" is a
 * self-referential depth fact backed by the registry, not a maturity
 * claim about any other vertical); land-only surfaces (free parcel
 * check, federal data spine, Land Credit Score) are labeled as the
 * land toolkit rather than dressed up as universal. Every vertical is
 * present in the product at varying depth (core / beta / roadmap per
 * shared/business-types.ts). The positioning band's chips DERIVE
 * their names and tiers from that registry (Positioning.tsx, wave V1
 * of founder ruling #11) — no vertical names are written here, so a
 * registry maturity flip can't strand a stale sentence. No active
 * CTAs for non-core types; they're named so adjacent operators know
 * the platform sees them.
 *
 * 10-second test: a reader should understand within 10 seconds who
 * the platform is for, what it does, and how it works. Every section
 * is written to that bar.
 *
 * The previous `founder` block (a first-person letter from Thomas) and
 * its FounderNote section have been removed entirely.
 *
 * Truth-engine notes (2026-05-31):
 *   - "14 comps per parcel" removed from hero sub; engine caps at 25 and
 *     returns however many ATTOM finds per county/acreage band. No fixed
 *     number is defensible as a blanket claim.
 *   - "90 seconds" for buy-box filtering and Pax reply drafts retained —
 *     these are system latency targets baked into the job queue.
 *   - "10 minutes" for first list retained — setup time, not processing.
 */

export const LANDING_COPY = {
  hero: {
    eyebrow: "For property investors — deepest in land",
    // Static two-line headline. The italic brand-color line two is
    // rendered by .lp-hero-line:nth-child(2). No rotation — property
    // investors is the audience (ruling #12(a)); the eyebrow names
    // land as the depth proof, not the gate.
    title: [
      "The operating system",
      "for property investors.",
    ] as const,
    // The wedge sentence: one defensible line that names the
    // consolidation. Five verbs map 1:1 to the lifecycle the product
    // owns end-to-end — find, mail, reply, close, service. The old
    // "only platform" comparative was defended against the LAND
    // category only; for the broader property-investor audience it is
    // not defensible, so the reposition drops "only" and keeps the
    // consolidation fact (audited in scripts/audit-public-claims.ts).
    wedge:
      "One platform that finds the deals, sends the mail, drafts the replies, closes the deal, and services the note after.",
    // Landing-benchmark pass (2026-07-17, vs Linear/Stripe/Notion + the REI
    // category): the hero previously stacked FOUR text blocks before the CTAs
    // (wedge + a 60-word paragraph + ctaSub + proof). Best-in-class pages run
    // headline → ONE subhead → CTAs. The wedge sentence IS the subhead; the
    // long paragraph's content already lives in How-it-works and Features, so
    // it was cut from the hero rather than compressed into mush.
    cta1: "Start free — 14 days, no card",
    // Secondary CTA is the proof itself: the public streaming parcel-check at
    // /tools/parcel-check lets a stranger watch real government data resolve
    // source-by-source, no signup. The proof sells; the result page carries the
    // signup CTA. (Benchmark pass: the old pair — "See Pax run on your county"
    // vs "Run it on your county" — read as the same button twice; now the
    // primary is the start action and the secondary is unmistakably the demo.)
    cta2: "Watch it run on a real parcel — no signup",
    // "first county list" (not "first list") — the 10-minute target is
    // the county-GIS first-list job, a land-toolkit mechanic; naming
    // the county keeps the claim scoped to what the target covers.
    ctaSub: "Pax pulls your first county list inside 10 minutes. Deepest in land: every parcel gets a Land Credit Score — a 300–850 read on the parcel itself.",
    // Reshape identity (home-base-reshape.md): the platform is the home base
    // you connect your own tools to. Truthful today — the BYOK vault + the
    // connectors hub (client/src/pages/settings/byok.tsx) let an org connect
    // its own Twilio/SendGrid/Lob and property-data accounts, and those keys
    // make that channel's spend bill to the customer instead of AcreOS. Cited
    // in the truth-engine audit (scripts/audit-public-claims.ts).
    proof:
      "Connect your own Twilio, SendGrid, Lob, and property-data accounts — or run on ours. Your keys, your invoices; AcreOS runs the intelligence over the top.",
    // The honest logo wall. The category leans on user counts and press logos;
    // pre-launch we have neither and fabricate nothing. What we DO verifiably
    // have is the data spine: five federal sources wired live in
    // server/services/data-source-broker.ts (queryFemaFlood / querySoilData /
    // queryElevation / queryNwiWetlands / queryDemographics) — the same list
    // the Data section documents in depth further down the page.
    // Labeled as the land toolkit (ruling #12(a)): the federal data
    // spine is genuinely land-only, so it is presented as the depth
    // proof, not a universal capability.
    agenciesLabel: "The land toolkit — every parcel checked against five federal data sources, free:",
    agencies: ["FEMA", "USDA", "USGS", "USFWS", "U.S. Census"] as const,
  },
  // Simulated product screens (2026-07-17, founder request following the
  // landing benchmark pass). These are RENDERED depictions of the real
  // product surfaces — the Map door's parcel-intelligence panel, the Today
  // decision queue, the Pax thread — populated with the same hand-authored
  // illustrative fixtures the hero cards use. Every frame carries the
  // "Example · representative output" chip; the section subline turns the
  // honesty into a CTA (run the free parcel check for real output).
  productShots: {
    eyebrow: "The product",
    title: "What you actually work in.",
    sub: "Illustrative screens with example data — run the free parcel check to see real output on a real parcel.",
    proofCta: "Run a free parcel check",
  },
  positioning: {
    primary: "Built for property investors.",
    // Wave V1 (founder ruling #11, 2026-07-29): vertical NAMES no longer
    // live in this file. Positioning.tsx derives the three chip tiers
    // (core / beta / roadmap) directly from shared/business-types.ts at
    // build time, using each registry entry's label — a maturity flip in
    // the registry flows to the landing automatically. `hybrid`
    // (land + notes) is deduped out of the chips: it is the combination
    // of the two core verticals, not a distinct audience. Landing-side
    // conservatism, if ever needed again, goes through the explicit
    // shared PUBLIC_CLAIM_DEMOTIONS map (reason + date required),
    // superseding the old hardcoded demotions (e.g. subdivider shown as
    // roadmap despite its beta registry maturity).
    //
    // The two prose lines below are deliberately TIER-GENERIC — the
    // chips carry the names, so no registry flip can strand a stale
    // sentence here. "Deepest in land" is the one deliberate
    // exception: land is the founding wedge (ruling #12(a) keeps that
    // honest depth fact), a founder-decision constant rather than a
    // registry maturity that could flip.
    inProduct:
      "Deepest in land — the founding wedge — with every investor type the platform serves labeled by what's true today: full workflows, beta, or roadmap.",
    roadmap:
      "On the roadmap — promised, not sold:",
  },
  how: {
    eyebrow: "How it works",
    title: "Three steps. Most happens on its own.",
    steps: [
      {
        n: 1,
        t: "Define the buy-box",
        b: "Counties, price band, property type, owner profile. AcreOS filters new leads against it within 90 seconds of ingest.",
      },
      {
        n: 2,
        t: "AcreOS does the busy work",
        b: "Lists pulled, mail sent, replies drafted overnight. Every action is logged and reviewable.",
      },
      {
        n: 3,
        t: "Operator makes the calls",
        b: "Approve offers, edit drafts, skip what doesn't fit. Human judgment stays on the deals that matter.",
      },
    ],
  },
  agents: {
    eyebrow: "Meet Pax",
    title: "Pax — your AI operations partner.",
    sub:
      "Pax monitors the pipeline overnight: pulls comps, scores leads, drafts replies, books follow-ups, services notes. Every action is shown with the data it used. Nothing happens behind your back.",
  },
  day: {
    eyebrow: "A Tuesday in May",
    title: "Two versions of the same week.",
    sub:
      "Before AcreOS, a typical Tuesday looks like the left column. With AcreOS, it looks like the right.",
  },
  features: {
    eyebrow: "What's in the box",
    title: "Every tool a property investor needs, in one place.",
    // Breadth is stated as the shipped cross-vertical surfaces (deals,
    // mail, inbox, offers, notes, rentals — audited in
    // scripts/audit-public-claims.ts); the land depth is scoped with
    // "on land" instead of implied as universal.
    sub: "Find, analyze, reach, close, service — deals, mail, inbox, offers, notes, and rentals under one roof. On land it runs deepest: every parcel carries a Land Credit Score — a 300–850 read on the dirt. No tab-juggling, no per-step subscriptions.",
  },
  data: {
    // Labeled as the land toolkit (ruling #12(a)) — parcel checks are
    // genuinely land-only, so the section owns that instead of
    // pretending universality.
    eyebrow: "The land toolkit",
    title: "Premium government data, free.",
    sub:
      "Where AcreOS runs deepest for Land Investors: flood, soil, elevation, and wetlands checks on every parcel from public government data — before you ever pay for a data subscription. Paid providers come later, when your deal volume earns them.",
    // source: server/services/data-source-broker.ts wires each of these
    // government APIs live (queryFemaFlood / querySoilData / queryElevation /
    // queryNwiWetlands / queryDemographics).
    sources: [
      { agency: "FEMA", what: "National Flood Hazard Layer — flood zone and risk." },
      { agency: "USDA", what: "SSURGO soil survey — type, capability class, drainage." },
      { agency: "USGS", what: "3DEP elevation — point elevation and slope context." },
      { agency: "USFWS", what: "National Wetlands Inventory — mapped wetland presence." },
      { agency: "Census", what: "ACS tract context — population and median income." },
    ],
    promise:
      "Every parcel gets these checks at no cost. Paid data (parcel ownership, skip-trace) stays behind your own key, so you only pay for it when a deal justifies it.",
    proofCta: "Run it on any address",
  },
  quotes: {
    eyebrow: "What the system does",
    title: "Mechanics, not marketing.",
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Premium government data, free. Paid data when you scale.",
    sub:
      "Numbers on the page. No \"contact us\" wall. The free tier runs flood, soil, elevation, and wetlands checks from government data on every parcel. Pro unlocks the full Pax assistant, unlimited counties, and bring-your-own-key for the parcel and skip-trace data costs you already pay — see the live price on each tile below. Every paid plan is backed by a 30-day money-back guarantee.",
  },
  faq: {
    eyebrow: "Common questions",
    title: "Frequently asked.",
  },
  cta: {
    eyebrow: "Ready when you are",
    title: "Try AcreOS for two weeks.",
    sub:
      "No card, no calls, no pressure. Full feature access during the trial.",
    cta1: "Start free trial",
    cta2: "Email us first",
  },
  // Public explainer for the Land Credit Score — the category-defining noun.
  // Honest framing (truth-engine, 2026-06-08): the score reads PARCELS, not
  // people. It is not a consumer credit report and pulls no personal credit.
  // Scale (300–850), grades (A+ … F), and the six weighted dimensions mirror
  // the product surface (client/src/pages/land-credit.tsx feature-importance
  // table + shared/schema/marketplace.ts landCreditScores). No example score is
  // stated as real; the sample card is labeled "illustrative."
  landCreditScore: {
    eyebrow: "The Land Credit Score",
    title: "A credit score for the parcel — not the person.",
    sub:
      "Every parcel AcreOS touches gets a Land Credit Score: a single 300–850 read, graded A+ through F, of how a piece of land stacks up as an investment. It scores the dirt, not the buyer. It is not a consumer credit report and pulls no personal credit.",
    scaleNote: "300–850 scale · A+ through F · recomputed as the underlying data changes.",
    dimensionsTitle: "Six weighted dimensions",
    dimensionsSub:
      "The score is a weighted blend of six dimensions, drawn from the same government and market data behind every parcel check.",
    // Keep in sync with LCS_METHODOLOGY_VERSION in server/services/landCredit.ts
    // (the canonical constant stamped on every public report).
    methodologyNote:
      "Published methodology, version v1 — the weights below are the methodology. Any change to the weights, scale, or grade thresholds revs the version, and every free parcel report is stamped with the version that produced it.",
    dimensions: [
      { name: "Location", weight: 25, what: "Market strength, population growth, economic health, accessibility." },
      { name: "Financial", weight: 20, what: "Cash flow, appreciation, liquidity, tax burden, carrying cost." },
      { name: "Physical", weight: 20, what: "Topography, soil quality, water access, utilities, road access." },
      { name: "Legal", weight: 15, what: "Zoning, restrictions, mineral rights, water rights, clear title." },
      { name: "Environmental", weight: 10, what: "Flood risk, wildfire, contamination, wetlands, protected species." },
      { name: "Market", weight: 10, what: "Demand, supply, price history, days on market, comparable sales." },
    ],
    sampleLabel: "Illustrative — example output, not a real parcel",
    honestTitle: "What it is — and what it isn't",
    honest: [
      "It scores parcels, not people. No personal or consumer credit is involved.",
      "It is not a FICO score, a consumer credit report, or a regulated credit product.",
      "It is a decision aid, not a guarantee — the operator still makes the call.",
      "It updates as the underlying flood, soil, market, and ownership data changes.",
    ],
    cta1: "Run a free parcel check",
    cta2: "Start free trial",
  },
};

export type LandingCopy = typeof LANDING_COPY;
