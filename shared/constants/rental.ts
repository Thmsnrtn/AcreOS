/**
 * Runtime-free rental vocabulary — deliberately importable by the CLIENT.
 *
 * These moved out of `shared/schema/rental.ts` because that module defines
 * drizzle tables, and any client import of it (or of the `@shared/schema`
 * barrel that re-exports it) drags all 541 table definitions into the entry
 * chunk — ~364 KB raw / 71 KB gzip of Postgres DDL for tables a browser can
 * never query. Drizzle's column chains are un-annotated calls no bundler can
 * prove pure, so it is all-or-nothing: one import brings everything.
 *
 * This file therefore imports NOTHING. `shared/schema/rental.ts` re-exports it
 * so server callers and the table definitions themselves are unchanged, and
 * `clientBundleHasNoOrm.test.ts` fails if a client path reaches the ORM again.
 */

export const RENTAL_UNIT_KINDS = [
  "unit",   // apartment / side of a duplex / the whole SFR
  "pad",    // mobile-home park: tenant owns the home, rents the ground
  "suite",  // commercial / mixed-use tenancy
] as const;
export type RentalUnitKind = typeof RENTAL_UNIT_KINDS[number];

export const RENTAL_UNIT_STATUSES = [
  "active",   // rentable today — belongs in both occupancy denominators
  "offline",  // exists but cannot be rented right now (fire, mid-renovation)
  "retired",  // no longer a rentable slot (combined into another, demolished)
] as const;
export type RentalUnitStatus = typeof RENTAL_UNIT_STATUSES[number];

/**
 * Short-term-rental stay vocabulary (moved here from shared/schema/rental.ts,
 * W2-STR 2026-11-06) so the Bookings tab's channel and status controls offer
 * exactly the values the reservation routes validate against — one list, not a
 * client copy that could drift from the server's zod enums.
 *
 * `channel` is a recorded LABEL, never a live OTA integration.
 */
export const RESERVATION_CHANNELS = [
  "airbnb",
  "vrbo",
  "booking",
  "direct",
  "other",
] as const;
export type ReservationChannel = typeof RESERVATION_CHANNELS[number];

/** booked | checked_in | checked_out | cancelled. A cancelled stay is excluded from every metric. */
export const RESERVATION_STATUSES = [
  "booked",
  "checked_in",
  "checked_out",
  "cancelled",
] as const;
export type ReservationStatus = typeof RESERVATION_STATUSES[number];
