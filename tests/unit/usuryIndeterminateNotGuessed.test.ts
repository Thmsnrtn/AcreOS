/**
 * Where AcreOS's own usury sources disagree, it says so — it does not pick one.
 *
 * ── THE FOUNDER RULING THIS PINS (2026-08-24) ───────────────────────────────
 * "Treat the 25-state disagreement as external legal proof debt. Do not choose a
 * legal answer by preferring one internal implementation. Where authoritative
 * jurisdiction-specific evidence is unresolved, legal/compliance classification
 * must fail to INDETERMINATE, not guess compliant/noncompliant."
 *
 * Three tables in this repo describe a state's general civil usury cap and
 * disagree for 28 of 51 jurisdictions — Texas among them, which is also the
 * state `auditOrgUsury` used to substitute for every note in every organization.
 *
 * ── WHAT THE WRONG FIX WOULD HAVE LOOKED LIKE ───────────────────────────────
 * Taking the LOWEST of the three caps. It reads as prudence and is still a legal
 * claim: "this rate is usurious in your state" is an assertion whether it errs
 * high or low, and an operator pricing a note off it would be relying on a
 * number AcreOS invented out of a disagreement. The cases below fail if any such
 * reconciliation appears — a consensus that returns a cap for a disagreeing
 * state is exactly the guess the ruling forbids.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { usuryConsensus } from "../../server/services/usuryConsensus";

const ROOT = path.resolve(__dirname, "../..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ALL = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");

describe("the consensus reports agreement and disagreement honestly", () => {
  it("VACUITY: some jurisdictions DO agree, so indeterminate is not the only answer", () => {
    // A function that returned indeterminate for everything would satisfy every
    // assertion below while making the product useless. Arkansas agrees at 17.
    const agreed = ALL.filter((s) => usuryConsensus(s).status === "agreed");
    expect(agreed.length, "no jurisdiction agrees — the probes are broken").toBeGreaterThan(10);
    const ar = usuryConsensus("AR");
    expect(ar.status).toBe("agreed");
    if (ar.status === "agreed") expect(ar.capPercent).toBe(17);
  });

  it("a state the sources disagree about is INDETERMINATE, with the conflict shown", () => {
    const tx = usuryConsensus("TX");
    expect(tx.status).toBe("indeterminate");
    if (tx.status === "indeterminate") {
      expect(tx.reason).toMatch(/disagree/i);
      // The operator must be able to see WHAT disagreed, not just that it did.
      expect(Object.keys(tx.sources).length).toBeGreaterThan(1);
    }
  });

  it("a state no source covers is INDETERMINATE, never 'no cap'", () => {
    // Absence of a row is absence of evidence. Rendering it as uncapped would be
    // the same fabrication in the permissive direction.
    const zz = usuryConsensus("ZZ");
    expect(zz.status).toBe("indeterminate");
    if (zz.status === "indeterminate") expect(zz.reason).toMatch(/No usury source/i);
  });

  it("never reconciles a disagreement into a number", () => {
    // The load-bearing case. `agreed` may only be returned when the sources
    // actually agree — so min/max/average/prefer-one all fail here.
    for (const s of ALL) {
      const c = usuryConsensus(s);
      if (c.status !== "agreed") continue;
      const values = Object.values(c.sources);
      expect(
        new Set(values.map((v) => String(v))).size,
        `${s} was reported as AGREED while its sources hold ${JSON.stringify(c.sources)}`,
      ).toBe(1);
    }
  });

  it("the module takes no min/max/average over the sources", () => {
    const src = code("server/services/usuryConsensus.ts");
    expect(src, "a reconciliation crept in").not.toMatch(/Math\.(min|max)\s*\(/);
    expect(src).not.toMatch(/reduce\([^)]*\+/);
  });
});

describe("both compliance surfaces consult it before classifying", () => {
  it("auditOrgUsury declines to classify a disagreeing jurisdiction", () => {
    const src = code("server/services/usury.ts");
    expect(src).toMatch(/usuryConsensus\(state\)/);
    // The consensus check must come BEFORE checkUsury produces a verdict.
    const at = src.indexOf("usuryConsensus(state)");
    const verdict = src.indexOf("checkUsury(state, rate)");
    expect(at, "usuryConsensus is not consulted").toBeGreaterThan(-1);
    expect(
      at < verdict,
      "checkUsury renders a verdict before the consensus is consulted — the guess happens first",
    ).toBe(true);
  });

  it("complianceGate reports cannot-determine rather than a verdict", () => {
    const src = code("server/middleware/complianceGate.ts");
    expect(src).toMatch(/usuryConsensus\(state\)/);
    expect(src).toMatch(/cannot determine/i);
    // Join adjacent string literals before matching. The message is written as
    // `"... AcreOS is not " + "asserting that ..."`, and a regex that tries to
    // guess where the author wrapped the line is testing the formatting, not the
    // sentence. The first version of this assertion did exactly that and failed
    // against correct code.
    const joined = src.replace(/"\s*\+\s*"/g, "");
    expect(joined).toMatch(/AcreOS is not asserting that the rate is either lawful or usurious/i);
  });

  it("the indeterminate branch does not exit the warning collector", () => {
    // It used to `return warnings` — correct today, and a trap for the next
    // note-level warning somebody adds after it.
    const src = code("server/middleware/complianceGate.ts");
    const block = src.slice(src.indexOf("usuryConsensus(state)"));
    expect(block.slice(0, block.indexOf("checkUsury"))).not.toMatch(/return warnings;/);
  });
});
