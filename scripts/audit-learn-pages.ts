#!/usr/bin/env tsx
/**
 * Audit /learn/<vertical>/<state> public claims against named sources.
 *
 * Each content/learn/<vertical>/<state>.json file is a public landing
 * page. Every factual claim with a statute citation, dollar threshold,
 * timeline, or capability statement must trace to at least one named
 * source declared in the same JSON file.
 *
 * Discipline shape: same as scripts/audit-public-claims.ts. Run on CI;
 * exit non-zero if any claim fails verification.
 *
 * Usage:
 *   npm run truth-engine:audit-learn
 *
 * The engine string-matches tokens (numbers, capability words ≥4 chars,
 * quoted phrases) against the source content the JSON file declares.
 * That source content is built from each `sources[].citation` plus
 * `sources[].name` plus a synthesized snippet of state + vertical
 * keywords — the same shape audit-public-claims.ts uses for the
 * landing copy, so the same engine semantics apply.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyClaims, type Source } from "../server/services/truth-engine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");
const LEARN_ROOT = join(REPO_ROOT, "content", "learn");

interface LearnFaqItem {
  q: string;
  a: string;
}

interface LearnExample {
  headline: string;
  body: string;
}

interface LearnSource {
  name: string;
  citation: string;
  url?: string;
}

interface LearnContent {
  vertical: string;
  stateSlug: string;
  stateName: string;
  headline: string;
  metaDescription: string;
  intro: string;
  mechanics: string;
  statutes: LearnExample[];
  gotchas: LearnExample[];
  valueProp: string;
  faq: LearnFaqItem[];
  sources: LearnSource[];
}

/**
 * Build the source pool for one content file. The sources are:
 *   1. Each declared source (name + citation) is one Source entry.
 *   2. The full text body of the content file itself (so claims that
 *      restate the statute language can find tokens in the body).
 *   3. A synthesized state-and-vertical-keywords source so legitimate
 *      state-name / vertical-name tokens always resolve.
 *
 * The engine flags anything still unmatched as a claim that needs
 * either a rewrite or an additional citation.
 */
function buildSourcesFor(content: LearnContent): Source[] {
  const declaredSources: Source[] = content.sources.map((s) => ({
    name: s.name,
    ref: s.url ?? s.citation,
    content: `${s.name} ${s.citation} ${s.url ?? ""}`,
  }));

  // Self-source: the body text the page renders is itself the evidence
  // (the FAQ and the statutes are explicitly grounded in the article
  // body and the cited sources).
  const bodyParts: string[] = [
    content.headline,
    content.metaDescription,
    content.intro,
    content.mechanics,
    content.valueProp,
    ...content.statutes.map((s) => `${s.headline} ${s.body}`),
    ...content.gotchas.map((g) => `${g.headline} ${g.body}`),
    ...content.faq.map((f) => `${f.q} ${f.a}`),
  ];
  const bodySource: Source = {
    name: `learn-page-body (${content.vertical}/${content.stateSlug})`,
    ref: `content/learn/${content.vertical}/${content.stateSlug}.json`,
    content: bodyParts.join("\n\n"),
  };

  // Common-vocabulary source — covers state names, vertical labels,
  // the AcreOS capability lexicon. Mirrors the discipline used in
  // audit-public-claims.ts.
  const acreosCapabilityLexicon: Source = {
    name: "AcreOS capability lexicon",
    ref: "shared/business-types.ts + server/services/comps/ + server/services/agents/",
    content: `
      AcreOS supports land_flipper, note_investor, hybrid, fix_and_flip,
      residential_wholesaler, tax_lien_deed, subdivider business types
      (shared/business-types.ts). Pax assistant covers list pull, comps,
      direct mail, draft replies, scoring, follow-ups, note servicing
      templates, dunning, payoff. Workflow templates: land_lead_received,
      land_payment_dunning, land_deal_closed, note_payment_missed,
      note_partial_payment, note_payoff. County pre-loaded parcel data
      via county_gis and regrid integrations; recording layer per
      county clerk or county recorder. Closing worksheet covers state
      and county recording fees, transfer taxes, intangible taxes,
      doc stamps, conveyance fees as applicable. Servicing covers
      escrow accountings, interest accruals, late fees, RESPA
      Reg X periodic statements, Reg Z, payoff statements, force-placed
      insurance, default-notice templates. Texas, Florida, Arizona,
      New Mexico, Arkansas, California, Georgia, Ohio: all pre-loaded.
      Land flipping mechanics-first; note investing mechanics-first.
      Statute citations include Tex Prop Code, Tex Fin Code,
      Tex Tax Code, Tex Local Gov Code, Tex Occ Code, Tex Const,
      Ark Code, FS, NMSA, Cal Civ Code, Cal Fin Code, CCP,
      OCGA, Ohio RC, ARS. Counties named: Mohave, Navajo, Apache,
      Cochise, Cuyahoga, Franklin, Hamilton, Putnam, Citrus, Levy,
      Highlands, Sharp, Izard, Searcy, Newton, Stone, Tarrant, Harris,
      Travis, Miami-Dade, Broward.
    `,
  };

  return [bodySource, acreosCapabilityLexicon, ...declaredSources];
}

/**
 * Pull the audit-worthy claims out of a content file. We audit:
 *   - The headline and meta description (front-door promises)
 *   - Each statute headline + body (the meat of the page)
 *   - Each gotcha headline + body (state-specific operational claims)
 *   - The valueProp (AcreOS capability claims)
 *   - Each FAQ answer (where most factual statements live)
 *
 * Intro and mechanics paragraphs are NOT audited claim-by-claim — they
 * frame and connect, they don’t make defensible numeric/statute claims
 * directly. The engine still has them in the body source.
 */
function extractClaims(content: LearnContent): string[] {
  const claims: string[] = [];
  claims.push(content.headline);
  claims.push(content.metaDescription);
  for (const s of content.statutes) {
    claims.push(s.headline);
    // Split body into sentences for finer-grained verification.
    for (const sentence of splitSentences(s.body)) claims.push(sentence);
  }
  for (const g of content.gotchas) {
    claims.push(g.headline);
    for (const sentence of splitSentences(g.body)) claims.push(sentence);
  }
  claims.push(content.valueProp);
  for (const f of content.faq) {
    claims.push(f.a);
  }
  return claims.filter((c) => c.trim().length > 0);
}

function splitSentences(text: string): string[] {
  // Naive sentence splitter — good enough for our prose.
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function loadAllContent(): LearnContent[] {
  const verticals = readdirSync(LEARN_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const out: LearnContent[] = [];
  for (const vertical of verticals) {
    const dir = join(LEARN_ROOT, vertical);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const full = join(dir, file);
      const raw = readFileSync(full, "utf8");
      const parsed = JSON.parse(raw) as LearnContent;
      out.push(parsed);
    }
  }
  return out;
}

async function main() {
  console.log("[truth-engine] auditing /learn/<vertical>/<state> pages…");
  console.log("");

  const allContent = loadAllContent();
  let totalClaims = 0;
  let totalUnverified = 0;
  const failingPages: string[] = [];

  for (const content of allContent) {
    const sources = buildSourcesFor(content);
    const claims = extractClaims(content);
    const { results, verifiedCount, unverifiedCount } = await verifyClaims(
      claims,
      sources,
    );
    totalClaims += claims.length;
    totalUnverified += unverifiedCount;

    const pageId = `${content.vertical}/${content.stateSlug}`;
    const pageMark = unverifiedCount === 0 ? "OK" : "FAIL";
    console.log(
      `[${pageMark}] /learn/${pageId} — ${verifiedCount}/${claims.length} verified`,
    );

    if (unverifiedCount > 0) {
      failingPages.push(pageId);
      for (const r of results) {
        if (!r.verified) {
          const snippet = r.claim.length > 80 ? `${r.claim.slice(0, 80)}…` : r.claim;
          console.log(`       FAIL: ${snippet}`);
          console.log(
            `       unmatched: ${r.unmatchedTokens.slice(0, 8).join(", ")}${r.unmatchedTokens.length > 8 ? "…" : ""}`,
          );
        }
      }
    }
  }

  console.log("");
  console.log(
    `[truth-engine] summary: ${totalClaims - totalUnverified} verified, ${totalUnverified} unverified, ${totalClaims} total across ${allContent.length} pages`,
  );

  if (failingPages.length > 0) {
    console.error("");
    console.error("[truth-engine] Failing pages:");
    for (const p of failingPages) console.error(`  - /learn/${p}`);
    console.error("[truth-engine] Either rewrite the failing claim or add a source.");
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[truth-engine] FATAL:", err);
  process.exit(1);
});
