/**
 * A 31 December payment belongs to that tax year, in the lender's zone.
 *
 * Box 1 of a 1098 is the interest RECEIVED in a calendar year, filed with the
 * IRS and furnished to the borrower under 26 U.S.C. §6050H. "Received" is a fact
 * about the lender's local day.
 *
 * `payments.payment_date` is a `timestamp`, and both producers bucketed it by
 * the SERVER's zone — `toIsoDay` via `toISOString()`, and the borrower portal
 * via `new Date(taxYear, 0, 1)`. A borrower paying on 31 December at 16:00
 * Pacific is 2025-01-01T00:00Z, so that interest was filed in the following tax
 * year. Every US zone is behind UTC, so the error is one-directional: it always
 * pushes interest forward, and it lands exactly on the tax-motivated year-end
 * payment.
 *
 * `note_payments.payment_date` (acquired notes) is a `date` — already the
 * recorded day, no zone question — so one lender's batch could file two
 * different year conventions in a single submission. That asymmetry is pinned
 * below too.
 */

import { describe, expect, it } from "vitest";
import { dayInZone, toIsoDay, toOriginatedLedgerEntries } from "../../server/services/form1098Batch";

/** 31 Dec 2025, 16:00 Pacific — 1 Jan 2026 in UTC. */
const YEAR_END_PACIFIC = new Date("2026-01-01T00:00:00.000Z");

describe("dayInZone answers in the zone it is given", () => {
  it("a year-end Pacific payment is 31 December, not 1 January", () => {
    expect(dayInZone(YEAR_END_PACIFIC, "America/Los_Angeles")).toBe("2025-12-31");
    expect(dayInZone(YEAR_END_PACIFIC, "America/New_York")).toBe("2025-12-31");
    // …and the value that made this wrong, kept visible on purpose.
    expect(YEAR_END_PACIFIC.toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("UTC is a zone like any other, not a synonym for correct", () => {
    expect(dayInZone(YEAR_END_PACIFIC, "UTC")).toBe("2026-01-01");
  });

  it("a bare YYYY-MM-DD is the recorded day and is never reparsed", () => {
    // `new Date("2025-12-31")` is midnight UTC, which in any US zone is the
    // 30th. A `date` column has no instant to convert.
    expect(dayInZone("2025-12-31", "America/Los_Angeles")).toBe("2025-12-31");
    expect(toIsoDay("2025-12-31")).toBe("2025-12-31");
  });

  it("refuses rather than guessing on an unusable value", () => {
    expect(dayInZone(null, "America/New_York")).toBeNull();
    expect(dayInZone(new Date("nonsense"), "America/New_York")).toBeNull();
  });
});

describe("the originated ledger buckets by the lender's day", () => {
  const row = {
    noteId: 42,
    paymentDate: YEAR_END_PACIFIC,
    principalAmount: "100.00",
    interestAmount: "50.00",
    transactionId: "cs_year_end",
    status: "completed",
  };

  it("a year-end payment lands in the closing year, not the next one", () => {
    const byNote = toOriginatedLedgerEntries([row] as never, "America/Los_Angeles");
    const entries = byNote.get(42) ?? [];
    expect(entries).toHaveLength(1);
    expect(
      entries[0].date,
      "this interest belongs to the tax year the borrower paid it in",
    ).toBe("2025-12-31");
  });

  it("the same row under UTC lands in the following year — the defect, pinned", () => {
    const byNote = toOriginatedLedgerEntries([row] as never, "UTC");
    expect((byNote.get(42) ?? [])[0]?.date).toBe("2026-01-01");
  });

  it("the acquired and originated paths agree on the same calendar day", () => {
    // Acquired rows carry a `date` string; originated rows carry an instant.
    // Given the same lender day they must produce the same bucket, or one
    // submission files two conventions.
    const acquiredDay = toIsoDay("2025-12-31");
    const originatedDay = (
      toOriginatedLedgerEntries([row] as never, "America/Los_Angeles").get(42) ?? []
    )[0]?.date;
    expect(originatedDay).toBe(acquiredDay);
  });
});
