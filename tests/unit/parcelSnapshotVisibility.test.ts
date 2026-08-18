/**
 * A parcel snapshot is visible to the org that owns it, or to everyone.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `parcel_snapshots.organization_id` is NULLABLE, and the column's own comment
 * says null means "global/shared cache". So a correct read is "MY org's row OR
 * the shared one" — never "whatever row matches this APN".
 *
 * `dueDiligence.ts` wrote that predicate by hand and got it right. Two other
 * readers did not:
 *
 *   - `propertyReportPdf.ts` — a CUSTOMER-FACING PDF — matched on
 *     `apn + state + county` and took the most recent row, whoever owned it.
 *   - `ltvMonitor.ts` — reads `assessedValue` to compute a loan's LTV — did the
 *     same.
 *
 * No writer sets a non-null `organizationId` today, so nothing leaks yet. That
 * is not the reassurance it sounds like: `dueDiligence`'s read is the codebase
 * stating that tenant-owned rows are intended, and the first one written would
 * have appeared on another org's property report and in another org's LTV,
 * silently, with no gate objecting.
 *
 * ── WHY NO GATE OBJECTED ────────────────────────────────────────────────────
 * `check-org-scoped-fetch` treats a function as org-scoped when the string
 * `organizationId` appears ANYWHERE in its body (its own step 3). Both readers
 * mention it for an unrelated query — `propertyReportPdf` scopes its
 * `organizations` lookup — so the marker was present and the unscoped parcel
 * read went unseen. Its rule 2 catches "has an org, resolves by PRIMARY KEY
 * anyway"; these resolve by a business key, which that shape does not cover.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * The same lesson as the operating predicate (ledger entry 7): a rule that
 * exists in one place and is hand-copied into some of the others goes stale in
 * exactly the sites that did not copy it.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parcelSnapshotVisibleTo } from "../../server/storage/gisRepo";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");
const codeOf = (p: string): string =>
  read(p)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

/** Flatten a drizzle predicate into what the database would be asked. */
function shape(node: unknown): { columns: string[]; params: unknown[]; sql: string } {
  const columns: string[] = [];
  const params: unknown[] = [];
  const text: string[] = [];
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n.name === "string" && n.table !== undefined) { columns.push(n.name); return; }
    if ("encoder" in n && "value" in n) { params.push(n.value); return; }
    if (Array.isArray(n.value) && n.value.every((v: unknown) => typeof v === "string")) {
      text.push(...n.value);
      return;
    }
    if (Array.isArray(n.queryChunks)) { n.queryChunks.forEach(walk); return; }
  };
  walk(node);
  return { columns, params, sql: text.join("") };
}

describe("the predicate admits the org's own rows and the shared cache", () => {
  const p = shape(parcelSnapshotVisibleTo(42));

  it("binds organization_id to the caller's org", () => {
    expect(p.columns).toContain("organization_id");
    expect(p.params).toContain(42);
  });

  it("ALSO admits the shared cache — a null owner is everyone's", () => {
    // Without this the predicate would hide every row the ETL writes, which is
    // all of them today: the fix would silently blank the property report.
    expect(p.sql.toLowerCase(), "the global/shared cache is excluded").toContain("is null");
  });

  it("the shape reader is not vacuous", () => {
    // Guard first: if `shape()` returned nothing, both assertions above would
    // fail loudly rather than pass — but the `sql` check could pass on an empty
    // string only if `toContain` were given "", so pin the columns too.
    expect(p.columns.length).toBeGreaterThan(0);
    expect(p.params.length).toBeGreaterThan(0);
  });
});

describe("every reader that answers FOR an org uses it", () => {
  /**
   * Sites that return a parcel fact to a specific organization. Each must scope.
   */
  const ACTING_READERS = [
    "server/services/propertyReportPdf.ts",
    "server/services/ltvMonitor.ts",
    "server/services/dueDiligence.ts",
  ];

  /**
   * Sites that COUNT across the platform rather than answering for one org.
   * Listed rather than merely omitted, so converting one is a decision somebody
   * makes on purpose — the same split the operating predicate draws.
   */
  const COUNTING_READERS = [
    // A platform coverage rollup: which counties have any data at all.
    "server/services/coverageLedger.ts",
    // The regrid ETL's upsert dedupe, keyed on (source, sourceId). It WRITES
    // the shared cache; scoping it would fork one global row per org.
    "server/services/etlHandlers.ts",
  ];

  for (const f of ACTING_READERS) {
    it(`${f} scopes its parcel snapshot read`, () => {
      expect(codeOf(f), `${f} reads parcel snapshots without a visibility predicate`)
        .toContain("parcelSnapshotVisibleTo(");
    });
  }

  it("NO acting reader still hand-writes the predicate", () => {
    // The semantic check. What matters is that the raw comparison is gone from
    // the files that answer for an org, however it is spelled — a fourth
    // spelling is how the third site came to be missing it.
    for (const f of ACTING_READERS) {
      expect(
        codeOf(f),
        `${f} re-typed the organizationId comparison instead of using the predicate`,
      ).not.toMatch(/eq\(\s*parcelSnapshots\.organizationId/);
    }
  });

  it("the counting readers still exist and deliberately do NOT scope", () => {
    // Vacuity guard with teeth: if the ETL were "fixed" to scope, it would fork
    // the shared cache per org, and no other assertion here would notice.
    for (const f of COUNTING_READERS) {
      expect(fs.existsSync(path.join(ROOT, f)), `${f} moved; re-adjudicate it`).toBe(true);
      expect(
        codeOf(f),
        `${f} is a platform-wide reader but now scopes by org. The shared cache ` +
          "is shared on purpose; scoping the ETL would write one row per org.",
      ).not.toContain("parcelSnapshotVisibleTo(");
    }
  });
});
