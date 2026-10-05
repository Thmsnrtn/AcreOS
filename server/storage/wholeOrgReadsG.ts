/**
 * Whole-org figures and row sets for alerts, agents, digests, the nurturer,
 * the sample seeder and the month-in-review email (DEFECT-0171, group G).
 *
 * Each of these read storage.getLeads / getProperties / getDeals / getNotes —
 * newest first, stopped at 5,000 rows — and then counted, summed, claimed or
 * acted on the result. Past 5,000 rows the oldest records were silently
 * missing: an alert said "62% of leads are cold" about the newest 5,000, the
 * aging sweep never looked at the oldest (stalest) leads at all, and clearing
 * "Try with sample data" — the OLDEST rows in a grown book — could not find
 * the sample rows it was asked to remove.
 *
 * Every function here is org-scoped, reads leads live (`liveLead()`), and
 * applies the same filters as the capped getter it replaces: properties
 * exclude status 'deleted', deals exclude ADMINISTRATIVE_DEAL_STATUSES, notes
 * carry no extra filter. Counts and sums are SQL aggregates; a caller that
 * needs ROWS gets every matching row in keyset pages, refused (never cut
 * short) past a ceiling — or, where the caller only ever shows or acts on
 * the top few (mostUrgentAgingLeads), an explicit ORDER BY + LIMIT beside a
 * whole-book count.
 *
 * Deliberately imports nothing from services/onboarding (wholeBookReads does,
 * via sampleFilters → sampleSeeder): the sample seeder imports this file, and
 * a cycle there would evaluate sampleFilters before the seeder's constants
 * exist.
 */
import { and, asc, count, eq, gt, gte, inArray, isNull, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { deals, leads, notes, properties, type Deal, type Note } from "@shared/schema";
import { ADMINISTRATIVE_DEAL_STATUSES, TERMINAL_LEAD_STATUSES } from "@shared/lifecycle/pipeline-status";
import { liveLead } from "./liveLeads";
// Type-only (erased at runtime): no import cycle with the nurturer, which imports this file.
import type { LeadScoreInput } from "../services/leadNurturer";
// readCeiling imports nothing, so it is safe here (see the cycle note above).
import { READ_ROW_CEILING, ReadCeilingError } from "./readCeiling";

const PAGE = 1000;
const DAY_MS = 86_400_000;

/*
 * Timestamps in raw sql`` are bound as ISO strings (`d.toISOString()`), never
 * as Date objects: node-pg formats a bare Date in the PROCESS's local zone,
 * while the column helpers (gt/lte/…) bind UTC ISO, and these columns are
 * `timestamp without time zone`. A bare Date would shift every cutoff by the
 * server's UTC offset.
 */

/** Page an id-keyed read to the end; refuse past the ceiling rather than cut it short. */
async function pageAll<T extends { id: number }>(kind: string, page: (afterId: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  let afterId = 0;
  for (;;) {
    const rows = await page(afterId);
    out.push(...rows);
    if (out.length > READ_ROW_CEILING) throw new ReadCeilingError(kind);
    if (rows.length < PAGE) return out;
    afterId = rows[rows.length - 1].id;
  }
}

const num = (v: unknown) => Number(v ?? 0);

/** The predicate getDeals applies: not an administrative (soft-deleted) deal. */
const listedDeal = () => notInArray(deals.status, [...ADMINISTRATIVE_DEAL_STATUSES]);
/** The predicate getProperties applies: not soft-deleted. */
const listedProperty = () => sql`${properties.status} != 'deleted'`;
/** `lead.nurturingStage || 'new'`, in SQL. */
const leadStage = sql<string>`coalesce(nullif(${leads.nurturingStage}, ''), 'new')`;

// ─── Leads ──────────────────────────────────────────────────────────────────

export interface LeadStageFigures {
  total: number;
  /** Live leads per nurturing stage (an empty or null stage reads 'new'). */
  byStage: Record<string, number>;
  scoreSum: number;
  scoredCount: number;
  /** Live leads whose nextFollowUpAt is at or before `now`. */
  followUpDue: number;
}

/** Stage counts, score totals and due follow-ups over every live lead. */
export async function leadStageFigures(orgId: number, now: Date = new Date()): Promise<LeadStageFigures> {
  const rows = await db
    .select({
      stage: leadStage,
      n: count(),
      scoreSum: sql<string>`coalesce(sum(${leads.score}), 0)`,
      scored: sql<string>`count(${leads.score})`,
      due: sql<string>`count(*) filter (where ${leads.nextFollowUpAt} <= ${now.toISOString()})`,
    })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), liveLead()))
    .groupBy(leadStage);
  const out: LeadStageFigures = { total: 0, byStage: {}, scoreSum: 0, scoredCount: 0, followUpDue: 0 };
  for (const r of rows) {
    const n = num(r.n);
    out.total += n;
    out.byStage[String(r.stage)] = (out.byStage[String(r.stage)] ?? 0) + n;
    out.scoreSum += num(r.scoreSum);
    out.scoredCount += num(r.scored);
    out.followUpDue += num(r.due);
  }
  return out;
}

/** Not a terminal (closed / dead) status; a null status is not terminal. */
const notTerminalLead = () =>
  sql`(${leads.status} IS NULL OR ${leads.status} NOT IN (${sql.join(TERMINAL_LEAD_STATUSES.map((s) => sql`${s}`), sql`, `)}))`;
const lastTouch = sql`coalesce(${leads.lastContactedAt}, ${leads.createdAt})`;

export type AgingUrgency = "urgent" | "warning" | "info";
const URGENCY_BY_RANK: AgingUrgency[] = ["urgent", "warning", "info"];

/**
 * A lead's aging urgency as a rank — 0 urgent (hot, untouched ≥3 days),
 * 1 warning (warm, ≥7 days), 2 info (any stage, ≥14 days), NULL when not
 * aging. The same if/else order alerting.ts graded in memory; no last touch
 * at all reads as stalest. "≥ N whole days" is "last touch ≤ now − N days".
 */
function agingRank(now: Date) {
  const untouchedFor = (days: number) =>
    sql`(${lastTouch} IS NULL OR ${lastTouch} <= ${new Date(now.getTime() - days * DAY_MS).toISOString()})`;
  return sql<number | null>`(case when ${leadStage} = 'hot' and ${untouchedFor(3)} then 0 when ${leadStage} = 'warm' and ${untouchedFor(7)} then 1 when ${untouchedFor(14)} then 2 end)`;
}

/** Aging (any urgency), not terminal, not one of `excludeIds`. Org and live are inline at each statement. */
const agingOnly = (now: Date, excludeIds: number[]) =>
  and(
    notTerminalLead(),
    sql`${agingRank(now)} IS NOT NULL`,
    excludeIds.length > 0 ? notInArray(leads.id, excludeIds) : undefined,
  );

/**
 * The `limit` most urgent aging leads — urgent before warning before info,
 * stalest first within each — chosen in SQL over every live, non-terminal
 * lead. A bounded list: the whole-book count is agingLeadCount.
 */
export async function mostUrgentAgingLeads(
  orgId: number,
  opts: { limit: number; now?: Date; excludeIds?: number[] },
): Promise<Array<{
  id: number;
  firstName: string;
  lastName: string | null;
  nurturingStage: string;
  score: number | null;
  lastTouch: Date | null;
  urgency: AgingUrgency;
}>> {
  const now = opts.now ?? new Date();
  const rank = agingRank(now);
  const rows = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      nurturingStage: leadStage,
      score: leads.score,
      lastContactedAt: leads.lastContactedAt,
      createdAt: leads.createdAt,
      rank,
    })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), liveLead(), agingOnly(now, opts.excludeIds ?? [])))
    .orderBy(asc(rank), sql`${lastTouch} asc nulls first`, asc(leads.id))
    .limit(opts.limit);
  return rows.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    nurturingStage: String(r.nurturingStage),
    score: r.score,
    lastTouch: r.lastContactedAt ?? r.createdAt ?? null,
    // Never null here: the WHERE keeps only ranked (aging) leads.
    urgency: URGENCY_BY_RANK[num(r.rank)],
  }));
}

/** How many live, non-terminal leads are aging (any urgency), over the whole book. */
export async function agingLeadCount(orgId: number, now: Date = new Date(), excludeIds: number[] = []): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), liveLead(), agingOnly(now, excludeIds)));
  return num(row?.n);
}

/** Exactly the scorer's inputs (+ id): a new input fails to compile here until selected. */
const FOCUS_SCORE_COLUMNS = {
  id: leads.id,
  createdAt: leads.createdAt,
  lastContactedAt: leads.lastContactedAt,
  responses: leads.responses,
  emailOpens: leads.emailOpens,
  emailClicks: leads.emailClicks,
  source: leads.source,
  status: leads.status,
} satisfies Record<keyof LeadScoreInput | "id", unknown>;

/**
 * The focus list's candidates: every live lead not contacted since
 * `contactedBefore` (or never) — the one part of its filter that does not
 * depend on the computed score — with only the columns
 * leadNurturerService.calculateLeadScore reads. The caller scores them and
 * reads the full rows of its top ten by id.
 */
export function focusLeadCandidates(orgId: number, contactedBefore: Date) {
  return pageAll("focus-list leads", (afterId) =>
    db.select(FOCUS_SCORE_COLUMNS).from(leads)
      .where(
        and(
          eq(leads.organizationId, orgId),
          liveLead(),
          or(isNull(leads.lastContactedAt), lt(leads.lastContactedAt, contactedBefore)),
          gt(leads.id, afterId),
        ) as SQL,
      )
      .orderBy(asc(leads.id))
      .limit(PAGE),
  );
}

/** The weekly digest's lead figures over every live lead. */
export async function digestLeadFigures(orgId: number, since: Date): Promise<{
  newCount: number;
  newBySource: Array<{ source: string; count: number }>;
  scoredSince: number;
}> {
  const source = sql<string>`coalesce(nullif(${leads.source}, ''), 'unknown')`;
  const bySource = await db
    .select({ source, n: count() })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), liveLead(), gte(leads.createdAt, since)))
    .groupBy(source);
  const [scored] = await db
    .select({ n: count() })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), liveLead(), gte(leads.lastScoreAt, since)));
  const newBySource = bySource.map((r) => ({ source: String(r.source), count: num(r.n) }));
  return {
    newCount: newBySource.reduce((s, r) => s + r.count, 0),
    newBySource,
    scoredSince: num(scored?.n),
  };
}

/** Every live lead carrying the sample marker source (id, email, source). */
export function sampleLeadRows(orgId: number, sampleSource: string) {
  return pageAll("sample leads", (afterId) =>
    db.select({ id: leads.id, email: leads.email, source: leads.source }).from(leads)
      .where(and(eq(leads.organizationId, orgId), liveLead(), eq(leads.source, sampleSource), gt(leads.id, afterId)) as SQL)
      .orderBy(asc(leads.id))
      .limit(PAGE),
  );
}

// ─── Properties ─────────────────────────────────────────────────────────────

/** Every listed property whose APN starts with the sample prefix (id, apn). */
export function samplePropertyRows(orgId: number, apnPrefix: string) {
  return pageAll("sample properties", (afterId) =>
    db.select({ id: properties.id, apn: properties.apn }).from(properties)
      .where(
        and(
          eq(properties.organizationId, orgId),
          listedProperty(),
          sql`starts_with(${properties.apn}, ${apnPrefix})`,
          gt(properties.id, afterId),
        ) as SQL,
      )
      .orderBy(asc(properties.id))
      .limit(PAGE),
  );
}

/**
 * Listed properties in one county: how many, and the mean market value of
 * those that carry one (null when none do). State matches case-insensitively
 * upper-cased, county lower-cased — as the in-memory filter did.
 */
export async function countyPropertyFigures(orgId: number, state: string, county: string): Promise<{
  count: number;
  avgMarketValue: number | null;
}> {
  const [row] = await db
    .select({ n: count(), avg: sql<string | null>`avg(${properties.marketValue})` })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, orgId),
        listedProperty(),
        sql`upper(${properties.state}) = ${state.toUpperCase()}`,
        sql`lower(${properties.county}) = ${county.toLowerCase()}`,
      ),
    );
  const avg = row?.avg == null ? null : Number(row.avg);
  return { count: num(row?.n), avgMarketValue: avg != null && Number.isFinite(avg) ? avg : null };
}

/** Totals for the operations agent's digest: live leads, listed properties, open deals. */
export async function bookSummaryCounts(orgId: number): Promise<{
  totalLeads: number;
  activeLeads: number;
  totalProperties: number;
  activeDeals: number;
}> {
  const [l] = await db
    .select({ n: count(), active: sql<string>`count(*) filter (where ${leads.status} in ('active', 'new'))` })
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), liveLead()));
  const [p] = await db.select({ n: count() }).from(properties).where(and(eq(properties.organizationId, orgId), listedProperty()));
  const [d] = await db
    .select({ n: count() })
    .from(deals)
    .where(and(eq(deals.organizationId, orgId), listedDeal(), notInArray(deals.status, ["closed_won", "closed_lost"])));
  return { totalLeads: num(l?.n), activeLeads: num(l?.active), totalProperties: num(p?.n), activeDeals: num(d?.n) };
}

// ─── Deals ──────────────────────────────────────────────────────────────────

/** Every listed deal on one of these properties (id, propertyId, type). */
export async function dealsOnProperties(orgId: number, propertyIds: number[]) {
  const ids = [...new Set(propertyIds)];
  if (ids.length === 0) return [];
  return pageAll("deals", (afterId) =>
    db.select({ id: deals.id, propertyId: deals.propertyId, type: deals.type }).from(deals)
      .where(and(eq(deals.organizationId, orgId), listedDeal(), inArray(deals.propertyId, ids), gt(deals.id, afterId)) as SQL)
      .orderBy(asc(deals.id))
      .limit(PAGE),
  );
}

/** Every listed deal closed (status 'closed') with a closing date in [from, to]; newest first. */
export async function dealsClosedBetween(orgId: number, from: Date, to: Date): Promise<Deal[]> {
  const rows = await pageAll("closed deals", (afterId) =>
    db.select().from(deals)
      .where(
        and(
          eq(deals.organizationId, orgId),
          listedDeal(),
          eq(deals.status, "closed"),
          gte(deals.closingDate, from),
          lte(deals.closingDate, to),
          gt(deals.id, afterId),
        ) as SQL,
      )
      .orderBy(asc(deals.id))
      .limit(PAGE),
  );
  return rows.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta || b.id - a.id;
  });
}

/** Listed deals not closed or cancelled: how many, and the sum of their offers. */
export async function openPipelineTotals(orgId: number): Promise<{ count: number; offerSum: number }> {
  const [row] = await db
    .select({ n: count(), offers: sql<string>`coalesce(sum(${deals.offerAmount}), 0)` })
    .from(deals)
    .where(and(eq(deals.organizationId, orgId), listedDeal(), notInArray(deals.status, ["closed", "cancelled"])));
  return { count: num(row?.n), offerSum: num(row?.offers) };
}

// ─── Notes ──────────────────────────────────────────────────────────────────

/**
 * Notes paid off or defaulted since `since` (a note with no updatedAt counts,
 * as the in-memory filter treated it as "now"): how many, and their monthly
 * payments.
 */
export async function recentlyInactiveNoteTotals(orgId: number, since: Date): Promise<{ count: number; monthlyLost: number }> {
  const [row] = await db
    .select({ n: count(), monthly: sql<string>`coalesce(sum(${notes.monthlyPayment}), 0)` })
    .from(notes)
    .where(
      and(
        eq(notes.organizationId, orgId),
        inArray(notes.status, ["paid_off", "defaulted"]),
        sql`(${notes.updatedAt} IS NULL OR ${notes.updatedAt} >= ${since.toISOString()})`,
      ),
    );
  return { count: num(row?.n), monthlyLost: num(row?.monthly) };
}

/** Ids of every note delinquent for at most one day (daysDelinquent set, non-zero, ≤ 1). */
export async function newlyDelinquentNoteIds(orgId: number): Promise<number[]> {
  const rows = await pageAll("newly delinquent notes", (afterId) =>
    db.select({ id: notes.id }).from(notes)
      .where(
        and(
          eq(notes.organizationId, orgId),
          sql`${notes.daysDelinquent} IS NOT NULL AND ${notes.daysDelinquent} <> 0 AND ${notes.daysDelinquent} <= 1`,
          gt(notes.id, afterId),
        ) as SQL,
      )
      .orderBy(asc(notes.id))
      .limit(PAGE),
  );
  return rows.map((r) => r.id);
}

/** Active notes, and notes seriously delinquent or default candidates with their balance. */
export async function noteRiskTotals(orgId: number): Promise<{ activeCount: number; atRiskCount: number; atRiskBalance: number }> {
  const atRisk = sql`${notes.delinquencyStatus} in ('seriously_delinquent', 'default_candidate')`;
  const [row] = await db
    .select({
      active: sql<string>`count(*) filter (where ${notes.status} = 'active')`,
      atRisk: sql<string>`count(*) filter (where ${atRisk})`,
      balance: sql<string>`coalesce(sum(${notes.currentBalance}) filter (where ${atRisk}), 0)`,
    })
    .from(notes)
    .where(eq(notes.organizationId, orgId));
  return { activeCount: num(row?.active), atRiskCount: num(row?.atRisk), atRiskBalance: num(row?.balance) };
}

/** Every active note whose next payment date is a full day or more past `asOf`. */
export function pastDueActiveNotes(orgId: number, asOf: Date = new Date()): Promise<Note[]> {
  const dueBy = new Date(asOf.getTime() - 86_400_000);
  return pageAll("past-due notes", (afterId) =>
    db.select().from(notes)
      .where(
        and(
          eq(notes.organizationId, orgId),
          eq(notes.status, "active"),
          lte(notes.nextPaymentDate, dueBy),
          gt(notes.id, afterId),
        ) as SQL,
      )
      .orderBy(asc(notes.id))
      .limit(PAGE),
  );
}

/** Notes with days delinquent > 0: how many, and their current balance. */
export async function delinquentNoteTotals(orgId: number): Promise<{ count: number; atRiskBalance: number }> {
  const [row] = await db
    .select({ n: count(), balance: sql<string>`coalesce(sum(${notes.currentBalance}), 0)` })
    .from(notes)
    .where(and(eq(notes.organizationId, orgId), sql`coalesce(${notes.daysDelinquent}, 0) > 0`));
  return { count: num(row?.n), atRiskBalance: num(row?.balance) };
}

/** The month-in-review note figures over every active note. */
export async function activeNoteReviewFigures(orgId: number): Promise<{
  activeCount: number;
  monthlyIncome: number;
  currentCount: number;
  interestRateSum: number;
}> {
  const [row] = await db
    .select({
      n: count(),
      monthly: sql<string>`coalesce(sum(${notes.monthlyPayment}), 0)`,
      current: sql<string>`count(*) filter (where coalesce(${notes.delinquencyStatus}, '') in ('current', ''))`,
      rates: sql<string>`coalesce(sum(${notes.interestRate}), 0)`,
    })
    .from(notes)
    .where(and(eq(notes.organizationId, orgId), eq(notes.status, "active")));
  return {
    activeCount: num(row?.n),
    monthlyIncome: num(row?.monthly),
    currentCount: num(row?.current),
    interestRateSum: num(row?.rates),
  };
}

/** Every note on one of these properties (id, propertyId, originalPrincipal). */
export async function notesOnProperties(orgId: number, propertyIds: number[]) {
  const ids = [...new Set(propertyIds)];
  if (ids.length === 0) return [];
  return pageAll("notes", (afterId) =>
    db.select({ id: notes.id, propertyId: notes.propertyId, originalPrincipal: notes.originalPrincipal }).from(notes)
      .where(and(eq(notes.organizationId, orgId), inArray(notes.propertyId, ids), gt(notes.id, afterId)) as SQL)
      .orderBy(asc(notes.id))
      .limit(PAGE),
  );
}
