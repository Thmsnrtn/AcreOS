/**
 * sovereign-protocol/immutables.json — hash-asserting unit test.
 *
 * THIS IS THE LOAD-BEARING CI GATE FOR CONSTITUTIONAL DRIFT.
 *
 * sovereign-protocol/immutables.json is the SINGLE SOURCE OF TRUTH for both
 * immutable lists (the 10 sovereign principles + the 12 customer immutables).
 * The hand-written copies in:
 *   - server/services/constitutionChecker.ts          (was: 10 sovereign principles)
 *   - server/services/solene/preCallConstitutionalChecker.ts (was: 12 verbatim)
 *   - server/services/solene/constitutionalGuard.ts   (was: 12 + critical set;
 *     now also hosts CONSTITUTIONAL_IMMUTABLES, the 12 short-form snapshot —
 *     moved out of shared/schema/solene-constitutional-violations.ts so
 *     shared/ never imports the server-only @sovereign alias)
 * have all been retired — each now re-exports from sovereign-protocol/immutables.ts,
 * which loads sovereign-protocol/immutables.json.
 *
 * This test does THREE things:
 *
 *  1. Pins the SHA-256 of the canonical JSON to a fixture hash. Hand-edit
 *     the JSON without updating the fixture → CI fails. This is the
 *     amendment-process forcing function: any change to the immutables MUST
 *     bump the fixture, which means the diff lands in PR review where Quinn
 *     (Chief of Alignment) can sign off.
 *
 *  2. Pins a STRUCTURAL hash (JSON-stringified canonical object) so
 *     whitespace-only edits (e.g. reformatter run) don't pollute the
 *     semantic-meaning gate. Either hash mismatch fails the test, but the
 *     error message tells the dev which one diverged.
 *
 *  3. Cross-validates that runtime consumers (CONSTITUTION_PRINCIPLES,
 *     TWELVE_IMMUTABLES_VERBATIM, CONSTITUTIONAL_IMMUTABLES,
 *     CONSTITUTIONAL_SELF_DEFENSE_PROMPT_BLOCK) all derive their values from
 *     the same canonical source. Catches the failure mode where someone
 *     reintroduces a hand-written copy and silently drifts.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  SOVEREIGN_PRINCIPLES,
  CUSTOMER_IMMUTABLES,
  CRITICAL_CUSTOMER_IMMUTABLE_NUMBERS,
  RAW_IMMUTABLES,
} from "../../sovereign-protocol/immutables";
import { CONSTITUTION_PRINCIPLES } from "../../server/services/constitutionChecker";
import {
  TWELVE_IMMUTABLES_VERBATIM,
} from "../../server/services/solene/preCallConstitutionalChecker";
import {
  CONSTITUTIONAL_IMMUTABLES,
  CONSTITUTIONAL_SELF_DEFENSE_PROMPT_BLOCK,
} from "../../server/services/solene/constitutionalGuard";

// ─── FIXTURE HASHES — UPDATE WHEN YOU AMEND immutables.json ────────────────
//
// Procedure for a constitutional amendment:
//   1. Edit sovereign-protocol/immutables.json (the JSON, not a downstream).
//   2. Run: node -e "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('sovereign-protocol/immutables.json')).digest('hex'))"
//      → paste into EXPECTED_BYTE_SHA256 below.
//   3. Run: node -e "console.log(require('node:crypto').createHash('sha256').update(JSON.stringify(require('./sovereign-protocol/immutables.json'))).digest('hex'))"
//      → paste into EXPECTED_STRUCTURAL_SHA256 below.
//   4. Update sovereign-protocol/constitution.md prose if a sovereign
//      principle changed.
//   5. Commit message must reference "constitutional amendment" so Quinn's
//      drift-audit picks it up.
const EXPECTED_BYTE_SHA256 =
  "a80aacb95ae1b6cd4ed4fe308dc36fcc4a86ba2184fea1a31ac48474ce7dc8ae";
const EXPECTED_STRUCTURAL_SHA256 =
  "20eadd844f626a99c605df21ca37d825de74cb518e1011cad62e3080f059c8c2";

// Resolved relative to repo root (which is process.cwd() under vitest run).
const CANONICAL_JSON_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "sovereign-protocol",
  "immutables.json",
);

describe("sovereign-protocol/immutables.json — hash gate", () => {
  it("matches the pinned byte-SHA-256 (any hand-edit must update the fixture)", () => {
    const bytes = readFileSync(CANONICAL_JSON_PATH);
    const actual = createHash("sha256").update(bytes).digest("hex");
    expect(
      actual,
      [
        "",
        "─────────────────────────────────────────────────────────────────",
        "CONSTITUTIONAL DRIFT DETECTED — byte-SHA-256 mismatch.",
        "─────────────────────────────────────────────────────────────────",
        `expected ${EXPECTED_BYTE_SHA256}`,
        `  actual ${actual}`,
        "",
        "If you intentionally amended sovereign-protocol/immutables.json,",
        "update EXPECTED_BYTE_SHA256 + EXPECTED_STRUCTURAL_SHA256 in",
        "tests/unit/sovereign-protocol-immutables.test.ts AND ensure the",
        "commit message references 'constitutional amendment'.",
        "─────────────────────────────────────────────────────────────────",
      ].join("\n"),
    ).toBe(EXPECTED_BYTE_SHA256);
  });

  it("matches the pinned structural-SHA-256 (semantic content lock)", () => {
    const parsed = JSON.parse(readFileSync(CANONICAL_JSON_PATH, "utf8"));
    const stable = JSON.stringify(parsed);
    const actual = createHash("sha256").update(stable).digest("hex");
    expect(
      actual,
      "structural-SHA-256 changed — the semantic content of the immutables list was modified.",
    ).toBe(EXPECTED_STRUCTURAL_SHA256);
  });
});

describe("sovereign-protocol/immutables — canonical shape", () => {
  it("has exactly 10 sovereign principles numbered 1..10", () => {
    expect(SOVEREIGN_PRINCIPLES).toHaveLength(10);
    expect(SOVEREIGN_PRINCIPLES.map((p) => p.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(SOVEREIGN_PRINCIPLES.map((p) => p.name)).toEqual([
      "HONESTY",
      "SAFETY",
      "PRIVACY",
      "TRANSPARENCY",
      "BOUNDARIES",
      "ACCOUNTABILITY",
      "CONSENT",
      "PROPORTIONALITY",
      "SOVEREIGNTY",
      "COORDINATION",
    ]);
  });

  it("has exactly 12 customer immutables numbered 1..12", () => {
    expect(CUSTOMER_IMMUTABLES).toHaveLength(12);
    expect(CUSTOMER_IMMUTABLES.map((i) => i.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("declares #5, #6, #11, #12 as critical-severity", () => {
    expect([...CRITICAL_CUSTOMER_IMMUTABLE_NUMBERS].sort((a, b) => a - b)).toEqual(
      [5, 6, 11, 12],
    );
  });

  it("every customer immutable has both verbatim (text) and short form", () => {
    for (const i of CUSTOMER_IMMUTABLES) {
      expect(i.text.length).toBeGreaterThan(0);
      expect(i.short.length).toBeGreaterThan(0);
    }
  });

  it("RAW_IMMUTABLES is the same object the typed exports derive from", () => {
    expect(RAW_IMMUTABLES.sovereignPrinciples.items.length).toBe(
      SOVEREIGN_PRINCIPLES.length,
    );
    expect(RAW_IMMUTABLES.customerImmutables.items.length).toBe(
      CUSTOMER_IMMUTABLES.length,
    );
  });
});

describe("downstream consumers all derive from the canonical source", () => {
  it("constitutionChecker.CONSTITUTION_PRINCIPLES mirrors SOVEREIGN_PRINCIPLES", () => {
    expect(CONSTITUTION_PRINCIPLES).toHaveLength(SOVEREIGN_PRINCIPLES.length);
    for (let idx = 0; idx < SOVEREIGN_PRINCIPLES.length; idx++) {
      expect(CONSTITUTION_PRINCIPLES[idx].id).toBe(SOVEREIGN_PRINCIPLES[idx].id);
      expect(CONSTITUTION_PRINCIPLES[idx].name).toBe(
        SOVEREIGN_PRINCIPLES[idx].name,
      );
      expect(CONSTITUTION_PRINCIPLES[idx].summary).toBe(
        SOVEREIGN_PRINCIPLES[idx].summary,
      );
    }
  });

  it("preCallConstitutionalChecker.TWELVE_IMMUTABLES_VERBATIM uses the verbatim text field", () => {
    expect(TWELVE_IMMUTABLES_VERBATIM).toHaveLength(CUSTOMER_IMMUTABLES.length);
    for (let idx = 0; idx < CUSTOMER_IMMUTABLES.length; idx++) {
      expect(TWELVE_IMMUTABLES_VERBATIM[idx].number).toBe(
        CUSTOMER_IMMUTABLES[idx].number,
      );
      expect(TWELVE_IMMUTABLES_VERBATIM[idx].text).toBe(
        CUSTOMER_IMMUTABLES[idx].text,
      );
    }
  });

  it("constitutionalGuard.CONSTITUTIONAL_IMMUTABLES uses the short text field", () => {
    expect(CONSTITUTIONAL_IMMUTABLES).toHaveLength(CUSTOMER_IMMUTABLES.length);
    for (let idx = 0; idx < CUSTOMER_IMMUTABLES.length; idx++) {
      expect(CONSTITUTIONAL_IMMUTABLES[idx].number).toBe(
        CUSTOMER_IMMUTABLES[idx].number,
      );
      expect(CONSTITUTIONAL_IMMUTABLES[idx].text).toBe(
        CUSTOMER_IMMUTABLES[idx].short,
      );
    }
  });

  it("CONSTITUTIONAL_SELF_DEFENSE_PROMPT_BLOCK references every customer immutable's short text", () => {
    for (const i of CUSTOMER_IMMUTABLES) {
      expect(CONSTITUTIONAL_SELF_DEFENSE_PROMPT_BLOCK).toContain(i.short);
    }
  });
});
