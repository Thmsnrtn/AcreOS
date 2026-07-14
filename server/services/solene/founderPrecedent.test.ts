/**
 * Tests for the founder-precedent write-back (Jarvis 2.3).
 *
 * Pins:
 *  - ADMISSION CONTROL: plain no-reason approvals are NOT admitted; a
 *    rejection/override with a reason ≥ 20 chars IS; an explicit chosen
 *    option IS (regardless of outcome).
 *  - contentHash dedupe: unchanged content skips the re-embed + write.
 *  - Changed content updates the existing row in place (natural key).
 *  - FAIL-OPEN: a DB error logs a warning and returns — never throws.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Embedding helper stub — the Voyage-with-fallback contract is pinned by
// learningLoop's own suite; here we only care that it is (not) called.
const embedMock = vi.fn(async (_text: string) => ({
  vector: new Array(1024).fill(0.01),
  model: "voyage-3-large",
}));
vi.mock("./learningLoop", () => ({
  embedDocumentTextFailOpen: (text: string) => embedMock(text),
}));

// ─── DB mock ────────────────────────────────────────────────────────────────

let EXISTING: Array<{ id: number; contentHash: string }> = [];
let throwOnSelect = false;
const INSERTS: Array<Record<string, any>> = [];
const UPDATES: Array<Record<string, any>> = [];

vi.mock("../../db", () => {
  const db = {
    select: (_proj?: any) => ({
      from: (_t: any) => ({
        where: (_w: any) => ({
          limit: async (_n: number) => {
            if (throwOnSelect) throw new Error("simulated select failure");
            return EXISTING;
          },
        }),
      }),
    }),
    insert: (_t: any) => ({
      values: async (row: Record<string, any>) => {
        INSERTS.push(row);
      },
    }),
    update: (_t: any) => ({
      set: (values: Record<string, any>) => ({
        where: async (_w: any) => {
          UPDATES.push(values);
        },
      }),
    }),
  };
  return { db };
});

import {
  recordFounderPrecedent,
  composePrecedentText,
  PRECEDENT_MIN_REASON_CHARS,
  type FounderPrecedentInput,
} from "./founderPrecedent";
import { logger } from "../../utils/logger";

function input(overrides: Partial<FounderPrecedentInput> & { answer?: FounderPrecedentInput["answer"] } = {}): FounderPrecedentInput {
  return {
    itemId: 42,
    itemType: "churn_risk_intervention",
    question: "Org Acme at churn 92/100 — recommended: Approve Retention Outreach",
    answer: { outcome: "approved" },
    organizationId: 7,
    ...overrides,
  };
}

beforeEach(() => {
  EXISTING = [];
  throwOnSelect = false;
  INSERTS.length = 0;
  UPDATES.length = 0;
  vi.clearAllMocks();
});

describe("admission control — memory quality over quantity", () => {
  it("rejects a plain no-reason approval (no generalizable signal)", async () => {
    const out = await recordFounderPrecedent(input({ answer: { outcome: "approved" } }));

    expect(out).toEqual({ admitted: false, skippedUnchanged: false, reason: "not_a_reusable_rule" });
    expect(embedMock).not.toHaveBeenCalled();
    expect(INSERTS).toHaveLength(0);
  });

  it(`rejects a rejection whose reason is under ${PRECEDENT_MIN_REASON_CHARS} chars`, async () => {
    const out = await recordFounderPrecedent(
      input({ answer: { outcome: "rejected", reason: "too aggressive" } }), // 14 chars
    );

    expect(out.admitted).toBe(false);
    expect(INSERTS).toHaveLength(0);
  });

  it("admits a rejection with a reason ≥ 20 chars", async () => {
    const reason = "Never discount annual plans below 20% without asking me first.";
    const out = await recordFounderPrecedent(input({ answer: { outcome: "rejected", reason } }));

    expect(out).toEqual({ admitted: true, skippedUnchanged: false, reason: "inserted" });
    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(INSERTS).toHaveLength(1);
    // Platform memory: org id NEVER lands in organization_id, only metadata.
    expect(INSERTS[0].organizationId).toBeNull();
    expect(INSERTS[0].metadata.organizationId).toBe(7);
    expect(INSERTS[0].namespace).toBe("founder_precedent");
    expect(INSERTS[0].sourceRef).toBe("founder_precedent:decision:42");
    expect(INSERTS[0].contentSnippet).toContain("SITUATION [churn_risk_intervention]");
    expect(INSERTS[0].contentSnippet).toContain("FOUNDER RULING: rejected");
    expect(INSERTS[0].contentSnippet).toContain(`WHY: ${reason}`);
  });

  it("admits an override with a ≥ 20-char reason", async () => {
    const out = await recordFounderPrecedent(
      input({ answer: { outcome: "override", reason: "Send the retention email but skip the discount offer." } }),
    );
    expect(out.admitted).toBe(true);
    expect(INSERTS).toHaveLength(1);
  });

  it("admits an explicit chosen option even without a reason (approve path)", async () => {
    const out = await recordFounderPrecedent(
      input({ answer: { outcome: "approved", chosenOptionLabel: "Offer 1 free month" } }),
    );

    expect(out.admitted).toBe(true);
    expect(INSERTS).toHaveLength(1);
    expect(INSERTS[0].contentSnippet).toContain('FOUNDER RULING: approved — chose "Offer 1 free month"');
  });
});

describe("contentHash dedupe + upsert on the natural key", () => {
  const admissible = () =>
    input({ answer: { outcome: "rejected", reason: "Do not email enterprise accounts without a call first." } });

  it("skips the re-embed + write when the content hash is unchanged", async () => {
    // First write captures the hash the service computed.
    await recordFounderPrecedent(admissible());
    expect(INSERTS).toHaveLength(1);
    const hash = INSERTS[0].contentHash;

    EXISTING = [{ id: 9, contentHash: hash }];
    embedMock.mockClear();
    const out = await recordFounderPrecedent(admissible());

    expect(out).toEqual({ admitted: true, skippedUnchanged: true, reason: "content_unchanged" });
    expect(embedMock).not.toHaveBeenCalled();
    expect(INSERTS).toHaveLength(1); // no second insert
    expect(UPDATES).toHaveLength(0);
  });

  it("updates the existing row in place when the content changed", async () => {
    EXISTING = [{ id: 9, contentHash: "stale-hash" }];
    const out = await recordFounderPrecedent(admissible());

    expect(out).toEqual({ admitted: true, skippedUnchanged: false, reason: "updated" });
    expect(UPDATES).toHaveLength(1);
    expect(INSERTS).toHaveLength(0);
    expect(UPDATES[0].contentHash).not.toBe("stale-hash");
    expect(UPDATES[0].embedding).toHaveLength(1024);
  });
});

describe("fail-open — a resolve must never fail on precedent bookkeeping", () => {
  it("returns admitted=false + warn log on a DB error, never throws", async () => {
    throwOnSelect = true;
    const out = await recordFounderPrecedent(
      input({ answer: { outcome: "rejected", reason: "A long enough reason to clear admission control." } }),
    );

    expect(out).toEqual({ admitted: false, skippedUnchanged: false, reason: "error" });
    expect(logger.warn).toHaveBeenCalledWith(
      "founderPrecedent.write_failed",
      expect.objectContaining({ itemId: 42 }),
    );
  });
});

describe("composePrecedentText", () => {
  it("composes the compact SITUATION / FOUNDER RULING / WHY form", () => {
    const text = composePrecedentText(
      input({ answer: { outcome: "override", reason: "Ship it without the banner.", chosenOptionLabel: "No banner" } }),
    );
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("SITUATION [churn_risk_intervention]:");
    expect(text).toContain('FOUNDER RULING: override — chose "No banner"');
    expect(text).toContain("WHY: Ship it without the banner.");
  });
});
