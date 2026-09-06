/**
 * Client-safe `insertCampaignSchema` — hand-written zod, ZERO drizzle imports.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `@shared/schema` is a barrel that re-exports 84 drizzle schema modules —
 * 541 `pgTable(...)` definitions, every column, type, FK and index. Drizzle's
 * column builders are un-annotated call chains (`text("name").notNull()`), so
 * no bundler can prove them side-effect-free and none of it tree-shakes.
 * Measured: importing a single plain constant from that barrel still lands
 * 438/438 tables in the client bundle — ~364 KB raw / ~71 KB gzip of Postgres
 * DDL, downloaded and parsed by every user on every route, for tables a browser
 * can never query.
 *
 * `client/src/components/campaigns-content.tsx` needed exactly ONE thing from
 * the barrel: the zod shape of a campaign insert, to drive a react-hook-form
 * resolver (`campaignFormSchema = insertCampaignSchema.omit({ organizationId:
 * true })`). This module is that shape, transcribed by hand from the
 * `campaigns` pgTable, so the component can import a form schema without
 * dragging the DDL along.
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
 * The server still validates with the real drizzle-zod `insertCampaignSchema`
 * from `shared/schema.ts`: `server/routes-campaigns.ts` parses creates through
 * `insertCampaignSchema.parse({ ...req.body, organizationId })` and updates
 * through `insertCampaignSchema.partial().omit({ organizationId: true })`.
 * This file is the CLIENT's mirror of that contract. If the two drift:
 *   - a field this schema wrongly marks optional → the form submits without it
 *     and the server 422s at the end of a filled-in Create Campaign dialog;
 *   - a field this schema wrongly marks required → the user is blocked from
 *     saving a row the database would happily accept;
 *   - a wrong primitive (`z.number()` where `budget`/`spent` are `numeric()`
 *     and therefore STRINGS, or `z.string()` where `scheduledDate` is a
 *     `timestamp()` and wants a real `Date`) → the value is rejected locally,
 *     or coerced into a shape the API refuses.
 * None of those show up as a type error. They show up as a broken campaign
 * dialog in production.
 *
 * ── HOW IT WAS DERIVED (reproduce this when the table changes) ──────────────
 * Source of truth: `campaigns` in `shared/schema.ts` (the pgTable), and
 *   export const insertCampaignSchema = createInsertSchema(campaigns).omit({
 *     id: true, createdAt: true, updatedAt: true,
 *   });
 * NOTE the omit list: it does NOT omit `organizationId`. The tenant key is a
 * required field of this schema (the route overwrites it from the session); the
 * CLIENT is what drops it, via its own `.omit({ organizationId: true })`. Do
 * not "helpfully" remove it here — `tenantKeyIsNeverOmitted.test.ts` pins that
 * the tenant key is omitted at the call site, not in the shared shape.
 *
 * drizzle-zod@0.8.3 `insertConditions` (node_modules/drizzle-zod/index.mjs):
 *   optional: !notNull || (notNull && hasDefault)
 *   nullable: !notNull
 * so, per column:
 *   .notNull() and NO .default()  → required, non-nullable
 *   .notNull().default(x)         → .optional()             (NOT nullable)
 *   everything else               → .nullable().optional()  (a DB default does
 *                                   NOT make a nullable column non-nullable)
 * `.nullable()` is applied before `.optional()`, matching `handleColumns`.
 *
 * Verified against the real schema at the time of writing by parsing the same
 * battery of values through both: 22 fields, identical name set, identical
 * optionality, identical accept/reject on every probe. The equivalence gate in
 * `tests/unit/clientFormSchemasMatchDrizzle.test.ts` runs on the SERVER, where
 * importing drizzle is free, and re-checks name set + optionality in CI.
 */
import { z } from "zod";

/* ────────────────────────────────────────────────────────────────────────────
 * Column-type helpers — one per drizzle column builder used by `campaigns`.
 * These reproduce `columnToSchema()` from drizzle-zod 0.8.3 exactly, including
 * the bounds it attaches. Do not "tidy" them into bare zod primitives: the
 * int32 bounds and the string-ness of `numeric()` are part of the accept-set.
 * ──────────────────────────────────────────────────────────────────────────── */

/** drizzle-zod's `jsonSchema` for a json/jsonb column, reproduced verbatim. */
const jsonLiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const jsonValueSchema = z.union([
  jsonLiteralSchema,
  z.record(z.string(), z.any()),
  z.array(z.any()),
]);

/** `text(...)` with no length → plain string (PgText gets no `.max()`). */
const pgText = () => z.string();

/** `text(...).array()` → `z.array(<base column schema>)`, unsized. */
const pgTextArray = () => z.array(z.string());

/**
 * `numeric(...)` → drizzle's data type is `string`, NOT number. `budget: 5`
 * is REJECTED by the server schema; `budget: "5"` is accepted. The form's
 * `register("budget")` already yields a string, which is why this works.
 */
const pgNumeric = () => z.string();

/** `integer(...)` → int32-bounded integer (drizzle-zod adds the CONSTANTS bounds). */
const pgInteger = () => z.int().gte(-2147483648).lte(2147483647);

/** `timestamp(...)` → `z.date()`; no coercion, ISO strings are REJECTED. */
const pgTimestamp = () => z.date();

/**
 * `jsonb(...)` — runtime validation is the permissive `jsonValueSchema`, while
 * the STATIC type is the column's `.$type<T>()`. This mirrors drizzle-zod 0.8.3
 * exactly: `GetZodType` maps a `$type`d json column to `z.ZodType<data, data>`
 * while `columnToSchema` returns the generic `jsonSchema`. Narrowing the
 * runtime check to the `$type` shape would reject payloads the server accepts.
 */
const pgJsonb = <T>() => jsonValueSchema as unknown as z.ZodType<T, T>;

/* ────────────────────────────────────────────────────────────────────────────
 * `.$type<...>()` payload shape, transcribed from the pgTable.
 * ──────────────────────────────────────────────────────────────────────────── */

/** `campaigns.targetCriteria` — `.$type<{ ... }>()`, all members optional. */
export type CampaignTargetCriteria = {
  states?: string[];
  counties?: string[];
  leadStatus?: string[];
  leadType?: string[];
  tags?: string[];
};

/* ────────────────────────────────────────────────────────────────────────────
 * The schema. Field order and section comments follow the `campaigns` pgTable
 * so a side-by-side diff is possible. `id`, `createdAt` and `updatedAt` are
 * absent because the original `.omit()`s them — and ONLY those three.
 * ──────────────────────────────────────────────────────────────────────────── */

export const insertCampaignSchema = z.object({
  // ── Identity ──────────────────────────────────────────────────────────────
  // integer().references(...).notNull(), no default → REQUIRED, non-nullable.
  // Kept deliberately: the client omits it at its own call site, the server
  // supplies it from the session. See the omit-list note in the header.
  organizationId: pgInteger(),
  name: pgText(),                                        // text().notNull()
  type: pgText(),                                        // direct_mail | email | sms | multi_channel
  // .notNull().default("draft") → optional but NOT nullable.
  status: pgText().optional(),                           // draft | scheduled | active | paused | completed

  // ── Attribution ───────────────────────────────────────────────────────────
  // text().unique() — `.unique()` is an index, not a NOT NULL, so this stays
  // nullable + optional. e.g. "CAMP-ABC123".
  trackingCode: pgText().nullable().optional(),

  // ── Target audience ───────────────────────────────────────────────────────
  targetCriteria: pgJsonb<CampaignTargetCriteria>().nullable().optional(),

  // ── Content ───────────────────────────────────────────────────────────────
  subject: pgText().nullable().optional(),
  content: pgText().nullable().optional(),
  templateId: pgText().nullable().optional(),
  // text("media_urls").array() — MMS attachments, public https URLs Twilio
  // fetches. Array of STRINGS: `[1]` is rejected, `[]` is accepted.
  mediaUrls: pgTextArray().nullable().optional(),

  // ── Schedule ──────────────────────────────────────────────────────────────
  // Real `Date` objects only. The dialog already does
  // `new Date(e.target.value)` — keep it that way; a raw "2026-01-01" fails.
  scheduledDate: pgTimestamp().nullable().optional(),
  completedDate: pgTimestamp().nullable().optional(),

  // ── Metrics ───────────────────────────────────────────────────────────────
  // `.default(0)` WITHOUT `.notNull()` → still nullable AND optional.
  totalSent: pgInteger().nullable().optional(),
  totalDelivered: pgInteger().nullable().optional(),
  totalOpened: pgInteger().nullable().optional(),
  totalClicked: pgInteger().nullable().optional(),
  totalResponded: pgInteger().nullable().optional(),

  // ── Money — numeric() columns, so STRINGS on the wire ─────────────────────
  budget: pgNumeric().nullable().optional(),
  spent: pgNumeric().nullable().optional(),              // .default("0"), still nullable

  // ── Optimization tracking ─────────────────────────────────────────────────
  lastOptimizedAt: pgTimestamp().nullable().optional(),
  optimizationScore: pgInteger().nullable().optional(),  // 0-100, unconstrained in the column

  // ── Provenance ────────────────────────────────────────────────────────────
  createdBy: pgInteger().nullable().optional(),

  // id / createdAt / updatedAt are `.omit()`ed by the original — do not add them.
});

/**
 * The client's form type. `campaigns-content.tsx` builds
 * `campaignFormSchema = insertCampaignSchema.omit({ organizationId: true })`
 * on top of this, exactly as it did on the drizzle-zod original.
 */
export type InsertCampaignInput = z.infer<typeof insertCampaignSchema>;
