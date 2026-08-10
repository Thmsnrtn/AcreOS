/**
 * Domain-truth ratchet (X-B scaffold — master handoff Addendum B §F).
 *
 * The statute register holds load-bearing legal claims that were written by
 * reading the CODE, not the law: as of the scaffold, no row records anyone
 * having retrieved the primary source (the statute's own text) and checked
 * the claim against it. Refuse-not-fabricate must apply to law, so this
 * suite holds three lines:
 *
 *   1. RATCHET — the count of register rows with NO primary-source citation
 *      may only SHRINK, and only by recording REAL sourcing work. Never
 *      lower it by inventing a citation.
 *   2. SEAM — sourcingGateForComputation() is the refuse-not-compute gate:
 *      an automation computing money, deadlines, or compliance verdicts
 *      from a register row must clear it first, and every unverified row
 *      refuses with an honest reason naming the row.
 *   3. CONSUMER PIN — at HEAD, NO automation computes from register rows.
 *      The production consumers are display/calendar only (the
 *      governance-coverage report and the O1 dated-obligations calendar);
 *      the domain automations the register points at via codeSites
 *      (redemptionClock, lateFeeProposal, periodic statements…) compute
 *      from their own domain registries. That is recorded honestly here —
 *      the pin exists so the FIRST automation wired to a register row must
 *      come through the gate consciously, not so we can pretend an
 *      enforcement target exists today.
 *
 * QUEUED, deliberately not built here: actual verification of rows
 * (state-by-state sourcing waves; licensed-professional spot-check for
 * money/deadline rows — founder queue).
 *
 * Modelled on tests/unit/statuteRegister.test.ts (baseline style) and
 * tests/unit/moneyCustodyHardStop.test.ts (repo scan style).
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  STATUTE_REGISTER,
  claimsWithoutPrimarySource,
  hasVerifiedSourcing,
  sourcingGateForComputation,
  type StatuteEntry,
} from "@shared/governance/statuteRegister";

const ROOT = path.resolve(__dirname, "../..");

/**
 * Rows with NO primary-source citation on file — nobody has recorded
 * retrieving the law's text and checking the claim against it.
 *
 * 2026-08-10 (initial): 31 of 31 — every row. Honest and expected: the
 * register was built from the code sites, not from the statutes. Addendum B
 * §F drives this to zero in state-by-state waves prioritized by customer
 * counties; money/deadline rows additionally require the
 * licensed-professional check before "verified".
 *
 * May only DECREASE, and only in the same commit as the real sourcing entry
 * it reflects. A lowered baseline with an invented citation behind it is the
 * exact fabrication this program exists to prevent.
 */
const CLAIMS_WITHOUT_PRIMARY_SOURCE_BASELINE = 31;

// ───────────────────────────────────────────────────────────────────────────
// 1. The ratchet
// ───────────────────────────────────────────────────────────────────────────

describe("domain-truth ratchet — claims without a primary source may only shrink", () => {
  it("the count never exceeds the baseline", () => {
    const unsourced = claimsWithoutPrimarySource().map((e) => e.id);
    expect(
      unsourced.length,
      `register rows without a primary source (${unsourced.length}) exceed the ` +
        `baseline (${CLAIMS_WITHOUT_PRIMARY_SOURCE_BASELINE}). Adding a NEW ` +
        `statute row without sourcing raises this — which is the signal: do the ` +
        `sourcing (real retrieval, real check — NEVER an invented citation; a ` +
        `baseline raise is founder-queue territory). If you genuinely sourced a ` +
        `row, lower the baseline in the same commit. Current: ${unsourced.join(", ")}`,
    ).toBeLessThanOrEqual(CLAIMS_WITHOUT_PRIMARY_SOURCE_BASELINE);
  });

  it("the baseline is not stale-high (a legitimate drop must lower it in the same commit)", () => {
    // Fix the occurrence, not the baseline — and when the occurrence count
    // genuinely drops, the baseline follows in the SAME commit (CLAUDE.md
    // wave discipline #5). Allowing slack would let the next regression hide.
    expect(
      claimsWithoutPrimarySource().length,
      `the unsourced count fell below the baseline ` +
        `(${CLAIMS_WITHOUT_PRIMARY_SOURCE_BASELINE}) — lower ` +
        `CLAIMS_WITHOUT_PRIMARY_SOURCE_BASELINE to the new count in this commit`,
    ).toBeGreaterThanOrEqual(CLAIMS_WITHOUT_PRIMARY_SOURCE_BASELINE);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The refuse-not-compute seam
// ───────────────────────────────────────────────────────────────────────────

describe("domain-truth seam — sourcingGateForComputation refuses every unverified row", () => {
  it("every row lacking verified sourcing refuses, naming the row and its honest state", () => {
    for (const e of STATUTE_REGISTER) {
      if (hasVerifiedSourcing(e)) continue; // verified rows pass by design
      const verdict = sourcingGateForComputation(e.id);
      expect(verdict.ok, `${e.id} must refuse — it has no verified sourcing`).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason, `${e.id} refusal must name the row`).toContain(e.id);
        expect(verdict.reason, `${e.id} refusal must refuse, not error`).toContain(
          "Refusing to compute",
        );
      }
    }
  });

  it("an id that is not in the register refuses (a computation cannot claim a row that does not exist)", () => {
    const verdict = sourcingGateForComputation("no.such-row");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("no.such-row");
      expect(verdict.reason).toContain("not in the statute register");
    }
  });

  it("the predicate clears ONLY the complete, professionally verified block", () => {
    const base: StatuteEntry = {
      id: "synthetic.for-predicate-test",
      citation: "Synthetic — not a real statute",
      what: "Synthetic entry exercising the predicate; never added to the register.",
      codeSites: ["shared/governance/statuteRegister.ts"],
      enforcement: { kind: "unit-test", refs: ["tests/unit/domainTruthRatchet.test.ts"] },
      reviewStatus: "UNREVIEWED",
      failureMode:
        "None — synthetic. If this entry ever appears in STATUTE_REGISTER, the register is fabricating.",
    };
    const full = {
      ...base,
      primarySourceCitation: "Synthetic primary source, long enough to be substantive",
      retrievedAt: "2026-08-10",
      verifiedBy: "licensed-professional" as const,
      confidence: "verified" as const,
    };
    expect(hasVerifiedSourcing(full)).toBe(true);
    // Each missing or downgraded leg fails the predicate — defense in depth
    // beyond the data invariants in statuteRegister.test.ts.
    expect(hasVerifiedSourcing(base)).toBe(false);
    expect(hasVerifiedSourcing({ ...full, confidence: "drafted" })).toBe(false);
    expect(hasVerifiedSourcing({ ...full, verifiedBy: "model-draft" })).toBe(false);
    expect(hasVerifiedSourcing({ ...full, verifiedBy: "founder" })).toBe(false);
    expect(hasVerifiedSourcing({ ...full, primarySourceCitation: undefined })).toBe(false);
    expect(hasVerifiedSourcing({ ...full, retrievedAt: undefined })).toBe(false);
    // And the synthetic row genuinely is not in the register.
    expect(STATUTE_REGISTER.some((e) => e.id === base.id)).toBe(false);
  });

  it("at the scaffold, zero rows are verified — the gate refuses the whole register", () => {
    // Derived, not hardcoded: the day the first row is legitimately verified,
    // this assertion updates to the new truth (rewrite, never delete).
    expect(STATUTE_REGISTER.filter(hasVerifiedSourcing).map((e) => e.id)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The consumer pin — no automation computes from register rows at HEAD
// ───────────────────────────────────────────────────────────────────────────

const SCAN_ROOTS = ["server", "shared", "client/src"];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The register's production consumers, pinned exactly. Both are
 * DISPLAY/CALENDAR readers — neither computes money, a deadline, or a
 * compliance verdict from a row:
 *
 *   - server/routes-founder-governance-coverage.ts — the founder coverage
 *     report (pure registry read, rendered by the Letter and the Story).
 *   - server/services/datedObligations.ts — the O1 review calendar, which
 *     derives nextReviewDue rows into dated obligations (surfacing a review
 *     date is calendar work, not computing from the row's legal content).
 *
 * Adding a consumer that COMPUTES from rows requires calling
 * sourcingGateForComputation() and refusing on a false verdict — then add
 * the file here in the same commit, saying which kind of consumer it is.
 */
const ALLOWED_PRODUCTION_CONSUMERS = [
  "server/routes-founder-governance-coverage.ts",
  "server/services/datedObligations.ts",
].sort();

describe("domain-truth seam — no deadline/money automation is reachable from a register row at HEAD", () => {
  it("production importers of the statute register are exactly the pinned display/calendar pair", () => {
    const importRe = /from\s+["'][^"']*governance\/statuteRegister["']|require\(\s*["'][^"']*governance\/statuteRegister["']\s*\)/;
    const importers: string[] = [];
    for (const rootDir of SCAN_ROOTS) {
      for (const file of walk(path.join(ROOT, rootDir))) {
        if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
        const rel = path.relative(ROOT, file);
        if (rel === "shared/governance/statuteRegister.ts") continue; // the register itself
        if (importRe.test(fs.readFileSync(file, "utf8"))) importers.push(rel);
      }
    }
    expect(
      importers.sort(),
      `production consumers of the statute register changed. The pinned pair is ` +
        `display/calendar only — that is what makes "zero deadline/money ` +
        `automations reachable from an unverified row" TRUE at HEAD rather than ` +
        `asserted. A new consumer that computes from rows must go through ` +
        `sourcingGateForComputation() (refuse-not-compute) and then be added to ` +
        `ALLOWED_PRODUCTION_CONSUMERS in the same commit.`,
    ).toEqual(ALLOWED_PRODUCTION_CONSUMERS);
  });

  it("the pinned consumers still exist (a stale pin is a false assurance)", () => {
    for (const rel of ALLOWED_PRODUCTION_CONSUMERS) {
      expect(fs.existsSync(path.join(ROOT, rel)), `${rel} is gone`).toBe(true);
    }
  });
});
