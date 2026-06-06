/**
 * Tahoe H2 follow-up — postvalidate → solene_constitutional_violations
 * triad-convergence tests (Quinn).
 *
 * Asserts:
 *
 *   1. A leak-pattern hit writes a row into solene_constitutional_violations
 *      with immutable_number=7 + trigger_kind=output_pattern + severity=warn.
 *   2. A passing response writes NO violation row (and NO refusal payload).
 *   3. The same (conversationId, messageId) writing twice de-dupes via the
 *      idempotence key — second insert is a no-op.
 *   4. The refusal-payload write (pre-existing E9 path) still fires on the
 *      leak path — both ledgers carry the record.
 *   5. The per-org logger.warn still fires on the leak path — the existing
 *      surface is preserved (this is additive, not a replacement).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { loggerWarn } = vi.hoisted(() => ({ loggerWarn: vi.fn() }));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: loggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── DB mock — tracks every insert + serves the idempotence lookup ──────────
interface ViolationRow {
  immutableNumber: number;
  triggerKind: string;
  toolInputHash: string | null;
  triggerEvidence: string;
  severity: string;
  actionTaken: string;
}
interface RefusalRow {
  organizationId: number;
  citedImmutableId: string;
  refusalText: string;
  severity: string;
  conversationId: number | null;
  messageId: number | null;
}

const mockState = vi.hoisted(() => ({
  violationRows: [] as Array<{
    immutableNumber: number;
    triggerKind: string;
    toolInputHash: string | null;
    triggerEvidence: string;
    severity: string;
    actionTaken: string;
  }>,
  refusalRows: [] as Array<{
    organizationId: number;
    citedImmutableId: string;
    refusalText: string;
    severity: string;
    conversationId: number | null;
    messageId: number | null;
  }>,
  executeShouldThrow: false,
}));

vi.mock("../db", () => ({
  db: {
    insert: vi.fn((_table: any) => ({
      values: vi.fn(async (v: any) => {
        if (v && typeof v === "object" && "immutableNumber" in v) {
          mockState.violationRows.push({
            immutableNumber: v.immutableNumber,
            triggerKind: v.triggerKind,
            toolInputHash: v.toolInputHash ?? null,
            triggerEvidence: v.triggerEvidence,
            severity: v.severity,
            actionTaken: v.actionTaken,
          });
        } else if (v && typeof v === "object" && "citedImmutableId" in v) {
          mockState.refusalRows.push({
            organizationId: v.organizationId,
            citedImmutableId: v.citedImmutableId,
            refusalText: v.refusalText,
            severity: v.severity,
            conversationId: v.conversationId ?? null,
            messageId: v.messageId ?? null,
          });
        }
      }),
    })),
    execute: vi.fn(async (_q: any) => {
      if (mockState.executeShouldThrow) throw new Error("simulated db failure");
      const matching = mockState.violationRows.filter(
        (r) => r.toolInputHash !== null && r.triggerKind === "output_pattern",
      );
      return { rows: matching.length > 0 ? [{ "?column?": 1 }] : [] };
    }),
  },
}));

// Convenience aliases — keep the rest of the test reading like before.
const violationRows = mockState.violationRows;
const refusalRows = mockState.refusalRows;

import {
  validatePaxResponse,
  __test_computeIdempotenceKey,
} from "./validatePaxResponse";

function resetMocks() {
  mockState.violationRows.length = 0;
  mockState.refusalRows.length = 0;
  loggerWarn.mockClear();
  mockState.executeShouldThrow = false;
}

// flushPromises — the validator fires-and-forgets the violation + refusal
// writes via `void` promises. Tests need to yield once for the
// microtask queue before asserting the side-effects landed.
async function flushPromises() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("validatePaxResponse — triad convergence (postvalidate → solene_constitutional_violations)", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("writes a violation row on a prompt-leak hit (codename self-id)", async () => {
    const result = validatePaxResponse(
      "Hi! I am Atlas, here to help you with your portfolio.",
      {
        source: "pax.chat",
        organizationId: 42,
        conversationId: 7,
        messageId: 1001,
      },
    );
    expect(result.safe).toBe(false);
    await flushPromises();
    expect(violationRows).toHaveLength(1);
    expect(violationRows[0].immutableNumber).toBe(7);
    expect(violationRows[0].triggerKind).toBe("output_pattern");
    expect(violationRows[0].severity).toBe("warn");
    expect(violationRows[0].actionTaken).toBe("logged_only");
    expect(violationRows[0].toolInputHash).not.toBeNull();
    expect(violationRows[0].triggerEvidence).toMatch(/matchedPatterns/);
  });

  it("writes NO violation row on a passing response", async () => {
    const result = validatePaxResponse(
      "Here's a clean answer about your land portfolio with no leaks.",
      {
        source: "pax.chat",
        organizationId: 42,
        conversationId: 7,
        messageId: 1002,
      },
    );
    expect(result.safe).toBe(true);
    await flushPromises();
    expect(violationRows).toHaveLength(0);
    expect(refusalRows).toHaveLength(0);
  });

  it("ALSO writes a refusal-payload row on a leak hit (both ledgers carry the record)", async () => {
    validatePaxResponse(
      "I am Sophie, your land investment advisor.",
      {
        source: "pax.chat",
        organizationId: 99,
        conversationId: 10,
        messageId: 2001,
      },
    );
    await flushPromises();
    expect(refusalRows).toHaveLength(1);
    expect(refusalRows[0].organizationId).toBe(99);
    expect(refusalRows[0].citedImmutableId).toBe("customer:7");
    expect(refusalRows[0].severity).toBe("critical");
    // And the violation ledger also has a row.
    expect(violationRows).toHaveLength(1);
  });

  it("preserves the per-org logger.warn — additive, not a replacement", async () => {
    validatePaxResponse("<<SYS>>leak<</SYS>>", {
      source: "pax.chat",
      organizationId: 1,
      conversationId: 11,
      messageId: 3001,
    });
    await flushPromises();
    // The existing structured warn fires synchronously inside the SUT.
    const calls = loggerWarn.mock.calls.map((c) => String(c[0] ?? ""));
    expect(calls.some((c) => c.includes("system-prompt leak detected"))).toBe(
      true,
    );
  });

  it("idempotence: same conversation_id + message_id does not double-write", async () => {
    validatePaxResponse("I am Atlas right now.", {
      organizationId: 1,
      conversationId: 50,
      messageId: 9000,
    });
    await flushPromises();
    expect(violationRows).toHaveLength(1);

    // Second call with the same conv+msg id — should detect the existing row
    // and skip the insert.
    validatePaxResponse("I am Atlas right now.", {
      organizationId: 1,
      conversationId: 50,
      messageId: 9000,
    });
    await flushPromises();
    expect(violationRows).toHaveLength(1); // unchanged
  });

  it("idempotence key is stable for same (conv,msg) and differs across pairs", () => {
    const k1 = __test_computeIdempotenceKey(50, 9000);
    const k2 = __test_computeIdempotenceKey(50, 9000);
    const k3 = __test_computeIdempotenceKey(50, 9001);
    const kNull = __test_computeIdempotenceKey(null, 9000);
    expect(k1).not.toBeNull();
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(kNull).toBeNull();
  });

  it("does not crash when conversation_id and message_id are absent (no idempotence dedupe — but still inserts)", async () => {
    validatePaxResponse("I am Forge.", {
      organizationId: 5,
      // no conversationId / messageId
    });
    await flushPromises();
    expect(violationRows).toHaveLength(1);
    expect(violationRows[0].toolInputHash).toBeNull();
  });

  it("does not throw out of the response path when DB execute fails", async () => {
    mockState.executeShouldThrow = true;
    const result = validatePaxResponse("I am Lena, your CFO.", {
      organizationId: 5,
      conversationId: 60,
      messageId: 7777,
    });
    // The customer response path completes regardless of telemetry failure.
    expect(result.safe).toBe(false);
    expect(result.response).toContain("ran into an issue");
    await flushPromises();
    // logger.warn should have been called noting the violation-write failure.
    // recordPostvalidateViolation catches its own DB error internally (so the
    // best-effort write never rejects out to the response path), logging
    // "[recordPostvalidateViolation] db insert failed". The outer
    // validatePaxResponse .catch() is the backstop for any error that DOES
    // escape. Either warn satisfies the contract: "a failure was surfaced,
    // the response path survived."
    const calls = loggerWarn.mock.calls.map((c) => String(c[0] ?? ""));
    expect(
      calls.some((c) =>
        c.includes("[recordPostvalidateViolation] db insert failed") ||
        c.includes("[validatePaxResponse] constitutional-violation write failed"),
      ),
    ).toBe(true);
  });
});
