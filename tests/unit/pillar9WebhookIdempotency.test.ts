/**
 * Pillar 9.5 — generic webhook idempotency test.
 *
 * Verifies:
 *   - Fresh eventId → handler runs, returns processed:true.
 *   - Duplicate eventId → handler skipped, returns duplicate:true.
 *   - Handler throws → idempotency row is rolled back so a retry re-runs.
 *   - Missing eventId → handler runs anyway (with a warning).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const insertReturning = vi.fn();
const insertOnConflict = vi.fn(() => ({ returning: insertReturning }));
const insertValues = vi.fn(() => ({ onConflictDoNothing: insertOnConflict }));
const insertFn = vi.fn(() => ({ values: insertValues }));

const deleteWhere = vi.fn();
const deleteFn = vi.fn(() => ({ where: deleteWhere }));

vi.mock("../../server/db", () => ({
  db: {
    insert: insertFn,
    delete: deleteFn,
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Pillar 9.5 — withIdempotency", () => {
  beforeEach(() => {
    insertFn.mockClear();
    insertValues.mockClear();
    insertOnConflict.mockClear();
    insertReturning.mockClear();
    deleteFn.mockClear();
    deleteWhere.mockClear();
  });

  it("runs the handler on a fresh event", async () => {
    insertReturning.mockResolvedValueOnce([{ id: 42 }]);
    const { withIdempotency } = await import(
      "../../server/services/webhook-idempotency"
    );
    const handler = vi.fn(async () => "result-value");
    const out = await withIdempotency("twilio", "SMevent-1", "sms.inbound", handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(out.processed).toBe(true);
    expect(out.duplicate).toBe(false);
    expect(out.result).toBe("result-value");
  });

  it("skips the handler on a duplicate event", async () => {
    insertReturning.mockResolvedValueOnce([]); // ON CONFLICT DO NOTHING returned no row
    const { withIdempotency } = await import(
      "../../server/services/webhook-idempotency"
    );
    const handler = vi.fn(async () => "should-not-run");
    const out = await withIdempotency("twilio", "SMevent-1", "sms.inbound", handler);
    expect(handler).not.toHaveBeenCalled();
    expect(out.processed).toBe(false);
    expect(out.duplicate).toBe(true);
  });

  it("rolls back the idempotency row when the handler throws", async () => {
    insertReturning.mockResolvedValueOnce([{ id: 99 }]);
    deleteWhere.mockResolvedValueOnce(undefined);
    const { withIdempotency } = await import(
      "../../server/services/webhook-idempotency"
    );
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(
      withIdempotency("sendgrid", "sg-event-2", "bounce", handler),
    ).rejects.toThrow(/boom/);
    expect(deleteFn).toHaveBeenCalledTimes(1);
  });

  it("runs the handler when eventId is missing (with a warning)", async () => {
    const { withIdempotency } = await import(
      "../../server/services/webhook-idempotency"
    );
    const handler = vi.fn(async () => "ran");
    const out = await withIdempotency("lob", "", "letter.delivered", handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(out.processed).toBe(true);
    expect(out.duplicate).toBe(false);
  });
});
