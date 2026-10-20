/**
 * The purchase agreement prints the statutory transfer tax, or refuses to
 * print one (best-in-class audit 2026-10-20, §3 P0 #1).
 *
 * It used to print "Documentary stamp tax $0.70 per $100 … — estimated
 * $70.00" on a $100,000 Florida deal: the right rule beside a figure 10× low,
 * from a second hand-typed percent table. These drive the real assembler.
 * Expected dollar figures are statute arithmetic (see each case).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { assembleContract, type ContractAssemblyInput } from "../../server/services/contracts/contractAssembly";
import { stripComments } from "../helpers/stripComments";

function input(state: string, county: string, price: number, extra: Partial<ContractAssemblyInput["property"]> = {}): ContractAssemblyInput {
  return {
    kind: "purchase_agreement",
    organizationName: "Cedar Ridge",
    deal: { id: 1, status: "accepted", acceptedAmount: price, closingDate: "2026-11-15" },
    property: { id: 1, apn: "12-34-56", address: "Tract 4, County Road 219", state, county, sizeAcres: 5, ...extra },
    seller: { legalName: "Ana Ruiz" },
    buyer: { legalName: "Cedar Ridge Land Holdings LLC" },
  };
}

function body(i: ContractAssemblyInput): string {
  const r = assembleContract(i);
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.refusal).slice(0, 200)}`);
  return r.draft.content;
}

function transferTaxLine(content: string): string {
  const m = content.match(/<li><strong>Transfer tax:<\/strong>[^<]*<\/li>/);
  if (!m) throw new Error("no transfer tax line in contract");
  return m[0];
}

describe("purchase agreement transfer tax", () => {
  it("FL $100,000: $0.70 per $100 × 1,000 = $700, never $70", () => {
    const line = transferTaxLine(body(input("FL", "Leon", 100_000)));
    expect(line).toContain("$700");
    expect(line).not.toMatch(/\$70(\.00)?\b(?!0)/);
  });

  it("NV Clark $200,000: $2.55 per $500 × 400 = $1,020", () => {
    expect(transferTaxLine(body(input("NV", "Clark", 200_000)))).toContain("$1,020");
  });

  it("NC $150,000: $1 per $500 × 300 = $300", () => {
    expect(transferTaxLine(body(input("NC", "Wake", 150_000)))).toContain("$300");
  });

  it("Miami-Dade without a recorded property class states the rule and no figure", () => {
    const line = transferTaxLine(body(input("FL", "Miami-Dade", 100_000)));
    expect(line).toMatch(/No estimate is stated/);
    expect(line).not.toMatch(/Estimated \$/);
  });

  it("Miami-Dade vacant land: $1.05 per $100 × 1,000 = $1,050", () => {
    expect(transferTaxLine(body(input("FL", "Miami-Dade", 100_000, { propertyClass: "vacant_land" })))).toContain("$1,050");
  });

  it("TX states there is no transfer tax", () => {
    expect(transferTaxLine(body(input("TX", "Travis", 100_000)))).toMatch(/No transfer tax/);
  });
});

describe("there is one transfer-tax table", () => {
  // Every source file that could hold a second table. A second table is what
  // let the two disagree; this population is enumerated so a new directory
  // cannot hide one.
  const ROOTS = ["server", "shared", "client/src"];
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const n of readdirSync(dir)) {
      if (n === "node_modules") continue;
      const p = join(dir, n);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
    }
    return out;
  }
  const files = ROOTS.flatMap(walk);

  it("the population is non-vacuous", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain("shared/regulatory/transferTax.ts");
  });

  it("the population includes every surface that has held a second table", () => {
    for (const f of [
      "server/services/regulatoryIntelligence.ts",
      "server/services/countyRecordingFees.ts",
      "server/services/stateDocumentConfig.ts",
      "server/services/closingCostEstimator.ts",
      "client/src/pages/regulatory-intel.tsx",
      "client/src/pages/closing-costs.tsx",
    ]) expect(files).toContain(f);
  });

  // Each predicate is a SHAPE a second table has taken on this repo:
  //  - the old column / map / getter names;
  //  - a string literal on a transferTax* key (regulatoryIntelligence.ts held
  //    `transferTax: "0.35% documentary stamp"` for FL — the deed rate is
  //    $0.70 per $100 — and wrong AR and OK strings, served at
  //    /api/regulatory/states/:code);
  //  - a SCREAMING-case per-state rate table (STATE_TRANSFER_TAX, …);
  //  - a statutory rate written as prose ("$0.60 per $100", "0.35%
  //    documentary stamp") — countyRecordingFees restated Miami-Dade's rate
  //    in a special note.
  // Source is comment-stripped first, so the comments recording WHY a table
  // was removed (this file's own included) are not read as the table.
  const PREDICATES: Array<[string, RegExp]> = [
    ["legacy table names", /\btransferTaxPercent\s*:|\bSTATE_TRANSFER_TAX\b|\bgetTransferTaxAmount\b/],
    // (a payer field — `transferTaxPaidBy: "buyer" | …` — names who pays, not a rate.)
    ["string literal on a transferTax key", /["']?\btransferTax(?!PaidBy|Payer)\w*["']?\s*\??:\s*["'`]/],
    ["per-state rate table name", /\b[A-Z_]*(?:TRANSFER|DEED|STAMP|EXCISE|CONVEYANCE|RECORDATION)_?TAX(?:_[A-Z]+)*\s*(?::|=)/],
    ["statutory rate as prose", /\$\d+(?:\.\d+)?\s*per\s*\$(?:100|500|1,?000)\b|\d(?:\.\d+)?%\s*(?:documentary|doc(?:ument)?\s*stamp|deed tax|transfer tax|excise|conveyance)/i],
  ];
  const CANONICAL = "shared/regulatory/transferTax.ts";
  const stripped = new Map(files.map((f) => [f, stripComments(readFileSync(f, "utf8"))]));

  it("every predicate is live: each matches its own fixture, and prose matches the canonical module", () => {
    const fixtures: Record<string, string> = {
      "legacy table names": "const STATE_TRANSFER_TAX = {}",
      "string literal on a transferTax key": 'const p = { transferTax: "0.35% documentary stamp" }',
      "per-state rate table name": "const DEED_TAX_RATES: Record<string, number> = { FL: 0.7 }",
      "statutory rate as prose": 'notes: ["$0.60 per $100 single-family"]',
    };
    for (const [name, re] of PREDICATES) expect(re.test(fixtures[name]), name).toBe(true);
    // The real table is written in statutory prose; if the prose predicate
    // stopped matching it, it would stop matching a second copy too.
    expect(PREDICATES[3][1].test(stripped.get(CANONICAL)!)).toBe(true);
    // And the stripper did not blank the canonical module.
    expect(stripped.get(CANONICAL)!).toContain("TRANSFER_TAX_RULES");
  });

  it("the comment stripper does not hide a table: a commented-out table is not an offender, a live one is", () => {
    const live = 'const p = { transferTax: "none" };';
    const dead = '// const p = { transferTax: "none" };';
    expect(PREDICATES[1][1].test(stripComments(live))).toBe(true);
    expect(PREDICATES[1][1].test(stripComments(dead))).toBe(false);
  });

  for (const [name, re] of PREDICATES) {
    it(`no file outside the canonical module has a ${name}`, () => {
      const offenders = files.filter((f) => f !== CANONICAL && re.test(stripped.get(f)!));
      expect(offenders).toEqual([]);
    });
  }
});

describe("/api/regulatory/states/:code serves the canonical rule", () => {
  it("FL, AR, OK and NC profiles carry describeTransferTax(), not a hand-typed string", async () => {
    const { regulatoryIntelligenceService } = await import("../../server/services/regulatoryIntelligence");
    const { describeTransferTax } = await import("../../shared/regulatory/transferTax");
    for (const st of ["FL", "AR", "OK", "NC", "TX"]) {
      expect(regulatoryIntelligenceService.getStateProfile(st)!.transferTax).toBe(describeTransferTax(st));
    }
    expect(regulatoryIntelligenceService.getStateProfile("FL")!.transferTax).toContain("$0.70 per $100");
    expect(regulatoryIntelligenceService.getStateProfile("AR")!.transferTax).toContain("$3.30 per $1,000");
    expect(regulatoryIntelligenceService.getStateProfile("OK")!.transferTax).toContain("$0.75 per $500");
  });
});
