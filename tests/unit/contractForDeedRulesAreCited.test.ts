/**
 * Contract-for-deed rules: cited statutes only; uncited states say "not yet
 * covered"; and the product's state profiles carry no hand-written rule.
 *
 * The Texas profile in regulatoryIntelligence said "Must record within 14
 * days" — Tex. Prop. Code § 5.076 says on or before the 30th day. Four other
 * states carried similar uncited lines. Every rule now comes from
 * shared/regulatory/sellerFinancingRules.ts, each with its section.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { checkContractForDeed, contractForDeedSummary, COVERED_STATES } from "../../shared/regulatory/sellerFinancingRules";

const ROOT = path.resolve(__dirname, "../..");

/** The code each covered state's citations must name — the source read on 2026-10-09. */
const CITE_FORM: Record<string, RegExp> = {
  TX: /^Tex\. Prop\. Code §§? 5\.0\d\d/,
  OH: /^Ohio Rev\. Code § 5313\.\d\d/,
  AZ: /^Ariz\. Rev\. Stat\. § 33-74\d/,
  MN: /^Minn\. Stat\. § 559\.21/,
};

describe("every covered state's every rule is cited to that state's statute", () => {
  it("the covered set is exactly the states with a citation form", () => {
    expect([...COVERED_STATES].sort()).toEqual(Object.keys(CITE_FORM).sort());
  });

  it.each([...COVERED_STATES])("%s", (state) => {
    const r = checkContractForDeed({ state, purchaserResidence: true, percentPaid: 10, yearsSinceFirstPayment: 1 });
    if (!r.covered) throw new Error(`${state} should be covered`);
    expect(r.requirements.length).toBeGreaterThan(0);
    for (const q of [...r.requirements, ...(r.defaultRemedy ? [r.defaultRemedy] : [])]) {
      expect(q.cite, q.rule).toMatch(CITE_FORM[state]);
      expect(q.rule.length).toBeGreaterThan(20);
    }
  });

  it.each(["TN", "FL", "GA", "NC", "OK", "CA", "", "ZZ"])("uncovered %j says not yet covered and infers nothing", (state) => {
    const r = checkContractForDeed({ state });
    expect(r.covered).toBe(false);
    if (!r.covered) expect(r.message).toMatch(/^Not yet covered/);
  });
});

describe("Texas executory contracts (Tex. Prop. Code ch. 5, subch. D)", () => {
  it("applies to a residence and to a lot of an acre or less; not when the deed comes within 180 days", () => {
    expect(checkContractForDeed({ state: "TX", purchaserResidence: true })).toEqual(expect.objectContaining({ applies: true }));
    expect(checkContractForDeed({ state: "TX", lotAcres: 0.75 })).toEqual(expect.objectContaining({ applies: true, appliesWhy: expect.stringMatching(/5\.062\(a\)\(1\)/) }));
    expect(checkContractForDeed({ state: "TX", purchaserResidence: true, deedDeliveryWithinDays: 120 })).toEqual(expect.objectContaining({ applies: false, appliesWhy: expect.stringMatching(/5\.062\(c\)/) }));
    expect(checkContractForDeed({ state: "TX", lotAcres: 40, purchaserResidence: false })).toEqual(expect.objectContaining({ applies: false }));
  });

  it("records within 30 days, not 14", () => {
    const r = checkContractForDeed({ state: "TX", purchaserResidence: true });
    if (!r.covered) throw new Error("covered");
    const rec = r.requirements.find((q) => q.cite.endsWith("5.076"))!;
    expect(rec.rule).toMatch(/30th day/);
  });

  it("a seller who does not own free and clear is a problem under § 5.085", () => {
    const r = checkContractForDeed({ state: "TX", purchaserResidence: true, sellerOwnsFreeAndClear: false });
    if (!r.covered) throw new Error("covered");
    expect(r.problems.map((p) => p.cite)).toEqual(["Tex. Prop. Code § 5.085"]);
  });

  it("default remedy: 30-day cure below the equity line; trustee sale with 60 days at 40% / 48 payments / recorded", () => {
    const rem = (i: object) => { const r = checkContractForDeed({ state: "TX", purchaserResidence: true, ...i }); return r.covered ? r.defaultRemedy : null; };
    expect(rem({ percentPaid: 10, monthlyPaymentsMade: 12, recorded: false })!.cite).toBe("Tex. Prop. Code §§ 5.063–5.065");
    expect(rem({ percentPaid: 40 })!.cite).toBe("Tex. Prop. Code § 5.066");
    expect(rem({ percentPaid: 5, monthlyPaymentsMade: 48 })!.cite).toBe("Tex. Prop. Code § 5.066");
    expect(rem({ percentPaid: 5, recorded: true })!.cite).toBe("Tex. Prop. Code § 5.066");
    expect(rem({})).toBeNull();
  });
});

describe("the other covered states' default lines", () => {
  it("Arizona's forfeiture grace periods by share paid (§ 33-742(D))", () => {
    const wait = (p: number) => { const r = checkContractForDeed({ state: "AZ", percentPaid: p }); return r.covered ? r.defaultRemedy!.rule : ""; };
    expect(wait(10)).toMatch(/30 days/);
    expect(wait(20)).toMatch(/60 days/);
    expect(wait(35)).toMatch(/120 days/);
    expect(wait(50)).toMatch(/nine months/);
  });
  it("Ohio: foreclosure only at five years or 20% (§ 5313.07); forfeiture before (§ 5313.08)", () => {
    const c = (i: object) => { const r = checkContractForDeed({ state: "OH", ...i }); return r.covered ? r.defaultRemedy!.cite : ""; };
    expect(c({ percentPaid: 25, yearsSinceFirstPayment: 1 })).toBe("Ohio Rev. Code § 5313.07");
    expect(c({ percentPaid: 5, yearsSinceFirstPayment: 6 })).toBe("Ohio Rev. Code § 5313.07");
    expect(c({ percentPaid: 5, yearsSinceFirstPayment: 2 })).toBe("Ohio Rev. Code § 5313.08");
  });
  it("Minnesota: 60 days, 90 for an investor seller (§ 559.21)", () => {
    const r = (investorSeller: boolean) => { const x = checkContractForDeed({ state: "MN", investorSeller }); return x.covered ? x.defaultRemedy!.rule : ""; };
    expect(r(false)).toMatch(/60 days/);
    expect(r(true)).toMatch(/90 days/);
  });
});

describe("adoption: the product's state profiles read the cited checker, and carry no rule of their own", () => {
  it("the Texas profile states § 5.076's 30 days; an uncovered state says not yet covered", async () => {
    const { regulatoryIntelligenceService } = await import("../../server/services/regulatoryIntelligence");
    const tx = regulatoryIntelligenceService.getStateProfile("TX")!;
    expect(tx.contractForDeedRestrictions).toBe(contractForDeedSummary("TX"));
    expect(tx.contractForDeedRestrictions).toMatch(/§ 5\.076: .*30th day/);
    expect(tx.contractForDeedRestrictions).not.toMatch(/14 days/);
    expect(regulatoryIntelligenceService.getStateProfile("FL")!.contractForDeedRestrictions).toMatch(/^Not yet covered/);
  });

  it("no profile literal sets contractForDeedRestrictions (AST, comments ignored)", () => {
    const file = "server/services/regulatoryIntelligence.ts";
    const sf = ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true);
    const literals: string[] = [];
    let profiles = 0;
    const v = (n: ts.Node) => {
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "code" && ts.isStringLiteral(n.initializer)) profiles++;
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "contractForDeedRestrictions" && ts.isStringLiteralLike(n.initializer)) literals.push(n.initializer.text);
      ts.forEachChild(n, v);
    };
    v(sf);
    expect(profiles).toBeGreaterThanOrEqual(10);
    expect(literals).toEqual([]);
  });
});
