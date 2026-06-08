// ============================================================================
// SERVER/SERVICES/PAX/LANDKNOWLEDGE/RETRIEVAL.TEST.TS
// ----------------------------------------------------------------------------
// Andrei (Tahoe E5) — unit tests for the land-knowledge retrieval service +
// the citation/attribution contract. Mocks Voyage (embedTexts) and db.execute
// so no API key or DB is needed.
//
// Asserts:
//  - citations come from the AUTHORED card, not the DB snippet (drift-proof);
//  - a stale source_ref (corpus changed) is dropped — never an un-citable card;
//  - the min-similarity filter drops off-topic matches;
//  - fail-open: a Voyage error or a DB error returns [] (never throws);
//  - the tool payload ALWAYS carries the attribution contract.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const embedMock = vi.fn();
vi.mock("../../embeddings/voyageClient", () => ({
  embedTexts: (...args: any[]) => embedMock(...args),
}));

const executeMock = vi.fn();
vi.mock("../../../db", () => ({
  db: { execute: (...args: any[]) => executeMock(...args) },
}));

import {
  retrieveLandKnowledge,
  buildLandKnowledgePayload,
  LAND_KNOWLEDGE_ATTRIBUTION_CONTRACT,
} from "./retrieval";
import { getLandKnowledgeCard } from "./corpus";

function okEmbed() {
  embedMock.mockResolvedValue({
    embeddings: [[0.1, 0.2, 0.3]],
    model: "voyage-3-large",
    dim: 3,
    inputTokens: 5,
    totalCostUsd: 0,
  });
}

function dbRows(rows: Array<{ source_ref: string; similarity: number }>) {
  executeMock.mockResolvedValue({ rows });
}

beforeEach(() => {
  embedMock.mockReset();
  executeMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("retrieveLandKnowledge", () => {
  it("re-hydrates citation + body from the authored card, not the DB snippet", async () => {
    okEmbed();
    dbRows([{ source_ref: "flood-zone-ae", similarity: 0.82 }]);

    const out = await retrieveLandKnowledge("what does Zone AE mean for building");
    expect(out).toHaveLength(1);

    const authored = getLandKnowledgeCard("flood-zone-ae")!;
    expect(out[0].card.citation).toBe(authored.citation);
    expect(out[0].card.body).toBe(authored.body);
    expect(out[0].card.citation).toMatch(/FEMA/);
    expect(out[0].similarityScore).toBeCloseTo(0.82, 5);
  });

  it("queries the global (organization_id IS NULL) land_knowledge namespace", async () => {
    okEmbed();
    dbRows([{ source_ref: "soil-perc-test", similarity: 0.7 }]);

    await retrieveLandKnowledge("perc test septic");

    // The SQL fragment is a drizzle sql`` object; stringify its query chunks.
    const sqlArg = executeMock.mock.calls[0][0];
    const rendered = JSON.stringify(sqlArg);
    expect(rendered).toContain("land_knowledge");
    expect(rendered).toContain("organization_id IS NULL");
  });

  it("drops a stale source_ref that no longer maps to a live card", async () => {
    okEmbed();
    dbRows([
      { source_ref: "flood-zone-ae", similarity: 0.8 },
      { source_ref: "deleted-card-xyz", similarity: 0.79 },
    ]);

    const out = await retrieveLandKnowledge("flood zone");
    // Only the live card survives — never surface an un-citable card.
    expect(out.map((r) => r.card.id)).toEqual(["flood-zone-ae"]);
  });

  it("filters out matches below the min-similarity threshold", async () => {
    okEmbed();
    dbRows([
      { source_ref: "flood-zone-ae", similarity: 0.6 },
      { source_ref: "soil-perc-test", similarity: 0.1 }, // below default 0.25
    ]);

    const out = await retrieveLandKnowledge("flood zone", { minSimilarity: 0.25 });
    expect(out.map((r) => r.card.id)).toEqual(["flood-zone-ae"]);
  });

  it("fail-opens to [] when Voyage embedding throws", async () => {
    embedMock.mockRejectedValue(new Error("voyage down"));
    const out = await retrieveLandKnowledge("anything");
    expect(out).toEqual([]);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("fail-opens to [] when the DB query throws", async () => {
    okEmbed();
    executeMock.mockRejectedValue(new Error("db down"));
    const out = await retrieveLandKnowledge("anything");
    expect(out).toEqual([]);
  });

  it("returns [] for an empty / too-short query without calling Voyage", async () => {
    const out = await retrieveLandKnowledge("");
    expect(out).toEqual([]);
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("caps topK at 8", async () => {
    okEmbed();
    dbRows([{ source_ref: "flood-zone-ae", similarity: 0.9 }]);
    await retrieveLandKnowledge("flood", { topK: 50 });
    const rendered = JSON.stringify(executeMock.mock.calls[0][0]);
    // The LIMIT param is bound; 50 must have been clamped to 8.
    expect(rendered).toContain("8");
    expect(rendered).not.toContain("50");
  });
});

describe("buildLandKnowledgePayload — citation/attribution contract", () => {
  it("always carries the attribution contract, even with no cards", () => {
    const payload = buildLandKnowledgePayload([]);
    expect(payload.found).toBe(false);
    expect(payload.cards).toEqual([]);
    expect(payload.attributionContract).toBe(LAND_KNOWLEDGE_ATTRIBUTION_CONTRACT);
  });

  it("the contract forbids blending a card into a parcel-specific assertion", () => {
    // The literal contract text is load-bearing — the model reads it inline.
    expect(LAND_KNOWLEDGE_ATTRIBUTION_CONTRACT).toMatch(/NEVER/);
    expect(LAND_KNOWLEDGE_ATTRIBUTION_CONTRACT.toLowerCase()).toContain("parcel");
    expect(LAND_KNOWLEDGE_ATTRIBUTION_CONTRACT.toLowerCase()).toContain("citation");
  });

  it("every surfaced card carries a non-empty citation", () => {
    const card = getLandKnowledgeCard("sf-usury-cap")!;
    const payload = buildLandKnowledgePayload([{ card, similarityScore: 0.7 }]);
    expect(payload.found).toBe(true);
    expect(payload.cards).toHaveLength(1);
    expect(payload.cards[0].citation.length).toBeGreaterThan(0);
    expect(payload.cards[0].id).toBe("sf-usury-cap");
    expect(payload.cards[0].similarity).toBe(0.7);
  });
});

describe("corpus integrity", () => {
  it("every card has a non-empty citation (truth-engine: claims are attributable)", async () => {
    const { LAND_KNOWLEDGE_CARDS } = await import("./corpus");
    for (const c of LAND_KNOWLEDGE_CARDS) {
      expect(c.citation.trim().length, `card ${c.id} missing citation`).toBeGreaterThan(0);
      expect(c.body.trim().length, `card ${c.id} missing body`).toBeGreaterThan(0);
    }
  });

  it("card ids are unique (source_ref is the pgvector natural key)", async () => {
    const { LAND_KNOWLEDGE_CARDS } = await import("./corpus");
    const ids = LAND_KNOWLEDGE_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
