/**
 * Client-safe `insertNoteSchema` — hand-written zod, ZERO drizzle imports.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The `@shared/schema` barrel re-exports 84 drizzle schema modules — 541
 * `pgTable(...)` definitions, every column, type, FK and index. Drizzle's column
 * builders are un-annotated call chains (`numeric("current_balance")`), so no
 * bundler can prove them side-effect-free and none of it tree-shakes. Measured:
 * importing a single plain constant from the barrel still lands 438/438 tables
 * in the client bundle — ~364 KB raw / ~71 KB gzip of Postgres DDL shipped to
 * every user on every route, for tables a browser can never query.
 *
 * `client/src/pages/finance.tsx` needed exactly ONE thing from that barrel: the
 * zod shape of a seller-financed note insert, to drive a react-hook-form
 * resolver (`const noteFormSchema = insertNoteSchema.omit({ organizationId:
 * true })`). This module is that shape, transcribed by hand from the `notes`
 * pgTable, so the page can import a form schema without dragging the DDL along.
 *
 * The saving is ALL-OR-NOTHING: severing eleven of twelve client→barrel value
 * imports saves zero bytes. Re-introducing a value import of the schema barrel
 * anywhere on the client re-imports the whole 364 KB. So:
 *
 *   DO NOT "simplify" this file back into a barrel import.
 *   DO NOT import drizzle, drizzle-zod, or the schema barrel from here — not
 *   even `import type`, because an accidental value import is one keystroke
 *   away. This module must import NOTHING but "zod".
 *
 * ── WHAT BREAKS IF IT DRIFTS ────────────────────────────────────────────────
 * The server still validates with the real drizzle-zod `insertNoteSchema`
 * (`shared/schema.ts`): `server/routes-finance.ts` parses note creates through
 * `insertNoteSchema.parse({ ...req.body, organizationId })`, and
 * `shared/routes.ts` publishes it as the `api.notes.create` input contract
 * (`InsertNote`). This file is the CLIENT's mirror of that contract. If the two
 * drift:
 *   - a field this schema wrongly marks optional → the Add Note form submits
 *     without it and the server 422s at the end of a filled-in modal (silent
 *     client-side pass, server-side reject);
 *   - a field this schema wrongly marks required → the user is blocked from
 *     saving a note the database would happily accept;
 *   - a wrong primitive (e.g. `z.number()` where the column is `numeric()` and
 *     therefore a STRING) → the form value is rejected locally, or coerced into
 *     a shape the API refuses. Every money field on a note — principal,
 *     balance, rate, payment, fees, escrow — is `numeric()`, i.e. a STRING.
 * None of those show up as a type error. They show up as a broken "Create Note"
 * modal in production, on the door where customers book their loan portfolio.
 *
 * ── HOW IT WAS DERIVED (reproduce this when the table changes) ──────────────
 * Source of truth: `notes` in `shared/schema.ts` (the pgTable, ~1525), and
 *   export const insertNoteSchema = createInsertSchema(notes).omit({
 *     id: true, createdAt: true, updatedAt: true,
 *   });
 * so `id`, `createdAt` and `updatedAt` are ABSENT here too. NOTE: unlike the
 * deal/property/lead form schemas, this one KEEPS `organizationId` (required,
 * non-nullable) — the drizzle-zod original does not omit it, and finance.tsx
 * strips it itself with `.omit({ organizationId: true })` because the server
 * stamps it from the session. Do not omit it here.
 *
 * drizzle-zod@0.8.3 `HandleInsertColumn` (node_modules/drizzle-zod/index.d.ts):
 *   .notNull() and NO .default()  → required, non-nullable
 *   .notNull().default(x)         → z.ZodOptional<T>              (NOT nullable)
 *   everything else               → z.ZodOptional<z.ZodNullable<T>>
 * A DB default is applied by Postgres, not by zod: omitting `status` yields
 * `undefined`, it does NOT materialise "active" client-side.
 *
 * and per column type (`columnToSchema`, no `coerce` configured):
 *   text()      → z.string()          (no length check; "" is a valid value)
 *   numeric()   → z.string()   ← Postgres numeric round-trips as a STRING in
 *                                 drizzle. Do NOT "fix" these to z.number();
 *                                 the server would reject the number.
 *   integer()   → z.int().gte(INT32_MIN).lte(INT32_MAX)
 *   boolean()   → z.boolean()
 *   timestamp() → z.date()     ← mode 'date', NO coercion. An ISO string is
 *                                 REJECTED; finance.tsx hands the resolver real
 *                                 `Date` objects (`startDate: new Date()`).
 *   jsonb()     → drizzle-zod's loose `jsonSchema` union, which IGNORES the
 *                 column's `$type<>()` at RUNTIME (it validates "any JSON").
 *                 Do not tighten it — a stricter client schema would reject
 *                 payloads the server accepts.
 *
 * Two `$type<>()` subtleties on this table are reproduced deliberately, because
 * drizzle-zod's TYPE mapping treats a `| null` in the `$type` differently from
 * a plain object/array `$type` (verified by probing the real schema with tsc):
 *   - `fallbackPaymentAccounts` / `amortizationSchedule` — `$type<T[]>()`, so
 *     drizzle-zod infers `T[] | null | undefined`. → `jsonbColumn<T[]>()`.
 *   - `atrDetermination` — `$type<{...} | null>()`. The `| null` means the data
 *     type no longer extends `Record<string, any>`, so drizzle-zod falls back to
 *     its loose `Json` type and infers `Json | undefined`, NOT the ATR shape.
 *     → `jsonbJsonColumn()`. (`NoteAtrDetermination` below documents the real
 *     shape for readers; it is intentionally NOT enforced here, because the
 *     drizzle-zod original does not enforce it either.)
 *   - `atrExemptionCode` — `text().$type<"raw_land" | ... | null>()`. Same
 *     reason: the union with `null` does not extend `string`, so drizzle-zod's
 *     type mapping bottoms out at a bare `z.ZodType`, i.e. `unknown`. Runtime is
 *     still `z.string()`. → `unknownTextColumn()`. It is NOT a z.enum(); the
 *     `$type` is a compile-time assertion only, and the DB CHECK constraint in
 *     migration 0099 is what actually constrains it.
 *
 * Verified field-by-field against the real schema by probing
 * `insertNoteSchema.shape` (48 fields, same names, same optional/nullable flags,
 * same primitives, same int32 bounds) plus a value-level differential — see
 * `tests/unit/clientFormSchemasMatchDrizzle.test.ts`.
 */
import { z } from "zod";

/** Postgres int4 bounds, as drizzle-zod applies them to `integer()` columns. */
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/** `integer("...")` — drizzle-zod: `z.int().gte(INT32_MIN).lte(INT32_MAX)`. */
const pgInteger = () => z.int().gte(INT32_MIN).lte(INT32_MAX);

/**
 * `jsonb("...")` — drizzle-zod's exported `jsonSchema`, verbatim:
 *   z.union([literalSchema, z.record(z.string(), z.any()), z.array(z.any())])
 * It is deliberately loose: the column's `$type<>()` is a TYPE-level assertion
 * only, so drizzle-zod never validates the object's inner shape.
 */
const jsonLiteralSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const jsonSchema = z.union([
  jsonLiteralSchema,
  z.record(z.string(), z.any()),
  z.array(z.any()),
]);

/** drizzle-zod's `Json` utility type, verbatim (drizzle-zod/utils.d.ts). */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: any }
  | any[];

/**
 * A nullable+optional `jsonb` column whose `$type<T>()` drizzle-zod DOES carry
 * into the inferred type (plain object or array `$type`, no `| null`): the loose
 * runtime validator above, cast to `T` so `z.infer` matches drizzle-zod's
 * `z.ZodOptional<z.ZodNullable<z.ZodType<T, T>>>`. The cast changes nothing at
 * runtime — the accept-set is identical.
 */
const jsonbColumn = <T>() =>
  jsonSchema.nullable().optional() as unknown as z.ZodOptional<z.ZodNullable<z.ZodType<T, T>>>;

/**
 * A nullable+optional `jsonb` column whose `$type<>()` includes `| null`, which
 * makes drizzle-zod fall back to `z.ZodType<Json>` (output `Json`, input
 * `unknown`). Same runtime validator, matching static type.
 */
const jsonbJsonColumn = () =>
  jsonSchema.nullable().optional() as unknown as z.ZodOptional<z.ZodNullable<z.ZodType<Json>>>;

/**
 * A nullable+optional `text()` column whose `$type<>()` includes `| null`, so
 * drizzle-zod's type mapping bottoms out at a bare `z.ZodType` (`unknown` in and
 * out) while the RUNTIME schema is still `z.string()`. Reproduced exactly:
 * strings pass, numbers/objects fail, and the static type stays `unknown`.
 */
const unknownTextColumn = () =>
  z.string().nullable().optional() as unknown as z.ZodOptional<z.ZodNullable<z.ZodType>>;

/** `notes.fallbackPaymentAccounts` — `$type<{...}[]>()` on the jsonb column. */
export type NoteFallbackPaymentAccount = {
  profileId: string;
  method: "ach_actum" | "ach_authorize" | "card_stripe" | "card_authorize";
  last4?: string;
  bankName?: string;
  /** 1 = first fallback, 2 = second, etc. */
  order: number;
  isActive: boolean;
};

/** `notes.amortizationSchedule` — `$type<{...}[]>()` on the jsonb column. */
export type NoteAmortizationEntry = {
  paymentNumber: number;
  dueDate: string;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
  /** pending, paid, late, missed */
  status: string;
};

/**
 * `notes.atrDetermination` — the Reg-Z §1026.43(c) ability-to-repay record.
 * DOCUMENTATION ONLY: the drizzle-zod original infers this column as loose
 * `Json` (the `$type` is `{...} | null`), so `insertNoteSchema` below uses
 * `jsonbJsonColumn()` to match. Do not wire this type into the schema — a
 * stricter client schema would reject payloads the server accepts.
 */
export type NoteAtrDetermination = {
  currentOrReasonablyExpectedIncomeCents: number;
  currentEmploymentStatus: string;
  monthlyMortgagePaymentCents: number;
  monthlyPaymentSimultaneousLoansCents: number;
  monthlyPaymentMortgageRelatedObligationsCents: number;
  currentDebtObligationsAlimonyChildSupportCents: number;
  monthlyDtiOrResidualIncomeCents: number;
  creditHistorySummary: string;
  verificationDocuments: Array<{
    factor: string;
    documentType: string;
    receivedDate: string;
    storedAt?: string;
  }>;
  qmClassification:
    | "general_qm"
    | "small_creditor_qm"
    | "seasoned_qm"
    | "non_qm"
    | null;
  attestedBy: string;
  attestedByUserId: number;
  attestedAt: string;
  attestationText: string;
};

/**
 * `notes.atrExemptionCode` — the §1026.43 out-of-scope markers. DOCUMENTATION
 * ONLY, for the same reason as `NoteAtrDetermination`: the column is a plain
 * `text()` at runtime and `unknown` in drizzle-zod's inferred type.
 */
export type NoteAtrExemptionCode =
  | "raw_land"
  | "business_purpose"
  | "commercial_borrower"
  | "legacy";

/**
 * Accepts EXACTLY what `createInsertSchema(notes).omit({ id, createdAt,
 * updatedAt })` accepts. Field order mirrors the pgTable.
 */
export const insertNoteSchema = z.object({
  // integer("organization_id").references(...).notNull() → required.
  // NOT omitted by the drizzle-zod original; finance.tsx omits it itself.
  organizationId: pgInteger(),
  propertyId: pgInteger().nullable().optional(),
  borrowerId: pgInteger().nullable().optional(),

  // Note terms — every one of these is numeric(), i.e. a STRING.
  originalPrincipal: z.string(),
  currentBalance: z.string(),
  interestRate: z.string(), // annual percentage, as a string
  termMonths: pgInteger(),
  monthlyPayment: z.string(),

  // Additional fees — numeric().default("0") / integer().default(10):
  // a DB default makes the column optional AND still nullable (not .notNull()).
  serviceFee: z.string().nullable().optional(),
  lateFee: z.string().nullable().optional(),
  gracePeriodDays: pgInteger().nullable().optional(),

  // Property-tax escrow
  taxEscrowEnabled: z.boolean().nullable().optional(),
  annualPropertyTax: z.string().nullable().optional(),
  monthlyTaxEscrow: z.string().nullable().optional(),
  taxEscrowBalance: z.string().nullable().optional(),
  taxEscrowAccountId: z.string().nullable().optional(),
  lastTaxPaymentDate: z.date().nullable().optional(),
  nextTaxDueDate: z.date().nullable().optional(),
  taxPaymentYear: pgInteger().nullable().optional(),
  countyTaxPortalUrl: z.string().nullable().optional(),

  // Dates — timestamp(mode: 'date'), NO coercion: pass real Date objects.
  startDate: z.date(),
  firstPaymentDate: z.date(),
  nextPaymentDate: z.date().nullable().optional(),
  maturityDate: z.date().nullable().optional(),

  // text("status").notNull().default("active") → optional, NOT nullable.
  // Free-form string, not an enum (pending, active, paid_off, defaulted,
  // foreclosed) — drizzle-zod only emits z.enum() for `text({ enum: [...] })`.
  status: z.string().optional(),

  // Down payment tracking
  downPayment: z.string().nullable().optional(),
  downPaymentReceived: z.boolean().nullable().optional(),

  // Payment method info (for automation)
  paymentMethod: z.string().nullable().optional(),
  paymentAccountId: z.string().nullable().optional(),
  autoPayEnabled: z.boolean().nullable().optional(),

  // jsonb, validated loosely (see jsonbColumn above)
  fallbackPaymentAccounts: jsonbColumn<NoteFallbackPaymentAccount[]>(),
  amortizationSchedule: jsonbColumn<NoteAmortizationEntry[]>(),

  accessToken: z.string().nullable().optional(),
  pendingCheckoutSessionId: z.string().nullable().optional(),

  // Delinquency tracking
  lastReminderSentAt: z.date().nullable().optional(),
  reminderCount: pgInteger().nullable().optional(),
  daysDelinquent: pgInteger().nullable().optional(),
  delinquencyStatus: z.string().nullable().optional(),

  // Entity ownership tracking
  owningEntity: z.string().nullable().optional(),

  // Close & Carry — the deal this note was originated from.
  originatingDealId: pgInteger().nullable().optional(),

  // ATR (Ability-to-Repay) attestation — loose Json / unknown by construction;
  // see the header note on `$type<... | null>()`.
  atrDetermination: jsonbJsonColumn(),
  atrDeterminationCompleted: z.boolean().nullable().optional(),
  atrDeterminationCompletedAt: z.date().nullable().optional(),
  atrExemptionCode: unknownTextColumn(),

  // integer("version").notNull().default(1) → optional, NOT nullable.
  version: pgInteger().optional(),

  // text("notes_text") — the COLUMN is notes_text, the field is `notes`.
  notes: z.string().nullable().optional(),

  // Soft delete
  deletedAt: z.date().nullable().optional(),
  deletedBy: z.string().nullable().optional(),
});

/** Mirrors `InsertNote` — the note-form value type (finance.tsx omits
 * `organizationId` from it before handing it to the resolver). */
export type NoteInput = z.infer<typeof insertNoteSchema>;
