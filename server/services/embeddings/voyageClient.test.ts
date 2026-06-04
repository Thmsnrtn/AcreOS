// ============================================================================
// SERVER/SERVICES/EMBEDDINGS/VOYAGECLIENT.TEST.TS
// ----------------------------------------------------------------------------
// Tests for the Voyage AI embeddings client.
//
// Coverage:
//   - Happy path: 3 texts → 3 embeddings of dim 1024 + estimated cost
//   - Missing API key → throws with clear message
//   - HTTP 401 → throws with status + descriptive message
//   - HTTP 429 → throws (caller can back off)
//   - Network timeout → throws via AbortController
//   - Malformed response (missing data field) → throws
//   - Dim mismatch (returned 768 instead of 1024) → throws
//   - inputType='query' vs 'document' → both produce valid output
//   - Credential discipline: API key never appears in logs (only keyLen)
//   - sanitizeForVoyage redacts sk_ / pk_ / Bearer / AKIA etc.
//   - checkVoyageStatus: returns available=false / hasApiKey=false when key unset
//   - checkVoyageStatus: returns available=true + detectedModel on successful canary
//   - estimateCost: pure math, including zero / negative input guards
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const TEST_API_KEY = "voyage-key-test-1234567890ABCDEFGH";
const DIM = 1024;

function makeVec(seed: number, dim: number = DIM): number[] {
  const vec = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    vec[i] = ((i + seed) % 7) / 100;
  }
  return vec;
}

function mockOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockErrResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

beforeEach(async () => {
  process.env.VOYAGE_API_KEY = TEST_API_KEY;
  delete process.env.VOYAGE_API_BASE;
  delete process.env.VOYAGE_EMBEDDING_MODEL;
  delete process.env.VOYAGE_TIMEOUT_MS;
  delete process.env.VOYAGE_PRICE_PER_M_TOKENS;
  vi.restoreAllMocks();
  // Re-mount the logger mock after restoreAllMocks (which clears the spies).
  const loggerModule = await import("../../utils/logger");
  (loggerModule.logger.info as unknown as { mockClear?: () => void }).mockClear?.();
  (loggerModule.logger.warn as unknown as { mockClear?: () => void }).mockClear?.();
  // Reset canary cache between tests so status checks behave deterministically.
  const mod = await import("./voyageClient");
  mod.__resetVoyageCanaryForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.VOYAGE_API_KEY;
});

// ============================================================================
// estimateCost — pure helper
// ============================================================================

describe("estimateCost", () => {
  it("computes cost at the default rate (0.18 USD per 1M tokens)", async () => {
    const { estimateCost } = await import("./voyageClient");
    // 1M tokens at $0.18 = $0.18
    expect(estimateCost(1_000_000)).toBeCloseTo(0.18, 6);
    // 1k tokens = $0.00018
    expect(estimateCost(1_000)).toBeCloseTo(0.00018, 7);
  });

  it("returns 0 for non-positive / non-finite input", async () => {
    const { estimateCost } = await import("./voyageClient");
    expect(estimateCost(0)).toBe(0);
    expect(estimateCost(-100)).toBe(0);
    expect(estimateCost(NaN)).toBe(0);
    expect(estimateCost(Infinity)).toBe(0);
  });

  it("respects an explicit pricePerMTokens override", async () => {
    const { estimateCost } = await import("./voyageClient");
    expect(estimateCost(1_000_000, 0.5)).toBeCloseTo(0.5, 6);
  });
});

// ============================================================================
// sanitizeForVoyage — credential-shaped substring redaction
// ============================================================================

describe("sanitizeForVoyage", () => {
  it("redacts Stripe-shaped secret keys", async () => {
    const { sanitizeForVoyage } = await import("./voyageClient");
    const out = sanitizeForVoyage("token: sk_live_abc123xyz456 next");
    expect(out).not.toContain("sk_live_abc123xyz456");
    expect(out).toContain("[redacted-credential]");
  });

  it("redacts PostHog phc_ keys + GitHub ghp_ tokens + Bearer headers + AWS AKIA/ASIA", async () => {
    const { sanitizeForVoyage } = await import("./voyageClient");
    const sample =
      "phc_abcd1234EFGH ghp_zzzzzzzzzzzz Bearer abcdefgh1234 AKIA1234567890ABCD ASIA9876543210WXYZ";
    const out = sanitizeForVoyage(sample);
    expect(out).not.toContain("phc_abcd1234EFGH");
    expect(out).not.toContain("ghp_zzzzzzzzzzzz");
    expect(out).not.toContain("Bearer abcdefgh1234");
    expect(out).not.toContain("AKIA1234567890ABCD");
    expect(out).not.toContain("ASIA9876543210WXYZ");
  });

  it("leaves non-credential text untouched", async () => {
    const { sanitizeForVoyage } = await import("./voyageClient");
    const text = "The founder asked Iris to ship the dispatch queue.";
    expect(sanitizeForVoyage(text)).toBe(text);
  });
});

// ============================================================================
// embedTexts — happy path + error coverage
// ============================================================================

describe("embedTexts", () => {
  it("returns 3 embeddings of dim 1024 + token count + estimated cost on happy path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockOkResponse({
        data: [
          { embedding: makeVec(1) },
          { embedding: makeVec(2) },
          { embedding: makeVec(3) },
        ],
        usage: { total_tokens: 12 },
        model: "voyage-3-large",
      }),
    );
    const { embedTexts } = await import("./voyageClient");
    const out = await embedTexts({
      texts: ["alpha", "beta", "gamma"],
      inputType: "document",
    });
    expect(out.embeddings.length).toBe(3);
    expect(out.embeddings[0].length).toBe(DIM);
    expect(out.dim).toBe(DIM);
    expect(out.inputTokens).toBe(12);
    expect(out.model).toBe("voyage-3-large");
    expect(out.totalCostUsd).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.input_type).toBe("document");
    expect(body.input).toEqual(["alpha", "beta", "gamma"]);
  });

  it("throws with clear message when VOYAGE_API_KEY is unset", async () => {
    delete process.env.VOYAGE_API_KEY;
    const { embedTexts } = await import("./voyageClient");
    await expect(embedTexts({ texts: ["x"] })).rejects.toThrow(
      /VOYAGE_API_KEY not set/,
    );
  });

  it("throws on HTTP 401 with status + descriptive message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockErrResponse(401, "unauthorized"),
    );
    const { embedTexts } = await import("./voyageClient");
    await expect(embedTexts({ texts: ["x"] })).rejects.toThrow(/HTTP 401/);
  });

  it("throws on HTTP 429 so the caller can back off", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockErrResponse(429, "rate limited"),
    );
    const { embedTexts } = await import("./voyageClient");
    await expect(embedTexts({ texts: ["x"] })).rejects.toThrow(/HTTP 429/);
  });

  it("throws on AbortController timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });
    process.env.VOYAGE_TIMEOUT_MS = "10";
    const { embedTexts } = await import("./voyageClient");
    await expect(embedTexts({ texts: ["x"] })).rejects.toThrow(/timed out/);
  });

  it("throws on malformed response (missing data array)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockOkResponse({ usage: { total_tokens: 0 } }),
    );
    const { embedTexts } = await import("./voyageClient");
    await expect(embedTexts({ texts: ["x"] })).rejects.toThrow(
      /missing `data` array/,
    );
  });

  it("throws on dim mismatch (returned 768 instead of 1024)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockOkResponse({
        data: [{ embedding: makeVec(1, 768) }],
        usage: { total_tokens: 1 },
      }),
    );
    const { embedTexts } = await import("./voyageClient");
    await expect(embedTexts({ texts: ["x"] })).rejects.toThrow(/dim mismatch/);
  });

  it("supports inputType='query' (separate from 'document') — both produce valid output", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockOkResponse({
        data: [{ embedding: makeVec(1) }],
        usage: { total_tokens: 5 },
        model: "voyage-3-large",
      }),
    );
    const { embedTexts } = await import("./voyageClient");

    const docOut = await embedTexts({ texts: ["x"], inputType: "document" });
    expect(docOut.embeddings[0].length).toBe(DIM);
    const docBody = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(docBody.input_type).toBe("document");

    const queryOut = await embedTexts({ texts: ["x"], inputType: "query" });
    expect(queryOut.embeddings[0].length).toBe(DIM);
    const queryBody = JSON.parse(
      (fetchSpy.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(queryBody.input_type).toBe("query");
  });

  it("throws when texts is empty", async () => {
    const { embedTexts } = await import("./voyageClient");
    await expect(embedTexts({ texts: [] })).rejects.toThrow(/non-empty/);
  });

  it("sanitizes credential-shaped substrings before sending to Voyage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockOkResponse({
        data: [{ embedding: makeVec(1) }],
        usage: { total_tokens: 5 },
      }),
    );
    const { embedTexts } = await import("./voyageClient");
    await embedTexts({
      texts: ["user pasted sk_live_supersecret123 in chat"],
    });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.input[0]).not.toContain("sk_live_supersecret123");
    expect(body.input[0]).toContain("[redacted-credential]");
  });
});

// ============================================================================
// Credential discipline — API key never appears in logs
// ============================================================================

describe("credential discipline", () => {
  it("logs only keyLen, never the API key value, across success + failure paths", async () => {
    // Success path.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockOkResponse({
        data: [{ embedding: makeVec(1) }],
        usage: { total_tokens: 1 },
      }),
    );
    const { embedTexts } = await import("./voyageClient");
    await embedTexts({ texts: ["x"] });

    const { logger } = await import("../../utils/logger");
    const allCalls = [
      ...(logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls,
      ...(logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls,
    ];
    const serialized = JSON.stringify(allCalls);
    expect(serialized).not.toContain(TEST_API_KEY);
    // At least one call carried a keyLen field on the success path.
    expect(serialized).toMatch(/"keyLen":\s*\d+/);
  });

  it("does not leak the API key on HTTP 401 failure path", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockErrResponse(401, "unauthorized"),
    );
    const { embedTexts } = await import("./voyageClient");
    await expect(embedTexts({ texts: ["x"] })).rejects.toThrow();
    const { logger } = await import("../../utils/logger");
    const allCalls = [
      ...(logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls,
      ...(logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls,
      ...(logger.error as unknown as { mock: { calls: unknown[][] } }).mock.calls,
    ];
    const serialized = JSON.stringify(allCalls);
    expect(serialized).not.toContain(TEST_API_KEY);
  });
});

// ============================================================================
// checkVoyageStatus
// ============================================================================

describe("checkVoyageStatus", () => {
  it("returns available=false / hasApiKey=false when VOYAGE_API_KEY is unset", async () => {
    delete process.env.VOYAGE_API_KEY;
    const { checkVoyageStatus } = await import("./voyageClient");
    const status = await checkVoyageStatus();
    expect(status.available).toBe(false);
    expect(status.hasApiKey).toBe(false);
  });

  it("returns available=true + detectedModel when the canary embed succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockOkResponse({
        data: [{ embedding: makeVec(1) }],
        usage: { total_tokens: 1 },
        model: "voyage-3-large",
      }),
    );
    const { checkVoyageStatus } = await import("./voyageClient");
    const status = await checkVoyageStatus();
    expect(status.available).toBe(true);
    expect(status.hasApiKey).toBe(true);
    expect(status.apiKeyLen).toBe(TEST_API_KEY.length);
    expect(status.detectedModel).toBe("voyage-3-large");
    expect(status.lastVerifiedAt).toBeInstanceOf(Date);
  });

  it("returns available=false but hasApiKey=true when the canary embed fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockErrResponse(500, "internal error"),
    );
    const { checkVoyageStatus } = await import("./voyageClient");
    const status = await checkVoyageStatus();
    expect(status.available).toBe(false);
    expect(status.hasApiKey).toBe(true);
    expect(status.apiKeyLen).toBe(TEST_API_KEY.length);
  });
});
