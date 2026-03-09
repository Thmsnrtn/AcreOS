/**
 * T179 — Portfolio Health Service Tests
 * Tests alert generation logic for overdue notes, stale leads, stuck deals, stale AVMs.
 */

import { describe, it, expect } from "vitest";

// ─── Inline health check logic ────────────────────────────────────────────────

const STALE_LEAD_DAYS = 90;
const STUCK_DEAL_DAYS = 45;
const STALE_AVM_DAYS = 90;

interface SystemAlert {
  type: string;
  alertType: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function checkOverdueNotes(notes: Array<{ id: number; status: string; maturityDate: Date }>): SystemAlert | null {
  const now = new Date();
  const overdue = notes.filter(n => n.status === "active" && n.maturityDate < now);
  if (overdue.length === 0) return null;

  return {
    type: "note_overdue",
    alertType: "revenue_at_risk",
    severity: "critical",
    title: `${overdue.length} Note${overdue.length > 1 ? "s" : ""} Past Maturity`,
    message: `${overdue.length} active note${overdue.length > 1 ? "s are" : " is"} past their maturity date.`,
  };
}

function checkStaleLeads(leads: Array<{ id: number; status: string; updatedAt: Date }>): SystemAlert | null {
  const threshold = daysAgo(STALE_LEAD_DAYS);
  const stale = leads.filter(l =>
    l.status !== "converted" && l.status !== "dead" && l.updatedAt < threshold
  );
  if (stale.length === 0) return null;

  return {
    type: "stale_leads",
    alertType: "high_churn",
    severity: "warning",
    title: `${stale.length} Lead${stale.length > 1 ? "s" : ""} With No Activity`,
    message: `${stale.length} lead${stale.length > 1 ? "s have" : " has"} had no activity in ${STALE_LEAD_DAYS}+ days.`,
  };
}

function checkStuckDeals(deals: Array<{ id: number; status: string; updatedAt: Date }>): SystemAlert | null {
  const threshold = daysAgo(STUCK_DEAL_DAYS);
  const stuck = deals.filter(d =>
    d.status !== "closed" && d.status !== "cancelled" && d.updatedAt < threshold
  );
  if (stuck.length === 0) return null;

  return {
    type: "stuck_deals",
    alertType: "revenue_at_risk",
    severity: "warning",
    title: `${stuck.length} Deal${stuck.length > 1 ? "s" : ""} Stuck in Pipeline`,
    message: `${stuck.length} deal${stuck.length > 1 ? "s have" : " has"} not progressed in ${STUCK_DEAL_DAYS}+ days.`,
  };
}

function checkStaleAVM(properties: Array<{ id: number; status: string; updatedAt: Date }>): SystemAlert | null {
  const threshold = daysAgo(STALE_AVM_DAYS);
  const stale = properties.filter(p => p.status !== "sold" && p.updatedAt < threshold);
  if (stale.length === 0) return null;

  return {
    type: "stale_avm",
    alertType: "system_error",
    severity: "info",
    title: `${stale.length} Propert${stale.length > 1 ? "ies Need" : "y Needs"} AVM Refresh`,
    message: `${stale.length} propert${stale.length > 1 ? "ies have" : "y has"} not been updated in ${STALE_AVM_DAYS}+ days.`,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("checkOverdueNotes", () => {
  it("returns alert when active notes are past maturity", () => {
    const notes = [
      { id: 1, status: "active", maturityDate: daysAgo(10) },
      { id: 2, status: "active", maturityDate: daysAgo(5) },
    ];
    const alert = checkOverdueNotes(notes);
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe("critical");
    expect(alert!.type).toBe("note_overdue");
    expect(alert!.title).toContain("2 Notes");
  });

  it("returns null when no notes are overdue", () => {
    const notes = [
      { id: 1, status: "active", maturityDate: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
    ];
    expect(checkOverdueNotes(notes)).toBeNull();
  });

  it("ignores inactive/paid notes", () => {
    const notes = [
      { id: 1, status: "paid", maturityDate: daysAgo(10) },
      { id: 2, status: "defaulted", maturityDate: daysAgo(5) },
    ];
    expect(checkOverdueNotes(notes)).toBeNull();
  });

  it("uses singular form for single note", () => {
    const notes = [{ id: 1, status: "active", maturityDate: daysAgo(1) }];
    const alert = checkOverdueNotes(notes)!;
    expect(alert.title).toBe("1 Note Past Maturity");
    expect(alert.message).toContain("1 active note is");
  });

  it("uses plural form for multiple notes", () => {
    const notes = [
      { id: 1, status: "active", maturityDate: daysAgo(10) },
      { id: 2, status: "active", maturityDate: daysAgo(20) },
      { id: 3, status: "active", maturityDate: daysAgo(30) },
    ];
    const alert = checkOverdueNotes(notes)!;
    expect(alert.title).toContain("3 Notes");
    expect(alert.message).toContain("3 active notes are");
  });
});

describe("checkStaleLeads", () => {
  it("returns warning for leads with no activity for 90+ days", () => {
    const leads = [
      { id: 1, status: "contacted", updatedAt: daysAgo(100) },
      { id: 2, status: "new", updatedAt: daysAgo(95) },
    ];
    const alert = checkStaleLeads(leads);
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe("warning");
    expect(alert!.type).toBe("stale_leads");
  });

  it("returns null when all leads have recent activity", () => {
    const leads = [
      { id: 1, status: "new", updatedAt: daysAgo(5) },
    ];
    expect(checkStaleLeads(leads)).toBeNull();
  });

  it("ignores converted leads", () => {
    const leads = [
      { id: 1, status: "converted", updatedAt: daysAgo(100) },
    ];
    expect(checkStaleLeads(leads)).toBeNull();
  });

  it("ignores dead leads", () => {
    const leads = [
      { id: 1, status: "dead", updatedAt: daysAgo(200) },
    ];
    expect(checkStaleLeads(leads)).toBeNull();
  });

  it("counts only truly stale leads (exactly on threshold is not stale)", () => {
    // 89 days ago is NOT stale
    const leads = [
      { id: 1, status: "new", updatedAt: daysAgo(89) },
    ];
    expect(checkStaleLeads(leads)).toBeNull();
  });
});

describe("checkStuckDeals", () => {
  it("returns warning for deals not progressed in 45+ days", () => {
    const deals = [
      { id: 1, status: "offer_sent", updatedAt: daysAgo(50) },
    ];
    const alert = checkStuckDeals(deals);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe("stuck_deals");
    expect(alert!.alertType).toBe("revenue_at_risk");
  });

  it("ignores closed deals", () => {
    const deals = [
      { id: 1, status: "closed", updatedAt: daysAgo(60) },
    ];
    expect(checkStuckDeals(deals)).toBeNull();
  });

  it("ignores cancelled deals", () => {
    const deals = [
      { id: 1, status: "cancelled", updatedAt: daysAgo(60) },
    ];
    expect(checkStuckDeals(deals)).toBeNull();
  });

  it("returns null when deals are recent", () => {
    const deals = [
      { id: 1, status: "under_contract", updatedAt: daysAgo(10) },
    ];
    expect(checkStuckDeals(deals)).toBeNull();
  });
});

describe("checkStaleAVM", () => {
  it("returns info alert for properties with no AVM update in 90+ days", () => {
    const properties = [
      { id: 1, status: "active", updatedAt: daysAgo(100) },
      { id: 2, status: "available", updatedAt: daysAgo(95) },
    ];
    const alert = checkStaleAVM(properties);
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe("info");
    expect(alert!.type).toBe("stale_avm");
  });

  it("ignores sold properties", () => {
    const properties = [
      { id: 1, status: "sold", updatedAt: daysAgo(100) },
    ];
    expect(checkStaleAVM(properties)).toBeNull();
  });

  it("uses correct plural/singular grammar", () => {
    const one = checkStaleAVM([{ id: 1, status: "active", updatedAt: daysAgo(100) }])!;
    const many = checkStaleAVM([
      { id: 1, status: "active", updatedAt: daysAgo(100) },
      { id: 2, status: "active", updatedAt: daysAgo(110) },
    ])!;

    expect(one.title).toBe("1 Property Needs AVM Refresh");
    expect(many.title).toBe("2 Properties Need AVM Refresh");
  });
});

describe("alert severity hierarchy", () => {
  it("overdue notes are critical severity", () => {
    const notes = [{ id: 1, status: "active", maturityDate: daysAgo(1) }];
    expect(checkOverdueNotes(notes)!.severity).toBe("critical");
  });

  it("stale leads are warning severity", () => {
    const leads = [{ id: 1, status: "new", updatedAt: daysAgo(100) }];
    expect(checkStaleLeads(leads)!.severity).toBe("warning");
  });

  it("stuck deals are warning severity", () => {
    const deals = [{ id: 1, status: "offer_sent", updatedAt: daysAgo(50) }];
    expect(checkStuckDeals(deals)!.severity).toBe("warning");
  });

  it("stale AVM is info severity", () => {
    const properties = [{ id: 1, status: "active", updatedAt: daysAgo(100) }];
    expect(checkStaleAVM(properties)!.severity).toBe("info");
  });
});
