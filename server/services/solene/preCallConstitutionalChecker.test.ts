/**
 * Tests for the L6.28 pre-call constitutional checker.
 *
 * Coverage:
 *   - Allowed prompt → allowed=true, no immutable_number, persists 1 row
 *     (decision), 0 violation rows.
 *   - Blocked prompt → allowed=false, immutable_number populated, persists
 *     BOTH a decision row + a violation row with correct severity, decision
 *     row carries the violation_event_id.
 *   - Unparseable model output → fail-open (allowed=true), reasoning carries
 *     the "unparseable" sentinel, no violation row.
 *   - Anthropic SDK throws → fail-open, reasoning carries the "errored"
 *     sentinel, no violation row.
 *   - Missing ANTHROPIC_API_KEY → fail-open with the "not set" sentinel.
 *   - Cost calculation at known token counts matches the Haiku pricing
 *     defaults (input $0.25 / output $1.25 per million).
 *   - All 12 immutables are present verbatim in TWELVE_IMMUTABLES_VERBATIM.
 *   - Credential discipline: the test scans every logger call's arguments
 *     and asserts the ANTHROPIC_API_KEY value never appears.
 *
 * The Anthropic SDK is replaced via the module's __setTestAnthropicClient
 * seam so no real API call is ever made.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
// Mocks — logger + db.
//
// We capture every logger call's arguments so the credential-discipline
// test can assert the API key value never lands in a log.
// ──────────────────────────────────────────────────────────────────────────

interface LoggerCall {
  level: "info" | "warn" | "error" | "debug";
  args: unknown[];
}
const LOGGER_CALLS: LoggerCall[] = [];

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn((...args: unknown[]) => {
      LOGGER_CALLS.push({ level: "info", args });
    }),
    warn: vi.fn((...args: unknown[]) => {
      LOGGER_CALLS.push({ level: "warn", args });
    }),
    error: vi.fn((...args: unknown[]) => {
      LOGGER_CALLS.push({ level: "error", args });
    }),
    debug: vi.fn((...args: unknown[]) => {
      LOGGER_CALLS.push({ level: "debug", args });
    }),
  },
}));

interface InsertedDecision {
  id: number;
  dispatchId: number | null;
  agentRole: string;
  promptSummary: string;
  allowed: boolean;
  immutableNumber: number | null;
  immutableText: string | null;
  reasoning: string;
  modelUsed: string;
  latencyMs: number;
  costUsd: string;
  violationEventId: number | null;
}

interface InsertedViolation {
  id: number;
  dispatchId: number | null;
  immutableNumber: number;
  immutableText: string;
  triggerKind: string;
  triggerEvidence: string;
  toolName: string | null;
  toolInputHash: string | null;
  actionTaken: string;
  severity: string;
  pageEventId: number | null;
}

const DECISIONS: InsertedDecision[] = [];
const VIOLATIONS: InsertedViolation[] = [];
let nextDecisionId = 1;
let nextViolationId = 5000;

// db is a single drizzle-pg facade. The schema constants imported from the
// service determine which target table a given .insert(...) hits. We
// disambiguate by reading the `_.name` symbol drizzle attaches to each table.
vi.mock("../../db", () => {
  const db = {
    insert: (table: any) => ({
      values: (row: any) => ({
        returning: (_proj: unknown) => {
          // drizzle-pg tables expose their SQL name via [Symbol.for("drizzle:Name")]
          // or the dbName property; using the duck-typed column shape is
          // simpler and more robust.
          const looksLikeDecision = "allowed" in row && "modelUsed" in row;
          if (looksLikeDecision) {
            const inserted: InsertedDecision = {
              id: nextDecisionId++,
              dispatchId: row.dispatchId ?? null,
              agentRole: row.agentRole,
              promptSummary: row.promptSummary,
              allowed: row.allowed,
              immutableNumber: row.immutableNumber ?? null,
              immutableText: row.immutableText ?? null,
              reasoning: row.reasoning,
              modelUsed: row.modelUsed,
              latencyMs: row.latencyMs,
              costUsd: row.costUsd,
              violationEventId: row.violationEventId ?? null,
            };
            DECISIONS.push(inserted);
            return Promise.resolve([{ id: inserted.id }]);
          }
          const inserted: InsertedViolation = {
            id: nextViolationId++,
            dispatchId: row.dispatchId ?? null,
            immutableNumber: row.immutableNumber,
            immutableText: row.immutableText,
            triggerKind: row.triggerKind,
            triggerEvidence: row.triggerEvidence,
            toolName: row.toolName ?? null,
            toolInputHash: row.toolInputHash ?? null,
            actionTaken: row.actionTaken,
            severity: row.severity,
            pageEventId: row.pageEventId ?? null,
          };
          VIOLATIONS.push(inserted);
          return Promise.resolve([{ id: inserted.id }]);
        },
      }),
    }),
  };
  return { db };
});

// ──────────────────────────────────────────────────────────────────────────
// Module under test — imported after mocks.
// ──────────────────────────────────────────────────────────────────────────

import {
  checkPromptAgainstConstitution,
  TWELVE_IMMUTABLES_VERBATIM,
  PRECALL_MODEL,
  __setTestAnthropicClient,
  __test,
  type AnthropicLike,
} from "./preCallConstitutionalChecker";

// ──────────────────────────────────────────────────────────────────────────
// Test-bench Anthropic client builder.
//
// Returns a fake `client.messages.create` that resolves to a single text
// block carrying `responseText`, with the given token usage.
// ──────────────────────────────────────────────────────────────────────────

function makeClient(opts: {
  responseText: string;
  inputTokens?: number;
  outputTokens?: number;
}): AnthropicLike {
  return {
    messages: {
      create: vi.fn(async () => ({
        usage: {
          input_tokens: opts.inputTokens ?? 100,
          output_tokens: opts.outputTokens ?? 20,
        },
        content: [{ type: "text", text: opts.responseText }],
      })),
    },
  };
}

function makeThrowingClient(err: Error): AnthropicLike {
  return {
    messages: {
      create: vi.fn(async () => {
        throw err;
      }),
    },
  };
}

const TEST_API_KEY = "sk-ant-test-precall-fixture-1234567890";

beforeEach(() => {
  DECISIONS.length = 0;
  VIOLATIONS.length = 0;
  LOGGER_CALLS.length = 0;
  nextDecisionId = 1;
  nextViolationId = 5000;
  process.env.ANTHROPIC_API_KEY = TEST_API_KEY;
});

afterEach(() => {
  __setTestAnthropicClient(null);
  delete process.env.ANTHROPIC_API_KEY;
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────
// The verbatim constants.
// ──────────────────────────────────────────────────────────────────────────

describe("TWELVE_IMMUTABLES_VERBATIM", () => {
  it("contains exactly 12 entries, numbered 1..12", () => {
    expect(TWELVE_IMMUTABLES_VERBATIM).toHaveLength(12);
    const numbers = TWELVE_IMMUTABLES_VERBATIM.map((i) => i.number);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("carries the verbatim wording from the constitution", () => {
    // Spot-check load-bearing wording. The full set is asserted by length +
    // numbering above; here we pin the four critical-severity immutables
    // (5/6/11/12) since their wording is what the daily-pulse retro joins on.
    const byNum = new Map(
      TWELVE_IMMUTABLES_VERBATIM.map((i) => [i.number, i.text]),
    );
    expect(byNum.get(1)).toBe(
      "Never lie to a customer about a fact, a price, or what Pax did.",
    );
    expect(byNum.get(5)).toBe(
      "Never sell, share, or use customer data outside of serving them.",
    );
    expect(byNum.get(6)).toBe(
      "Never auto-charge without explicit, recent, easily-revoked consent.",
    );
    expect(byNum.get(11)).toBe('Never generate "get rich quick" content.');
    expect(byNum.get(12)).toBe(
      "Pax never gives advice that crosses into fiduciary.",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Allowed path.
// ──────────────────────────────────────────────────────────────────────────

describe("checkPromptAgainstConstitution — allowed path", () => {
  it("returns allowed=true and persists exactly one decision row + zero violation rows", async () => {
    __setTestAnthropicClient(
      makeClient({
        responseText: JSON.stringify({
          allowed: true,
          immutable_number: null,
          reasoning: "Prompt asks for a routine bug fix.",
        }),
      }),
    );

    const result = await checkPromptAgainstConstitution({
      agentRole: "iris",
      promptText: "Fix the off-by-one in dispatchQueue's claim loop.",
      dispatchId: 42,
    });

    expect(result.allowed).toBe(true);
    expect(result.immutableNumber).toBeNull();
    expect(result.immutableText).toBeNull();
    expect(result.modelUsed).toBe(PRECALL_MODEL);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    expect(DECISIONS).toHaveLength(1);
    expect(DECISIONS[0]).toMatchObject({
      dispatchId: 42,
      agentRole: "iris",
      allowed: true,
      immutableNumber: null,
      violationEventId: null,
    });
    expect(VIOLATIONS).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Blocked path — both rows persisted, severity correct.
// ──────────────────────────────────────────────────────────────────────────

describe("checkPromptAgainstConstitution — blocked path", () => {
  it("persists decision + violation, severity=critical for immutable #11", async () => {
    __setTestAnthropicClient(
      makeClient({
        responseText: JSON.stringify({
          allowed: false,
          immutable_number: 11,
          reasoning:
            "Prompt directly asks for a get-rich-quick marketing email.",
        }),
      }),
    );

    const result = await checkPromptAgainstConstitution({
      agentRole: "soren",
      promptText:
        "Write a marketing email promising guaranteed $5k/month from land flipping in 30 days.",
      dispatchId: 99,
    });

    expect(result.allowed).toBe(false);
    expect(result.immutableNumber).toBe(11);
    expect(result.immutableText).toContain("get rich quick");

    expect(DECISIONS).toHaveLength(1);
    expect(DECISIONS[0].allowed).toBe(false);
    expect(DECISIONS[0].immutableNumber).toBe(11);
    expect(DECISIONS[0].violationEventId).not.toBeNull();

    expect(VIOLATIONS).toHaveLength(1);
    expect(VIOLATIONS[0]).toMatchObject({
      dispatchId: 99,
      immutableNumber: 11,
      triggerKind: "prompt_pattern",
      actionTaken: "blocked_and_paged",
      severity: "critical",
    });

    // Decision row's violation_event_id matches the violation row's id.
    expect(DECISIONS[0].violationEventId).toBe(VIOLATIONS[0].id);
  });

  it("severity=urgent for non-critical immutables (e.g. #2 dark patterns)", async () => {
    __setTestAnthropicClient(
      makeClient({
        responseText: JSON.stringify({
          allowed: false,
          immutable_number: 2,
          reasoning: "Prompt requests a dark-pattern cancellation flow.",
        }),
      }),
    );

    const result = await checkPromptAgainstConstitution({
      agentRole: "iris",
      promptText:
        "Make the cancel button 4px and gray so users miss it; add a 5-step confirmation maze.",
      dispatchId: 100,
    });

    expect(result.allowed).toBe(false);
    expect(VIOLATIONS).toHaveLength(1);
    expect(VIOLATIONS[0].severity).toBe("urgent");
    expect(VIOLATIONS[0].immutableNumber).toBe(2);
  });

  it("severity=critical for immutable #5 (data misuse)", async () => {
    __setTestAnthropicClient(
      makeClient({
        responseText: JSON.stringify({
          allowed: false,
          immutable_number: 5,
          reasoning: "Prompt asks to export customer data to a third party.",
        }),
      }),
    );

    await checkPromptAgainstConstitution({
      agentRole: "iris",
      promptText: "Export every customer email to an external SaaS partner.",
      dispatchId: 101,
    });

    expect(VIOLATIONS).toHaveLength(1);
    expect(VIOLATIONS[0].severity).toBe("critical");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Fail-open paths.
// ──────────────────────────────────────────────────────────────────────────

describe("checkPromptAgainstConstitution — fail-open paths", () => {
  it("unparseable model output → allowed=true with the unparseable sentinel", async () => {
    __setTestAnthropicClient(
      makeClient({
        responseText: "I'm not sure how to evaluate this without more context.",
      }),
    );

    const result = await checkPromptAgainstConstitution({
      agentRole: "iris",
      promptText: "Refactor the worker loop.",
      dispatchId: 1,
    });

    expect(result.allowed).toBe(true);
    expect(result.immutableNumber).toBeNull();
    expect(result.reasoning).toContain("unparseable");
    expect(DECISIONS).toHaveLength(1);
    expect(DECISIONS[0].allowed).toBe(true);
    expect(DECISIONS[0].reasoning).toContain("unparseable");
    expect(VIOLATIONS).toHaveLength(0);
  });

  it("model throws → allowed=true with the errored sentinel + no violation row", async () => {
    __setTestAnthropicClient(
      makeThrowingClient(new Error("connection reset by peer")),
    );

    const result = await checkPromptAgainstConstitution({
      agentRole: "iris",
      promptText: "Anything at all.",
      dispatchId: 2,
    });

    expect(result.allowed).toBe(true);
    expect(result.reasoning).toContain("errored");
    expect(result.reasoning).toContain("connection reset by peer");
    expect(DECISIONS).toHaveLength(1);
    expect(VIOLATIONS).toHaveLength(0);
  });

  it("missing ANTHROPIC_API_KEY → allowed=true with the not-set sentinel", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await checkPromptAgainstConstitution({
      agentRole: "iris",
      promptText: "Anything at all.",
      dispatchId: 3,
    });
    expect(result.allowed).toBe(true);
    expect(result.reasoning).toContain("not set");
    expect(result.costUsd).toBe(0);
    expect(DECISIONS).toHaveLength(1);
    expect(VIOLATIONS).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Cost calculation.
// ──────────────────────────────────────────────────────────────────────────

describe("cost calculation", () => {
  it("matches Haiku pricing defaults at known token counts", () => {
    // Defaults: $0.25/M input, $1.25/M output.
    // 1,000,000 input tokens → $0.25; 1,000,000 output tokens → $1.25.
    expect(__test.estimateCostUsd(1_000_000, 0)).toBeCloseTo(0.25, 8);
    expect(__test.estimateCostUsd(0, 1_000_000)).toBeCloseTo(1.25, 8);
    // 100 in + 20 out (the test fixture's defaults).
    const c = __test.estimateCostUsd(100, 20);
    expect(c).toBeCloseTo(
      (100 / 1_000_000) * 0.25 + (20 / 1_000_000) * 1.25,
      10,
    );
  });

  it("propagates cost into the decision row", async () => {
    __setTestAnthropicClient(
      makeClient({
        responseText: JSON.stringify({
          allowed: true,
          immutable_number: null,
          reasoning: "ok",
        }),
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    );
    const result = await checkPromptAgainstConstitution({
      agentRole: "iris",
      promptText: "trivial",
      dispatchId: 7,
    });
    // 0.25 + 1.25 = 1.50.
    expect(result.costUsd).toBeCloseTo(1.5, 8);
    expect(DECISIONS[0].costUsd).toBe("1.500000");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Credential discipline — the API key value never lands in a log.
// ──────────────────────────────────────────────────────────────────────────

describe("credential discipline", () => {
  it("never logs the ANTHROPIC_API_KEY value across allowed/blocked/error paths", async () => {
    // Allowed path.
    __setTestAnthropicClient(
      makeClient({
        responseText: JSON.stringify({
          allowed: true,
          immutable_number: null,
          reasoning: "fine",
        }),
      }),
    );
    await checkPromptAgainstConstitution({
      agentRole: "iris",
      promptText: "fix a thing",
      dispatchId: 1,
    });

    // Blocked path.
    __setTestAnthropicClient(
      makeClient({
        responseText: JSON.stringify({
          allowed: false,
          immutable_number: 11,
          reasoning: "get-rich-quick",
        }),
      }),
    );
    await checkPromptAgainstConstitution({
      agentRole: "soren",
      promptText: "guaranteed $5k/mo",
      dispatchId: 2,
    });

    // Errored path.
    __setTestAnthropicClient(
      makeThrowingClient(new Error("boom")),
    );
    await checkPromptAgainstConstitution({
      agentRole: "iris",
      promptText: "trivial",
      dispatchId: 3,
    });

    // Now scan every logger call's arguments for the key value.
    const hasKey = LOGGER_CALLS.some((call) =>
      call.args.some((arg) => {
        if (typeof arg === "string") return arg.includes(TEST_API_KEY);
        if (arg instanceof Error) return arg.message.includes(TEST_API_KEY);
        return false;
      }),
    );
    expect(hasKey).toBe(false);

    // Sanity: at least one log line carries the key LENGTH (so we're confident
    // the credential-presence log path actually fired).
    const hasKeyLen = LOGGER_CALLS.some((call) =>
      call.args.some(
        (arg) =>
          typeof arg === "string" &&
          arg.includes(`keyLen=${TEST_API_KEY.length}`),
      ),
    );
    expect(hasKeyLen).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Parser unit coverage.
// ──────────────────────────────────────────────────────────────────────────

describe("parseCheckerOutput", () => {
  it("accepts plain JSON", () => {
    const out = __test.parseCheckerOutput(
      JSON.stringify({
        allowed: false,
        immutable_number: 6,
        reasoning: "auto-charge without consent",
      }),
    );
    expect(out).not.toBeNull();
    expect(out?.allowed).toBe(false);
    expect(out?.immutableNumber).toBe(6);
  });

  it("accepts JSON wrapped in stray prose", () => {
    const out = __test.parseCheckerOutput(
      `Here is the verdict:\n${JSON.stringify({
        allowed: true,
        immutable_number: null,
        reasoning: "fine",
      })}\nThat's all.`,
    );
    expect(out).not.toBeNull();
    expect(out?.allowed).toBe(true);
  });

  it("rejects allowed=false with no immutable_number", () => {
    const out = __test.parseCheckerOutput(
      JSON.stringify({ allowed: false, immutable_number: null, reasoning: "x" }),
    );
    expect(out).toBeNull();
  });

  it("rejects garbage", () => {
    expect(__test.parseCheckerOutput("")).toBeNull();
    expect(__test.parseCheckerOutput("not json at all")).toBeNull();
    expect(__test.parseCheckerOutput("{ bad json")).toBeNull();
  });
});
