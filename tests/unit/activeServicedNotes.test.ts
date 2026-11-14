/**
 * P1-12 Leg 2 — countActiveServicedNotes is best-effort and org-scoped.
 * Proves: (a) the count is the db's number, (b) ANY db failure degrades to
 * null rather than throwing (so it can never fail a pause), and (c) the status
 * set is exactly performing/late/default.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const where = vi.fn();
vi.mock("../../server/storage", () => ({
  db: { select: () => ({ from: () => ({ where }) }) },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  countActiveServicedNotes,
  ACTIVE_SERVICED_NOTE_STATUSES,
} from "../../server/services/billing/activeServicedNotes";

beforeEach(() => where.mockReset());

describe("countActiveServicedNotes", () => {
  it("returns the counted number", async () => {
    where.mockResolvedValue([{ n: 4 }]);
    expect(await countActiveServicedNotes(7)).toBe(4);
  });

  it("returns 0 for an org with no active notes", async () => {
    where.mockResolvedValue([{ n: 0 }]);
    expect(await countActiveServicedNotes(7)).toBe(0);
  });

  it("degrades to null when the query throws — never blocks the pause", async () => {
    where.mockRejectedValueOnce(new Error("db down"));
    await expect(countActiveServicedNotes(7)).resolves.toBeNull();
  });

  it("degrades to null on a malformed result", async () => {
    where.mockResolvedValue([]);
    expect(await countActiveServicedNotes(7)).toBeNull();
  });

  it("active = performing/late/default; paid_off and sold are not", () => {
    expect([...ACTIVE_SERVICED_NOTE_STATUSES]).toEqual(["performing", "late", "default"]);
  });
});
