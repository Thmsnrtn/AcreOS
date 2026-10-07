/**
 * Pax's product facts name real places and real rules.
 *
 *  - ADOPTION: every route that ENFORCES a limit Pax quotes reads the shared
 *    constant (no `= 500` / `max: 5` literal left at a charge or cap site), and
 *    the BYO-key route asks the same tier rule Pax quotes. Without this the
 *    constant would be canonical in name only.
 *  - PLACES: every path Pax cites is a real client route, and every customer
 *    door Pax names is a label in the sidebar's NAV_MODULES.
 *
 * Mutations recorded (reverted after each red run):
 *   - routes-leads `MAX_CSV_IMPORT_ROWS = 500` restored: red.
 *   - PLACES.byok.path → "/settings/keys": red ("every cited path is a route").
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";
import { PLACES, getPaxProductFacts } from "../../server/services/paxProductFacts";
import { CSV_IMPORT_MAX_ROWS_PER_FILE, BULK_EXPORT_DAILY_CAP } from "@shared/product-limits";

const ROOT = path.resolve(__dirname, "../..");
const code = (rel: string) => stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8")) as string;

describe("the routes that enforce a limit read the shared constant", () => {
  it.each(["server/routes-leads.ts", "server/routes-properties.ts", "server/routes-import-export.ts"])(
    "%s: the CSV row cap is CSV_IMPORT_MAX_ROWS_PER_FILE",
    (rel) => {
      const src = code(rel);
      expect(src).toMatch(/const MAX_CSV_IMPORT_ROWS = CSV_IMPORT_MAX_ROWS_PER_FILE;/);
      expect(src).not.toMatch(/MAX_CSV_IMPORT_ROWS\s*=\s*\d/);
      expect(src, "the constant is declared but no check reads it").toMatch(/\.length > MAX_CSV_IMPORT_ROWS/);
    },
  );

  it.each(["server/middleware/identityRateLimiters.ts", "server/routes-import-export.ts"])(
    "%s: the bulk-export limiter's max is BULK_EXPORT_DAILY_CAP",
    (rel) => {
      const src = code(rel);
      expect(src).toMatch(/max: BULK_EXPORT_DAILY_CAP,/);
      expect(src).not.toMatch(/windowMs: 24 \* 60 \* 60 \* 1000,\s*max: \d/);
    },
  );

  it("the job-backed import cap is the shared constant", () => {
    expect(code("server/services/migrationJobs.ts")).toMatch(/export const MAX_IMPORT_ROWS = DATA_IMPORT_JOB_MAX_ROWS;/);
  });

  it("the BYO-key route asks the shared tier rule", () => {
    expect(code("server/routes-byok.ts")).toMatch(/if \(byokTierAllows\(tier, channel\)\) return true;/);
  });

  it("the real facts carry the real values", async () => {
    const f: any = await getPaxProductFacts("all");
    expect(f.imports.rowsPerFile).toBe(CSV_IMPORT_MAX_ROWS_PER_FILE);
    expect(f.exports.perPersonPerDay).toBe(BULK_EXPORT_DAILY_CAP);
    expect(f.sending.textsPlanRequirement).toEqual(["pro", "scale"]);
  });
});

describe("every place Pax names exists", () => {
  const app = code("client/src/App.tsx");
  const routes = new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]));
  const sidebar = code("client/src/components/layout-sidebar.tsx");

  it("vacuity: the client route table parsed", () => {
    expect(routes.size).toBeGreaterThan(100);
  });

  it("every cited path is a route", async () => {
    const nav: any = ((await getPaxProductFacts("navigation")) as any).navigation;
    const CUSTOMER_DOORS: Array<{ door: string; path: string }> = nav.doors;
    const TOP_BAR: Array<{ path: string }> = nav.topBar;
    const paths = [
      ...Object.values(PLACES).map((p) => p.path),
      ...CUSTOMER_DOORS.map((d) => d.path),
      ...TOP_BAR.map((t) => t.path),
    ];
    expect(paths.length).toBeGreaterThan(10);
    for (const p of paths) expect(routes.has(p), `${p} is not a client route`).toBe(true);
  });

  it("the five doors are exactly the sidebar's door labels", async () => {
    const CUSTOMER_DOORS: Array<{ door: string }> = ((await getPaxProductFacts("navigation")) as any).navigation.doors;
    expect(CUSTOMER_DOORS.map((d) => d.door)).toEqual(["Today", "Map", "Deals", "Finance", "Pax"]);
    for (const d of CUSTOMER_DOORS) {
      expect(sidebar, `door "${d.door}" is not a NAV_MODULES label`).toMatch(new RegExp(`label: "${d.door}"`));
    }
  });
});
