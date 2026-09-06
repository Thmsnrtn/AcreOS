/**
 * Client-safe `insertLeadSchema` — hand-written zod, ZERO drizzle imports.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `@shared/schema` is a barrel that re-exports 84 drizzle schema modules —
 * 541 `pgTable(...)` definitions, every column, type, FK and index. Drizzle's
 * column builders are un-annotated call chains (`text("first_name").notNull()`),
 * so no bundler can prove them side-effect-free and none of it tree-shakes.
 * Measured: importing a single plain constant from the barrel still lands
 * 438/438 tables in the client bundle — ~364 KB raw / ~71 KB gzip of Postgres
 * DDL shipped to every user on every route, for tables a browser can never
 * query.
 *
 * `client/src/pages/leads.tsx` needed exactly ONE thing from that barrel: the
 * zod shape of a lead insert, to drive a react-hook-form resolver
 * (`leadFormSchema = insertLeadSchema.extend({ ... })`). This module is that
 * shape, transcribed by hand from the `leads` pgTable, so the page can import a
 * form schema without dragging the DDL along.
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
 * The server still validates with the real drizzle-zod `insertLeadSchema`
 * (`shared/schema.ts`): `server/routes-leads.ts` parses creates through
 * `leadCreateRequestSchema` (= `insertLeadSchema.passthrough()`,
 * `shared/contracts/leads.ts`) and updates through `insertLeadSchema.partial()`;
 * `server/services/import.ts` and `importExport.ts` extend it for CSV import.
 * This file is the CLIENT's mirror of that contract. If the two drift:
 *   - a field this schema wrongly marks optional → the form submits without it
 *     and the server 422s at the end of a filled-in modal (silent client-side
 *     pass, server-side reject);
 *   - a field this schema wrongly marks required → the user is blocked from
 *     saving a row the database would happily accept;
 *   - a wrong primitive (e.g. `z.number()` where the column is `numeric()` and
 *     therefore a STRING, or `z.string()` where a `timestamp()` wants a real
 *     `Date`) → the value is rejected locally, or coerced into a shape the API
 *     refuses.
 * None of those show up as a type error. They show up as a broken Add Lead
 * modal in production.
 *
 * ── HOW IT WAS DERIVED (reproduce this when the table changes) ──────────────
 * Source of truth: `leads` in `shared/schema.ts` (the pgTable), and
 *   export const insertLeadSchema = createInsertSchema(leads).omit({
 *     id: true, createdAt: true, updatedAt: true, lastScoreAt: true,
 *     organizationId: true, phoneNormalized: true,
 *   }).extend({ email: z.preprocess(...) });
 * drizzle-zod@0.8.3 `insertConditions` (node_modules/drizzle-zod/index.mjs):
 *   optional: !notNull || (notNull && hasDefault)
 *   nullable: !notNull
 * so, per column:
 *   .notNull() and NO .default()  → required, non-nullable
 *   .notNull().default(x)         → .optional()            (NOT nullable)
 *   everything else               → .nullable().optional()  (a DB default does
 *                                    NOT make a nullable column non-nullable —
 *                                    e.g. `emailOpens` is `.default(0)` and is
 *                                    still `.nullable().optional()` here)
 * and per column type (drizzle-zod `columnToSchema`, no `coerce` configured):
 *   text()                   → z.string()  (no `.max()`; that is varchar/char)
 *   numeric()                → z.string()  ← Postgres numeric round-trips as a
 *                                            STRING in drizzle; do not "fix"
 *                                            `estimatedValue` / `acreage` to
 *                                            z.number().
 *   integer()                → z.int().gte(INT32_MIN).lte(INT32_MAX)
 *   boolean()                → z.boolean()
 *   timestamp()              → z.date()    ← NOT coerced: an ISO string is
 *                                            REJECTED, same as the server.
 *   jsonb (incl. `.$type<T>()`) → the generic `jsonValueSchema` below. `$type`
 *                                 is a TYPE-level annotation only; drizzle-zod
 *                                 does not validate the shape at runtime, and
 *                                 neither does this file. The `as z.ZodType<T>`
 *                                 cast reproduces that exact split: precise
 *                                 static type, permissive runtime check.
 *
 * Two omissions are load-bearing and must stay omitted:
 *   - `organizationId` — F-D34 (2026-05-21): every insert schema omits the
 *     tenant key so it can only be injected server-side. Accepting it here
 *     would re-open mass-assignment into another org's data.
 *   - `phoneNormalized` — a STORED GENERATED column (migration 0051). Postgres
 *     rejects explicit writes to it.
 *
 * Verified against the real schema on 2026-09-06: same 44 keys in the same
 * order, and every key agrees on accept/reject for `undefined`, `null`, `""`
 * and a battery of primitives; `z.infer` and `z.input` are type-identical to the
 * drizzle-zod original. If you change the `leads` table, change this file in the
 * same commit and re-run that comparison.
 */

import { z } from "zod";

/* ────────────────────────────────────────────────────────────────────────────
 * Column-type primitives — one per drizzle column kind used by `leads`.
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

/** The static type drizzle-zod infers for an un-`$type`d json column. */
export type Json = string | number | boolean | null | { [key: string]: any } | any[];

/** `text(...)` with no length → plain string. */
const pgText = () => z.string();

/** `numeric(...)` → drizzle data type is `string`, NOT number. */
const pgNumeric = () => z.string();

/** `integer(...)` → int32-bounded integer (drizzle-zod adds the CONSTANTS bounds). */
const pgInteger = () => z.int().gte(-2147483648).lte(2147483647);

/** `boolean(...)` */
const pgBoolean = () => z.boolean();

/** `timestamp(...)` → `z.date()`; no coercion, strings are rejected. */
const pgTimestamp = () => z.date();

/**
 * `jsonb(...)` — runtime validation is the permissive `jsonValueSchema`, while
 * the static type is the column's `.$type<T>()`. This mirrors drizzle-zod 0.8.3
 * exactly (`GetZodType` maps a `$type`d json column to `z.ZodType<data, data>`
 * while `columnToSchema` returns the generic `jsonSchema`).
 */
const pgJsonb = <T>() => jsonValueSchema as unknown as z.ZodType<T, T>;

/* ────────────────────────────────────────────────────────────────────────────
 * `.$type<...>()` payload shape, transcribed from the pgTable.
 * ──────────────────────────────────────────────────────────────────────────── */

/** `leads.scoreFactors` — `.$type<{ ... }>()`, all members optional. */
export type LeadScoreFactors = {
  responseRecency?: number;
  emailEngagement?: number;
  sourceBonus?: number;
  statusBonus?: number;
  recencyPenalty?: number;
  total?: number;
};

/* ────────────────────────────────────────────────────────────────────────────
 * The schema. Field order and comments follow the pgTable section-by-section so
 * a side-by-side diff is possible. `id`, `organizationId`, `createdAt`,
 * `updatedAt`, `lastScoreAt` and `phoneNormalized` are absent because the
 * original `.omit()`s them.
 * ──────────────────────────────────────────────────────────────────────────── */

export const insertLeadSchema = z.object({
  // ── Identity ──────────────────────────────────────────────────────────────
  // .notNull().default("seller") → optional but NOT nullable.
  type: pgText().optional(),                            // seller | buyer
  firstName: pgText(),                                  // text().notNull()
  lastName: pgText(),                                   // text().notNull()

  /**
   * F-D23 + WS1 (2026-07-07), reproduced VERBATIM from the `.extend()` on the
   * drizzle-zod original — this is the one field that is not a plain column
   * mapping:
   *   - drizzle-zod would give a bare `z.string()`, so "not-an-email" reached
   *     the DB; tightened to email format.
   *   - still optional/nullable: the column is nullable for callers who only
   *     have a phone or a parcel-owner name.
   *   - an untouched form field arrives as `""` — that is an ABSENT email, not
   *     an invalid one, so it is coerced to null rather than 422ing the lead.
   * Keep the preprocess: without it, every empty Add Lead form fails validation.
   */
  email: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().email().optional().nullable(),
  ),

  phone: pgText().nullable().optional(),

  // ── Mailing address ───────────────────────────────────────────────────────
  address: pgText().nullable().optional(),
  city: pgText().nullable().optional(),
  state: pgText().nullable().optional(),
  zip: pgText().nullable().optional(),

  // ── Pipeline ──────────────────────────────────────────────────────────────
  // .notNull().default("new") → optional but NOT nullable.
  status: pgText().optional(),
  source: pgText().nullable().optional(),               // tax_list, referral, …
  campaignId: pgInteger().nullable().optional(),
  notes: pgText().nullable().optional(),
  tags: pgJsonb<string[]>().nullable().optional(),      // jsonb().$type<string[]>()
  assignedTo: pgInteger().nullable().optional(),        // team member ID
  lastContactedAt: pgTimestamp().nullable().optional(),

  // ── Parcel identity / enrichment ──────────────────────────────────────────
  apn: pgText().nullable().optional(),
  county: pgText().nullable().optional(),
  propertyAddress: pgText().nullable().optional(),
  taxDelinquent: pgBoolean().nullable().optional(),
  estimatedValue: pgNumeric().nullable().optional(),    // numeric → string
  acreage: pgNumeric().nullable().optional(),           // numeric → string

  // ── Campaign attribution ──────────────────────────────────────────────────
  sourceTrackingCode: pgText().nullable().optional(),
  sourceCampaignId: pgInteger().nullable().optional(),
  sourceMailPieceId: pgInteger().nullable().optional(),

  // ── Lead scoring & nurturing ──────────────────────────────────────────────
  // NOTE: `lastScoreAt` sits between `scoreFactors` and `emailOpens` in the
  // pgTable but is `.omit()`ed by the original — it is deliberately absent.
  score: pgInteger().nullable().optional(),             // 0-100
  scoreFactors: pgJsonb<LeadScoreFactors>().nullable().optional(),
  emailOpens: pgInteger().nullable().optional(),        // .default(0), still nullable
  emailClicks: pgInteger().nullable().optional(),       // .default(0), still nullable
  responses: pgInteger().nullable().optional(),         // .default(0), still nullable
  nurturingStage: pgText().nullable().optional(),       // .default("new"), still nullable
  nextFollowUpAt: pgTimestamp().nullable().optional(),
  lastAIMessageAt: pgTimestamp().nullable().optional(),

  // ── TCPA compliance (20.2) ────────────────────────────────────────────────
  tcpaConsent: pgBoolean().nullable().optional(),       // .default(false), still nullable
  consentDate: pgTimestamp().nullable().optional(),
  consentSource: pgText().nullable().optional(),        // website | phone | written | imported
  optOutDate: pgTimestamp().nullable().optional(),
  optOutReason: pgText().nullable().optional(),
  doNotContact: pgBoolean().nullable().optional(),      // .default(false), still nullable
  timezone: pgText().nullable().optional(),             // IANA tz for quiet hours

  // ── Soft delete ───────────────────────────────────────────────────────────
  deletedAt: pgTimestamp().nullable().optional(),
  deletedBy: pgText().nullable().optional(),

  // ── Tax / 1099 recipient identity (ciphertext at rest) ────────────────────
  taxId: pgText().nullable().optional(),
  taxIdType: pgText().nullable().optional(),            // SSN | EIN | ITIN
});

/** Same shape `z.infer<typeof insertLeadSchema>` yields from the drizzle-zod original. */
export type InsertLeadInput = z.infer<typeof insertLeadSchema>;
