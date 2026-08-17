/**
 * The residential-comps hold, proved to BITE.
 *
 * CLAUDE.md's DO-NOT-DO list says "No residential-comps data plane before its
 * revenue trigger", and shared/governance/constitution.ts labels
 * `data.no-residential-comps-pre-trigger` as enforcement kind "code-invariant".
 * Until scripts/check-residential-comps-hold.mjs existed, that label was wrong:
 * the refs it pointed at (shared/business-types.ts,
 * tests/unit/verticalPackPurchasable.test.ts) govern whether a residential
 * VERTICAL PACK is purchasable, which is an adjacent question. Nothing in the
 * repo could see a residential comps PLANE being built.
 *
 * The gate now passes at zero — which is exactly the condition under which a
 * check is most likely to be quietly broken and never noticed, because a check
 * that only ever passes is indistinguishable from a check that cannot fail. So
 * this file drives the REAL script against synthetic repos and asserts it exits
 * non-zero for each plane signature, zero for the land work it must never
 * obstruct, and non-zero when the scan itself goes vacuous.
 *
 * The two most important tests are:
 *
 *   1. "an innocuously-named comps corpus is still caught" — the shape net. A
 *      name-only rule keys on what an author CHOSE to call the thing, so the
 *      same violation renamed walks straight past. That is the bypass class this
 *      gate was written to close.
 *   2. "a LAND comps corpus passes" — this is a land platform and land comps are
 *      the product. A gate that obstructed them would be wrong, and would be
 *      re-baselined away within a week.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "scripts/check-residential-comps-hold.mjs");

/** The three files the gate uses to tell a real repo from a fixture. */
const ANCHORS = [
  "server/services/residentialComps.ts",
  "server/services/providers/attom-provider.ts",
  "server/jobs/countyAssessorIngest.ts",
];

let tmpRoot: string;

interface GateResult {
  code: number;
  output: string;
}

/** Build a throwaway repo out of `files` and run the REAL gate against it. */
function runGateOn(files: Record<string, string>, extra?: (dir: string) => void): GateResult {
  const dir = fs.mkdtempSync(path.join(tmpRoot, "repo-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  extra?.(dir);
  // The script resolves REPO_ROOT as the parent of its own directory, so it must
  // live in <dir>/scripts/ for <dir> to be treated as the repo.
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, "scripts", path.basename(SCRIPT)));

  try {
    const stdout = execFileSync(process.execPath, [path.join(dir, "scripts", path.basename(SCRIPT))], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** A minimal fixture repo: no anchor files, so floors/canaries/seam are inert. */
function fixture(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "package.json": JSON.stringify({ name: "fixture", dependencies: { express: "^4" } }, null, 2),
    "shared/schema.ts":
      'import { pgTable, varchar, integer } from "drizzle-orm/pg-core";\n' +
      'export const leads = pgTable("leads", { id: varchar("id"), organizationId: integer("organization_id") });\n',
    ...extra,
  };
}

/**
 * Files the gate needs present for a repo to read as REAL: the three anchors,
 * plus shared/schema.ts, whose `properties` table is the one registered
 * exception — and a registered exception that stops matching is a stale entry,
 * which fails. That coupling is deliberate: the exception doubles as the canary
 * proving the R2 shape net still matches something real.
 */
const REAL_SHAPED_FILES = [...ANCHORS, "shared/schema.ts"];

/**
 * A fixture that presents as the REAL repo: the files above copied verbatim (so
 * the canaries and the seam rule run against real code) plus enough filler to
 * clear the vacuity floors. This is the only way to exercise the seam rule, the
 * canaries and the floors, because all three are deliberately inert outside a
 * full anchor set.
 */
function runRealShaped(extra: Record<string, string> = {}, opts: { fillerTables?: number } = {}): GateResult {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "fixture", dependencies: { express: "^4" } }, null, 2),
    ...extra,
  };
  for (const rel of REAL_SHAPED_FILES) {
    if (files[rel] === undefined) files[rel] = fs.readFileSync(path.join(ROOT, rel), "utf8");
  }
  const fillerTables = opts.fillerTables ?? 400;
  return runGateOn(files, (dir) => {
    // The floors are real numbers, so the fixture has to be a real size for them
    // to be exercised rather than dodged.
    if (fillerTables > 0) {
      const lines = ['import { pgTable, varchar, integer } from "drizzle-orm/pg-core";'];
      for (let i = 0; i < fillerTables; i++) {
        lines.push(
          `export const t${i} = pgTable("filler_table_${i}", { id: varchar("id"), organizationId: integer("organization_id") });`,
        );
      }
      const filler = path.join(dir, "shared/generated");
      fs.mkdirSync(filler, { recursive: true });
      fs.writeFileSync(path.join(filler, "tables.ts"), lines.join("\n"));
    }
    const bulk = path.join(dir, "server/generated");
    fs.mkdirSync(bulk, { recursive: true });
    for (let i = 0; i < 850; i++) {
      fs.writeFileSync(path.join(bulk, `mod${i}.ts`), `export const v${i} = ${i};\n`);
    }
  });
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "residential-comps-hold-"));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("the gate passes on the real repo", () => {
  it("exits 0 at HEAD, in real-repo mode", () => {
    const stdout = execFileSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd: ROOT });
    expect(stdout).toContain("PASS");
    expect(stdout).toContain("scan mode: real");
    // Preventative gate: exactly one signature, and it is the registered one.
    expect(stdout).toContain("unregistered: 0");
    expect(stdout).toContain("stale: 0");
  });

  it("--measure reports the counts without failing", () => {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--measure"], { encoding: "utf8", cwd: ROOT });
    // The rejected predicates stay printed so every narrowing stays falsifiable:
    // anyone can re-derive why the looser form was not adopted.
    expect(stdout).toContain("rejected");
    expect(stdout).toContain("adopted");
  });

  it("still routes residential comps through the registry seam", () => {
    // The gate's R4 is only meaningful if the seam it pins is the seam that
    // exists. Assert the shape here too, so a reader of this test sees the
    // invariant stated rather than only enforced.
    const seam = fs.readFileSync(path.join(ROOT, "server/services/residentialComps.ts"), "utf8");
    expect(seam).toMatch(/providerRegistry\s*\.\s*lookup\s*\(/);
    expect(seam).toContain("allowProviders");
    expect(seam).not.toMatch(/process\.env\./);
    expect(seam).not.toMatch(/\bfetch\s*\(/);
  });
});

describe("plane signature 1 — a residential vendor request outside the registry", () => {
  it("catches proptype flipped from LAND to a residential class", () => {
    // This is the documented bypass: server/jobs/countyAssessorIngest.ts already
    // reads ATTOM_API_KEY off process.env and bulk-writes comps for LAND, so
    // swapping one string converts it into a residential plane with no new file.
    const res = runGateOn(
      fixture({
        "server/jobs/ingest.ts":
          'const url = new URL("https://api.gateway.attomdata.com/propertyapi/v1.0.0/saleshistory/detail");\n' +
          'url.searchParams.set("proptype", "SFR");\n' +
          "const r = await fetch(url.toString());\n",
      }),
    );
    expect(res.code).toBe(1);
    expect(res.output).toContain("residential-vendor-request");
    expect(res.output).toContain("server/jobs/ingest.ts");
  });

  it("catches the URL-query form and the params-object form too", () => {
    for (const body of [
      'const r = await fetch(`https://vendor.example/api?radius=5&propertytype=CONDOMINIUM`);\n',
      'const params = { propertyType: "MULTI-FAMILY" };\nconst r = await fetch("https://vendor.example/api", { body: JSON.stringify(params) });\n',
    ]) {
      const res = runGateOn(fixture({ "server/jobs/ingest.ts": body }));
      expect(res.code, body).toBe(1);
      expect(res.output).toContain("residential-vendor-request");
    }
  });

  it("does NOT fire on a LAND request", () => {
    const res = runGateOn(
      fixture({
        "server/jobs/ingest.ts":
          'const url = new URL("https://api.gateway.attomdata.com/propertyapi/v1.0.0/saleshistory/detail");\n' +
          'url.searchParams.set("proptype", "LAND");\n' +
          "const r = await fetch(url.toString());\n",
      }),
    );
    expect(res.code).toBe(0);
  });

  it("does NOT fire on zoning classification or intent parsing", () => {
    // Both measured as false positives of the looser predicate. A spaced
    // assignment is how this repo classifies zoning strings and parses founder
    // intent — neither is a vendor request.
    const res = runGateOn(
      fixture({
        "server/services/classify.ts":
          "export async function f(z: string, lower: string, goal: any) {\n" +
          "  let propType = 'Other';\n" +
          "  if (z.includes('res') || z.includes('residential')) propType = 'Residential';\n" +
          '  if (/\\b(residential)\\b/i.test(lower)) goal.filters.propertyType = "residential";\n' +
          '  await fetch("https://example.com");\n' +
          "  return propType;\n" +
          "}\n",
      }),
    );
    expect(res.code).toBe(0);
  });
});

describe("plane signature 2 — a residential comps corpus in the database", () => {
  it("catches an innocuously-named comps corpus by SHAPE", () => {
    // The point of the whole exercise: nothing in this table's NAME says
    // residential, or comps, or MLS. Its columns do.
    const res = runGateOn(
      fixture({
        "shared/schema/market.ts":
          'import { pgTable, varchar, integer, numeric, timestamp } from "drizzle-orm/pg-core";\n' +
          'export const rows = pgTable("market_sale_records", {\n' +
          '  id: varchar("id"),\n' +
          '  bedrooms: integer("bedrooms"),\n' +
          '  bathrooms: numeric("bathrooms"),\n' +
          '  livingSqft: integer("living_sqft"),\n' +
          '  salePrice: integer("sale_price"),\n' +
          '  saleDate: timestamp("sale_date"),\n' +
          "});\n",
      }),
    );
    expect(res.code).toBe(1);
    expect(res.output).toContain("residential-comps-table");
    expect(res.output).toContain("market_sale_records");
    expect(res.output).toContain("residential structure columns");
  });

  it("catches a thin feed table by NAME, with no structure columns at all", () => {
    const res = runGateOn(
      fixture({
        "shared/schema/feed.ts":
          'import { pgTable, varchar, jsonb } from "drizzle-orm/pg-core";\n' +
          'export const rows = pgTable("mls_feed_rows", { id: varchar("id"), payload: jsonb("payload") });\n',
      }),
    );
    expect(res.code).toBe(1);
    expect(res.output).toContain("mls_feed_rows");
  });

  it("catches a table added only to the migrator, with no pgTable anywhere", () => {
    // Schema arrives through raw DDL at least as often as through drizzle; a
    // pgTable-only scan would miss this entirely.
    const res = runGateOn(fixture(), (dir) => {
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "scripts/migrate.mjs"),
        'const stmts = [`CREATE TABLE IF NOT EXISTS "residential_comp_sales" (id text primary key)`];\n',
      );
    });
    expect(res.code).toBe(1);
    expect(res.output).toContain("residential_comp_sales");
  });

  it("does NOT fire on a LAND comps corpus", () => {
    // This is a land platform. Land comps are the product, not the violation.
    const res = runGateOn(
      fixture({
        "shared/schema/land.ts":
          'import { pgTable, varchar, integer, numeric, timestamp } from "drizzle-orm/pg-core";\n' +
          'export const rows = pgTable("land_comp_sales", {\n' +
          '  id: varchar("id"),\n' +
          '  acreage: numeric("acreage"),\n' +
          '  pricePerAcre: integer("price_per_acre"),\n' +
          '  salePrice: integer("sale_price"),\n' +
          '  saleDate: timestamp("sale_date"),\n' +
          "});\n",
      }),
    );
    expect(res.code).toBe(0);
  });

  it("does NOT fire on the land CMA report table, or on substring lookalikes", () => {
    // Measured: the audit's proposed name net (^|_)(comps?|cma|mls|avm)(_|$) is
    // NOT zero on this repo — it hits cma_reports, a LAND comparative-market
    // analysis keyed on subject_acres. A /comp/ substring is worse still:
    // company_*, compliance_*, compass_*. Both were narrowed away, not exempted.
    const res = runGateOn(
      fixture({
        "shared/schema/reports.ts":
          'import { pgTable, varchar, numeric, jsonb } from "drizzle-orm/pg-core";\n' +
          'export const a = pgTable("cma_reports", { id: varchar("id"), subjectAcres: numeric("subject_acres"), compIds: jsonb("comp_ids") });\n' +
          'export const b = pgTable("company_agents", { id: varchar("id") });\n' +
          'export const c = pgTable("compliance_alerts", { id: varchar("id") });\n' +
          'export const d = pgTable("compass_recommendations", { id: varchar("id") });\n',
      }),
    );
    expect(res.code).toBe(0);
  });

  it("does NOT fire on the rentals vertical (beds/baths with no sale record)", () => {
    const res = runGateOn(
      fixture({
        "shared/schema/rental.ts":
          'import { pgTable, varchar, integer, numeric } from "drizzle-orm/pg-core";\n' +
          'export const rows = pgTable("rental_units", {\n' +
          '  id: varchar("id"),\n' +
          '  bedrooms: integer("bedrooms"),\n' +
          '  bathrooms: numeric("bathrooms"),\n' +
          '  squareFeet: integer("square_feet"),\n' +
          "});\n",
      }),
    );
    expect(res.code).toBe(0);
  });
});

describe("plane signature 3 — a dedicated residential-data vendor", () => {
  it("catches a vendor npm dependency", () => {
    const files = fixture();
    files["package.json"] = JSON.stringify({ name: "fixture", dependencies: { "housecanary-client": "^1.0.0" } });
    const res = runGateOn(files);
    expect(res.code).toBe(1);
    expect(res.output).toContain("residential-data-vendor");
    expect(res.output).toContain("housecanary-client");
  });

  it("catches a vendor API host", () => {
    const res = runGateOn(fixture({ "server/services/feed.ts": 'export const u = "https://api.mlsgrid.com/v2/Property";\n' }));
    expect(res.code).toBe(1);
    expect(res.output).toContain("API host");
  });

  it("catches a vendor API key env var", () => {
    const res = runGateOn(fixture({ "server/services/feed.ts": "export const k = process.env.HOUSECANARY_API_KEY;\n" }));
    expect(res.code).toBe(1);
    expect(res.output).toContain("API key env var");
  });

  it("does NOT fire on brand names in prose, syndication channels, or unrelated env vars", () => {
    // Measured: word-anchored brand tokens hit 19-27 lines across the tree and
    // essentially all of them are this. Publishing a listing TO a portal is
    // marketing; it is not an inbound data plane. And a bare-substring env
    // predicate matched RESOLVE_PARCEL_SHADOW_SAMPLE_RATE on "RESO".
    const res = runGateOn(
      fixture({
        "server/services/syndication.ts":
          '// Residential: Zillow, Redfin, Facebook Marketplace\n' +
          'export const residential = ["zillow", "redfin", "facebook_marketplace"];\n' +
          '// Real comparable sales from county records, not Zillow estimates.\n' +
          "export const rate = process.env.RESOLVE_PARCEL_SHADOW_SAMPLE_RATE;\n" +
          "export const attom = process.env.ATTOM_API_KEY;\n",
      }),
    );
    expect(res.code).toBe(0);
  });
});

describe("plane signature 4 — bulk ingest filtering on residential attributes", () => {
  const vendorIngest = (filter: string) =>
    fixture({
      "server/jobs/ingest.ts":
        'const url = new URL("https://api.gateway.attomdata.com/propertyapi/v1.0.0/saleshistory/detail");\n' +
        "const data = await (await fetch(url.toString())).json();\n" +
        `const rows = data.property.filter((p: any) => ${filter});\n` +
        "await db.insert(transactionTraining).values(rows);\n",
    });

  it("catches the acreage band swapped for a beds/sqft filter", () => {
    const res = runGateOn(vendorIngest("Number(p?.building?.rooms?.beds ?? 0) >= 2"));
    expect(res.code).toBe(1);
    expect(res.output).toContain("bulk-ingest-residential-filter");
  });

  it("does NOT fire on the acreage band it replaced", () => {
    const res = runGateOn(vendorIngest('parseFloat(p?.lot?.lotsize2 || "0") / 43560 >= 1'));
    expect(res.code).toBe(0);
  });

  it("does NOT fire on beds/baths outside a vendor-ingest file", () => {
    // The rentals vertical and the rehab estimator both talk about beds and
    // bathrooms constantly; 90 measured lines. Scope is what keeps this quiet.
    const res = runGateOn(
      fixture({
        "server/routes-rentals.ts":
          "const schema = { bedrooms: z.number(), bathrooms: z.number() };\n" +
          "await db.insert(rentalUnits).values({ bedrooms: 3, bathrooms: 2 });\n",
      }),
    );
    expect(res.code).toBe(0);
  });
});

describe("the seam must stay a seam", () => {
  // These need the full anchor set, because the seam rule is deliberately inert
  // outside a real-shaped repo.
  it("passes on the real anchor files unmodified", () => {
    const res = runRealShaped();
    expect(res.output).toContain("scan mode: real");
    expect(res.code).toBe(0);
  });

  it("catches the allowProviders restriction being dropped", () => {
    const seam = fs
      .readFileSync(path.join(ROOT, "server/services/residentialComps.ts"), "utf8")
      .replace("{ allowProviders: RESIDENTIAL_CAPABLE_PROVIDERS },", "undefined,");
    // Assert the mutation actually mutated — a no-op mutation proves nothing.
    expect(seam).not.toContain("{ allowProviders: RESIDENTIAL_CAPABLE_PROVIDERS },");
    const res = runRealShaped({ "server/services/residentialComps.ts": seam });
    expect(res.code).toBe(1);
    expect(res.output).toContain("seam-integrity");
    expect(res.output).toContain("allowProviders");
  });

  it("catches an unregistered provider joining the residential allowlist", () => {
    const original = fs.readFileSync(path.join(ROOT, "server/services/residentialComps.ts"), "utf8");
    const from = 'RESIDENTIAL_CAPABLE_PROVIDERS: readonly string[] = ["attom"]';
    expect(original).toContain(from);
    const seam = original.replace(from, 'RESIDENTIAL_CAPABLE_PROVIDERS: readonly string[] = ["attom", "corelogic"]');
    const res = runRealShaped({ "server/services/residentialComps.ts": seam });
    expect(res.code).toBe(1);
    expect(res.output).toContain("corelogic");
  });

  it("catches the seam reading a vendor key directly", () => {
    const seam =
      fs.readFileSync(path.join(ROOT, "server/services/residentialComps.ts"), "utf8") +
      '\nconst directKey = process.env.ATTOM_API_KEY ?? "";\n';
    const res = runRealShaped({ "server/services/residentialComps.ts": seam });
    expect(res.code).toBe(1);
    expect(res.output).toContain("seam-integrity");
  });
});

describe("a vacuous scan fails instead of reading as clean", () => {
  it("fails when the anchor set is only partly present", () => {
    // A scan that reaches part of the real tree and not the rest produces a zero
    // that looks exactly like compliance. This repo has been bitten by that
    // shape before — including a block-comment stripper that mispaired and
    // blanked the very lines a scan was counting.
    const files = fixture();
    files["server/services/residentialComps.ts"] = fs.readFileSync(
      path.join(ROOT, "server/services/residentialComps.ts"),
      "utf8",
    );
    const res = runGateOn(files);
    expect(res.code).toBe(1);
    expect(res.output).toContain("PARTIAL ANCHOR SET");
  });

  it("fails when the table extractor stops seeing tables", () => {
    // Blind the parser the way a mispaired comment stripper would: the files are
    // all still there and still read, but nothing parses as a table.
    const schema = fs.readFileSync(path.join(ROOT, "shared/schema.ts"), "utf8");
    const blinded = schema.split("pgTable(").join("pgTableX(");
    expect(blinded).not.toBe(schema);
    const res = runRealShaped({ "shared/schema.ts": blinded }, { fillerTables: 0 });
    expect(res.code).toBe(1);
    expect(res.output).toContain("VACUOUS SCAN");
    expect(res.output).toContain("pgTable definitions parsed");
  });

  it("fails when a predicate has been blinded", () => {
    // The self-test is the guard against a rule that silently stops matching.
    // Blind one predicate and the gate must refuse to report a clean result.
    const dir = fs.mkdtempSync(path.join(tmpRoot, "blind-"));
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
    const original = fs.readFileSync(SCRIPT, "utf8");
    const from = "const RESIDENTIAL_TABLE_NAME =";
    expect(original).toContain(from);
    fs.writeFileSync(
      path.join(dir, "scripts", path.basename(SCRIPT)),
      original.replace(from, "const RESIDENTIAL_TABLE_NAME = /^\\u0000$/; const _blinded ="),
    );
    let code = 0;
    let output = "";
    try {
      output = execFileSync(process.execPath, [path.join(dir, "scripts", path.basename(SCRIPT))], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      code = e.status ?? 1;
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(code).toBe(1);
    expect(output).toContain("RESIDENTIAL_TABLE_NAME no longer matches");
  });
});

describe("the gate is wired into the build", () => {
  it("runs inside npm run check", () => {
    // A gate nobody runs is a file, not a gate — this repo's single most common
    // defect class, aimed at governance instead of features.
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["lint:residential-comps-hold"]).toContain("check-residential-comps-hold.mjs");
    expect(pkg.scripts.check).toContain("lint:residential-comps-hold");
  });

  it("states its own limits rather than implying coverage it lacks", () => {
    // The gate cannot see a purely numeric reframing of the land ingest job, nor
    // a plane built inside the registry provider lane, nor a runtime-configured
    // one. Those are written down. If someone deletes the section, the honesty
    // claim in this test's header stops being true.
    const gate = fs.readFileSync(SCRIPT, "utf8");
    expect(gate).toContain("STATED LIMITS");
    expect(gate).toContain("countyAssessorIngest");
  });
});
