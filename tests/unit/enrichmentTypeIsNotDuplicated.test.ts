/**
 * One EnrichmentData, imported — not copied and left to drift.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `client/src/pages/properties.tsx` carried its own `interface EnrichmentData`,
 * a strict SUBSET of the exported one in `property-enrichment-widget.tsx`,
 * missing exactly two fields: `completenessScore` and `completenessBreakdown`.
 *
 * Both fields are real. `server/services/propertyEnrichment.ts` declares
 * `completenessScore` on the payload, and the widget renders it. So the page was
 * receiving the data and could not see it, and nine reads cast through `as any`
 * to get at it — casts that existed only to work around the page's own stale
 * copy of a type it did not need to own.
 *
 * ── WHY THIS ONE MATTERS OUT OF PROPORTION TO ITS SIZE ──────────────────────
 * It is the case that makes a ghost-field count hard to read. Nine of the
 * hundred `(x as any).prop` findings were not ghosts at all — the field existed,
 * the data arrived, and the only thing missing was a type declaration. A
 * duplicated type does not stay a duplicate; it drifts, and then generates casts
 * that look exactly like the ones hiding real defects.
 *
 * ── AND THE CAST WAS HIDING SOMETHING ───────────────────────────────────────
 * `completenessScore` is OPTIONAL. The guard read
 * `(enrichmentData as any)?.completenessScore !== undefined`, and a cast cannot
 * narrow — so every use inside the block had to be cast too, and TypeScript
 * never checked that the value being formatted into a CSS width and an
 * `aria-valuenow` was actually present. Removing the casts surfaced two real
 * `possibly undefined` errors immediately.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const WIDGET = "client/src/components/property-enrichment-widget.tsx";
const PAGE = "client/src/pages/properties.tsx";

function interfaceKeys(src: string, marker: string): Set<string> {
  const i = src.indexOf(marker);
  if (i < 0) return new Set();
  const body = src.slice(i, src.indexOf("\n}", i));
  return new Set([...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]));
}

describe("EnrichmentData has one definition", () => {
  it("VACUITY: the canonical type exists and declares the completeness fields", () => {
    // If this ever stops holding, the page's import is pointing at nothing and
    // every assertion below is vacuous.
    const keys = interfaceKeys(read(WIDGET), "export interface EnrichmentData {");
    expect(keys.size, "the exported EnrichmentData was not parsed").toBeGreaterThan(10);
    expect(keys.has("completenessScore")).toBe(true);
    expect(keys.has("completenessBreakdown")).toBe(true);
  });

  it("the page imports it rather than redeclaring it", () => {
    const src = read(PAGE);
    expect(
      src,
      "properties.tsx declares its own EnrichmentData again — the copy drifted last time " +
        "and generated nine casts to work around its own staleness",
    ).not.toMatch(/^interface EnrichmentData \{/m);
    expect(src).toMatch(/import type \{[^}]*EnrichmentData[^}]*\} from ["']@\/components\/property-enrichment-widget["']/);
  });

  it("the page no longer casts to reach the completeness fields", () => {
    const code = stripComments(read(PAGE));
    expect(
      code,
      "a cast is back on a field the imported type already declares",
    ).not.toMatch(/as any\)\??\.completeness/);
  });

  it("the optional score is narrowed once, not cast at each use", () => {
    // A cast cannot narrow. The guard must bind a local so TypeScript actually
    // checks the value that reaches a CSS width and an aria-valuenow.
    const code = stripComments(read(PAGE));
    expect(code).toMatch(/const completenessScore = enrichmentData\?\.completenessScore;/);
    expect(code).toMatch(/completenessScore !== undefined &&/);
  });

  it("the server still declares the field the client expects", () => {
    // The three ends of this contract are the service type, the shared client
    // type, and the page. If the service drops it, the other two are lying.
    expect(
      read("server/services/propertyEnrichment.ts"),
      "propertyEnrichment no longer declares completenessScore — the client renders a field " +
        "the server does not produce",
    ).toMatch(/completenessScore\??:/);
  });
});
