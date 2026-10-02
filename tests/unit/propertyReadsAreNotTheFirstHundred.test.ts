/**
 * DEFECT-0168 — a property picker or lookup is not "the newest hundred".
 *
 * useProperties() is page 1 of 100. Pickers built on it could not offer the
 * 101st-newest property; lookups built on it (a deal's property, a note's,
 * a listing's) came back missing — deal detail then negotiated against an
 * invented 50,000 asking price and zeroed the calculator; the deals CSV
 * export wrote blank county/state. Worse neighbours: the AVM and
 * land-credit pickers read `.properties` off an array (always empty), four
 * rental panels asked for pageSize=200 (a 400 — always empty), and the
 * subdivision editor asked for `?id=` (ignored) and never found its parcel.
 *
 * Now: the list route searches (`q`), looks up (`ids`) and filters
 * (`excludeStatus`) on the server, pickers use PropertyCombobox, lookups use
 * useProperty / usePropertiesByIds — and a register below holds every
 * remaining whole-list read, so a new picker on the newest page fails here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({
  wheres: [] as unknown[],
  paginated: vi.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 25, totalPages: 1 })),
}));

vi.mock("../../server/db", () => {
  const select = () => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = (w: unknown) => {
      h.wheres.push(w);
      return Object.assign(Promise.resolve([{ count: 0 }]), q);
    };
    q.orderBy = () => q;
    q.limit = () => q;
    q.offset = async () => [];
    return q;
  };
  return { db: { select } };
});

import { propertyRepo } from "../../server/storage/propertyRepo";
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const render = (w: unknown) => new PgDialect().sqlToQuery(w as SQL);
const OPTS = { page: 1, pageSize: 25, sortBy: "createdAt", sortOrder: "desc" as const };

beforeEach(() => {
  h.wheres.length = 0;
});

describe("DEFECT-0168 — the list route searches, looks up and filters on the server", () => {
  it("q matches APN / county / state / address / city / zip, org-scoped, LIKE-escaped", async () => {
    await propertyRepo.getPropertiesPaginated.call({} as never, 7, OPTS, { q: "50%_off" });
    const w = render(h.wheres[0]);
    expect(w.sql).toMatch(/"organization_id" = \$1/);
    for (const col of ["apn", "county", "state", "address", "city", "zip"]) expect(w.sql).toContain(`"${col}" ilike`);
    expect(w.params).toContain("%50\\%\\_off%");
  });

  it("ids and excludeStatus narrow the same query", async () => {
    await propertyRepo.getPropertiesPaginated.call({} as never, 7, OPTS, { ids: [3, 9], excludeStatus: "sold" });
    const w = render(h.wheres[0]);
    expect(w.sql).toMatch(/"id" in \(\$\d+, \$\d+\)/);
    expect(w.sql).toMatch(/"status" <> \$\d+/);
    expect(w.params).toEqual(expect.arrayContaining([3, 9, "sold"]));
  });

  it("an empty ids list matches nothing (never everything)", async () => {
    await propertyRepo.getPropertiesPaginated.call({} as never, 7, OPTS, { ids: [] });
    expect(render(h.wheres[0]).sql).toContain("false");
  });
});

describe("DEFECT-0168 — the route parses ids strictly", () => {
  vi.doMock("../../server/storage", () => ({ storage: { getPropertiesPaginated: h.paginated } }));

  it("rejects a malformed id list and passes a clean one deduplicated", async () => {
    vi.resetModules();
    vi.doMock("../../server/auth", () => ({ isAuthenticated: (_r: unknown, _s: unknown, n: () => void) => n() }));
    vi.doMock("../../server/middleware/getOrCreateOrg", () => ({
      getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
        req.organization = { id: 7 };
        n();
      },
    }));
    vi.doMock("../../server/storage", () => ({ storage: { getPropertiesPaginated: h.paginated }, db: {} }));
    const { registerPropertyRoutes } = await import("../../server/routes-properties");
    const app = express();
    app.use(express.json());
    registerPropertyRoutes(app);

    expect((await request(app).get("/api/properties?ids=1,abc")).status).toBe(400);
    const ok = await request(app).get("/api/properties?ids=3,1,3&q=smith&excludeStatus=sold");
    expect(ok.status).toBe(200);
    expect(h.paginated).toHaveBeenLastCalledWith(7, expect.anything(), { q: "smith", ids: [3, 1], excludeStatus: "sold" });
    // The ceiling the rental panels ran into: >100 is a 400, not a bigger page.
    expect((await request(app).get("/api/properties?pageSize=200")).status).toBe(400);
  });
});

// ── Population: every client read of the whole-list page ────────────────────
const ROOT = resolve(__dirname, "../..");
const WHOLE_LIST_READERS: Record<string, string> = {
  "client/src/hooks/use-properties.ts": "defines useProperties",
  "client/src/pages/today.tsx": "a has-any-data boolean only",
  "client/src/components/command-palette.tsx": "instant local matches while the server search runs",
  "client/src/components/dashboard/type-specific-widgets.tsx": "server totals; page-derived counts are labelled partial",
  "client/src/hooks/useOfflineSync.ts": "the offline 'recent items' cache",
  "client/src/pages/maps.tsx": "map pins, labelled 'newest N of M' (DEFECT-0158)",
  "client/src/pages/syndication.tsx": "server-searched (q), labelled when partial",
  "client/src/components/mobile/QuickAddSheet.tsx": "reads `total` only (does the org have any property)",
  "client/src/pages/properties.tsx": "the paginated inventory page itself",
};

// Every READ shape a whole-list property read can take. The first version
// matched only `useProperties(` and a literal with `?`, and missed three
// live pickers: `fetchJsonArray<Property>("/api/properties")` (a generic
// between name and paren, and no query string), a bare `fetch(...)`, and
// `contractQueryFn(listPropertiesContract)`.
const LIST_URL = String.raw`["'\x60]\/api\/properties(?:\?(?![^"'\x60]*\b(?:ids|sellerIds)=)[^"'\x60]*)?["'\x60]`;
const READ_SHAPES = new RegExp(
  [
    String.raw`\buseProperties\(`,
    String.raw`\busePropertiesPaginated\(`,
    String.raw`contractQueryFn\(\s*listPropertiesContract`,
    String.raw`\b(?:fetch|fetchJsonArray|strictFetch|fetchJSON)(?:<[^<>()]*>)?\(\s*` + LIST_URL,
    String.raw`apiRequest\(\s*["']GET["']\s*,\s*` + LIST_URL,
    String.raw`\burl:\s*` + LIST_URL,
    String.raw`queryKey:\s*\[\s*["'\x60]\/api\/properties\?`,
  ].join("|"),
);

describe("DEFECT-0168 — no new picker or lookup on the newest page", () => {
  const files = execSync("git ls-files 'client/src/*.ts' 'client/src/*.tsx'", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const readers = files.filter((f) => {
    const src = stripComments(readFileSync(resolve(ROOT, f), "utf8"));
    return READ_SHAPES.test(src);
  });

  it("the scan read the client tree (population floor)", () => {
    expect(files.length).toBeGreaterThan(700);
  });

  // Canaries: each read shape, planted, is caught.
  for (const planted of [
    `const a = useQuery({ queryFn: () => fetchJsonArray<Property>("/api/properties") });`,
    `await fetch('/api/properties', { credentials: 'include' });`,
    `useQuery({ queryFn: contractQueryFn(listPropertiesContract) });`,
    `await apiRequest("GET", "/api/properties?pageSize=100");`,
    `const { data } = usePropertiesPaginated({ page: 1, pageSize: 25 });`,
  ]) {
    it(`catches: ${planted.slice(0, 60)}`, () => {
      expect(READ_SHAPES.test(planted)).toBe(true);
    });
  }
  it("does not flag a by-id lookup", () => {
    expect(READ_SHAPES.test("fetch(`/api/properties?pageSize=100&ids=${chunk}`)")).toBe(false);
  });

  for (const f of Object.keys(WHOLE_LIST_READERS)) {
    it(`${f} is still a whole-list reader (register vacuity)`, () => {
      expect(readers).toContain(f);
    });
  }

  it("every whole-list property read is registered with a reason", () => {
    expect(readers.filter((f) => !(f in WHOLE_LIST_READERS))).toEqual([]);
  });

  it("no client read asks these list routes for more than the server's 100 rows, or for ignored params", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = stripComments(readFileSync(resolve(ROOT, f), "utf8"));
      for (const m of src.matchAll(/\/api\/(?:leads|properties|deals)\?[^"'`\s]*/g)) {
        const qs = m[0];
        const size = qs.match(/pageSize=(\d+)/);
        if ((size && Number(size[1]) > 100) || /[?&](?:limit|id)=/.test(qs)) bad.push(`${f}: ${qs}`);
      }
    }
    // feature-hints reads only `total` from `?limit=0` — the route returns it.
    expect(bad.filter((b) => !b.startsWith("client/src/components/feature-hints.tsx"))).toEqual([]);
  });
});

describe("DEFECT-0168 — PropertyCombobox is a real form control", () => {
  it("forwards the FormControl Slot's id and aria props to its trigger", () => {
    const src = stripComments(readFileSync(resolve(ROOT, "client/src/components/property-combobox.tsx"), "utf8"));
    const trigger = src.slice(src.indexOf("<PopoverTrigger"), src.indexOf("</PopoverTrigger>"));
    expect(trigger).toMatch(/\bid=\{id\}/);
    expect(trigger).toMatch(/aria-describedby=\{rest\["aria-describedby"\]\}/);
    expect(trigger).toMatch(/aria-invalid=\{rest\["aria-invalid"\]\}/);
  });
});
