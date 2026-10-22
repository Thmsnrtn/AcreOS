/**
 * The auto-generated closing checklist knows whether the deal is
 * seller-financed (best-in-class audit 2026-10-20).
 *
 * `_autoGenerateClosingChecklist` hard-coded `isSellerFinanced = false`, so
 * the promissory-note, deed-of-trust and Dodd-Frank items never appeared on
 * the seller-financed deals they exist for. The population is every call of
 * generateClosingChecklist in server/: none may pass a boolean LITERAL as the
 * seller-finance argument — each must derive it from the deal.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../helpers/stripComments";

import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

vi.mock("../../server/db", () => ({ db: {} }));
const { dealIsSellerFinanced } = await import("../../server/services/closingChecklistGenerator");

describe("dealIsSellerFinanced", () => {
  it("a carried note's rate on the analysis means seller-financed", () => {
    expect(dealIsSellerFinanced({ analysisResults: { interestRate: 9 } })).toBe(true);
  });
  it("no analysis, no rate, or a zero rate is not", () => {
    expect(dealIsSellerFinanced({ analysisResults: null })).toBe(false);
    expect(dealIsSellerFinanced({ analysisResults: { interestRate: 0 } })).toBe(false);
    expect(dealIsSellerFinanced(undefined)).toBe(false);
  });
});

describe("every closing-checklist generation derives seller financing from the deal", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) files.push(p);
    }
  };
  walk("server");
  const calls = files.flatMap((f) => {
    const src = stripComments(readFileSync(f, "utf8"));
    return [...src.matchAll(/generateClosingChecklist\(([^)]*)\)/g)]
      .filter((m) => !/^\s*dealId:\s*number/.test(m[1])) // the declaration
      .map((m) => ({ f, args: m[1].split(",").map((a) => a.trim()) }));
  });

  it("the population is non-vacuous", () => {
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("no call passes a literal true/false for isSellerFinanced", () => {
    const literal = calls.filter((c) => c.args.length >= 4 && /^(true|false)$/.test(c.args[3]));
    expect(literal).toEqual([]);
  });
});
