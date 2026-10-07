/**
 * Insert schemas accept the date strings a JSON client sends — for the dates
 * an operator enters, and ONLY those.
 *
 * drizzle-zod maps `timestamp()` to `z.date()`, which accepts only a Date
 * object, and a JSON body cannot carry one: every route validating a body with
 * an insert schema rejected every date a browser sent. Server stamps (deletedAt
 * and the like) must stay server-owned, so the canonical factory
 * (shared/db/createInsertSchema.ts) widens only USER_ENTERED_DATE_COLUMNS.
 *
 * POPULATIONS, derived rather than listed:
 *   1. every TABLE exported by `@shared/schema`, through the factory: a date
 *      column accepts an ISO string iff it is on the allowlist; every
 *      allowlist entry names a real date column (no stale entries);
 *   2. every exported insert SCHEMA: no date field accepts a string unless its
 *      name is user-entered somewhere; the named server stamps refuse;
 *   3. every .ts/.tsx module under shared/, server/ and client/src: none may
 *      load drizzle-zod except the factory — named, aliased, namespace,
 *      dynamic or require, and createUpdateSchema/createSelectSchema too.
 */
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import { getTableColumns, getTableName, isTable, type Table } from "drizzle-orm";
import * as schema from "@shared/schema";
import { createInsertSchema, USER_ENTERED_DATE_COLUMNS } from "@shared/db/createInsertSchema";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ISO = "2026-11-01T15:30:00.000Z";
const acceptsIso = (t: z.ZodType) => {
  const r = t.safeParse(ISO);
  return r.success && r.data instanceof Date && r.data.getTime() === Date.parse(ISO);
};

// ── population 1: tables through the factory ───────────────────────────────
const TABLE_DATES: Array<{ key: string; field: z.ZodType; nullable: boolean }> = [];
for (const v of Object.values(schema)) {
  if (!isTable(v as Table)) continue;
  const table = v as Table;
  const name = getTableName(table);
  const cols = getTableColumns(table) as Record<string, { dataType: string; notNull: boolean }>;
  let insert: z.ZodObject;
  try {
    insert = createInsertSchema(table as never) as unknown as z.ZodObject;
  } catch {
    continue; // a table drizzle-zod cannot build a schema for is not reachable by any route either
  }
  for (const [col, meta] of Object.entries(cols)) {
    if (meta.dataType !== "date") continue;
    const field = (insert.shape as Record<string, z.ZodType>)[col];
    if (!field) continue; // generated / omitted by drizzle-zod
    TABLE_DATES.push({ key: `${name}.${col}`, field, nullable: !meta.notNull });
  }
}

describe("the factory widens exactly the user-entered date columns", () => {
  it("VACUITY: hundreds of date columns were read", () => {
    expect(TABLE_DATES.length).toBeGreaterThanOrEqual(600);
    expect(USER_ENTERED_DATE_COLUMNS.size).toBeGreaterThanOrEqual(40);
  });

  it("every allowlist entry is a real date column (no stale entries)", () => {
    const real = new Set(TABLE_DATES.map((d) => d.key));
    expect([...USER_ENTERED_DATE_COLUMNS].filter((k) => !real.has(k))).toEqual([]);
  });

  it("a date column accepts an ISO string if and only if it is user-entered", () => {
    const wrong = TABLE_DATES.filter(({ key, field }) => acceptsIso(field) !== USER_ENTERED_DATE_COLUMNS.has(key)).map((d) => d.key);
    expect(wrong).toEqual([]);
  });

  it("the server stamps named in the audit refuse a string", () => {
    const stamps = [
      "leads.deletedAt", "leads.createdAt", "leads.updatedAt", "leads.lastContactedAt", "leads.lastAIMessageAt",
      "leads.optOutDate", "leads.consentDate", "properties.deletedAt", "deals.deletedAt", "offers.viewedAt",
      "offers.sentAt", "offers.respondedAt", "payments.processedAt", "notes.lastReminderSentAt",
      "notes.atrDeterminationCompletedAt", "borrower_sessions.expiresAt", "api_keys.expiresAt",
    ];
    const byKey = new Map(TABLE_DATES.map((d) => [d.key, d.field]));
    for (const k of stamps) {
      expect(byKey.has(k), `${k} is not a date column — update this list`).toBe(true);
      expect(acceptsIso(byKey.get(k)!), `${k} is server-owned but accepts a client string`).toBe(false);
    }
  });

  it("a user-entered column takes a Date, an ISO date or date-time, and nothing looser", () => {
    const f = TABLE_DATES.find((d) => d.key === "deals.closingDate")!.field;
    expect(f.safeParse(new Date(ISO)).success).toBe(true);
    expect((f.safeParse("2026-11-01").data as Date).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(f.safeParse("2026-11-01T10:15:00-05:00").success).toBe(true);
    for (const bad of ["1", "0", "11/01/2026", "tomorrow", "2026-02-30", "2026-13-01", "", " "]) {
      expect(f.safeParse(bad).success, `"${bad}" was accepted as a date`).toBe(false);
    }
  });

  it("null is never coerced into a date (no 1970 on a required column)", () => {
    const wrong = TABLE_DATES.filter(({ key }) => USER_ENTERED_DATE_COLUMNS.has(key)).filter(({ field, nullable }) => {
      const r = field.safeParse(null);
      return nullable ? !(r.success && r.data === null) : r.success;
    }).map((d) => d.key);
    expect(wrong).toEqual([]);
  });
});

// ── population 2: the exported insert schemas themselves ───────────────────
describe("the exported insert schemas", () => {
  const userEnteredNames = new Set([...USER_ENTERED_DATE_COLUMNS].map((k) => k.split(".")[1]));
  const exported: Array<{ name: string; field: string; type: z.ZodType }> = [];
  for (const [name, v] of Object.entries(schema)) {
    if (!(v instanceof z.ZodObject)) continue;
    for (const [field, type] of Object.entries(v.shape as Record<string, z.ZodType>)) exported.push({ name, field, type });
  }

  it("VACUITY: exported schemas were read", () => {
    expect(new Set(exported.map((e) => e.name)).size).toBeGreaterThanOrEqual(150);
  });

  it("no field accepts an ISO string unless its column name is user-entered", () => {
    const leaks = exported.filter((e) => !userEnteredNames.has(e.field) && acceptsIso(e.type)).map((e) => `${e.name}.${e.field}`);
    expect(leaks).toEqual([]);
  });

  it("a whole body with ISO dates parses (insertDealSchema, as POST /api/deals receives it)", () => {
    const parsed = (schema as unknown as Record<string, z.ZodObject>).insertDealSchema
      .partial()
      .safeParse({ closingDate: ISO, offerDate: "2026-10-01" });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

// ── population 3: nothing builds schemas around the factory ────────────────
describe("drizzle-zod is loaded only by the canonical factory", () => {
  const ROOTS = ["shared", "server", join("client", "src")].map((r) => join(process.cwd(), r));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules") continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts|cts)$/.test(p)) files.push(p);
    }
  };
  ROOTS.forEach(walk);
  const LOADS_DRIZZLE_ZOD = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']drizzle-zod(?:\/[^"']*)?["']/;
  const FACTORY = join("shared", "db", "createInsertSchema.ts");

  it("VACUITY: the three trees were read, and the factory itself is matched", () => {
    expect(files.length).toBeGreaterThanOrEqual(2000);
    const factory = files.find((f) => f.endsWith(FACTORY))!;
    expect(LOADS_DRIZZLE_ZOD.test(stripComments(readFileSync(factory, "utf8")))).toBe(true);
  });

  it("the matcher catches every import shape", () => {
    for (const src of [
      'import { createInsertSchema } from "drizzle-zod";',
      'import { createInsertSchema as cis } from "drizzle-zod";',
      'import * as dz from "drizzle-zod";',
      'import { createUpdateSchema, createSelectSchema } from "drizzle-zod";',
      'const dz = await import("drizzle-zod");',
      'const dz = require("drizzle-zod");',
      'import "drizzle-zod";',
    ]) {
      expect(LOADS_DRIZZLE_ZOD.test(src), src).toBe(true);
    }
    expect(LOADS_DRIZZLE_ZOD.test("// built with drizzle-zod's columnToSchema")).toBe(false);
  });

  it("no other module loads drizzle-zod", () => {
    const offenders = files
      .filter((f) => !f.endsWith(FACTORY))
      .filter((f) => LOADS_DRIZZLE_ZOD.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => relative(process.cwd(), f));
    expect(offenders, "these modules build schemas outside the canonical factory").toEqual([]);
  });
});
