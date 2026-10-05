/**
 * Whole-book counts, sums and bounded lists for the model-facing surfaces
 * (DEFECT-0171, W10.2b group E): Pax's tools (server/ai/tools.ts), the two MCP
 * servers (server/mcp/index.ts, server/mcp-server.ts), the VA daily briefing
 * (server/ai/vaService.ts) and Pax's system context
 * (server/services/aiContextAggregator.ts).
 *
 * Every one of those read `storage.getLeads / getProperties / getDeals /
 * getNotes` — newest first, stopped at 5,000 rows — and then told a model how
 * many leads, how much pipeline, how many overdue notes the customer had, or
 * filtered the capped list and so could not find an old lead with the status
 * asked for. These answer the same questions over the whole book, in SQL:
 *
 *   - the *Tallies functions are grouped aggregates (no LIMIT anywhere);
 *   - the list functions filter in SQL, order newest first in SQL and take a
 *     LIMIT the caller names, and the matching count comes from the same WHERE
 *     so a caller can say "N of TOTAL";
 *   - the comps read pages the whole matching set (wholeBookReads), refusing
 *     rather than truncating.
 *
 * Each statement carries the same predicates as the capped getter it replaces
 * (server/storage/{leadRepo,propertyRepo,dealRepo,noteRepo}.ts): org-scoped;
 * leads live (`liveLead()`); properties `status != 'deleted'`; deals outside
 * ADMINISTRATIVE_DEAL_STATUSES; notes unfiltered.
 */
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { deals, leads, notes, properties, type Deal, type Lead, type Note, type Property } from "@shared/schema";
import { ADMINISTRATIVE_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";
import { liveLead } from "./liveLeads";
import { readAllPages, WHOLE_BOOK_PAGE } from "./wholeBookReads";

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** A LIMIT the caller asked for, as a non-negative integer (never "no limit"). */
const rowLimit = (limit: number): number => {
  const n = Math.floor(Number(limit));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** `count(*) filter (where created_at > since)`, or 0 when no `since` is asked for. */
const createdSince = (column: typeof leads.createdAt | typeof properties.createdAt | typeof deals.createdAt, since?: Date) =>
  since ? sql<string>`count(*) filter (where ${gt(column, since)})` : sql<string>`0`;

const add = (acc: Record<string, number>, key: string, n: number) => {
  acc[key] = (acc[key] ?? 0) + n;
};

// ── Leads ──────────────────────────────────────────────────────────────────

export interface LeadTallies {
  total: number;
  /** Leads created after `since` (0 when no `since` was given). */
  createdSince: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}

export async function leadTallies(orgId: number, since?: Date): Promise<LeadTallies> {
  const rows = await db
    .select({
      status: leads.status,
      type: leads.type,
      n: count(),
      nSince: createdSince(leads.createdAt, since),
    })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), liveLead()))
    .groupBy(leads.status, leads.type);
  const out: LeadTallies = { total: 0, createdSince: 0, byStatus: {}, byType: {} };
  for (const r of rows) {
    const n = num(r.n);
    out.total += n;
    out.createdSince += num(r.nSince);
    add(out.byStatus, String(r.status), n);
    add(out.byType, String(r.type), n);
  }
  return out;
}

export interface LeadListFilter {
  status?: string;
  type?: string;
  /** Case-insensitive equality on `leads.state`. */
  state?: string;
  /** Case-insensitive substring of `leads.address`. */
  addressContains?: string;
  /** `coalesce(score, 0) >= minScore`. */
  minScore?: number;
  createdAfter?: Date;
}

function leadFilterConditions(f: LeadListFilter): SQL[] {
  const c: SQL[] = [];
  if (f.status) c.push(eq(leads.status, f.status));
  if (f.type) c.push(eq(leads.type, f.type));
  if (f.state) c.push(sql`upper(${leads.state}) = upper(${f.state})`);
  if (f.addressContains) c.push(sql`strpos(lower(${leads.address}), lower(${f.addressContains})) > 0`);
  if (f.minScore !== undefined && f.minScore !== null) c.push(sql`coalesce(${leads.score}, 0) >= ${f.minScore}`);
  if (f.createdAfter) c.push(gt(leads.createdAt, f.createdAfter));
  return c;
}

/** The newest `limit` live leads matching `f`, newest first — ordered and limited in SQL. */
export async function listLeadsNewestFirst(orgId: number, f: LeadListFilter, limit: number): Promise<Lead[]> {
  return db
    .select()
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), liveLead(), ...leadFilterConditions(f)))
    .orderBy(desc(leads.createdAt), desc(leads.id))
    .limit(rowLimit(limit));
}

/** How many live leads match `f` — the whole book. */
async function countLeadsMatching(orgId: number, f: LeadListFilter): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), liveLead(), ...leadFilterConditions(f)));
  return num(row?.n);
}

export async function pageLeadsNewestFirst(orgId: number, f: LeadListFilter, limit: number) {
  const [rows, total] = await Promise.all([listLeadsNewestFirst(orgId, f, limit), countLeadsMatching(orgId, f)]);
  return { rows, total };
}

/**
 * Leads not contacted since `cutoff` and not closed/dead — the stalest first
 * (by last contact, else creation), `limit` of them, plus the whole-book count.
 * A lead with neither date is stale; it sorts last, as the in-memory sort did.
 */
export async function staleLeadsPage(orgId: number, cutoff: Date, limit: number): Promise<{ rows: Lead[]; total: number }> {
  const stale = () =>
    and(
      notInArray(leads.status, ["closed", "dead"]),
      or(
        and(isNotNull(leads.lastContactedAt), lt(leads.lastContactedAt, cutoff)),
        and(isNull(leads.lastContactedAt), or(isNull(leads.createdAt), lt(leads.createdAt, cutoff))),
      ),
    );
  const [rows, [countRow]] = await Promise.all([
    db
      .select()
      .from(leads)
      .where(and(eq(leads.organizationId, orgId), liveLead(), stale()))
      .orderBy(sql`coalesce(${leads.lastContactedAt}, ${leads.createdAt}) asc nulls last`, asc(leads.id))
      .limit(rowLimit(limit)),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(eq(leads.organizationId, orgId), liveLead(), stale())),
  ]);
  return { rows, total: num(countRow?.n) };
}

// ── Properties ─────────────────────────────────────────────────────────────

export interface PropertyTallies {
  total: number;
  createdSince: number;
  byStatus: Record<string, number>;
  totalAcres: number;
  totalMarketValue: number;
}

export async function propertyTallies(orgId: number, since?: Date): Promise<PropertyTallies> {
  const rows = await db
    .select({
      status: properties.status,
      n: count(),
      nSince: createdSince(properties.createdAt, since),
      acres: sql<string>`coalesce(sum(${properties.sizeAcres}), 0)`,
      marketValue: sql<string>`coalesce(sum(${properties.marketValue}), 0)`,
    })
    .from(properties)
    .where(and(eq(properties.organizationId, orgId), ne(properties.status, "deleted")))
    .groupBy(properties.status);
  const out: PropertyTallies = { total: 0, createdSince: 0, byStatus: {}, totalAcres: 0, totalMarketValue: 0 };
  for (const r of rows) {
    const n = num(r.n);
    out.total += n;
    out.createdSince += num(r.nSince);
    add(out.byStatus, String(r.status), n);
    out.totalAcres += num(r.acres);
    out.totalMarketValue += num(r.marketValue);
  }
  return out;
}

export interface PropertyListFilter {
  status?: string;
  /** Case-insensitive equality on `properties.state`. */
  state?: string;
  /** Case-insensitive substring of `properties.county`. */
  countyContains?: string;
  createdAfter?: Date;
}

function propertyFilterConditions(f: PropertyListFilter): SQL[] {
  const c: SQL[] = [];
  if (f.status) c.push(eq(properties.status, f.status));
  if (f.state) c.push(sql`upper(${properties.state}) = upper(${f.state})`);
  if (f.countyContains) c.push(sql`strpos(lower(${properties.county}), lower(${f.countyContains})) > 0`);
  if (f.createdAfter) c.push(gt(properties.createdAt, f.createdAfter));
  return c;
}

export async function listPropertiesNewestFirst(orgId: number, f: PropertyListFilter, limit: number): Promise<Property[]> {
  return db
    .select()
    .from(properties)
    .where(and(eq(properties.organizationId, orgId), ne(properties.status, "deleted"), ...propertyFilterConditions(f)))
    .orderBy(desc(properties.createdAt), desc(properties.id))
    .limit(rowLimit(limit));
}

async function countPropertiesMatching(orgId: number, f: PropertyListFilter): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(properties)
    .where(and(eq(properties.organizationId, orgId), ne(properties.status, "deleted"), ...propertyFilterConditions(f)));
  return num(row?.n);
}

export async function pagePropertiesNewestFirst(orgId: number, f: PropertyListFilter, limit: number) {
  const [rows, total] = await Promise.all([listPropertiesNewestFirst(orgId, f, limit), countPropertiesMatching(orgId, f)]);
  return { rows, total };
}

/** Statuses run_comps treats as internal comparables. */
const INTERNAL_COMP_STATUSES = ["sold", "listed", "owned"] as const;

/**
 * Every internal comparable for a subject property: same county and state,
 * a comp status, some price, not the subject. Read whole (keyset-paged,
 * refusing past the whole-book ceiling) because a median needs every comp;
 * returned newest first, the order run_comps lists them in.
 */
export async function internalCompCandidates(
  orgId: number,
  subject: { id: number; county: string; state: string },
): Promise<Property[]> {
  const rows = await readAllPages("properties", (afterId) =>
    db
      .select()
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, orgId),
          ne(properties.status, "deleted"),
          eq(properties.county, subject.county),
          eq(properties.state, subject.state),
          inArray(properties.status, [...INTERNAL_COMP_STATUSES]),
          ne(properties.id, subject.id),
          or(isNotNull(properties.listPrice), isNotNull(properties.soldPrice), isNotNull(properties.marketValue)),
          gt(properties.id, afterId),
        ),
      )
      .orderBy(asc(properties.id))
      .limit(WHOLE_BOOK_PAGE),
  );
  const t = (p: Property) => (p.createdAt ? new Date(p.createdAt).getTime() : Number.NEGATIVE_INFINITY);
  return rows.sort((a, b) => t(b) - t(a) || b.id - a.id);
}

// ── Deals ──────────────────────────────────────────────────────────────────

export interface DealTallies {
  total: number;
  createdSince: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  /** sum(offer_amount) — nulls count 0. */
  offerSum: number;
  /** sum(coalesce(offer_amount, accepted_amount)). */
  offerElseAcceptedSum: number;
  /** sum(coalesce(accepted_amount, offer_amount)), per status. */
  acceptedElseOfferSumByStatus: Record<string, number>;
}

export async function dealTallies(orgId: number, since?: Date): Promise<DealTallies> {
  const rows = await db
    .select({
      status: deals.status,
      type: deals.type,
      n: count(),
      nSince: createdSince(deals.createdAt, since),
      offer: sql<string>`coalesce(sum(${deals.offerAmount}), 0)`,
      offerElseAccepted: sql<string>`coalesce(sum(coalesce(${deals.offerAmount}, ${deals.acceptedAmount})), 0)`,
      acceptedElseOffer: sql<string>`coalesce(sum(coalesce(${deals.acceptedAmount}, ${deals.offerAmount})), 0)`,
    })
    .from(deals)
    .where(and(eq(deals.organizationId, orgId), notInArray(deals.status, [...ADMINISTRATIVE_DEAL_STATUSES])))
    .groupBy(deals.status, deals.type);
  const out: DealTallies = {
    total: 0,
    createdSince: 0,
    byStatus: {},
    byType: {},
    offerSum: 0,
    offerElseAcceptedSum: 0,
    acceptedElseOfferSumByStatus: {},
  };
  for (const r of rows) {
    const n = num(r.n);
    out.total += n;
    out.createdSince += num(r.nSince);
    add(out.byStatus, String(r.status), n);
    add(out.byType, String(r.type), n);
    out.offerSum += num(r.offer);
    out.offerElseAcceptedSum += num(r.offerElseAccepted);
    add(out.acceptedElseOfferSumByStatus, String(r.status), num(r.acceptedElseOffer));
  }
  return out;
}

export interface DealListFilter {
  status?: string;
  type?: string;
  createdAfter?: Date;
}

function dealFilterConditions(f: DealListFilter): SQL[] {
  const c: SQL[] = [];
  if (f.status) c.push(eq(deals.status, f.status));
  if (f.type) c.push(eq(deals.type, f.type));
  if (f.createdAfter) c.push(gt(deals.createdAt, f.createdAfter));
  return c;
}

export async function listDealsNewestFirst(orgId: number, f: DealListFilter, limit: number): Promise<Deal[]> {
  return db
    .select()
    .from(deals)
    .where(and(eq(deals.organizationId, orgId), notInArray(deals.status, [...ADMINISTRATIVE_DEAL_STATUSES]), ...dealFilterConditions(f)))
    .orderBy(desc(deals.createdAt), desc(deals.id))
    .limit(rowLimit(limit));
}

async function countDealsMatching(orgId: number, f: DealListFilter): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(deals)
    .where(and(eq(deals.organizationId, orgId), notInArray(deals.status, [...ADMINISTRATIVE_DEAL_STATUSES]), ...dealFilterConditions(f)));
  return num(row?.n);
}

export async function pageDealsNewestFirst(orgId: number, f: DealListFilter, limit: number) {
  const [rows, total] = await Promise.all([listDealsNewestFirst(orgId, f, limit), countDealsMatching(orgId, f)]);
  return { rows, total };
}

// ── Notes ──────────────────────────────────────────────────────────────────

export interface NoteStatusTally {
  count: number;
  currentBalance: number;
  monthlyPayment: number;
  originalPrincipal: number;
  /** Notes whose next payment date is before `asOf`. */
  pastDue: number;
}

export interface NoteTallies {
  total: number;
  totalOriginalPrincipal: number;
  byStatus: Record<string, NoteStatusTally>;
}

export async function noteTallies(orgId: number, asOf: Date): Promise<NoteTallies> {
  const rows = await db
    .select({
      status: notes.status,
      n: count(),
      balance: sql<string>`coalesce(sum(${notes.currentBalance}), 0)`,
      monthly: sql<string>`coalesce(sum(${notes.monthlyPayment}), 0)`,
      principal: sql<string>`coalesce(sum(${notes.originalPrincipal}), 0)`,
      pastDue: sql<string>`count(*) filter (where ${lt(notes.nextPaymentDate, asOf)})`,
    })
    .from(notes)
    .where(eq(notes.organizationId, orgId))
    .groupBy(notes.status);
  const out: NoteTallies = { total: 0, totalOriginalPrincipal: 0, byStatus: {} };
  for (const r of rows) {
    const t: NoteStatusTally = {
      count: num(r.n),
      currentBalance: num(r.balance),
      monthlyPayment: num(r.monthly),
      originalPrincipal: num(r.principal),
      pastDue: num(r.pastDue),
    };
    out.byStatus[String(r.status)] = t;
    out.total += t.count;
    out.totalOriginalPrincipal += t.originalPrincipal;
  }
  return out;
}

/** The empty tally for a status with no notes. */
export const NO_NOTES: NoteStatusTally = Object.freeze({
  count: 0,
  currentBalance: 0,
  monthlyPayment: 0,
  originalPrincipal: 0,
  pastDue: 0,
});

export interface NoteListFilter {
  status?: string;
}

export async function listNotesNewestFirst(orgId: number, f: NoteListFilter, limit: number): Promise<Note[]> {
  return db
    .select()
    .from(notes)
    .where(and(eq(notes.organizationId, orgId), f.status ? eq(notes.status, f.status) : undefined))
    .orderBy(desc(notes.createdAt), desc(notes.id))
    .limit(rowLimit(limit));
}

async function countNotesMatching(orgId: number, f: NoteListFilter): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notes)
    .where(and(eq(notes.organizationId, orgId), f.status ? eq(notes.status, f.status) : undefined));
  return num(row?.n);
}

export async function pageNotesNewestFirst(orgId: number, f: NoteListFilter, limit: number) {
  const [rows, total] = await Promise.all([listNotesNewestFirst(orgId, f, limit), countNotesMatching(orgId, f)]);
  return { rows, total };
}
