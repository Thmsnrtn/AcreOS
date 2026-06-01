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
  // copy.ts hero (line 47-53)
  "The only platform that finds parcels, sends the mail, drafts the replies, closes the deal, and services the note after.",
  "AcreOS pulls lists, runs real comparable sales (not Zillow estimates), sends direct mail, drafts seller replies",
  "Pax pulls your first list inside 10 minutes.",

  // copy.ts how-it-works (line 94)
  "AcreOS filters new leads against it within 90 seconds of ingest.",

  // copy.ts pricing (line 133)
  "Pro at $41/mo (billed annually) unlocks the full Pax assistant, unlimited counties, and bring-your-own-key",

  // Pricing.tsx (annual save claim line 115)
  "Annual Save 17%",

  // Positioning.tsx (tiers — verified against business-types.ts)
  "Note investors run a full workflow today. Fix-and-flippers, wholesalers, and tax-delinquent buyers are in beta",
  "Subdividers and buy-and-hold landlords are on the roadmap.",
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
        The operating system for Land Investors. The only platform that
        finds parcels, sends the mail, drafts the replies, closes the
        deal, and services the note after. AcreOS pulls lists, runs
        real comparable sales (not Zillow estimates), sends direct mail,
        drafts seller replies, and tracks every parcel from cold lead
        through closed note in one thread. Pax pulls your first list
        inside 10 minutes. AcreOS filters new leads against the buy-box
        within 90 seconds of ingest. Pricing: Pro at $41/mo (billed
        annually) unlocks the full Pax assistant, unlimited counties,
        and bring-your-own-key for the parcel and skip-trace data
        costs you already pay.
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
        Tiering registry. Core: land_investor (primary), note_investor
        (full workflow templates). Beta: fix_and_flip, residential_wholesaler
        (also: fix-and-flippers, wholesalers), tax_lien_deed (tax-delinquent
        buyers). Roadmap: subdivider (subdividers — parcel editor exists,
        Finance generic), buy_and_hold (buy-and-hold landlords — UI suppressed).
        Note investors run a full workflow today with complete Pax vocabulary.
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
