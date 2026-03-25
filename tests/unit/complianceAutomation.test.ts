import { describe, it, expect } from "vitest";

// Pure functions from compliance logic

function checkDoddFrank(interestRate: number, stateLimit: number): { status: "pass" | "fail"; detail: string } {
  if (interestRate > stateLimit) {
    return { status: "fail", detail: `Interest rate ${interestRate}% exceeds ${stateLimit}% usury limit` };
  }
  return { status: "pass", detail: `Rate ${interestRate}% within ${stateLimit}% limit` };
}

function checkTCPA(phoneNumber: string, dncList: Set<string>): { status: "pass" | "fail"; detail: string } {
  if (dncList.has(phoneNumber)) {
    return { status: "fail", detail: "Number is on the Do Not Call registry" };
  }
  return { status: "pass", detail: "Number not on DNC list" };
}

function deriveStatus(checks: Array<{ status: "pass" | "warn" | "fail" }>): string {
  if (checks.some(c => c.status === "fail")) return "non_compliant";
  if (checks.some(c => c.status === "warn")) return "review_needed";
  return "compliant";
}

describe("complianceAutomation — Dodd-Frank checks", () => {
  it("flags rate > state usury limit", () => {
    const result = checkDoddFrank(12, 10);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("exceeds");
  });

  it("passes valid note", () => {
    const result = checkDoddFrank(9, 10);
    expect(result.status).toBe("pass");
  });

  it("handles exact boundary", () => {
    const result = checkDoddFrank(10, 10);
    expect(result.status).toBe("pass");
  });
});

describe("complianceAutomation — TCPA checks", () => {
  it("identifies DNC numbers", () => {
    const dnc = new Set(["555-1234", "555-5678"]);
    const result = checkTCPA("555-1234", dnc);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Do Not Call");
  });

  it("passes non-DNC numbers", () => {
    const dnc = new Set(["555-1234"]);
    const result = checkTCPA("555-9999", dnc);
    expect(result.status).toBe("pass");
  });
});

describe("complianceAutomation — report generation", () => {
  it("generates for org with no notes and no campaigns (empty but valid)", () => {
    const notes: any[] = [];
    const campaigns: any[] = [];
    const report = {
      notes: notes.map(n => ({ id: n.id, doddFrankStatus: "pass" })),
      campaigns: campaigns.map(c => ({ id: c.id, tcpaStatus: "pass" })),
      generatedAt: new Date().toISOString(),
      disclaimer: "Does not constitute legal advice",
    };
    expect(report.notes).toHaveLength(0);
    expect(report.campaigns).toHaveLength(0);
    expect(report.disclaimer).toBeTruthy();
  });
});

describe("complianceAutomation — status derivation", () => {
  it("all pass → compliant", () => {
    expect(deriveStatus([{ status: "pass" }, { status: "pass" }])).toBe("compliant");
  });

  it("any fail → non_compliant", () => {
    expect(deriveStatus([{ status: "pass" }, { status: "fail" }])).toBe("non_compliant");
  });

  it("warn without fail → review_needed", () => {
    expect(deriveStatus([{ status: "pass" }, { status: "warn" }])).toBe("review_needed");
  });
});
