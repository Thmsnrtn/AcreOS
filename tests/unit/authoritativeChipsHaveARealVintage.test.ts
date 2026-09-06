/**
 * "County assessor · as of Sep 6, 2026" — where Sep 6 is when WE called an API.
 *
 * `DataProvenanceChip` renders `source · as of <date>` beside a value, with a
 * dot whose colour encodes the classification. On the property Overview the
 * Assessed Value and Annual Taxes chips were `classification="authoritative"`
 * and took their `sourceAsOf` from `parcelData.lastUpdated`, which
 * `server/services/parcel.ts` sets to `new Date()` at fetch time. So the page
 * asserted the county's record was current as of today. The assessment roll
 * behind the number is typically a prior tax year, and a deed recorded last week
 * does not appear at all — and this is a screen people buy land from.
 *
 * The chip is graceful (`if (asOf) parts.push(...)`), so omitting the clause
 * keeps the source and the dot and drops only the part we cannot support.
 * Refuse, don't fabricate.
 *
 * ── THE PREMISE IS ASSERTED, NOT ASSUMED ──────────────────────────────────
 * The rule below names three AcreOS-side clocks. That list is only meaningful
 * while they really are AcreOS-side, so the first test proves it from the
 * source: if `parcel.ts` ever starts carrying the county's own recording date,
 * this gate fails and whoever made that true gets to delete the entry — rather
 * than the ban quietly outliving its reason.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = process.cwd();

/**
 * Timestamps that record when ACREOS touched something, not when the upstream
 * record was true. None of them can support an "as of" on an authoritative claim.
 */
const ACREOS_CLOCKS: ReadonlyArray<{ field: string; why: string }> = [
  { field: "lastUpdated", why: "parcel.ts sets it to new Date() at fetch time" },
  { field: "enrichedAt", why: "when AcreOS ran enrichment, not when the county recorded" },
  { field: "updatedAt", why: "when our own row last changed" },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (["node_modules", "__snapshots__"].includes(e)) continue;
    const abs = path.join(dir, e);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (/\.tsx$/.test(e) && !/\.test\.tsx$/.test(e)) out.push(abs);
  }
  return out;
}

const clientFiles = walk(path.join(ROOT, "client", "src"));
const chipUsers = clientFiles.filter((abs) =>
  /<DataProvenanceChip[\s/>]/.test(readFileSync(abs, "utf8")),
);

type Offence = { file: string; line: number; field: string; expr: string };

function authoritativeChipsWithAnAcreosClock(src: string, file: string): Offence[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offences: Offence[] = [];

  const attrText = (el: ts.JsxOpeningLikeElement, name: string): string | null => {
    for (const a of el.attributes.properties) {
      if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== name) continue;
      return a.initializer ? a.initializer.getText(sf) : "";
    }
    return null;
  };

  const visit = (n: ts.Node) => {
    const el = ts.isJsxSelfClosingElement(n)
      ? n
      : ts.isJsxElement(n)
        ? n.openingElement
        : null;
    if (el && el.tagName.getText(sf) === "DataProvenanceChip") {
      const classification = attrText(el, "classification") ?? "";
      const asOf = attrText(el, "sourceAsOf");
      // Only authoritative chips make a claim about an upstream record's vintage.
      if (asOf && /authoritative/.test(classification)) {
        for (const clock of ACREOS_CLOCKS) {
          if (new RegExp(`\\b${clock.field}\\b`).test(asOf)) {
            offences.push({
              file,
              line: sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1,
              field: clock.field,
              expr: asOf.replace(/\s+/g, " ").slice(0, 100),
            });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return offences;
}

describe("an authoritative provenance chip never dates itself by our own clock", () => {
  it("the premise holds: parcel.ts's lastUpdated really is a fetch time", () => {
    // Comments stripped: this file's own header quotes `new Date()` beside
    // `lastUpdated`, and so does parcel.ts's, and a scan cannot tell the record
    // of a decision from the decision.
    const parcel = stripComments(
      readFileSync(path.join(ROOT, "server", "services", "parcel.ts"), "utf8"),
    );
    const fetchTimeAssignments = parcel.match(/lastUpdated:\s*new Date\(\)/g) ?? [];
    expect(
      fetchTimeAssignments.length,
      "parcel.ts no longer stamps lastUpdated with the wall clock — if it now " +
        "carries the county's own date, this gate's premise is gone and the " +
        "`lastUpdated` entry in ACREOS_CLOCKS should be removed rather than kept",
    ).toBeGreaterThan(0);
  });

  it("the population is real", () => {
    expect(clientFiles.length).toBeGreaterThan(300);
    expect(chipUsers.length, "nothing renders DataProvenanceChip — this is vacuous")
      .toBeGreaterThan(0);
    expect(chipUsers.map((f) => path.relative(ROOT, f)))
      .toContain("client/src/pages/properties.tsx");
  });

  it("no authoritative chip takes its 'as of' from an AcreOS timestamp", () => {
    const offences: string[] = [];
    for (const abs of chipUsers) {
      for (const o of authoritativeChipsWithAnAcreosClock(readFileSync(abs, "utf8"), abs)) {
        const why = ACREOS_CLOCKS.find((c) => c.field === o.field)!.why;
        offences.push(`${path.relative(ROOT, abs)}:${o.line}  ${o.field} (${why})  ${o.expr}`);
      }
    }
    expect(
      offences,
      "these chips claim an upstream record is current as of a moment that only " +
        "describes AcreOS. Drop `sourceAsOf` — the chip still renders the source " +
        "and the dot, and omits the clause we cannot support.",
    ).toEqual([]);
  });

  it("the detector fires on the shape that was live, and not on the honest one", () => {
    const live = [
      "const x = (",
      '  <DataProvenanceChip source="County assessor" sourceAsOf={parcelData?.lastUpdated}',
      '    classification="authoritative" />',
      ");",
    ].join("\n");
    expect(authoritativeChipsWithAnAcreosClock(live, "fixture.tsx")).toHaveLength(1);

    // A real as-of carried by the upstream record.
    const honest =
      '<DataProvenanceChip source="County records" sourceAsOf={distress.taxPayoffAsOf} classification="authoritative" />';
    expect(authoritativeChipsWithAnAcreosClock(honest, "fixture.tsx")).toEqual([]);

    // A NON-authoritative chip may legitimately date itself by our clock —
    // "AcreOS estimate · as of <when we estimated>" is exactly right.
    const estimate =
      '<DataProvenanceChip source="AcreOS estimate" sourceAsOf={p.enrichedAt} classification="estimate" />';
    expect(authoritativeChipsWithAnAcreosClock(estimate, "fixture.tsx")).toEqual([]);
  });
});
