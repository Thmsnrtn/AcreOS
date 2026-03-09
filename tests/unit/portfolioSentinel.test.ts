/**
 * T284 — Portfolio Sentinel Tests
 * Tests alert generation logic for portfolio health monitoring.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

type AlertSeverity = "info" | "warning" | "critical";
type AlertType =
  | "note_past_maturity"
  | "stale_lead"
  | "stuck_deal"
  | "stale_avm"
  | "payment_overdue"
  | "escrow_shortfall"
  | "high_ltv";

interface PortfolioAlert {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  entityId: number;
  entityType: "note" | "lead" | "deal" | "property";
  createdAt: Date;
}

const STALE_LEAD_DAYS = 90;
const STUCK_DEAL_DAYS = 45;
const STALE_AVM_DAYS = 90;
const HIGH_LTV_THRESHOLD = 0.85;

function isNotePastMaturity(maturityDate: Date, asOf: Date = new Date()): boolean {
  return maturityDate < asOf;
}

function isLeadStale(lastActivityDate: Date | null, asOf: Date = new Date()): boolean {
  if (!lastActivityDate) return true;
  const daysSinceActivity = (asOf.getTime() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceActivity > STALE_LEAD_DAYS;
}

function isDealStuck(lastStageChange: Date | null, asOf: Date = new Date()): boolean {
  if (!lastStageChange) return true;
  const daysSinceChange = (asOf.getTime() - lastStageChange.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceChange > STUCK_DEAL_DAYS;
}

function isAvmStale(lastAvmDate: Date | null, asOf: Date = new Date()): boolean {
  if (!lastAvmDate) return true;
  const daysSinceAvm = (asOf.getTime() - lastAvmDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceAvm > STALE_AVM_DAYS;
}

function isHighLtv(principal: number, propertyValue: number): boolean {
  if (propertyValue <= 0) return false;
  return principal / propertyValue > HIGH_LTV_THRESHOLD;
}

function classifyAlertSeverity(type: AlertType): AlertSeverity {
  const critical: AlertType[] = ["note_past_maturity", "payment_overdue", "high_ltv"];
  const warning: AlertType[] = ["stale_lead", "stuck_deal", "escrow_shortfall"];
  if (critical.includes(type)) return "critical";
  if (warning.includes(type)) return "warning";
  return "info";
}

function generateAlertTitle(type: AlertType, entityId: number): string {
  const titles: Record<AlertType, string> = {
    note_past_maturity: `Note #${entityId} past maturity`,
    stale_lead: `Lead #${entityId} has no recent activity`,
    stuck_deal: `Deal #${entityId} stuck in current stage`,
    stale_avm: `Property #${entityId} AVM is outdated`,
    payment_overdue: `Payment overdue for note #${entityId}`,
    escrow_shortfall: `Escrow shortfall for note #${entityId}`,
    high_ltv: `High LTV warning for note #${entityId}`,
  };
  return titles[type] ?? `Alert for #${entityId}`;
}

function deduplicateAlerts(alerts: PortfolioAlert[]): PortfolioAlert[] {
  const seen = new Set<string>();
  return alerts.filter(a => {
    const key = `${a.type}:${a.entityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const NOW = new Date("2024-06-15");

describe("isNotePastMaturity", () => {
  it("returns true when maturity is in the past", () => {
    expect(isNotePastMaturity(new Date("2024-01-01"), NOW)).toBe(true);
  });

  it("returns false when maturity is in the future", () => {
    expect(isNotePastMaturity(new Date("2025-01-01"), NOW)).toBe(false);
  });
});

describe("isLeadStale", () => {
  it("returns true when last activity was over 90 days ago", () => {
    const staleDate = new Date(NOW.getTime() - 91 * 24 * 60 * 60 * 1000);
    expect(isLeadStale(staleDate, NOW)).toBe(true);
  });

  it("returns false when last activity was 30 days ago", () => {
    const recentDate = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(isLeadStale(recentDate, NOW)).toBe(false);
  });

  it("returns true when no activity date", () => {
    expect(isLeadStale(null, NOW)).toBe(true);
  });

  it("returns false at exactly 90 days", () => {
    const exactDate = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000);
    expect(isLeadStale(exactDate, NOW)).toBe(false);
  });
});

describe("isDealStuck", () => {
  it("returns true when stuck for over 45 days", () => {
    const staleDate = new Date(NOW.getTime() - 46 * 24 * 60 * 60 * 1000);
    expect(isDealStuck(staleDate, NOW)).toBe(true);
  });

  it("returns false when changed recently", () => {
    const recent = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
    expect(isDealStuck(recent, NOW)).toBe(false);
  });

  it("returns true when null (no stage change recorded)", () => {
    expect(isDealStuck(null, NOW)).toBe(true);
  });
});

describe("isHighLtv", () => {
  it("returns true when LTV > 85%", () => {
    expect(isHighLtv(90_000, 100_000)).toBe(true); // 90%
  });

  it("returns false when LTV < 85%", () => {
    expect(isHighLtv(50_000, 100_000)).toBe(false); // 50%
  });

  it("returns false when property value is 0", () => {
    expect(isHighLtv(50_000, 0)).toBe(false);
  });

  it("returns false at exactly 85%", () => {
    expect(isHighLtv(85_000, 100_000)).toBe(false);
  });
});

describe("classifyAlertSeverity", () => {
  it("marks note_past_maturity as critical", () => {
    expect(classifyAlertSeverity("note_past_maturity")).toBe("critical");
  });

  it("marks payment_overdue as critical", () => {
    expect(classifyAlertSeverity("payment_overdue")).toBe("critical");
  });

  it("marks stale_lead as warning", () => {
    expect(classifyAlertSeverity("stale_lead")).toBe("warning");
  });

  it("marks stuck_deal as warning", () => {
    expect(classifyAlertSeverity("stuck_deal")).toBe("warning");
  });

  it("marks stale_avm as info", () => {
    expect(classifyAlertSeverity("stale_avm")).toBe("info");
  });
});

describe("deduplicateAlerts", () => {
  it("removes duplicate type+entityId combinations", () => {
    const alerts: PortfolioAlert[] = [
      { type: "stale_lead", severity: "warning", title: "Stale", description: "", entityId: 1, entityType: "lead", createdAt: NOW },
      { type: "stale_lead", severity: "warning", title: "Stale dup", description: "", entityId: 1, entityType: "lead", createdAt: NOW },
      { type: "stale_lead", severity: "warning", title: "Different lead", description: "", entityId: 2, entityType: "lead", createdAt: NOW },
    ];
    const deduped = deduplicateAlerts(alerts);
    expect(deduped).toHaveLength(2);
  });

  it("preserves alerts with same type but different entities", () => {
    const alerts: PortfolioAlert[] = [
      { type: "note_past_maturity", severity: "critical", title: "", description: "", entityId: 1, entityType: "note", createdAt: NOW },
      { type: "note_past_maturity", severity: "critical", title: "", description: "", entityId: 2, entityType: "note", createdAt: NOW },
    ];
    expect(deduplicateAlerts(alerts)).toHaveLength(2);
  });
});
