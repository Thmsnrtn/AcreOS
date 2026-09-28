// Pins the tax-lien / tax-deed certificate lifecycle emitters (audit Wave 1,
// beta→core): the four cert templates were dead until this emitter shipped, so
// this test fixes the new truth — the events fire on the REAL transitions the
// templates handle (create, genuine active→redeemed, the nightly 60-day and
// lapsed-deadline branches), carry only real certificate fields (the property
// is identified by APN — never a fabricated street; the rate is the won or
// statutory rate or null — never invented), no-op on a non-transition, and are
// fire-and-forget (a throwing engine never fails the certificate write).
import { afterEach, describe, expect, it, vi } from "vitest";

const { emitCertEvent, emitDurableCertEvent } = vi.hoisted(() => ({
  emitCertEvent: vi.fn(),
  // The two SCHEDULED cert events hand off durably (DEFECT-0114).
  emitDurableCertEvent: vi.fn(async () => ({ staged: true })),
}));
vi.mock("../../server/services/workflow-engine", () => ({ emitCertEvent, emitDurableCertEvent }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  emitCertAcquired,
  emitCertRedeemed,
  emitCertRedemptionApproaching,
  emitCertForeclosureEligible,
  type CertEventRow,
} from "../../server/services/certificateEvents";

// A real Florida certificate: statutory yield 1800 bps, bid-down state,
// 24-month redemption, 1-month foreclosure notice, F.S. §197.402 reference.
const cert: CertEventRow = {
  id: "cert_1",
  organizationId: 7,
  propertyId: 42,
  state: "FL",
  county: "Broward",
  apn: "504210-12-3456",
  saleType: "tax_lien_certificate",
  saleDate: "2026-06-01",
  bidDownRateBps: 1425, // won at 14.25%
  redemptionDeadline: "2028-06-01",
  status: "active",
  redeemedAt: null,
  redeemedAmountCents: null,
};

afterEach(() => {
  emitCertEvent.mockReset();
  emitDurableCertEvent.mockClear();
});

describe("emitCertAcquired", () => {
  it("fires cert.acquired on create, keyed by propertyId, with only real fields", () => {
    emitCertAcquired({ ...cert });
    expect(emitCertEvent).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = emitCertEvent.mock.calls[0];
    expect(event).toBe("cert.acquired");
    expect(orgId).toBe(7);
    expect(entityId).toBe(42); // the cert's propertyId is the numeric handle
    expect(data.certificateId).toBe("cert_1"); // the UUID rides in data
    // Property identified by APN, NEVER a fabricated street address.
    expect(data.propertyAddress).toBe("APN 504210-12-3456 (Broward, FL)");
    expect(data.propertyAddress.startsWith("APN ")).toBe(true);
    expect(data.certificateAcquiredDate).toBe("2026-06-01");
    expect(data.redemptionEndsDate).toBe("2028-06-01");
    expect(data.stateRedemptionPeriodMonths).toBe(24); // FL redemptionPeriodMonths
    expect(data.stateStatutoryRatePct).toBe("14.25%"); // the won bid-down rate
    expect(data.state).toBe("FL");
    expect(data.saleType).toBe("tax_lien_certificate");
  });

  it("prefers the won rate, falls back to the state statutory rate, else null — never invented", () => {
    // No won rate → the FL statutory 1800 bps default.
    emitCertAcquired({ ...cert, bidDownRateBps: null });
    expect(emitCertEvent.mock.calls[0][3].stateStatutoryRatePct).toBe("18%");
    emitCertEvent.mockClear();

    // A deed state (TX) has no statutory yield and no won rate → null, not 0%.
    emitCertAcquired({ ...cert, state: "TX", bidDownRateBps: null });
    const data = emitCertEvent.mock.calls[0][3];
    expect(data.stateStatutoryRatePct).toBeNull();
    // TX has no redemptionPeriodMonths but a 24-month post-sale window.
    expect(data.stateRedemptionPeriodMonths).toBe(24);
  });

  it("falls back to entityId 0 when the cert has no attached property", () => {
    emitCertAcquired({ ...cert, propertyId: null });
    const [, , entityId, data] = emitCertEvent.mock.calls[0];
    expect(entityId).toBe(0);
    expect(data.certificateId).toBe("cert_1");
  });
});

describe("emitCertRedeemed", () => {
  it("fires cert.redeemed ONLY on a genuine active→redeemed transition", () => {
    emitCertRedeemed("active", {
      ...cert,
      status: "redeemed",
      redeemedAt: "2027-01-15",
      redeemedAmountCents: 1_234_500,
    });
    expect(emitCertEvent).toHaveBeenCalledTimes(1);
    const [event, , , data] = emitCertEvent.mock.calls[0];
    expect(event).toBe("cert.redeemed");
    expect(data.redeemedDate).toBe("2027-01-15");
    expect(data.redemptionAmount).toBe(12_345); // cents → dollars, real column
    expect(data.stateStatutoryRatePct).toBe("14.25%");
  });

  it("does NOT fire on redeemed→redeemed, or when the post-image is not redeemed", () => {
    emitCertRedeemed("redeemed", { ...cert, status: "redeemed", redeemedAmountCents: 1_000_000 }); // already redeemed
    emitCertRedeemed("active", { ...cert, status: "active" }); // unrelated edit
    emitCertRedeemed(null, { ...cert, status: "active" }); // no pre-image
    expect(emitCertEvent).not.toHaveBeenCalled();
  });

  it("passes null (never a fabricated 0) for redemptionAmount when the cents column is null", () => {
    emitCertRedeemed("active", {
      ...cert,
      status: "redeemed",
      redeemedAt: "2027-02-01",
      redeemedAmountCents: null,
    });
    const [, , , data] = emitCertEvent.mock.calls[0];
    expect(data.redemptionAmount).toBeNull();
  });
});

describe("emitCertRedemptionApproaching / emitCertForeclosureEligible", () => {
  it("cert.redemption_period_60d carries only its real fields", async () => {
    await emitCertRedemptionApproaching({ ...cert });
    expect(emitDurableCertEvent).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = emitDurableCertEvent.mock.calls[0] as unknown as [string, number, number, Record<string, unknown>];
    expect(event).toBe("cert.redemption_period_60d");
    expect(orgId).toBe(7);
    expect(entityId).toBe(42);
    expect(data.certificateId).toBe("cert_1");
    expect(data.propertyAddress).toBe("APN 504210-12-3456 (Broward, FL)");
    expect(data.redemptionEndsDate).toBe("2028-06-01");
    expect(data.stateForeclosureNoticeMonths).toBe(1); // FL preForeclosureNoticeMonths
    expect(Object.keys(data).sort()).toEqual([
      "certificateId",
      "propertyAddress",
      "redemptionEndsDate",
      "stateForeclosureNoticeMonths",
    ]);
  });

  it("cert.foreclosure_eligible carries only its real fields", async () => {
    await emitCertForeclosureEligible({ ...cert });
    const [event, , , data] = emitDurableCertEvent.mock.calls[0] as unknown as [string, number, number, Record<string, unknown>];
    expect(event).toBe("cert.foreclosure_eligible");
    expect(data.certificateId).toBe("cert_1");
    expect(data.propertyAddress).toBe("APN 504210-12-3456 (Broward, FL)");
    expect(data.redemptionEndsDate).toBe("2028-06-01");
    expect(data.state).toBe("FL");
    expect(data.stateForeclosureNoticeMonths).toBe(1);
    expect(data.stateStatutoryReference).toBe("F.S. §197.402 et seq.");
    expect(Object.keys(data).sort()).toEqual([
      "certificateId",
      "propertyAddress",
      "redemptionEndsDate",
      "state",
      "stateForeclosureNoticeMonths",
      "stateStatutoryReference",
    ]);
  });
});

describe("no fabrication / fire-and-forget", () => {
  it("no emitter payload ever carries a delinquentOwnerEmail (fabricated recipient) key", async () => {
    emitCertAcquired({ ...cert });
    emitCertRedeemed("active", { ...cert, status: "redeemed", redeemedAmountCents: 500_000 });
    await emitCertRedemptionApproaching({ ...cert });
    await emitCertForeclosureEligible({ ...cert });
    const calls = [...emitCertEvent.mock.calls, ...emitDurableCertEvent.mock.calls] as unknown as unknown[][];
    expect(calls.length).toBe(4);
    for (const call of calls) {
      expect(Object.keys(call[3] as object)).not.toContain("delinquentOwnerEmail");
    }
  });

  it("request-path emitters stay fire-and-forget: a throwing emitCertEvent never propagates", () => {
    emitCertEvent.mockImplementation(() => {
      throw new Error("engine boom");
    });
    expect(() => emitCertAcquired({ ...cert })).not.toThrow();
    expect(() =>
      emitCertRedeemed("active", { ...cert, status: "redeemed", redeemedAmountCents: 1000 }),
    ).not.toThrow();
  });

  it("the SCHEDULED emitters propagate a staging failure so the job rolls back its marker (DEFECT-0114)", async () => {
    emitDurableCertEvent.mockRejectedValueOnce(new Error("outbox write failed"));
    await expect(emitCertRedemptionApproaching({ ...cert })).rejects.toThrow("outbox write failed");
    emitDurableCertEvent.mockRejectedValueOnce(new Error("outbox write failed"));
    await expect(emitCertForeclosureEligible({ ...cert })).rejects.toThrow("outbox write failed");
  });
});
