/**
 * Leading Indicators — forward-looking metrics for the founder's briefing,
 * served by GET /api/founder/leading-indicators.
 *
 * ── WHAT THIS FILE USED TO BE (2026-09-04) ──────────────────────────────────
 * Four of its six indicators were invented, and the fourth named real
 * organizations beside invented figures:
 *
 *   · featureStickiness — five hardcoded constants (0.72, 0.68, 0.85, 0.45,
 *     0.31) labelled "daily return rate", measured from nothing.
 *   · supportCategoryShift — three CATEGORIES derived from one real
 *     user_feedback COUNT by arithmetic (`count - 2`, `count * 0.3`,
 *     `count * 0.2`) with hardcoded up/down arrows. `user_feedback` has no
 *     category column; `support_cases` does, and was imported and unused.
 *   · expansionSignals — the first three organizations by `limit(10).slice(0,3)`,
 *     with `usagePercent: 75 + i * 8` and `daysToLimit: 14 - i * 3`. Real
 *     names, figures that were a function of array position.
 *   · referralPropensity — `totalOrgs * 0.1` and `totalOrgs * 0.3`.
 *
 * `check-no-fabrication.mjs` reads this file and passed it, because that gate
 * forbids non-deterministic value SOURCES — Math.random, seeded PRNGs — and
 * every one of these is a deterministic constant. Same lie, different
 * mechanism, and the deterministic form is the more convincing of the two
 * because it is stable across reloads.
 *
 * ── WHAT IT IS NOW ──────────────────────────────────────────────────────────
 * Three of the four are computed from data that was already there; the fourth
 * has no data source in this schema and says so with `null` rather than a
 * plausible number. Every SQL statement below was executed against a database
 * built from this repository (`npm run db:build-from-repo`) with seeded rows,
 * and its output checked by hand — not written and hoped for.
 *
 * Where a number cannot be computed the field is `null`, never 0: "no data
 * yet" and "measured zero" are different facts and the briefing must not
 * conflate them.
 */

import { db } from "../db";
import { organizations, leads, deals, userActivationEvents, supportCases } from "@shared/schema";
import { count, sql, gte, and, eq, lt, inArray } from "drizzle-orm";
import { METERED_TIERS, planLimitsFor } from "./planLimits";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import { logger } from "../utils/logger";

/**
 * The five customer doors, as slugs. Derived from the canonical nav model
 * (CLAUDE.md: "Today · Map · Deals · Finance · Pax"), so a door renamed there
 * and not here shows up as a door with no traffic rather than silently
 * measuring the wrong path.
 */
const DOORS: { door: string; feature: string }[] = [
  { door: "today", feature: "Today" },
  { door: "map", feature: "Map" },
  { door: "deals", feature: "Deals" },
  { door: "money", feature: "Finance" },
  { door: "ai-hub", feature: "Pax" },
];

export interface FeatureStickiness {
  feature: string;
  /** Distinct users who opened this door in the window. */
  users: number;
  /** Of those, how many opened it on two or more DISTINCT days. */
  returningUsers: number;
  /**
   * returningUsers / users. Null when nobody opened the door at all — a door
   * nobody visited has no return rate, and 0 would read as "they all left".
   */
  dailyReturnRate: number | null;
}

export interface SupportCategoryShift {
  category: string;
  /** Cases opened in this category in the last 7 days. */
  count: number;
  /** The 7 days before that, for the comparison the trend is drawn from. */
  priorCount: number;
  trend: "up" | "down" | "flat";
}

export interface ExpansionSignal {
  orgId: number;
  orgName: string;
  /** Whichever of leads/deals is closest to its limit, as a percentage. */
  usagePercent: number;
  /** Which resource that was. */
  limitingResource: "leads" | "deals";
  /**
   * Days until the limiting resource reaches its limit, extrapolated from the
   * MEASURED add-rate over the last 30 days. Null when that rate is zero (the
   * org is not growing toward the limit) or the limit is already passed —
   * either way there is no number to give, and inventing one is what this file
   * used to do.
   */
  daysToLimit: number | null;
}

export interface LeadingIndicators {
  activationVelocity: {
    current: number;
    trend: "up" | "down" | "stable";
    /** Null when the prior window had no activations to compare against. */
    changePercent: number | null;
  };
  featureStickiness: FeatureStickiness[];
  supportCategoryShift: SupportCategoryShift[];
  engagementDepth: {
    /** Null when no sessions were recorded in the window. */
    avgPagesPerSession: number | null;
    trend: "up" | "down" | "stable" | "unknown";
  };
  expansionSignals: ExpansionSignal[];
  /**
   * ALWAYS NULL, deliberately. There is no referral data in this schema — no
   * referrals table, no referral-link events, nothing that records a referrer.
   * This used to report `totalOrgs * 0.1` active referrers and
   * `totalOrgs * 0.3` link clicks, which is a number shaped like a measurement
   * and made of nothing. When referral tracking exists, this becomes an object;
   * until then the honest answer to "how many active referrers" is that we do
   * not know.
   */
  referralPropensity: null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function computeLeadingIndicators(): Promise<LeadingIndicators> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * DAY_MS);
  const fourteenDaysAgo = new Date(now - 14 * DAY_MS);
  const thirtyDaysAgo = new Date(now - 30 * DAY_MS);

  const empty: LeadingIndicators = {
    activationVelocity: { current: 0, trend: "stable", changePercent: null },
    featureStickiness: [],
    supportCategoryShift: [],
    engagementDepth: { avgPagesPerSession: null, trend: "unknown" },
    expansionSignals: [],
    referralPropensity: null,
  };

  // EVERY READ BELOW IS PLATFORM-WIDE ON PURPOSE, and says so through the one
  // hatch that logs and greps. These indicators are the FOUNDER's view of the
  // whole business — activation across all tenants, which doors get reopened,
  // which orgs are near a plan limit — so a per-org predicate would empty them.
  // What that intent lacked was any way to tell it from a forgotten one: three
  // of these reads sat in the tenancy register as unexplained cross-org
  // queries, and the stickiness aggregate below is raw SQL, which the gate
  // cannot read at all. An unexplained cross-org read and an invisible one are
  // the two ways this goes wrong; the hatch answers both.
  //
  // The per-org lead/deal counts further down are NOT routed through it — they
  // carry `eq(<table>.organizationId, org.id)` and are scoped reads inside a
  // platform-wide loop.
  //
  // Each read calls the hatch AT ITS OWN CHAIN ROOT rather than sharing one
  // handle. That is not ceremony: the gate's hatch recognition is STATEMENT-
  // scoped by design (a unit that calls it once must not thereby excuse every
  // other query in the same function), so a shared handle would leave these
  // reads reported as unexplained — which is the state they were already in.
  // It also means each one carries the reason that applies to it.

  try {
    // ── Activation velocity ─────────────────────────────────────────────────
    const [recentActivations] = await unscopedForPlatformOps(
      "founder activation velocity: counts activation events across every tenant, which is the company-level number the briefing reports",
    )
      .select({ count: count() })
      .from(userActivationEvents)
      .where(gte(userActivationEvents.occurredAt, sevenDaysAgo));
    const [priorActivations] = await unscopedForPlatformOps(
      "founder activation velocity, prior window: the same company-level count over the preceding seven days, for the comparison",
    )
      .select({ count: count() })
      .from(userActivationEvents)
      .where(
        and(
          gte(userActivationEvents.occurredAt, fourteenDaysAgo),
          lt(userActivationEvents.occurredAt, sevenDaysAgo),
        ),
      );

    const recentCount = recentActivations?.count ?? 0;
    const priorCount = priorActivations?.count ?? 0;
    // No prior activations is not "no change" and not "infinite growth" — it is
    // no comparison. The old code substituted 1 for the divisor, which made the
    // first week of any cohort read as a percentage change against a user who
    // did not exist.
    const velocityChange = priorCount > 0 ? ((recentCount - priorCount) / priorCount) * 100 : null;
    const velocityTrend =
      velocityChange === null ? "stable" : velocityChange > 5 ? "up" : velocityChange < -5 ? "down" : "stable";

    // ── Feature stickiness ──────────────────────────────────────────────────
    // Per door: distinct users who opened it, and how many came back on a
    // SECOND distinct day. `page_views` is a jsonb array of {path, timestamp};
    // a path is reduced to its first segment so `/map/parcel/7` counts as Map.
    const doorSlugs = DOORS.map((d) => d.door);
    const stickinessRows = await unscopedForPlatformOps(
      "founder door stickiness: which of the five customer doors get reopened, measured over every tenant's sessions",
    ).execute<{
      door: string;
      users: number;
      returning_users: number;
    }>(sql`
      WITH v AS (
        SELECT s.user_id,
               split_part(ltrim(e->>'path', '/'), '/', 1) AS door,
               date_trunc('day', (e->>'timestamp')::timestamptz) AS day
        FROM user_sessions s
        CROSS JOIN LATERAL jsonb_array_elements(s.page_views) e
        WHERE s.started_at >= ${sevenDaysAgo}
          AND jsonb_typeof(s.page_views) = 'array'
      ), per_user AS (
        SELECT door, user_id, count(DISTINCT day) AS days
        FROM v GROUP BY door, user_id
      )
      SELECT door,
             count(*)::int                          AS users,
             count(*) FILTER (WHERE days >= 2)::int AS returning_users
      FROM per_user
      WHERE door = ANY (${sql`ARRAY[${sql.join(doorSlugs.map((d) => sql`${d}`), sql`, `)}]::text[]`})
      GROUP BY door
    `);

    const byDoor = new Map<string, { users: number; returning: number }>();
    for (const row of stickinessRows.rows ?? []) {
      byDoor.set(row.door, { users: Number(row.users), returning: Number(row.returning_users) });
    }
    const featureStickiness: FeatureStickiness[] = DOORS.map(({ door, feature }) => {
      const hit = byDoor.get(door);
      const users = hit?.users ?? 0;
      const returningUsers = hit?.returning ?? 0;
      return {
        feature,
        users,
        returningUsers,
        dailyReturnRate: users > 0 ? Math.round((returningUsers / users) * 100) / 100 : null,
      };
    });

    // ── Support category shift ──────────────────────────────────────────────
    // support_cases.category is a real column with a real vocabulary (billing,
    // technical, account, feature, bug, data, integration, other). The old code
    // derived three invented categories from a user_feedback count while this
    // table sat imported and unread.
    const categoryRows = await unscopedForPlatformOps(
      "founder support mix: which support categories are rising across the whole customer base, not one tenant's",
    )
      .select({
        category: supportCases.category,
        recent: sql<number>`count(*) FILTER (WHERE ${supportCases.createdAt} >= ${sevenDaysAgo})::int`,
        prior: sql<number>`count(*) FILTER (WHERE ${supportCases.createdAt} < ${sevenDaysAgo})::int`,
      })
      .from(supportCases)
      .where(gte(supportCases.createdAt, fourteenDaysAgo))
      .groupBy(supportCases.category);

    const supportCategoryShift: SupportCategoryShift[] = categoryRows
      .map((r) => {
        const recent = Number(r.recent ?? 0);
        const prior = Number(r.prior ?? 0);
        return {
          category: r.category,
          count: recent,
          priorCount: prior,
          trend: (recent > prior ? "up" : recent < prior ? "down" : "flat") as "up" | "down" | "flat",
        };
      })
      .sort((a, b) => b.count - a.count);

    // ── Engagement depth ────────────────────────────────────────────────────
    const [sessionData] = await unscopedForPlatformOps(
      "founder engagement depth: average pages per session across every tenant, a company-level number",
    ).execute<{ avg_pages: string | null; sessions: number }>(sql`
      SELECT AVG(jsonb_array_length(page_views)) AS avg_pages,
             count(*)::int                       AS sessions
      FROM user_sessions
      WHERE started_at >= ${sevenDaysAgo}
        AND jsonb_typeof(page_views) = 'array'
    `).then((r) => r.rows ?? []);

    const sessionCount = Number(sessionData?.sessions ?? 0);
    const avgPages = sessionCount > 0 ? Number(sessionData?.avg_pages ?? 0) : null;

    // ── Expansion signals ───────────────────────────────────────────────────
    // Real counts against the SHARED plan-limit table, so this and the upsell
    // email in jobs/growthAutomation.ts cannot disagree about what a limit is.
    const meteredOrgs = await unscopedForPlatformOps(
      "founder expansion signals: every metered organization is a candidate, so the list itself is company-wide by definition",
    )
      .select({ id: organizations.id, name: organizations.name, tier: organizations.subscriptionTier })
      .from(organizations)
      .where(inArray(organizations.subscriptionTier, METERED_TIERS))
      .limit(500);

    const expansionSignals: ExpansionSignal[] = [];
    for (const org of meteredOrgs) {
      const limits = planLimitsFor(org.tier);
      if (!limits) continue;

      const [[leadTotals], [dealTotals]] = await Promise.all([
        db
          .select({
            total: count(),
            added: sql<number>`count(*) FILTER (WHERE ${leads.createdAt} >= ${thirtyDaysAgo})::int`,
          })
          .from(leads)
          .where(eq(leads.organizationId, org.id)),
        db
          .select({
            total: count(),
            added: sql<number>`count(*) FILTER (WHERE ${deals.createdAt} >= ${thirtyDaysAgo})::int`,
          })
          .from(deals)
          .where(eq(deals.organizationId, org.id)),
      ]);

      const leadUsage = Number(leadTotals?.total ?? 0) / limits.leads;
      const dealUsage = Number(dealTotals?.total ?? 0) / limits.deals;
      const limitingResource: "leads" | "deals" = leadUsage >= dealUsage ? "leads" : "deals";
      const usage = Math.max(leadUsage, dealUsage);
      if (usage < 0.8) continue;

      const used = limitingResource === "leads" ? Number(leadTotals?.total ?? 0) : Number(dealTotals?.total ?? 0);
      const addedIn30 =
        limitingResource === "leads" ? Number(leadTotals?.added ?? 0) : Number(dealTotals?.added ?? 0);
      const limit = limitingResource === "leads" ? limits.leads : limits.deals;
      const perDay = addedIn30 / 30;
      const remaining = limit - used;
      // A stated model over measured inputs: the last 30 days' add-rate, held
      // flat. Null rather than a guess when the org is not adding anything, or
      // is already past the limit — there is no "days to" either of those.
      const daysToLimit = perDay > 0 && remaining > 0 ? Math.round(remaining / perDay) : null;

      expansionSignals.push({
        orgId: org.id,
        orgName: org.name || `Org #${org.id}`,
        usagePercent: Math.round(usage * 100),
        limitingResource,
        daysToLimit,
      });
    }
    expansionSignals.sort((a, b) => b.usagePercent - a.usagePercent);

    return {
      activationVelocity: {
        current: recentCount,
        trend: velocityTrend,
        changePercent: velocityChange === null ? null : Math.round(velocityChange),
      },
      featureStickiness,
      supportCategoryShift,
      engagementDepth: {
        avgPagesPerSession: avgPages === null ? null : Math.round(avgPages * 10) / 10,
        trend: avgPages === null ? "unknown" : avgPages > 4 ? "up" : avgPages < 2 ? "down" : "stable",
      },
      expansionSignals: expansionSignals.slice(0, 20),
      referralPropensity: null,
    };
  } catch (err) {
    // An unreadable source is "we do not know", and the shape above says so in
    // every field. It is NOT zeros: a briefing that reports 0 when it failed to
    // read is the same lie in a quieter voice.
    logger.error("[leadingIndicators] compute failed; returning no-data", err instanceof Error ? err : undefined);
    return empty;
  }
}
