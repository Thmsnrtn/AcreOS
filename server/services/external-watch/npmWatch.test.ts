/**
 * Tests for the npm vulnerability watcher — pure-unit coverage of the
 * JSON parser + severity filter. No live `npm audit`, no DB.
 *
 *   - parseNpmAuditJson handles real-shape output, malformed input,
 *     empty input, and the indirect-dep edge case (string-only via[])
 *   - filterBySeverity drops moderate/low by default and includes them
 *     when the floor is overridden
 *   - dedup intent — synthesised URLs for indirect deps are stable
 */

import { describe, expect, it } from "vitest";
import {
  filterBySeverity,
  parseNpmAuditJson,
  type NpmAdvisory,
} from "./npmWatch";

describe("parseNpmAuditJson", () => {
  it("returns empty on empty input", () => {
    expect(parseNpmAuditJson("")).toEqual([]);
  });

  it("returns empty on non-JSON garbage", () => {
    expect(parseNpmAuditJson("totally not json")).toEqual([]);
  });

  it("returns empty when JSON has no vulnerabilities key", () => {
    expect(parseNpmAuditJson(JSON.stringify({ ok: true }))).toEqual([]);
  });

  it("parses a real-shape audit with one direct + one indirect vuln", () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        "lodash": {
          name: "lodash",
          severity: "high",
          via: [
            {
              source: 1751,
              name: "lodash",
              title: "Prototype Pollution in lodash",
              url: "https://github.com/advisories/GHSA-jf85-cpcp-j695",
              severity: "high",
              range: ">=3.7.0 <4.17.19",
            },
          ],
          range: ">=3.7.0 <4.17.19",
          fixAvailable: { name: "lodash", version: "4.17.21" },
        },
        "nested-pkg": {
          name: "nested-pkg",
          severity: "critical",
          via: ["lodash"],
          range: "*",
          fixAvailable: true,
        },
      },
      metadata: { vulnerabilities: { high: 1, critical: 1, total: 2 } },
    });
    const advisories = parseNpmAuditJson(raw);
    expect(advisories).toHaveLength(2);
    const lodash = advisories.find((a) => a.packageName === "lodash");
    expect(lodash).toBeDefined();
    expect(lodash!.severity).toBe("high");
    expect(lodash!.sourceUrl).toBe(
      "https://github.com/advisories/GHSA-jf85-cpcp-j695",
    );
    expect(lodash!.summary).toMatch(/Prototype Pollution/);

    const nested = advisories.find((a) => a.packageName === "nested-pkg");
    expect(nested).toBeDefined();
    expect(nested!.severity).toBe("critical");
    // indirect — synthesised URL is stable
    expect(nested!.sourceUrl).toBe("npm:nested-pkg#critical");
  });

  it("skips entries with unknown severity", () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        "weird": {
          name: "weird",
          severity: "purple",
          via: [],
        },
      },
    });
    expect(parseNpmAuditJson(raw)).toEqual([]);
  });

  it("emits one row per (pkg × advisory) when via has multiple objects", () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        "multi": {
          name: "multi",
          severity: "critical",
          via: [
            { url: "https://github.com/advisories/A", title: "RCE", severity: "critical" },
            { url: "https://github.com/advisories/B", title: "DoS", severity: "high" },
          ],
          range: "*",
          fixAvailable: true,
        },
      },
    });
    const advisories = parseNpmAuditJson(raw);
    expect(advisories).toHaveLength(2);
    expect(advisories.map((a) => a.sourceUrl).sort()).toEqual([
      "https://github.com/advisories/A",
      "https://github.com/advisories/B",
    ]);
  });

  it("dedup intent — synthesised URLs are stable across re-parse", () => {
    const raw = JSON.stringify({
      vulnerabilities: {
        "x": { name: "x", severity: "high", via: ["y"] },
      },
    });
    const first = parseNpmAuditJson(raw);
    const second = parseNpmAuditJson(raw);
    expect(first[0].sourceUrl).toBe(second[0].sourceUrl);
    expect(first[0].sourceUrl).toBe("npm:x#high");
  });
});

describe("filterBySeverity", () => {
  const advisories: NpmAdvisory[] = [
    { packageName: "a", severity: "low", summary: "", detail: "", sourceUrl: "a" },
    { packageName: "b", severity: "moderate", summary: "", detail: "", sourceUrl: "b" },
    { packageName: "c", severity: "high", summary: "", detail: "", sourceUrl: "c" },
    { packageName: "d", severity: "critical", summary: "", detail: "", sourceUrl: "d" },
  ];

  it("default 'high' floor drops low + moderate", () => {
    const filtered = filterBySeverity(advisories, "high");
    expect(filtered.map((a) => a.packageName)).toEqual(["c", "d"]);
  });

  it("'critical' floor drops everything but critical", () => {
    const filtered = filterBySeverity(advisories, "critical");
    expect(filtered.map((a) => a.packageName)).toEqual(["d"]);
  });

  it("'moderate' floor includes moderate when overridden", () => {
    const filtered = filterBySeverity(advisories, "moderate");
    expect(filtered.map((a) => a.packageName)).toEqual(["b", "c", "d"]);
  });

  it("'low' floor includes everything", () => {
    const filtered = filterBySeverity(advisories, "low");
    expect(filtered).toHaveLength(4);
  });
});
