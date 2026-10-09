/**
 * The ONE `createInsertSchema` every table's insert schema is built with.
 *
 * drizzle-zod maps a `timestamp()` column to `z.date()`, which accepts only a
 * `Date` object. A JSON request body cannot carry a Date: `JSON.stringify`
 * turns every Date into an ISO string, so a route validating a body with an
 * insert schema rejected every date a real client sent (`closingDate`,
 * `periodStart`, `expiresAt` on an offer, …). The routes that worked had each
 * hand-written their own `z.coerce.date()` copy (routes-finance.ts).
 *
 * WHICH DATES ARE WIDENED — AN ALLOWLIST, NOT EVERY DATE.
 * Most timestamp columns are stamps the SERVER writes when something happens:
 * createdAt, updatedAt, deletedAt (a soft delete — the delete route checks the
 * legal hold and records deletedBy), lastContactedAt, lastAIMessageAt,
 * optOutDate, consentDate, sentAt/respondedAt/viewedAt, processedAt,
 * lastReminderSentAt, atrDeterminationCompletedAt, … While every date column
 * rejected strings, a JSON client could not set any of them; widening them all
 * made `PUT /api/leads/:id {"deletedAt": "…"}` a soft delete that skipped the
 * legal-hold check. So only the columns below — dates an operator ENTERS
 * (a closing date, a due date, a goal period) — accept a string. Every other
 * date column is server-owned and keeps refusing a string, so a new stamp
 * column is server-owned by default and becomes client-writable only by being
 * added here deliberately. Keyed `table.column` because the same property name
 * is user-entered on one table (offers.expiresAt) and a server stamp on
 * another (borrower_sessions.expiresAt, api_keys.expiresAt).
 *
 * How a widened column parses:
 *   - a `Date` passes exactly as before;
 *   - an ISO-8601 date (`2026-11-01`) or date-time (`2026-11-01T15:30:00Z`,
 *     with optional fractional seconds and offset) becomes that Date;
 *   - any other string — "1", "11/01/2026", "tomorrow" — is refused, as is an
 *     ISO-shaped string that is not a real calendar date ("2026-02-30");
 *   - `null`, numbers and booleans are NOT coerced. That is why this is not
 *     drizzle-zod's `coerce: { date: true }`: `z.coerce.date()` turns `null`
 *     into 1970-01-01 on a required column, a fabricated date silently written.
 *
 * Optionality and nullability are preserved field by field (the form-schema
 * parity test, clientFormSchemasMatchDrizzle, compares exactly those).
 * `tests/unit/insertSchemasAcceptIsoDates.test.ts` pins the allowlist, the
 * server-owned columns, and that no module builds schemas any other way.
 */
import { createInsertSchema as drizzleCreateInsertSchema } from "drizzle-zod";
import { getTableName, type Table } from "drizzle-orm";
import { z } from "zod";

/** Dates an operator enters, by `table.column`. Everything else is server-owned. */
export const USER_ENTERED_DATE_COLUMNS: ReadonlySet<string> = new Set([
  // deals / leads / properties
  "deals.closingDate",
  "deals.offerDate",
  "leads.nextFollowUpAt",
  "properties.purchaseDate",
  "properties.soldDate",
  // notes & payments (routes-finance.ts already accepted these via coerce)
  "notes.startDate",
  "notes.firstPaymentDate",
  "notes.maturityDate",
  "notes.nextPaymentDate",
  "notes.lastTaxPaymentDate",
  "notes.nextTaxDueDate",
  "payments.paymentDate",
  "payments.dueDate",
  "tax_escrow_payments.paymentDate",
  // offers
  "offers.expiresAt",
  "offer_letters.expirationDate",
  // campaigns
  "campaigns.scheduledDate",
  "campaign_responses.responseDate",
  // planning & tasks
  "goals.periodStart",
  "goals.periodEnd",
  "tasks.dueDate",
  "va_tasks.dueDate",
  "va_calendar_events.startTime",
  "va_calendar_events.endTime",
  "dd_assignments.dueDate",
  "compliance_checklist_items.dueDate",
  "founder_obligations.dueDate",
  "regulatory_filing_calendar.dueDate",
  "decisions_inbox_items.checkInDate",
  // closing & reservations
  "escrow_checklists.targetCloseDate",
  "escrow_checklists.actualCloseDate",
  "buyer_reservations.reservationDate",
  "buyer_reservations.expirationDate",
  "buyer_prequalifications.nextFollowUpAt",
  "go_nogo_memos.decisionDate",
  // accounting & investment records
  "cost_basis.acquisitionDate",
  "cost_basis.dispositionDate",
  "depreciation_schedules.startDate",
  "depreciation_schedules.endDate",
  "capital_raises.startDate",
  "capital_raises.endDate",
  "opportunity_zone_holdings.investmentDate",
  "opportunity_zone_holdings.exitDate",
  // auctions & marketplace
  "tax_sale_auctions.auctionDate",
  "tax_sale_auctions.auctionEndDate",
  "tax_sale_auctions.registrationDeadline",
  "tax_sale_listings.bidDate",
  "tax_sale_listings.redemptionDeadline",
  "auction_readiness_checklists.auctionDate",
  "marketplace_listings.expiresAt",
  "marketplace_transactions.closingDate",
  // compliance records an operator maintains
  "compliance_rules.effectiveDate",
  "compliance_rules.expirationDate",
]);

// ISO-8601 calendar date, optionally with a time, fractional seconds and a
// zone (Z or ±hh:mm). Nothing looser: `new Date("1")` is a valid Date in V8.
const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** An ISO-8601 string that names a real instant becomes a Date; any other string becomes an Invalid Date (refused by z.date); non-strings are untouched. */
function acceptDateString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const m = ISO_8601.exec(value.trim());
  if (!m) return new Date(Number.NaN);
  const [, y, mo, d] = m;
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) return parsed;
  // Reject calendar overflow ("2026-02-30" → March 2 in V8): the date part
  // must round-trip.
  const probe = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (probe.getUTCFullYear() !== Number(y) || probe.getUTCMonth() !== Number(mo) - 1 || probe.getUTCDate() !== Number(d)) {
    return new Date(Number.NaN);
  }
  return parsed;
}

type AnyZod = z.ZodType;

function widenDateField(field: AnyZod): AnyZod {
  const def = (field as unknown as { _zod: { def: { type: string; innerType?: AnyZod; coerce?: boolean } } })._zod.def;
  switch (def.type) {
    case "optional":
      return widenDateField(def.innerType!).optional();
    case "nullable":
      return widenDateField(def.innerType!).nullable();
    case "date":
      return def.coerce ? field : z.preprocess(acceptDateString, field);
    default:
      return field;
  }
}

/** The user-entered date fields of `schema` (see USER_ENTERED_DATE_COLUMNS), widened to accept an ISO string. */
function acceptIsoDates<S extends z.ZodObject>(schema: S, tableName: string): S {
  const widened: Record<string, AnyZod> = {};
  for (const [key, field] of Object.entries(schema.shape as Record<string, AnyZod>)) {
    if (!USER_ENTERED_DATE_COLUMNS.has(`${tableName}.${key}`)) continue;
    const next = widenDateField(field);
    if (next !== field) widened[key] = next;
  }
  return (Object.keys(widened).length > 0 ? schema.extend(widened) : schema) as S;
}

export const createInsertSchema = ((table: Parameters<typeof drizzleCreateInsertSchema>[0], refine?: unknown) =>
  acceptIsoDates(
    (drizzleCreateInsertSchema as (t: unknown, r?: unknown) => z.ZodObject)(table, refine),
    getTableName(table as Table),
  )) as unknown as typeof drizzleCreateInsertSchema;
