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

  it("no file outside the canonical module keeps a per-state transfer-tax rate", () => {
    const offenders = files.filter((f) => {
      if (f === "shared/regulatory/transferTax.ts") return false;
      const src = stripComments(readFileSync(f, "utf8"));
      return /\btransferTaxPercent\s*:|\bSTATE_TRANSFER_TAX\b|\bgetTransferTaxAmount\b/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
