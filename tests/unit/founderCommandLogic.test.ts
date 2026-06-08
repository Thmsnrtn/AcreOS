/**
 * Unit tests for the founder Command cockpit's pure logic
 * (client/src/components/founder/command/logic.ts).
 *
 * Covers the load-bearing derivations:
 *   - worst-severity rollup (worseStatus / companyStatus)
 *   - per-domain summarization (counts, status, top finding, active filter)
 *   - all-domains rollup includes every canonical domain + unknown extras
 *   - banner copy + severity mapping
 *
 * No DOM needed — these are pure functions, so this runs under node.
 */

import { describe, it, expect } from "vitest";

import {
  DOMAINS,
  type AuditFinding,
  type Severity,
  type FindingStatus,
  severityToStatus,
  worseStatus,
  isActiveFinding,
  pickTopFinding,
  summarizeDomain,
  summarizeAllDomains,
  companyStatus,
  totalActiveFindings,
  totalsBySeverity,
  companyStatusCopy,
  severityChipClasses,
  domainMeta,
} from "../../client/src/components/founder/command/logic";

let seq = 0;
function finding(
  partial: Partial<AuditFinding> & {
    domain: string;
    severity: Severity;
    status?: FindingStatus;
  },
): AuditFinding {
  seq += 1;
  return {
    id: partial.id ?? `f${seq}`,
    domain: partial.domain,
    detector: partial.detector ?? "test-detector",
    severity: partial.severity,
    title: partial.title ?? `Finding ${seq}`,
    detail: partial.detail ?? "detail",
    citedReason: partial.citedReason ?? "because",
    status: partial.status ?? "open",
    subjectRef: partial.subjectRef ?? null,
    metadata: partial.metadata ?? null,
    firstSeenAt: partial.firstSeenAt ?? "2026-06-01T00:00:00.000Z",
    lastSeenAt: partial.lastSeenAt ?? "2026-06-06T00:00:00.000Z",
  };
}

describe("severity → status mapping", () => {
  it("maps critical→red, warn→amber, info→green", () => {
    expect(severityToStatus("critical")).toBe("red");
    expect(severityToStatus("warn")).toBe("amber");
    expect(severityToStatus("info")).toBe("green");
  });
});

describe("worseStatus (worst-severity rollup primitive)", () => {
  it("red beats amber beats green", () => {
    expect(worseStatus("green", "amber")).toBe("amber");
    expect(worseStatus("amber", "red")).toBe("red");
    expect(worseStatus("red", "green")).toBe("red");
    expect(worseStatus("green", "green")).toBe("green");
  });
});

describe("isActiveFinding", () => {
  it("counts open + acknowledged, excludes resolved + stale", () => {
    expect(isActiveFinding({ status: "open" })).toBe(true);
    expect(isActiveFinding({ status: "acknowledged" })).toBe(true);
    expect(isActiveFinding({ status: "resolved" })).toBe(false);
    expect(isActiveFinding({ status: "stale" })).toBe(false);
  });
});

describe("pickTopFinding", () => {
  it("returns null for empty", () => {
    expect(pickTopFinding([])).toBeNull();
  });

  it("prefers higher severity over recency", () => {
    const old = finding({
      domain: "finance",
      severity: "critical",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    });
    const recentWarn = finding({
      domain: "finance",
      severity: "warn",
      lastSeenAt: "2026-06-06T00:00:00.000Z",
    });
    expect(pickTopFinding([recentWarn, old])?.id).toBe(old.id);
  });

  it("breaks severity ties by most recent lastSeenAt", () => {
    const older = finding({
      domain: "finance",
      severity: "warn",
      lastSeenAt: "2026-05-01T00:00:00.000Z",
    });
    const newer = finding({
      domain: "finance",
      severity: "warn",
      lastSeenAt: "2026-06-06T00:00:00.000Z",
    });
    expect(pickTopFinding([older, newer])?.id).toBe(newer.id);
  });
});

describe("summarizeDomain", () => {
  it("counts active warn/critical, sets worst status, excludes resolved", () => {
    const s = summarizeDomain("finance", [
      finding({ domain: "finance", severity: "warn", status: "open" }),
      finding({ domain: "finance", severity: "critical", status: "open" }),
      finding({ domain: "finance", severity: "warn", status: "resolved" }),
      finding({ domain: "finance", severity: "info", status: "acknowledged" }),
    ]);
    expect(s.openCount).toBe(3); // 2 open + 1 acknowledged, resolved excluded
    expect(s.warnCount).toBe(1);
    expect(s.criticalCount).toBe(1);
    expect(s.status).toBe("red"); // critical present
    expect(s.topFinding?.severity).toBe("critical");
  });

  it("empty domain is green with no findings", () => {
    const s = summarizeDomain("growth", []);
    expect(s.status).toBe("green");
    expect(s.openCount).toBe(0);
    expect(s.topFinding).toBeNull();
  });

  it("info-only domain stays green", () => {
    const s = summarizeDomain("ai", [
      finding({ domain: "ai", severity: "info", status: "open" }),
    ]);
    expect(s.status).toBe("green");
    expect(s.openCount).toBe(1);
    expect(s.warnCount).toBe(0);
    expect(s.criticalCount).toBe(0);
  });
});

describe("summarizeAllDomains", () => {
  it("includes every canonical domain even with zero findings", () => {
    const summaries = summarizeAllDomains([]);
    expect(summaries).toHaveLength(DOMAINS.length);
    expect(summaries.map((s) => s.domain)).toEqual([...DOMAINS]);
    expect(summaries.every((s) => s.status === "green")).toBe(true);
  });

  it("appends unknown extra domains after canonical ones", () => {
    const summaries = summarizeAllDomains([
      finding({ domain: "mystery", severity: "warn", status: "open" }),
    ]);
    expect(summaries).toHaveLength(DOMAINS.length + 1);
    const extra = summaries[summaries.length - 1];
    expect(extra.domain).toBe("mystery");
    expect(extra.status).toBe("amber");
    // domainMeta falls back gracefully for unknown domains
    expect(extra.meta.label).toBe("Mystery");
  });
});

describe("companyStatus (banner level)", () => {
  it("is green when all domains clear", () => {
    expect(companyStatus(summarizeAllDomains([]))).toBe("green");
  });

  it("is amber when worst is a warn and no criticals", () => {
    const s = summarizeAllDomains([
      finding({ domain: "growth", severity: "warn", status: "open" }),
      finding({ domain: "ai", severity: "info", status: "open" }),
    ]);
    expect(companyStatus(s)).toBe("amber");
  });

  it("is red when any domain has a critical", () => {
    const s = summarizeAllDomains([
      finding({ domain: "growth", severity: "warn", status: "open" }),
      finding({ domain: "compliance", severity: "critical", status: "open" }),
    ]);
    expect(companyStatus(s)).toBe("red");
  });

  it("ignores resolved criticals", () => {
    const s = summarizeAllDomains([
      finding({ domain: "compliance", severity: "critical", status: "resolved" }),
    ]);
    expect(companyStatus(s)).toBe("green");
  });
});

describe("totals + copy", () => {
  it("totalActiveFindings + totalsBySeverity sum across domains", () => {
    const s = summarizeAllDomains([
      finding({ domain: "growth", severity: "warn", status: "open" }),
      finding({ domain: "finance", severity: "critical", status: "open" }),
      finding({ domain: "finance", severity: "warn", status: "acknowledged" }),
      finding({ domain: "ai", severity: "warn", status: "resolved" }), // excluded
    ]);
    expect(totalActiveFindings(s)).toBe(3);
    expect(totalsBySeverity(s)).toEqual({ critical: 1, warn: 2 });
  });

  it("green copy reassures, red copy counts criticals", () => {
    expect(companyStatusCopy("green", 0, 0).headline).toMatch(/all clear/i);
    expect(companyStatusCopy("red", 2, 1).headline).toContain("2 critical");
    expect(companyStatusCopy("amber", 0, 1).headline).toContain("1 thing");
    expect(companyStatusCopy("amber", 0, 3).headline).toContain("3 things");
  });
});

describe("severityChipClasses + domainMeta tokens", () => {
  it("uses acr sentiment tokens, never raw hex", () => {
    expect(severityChipClasses("critical").text).toContain("acr-neg");
    expect(severityChipClasses("warn").text).toContain("acr-warn");
    expect(severityChipClasses("info").text).toContain("muted-foreground");
  });

  it("every canonical domain has a label + icon", () => {
    for (const d of DOMAINS) {
      const meta = domainMeta(d);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon).toBeTruthy();
    }
  });
});
