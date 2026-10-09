/**
 * Offer lifecycle timestamps are stamped by the server, on the state change.
 *
 * `offers.sent_at` / `responded_at` (and the offer-letter equivalents) were
 * ordinary writable fields of the create/PATCH bodies, and no transition code
 * set them: an offer PATCHed to "sent" or "accepted" carried whatever time the
 * client sent — or none, so "days to response" and expiry had nothing true to
 * read. Now:
 *   - client-supplied values for these fields are always discarded;
 *   - moving to "sent" stamps sent_at; moving to a response status stamps
 *     responded_at (and, for letters, "delivered" stamps delivered_at);
 *   - the FIRST stamp wins (COALESCE): a counter followed by an accept keeps
 *     the time the seller first responded, and re-sending does not move the
 *     original send.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { clock } from "../utils/clock";

const OFFER_RESPONSE_STATUSES: ReadonlySet<string> = new Set([
  "accepted",
  "rejected",
  "countered",
  "responded",
]);

type StampColumns = {
  sentAt: AnyPgColumn;
  respondedAt: AnyPgColumn;
  deliveredAt?: AnyPgColumn;
};

type Stampable = { status?: unknown; sentAt?: unknown; respondedAt?: unknown; deliveredAt?: unknown };

function stampKinds(status: unknown, cols: StampColumns): Array<"sentAt" | "respondedAt" | "deliveredAt"> {
  if (status === "sent") return ["sentAt"];
  if (status === "delivered" && cols.deliveredAt) return ["deliveredAt"];
  if (typeof status === "string" && OFFER_RESPONSE_STATUSES.has(status)) return ["respondedAt"];
  return [];
}

function strip<T extends Stampable>(input: T, cols: StampColumns) {
  const { sentAt: _s, respondedAt: _r, deliveredAt: _d, ...rest } = input;
  // deliveredAt is only server-owned on tables that have it.
  if (!cols.deliveredAt && _d !== undefined) (rest as Record<string, unknown>).deliveredAt = _d;
  return rest;
}

/** For an INSERT: a row created already in a stamped status gets the server's clock. */
export function stampOfferInsert<T extends Stampable>(input: T, cols: StampColumns, now: Date = clock.now()) {
  const out: Record<string, unknown> = strip(input, cols);
  for (const k of stampKinds(input.status, cols)) out[k] = now;
  return out as Omit<T, "sentAt" | "respondedAt" | "deliveredAt"> & Partial<Record<"sentAt" | "respondedAt" | "deliveredAt", Date>>;
}

/** For an UPDATE: SQL against the row, so the first stamp is never overwritten. */
export function stampOfferUpdate<T extends Stampable>(updates: T, cols: StampColumns) {
  const out: Record<string, unknown> = strip(updates, cols);
  for (const k of stampKinds(updates.status, cols)) {
    out[k] = sql`COALESCE(${cols[k]!}, now())`;
  }
  return out as Omit<T, "sentAt" | "respondedAt" | "deliveredAt"> & Partial<Record<"sentAt" | "respondedAt" | "deliveredAt", SQL>>;
}
