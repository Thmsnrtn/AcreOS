/**
 * Client-safe `insertTargetCountySchema` — hand-written zod, ZERO drizzle imports.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `@shared/schema` is a barrel that re-exports 84 drizzle schema modules —
 * 541 `pgTable(...)` definitions, every column, type, FK and index. Drizzle's
 * column builders are un-annotated call chains (`text("fips_code")`), so no
 * bundler can prove them side-effect-free and none of it tree-shakes. Measured:
 * importing a single plain constant from the barrel still lands 438/438 tables
 * in the client bundle — ~364 KB raw / ~71 KB gzip of Postgres DDL shipped to
 * every user on every route, for tables a browser can never query.
 *
 * `client/src/pages/counties.tsx` needed exactly ONE thing from that barrel:
 * the zod shape of a target-county insert, to drive a react-hook-form resolver
 * (`countyFormSchema = insertTargetCountySchema.omit({ organizationId: true })`).
 * This module is that shape, transcribed by hand from the `targetCounties`
 * pgTable, so the page can import a form schema without dragging the DDL along.
 *
 * The saving is ALL-OR-NOTHING: severing eleven of twelve client→barrel value
 * imports saves zero bytes. Re-introducing `import { ... } from "@shared/schema"`
 * anywhere on the client re-imports the whole 364 KB. So:
 *
 *   DO NOT "simplify" this file back into a barrel import.
 *   DO NOT import drizzle, drizzle-zod, or @shared/schema from here — not even
 *   `import type`, because an accidental value import is one keystroke away.
 *   This module must import NOTHING but "zod".
 *
 * ── WHAT BREAKS IF IT DRIFTS ────────────────────────────────────────────────
 * The server still validates with the real drizzle-zod `insertTargetCountySchema`
 * (`shared/schema.ts`): `server/routes-campaigns.ts` parses creates with it and
 * updates with `insertTargetCountySchema.partial()` (POST/PUT
 * `/api/target-counties`). This file is the CLIENT's mirror of that contract.
 * If the two drift:
 *   - a field this schema wrongly marks optional → the form submits without it
 *     and the server 422s at the end of a filled-in modal (silent client-side
 *     pass, server-side reject);
 *   - a field this schema wrongly marks required → the user is blocked from
 *     saving a row the database would happily accept;
 *   - a wrong primitive (e.g. `z.number()` where the column is `numeric()` and
 *     therefore a STRING — `medianHomeValue`, `averageLotPrice`) → the form
 *     value is rejected locally or coerced into a shape the API refuses.
 * None of those show up as a type error. They show up as a broken Add County
 * modal in production.
 *
 * ── HOW IT WAS DERIVED (reproduce this when the table changes) ──────────────
 * Source of truth: `targetCounties` in `shared/schema.ts` (the pgTable), and
 *   export const insertTargetCountySchema = createInsertSchema(targetCounties).omit({
 *     id: true, createdAt: true, updatedAt: true,
 *   });
 * — so `id`, `createdAt` and `updatedAt` are absent here, and `organizationId`
 * IS present (unlike the property/lead mirrors, whose originals omit it). The
 * counties page omits it itself, at its own call site.
 *
 * drizzle-zod@0.8.3 `insertConditions` (node_modules/drizzle-zod/index.mjs):
 *   optional: !notNull || (notNull && hasDefault)
 *   nullable: !notNull
 * so, per column:
 *   .notNull() and NO .default()  → required, non-nullable
 *   .notNull().default(x)         → .optional()            (NOT nullable)
 *   everything else               → .nullable().optional()  (even with a default)
 * and per column type (drizzle-zod `columnToSchema`, no `coerce` configured):
 *   text()                   → z.string()
 *   numeric()                → z.string()   ← Postgres numeric round-trips as a
 *                                             STRING in drizzle; do not "fix"
 *                                             these to z.number().
 *   integer()                → z.int().gte(INT32_MIN).lte(INT32_MAX)
 *   jsonb (incl. `.$type<T>()`) → the generic `jsonValueSchema` below. `$type`
 *                                 is a TYPE-level annotation only; drizzle-zod
 *                                 does not validate the shape at runtime, and
 *                                 neither does this file. The `as z.ZodType<T>`
 *                                 cast reproduces that exact split: precise
 *                                 static type, permissive runtime check.
 *
 * Verified against the real schema on 2026-09-06: same 13 keys in the same
 * order, and every key agrees on accept/reject for `undefined`, `null`, and a
 * battery of primitives/objects/arrays. If you change the `targetCounties`
 * table, change this file in the same commit and re-run that comparison.
 */

import { z } from "zod";

/* ────────────────────────────────────────────────────────────────────────────
 * Column-type primitives — one per drizzle column kind used by `targetCounties`.
 * Named after the column builder they mirror so a diff against the pgTable is
 * mechanical.
 * ──────────────────────────────────────────────────────────────────────────── */

/** drizzle-zod's `literalSchema`, verbatim. */
const jsonLiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** drizzle-zod's `jsonSchema`, verbatim — deliberately shallow, not recursive. */
const jsonValueSchema = z.union([
  jsonLiteralSchema,
  z.record(z.string(), z.any()),
  z.array(z.any()),
]);

/** `text(...)` with no length → plain string. */
const pgText = () => z.string();

/** `numeric(...)` → drizzle data type is `string`, NOT number. */
const pgNumeric = () => z.string();

/** `integer(...)` → int32-bounded integer (drizzle-zod adds the CONSTANTS bounds). */
const pgInteger = () => z.int().gte(-2147483648).lte(2147483647);

/**
 * `jsonb(...)` — runtime validation is the permissive `jsonValueSchema`, while
 * the static type is the column's `.$type<T>()`. This mirrors drizzle-zod 0.8.3
 * exactly (`GetZodType` maps a `$type`d json column to `z.ZodType<data, data>`
 * while `columnToSchema` returns the generic `jsonSchema`).
 */
const pgJsonb = <T>() => jsonValueSchema as unknown as z.ZodType<T, T>;

/* ────────────────────────────────────────────────────────────────────────────
 * `.$type<...>()` payload shapes, transcribed from the pgTable.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Per-county "clerk profile" free-text + structured notes (Marcus TD-5):
 * payment methods, deposit timing, sale-day clock, recordation lag.
 */
export type TargetCountyClerkProfile = {
  acceptedPaymentMethods?: string[];   // wires_only, cash, certified_check, etc.
  depositTimingHours?: number;         // hrs before sale deposit due
  opensAt?: string;                    // "10:00" local
  lotListPostedAt?: string;            // "09:30" local
  proxyBiddingAllowed?: boolean;
  deedRecordationLagHours?: number;    // hours after payment
  clerkContact?: { name?: string; phone?: string; email?: string };
  general?: string;                    // freeform overflow
};

/** One acquisition data source attached to a county. */
export type TargetCountyDataSource = {
  name: string;
  type: string;                        // tax_delinquent, probate, vacant, absentee
  lastPulled?: string;
  recordCount?: number;
  cost?: number;
  url?: string;
};

/** Rolled-up county performance, rendered on the county card. */
export type TargetCountyMetrics = {
  leadsGenerated?: number;
  dealsCompleted?: number;
  responseRate?: number;
  averageProfit?: number;
};

/* ────────────────────────────────────────────────────────────────────────────
 * The schema. Field order follows the pgTable so a side-by-side diff is
 * possible. `id`, `createdAt` and `updatedAt` are absent because the original
 * `.omit()`s them.
 * ──────────────────────────────────────────────────────────────────────────── */

export const insertTargetCountySchema = z.object({
  // integer().references(organizations.id).notNull(), no default → REQUIRED.
  // The counties page omits this key itself; the server supplies the tenant.
  organizationId: pgInteger(),

  name: pgText(),                                       // text().notNull()
  state: pgText(),                                      // text().notNull()
  fipsCode: pgText().nullable().optional(),
  population: pgInteger().nullable().optional(),

  // numeric() → STRING, not number. Do not "improve" these.
  medianHomeValue: pgNumeric().nullable().optional(),
  averageLotPrice: pgNumeric().nullable().optional(),

  // .notNull().default("researching") → optional but NOT nullable.
  // (researching | active | paused | exhausted — free text at the DB level,
  // so no z.enum here either: the original is a bare z.string().)
  status: pgText().optional(),

  // integer().default(1) — has a default but is NOT notNull, so drizzle-zod
  // still makes it .nullable().optional().
  priority: pgInteger().nullable().optional(),

  notes: pgText().nullable().optional(),

  // ── jsonb payloads: precise static type, permissive runtime check ─────────
  clerkProfile: pgJsonb<TargetCountyClerkProfile>().nullable().optional(),
  dataSources: pgJsonb<TargetCountyDataSource[]>().nullable().optional(),
  metrics: pgJsonb<TargetCountyMetrics>().nullable().optional(),
});

/** Same shape `z.infer<typeof insertTargetCountySchema>` yields from the drizzle-zod original. */
export type InsertTargetCountyInput = z.infer<typeof insertTargetCountySchema>;
