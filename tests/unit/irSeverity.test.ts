/**
 * IR severity ladder — single-source-of-truth tests (Tahoe Tess B).
 */

import { describe, it, expect } from "vitest";
import {
  IR_SEVERITIES,
  IR_SEVERITY_RANK,
  IR_SEVERITY_DEFAULT,
  isIrSeverity,
  coerceIrSeverity,
} from "@shared/schema/ir-severity";
import { severityToPriority } from "../../server/services/alertPolicy";

describe("IR_SEVERITIES ladder", () => {
  it("is ordered most→least severe", () => {
    expect(IR_SEVERITIES).toEqual(["critical", "warning", "info"]);
  });

  it("rank is strictly increasing as severity decreases", () => {
    expect(IR_SEVERITY_RANK.critical).toBeLessThan(IR_SEVERITY_RANK.warning);
    expect(IR_SEVERITY_RANK.warning).toBeLessThan(IR_SEVERITY_RANK.info);
  });

  it("default is info", () => {
    expect(IR_SEVERITY_DEFAULT).toBe("info");
  });
});

describe("isIrSeverity", () => {
  it("accepts locked values only", () => {
    expect(isIrSeverity("critical")).toBe(true);
    expect(isIrSeverity("warning")).toBe(true);
    expect(isIrSeverity("info")).toBe(true);
    expect(isIrSeverity("warn")).toBe(false);
    expect(isIrSeverity("high")).toBe(false);
    expect(isIrSeverity("CRITICAL")).toBe(false);
    expect(isIrSeverity(undefined)).toBe(false);
  });
});

describe("coerceIrSeverity — drift backstop", () => {
  it("passes through locked values", () => {
    expect(coerceIrSeverity("critical")).toBe("critical");
    expect(coerceIrSeverity("warning")).toBe("warning");
    expect(coerceIrSeverity("info")).toBe("info");
  });

  it("normalises common synonyms", () => {
    expect(coerceIrSeverity("warn")).toBe("warning");
    expect(coerceIrSeverity("WARN")).toBe("warning");
    expect(coerceIrSeverity("error")).toBe("critical");
    expect(coerceIrSeverity("fatal")).toBe("critical");
    expect(coerceIrSeverity("high")).toBe("critical");
    expect(coerceIrSeverity("informational")).toBe("info");
    expect(coerceIrSeverity("low")).toBe("info");
  });

  it("falls back to info for unknown / malformed values", () => {
    expect(coerceIrSeverity("banana")).toBe("info");
    expect(coerceIrSeverity("")).toBe("info");
    expect(coerceIrSeverity(null)).toBe("info");
    expect(coerceIrSeverity(42)).toBe("info");
  });
});

describe("severityToPriority uses the locked ladder", () => {
  it("a critical system_down pages (P0)", () => {
    expect(severityToPriority("critical", "system_down")).toBe("P0");
  });

  it("a legacy 'warn' string no longer falls through to P3", () => {
    // Before the lock: "warn" matched no branch → P3 (log-only). After:
    // coerced to "warning" → mass_delinquency maps to P1.
    expect(severityToPriority("warn", "mass_delinquency")).toBe("P1");
  });

  it("an external 'high' string is treated as critical → P1 (not P3)", () => {
    expect(severityToPriority("high", "something_unmapped")).toBe("P1");
  });
});
