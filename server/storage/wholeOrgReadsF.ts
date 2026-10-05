/**
 * Whole-org counts, top-N reads and whole-set reads for the route files that
 * read the capped lists (DEFECT-0171, W10.2b group F).
 *
 * `storage.getLeads / getProperties / getDeals / getNotes` return an org's
 * NEWEST 5,000 rows (server/storage/listCap.ts). The routes below counted,
 * ranked or acted on that list as if it were the whole book, so past 5,000
 * rows their oldest records were silently missing from the answer. Each
 * function here answers one of those questions over every row instead:
 *   - counts and group-bys in SQL;
 *   - "the top N by X" as ORDER BY + LIMIT N in SQL, never "load 5,000 then
 *     sort in memory";
 *   - whole sets through `readAllPages` (keyset-paged, refuses past its
 *     ceiling rather than truncating).
 *
 * Every statement is org-scoped. Lead reads are live (`liveLead()`, written
 * into each statement so the live-lead census reads it there), and the
 * other tables carry the same predicates their capped getter applied:
 * properties `status != 'deleted'`, deals not in ADMINISTRATIVE_DEAL_STATUSES,
 * notes the org only.
 */
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNotNull, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { db } from "../db";
import { deals, leads, notes, properties, skipTraces, type Lead } from "@shared/schema";
import { ADMINISTRATIVE_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";
import { liveLead } from "./liveLeads";
import { readAllPages, WHOLE_BOOK_PAGE } from "./wholeBookReads";

// ── The capped getters' own predicates, stated once ─────────────────────────

/** Non-deleted properties of this org — getProperties' filter. */
function orgProperties(orgId: number): SQL {
  return and(eq(properties.organizationId, orgId), sql`${properties.status} != 'deleted'`) as SQL;
}

/** This org's deals, administrative rows excluded — getDeals' filter. */
function orgDeals(orgId: number): SQL {
  return and(eq(deals.organizationId, orgId), notInArray(deals.status, [...ADMINISTRATIVE_DEAL_STATUSES])) as SQL;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function n(v: unknown): number {
  return Number(v ?? 0);
}

/**
 * A Date bound inside raw sql`…`. node-pg formats a JS Date in the server's
 * LOCAL zone, while the column helpers (lt, gte, …) bind toISOString() — UTC.
 * The columns are `timestamp without time zone`, so off-UTC the two windows
 * would differ by the zone offset. Raw binds use the column helpers' form.
 */
function utc(d: Date): string {
  return d.toISOString();
}

// ── Leads ───────────────────────────────────────────────────────────────────

/**
 * The follow-up queue: open, contactable leads not contacted for 7+ days,
 * never-contacted first, then the longest since contact. The dashboard's
 * next-best-actions and Today's AI queue both show the top 3.
 */
export async function staleFollowUpLeads(orgId: number, now: Date, limit: number): Promise<Lead[]> {
  const cutoff = new Date(now.getTime() - 7 * DAY_MS);
  return db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, orgId),
        liveLead(),
        notInArray(leads.status, ["closed", "dead"]),
        sql`${leads.doNotContact} IS NOT TRUE`,
        or(sql`${leads.lastContactedAt} IS NULL`, lte(leads.lastContactedAt, cutoff)),
      ) as SQL,
    )
    .orderBy(sql`${leads.lastContactedAt} ASC NULLS FIRST`, desc(leads.createdAt))
    .limit(limit);
}

/**
 * Today's "stalled leads" (the hero badge and the brief): not closed, dead
 * or converted, and never contacted or last contacted before `before`.
 */
export async function stalledLeadCount(orgId: number, before: Date): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, orgId),
        liveLead(),
        notInArray(leads.status, ["closed", "dead", "converted"]),
        or(sql`${leads.lastContactedAt} IS NULL`, lt(leads.lastContactedAt, before)),
      ) as SQL,
    );
  return n(row?.c);
}

/** Does the org hold any live lead / any non-deleted property? (Today's has-any-data.) */
export async function bookPresence(orgId: number): Promise<{ hasLeads: boolean; hasProperties: boolean }> {
  const [[l], [p]] = await Promise.all([
    db.select({ c: count() }).from(leads).where(and(eq(leads.organizationId, orgId), liveLead())),
    db.select({ c: count() }).from(properties).where(orgProperties(orgId)),
  ]);
  return { hasLeads: n(l?.c) > 0, hasProperties: n(p?.c) > 0 };
}

/** The dashboard's lead anomalies: leads gone cold and leads created, this week vs last. */
export async function leadWeekOverWeek(
  orgId: number,
  now: Date,
): Promise<{ coldThisWeek: number; coldLastWeek: number; newThisWeek: number; newLastWeek: number }> {
  const oneWeekAgo = utc(new Date(now.getTime() - 7 * DAY_MS));
  const twoWeeksAgo = utc(new Date(now.getTime() - 14 * DAY_MS));
  const [row] = await db
    .select({
      coldThisWeek: sql<number>`count(*) filter (where ${leads.nurturingStage} = 'cold' and ${leads.updatedAt} >= ${oneWeekAgo})`,
      coldLastWeek: sql<number>`count(*) filter (where ${leads.nurturingStage} = 'cold' and ${leads.updatedAt} >= ${twoWeeksAgo} and ${leads.updatedAt} < ${oneWeekAgo})`,
      newThisWeek: sql<number>`count(*) filter (where ${leads.createdAt} >= ${oneWeekAgo})`,
      newLastWeek: sql<number>`count(*) filter (where ${leads.createdAt} >= ${twoWeeksAgo} and ${leads.createdAt} < ${oneWeekAgo})`,
    })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), liveLead()));
  return {
    coldThisWeek: n(row?.coldThisWeek),
    coldLastWeek: n(row?.coldLastWeek),
    newThisWeek: n(row?.newThisWeek),
    newLastWeek: n(row?.newLastWeek),
  };
}

/** TCPA stats: every live lead, and those with recorded consent. */
export async function tcpaLeadCounts(orgId: number): Promise<{ total: number; withConsent: number }> {
  const [row] = await db
    .select({
      total: count(),
      withConsent: sql<number>`count(*) filter (where ${leads.tcpaConsent} = true)`,
    })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), liveLead()));
  return { total: n(row?.total), withConsent: n(row?.withConsent) };
}

/**
 * The priority-action card's counts (GET /api/priority-action): responded
 * seller leads, uncontacted new leads older than `staleBefore`, overdue
 * notes, whether the org has any lead, and the newest accepted / in-escrow
 * deal.
 */
export async function topPriorityFigures(
  orgId: number,
  staleBefore: Date,
): Promise<{
  respondedSellers: number;
  staleNewLeads: number;
  totalLeads: number;
  overdueNotes: number;
  newestAcceptedDeal: { id: number; propertyId: number | null } | null;
}> {
  const [[leadRow], [noteRow], accepted] = await Promise.all([
    db
      .select({
        total: count(),
        respondedSellers: sql<number>`count(*) filter (where ${leads.status} = 'responded' and ${leads.type} = 'seller')`,
        staleNewLeads: sql<number>`count(*) filter (where ${leads.status} = 'new' and ${leads.createdAt} < ${utc(staleBefore)})`,
      })
      .from(leads)
      .where(and(eq(leads.organizationId, orgId), liveLead())),
    db
      .select({ c: count() })
      .from(notes)
      .where(
        and(
          eq(notes.organizationId, orgId),
          sql`(coalesce(${notes.daysDelinquent}, 0) > 0 OR ${notes.delinquencyStatus} IS DISTINCT FROM 'current')`,
        ) as SQL,
      ),
    db
      .select({ id: deals.id, propertyId: deals.propertyId })
      .from(deals)
      .where(and(orgDeals(orgId), inArray(deals.status, ["accepted", "in_escrow"])) as SQL)
      .orderBy(desc(deals.createdAt))
      .limit(1),
  ]);
  return {
    respondedSellers: n(leadRow?.respondedSellers),
    staleNewLeads: n(leadRow?.staleNewLeads),
    totalLeads: n(leadRow?.total),
    overdueNotes: n(noteRow?.c),
    newestAcceptedDeal: accepted[0] ?? null,
  };
}

/** Team KPIs over the last 30 days, and the book-wide close rate's two terms. */
export async function teamKpiFigures(
  orgId: number,
  since: Date,
): Promise<{ dealsClosedSince: number; leadsWorkedSince: number; totalLeads: number; closedDeals: number }> {
  const [[d], [l]] = await Promise.all([
    db
      .select({
        closed: sql<number>`count(*) filter (where ${deals.status} = 'closed')`,
        closedSince: sql<number>`count(*) filter (where ${deals.status} = 'closed' and coalesce(${deals.updatedAt}, ${deals.createdAt}) >= ${utc(since)})`,
      })
      .from(deals)
      .where(orgDeals(orgId)),
    db
      .select({
        total: count(),
        workedSince: sql<number>`count(*) filter (where coalesce(${leads.updatedAt}, ${leads.createdAt}) >= ${utc(since)})`,
      })
      .from(leads)
      .where(and(eq(leads.organizationId, orgId), liveLead())),
  ]);
  return {
    dealsClosedSince: n(d?.closedSince),
    leadsWorkedSince: n(l?.workedSince),
    totalLeads: n(l?.total),
    closedDeals: n(d?.closed),
  };
}

// ── Skip tracing ────────────────────────────────────────────────────────────

/** "This lead has a skip_traces row of this org in one of these statuses." */
function hasTraceIn(orgId: number, statuses: readonly string[]): SQL {
  return sql`exists (select 1 from ${skipTraces} where ${skipTraces.organizationId} = ${orgId} and ${skipTraces.leadId} = ${leads.id} and ${inArray(skipTraces.status, [...statuses])})`;
}

/**
 * The next skip-trace batch: live leads with NO finished trace row, newest
 * first, at most `cap` — and how many such leads exist in all. The claim
 * "every lead already has a finished skip trace" rests on that total.
 */
export async function untracedLeadBatch(
  orgId: number,
  cap: number,
  finishedStatuses: readonly string[],
): Promise<{ batch: Lead[]; untracedTotal: number }> {
  const notTraced = sql`not ${hasTraceIn(orgId, finishedStatuses)}`;
  const [batch, [total]] = await Promise.all([
    db
      .select()
      .from(leads)
      .where(and(eq(leads.organizationId, orgId), liveLead(), notTraced))
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(cap),
    db.select({ c: count() }).from(leads).where(and(eq(leads.organizationId, orgId), liveLead(), notTraced)),
  ]);
  return { batch, untracedTotal: n(total?.c) };
}

/** The per-lead grouping of this org's trace rows, as the stats join names it. */
const LEAD_TRACES = "lead_traces";

/**
 * Skip-trace stats' three counts over every live lead.
 *
 * One pass: this org's trace rows are grouped once per lead (bool_or of
 * "finished" and of "completed") and LEFT JOINed onto the live leads. Two
 * correlated EXISTS inside count(*) FILTER ran as a SubPlan per lead, and
 * skip_traces has no lead_id / organization_id index, so the read was
 * O(leads × traces). The counts are the reference model's
 * (deriveSkipTraceStats): a lead is traced when any of its rows finished,
 * found when any is "completed". The grouping yields at most one row per
 * lead, so the join never multiplies a lead.
 */
export async function skipTraceLeadCounts(
  orgId: number,
  finishedStatuses: readonly string[],
): Promise<{ totalLeads: number; tracedCount: number; foundCount: number }> {
  const leadTraces = new QueryBuilder()
    .select({
      leadId: skipTraces.leadId,
      traced: sql<boolean>`bool_or(${inArray(skipTraces.status, [...finishedStatuses])})`.as("traced"),
      found: sql<boolean>`bool_or(${eq(skipTraces.status, "completed")})`.as("found"),
    })
    .from(skipTraces)
    .where(and(eq(skipTraces.organizationId, orgId), isNotNull(skipTraces.leadId)))
    .groupBy(skipTraces.leadId)
    .as(LEAD_TRACES);
  const [row] = await db
    .select({
      total: count(),
      traced: sql<number>`count(*) filter (where ${sql.identifier(LEAD_TRACES)}.${sql.identifier("traced")})`,
      found: sql<number>`count(*) filter (where ${sql.identifier(LEAD_TRACES)}.${sql.identifier("found")})`,
    })
    .from(leads)
    .leftJoin(leadTraces, eq(leadTraces.leadId, leads.id))
    .where(and(eq(leads.organizationId, orgId), liveLead()));
  return { totalLeads: n(row?.total), tracedCount: n(row?.traced), foundCount: n(row?.found) };
}

// ── Properties ──────────────────────────────────────────────────────────────

/** Listings live the longest (oldest `updatedAt` first), at most `limit`. */
export async function oldestListedProperties(orgId: number, limit: number) {
  return db
    .select()
    .from(properties)
    .where(and(orgProperties(orgId), eq(properties.status, "listed"), isNotNull(properties.updatedAt)) as SQL)
    .orderBy(asc(properties.updatedAt))
    .limit(limit);
}

/**
 * The org's properties with coordinates inside a bounding box around a point
 * — the candidates a caller then measures exactly. The box is a little wider
 * than `radiusMiles` so the exact distance, not the box, decides.
 */
export async function propertiesNearPoint(
  orgId: number,
  lat: number,
  lng: number,
  radiusMiles: number,
  excludeId: number,
) {
  const dLat = (radiusMiles / 69) * 1.1;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const dLng = (radiusMiles / (69 * cosLat)) * 1.1;
  return db
    .select()
    .from(properties)
    .where(
      and(
        orgProperties(orgId),
        sql`${properties.id} <> ${excludeId}`,
        isNotNull(properties.latitude),
        isNotNull(properties.longitude),
        sql`${properties.latitude}::float8 between ${lat - dLat} and ${lat + dLat}`,
        sql`${properties.longitude}::float8 between ${lng - dLng} and ${lng + dLng}`,
      ) as SQL,
    );
}

/** Address / APN / county / state substring search, newest first, at most `limit`. */
export async function searchOrgParcels(orgId: number, q: string, limit: number) {
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  return db
    .select({
      id: properties.id,
      apn: properties.apn,
      address: properties.address,
      state: properties.state,
      county: properties.county,
      sizeAcres: properties.sizeAcres,
      latitude: properties.latitude,
      longitude: properties.longitude,
    })
    .from(properties)
    .where(
      and(
        orgProperties(orgId),
        or(
          ilike(properties.address, like),
          ilike(properties.apn, like),
          ilike(properties.county, like),
          ilike(properties.state, like),
        ),
      ) as SQL,
    )
    .orderBy(desc(properties.createdAt))
    .limit(limit);
}

/** Property count per (state, county), most properties first. */
export async function propertyCountsByCounty(
  orgId: number,
): Promise<Array<{ state: string; county: string; propertyCount: number }>> {
  const c = count();
  const rows = await db
    .select({ state: properties.state, county: properties.county, propertyCount: c })
    .from(properties)
    .where(
      and(
        orgProperties(orgId),
        sql`coalesce(${properties.state}, '') <> ''`,
        sql`coalesce(${properties.county}, '') <> ''`,
      ) as SQL,
    )
    .groupBy(properties.state, properties.county)
    .orderBy(desc(c), asc(properties.state), asc(properties.county));
  return rows.map((r) => ({ state: r.state, county: r.county, propertyCount: n(r.propertyCount) }));
}

/** Every property's due-diligence status (id, apn, status), newest first. */
export async function dueDiligenceStatusRows(orgId: number) {
  const rows = await readAllPages("properties", (afterId) =>
    db
      .select({
        id: properties.id,
        apn: properties.apn,
        dueDiligenceStatus: properties.dueDiligenceStatus,
        createdAt: properties.createdAt,
      })
      .from(properties)
      .where(and(orgProperties(orgId), gt(properties.id, afterId)) as SQL)
      .orderBy(asc(properties.id))
      .limit(WHOLE_BOOK_PAGE),
  );
  return newestFirst(rows);
}

/**
 * The newest `limit` properties (by id) that can be looked up but have no
 * parcel boundary yet — below `beforeId` when given, so repeated runs move
 * down the book instead of retrying the same newest failures forever — and
 * how many there are across the whole book, counted in SQL (W10.2b audits).
 */
export async function propertiesMissingParcelBoundary(orgId: number, limit: number, beforeId?: number) {
  const eligible = and(
    orgProperties(orgId),
    sql`(${properties.parcelBoundary} IS NULL OR ${properties.parcelBoundary} = 'null'::jsonb)`,
    sql`coalesce(${properties.apn}, '') <> ''`,
    sql`coalesce(${properties.state}, '') <> ''`,
    sql`coalesce(${properties.county}, '') <> ''`,
  ) as SQL;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(properties)
      .where(beforeId ? (and(eligible, lt(properties.id, beforeId)) as SQL) : eligible)
      .orderBy(desc(properties.id))
      .limit(Math.max(0, Math.floor(limit) || 0)),
    db.select({ total: count() }).from(properties).where(eligible),
  ]);
  return { rows, total: Number(total) };
}

/** The capped getters' order (createdAt desc), for whole-set reads paged by id. */
function newestFirst<T extends { id: number; createdAt: Date | null }>(rows: T[]): T[] {
  const t = (r: T) => (r.createdAt ? new Date(r.createdAt).getTime() : 0);
  return rows.sort((a, b) => t(b) - t(a) || b.id - a.id);
}

// ── Deals ───────────────────────────────────────────────────────────────────

/** Open offers (offer_sent / negotiating), newest first, at most `limit`. */
export async function newestPendingOfferDeals(orgId: number, limit: number) {
  return db
    .select()
    .from(deals)
    .where(and(orgDeals(orgId), inArray(deals.status, ["offer_sent", "negotiating"])) as SQL)
    .orderBy(desc(deals.createdAt))
    .limit(limit);
}

/** The most recently updated closed deal (personal bests checks it). */
export async function latestClosedDeal(orgId: number) {
  const [deal] = await db
    .select()
    .from(deals)
    .where(and(orgDeals(orgId), eq(deals.status, "closed")) as SQL)
    .orderBy(sql`${deals.updatedAt} DESC NULLS LAST`, desc(deals.createdAt))
    .limit(1);
  return deal;
}

/**
 * Closed deals whose closing date is on or after `since` — the dashboard's
 * velocity, quarter projection, revenue and trend windows all lie inside it.
 */
export async function closedDealsClosingSince(orgId: number, since: Date) {
  return db
    .select({
      status: deals.status,
      closingDate: deals.closingDate,
      acceptedAmount: deals.acceptedAmount,
      offerAmount: deals.offerAmount,
    })
    .from(deals)
    .where(and(orgDeals(orgId), eq(deals.status, "closed"), gte(deals.closingDate, since)) as SQL);
}

/** How many deals the org has, and whether any carries an offer or accepted amount. */
export async function dealPresence(orgId: number): Promise<{ dealCount: number; anyWithAmount: boolean }> {
  const [row] = await db
    .select({
      total: count(),
      withAmount: sql<number>`count(*) filter (where ${deals.acceptedAmount} is not null or ${deals.offerAmount} is not null)`,
    })
    .from(deals)
    .where(orgDeals(orgId));
  return { dealCount: n(row?.total), anyWithAmount: n(row?.withAmount) > 0 };
}
