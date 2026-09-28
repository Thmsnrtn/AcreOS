/**
 * Every row of an org's book, for exports and book-wide figures (DEFECT-0170).
 *
 * The export, backup-zip and data-portability paths read getLeads /
 * getProperties / getDeals / getNotes — the whole-org reads capped at
 * LIST_READ_CAP (5000), newest first. Past 5000 rows a customer's
 * "export everything" silently omitted their OLDEST records, the backup's
 * counts reported the truncated numbers as totals, and a date-filtered
 * export of old rows came back empty. An export that drops data is worse
 * than one that refuses, so this reads the whole set in keyset pages with
 * the SAME predicates as the capped getters, and REFUSES past a hard
 * ceiling rather than truncating.
 */
import { and, asc, eq, gt, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { deals, leads, notes, payments, properties } from "@shared/schema";
import { ADMINISTRATIVE_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";

const PAGE = 1000;
/** Far above any real book; a larger one is refused, never cut short. */
const EXPORT_ROW_CEILING = 250_000;

class ExportTooLargeError extends Error {
  constructor(kind: string) {
    super(`This ${kind} export exceeds ${EXPORT_ROW_CEILING.toLocaleString()} rows — contact support for a bulk export; nothing was truncated.`);
    this.name = "ExportTooLargeError";
  }
}

type Kind = "leads" | "properties" | "deals" | "notes" | "payments";

async function readAll<T extends { id: number }>(
  kind: Kind,
  page: (afterId: number) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  let afterId = 0;
  for (;;) {
    const rows = await page(afterId);
    out.push(...rows);
    if (out.length > EXPORT_ROW_CEILING) throw new ExportTooLargeError(kind);
    if (rows.length < PAGE) return out;
    afterId = rows[rows.length - 1].id;
  }
}

export function readAllLeads(orgId: number) {
  return readAll("leads", (afterId) =>
    db.select().from(leads)
      .where(and(eq(leads.organizationId, orgId), sql`${leads.deletedAt} IS NULL`, gt(leads.id, afterId)) as SQL)
      .orderBy(asc(leads.id))
      .limit(PAGE),
  );
}

export function readAllProperties(orgId: number) {
  return readAll("properties", (afterId) =>
    db.select().from(properties)
      .where(and(eq(properties.organizationId, orgId), sql`${properties.status} != 'deleted'`, gt(properties.id, afterId)) as SQL)
      .orderBy(asc(properties.id))
      .limit(PAGE),
  );
}

export function readAllDeals(orgId: number) {
  return readAll("deals", (afterId) =>
    db.select().from(deals)
      .where(
        and(
          eq(deals.organizationId, orgId),
          notInArray(deals.status, [...ADMINISTRATIVE_DEAL_STATUSES]),
          gt(deals.id, afterId),
        ) as SQL,
      )
      .orderBy(asc(deals.id))
      .limit(PAGE),
  );
}

export function readAllNotes(orgId: number) {
  return readAll("notes", (afterId) =>
    db.select().from(notes)
      .where(and(eq(notes.organizationId, orgId), gt(notes.id, afterId)) as SQL)
      .orderBy(asc(notes.id))
      .limit(PAGE),
  );
}

/**
 * Every payment on the org's book. getPayments(orgId) stops SILENTLY at
 * 5000 (newest first), so a servicer's lifetime "collected" and its
 * 12-month cash-flow chart were cut short with no signal.
 */
export function readAllPayments(orgId: number) {
  return readAll("payments", (afterId) =>
    db.select().from(payments)
      .where(and(eq(payments.organizationId, orgId), gt(payments.id, afterId)) as SQL)
      .orderBy(asc(payments.id))
      .limit(PAGE),
  );
}
