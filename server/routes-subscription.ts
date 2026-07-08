/**
 * Subscription lifecycle routes (Renoir §1-§2, Phase 2 Week 3-4).
 *
 * Adds GET /api/subscription/reactivation-context — surfaces the data the
 * reactivation flow needs to make a "come back" pitch grounded in the
 * customer's actual history:
 *
 *   - lastPlan: tier, billing interval, monthly price, last charged at
 *   - tenureDays: total days the org had an active paid subscription
 *     (summed across all subscribed↔canceled lifecycles in
 *     subscription_history)
 *   - grandfatheredPriceAvailable: was the last priced state below the
 *     current canonical tier price? if so, we'd honour the legacy price on
 *     reactivation.
 *   - whatsNew: filtered slice of the customer changelog covering the
 *     window since cancellation
 *   - cancellationReason: the most recent cancellation_surveys.reason
 */

import type { Express } from "express";
import { db } from "./db";
import { storage } from "./storage";
import {
  cancellationSurveys,
  organizations,
  reactivationSurveys,
  subscriptionHistory,
} from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requirePermission } from "./utils/permissions";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  CUSTOMER_CHANGELOG,
  type CustomerChangelogEntry,
} from "../client/src/data/customer-changelog";
import {
  TIER_PRICES_CENTS,
  tierForSubscriptionTier,
  tierPriceCents,
  type BillingInterval,
} from "@shared/billing/tier-pricing";
import type { AuthenticatedRequest } from "./types/request";

interface WhatsNewItem {
  date: string;
  type: "added" | "improved";
  title: string;
  body: string;
}

/**
 * Walk the org's subscription_history chronologically and total the active
 * days between every (subscribed | reactivated) → (canceled) interval.
 * If the most recent active span has no canceled event yet, count up to now.
 */
function computeTenureDays(rows: Array<{ eventType: string; eventAt: Date }>): number {
  const sorted = [...rows].sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime());
  let totalMs = 0;
  let activeStart: Date | null = null;
  for (const row of sorted) {
    if (row.eventType === "subscribed" || row.eventType === "reactivated") {
      if (activeStart == null) activeStart = row.eventAt;
    } else if (row.eventType === "canceled") {
      if (activeStart != null) {
        totalMs += row.eventAt.getTime() - activeStart.getTime();
        activeStart = null;
      }
    }
    // tier_changed events don't toggle the active state
  }
  if (activeStart != null) {
    totalMs += Date.now() - activeStart.getTime();
  }
  return Math.max(0, Math.floor(totalMs / (1000 * 60 * 60 * 24)));
}

/**
 * Given the cancellation date, return changelog entries on/after that date,
 * filtered to "added" and "improved" types (cancelled customers don't need
 * a list of bug fixes). Capped at 12 items to keep the surface scannable.
 */
function changelogSinceCancellation(sinceDate: Date | null): {
  sinceDate: string;
  items: WhatsNewItem[];
} {
  const isoSince = sinceDate ? sinceDate.toISOString().slice(0, 10) : "1970-01-01";
  const items: WhatsNewItem[] = [];
  for (const entry of CUSTOMER_CHANGELOG as CustomerChangelogEntry[]) {
    if (entry.date < isoSince) continue;
    for (const change of entry.changes) {
      if (change.type !== "added" && change.type !== "improved") continue;
      items.push({
        date: entry.date,
        type: change.type,
        title: change.title,
        body: change.body,
      });
      if (items.length >= 12) break;
    }
    if (items.length >= 12) break;
  }
  return { sinceDate: isoSince, items };
}

export function registerSubscriptionRoutes(app: Express): void {
  /**
   * POST /api/subscription/reactivation-survey
   *
   * The welcome-back page has always POSTed the "what brought you back"
   * reason here — to an endpoint that didn't exist (the client swallows
   * the failure, so the growth signal silently 404'd; WS1 sweep,
   * 2026-07-07). Persists to reactivation_surveys. Best-effort semantics
   * preserved: validation failures 400, but nothing here should ever block
   * the resubscribe flow (the client doesn't await success).
   */
  app.post(
    "/api/subscription/reactivation-survey",
    isAuthenticated,
    getOrCreateOrg,
    async (req, res) => {
      try {
        const authReq = req as AuthenticatedRequest;
        const returnReason =
          typeof req.body?.returnReason === "string" ? req.body.returnReason.trim() : "";
        if (!returnReason || returnReason.length > 200) {
          return Errors.badRequest(res, "returnReason (string ≤200 chars) is required");
        }
        await db.insert(reactivationSurveys).values({
          organizationId: authReq.organization.id,
          userId: (authReq.user as any)?.id ? String((authReq.user as any).id) : null,
          returnReason,
        });
        return res.json({ ok: true });
      } catch (err) {
        return Errors.internal(res, err as Error);
      }
    },
  );

  /**
   * GET /api/subscription/reactivation-context
   *
   * Returns the structured payload the reactivation UI needs: last plan,
   * tenure, whether a grandfathered price is available, what's new since
   * they left, and the most recent cancellation reason.
   */
  app.get(
    "/api/subscription/reactivation-context",
    isAuthenticated,
    getOrCreateOrg,
    requirePermission("canManageBilling"),
    async (req, res) => {
      try {
        const authReq = req as AuthenticatedRequest;
        const org = authReq.organization;

        // Pull subscription history rows for tenure + last-priced-state.
        let historyRows: Array<{
          eventType: string;
          tier: string | null;
          billingInterval: string | null;
          priceCents: number | null;
          eventAt: Date;
        }> = [];
        try {
          historyRows = await db
            .select({
              eventType: subscriptionHistory.eventType,
              tier: subscriptionHistory.tier,
              billingInterval: subscriptionHistory.billingInterval,
              priceCents: subscriptionHistory.priceCents,
              eventAt: subscriptionHistory.eventAt,
            })
            .from(subscriptionHistory)
            .where(eq(subscriptionHistory.organizationId, org.id))
            .orderBy(desc(subscriptionHistory.eventAt));
        } catch (err) {
          // Table may not exist on a fresh install before bootstrap ran.
          logger.warn(
            "[reactivation-context] subscription_history read failed",
            err instanceof Error ? err : undefined,
          );
        }

        // Most recent priced row → that's "the plan they last had".
        const lastPriced = historyRows.find(
          (r) => r.tier && r.priceCents != null,
        );

        // Most recent charge date — pick the latest event with a non-zero
        // price (subscribed/tier_changed/reactivated all qualify).
        const lastChargedAt =
          historyRows.find(
            (r) =>
              (r.eventType === "subscribed" ||
                r.eventType === "tier_changed" ||
                r.eventType === "reactivated") &&
              r.priceCents != null,
          )?.eventAt ?? null;

        // Fall back to the org's current/last subscriptionTier when history
        // is empty (legacy customers who cancelled before this table existed).
        const tierFallback = tierForSubscriptionTier(org.subscriptionTier);
        const intervalFallback: BillingInterval =
          (org.billingInterval as BillingInterval) || "monthly";
        const monthlyFallbackCents = tierFallback
          ? TIER_PRICES_CENTS[tierFallback].priceMonthlyCents
          : 0;

        const lastPlan = {
          tier: lastPriced?.tier ?? org.subscriptionTier ?? "free",
          billingInterval:
            (lastPriced?.billingInterval as BillingInterval | null) ??
            intervalFallback,
          monthlyPriceCents:
            lastPriced && lastPriced.priceCents != null
              ? lastPriced.billingInterval === "yearly"
                ? Math.round(lastPriced.priceCents / 12)
                : lastPriced.priceCents
              : monthlyFallbackCents,
          lastChargedAt: lastChargedAt
            ? lastChargedAt.toISOString()
            : null,
        };

        // Grandfathered price = the last priced state was below the canonical
        // tier price for the same (tier, interval). If they were paying $39
        // for Operator before we raised it to $49, honour the $39.
        let grandfatheredPriceAvailable = false;
        if (lastPriced?.tier && lastPriced.priceCents != null) {
          const canonicalTier = tierForSubscriptionTier(lastPriced.tier);
          const interval =
            (lastPriced.billingInterval as BillingInterval | null) || "monthly";
          if (canonicalTier) {
            const canonicalCents = tierPriceCents(canonicalTier, interval);
            grandfatheredPriceAvailable =
              lastPriced.priceCents < canonicalCents;
          }
        }

        // Most recent cancellation event drives "what's new since you left"
        // window + cancellationReason surface.
        const lastCancelEvent = historyRows.find(
          (r) => r.eventType === "canceled",
        );
        const cancellationDate: Date | null =
          lastCancelEvent?.eventAt ?? null;

        // Most recent cancellation_surveys.reason for this org.
        let cancellationReason: string | undefined;
        try {
          const [survey] = await db
            .select({ reason: cancellationSurveys.reason })
            .from(cancellationSurveys)
            .where(eq(cancellationSurveys.organizationId, org.id))
            .orderBy(desc(cancellationSurveys.createdAt))
            .limit(1);
          if (survey?.reason) cancellationReason = survey.reason;
        } catch (err) {
          logger.warn(
            "[reactivation-context] cancellation_surveys read failed",
            err instanceof Error ? err : undefined,
          );
        }

        const whatsNew = changelogSinceCancellation(cancellationDate);

        // Tenure: prefer subscription_history; if empty, fall back to a
        // best-effort "days since org createdAt" so the UI always has a
        // number for legacy customers.
        let tenureDays = computeTenureDays(
          historyRows.map((r) => ({
            eventType: r.eventType,
            eventAt: r.eventAt,
          })),
        );
        if (tenureDays === 0 && org.createdAt) {
          tenureDays = Math.max(
            0,
            Math.floor(
              (Date.now() - new Date(org.createdAt).getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          );
        }

        return res.json({
          lastPlan,
          tenureDays,
          grandfatheredPriceAvailable,
          whatsNew,
          ...(cancellationReason ? { cancellationReason } : {}),
        });
      } catch (err: any) {
        Errors.internal(res, err);
      }
    },
  );
}

/**
 * Audit-log helper used by Stripe webhook handlers + manual
 * subscribe/cancel routes. Inserts into subscription_history. Failures are
 * logged but never thrown — billing flows must not break if this audit
 * write fails (e.g., on a fresh install before the bootstrap ran).
 */
export async function recordSubscriptionHistoryEvent(params: {
  organizationId: number;
  eventType: "subscribed" | "tier_changed" | "canceled" | "reactivated";
  tier?: string | null;
  billingInterval?: string | null;
  priceCents?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(subscriptionHistory).values({
      organizationId: params.organizationId,
      eventType: params.eventType,
      tier: params.tier ?? null,
      billingInterval: params.billingInterval ?? null,
      priceCents: params.priceCents ?? null,
      metadata: (params.metadata ?? {}) as any,
    });
  } catch (err) {
    logger.warn(
      `[subscription_history] insert failed for org ${params.organizationId}`,
      err instanceof Error ? err : undefined,
    );
  }
}
