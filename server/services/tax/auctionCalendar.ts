/**
 * The auction calendar and bidder-registration gate — V-Tax-1 T3b. The rules
 * are pure, in shared/tax/auctionCalendar.ts; this file reads and writes the
 * auction, always scoped to the organization.
 */
import { and, eq } from "drizzle-orm";
import { taxSaleAuctions } from "@shared/schema";
import {
  auctionCalendar,
  registrationStanding,
  type AuctionCalendarRecord,
  type AuctionCalendarView,
  type RegistrationItem,
  type RegistrationItemRecord,
  type RegistrationStanding,
} from "@shared/tax/auctionCalendar";
import { clock } from "../../utils/clock";

async function loadAuction(organizationId: number, auctionId: number) {
  const { db } = await import("../../db");
  const [row] = await db
    .select({ id: taxSaleAuctions.id, auctionDate: taxSaleAuctions.auctionDate, calendar: taxSaleAuctions.calendar, registration: taxSaleAuctions.registration })
    .from(taxSaleAuctions)
    .where(and(eq(taxSaleAuctions.id, auctionId), eq(taxSaleAuctions.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/** The sale date as the county's calendar date (stored at UTC midnight by the auction routes). */
function saleDateOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface AuctionCalendarResult {
  calendar: AuctionCalendarView;
  registration: RegistrationStanding;
}

export async function getAuctionCalendar(organizationId: number, auctionId: number): Promise<AuctionCalendarResult | null> {
  const a = await loadAuction(organizationId, auctionId);
  if (!a) return null;
  return { calendar: auctionCalendar(saleDateOf(a.auctionDate), a.calendar ?? null, clock.now()), registration: registrationStanding(a.registration ?? null) };
}

export async function setAuctionCalendar(organizationId: number, auctionId: number, record: AuctionCalendarRecord): Promise<AuctionCalendarResult | null> {
  const a = await loadAuction(organizationId, auctionId);
  if (!a) return null;
  const { db } = await import("../../db");
  await db
    .update(taxSaleAuctions)
    .set({
      calendar: record,
      // The list feed reads this column; keep it the same calendar date the
      // stated deadline names (the time and zone live in `calendar`).
      registrationDeadline: record.registrationDeadline ? new Date(`${record.registrationDeadline.date}T00:00:00Z`) : null,
      updatedAt: clock.now(),
    })
    .where(and(eq(taxSaleAuctions.id, auctionId), eq(taxSaleAuctions.organizationId, organizationId)));
  return { calendar: auctionCalendar(saleDateOf(a.auctionDate), record, clock.now()), registration: registrationStanding(a.registration ?? null) };
}

export type RegistrationPatch =
  | { kind: "requirement"; requirement: NonNullable<RegistrationItemRecord["requirement"]> | null }
  | { kind: "done"; note: string | null }
  | { kind: "undone" };

export async function updateRegistrationItem(organizationId: number, auctionId: number, item: RegistrationItem, patch: RegistrationPatch, userId: string | null): Promise<RegistrationStanding | null> {
  const a = await loadAuction(organizationId, auctionId);
  if (!a) return null;
  const current = { ...(a.registration ?? {}) };
  const prior: RegistrationItemRecord = current[item] ?? { requirement: null, done: null };
  const next: RegistrationItemRecord =
    patch.kind === "requirement"
      ? { ...prior, requirement: patch.requirement }
      : patch.kind === "done"
        ? { ...prior, done: { at: clock.now().toISOString(), byUserId: userId, note: patch.note } }
        : { ...prior, done: null };
  current[item] = next;
  const { db } = await import("../../db");
  await db
    .update(taxSaleAuctions)
    .set({ registration: current, updatedAt: clock.now() })
    .where(and(eq(taxSaleAuctions.id, auctionId), eq(taxSaleAuctions.organizationId, organizationId)));
  return registrationStanding(current);
}

/** The registration gate for bidding on a lot in this auction. */
export async function auctionRegistrationGate(organizationId: number, auctionId: number): Promise<RegistrationStanding | null> {
  const a = await loadAuction(organizationId, auctionId);
  return a ? registrationStanding(a.registration ?? null) : null;
}
