/**
 * Transaction Fee Service Unit Tests
 *
 * Tests fee calculation, escrow logic, payout scheduling,
 * audit log generation, and analytics computation.
 */

import { describe, it, expect } from "vitest";

// ── Types mirroring TransactionFeeService ─────────────────────────────────────

interface FeeStructure {
  platformFeePercent: number;
  buyerFeePercent: number;
  sellerFeePercent: number;
  flatFee?: number;
  capAmount?: number;
}

interface FeeBreakdown {
  platformFee: number;
  buyerFee: number;
  sellerFee: number;
  total: number;
  transactionAmount: number;
  effectiveRate: number;
}

type EscrowStatus = "held" | "released" | "refunded" | "disputed";

interface EscrowHold {
  id: number;
  transactionId: number;
  amount: number;
  status: EscrowStatus;
  heldAt: Date;
  releasedAt?: Date;
  releasedTo?: "buyer" | "seller" | "platform";
}

interface PayoutSchedule {
  settlementId: number;
  amount: number;
  recipient: "platform" | "seller" | "agent";
  scheduledDate: Date;
  status: "pending" | "processing" | "completed" | "failed";
}

interface AuditLogEntry {
  eventType: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function calculateFee(transactionAmount: number, feeStructure: FeeStructure): FeeBreakdown {
  const platformFee = (transactionAmount * feeStructure.platformFeePercent) / 100;
  const buyerFee = (transactionAmount * feeStructure.buyerFeePercent) / 100;
  const sellerFee = (transactionAmount * feeStructure.sellerFeePercent) / 100;
  const flatFee = feeStructure.flatFee || 0;

  let total = platformFee + buyerFee + sellerFee + flatFee;

  if (feeStructure.capAmount && total > feeStructure.capAmount) {
    total = feeStructure.capAmount;
  }

  const effectiveRate = transactionAmount > 0 ? (total / transactionAmount) * 100 : 0;

  return {
    platformFee: Math.round(platformFee * 100) / 100,
    buyerFee: Math.round(buyerFee * 100) / 100,
    sellerFee: Math.round(sellerFee * 100) / 100,
    total: Math.round(total * 100) / 100,
    transactionAmount,
    effectiveRate: Math.round(effectiveRate * 10000) / 10000,
  };
}

function createEscrowHold(transactionId: number, amount: number): EscrowHold {
  return {
    id: Math.floor(Math.random() * 10000),
    transactionId,
    amount,
    status: "held",
    heldAt: new Date(),
  };
}

function releaseEscrow(
  hold: EscrowHold,
  releaseTo: "buyer" | "seller" | "platform"
): EscrowHold {
  if (hold.status !== "held") {
    throw new Error(`Cannot release escrow in status: ${hold.status}`);
  }
  return {
    ...hold,
    status: "released",
    releasedAt: new Date(),
    releasedTo: releaseTo,
  };
}

function refundEscrow(hold: EscrowHold): EscrowHold {
  if (hold.status !== "held") {
    throw new Error(`Cannot refund escrow in status: ${hold.status}`);
  }
  return {
    ...hold,
    status: "refunded",
    releasedAt: new Date(),
    releasedTo: "buyer",
  };
}

function schedulePayouts(
  settlements: Array<{ id: number; feeType: string; amount: number }>,
  daysDelay: number = 2
): PayoutSchedule[] {
  const scheduledDate = new Date(Date.now() + daysDelay * 24 * 60 * 60 * 1000);

  return settlements.map(s => ({
    settlementId: s.id,
    amount: s.amount,
    recipient: s.feeType === "platform_fee" ? "platform" : s.feeType === "seller_fee" ? "seller" : "platform",
    scheduledDate,
    status: "pending" as const,
  }));
}

function createAuditEntry(
  eventType: string,
  amount: number,
  balanceBefore: number,
  metadata?: Record<string, any>
): AuditLogEntry {
  const balanceAfter =
    eventType === "fee_collected" ? balanceBefore + amount
    : eventType === "payout_sent" ? balanceBefore - amount
    : eventType === "refund_issued" ? balanceBefore - amount
    : balanceBefore;

  return {
    eventType,
    amount,
    balanceBefore,
    balanceAfter,
    timestamp: new Date(),
    metadata,
  };
}

function computeFeeAnalytics(
  settlements: Array<{ amount: number; feeType: string; createdAt: Date }>
): {
  totalCollected: number;
  byType: Record<string, number>;
  avgFee: number;
  count: number;
} {
  const byType: Record<string, number> = {};
  let total = 0;

  for (const s of settlements) {
    total += s.amount;
    byType[s.feeType] = (byType[s.feeType] || 0) + s.amount;
  }

  return {
    totalCollected: Math.round(total * 100) / 100,
    byType,
    avgFee: settlements.length > 0 ? Math.round((total / settlements.length) * 100) / 100 : 0,
    count: settlements.length,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Fee Calculation Formulas", () => {
  const standardFees: FeeStructure = {
    platformFeePercent: 1.5,
    buyerFeePercent: 0.5,
    sellerFeePercent: 1.0,
  };

  it("calculates correct platform fee", () => {
    const breakdown = calculateFee(100_000, standardFees);
    expect(breakdown.platformFee).toBeCloseTo(1500, 2);
  });

  it("calculates correct buyer fee", () => {
    const breakdown = calculateFee(100_000, standardFees);
    expect(breakdown.buyerFee).toBeCloseTo(500, 2);
  });

  it("calculates correct seller fee", () => {
    const breakdown = calculateFee(100_000, standardFees);
    expect(breakdown.sellerFee).toBeCloseTo(1000, 2);
  });

  it("sums all fee components correctly", () => {
    const breakdown = calculateFee(100_000, standardFees);
    expect(breakdown.total).toBeCloseTo(breakdown.platformFee + breakdown.buyerFee + breakdown.sellerFee, 2);
  });

  it("calculates correct effective rate", () => {
    const breakdown = calculateFee(100_000, standardFees);
    // 1.5 + 0.5 + 1.0 = 3.0%
    expect(breakdown.effectiveRate).toBeCloseTo(3.0, 2);
  });

  it("adds flat fee to total", () => {
    const withFlat: FeeStructure = { ...standardFees, flatFee: 250 };
    const breakdown = calculateFee(100_000, withFlat);
    expect(breakdown.total).toBeCloseTo(3250, 2);
  });

  it("applies cap when total fees exceed cap amount", () => {
    const cappedFees: FeeStructure = { ...standardFees, capAmount: 2000 };
    const breakdown = calculateFee(100_000, cappedFees);
    expect(breakdown.total).toBe(2000);
  });

  it("does not apply cap when total is below cap", () => {
    const cappedFees: FeeStructure = { ...standardFees, capAmount: 5000 };
    const breakdown = calculateFee(100_000, cappedFees);
    expect(breakdown.total).toBeCloseTo(3000, 2);
  });

  it("handles zero transaction amount gracefully", () => {
    const breakdown = calculateFee(0, standardFees);
    expect(breakdown.total).toBe(0);
    expect(breakdown.effectiveRate).toBe(0);
  });

  it("scales linearly with transaction size", () => {
    const small = calculateFee(50_000, standardFees);
    const large = calculateFee(100_000, standardFees);
    expect(large.total).toBeCloseTo(small.total * 2, 2);
  });
});

describe("Escrow Hold/Release Logic", () => {
  it("creates escrow hold in held status", () => {
    const hold = createEscrowHold(42, 50_000);
    expect(hold.status).toBe("held");
    expect(hold.amount).toBe(50_000);
    expect(hold.transactionId).toBe(42);
    expect(hold.releasedAt).toBeUndefined();
  });

  it("releases escrow to seller", () => {
    const hold = createEscrowHold(1, 25_000);
    const released = releaseEscrow(hold, "seller");
    expect(released.status).toBe("released");
    expect(released.releasedTo).toBe("seller");
    expect(released.releasedAt).toBeDefined();
  });

  it("releases escrow to platform", () => {
    const hold = createEscrowHold(1, 1_500);
    const released = releaseEscrow(hold, "platform");
    expect(released.status).toBe("released");
    expect(released.releasedTo).toBe("platform");
  });

  it("refunds escrow to buyer", () => {
    const hold = createEscrowHold(1, 10_000);
    const refunded = refundEscrow(hold);
    expect(refunded.status).toBe("refunded");
    expect(refunded.releasedTo).toBe("buyer");
  });

  it("throws when releasing already-released escrow", () => {
    const hold = createEscrowHold(1, 5_000);
    const released = releaseEscrow(hold, "seller");
    expect(() => releaseEscrow(released, "platform")).toThrow();
  });

  it("throws when refunding already-released escrow", () => {
    const hold = createEscrowHold(1, 5_000);
    const released = releaseEscrow(hold, "seller");
    expect(() => refundEscrow(released)).toThrow();
  });

  it("throws when releasing refunded escrow", () => {
    const hold = createEscrowHold(1, 5_000);
    const refunded = refundEscrow(hold);
    expect(() => releaseEscrow(refunded, "seller")).toThrow();
  });
});

describe("Payout Scheduling", () => {
  const settlements = [
    { id: 1, feeType: "platform_fee", amount: 1500 },
    { id: 2, feeType: "seller_fee", amount: 1000 },
    { id: 3, feeType: "buyer_fee", amount: 500 },
  ];

  it("creates one payout per settlement", () => {
    const payouts = schedulePayouts(settlements);
    expect(payouts).toHaveLength(3);
  });

  it("schedules payouts 2 days in future by default", () => {
    const payouts = schedulePayouts(settlements);
    const twoDaysOut = Date.now() + 2 * 24 * 60 * 60 * 1000;
    for (const payout of payouts) {
      expect(Math.abs(payout.scheduledDate.getTime() - twoDaysOut)).toBeLessThan(5000);
    }
  });

  it("respects custom delay parameter", () => {
    const payouts = schedulePayouts(settlements, 5);
    const fiveDaysOut = Date.now() + 5 * 24 * 60 * 60 * 1000;
    for (const payout of payouts) {
      expect(Math.abs(payout.scheduledDate.getTime() - fiveDaysOut)).toBeLessThan(5000);
    }
  });

  it("sets all payouts to pending status", () => {
    const payouts = schedulePayouts(settlements);
    expect(payouts.every(p => p.status === "pending")).toBe(true);
  });

  it("routes platform_fee to platform recipient", () => {
    const payouts = schedulePayouts(settlements);
    const platformPayout = payouts.find(p => p.settlementId === 1);
    expect(platformPayout?.recipient).toBe("platform");
  });

  it("routes seller_fee to seller recipient", () => {
    const payouts = schedulePayouts(settlements);
    const sellerPayout = payouts.find(p => p.settlementId === 2);
    expect(sellerPayout?.recipient).toBe("seller");
  });

  it("returns empty array for empty settlements", () => {
    expect(schedulePayouts([])).toHaveLength(0);
  });
});

describe("Audit Log Generation", () => {
  it("creates fee_collected entry with correct balance change", () => {
    const entry = createAuditEntry("fee_collected", 1500, 10_000);
    expect(entry.balanceAfter).toBe(11_500);
    expect(entry.balanceBefore).toBe(10_000);
    expect(entry.eventType).toBe("fee_collected");
    expect(entry.amount).toBe(1500);
  });

  it("creates payout_sent entry deducting from balance", () => {
    const entry = createAuditEntry("payout_sent", 1000, 5_000);
    expect(entry.balanceAfter).toBe(4_000);
  });

  it("creates refund_issued entry deducting from balance", () => {
    const entry = createAuditEntry("refund_issued", 500, 3_000);
    expect(entry.balanceAfter).toBe(2_500);
  });

  it("includes timestamp on every entry", () => {
    const entry = createAuditEntry("fee_collected", 100, 0);
    expect(entry.timestamp).toBeInstanceOf(Date);
  });

  it("stores metadata when provided", () => {
    const meta = { transactionId: 42, note: "test" };
    const entry = createAuditEntry("fee_collected", 100, 0, meta);
    expect(entry.metadata).toEqual(meta);
  });

  it("keeps balance unchanged for unknown event types", () => {
    const entry = createAuditEntry("some_other_event", 100, 5_000);
    expect(entry.balanceAfter).toBe(5_000);
  });
});

describe("Analytics Computation", () => {
  const now = new Date();
  const settlements = [
    { amount: 1500, feeType: "platform_fee", createdAt: now },
    { amount: 1000, feeType: "seller_fee", createdAt: now },
    { amount: 500, feeType: "platform_fee", createdAt: now },
    { amount: 750, feeType: "buyer_fee", createdAt: now },
  ];

  it("computes total collected correctly", () => {
    const analytics = computeFeeAnalytics(settlements);
    expect(analytics.totalCollected).toBeCloseTo(3750, 2);
  });

  it("groups amounts by fee type", () => {
    const analytics = computeFeeAnalytics(settlements);
    expect(analytics.byType["platform_fee"]).toBeCloseTo(2000, 2);
    expect(analytics.byType["seller_fee"]).toBeCloseTo(1000, 2);
    expect(analytics.byType["buyer_fee"]).toBeCloseTo(750, 2);
  });

  it("computes correct average fee", () => {
    const analytics = computeFeeAnalytics(settlements);
    expect(analytics.avgFee).toBeCloseTo(3750 / 4, 2);
  });

  it("returns correct count", () => {
    const analytics = computeFeeAnalytics(settlements);
    expect(analytics.count).toBe(4);
  });

  it("handles empty settlements gracefully", () => {
    const analytics = computeFeeAnalytics([]);
    expect(analytics.totalCollected).toBe(0);
    expect(analytics.avgFee).toBe(0);
    expect(analytics.count).toBe(0);
  });
});
