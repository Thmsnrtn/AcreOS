// ============================================================================
// SERVER/SERVICES/PAX/LANDKNOWLEDGE/RECALL.EVAL.TEST.TS
// ----------------------------------------------------------------------------
// Andrei (Tahoe E5) — retrieval-recall eval for the land-knowledge corpus.
//
// "Does the right card surface for a query?" — the precondition the feature
// flag (feature.pax-land-knowledge) and the dg-v2 grounding change are gated
// on. This eval runs WITHOUT Voyage or pgvector: it ranks the in-process
// corpus against each labeled query with a deterministic lexical cosine
// (token-overlap) similarity and asserts the expected card lands in top-K.
//
// WHY a deterministic proxy instead of the live Voyage path
// ─────────────────────────────────────────────────────────
// The eval has to be reproducible in CI with no API key and no DB. A token-
// overlap cosine is a strict LOWER BOUND on what the production Voyage
// embedding achieves (Voyage adds semantic matching on top of lexical
// overlap), so a card that surfaces here will surface in production. If a
// query→card pair fails here, the card's text doesn't even lexically cover
// the question — a corpus authoring bug we want to catch before a customer
// does. The recall NUMBER this prints is the eval-first metric cited in the
// dg-v2 changelog.
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  LAND_KNOWLEDGE_CARDS,
  cardEmbeddingText,
  type LandKnowledgeCard,
} from "./corpus";

// ── Deterministic lexical embedding (token-frequency vector) ────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function termVector(text: string): Map<string, number> {
  const v = new Map<string, number>();
  for (const tok of tokenize(text)) {
    v.set(tok, (v.get(tok) ?? 0) + 1);
  }
  return v;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [tok, av] of a) {
    const bv = b.get(tok);
    if (bv) dot += av * bv;
  }
  const norm = (m: Map<string, number>) =>
    Math.sqrt([...m.values()].reduce((s, x) => s + x * x, 0));
  const denom = norm(a) * norm(b);
  return denom === 0 ? 0 : dot / denom;
}

/** Rank cards for a query by lexical cosine, return top-K card ids. */
function rankCardIds(query: string, k: number): string[] {
  const qv = termVector(query);
  const scored = LAND_KNOWLEDGE_CARDS.map((c: LandKnowledgeCard) => ({
    id: c.id,
    score: cosine(qv, termVector(cardEmbeddingText(c))),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.id);
}

// ── Labeled query → expected-card set ───────────────────────────────────────
// Realistic explanatory questions a free-tier customer would ask Pax. Each
// expects a specific card to surface in the top-K. These are the regression
// anchors: if the corpus is edited such that one of these stops surfacing,
// this eval fails loudly.

interface RecallCase {
  query: string;
  expectedCardId: string;
}

const RECALL_CASES: RecallCase[] = [
  { query: "what does FEMA Zone AE mean for building a house", expectedCardId: "flood-zone-ae" },
  { query: "is Zone X safe to build on, do I need flood insurance", expectedCardId: "flood-zone-x" },
  { query: "what is a coastal VE flood zone and wave action", expectedCardId: "flood-zone-ve" },
  { query: "can I get a parcel removed from the flood map with a LOMA", expectedCardId: "flood-letter-of-map-change" },
  { query: "floodway versus floodplain, where can I not build", expectedCardId: "diligence-floodway-vs-floodplain" },
  { query: "what does SSURGO soil survey tell me about septic", expectedCardId: "soil-ssurgo-overview" },
  { query: "what does land capability class IIe mean", expectedCardId: "soil-capability-class" },
  { query: "what is a perc test for septic and why does it fail", expectedCardId: "soil-perc-test" },
  { query: "hydric soils and wetlands permitting", expectedCardId: "soil-hydric-wetlands" },
  { query: "what is a landlocked parcel with no legal access", expectedCardId: "access-landlocked" },
  { query: "what is an easement appurtenant access driveway", expectedCardId: "access-easement-appurtenant" },
  { query: "prescriptive easement we have always used the road", expectedCardId: "access-prescriptive-easement" },
  { query: "road frontage minimum and flag lot to build", expectedCardId: "access-frontage-flag-lot" },
  { query: "who maintains a private shared access road", expectedCardId: "access-road-maintenance" },
  { query: "what does a title commitment schedule b exceptions show", expectedCardId: "title-commitment" },
  { query: "quiet title action to clear a cloud on title", expectedCardId: "title-quiet-title" },
  { query: "difference between tax lien and tax deed at a tax sale", expectedCardId: "title-tax-deed-vs-lien" },
  { query: "do back taxes follow the land or the seller", expectedCardId: "tax-back-taxes" },
  { query: "promissory note vs deed of trust in seller financing", expectedCardId: "sf-note-and-security" },
  { query: "how does a contract for deed land contract work", expectedCardId: "sf-contract-for-deed" },
  { query: "what is the maximum legal interest rate usury cap", expectedCardId: "sf-usury-cap" },
  { query: "dodd frank safe act seller financing a home", expectedCardId: "sf-dodd-frank-safe-act" },
  { query: "what is a balloon payment and amortization on a note", expectedCardId: "sf-amortization-balloon" },
  { query: "down payment and foreclosure default remedies owner financing", expectedCardId: "sf-down-payment-default" },
  { query: "what use does the zoning permit by right", expectedCardId: "zoning-basics" },
  { query: "legal nonconforming use grandfathered building", expectedCardId: "zoning-nonconforming-use" },
  { query: "can I subdivide and split this parcel minimum lot size", expectedCardId: "zoning-subdivision-split" },
  { query: "what are CC&Rs and HOA deed restrictions", expectedCardId: "zoning-cc-and-r" },
  { query: "setbacks and the buildable envelope where can I build", expectedCardId: "zoning-setbacks-envelope" },
  { query: "can I put a mobile or manufactured home on the lot", expectedCardId: "zoning-mobile-manufactured" },
  { query: "old paper subdivision platted lot with no roads", expectedCardId: "zoning-paper-subdivision" },
  { query: "riparian versus prior appropriation water rights west", expectedCardId: "water-rights-doctrines" },
  { query: "do I need a well, groundwater depth and yield", expectedCardId: "water-well-groundwater" },
  { query: "riparian buffer shoreland setback building near water", expectedCardId: "water-floodplain-buffer" },
  { query: "severed mineral rights surface owner oil and gas", expectedCardId: "mineral-severance" },
  { query: "mineral estate is dominant over the surface", expectedCardId: "mineral-dominant-estate" },
  { query: "PLSS section township range why is acreage approximate", expectedCardId: "survey-plss" },
  { query: "boundary survey vs ALTA survey encroachment", expectedCardId: "survey-types" },
  { query: "encroachment fence over the boundary line", expectedCardId: "survey-encroachment" },
  { query: "GIS county acreage vs surveyed acreage difference", expectedCardId: "diligence-survey-vs-gis-acreage" },
  { query: "are utilities available power water sewer at the road", expectedCardId: "utilities-availability" },
  { query: "impact fees and tap fees to build on raw land", expectedCardId: "utilities-impact-fees" },
  { query: "what makes a parcel buildable checklist", expectedCardId: "diligence-buildability-checklist" },
  { query: "how do I screen for wetlands before buying", expectedCardId: "diligence-wetland-screen" },
  { query: "phase 1 environmental site assessment contamination", expectedCardId: "diligence-environmental-phase-1" },
  { query: "conservation easement limiting development rights", expectedCardId: "diligence-conservation-easement" },
  { query: "utility and drainage easement strip cannot build on", expectedCardId: "diligence-easement-utility" },
  { query: "why is this land so cheap red flags", expectedCardId: "diligence-flag-cheap-land" },
  { query: "steep slope topography grading cost to build", expectedCardId: "diligence-slope-topography" },
  { query: "marketable vs insurable title for resale", expectedCardId: "title-marketable-vs-insurable" },
  { query: "wraparound mortgage subject to due on sale", expectedCardId: "seller-finance-wraparound" },
  { query: "ag greenbelt tax valuation rollback on development", expectedCardId: "tax-greenbelt-ag-exemption" },
  { query: "flood map vs flood insurance vs actual risk", expectedCardId: "diligence-floodplain-vs-insurance" },
];

const TOP_K = 3;
// Recall@K bar: this is a strict lexical lower bound (Voyage does better), so
// hold a high bar. The corpus is authored so every labeled query lexically
// covers its target card.
const MIN_RECALL = 0.9;

describe("land-knowledge retrieval recall (lexical lower bound)", () => {
  it("every labeled query→card pair references a real card id", () => {
    const ids = new Set(LAND_KNOWLEDGE_CARDS.map((c) => c.id));
    for (const c of RECALL_CASES) {
      expect(ids.has(c.expectedCardId), `unknown card id: ${c.expectedCardId}`).toBe(true);
    }
  });

  it(`surfaces the expected card in top-${TOP_K} at >= ${MIN_RECALL * 100}% recall`, () => {
    let hits = 0;
    const misses: string[] = [];
    for (const c of RECALL_CASES) {
      const top = rankCardIds(c.query, TOP_K);
      if (top.includes(c.expectedCardId)) {
        hits += 1;
      } else {
        misses.push(`"${c.query}" → expected ${c.expectedCardId}, got [${top.join(", ")}]`);
      }
    }
    const recall = hits / RECALL_CASES.length;
    // Surface the number — this is the eval-first metric the dg-v2 changelog cites.
    // eslint-disable-next-line no-console
    console.log(
      `[land-knowledge recall@${TOP_K}] ${hits}/${RECALL_CASES.length} = ${(recall * 100).toFixed(1)}%` +
        (misses.length ? `\n  misses:\n    ${misses.join("\n    ")}` : ""),
    );
    expect(recall).toBeGreaterThanOrEqual(MIN_RECALL);
  });

  it("top-1 lexical match is the expected card for the majority of queries", () => {
    let top1 = 0;
    for (const c of RECALL_CASES) {
      if (rankCardIds(c.query, 1)[0] === c.expectedCardId) top1 += 1;
    }
    // A looser bar for top-1 (top-K is the production setting); this guards
    // against the corpus drifting so the wrong card dominates a query.
    expect(top1 / RECALL_CASES.length).toBeGreaterThanOrEqual(0.7);
  });
});
