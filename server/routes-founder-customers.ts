/**
 * /api/founder/customers — distribution truth surface (Wave 3 / E).
 *
 * Founder-only. Surfaces the four numbers the founder needs to answer
 * "is the business actually working?":
 *
 *   - paidOrgCount       : how many orgs are paying right now
 *   - trialOrgCount      : how many landed in the last 14 days and have
 *                          not converted (yet)
 *   - churnedLast30d     : how many cancelled in the last 30 days
 *   - topUtmSources      : where the last 90 days of signups came from,
 *                          counted by users.acquisitionUtm.utm_source
 *   - paidBySource       : of the last 90 days of signups, the orgs that are
 *                          paying NOW, grouped by utm_source + utm_campaign
 *                          (runbook §5: cost per PAYING customer per campaign)
 *   - recentSignups      : last 20 user rows with their org + persona +
 *                          city/state (best-effort from organizations
 *                          .taxAddress) + UTM source
 *
 * Companion to the qualitative customers.md tracker at the repo root.
 * The markdown file is the founder's hand-written narrative; this page
 * is the auto-computed view. The two complement each other.
 *
 * Pattern: matches server/routes-pax-traces.ts and
 * server/routes-pax-calibration.ts — isAuthenticated + getOrCreateOrg +
 * requireFounder. Read-only.
 */

import type { Express, Response } from "express";
import { SUBSCRIPTION_EVENT } from "@shared/billing/subscriptionEventVocabulary";
import { db } from "./db";
import { organizations, subscriptionEvents } from "@shared/schema";
import { users } from "@shared/models/auth";
import { and, desc, eq, gte, sql, isNotNull, inArray } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { clock } from "./utils/clock";
import { monthlyRevenueCentsFor } from "@shared/billing/tier-pricing";
import type { BillingInterval } from "@shared/billing/tier-pricing";

const RECENT_SIGNUPS_LIMIT = 20;
const TRIAL_WINDOW_DAYS = 14;
const CHURN_WINDOW_DAYS = 30;
const UTM_WINDOW_DAYS = 90;
const TOP_UTM_LIMIT = 10;

/**
 * Status values on organizations.subscriptionStatus that count as
 * "actively paying right now." Stripe and our dunning ladder both land
 * on these strings. Anything else (cancelled, paused, free, etc.) is
 * treated as not-currently-paying.
 */
const ACTIVE_STATUSES = ["active", "trialing", "past_due"] as const;

/**
 * The churn WINDOW is keyed on the real `cancel` subscription_event timestamp
 * (see below), NOT on organizations.updatedAt — any unrelated org update (a
 * profile edit, a churn-risk-score refresh) re-dates updatedAt and would
 * otherwise drag a long-since-churned org back into the 30-day window.
 *
 * The canonical subscription_events.event_type written by
 * storage.logSubscriptionEvent on a real cancellation (webhook
 * customer.subscription.deleted + the in-app cancel path). This is the only
 * real cancellation TIMESTAMP we persist, so we key the churn window on it.
 */
// (SUBSCRIPTION_EVENT.cancel, shared/billing/subscriptionEventVocabulary.ts.)

/** One owner-user/org pair as read for the paid-by-source split. */
export type PaidConversionRow = {
  organizationId: number;
  tier: string | null;
  status: string | null;
  interval: string | null;
  utm: { utm_source?: unknown; utm_campaign?: unknown } | null;
};

/**
 * "Paying" — MIRRORS `liveMrrDetail()` in
 * server/services/finance/runwayModel.ts (the single source the runway, MRR
 * snapshot job, gate watcher and revenue agent all share; LQ-22): the org's
 * subscription_status is exactly "active" (so `trialing`, `past_due`, free and
 * cancelled are NOT paying) AND its monthly-equivalent price from
 * `monthlyRevenueCentsFor` is positive. Deliberately NOT ACTIVE_STATUSES above,
 * which includes trialing and would count trials as conversions.
 * liveMrrDetail is a whole-table loop, not an importable predicate, so the
 * semantics are mirrored here over the shared price helper.
 * "Mirrors liveMrrDetail" is scoped to this PREDICATE only: the route query
 * additionally excludes founder orgs (isFounder = false), per this endpoint's
 * convention, which liveMrrDetail does not do here.
 */
export function isPayingOrg(r: Pick<PaidConversionRow, "tier" | "status" | "interval">): boolean {
  if (r.status !== "active") return false;
  return monthlyRevenueCentsFor(r.tier, (r.interval as BillingInterval) ?? "monthly") > 0;
}

function utmValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Distinct paying orgs grouped by utm_source + utm_campaign. A missing source
 * is "direct" (same convention as topUtmSources); a missing campaign is
 * `null`. Nothing is dropped: a paid org with no UTM lands in
 * {source:"direct", campaign:null}. An org counts once however many rows
 * (users) point at it; first row wins its attribution.
 */
export function groupPaidBySource(
  rows: PaidConversionRow[],
): Array<{ source: string; campaign: string | null; paidOrgs: number }> {
  const seen = new Set<number>();
  const buckets = new Map<string, { source: string; campaign: string | null; paidOrgs: number }>();
  for (const r of rows) {
    if (!isPayingOrg(r) || seen.has(r.organizationId)) continue;
    seen.add(r.organizationId);
    const source = utmValue(r.utm?.utm_source) ?? "direct";
    const campaign = utmValue(r.utm?.utm_campaign);
    const key = JSON.stringify([source, campaign]);
    const b = buckets.get(key);
    if (b) b.paidOrgs++;
    else buckets.set(key, { source, campaign, paidOrgs: 1 });
  }
  return [...buckets.values()].sort(
    (a, b) =>
      b.paidOrgs - a.paidOrgs ||
      a.source.localeCompare(b.source) ||
      (a.campaign ?? "").localeCompare(b.campaign ?? ""),
  );
}

type TaxAddress = {
  city?: string;
  state?: string;
};

export function registerFounderCustomersRoutes(app: Express) {
  app.get(
    "/api/founder/customers",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const now = clock.now();
        const trialCutoff = new Date(now.getTime() - TRIAL_WINDOW_DAYS * 24 * 3600 * 1000);
        const churnCutoff = new Date(now.getTime() - CHURN_WINDOW_DAYS * 24 * 3600 * 1000);
        const utmCutoff = new Date(now.getTime() - UTM_WINDOW_DAYS * 24 * 3600 * 1000);

        // ── Paying org count ──────────────────────────────────────────────
        const [paidRow] = await db
          .select({
            count: sql<number>`count(*)::int`,
          })
          .from(organizations)
          .where(
            and(
              eq(organizations.isFounder, false),
              inArray(organizations.subscriptionStatus, [...ACTIVE_STATUSES]),
              sql`${organizations.subscriptionTier} <> 'free'`,
            ),
          );
        const paidOrgCount = paidRow?.count ?? 0;

        // ── Trial org count ───────────────────────────────────────────────
        // Orgs that landed within the trial window AND are not actively
        // paying. We OR on trial_started_at because some orgs have a
        // Stripe-driven trial and the trial_started_at is the truth, but
        // for the founder's purposes "signed up <14 days ago and isn't
        // paying yet" is the actionable definition.
        const [trialRow] = await db
          .select({
            count: sql<number>`count(*)::int`,
          })
          .from(organizations)
          .where(
            and(
              eq(organizations.isFounder, false),
              gte(organizations.createdAt, trialCutoff),
              sql`(${organizations.subscriptionTier} = 'free' OR ${organizations.subscriptionStatus} NOT IN ('active', 'trialing'))`,
            ),
          );
        const trialOrgCount = trialRow?.count ?? 0;

        // ── Churned in last 30 days ───────────────────────────────────────
        // Keyed on the REAL cancellation timestamp: the `cancel`
        // subscription_event's created_at. This is the only persisted moment
        // an org actually cancelled, so the 30-day window can't be polluted by
        // an unrelated organizations.updatedAt bump (the previous bug). We
        // count DISTINCT orgs (an org could have churn→reactivate→churn within
        // the window — we want it counted once) that are NOT founder orgs.
        const [churnRow] = await db
          .select({
            count: sql<number>`count(DISTINCT ${subscriptionEvents.organizationId})::int`,
          })
          .from(subscriptionEvents)
          .innerJoin(
            organizations,
            eq(organizations.id, subscriptionEvents.organizationId),
          )
          .where(
            and(
              eq(subscriptionEvents.eventType, SUBSCRIPTION_EVENT.cancel),
              gte(subscriptionEvents.createdAt, churnCutoff),
              eq(organizations.isFounder, false),
            ),
          );
        const churnedLast30d = churnRow?.count ?? 0;

        // ── Top UTM sources (last 90 days of signups) ─────────────────────
        const utmRows = await db
          .select({
            source: sql<string>`COALESCE(${users.acquisitionUtm} ->> 'utm_source', 'direct')`,
            count: sql<number>`count(*)::int`,
          })
          .from(users)
          .where(
            and(
              isNotNull(users.createdAt),
              gte(users.createdAt, utmCutoff),
              // Exclude users who own a founder/internal org so the funnel
              // measures real customers, not the founder's own org.
              sql`NOT EXISTS (SELECT 1 FROM ${organizations} WHERE ${organizations.ownerId} = ${users.id} AND ${organizations.isFounder} = true)`,
            ),
          )
          .groupBy(sql`COALESCE(${users.acquisitionUtm} ->> 'utm_source', 'direct')`)
          .orderBy(desc(sql`count(*)`))
          .limit(TOP_UTM_LIMIT);

        const topUtmSources = utmRows.map((r) => ({
          source: r.source ?? "direct",
          count: r.count,
        }));

        // ── Paid conversions by source + campaign (same 90d signup window) ─
        // Owner-user → org (the file's acquisition join). Status/price
        // filtering happens in isPayingOrg so it matches liveMrrDetail.
        const paidCandidateRows = await db
          .select({
            organizationId: organizations.id,
            tier: organizations.subscriptionTier,
            status: organizations.subscriptionStatus,
            interval: organizations.billingInterval,
            utm: users.acquisitionUtm,
          })
          .from(users)
          .innerJoin(organizations, eq(organizations.ownerId, users.id))
          .where(
            and(
              isNotNull(users.createdAt),
              gte(users.createdAt, utmCutoff),
              eq(organizations.isFounder, false),
            ),
          );
        // paidBySource is the CANONICAL paying definition (status exactly
        // "active" + positive price). The pre-existing paidOrgCount field above
        // uses a looser definition (ACTIVE_STATUSES, incl. trialing/past_due),
        // so the two will not sum or reconcile.
        const paidBySource = groupPaidBySource(paidCandidateRows as PaidConversionRow[]);

        // ── Recent signups (last 20, latest first) ────────────────────────
        // We join users → organizations via organizations.ownerId =
        // users.id. Org owner is the canonical "this person represents
        // the org for acquisition purposes" join key. Orgs that haven't
        // had their owner row yet (rare race during the very first
        // /api/auth/user call) are simply not surfaced — the next render
        // catches them.
        const recentRows = await db
          .select({
            userId: users.id,
            createdAt: users.createdAt,
            persona: users.persona,
            utm: users.acquisitionUtm,
            orgName: organizations.name,
            orgTaxAddress: organizations.taxAddress,
          })
          .from(users)
          .leftJoin(organizations, eq(organizations.ownerId, users.id))
          .where(
            and(
              isNotNull(users.createdAt),
              // Exclude the founder's own org from the recent-signups feed.
              sql`NOT EXISTS (SELECT 1 FROM ${organizations} WHERE ${organizations.ownerId} = ${users.id} AND ${organizations.isFounder} = true)`,
            ),
          )
          .orderBy(desc(users.createdAt))
          .limit(RECENT_SIGNUPS_LIMIT);

        const recentSignups = recentRows.map((r) => {
          const tax = (r.orgTaxAddress ?? null) as TaxAddress | null;
          const utm = r.utm ?? null;
          return {
            orgName: r.orgName ?? "(no org)",
            // Default a NULL persona to "unknown", never "land_investor" — a
            // missing persona is not a confirmed land-investor signup, and the
            // founder funnel must not invent acquisition signal.
            persona: r.persona ?? "unknown",
            createdAt: r.createdAt ? r.createdAt.toISOString() : new Date(0).toISOString(),
            utmSource: utm?.utm_source ?? null,
            city: tax?.city ?? null,
            state: tax?.state ?? null,
          };
        });

        res.json({
          asOf: now.toISOString(),
          paidOrgCount,
          trialOrgCount,
          churnedLast30d,
          topUtmSources,
          paidBySource,
          recentSignups,
        });
      } catch (error) {
        logger.error("[founder-customers] failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return Errors.internal(res, error);
      }
    },
  );
}
