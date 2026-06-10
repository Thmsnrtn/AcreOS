/**
 * Today receipts derivation (Tier 3C, elevation blueprint).
 *
 * The receipts strip shows "what got done while you were away" and every
 * receipt MUST trace to real rows — pax_sends, completed payments,
 * successful pax_scheduled_task_runs. These tests lock in the no-fabrication
 * contract:
 *
 *   - no rows in → no receipts out (empty is an honest state, never padded)
 *   - counts/labels/timestamps derive only from the rows passed in
 *   - ordering is deterministic (latest activity first, id tiebreak)
 *
 * Plus the two server-side window/boundary helpers: clampReceiptsSince
 * (advisory client `since` clamped to [now-7d, now-12h]) and startOfUserDay
 * (the "N of M cleared" day boundary in the USER's timezone).
 */

import { describe, it, expect } from "vitest";
import {
  deriveReceipts,
  clampReceiptsSince,
  startOfUserDay,
} from "../../server/routes-today";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date("2026-06-10T15:00:00.000Z");

describe("deriveReceipts — real events only, no padding", () => {
  it("returns an empty array when nothing happened", () => {
    expect(deriveReceipts({ sends: [], payments: [] })).toEqual([]);
    expect(deriveReceipts({ sends: [], payments: [], taskRuns: [] })).toEqual([]);
  });

  it("groups sends by channel with honest counts and the latest timestamp", () => {
    const receipts = deriveReceipts({
      sends: [
        { id: 1, channel: "email", sentAt: "2026-06-10T06:00:00.000Z" },
        { id: 2, channel: "email", sentAt: "2026-06-10T08:00:00.000Z" },
        { id: 3, channel: "sms", sentAt: "2026-06-10T07:00:00.000Z" },
      ],
      payments: [],
    });
    expect(receipts).toHaveLength(2);
    const email = receipts.find((r) => r.id === "sends-email")!;
    expect(email.count).toBe(2);
    expect(email.label).toBe("Pax sent 2 follow-up emails");
    expect(email.latestAt).toBe("2026-06-10T08:00:00.000Z");
    const sms = receipts.find((r) => r.id === "sends-sms")!;
    expect(sms.count).toBe(1);
    expect(sms.label).toBe("Pax sent 1 text");
  });

  it("aggregates completed payments into one receipt with the dollar total", () => {
    const receipts = deriveReceipts({
      sends: [],
      payments: [
        { id: 1, amount: "350.00", processedAt: "2026-06-09T12:00:00.000Z" },
        { id: 2, amount: "1200.50", processedAt: "2026-06-10T09:00:00.000Z" },
      ],
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].id).toBe("payments-posted");
    expect(receipts[0].count).toBe(2);
    expect(receipts[0].label).toBe("2 payments posted — $1,551");
    expect(receipts[0].latestAt).toBe("2026-06-10T09:00:00.000Z");
  });

  it("surfaces successful scheduled-task runs as a jobs receipt", () => {
    const receipts = deriveReceipts({
      sends: [],
      payments: [],
      taskRuns: [
        { id: 11, runAt: "2026-06-10T05:00:00.000Z" },
        { id: 12, runAt: "2026-06-10T05:30:00.000Z" },
      ],
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].id).toBe("task-runs");
    expect(receipts[0].label).toBe("Pax ran 2 scheduled tasks");
    expect(receipts[0].latestAt).toBe("2026-06-10T05:30:00.000Z");
  });

  it("ignores garbage amounts/timestamps instead of fabricating values", () => {
    const receipts = deriveReceipts({
      sends: [{ id: 1, channel: "email", sentAt: null }],
      payments: [{ id: 2, amount: null, processedAt: "not-a-date" }],
    });
    const email = receipts.find((r) => r.id === "sends-email")!;
    expect(email.latestAt).toBeNull(); // null in → null out, no invented time
    const payments = receipts.find((r) => r.id === "payments-posted")!;
    expect(payments.label).toBe("1 payment posted — $0");
    expect(payments.latestAt).toBeNull();
  });

  it("orders by most recent activity, null timestamps sink, id tiebreak", () => {
    const receipts = deriveReceipts({
      sends: [
        { id: 1, channel: "email", sentAt: "2026-06-10T04:00:00.000Z" },
        { id: 2, channel: "sms", sentAt: null },
      ],
      payments: [{ id: 3, amount: "10", processedAt: "2026-06-10T10:00:00.000Z" }],
    });
    expect(receipts.map((r) => r.id)).toEqual(["payments-posted", "sends-email", "sends-sms"]);
  });
});

describe("clampReceiptsSince — advisory client window, server-clamped", () => {
  it("passes through a since inside the [7d, 12h] window", () => {
    const since = NOW.getTime() - 2 * DAY_MS;
    expect(clampReceiptsSince(since, NOW).getTime()).toBe(since);
  });

  it("clamps a too-recent since up to 12h ago (the overnight floor)", () => {
    const since = NOW.getTime() - 5 * 60 * 1000; // reloaded 5 minutes ago
    expect(clampReceiptsSince(since, NOW).getTime()).toBe(NOW.getTime() - 12 * HOUR_MS);
  });

  it("clamps a too-old since down to 7 days ago", () => {
    const since = NOW.getTime() - 30 * DAY_MS;
    expect(clampReceiptsSince(since, NOW).getTime()).toBe(NOW.getTime() - 7 * DAY_MS);
  });

  it("defaults to 12h ago when the client sent nothing usable", () => {
    expect(clampReceiptsSince(undefined, NOW).getTime()).toBe(NOW.getTime() - 12 * HOUR_MS);
    expect(clampReceiptsSince(NaN, NOW).getTime()).toBe(NOW.getTime() - 12 * HOUR_MS);
  });
});

describe("startOfUserDay — the finishability day boundary", () => {
  it("computes the user's local midnight from their tz offset", () => {
    // 15:00Z with tz offset +240 (US Eastern DST, UTC-4) → local 11:00 →
    // local midnight is 04:00Z the same day.
    const start = startOfUserDay(NOW, 240);
    expect(start.toISOString()).toBe("2026-06-10T04:00:00.000Z");
  });

  it("handles a user east of UTC whose local day started 'yesterday' in UTC", () => {
    // 01:00Z with tz offset -540 (UTC+9, Tokyo) → local 10:00 on the 10th →
    // local midnight is 15:00Z on the 9th.
    const earlyUtc = new Date("2026-06-10T01:00:00.000Z");
    const start = startOfUserDay(earlyUtc, -540);
    expect(start.toISOString()).toBe("2026-06-09T15:00:00.000Z");
  });

  it("the boundary is strictly before now and within 24h of it", () => {
    for (const tz of [-720, -540, 0, 240, 720]) {
      const start = startOfUserDay(NOW, tz);
      expect(start.getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(NOW.getTime() - start.getTime()).toBeLessThan(DAY_MS);
    }
  });
});
