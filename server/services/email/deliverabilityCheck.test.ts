/**
 * Tests for the deliverability check module — phase D3.
 *
 * Stubs the `DnsResolver` interface rather than `node:dns` directly. The pure
 * helpers (parseSpf / parseDmarc / scoreSeverity) cover the unit-level
 * branches; the integration test for `checkDeliverability` validates the
 * happy path + the DNS-error propagation path through the same stub.
 */

import { describe, expect, it } from "vitest";
import {
  checkDeliverability,
  DEFAULT_DKIM_SELECTORS,
  type DeliverabilityReport,
  type DnsResolver,
  parseDmarc,
  parseSpf,
  reviewWelcomeContent,
  scoreSeverity,
} from "./deliverabilityCheck";

// ── parseSpf ────────────────────────────────────────────────────────────────
describe("parseSpf", () => {
  it("extracts mechanisms + all-policy from a valid record", () => {
    const r = parseSpf("v=spf1 include:amazonses.com include:_spf.google.com ~all");
    expect(r.mechanisms).toEqual(["include:amazonses.com", "include:_spf.google.com"]);
    expect(r.allPolicy).toBe("~all");
  });

  it("flags duplicate v=spf1 markers as malformed", () => {
    const r = parseSpf("v=spf1 include:amazonses.com v=spf1 ~all");
    expect(r.mechanisms).toEqual([]);
    expect(r.allPolicy).toBeNull();
  });

  it("captures -all hard fail", () => {
    const r = parseSpf("v=spf1 -all");
    expect(r.allPolicy).toBe("-all");
  });

  it("returns null all-policy when no all-mechanism is present", () => {
    const r = parseSpf("v=spf1 include:amazonses.com");
    expect(r.allPolicy).toBeNull();
  });
});

// ── parseDmarc ──────────────────────────────────────────────────────────────
describe("parseDmarc", () => {
  it("extracts policy + percent + rua correctly", () => {
    const r = parseDmarc(
      "v=DMARC1; p=quarantine; pct=50; rua=mailto:rua@acreos.io,mailto:agg@acreos.io",
    );
    expect(r.policy).toBe("quarantine");
    expect(r.percent).toBe(50);
    expect(r.rua).toEqual(["mailto:rua@acreos.io", "mailto:agg@acreos.io"]);
  });

  it("defaults pct=100 when missing", () => {
    const r = parseDmarc("v=DMARC1; p=none; rua=mailto:rua@acreos.io");
    expect(r.percent).toBe(100);
  });

  it("flags missing p= as malformed (policy null)", () => {
    const r = parseDmarc("v=DMARC1; pct=100");
    expect(r.policy).toBeNull();
  });
});

// ── scoreSeverity ───────────────────────────────────────────────────────────
function baseReport(): Omit<DeliverabilityReport, "overallSeverity"> {
  return {
    domain: "acreos.io",
    checkedAt: new Date("2026-06-03T00:00:00Z"),
    spf: {
      found: true,
      record: { raw: "v=spf1 include:amazonses.com ~all", mechanisms: ["include:amazonses.com"], allPolicy: "~all" },
      issues: [],
    },
    dkim: {
      selectorsChecked: ["0._domainkey", "1._domainkey", "2._domainkey"],
      selectorsFound: [
        { selector: "0._domainkey", record: "v=DKIM1; k=rsa; p=AAAA", valid: true },
        { selector: "1._domainkey", record: "v=DKIM1; k=rsa; p=BBBB", valid: true },
        { selector: "2._domainkey", record: "v=DKIM1; k=rsa; p=CCCC", valid: true },
      ],
      issues: [],
    },
    dmarc: {
      found: true,
      record: { raw: "v=DMARC1; p=quarantine; rua=mailto:rua@acreos.io", policy: "quarantine", percent: 100, rua: ["mailto:rua@acreos.io"], ruf: [] },
      issues: [],
    },
    mx: { records: ["10 mx.acreos.io"], issues: [] },
  };
}

describe("scoreSeverity", () => {
  it("returns 'critical' when SPF missing", () => {
    const r = baseReport();
    r.spf.found = false;
    r.spf.record = null;
    expect(scoreSeverity(r)).toBe("critical");
  });

  it("returns 'critical' when ALL DKIM selectors missing", () => {
    const r = baseReport();
    r.dkim.selectorsFound = r.dkim.selectorsFound.map((s) => ({ ...s, valid: false, record: null }));
    expect(scoreSeverity(r)).toBe("critical");
  });

  it("returns 'warning' when one DKIM selector missing but others present", () => {
    const r = baseReport();
    r.dkim.selectorsFound[2] = { selector: "2._domainkey", record: null, valid: false };
    expect(scoreSeverity(r)).toBe("warning");
  });

  it("returns 'informational' when DMARC is p=none (normal Phase 0)", () => {
    const r = baseReport();
    r.dmarc.record = { raw: "v=DMARC1; p=none; rua=mailto:rua@acreos.io", policy: "none", percent: 100, rua: ["mailto:rua@acreos.io"], ruf: [] };
    expect(scoreSeverity(r)).toBe("informational");
  });

  it("returns 'clean' when all 4 checks pass with quarantine + rua", () => {
    const r = baseReport();
    expect(scoreSeverity(r)).toBe("clean");
  });

  it("returns 'informational' when DMARC missing entirely", () => {
    const r = baseReport();
    r.dmarc.found = false;
    r.dmarc.record = null;
    expect(scoreSeverity(r)).toBe("informational");
  });
});

// ── checkDeliverability ─────────────────────────────────────────────────────
function makeResolver(overrides: Partial<DnsResolver> = {}): DnsResolver {
  return {
    resolveTxt: async () => [],
    resolveMx: async () => [],
    ...overrides,
  };
}

describe("checkDeliverability", () => {
  it("happy path with mocked DNS responses scores clean", async () => {
    const resolver: DnsResolver = {
      resolveTxt: async (hostname: string) => {
        if (hostname === "acreos.io") return [["v=spf1 include:amazonses.com ~all"]];
        if (hostname === "_dmarc.acreos.io") {
          return [["v=DMARC1; p=quarantine; rua=mailto:rua@acreos.io"]];
        }
        if (DEFAULT_DKIM_SELECTORS.some((s) => hostname === `${s}.acreos.io`)) {
          return [["v=DKIM1; k=rsa; p=AAAA"]];
        }
        return [];
      },
      resolveMx: async () => [{ priority: 10, exchange: "mx.acreos.io" }],
    };
    const report = await checkDeliverability("acreos.io", { resolver });
    expect(report.overallSeverity).toBe("clean");
    expect(report.spf.found).toBe(true);
    expect(report.dkim.selectorsFound.every((s) => s.valid)).toBe(true);
    expect(report.dmarc.found).toBe(true);
    expect(report.mx.records).toEqual(["10 mx.acreos.io"]);
  });

  it("propagates DNS errors gracefully — missing SPF surfaces as critical", async () => {
    const resolver = makeResolver({
      resolveTxt: async (hostname: string) => {
        // Domain itself returns ENOTFOUND-equivalent (empty).
        if (hostname === "acreos.io") {
          const err = new Error("not found") as NodeJS.ErrnoException;
          err.code = "ENOTFOUND";
          throw err;
        }
        return [];
      },
      resolveMx: async () => {
        const err = new Error("no MX") as NodeJS.ErrnoException;
        err.code = "ENOTFOUND";
        throw err;
      },
    });
    const report = await checkDeliverability("acreos.io", { resolver });
    expect(report.overallSeverity).toBe("critical");
    expect(report.spf.found).toBe(false);
    expect(report.mx.records).toEqual([]);
    expect(report.mx.issues.length).toBeGreaterThan(0);
  });
});

// ── reviewWelcomeContent ────────────────────────────────────────────────────
describe("reviewWelcomeContent", () => {
  it("flags missing unsubscribe + missing address as CAN-SPAM violations", () => {
    const review = reviewWelcomeContent(
      "Welcome to AcreOS",
      "<html><body><p>Welcome!</p><a href='/start'>Get started</a></body></html>",
    );
    expect(review.unsubscribePresent).toBe(false);
    expect(review.physicalAddressLikelyPresent).toBe(false);
    expect(review.issues.some((i) => i.includes("unsubscribe"))).toBe(true);
    expect(review.issues.some((i) => i.includes("physical mailing address"))).toBe(true);
  });

  it("passes when an unsubscribe link + street address footer are present", () => {
    const review = reviewWelcomeContent(
      "Welcome to AcreOS",
      "<html><body><p>Welcome to your dashboard. Manage land deals end to end.</p><a href='/start'>Get started</a><footer>123 Main Street, Austin TX 78701 — <a href='/unsubscribe'>Unsubscribe</a></footer></body></html>",
    );
    expect(review.unsubscribePresent).toBe(true);
    expect(review.physicalAddressLikelyPresent).toBe(true);
    expect(review.spamTriggerWords).toEqual([]);
  });

  it("detects spam-trigger words in subject", () => {
    const review = reviewWelcomeContent(
      "ACT NOW — Limited time free offer",
      "<html><body>hi</body></html>",
    );
    expect(review.spamTriggerWords).toContain("act now");
    expect(review.spamTriggerWords).toContain("limited time");
    expect(review.spamTriggerWords).toContain("free");
  });
});
