/**
 * Pillar 9.4 — embedding batching test.
 *
 * The new generateQueryEmbeddingsBatch helper should:
 *   - Return an empty array on empty input.
 *   - Drop empty strings while preserving original positions.
 *   - Return null when the API itself fails (network / 429).
 *   - Return one embedding per non-empty input on success.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("../../server/utils/openaiClient", () => ({
  getOpenAIClient: () => ({
    embeddings: { create: mockCreate },
  }),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const FAKE_EMB = new Array(1536).fill(0.1);

describe("Pillar 9.4 — generateQueryEmbeddingsBatch", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns an empty array for empty input", async () => {
    const { generateQueryEmbeddingsBatch } = await import(
      "../../server/services/embeddingClient"
    );
    const out = await generateQueryEmbeddingsBatch([]);
    expect(out).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("submits all non-empty texts in a single API call", async () => {
    mockCreate.mockResolvedValueOnce({
      data: [
        { embedding: FAKE_EMB },
        { embedding: FAKE_EMB },
        { embedding: FAKE_EMB },
      ],
    });
    const { generateQueryEmbeddingsBatch } = await import(
      "../../server/services/embeddingClient"
    );
    const out = await generateQueryEmbeddingsBatch(["a", "b", "c"]);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(3);
    expect(out![0]?.length).toBe(1536);
  });

  it("returns null aligned positions for empty-string inputs without API call", async () => {
    mockCreate.mockResolvedValueOnce({
      data: [{ embedding: FAKE_EMB }, { embedding: FAKE_EMB }],
    });
    const { generateQueryEmbeddingsBatch } = await import(
      "../../server/services/embeddingClient"
    );
    const out = await generateQueryEmbeddingsBatch(["a", "", "c"]);
    expect(out).not.toBeNull();
    expect(out![0]?.length).toBe(1536);
    expect(out![1]).toBeNull();
    expect(out![2]?.length).toBe(1536);
  });

  it("returns null when the API call throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("rate limit"));
    const { generateQueryEmbeddingsBatch } = await import(
      "../../server/services/embeddingClient"
    );
    const out = await generateQueryEmbeddingsBatch(["a", "b"]);
    expect(out).toBeNull();
  });
});
