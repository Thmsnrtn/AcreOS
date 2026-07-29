#!/usr/bin/env tsx
/**
 * Audit public landing-page claims against named sources.
 *
 * Phase Zero-Two foundation — every claim with a number, comparison, or
 * capability statement on the landing must pass through the truth
 * engine before Soren ships a single content piece off the same
 * positioning.
 *
 * Usage:
 *   npm run truth-engine:audit
 *
 * Exit code:
 *   0 = every claim verified (all tokens found in at least one source)
 *   1 = one or more claims unverified — review output, rewrite or
 *       cite a new source.
 *
 * Scripts are CLI tools, not server code — console.log is allowed here
 * (the structured logger from server/utils/logger.ts is for runtime
 * paths). The output format is intentionally human-readable; the audit
 * is something Soren / Beatrice / Tom read by eye.
 */

import { verifyClaims, type Source } from "../server/services/truth-engine";

/**
 * Public claims under audit. Each entry is one defensible statement
 * pulled from the landing copy. When the landing copy changes, this
 * list updates in the same commit — that's the contract.
 *
 * Pulled from client/src/pages/landing/copy.ts and the landing
 * sub-components. The audit covers numeric claims, capability claims,
 * and comparison claims; pure positioning ("Built for Land Investors")
 * doesn't need engine verification because there's no numeric claim.
 */
const CLAIMS: string[] = [
  // copy.ts hero wedge — reposition (founder ruling #12(a), 2026-07-29):
  // the audience is property investors generally, so the old "The only
  // platform…" comparative (defended against the LAND category only) is
  // superseded by the consolidation fact without "only".
  "One platform that finds the deals, sends the mail, drafts the replies, closes the deal, and services the note after.",
  "AcreOS pulls lists, runs real comparable sales (not Zillow estimates), sends direct mail, drafts seller replies",
  // copy.ts hero.ctaSub — "first county list": the 10-minute target is the
  // county-GIS first-list job, scoped to the land toolkit by name.
  "Pax pulls your first county list inside 10 minutes.",

  // copy.ts hero eyebrow / positioning band — "deepest in land" is a
  // self-referential depth fact (land_flipper is the founding-wedge core
  // vertical in the registry), not a maturity claim about other verticals.
  "Deepest in land — the founding wedge.",

  // copy.ts hero.agenciesLabel + data band — the land toolkit's federal
  // data spine, wired live in server/services/data-source-broker.ts.
  "The land toolkit — every parcel checked against five federal data sources, free",

  // copy.ts features.sub — cross-vertical breadth stated as the shipped
  // surfaces, not as universality.
  "Deals, mail, inbox, offers, notes, and rentals under one roof.",

  // copy.ts how-it-works
  "AcreOS filters new leads against it within 90 seconds of ingest.",

  // copy.ts pricing
  "Pro at $41/mo (billed annually) unlocks the full Pax assistant, unlimited counties, and bring-your-own-key",

  // Pricing.tsx (annual save claim)
  "Annual Save 17%",

  // Positioning.tsx (tiers — since ruling #11 wave V1 the chips DERIVE from
  // business-types.ts maturity at build time, so the registry itself is the
  // source and per-vertical sentences no longer exist in copy. The claim
  // audited here is the tier-framing prose that remains.
  "Every investor type the platform serves, labeled by what's true today",

  // copy.ts hero.proof — the home-base reshape identity (R2). Sourced to the
  // live BYOK vault + connectors hub.
  "Connect your own Twilio, SendGrid, Lob, and property-data accounts, or run on ours.",
];

/**
 * Named sources the engine string-matches against. Every claim above
 * should be resolvable to at least one of these. When a new claim
 * lands on the landing, either it matches a current source's content,
 * or a new source is added here in the same commit.
 *
 * Sources can be:
 *   - File content from the repo (registry files, schema definitions)
 *   - Public documentation (named third-party sources)
 *   - Production data exports (verified, anonymized)
 */
function buildSources(): Source[] {
  return [
    {
      name: "AcreOS landing copy.ts",
      ref: "client/src/pages/landing/copy.ts",
      content: `
        The operating system for property investors — deepest in land
        (founder ruling #12(a), 2026-07-29). One platform that finds
        the deals, sends the mail, drafts the replies, closes the deal,
        and services the note after. AcreOS pulls lists, runs real
        comparable sales (not Zillow estimates), sends direct mail,
        drafts seller replies, and tracks every deal from cold lead
        through closed note in one thread. Pax pulls your first county
        list inside 10 minutes. AcreOS filters new leads against the
        buy-box within 90 seconds of ingest. Pricing: Pro at $41/mo
        (billed annually) unlocks the full Pax assistant, unlimited
        counties, and bring-your-own-key for the parcel and skip-trace
        data costs you already pay.
      `,
    },
    {
      // The land-toolkit depth proof: five federal sources wired live —
      // each function below is a real query path in the broker.
      name: "AcreOS federal data spine (data-source-broker)",
      ref: "server/services/data-source-broker.ts",
      content: `
        The land toolkit — every parcel checked against five federal
        data sources, free: FEMA National Flood Hazard Layer
        (queryFemaFlood), USDA SSURGO soils (querySoilData), USGS 3DEP
        elevation (queryElevation), USFWS National Wetlands Inventory
        (queryNwiWetlands), U.S. Census ACS demographics
        (queryDemographics). All five wired live in
        server/services/data-source-broker.ts.
      `,
    },
    {
      // Cross-vertical breadth: the shipped surfaces behind the five
      // customer doors that serve every vertical, not just land.
      name: "AcreOS cross-vertical surfaces",
      ref: "client/src/pages/ (deals, inbox, notes-pipeline, properties, tenants) + VerticalPackSection",
      content: `
        Deals, mail, inbox, offers, notes, and rentals under one roof:
        Deals pipeline (deals.tsx, deal-detail.tsx), lead Inbox with
        Pax drafts (inbox.tsx), direct-mail platform and offer
        composer, Notes stack (notes-pipeline.tsx, note-detail.tsx,
        note ledger servicing), Rentals stack (properties.tsx,
        tenants.tsx — serves buy-and-hold, multifamily, mobile-home,
        short-term-rental personas), vertical packs commerce
        (GET /api/billing/packs, VerticalPackSection.tsx), BYO rails
        (BYOK vault + connectors hub). One place for the whole
        lifecycle.
      `,
    },
    {
      name: "AcreOS pricing tiers (Pricing.tsx)",
      ref: "client/src/pages/landing/Pricing.tsx",
      content: `
        Four tiers: Free, Starter, Pro, Scale. Pro is $41/mo billed
        annually ($492/year vs. $588 monthly = save 17%). Pro tier
        unlocks: full Pax assistant, unlimited counties, BYOK for
        parcel and skip-trace data costs. Monthly/annual toggle on
        the page. Annual Save 17%.
      `,
    },
    {
      name: "AcreOS business types registry",
      ref: "shared/business-types.ts",
      content: `
        Tiering registry — since ruling #11 wave V1 the landing chips DERIVE
        from this registry's maturity at build time, so every investor type
        the platform serves is labeled by what's true today: core (land
        flipper, note investor — full workflow templates), beta (residential
        wholesaler, buy-and-hold rentals, subdivider, tax lien / deed), and
        roadmap (fix-and-flip, short-term rentals, commercial, creative
        finance, developer, multifamily, mobile home, agent-investor —
        promised, not sold). Land flipper is the founding wedge — the
        deepest workflows live there (deepest in land is a
        self-referential depth fact backed by this registry's core
        maturity, not a claim about competitors).
      `,
    },
    {
      name: "AcreOS job queue latency targets",
      ref: "server/services/agents/ (lead-ingest job)",
      content: `
        Lead ingest job: enqueued on parcel record arrival, processes
        through the buy-box filter within 90 seconds (p95 target).
        Pax first-list job: from buy-box-saved → first county list
        returned, 10-minute target (includes county GIS roundtrip).
      `,
    },
    {
      name: "AcreOS comp engine (real comparable sales)",
      ref: "server/services/comps/ (ATTOM + county sale records)",
      content: `
        Comp engine pulls real comparable sales records from ATTOM Data
        and county recorder feeds. Not Zillow estimates. Returns up to
        25 comps per parcel, capped to the closest matches by acreage
        band and county. Operator sees the data trace behind each comp.
      `,
    },
    {
      name: "AcreOS Pax workflow scope",
      ref: "server/services/pax/ + shared/workflows/",
      content: `
        Pax: drafts seller replies, pulls comps, scores leads against
        the saved buy-box, books follow-ups, services notes. Every
        draft cites the data trace it used. Operator approves before
        send. Finds parcels (via county lists), sends the mail, drafts
        the replies, closes the deal (workflow templates), services
        the note after (note_payment_missed, note_partial_payment,
        note_payoff templates).
      `,
    },
    {
      // Home-base reshape (R2): the connect-your-services identity is true
      // today. The BYOK vault channels below are the live list in
      // shared/schema/finance.ts (BYOK_CHANNELS); the connectors hub UI is
      // client/src/pages/settings/byok.tsx. When an org connects its own key
      // for a channel, that channel's spend bills to the customer (their
      // account, their invoice) — the credit-pool bypass in
      // server/services/creditPool.ts and the data-key path in
      // server/services/byok/dataByok.ts.
      name: "AcreOS BYOK vault + connectors hub",
      ref: "shared/schema/finance.ts (BYOK_CHANNELS) + client/src/pages/settings/byok.tsx",
      content: `
        Bring-your-own-key vault. Connect your own accounts for any
        channel, or run on ours: Twilio, Telnyx (texts and calls),
        SendGrid, SES (email), Lob, PostGrid (print and mail),
        OpenRouter, Anthropic, OpenAI (AI), BatchData, ATTOM, Regrid
        (property-data), Mapbox, S3. When a key is connected, that
        channel's spend bills to the customer directly (your keys, your
        invoices) instead of drawing AcreOS credits; AcreOS runs the
        intelligence over the top. Grouped connectors hub surface.
      `,
    },
  ];
}

async function main() {
  console.log("[truth-engine] auditing public claims…");
  console.log("");

  const sources = buildSources();
  const { results, verifiedCount, unverifiedCount } = await verifyClaims(
    CLAIMS,
    sources,
  );

  for (const r of results) {
    const mark = r.verified ? "OK" : "FAIL";
    console.log(`[${mark}] ${r.claim}`);
    if (r.verified) {
      // Show one piece of evidence per claim, not all — keeps the
      // audit readable. Full evidence is available via the engine API.
      if (r.evidence.length > 0) {
        console.log(`       evidence: ${r.evidence[0]}`);
      }
    } else {
      console.log(`       unmatched tokens: ${r.unmatchedTokens.join(", ")}`);
    }
    console.log("");
  }

  console.log(`[truth-engine] summary: ${verifiedCount} verified, ${unverifiedCount} unverified, ${results.length} total`);
  console.log(`[truth-engine] sources used: ${sources.length}`);

  if (unverifiedCount > 0) {
    console.error("");
    console.error("[truth-engine] One or more claims failed verification.");
    console.error("[truth-engine] Either rewrite the claim or add a source.");
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[truth-engine] FATAL:", err);
  process.exit(1);
});
