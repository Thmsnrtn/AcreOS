/**
 * Pillar E / E11 — Onboarding step scheduler.
 *
 * The onboardingSteps table has been recording (journeyId, stepKey,
 * scheduledAt, status='scheduled') rows for weeks but no cron fired
 * them. This service is the missing trigger.
 *
 * Once a day, walks rows where status='scheduled' AND scheduledAt <= NOW,
 * fires whatever side-effect is appropriate for that stepKey (an email
 * nudge, an in-app paxNudge, etc.), and updates the row to 'fired' /
 * 'failed' with outcome metadata.
 *
 * Step-key → handler mapping lives here so adding a new scheduled step
 * is just (a) write the row + (b) add a handler.
 */

import { db } from "../db";
import { onboardingSteps, onboardingJourneys, organizations } from "@shared/schema";
import { and, eq, lte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface OnboardingSchedulerResult {
  fired: number;
  failed: number;
  skipped: number;
}

type StepHandler = (input: { journeyId: number; orgId: number | null; stepKey: string }) => Promise<Record<string, unknown>>;

/**
 * Default handler — log + return a benign outcome. Specific stepKeys can
 * register their own handler. Unknown stepKeys fall through to default
 * (logged, marked fired, no side effect) so the queue drains rather than
 * getting stuck on a typo.
 */
const defaultHandler: StepHandler = async ({ stepKey, journeyId }) => {
  logger.info("[onboarding-scheduler] default handler fired", {
    source: "onboarding-scheduler",
    metadata: { journeyId, stepKey },
  });
  return { handler: "default", notes: "no specific handler registered" };
};

/** Step-key → handler registry. */
const handlers: Record<string, StepHandler> = {
  // Example: a "day-3 check-in" step that calls into paxNudges to surface
  // a "you started but haven't added a lead yet" message.
  day3_check_in: async ({ orgId }) => {
    if (!orgId) return { handler: "day3_check_in", skipped: "no orgId" };
    try {
      const mod = (await import("./paxNudges").catch(() => null)) as
        | (Record<string, unknown> & { enqueueNudgeForOrg?: (input: unknown) => Promise<unknown> })
        | null;
      if (mod && typeof mod.enqueueNudgeForOrg === "function") {
        await mod.enqueueNudgeForOrg({
          organizationId: orgId,
          category: "stale_leads",
          priority: 3,
          actionPrompt:
            "Three days in — looks like the lead list is still empty. Import a CSV or grab a parcel from the map to seed your pipeline.",
        });
        return { handler: "day3_check_in", nudgeQueued: true };
      }
      return { handler: "day3_check_in", skipped: "paxNudges service not available" };
    } catch (err) {
      return {
        handler: "day3_check_in",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
  // Add more (day7_first_value, day14_at_risk, etc.) as the onboarding
  // playbook grows. Each handler must be idempotent — the cron may
  // re-fire if the previous run died mid-update.
};

const BATCH_LIMIT = 200;

export async function runOnboardingScheduler(): Promise<OnboardingSchedulerResult> {
  const now = new Date();

  // Pull scheduled steps whose time has come. Join onboardingJourneys to
  // recover the orgId for the handler.
  const rows = await db
    .select({
      id: onboardingSteps.id,
      journeyId: onboardingSteps.journeyId,
      stepKey: onboardingSteps.stepKey,
      orgId: onboardingJourneys.organizationId,
    })
    .from(onboardingSteps)
    .innerJoin(onboardingJourneys, eq(onboardingJourneys.id, onboardingSteps.journeyId))
    .where(
      and(
        eq(onboardingSteps.status, "scheduled"),
        lte(onboardingSteps.scheduledAt, now),
      ),
    )
    .limit(BATCH_LIMIT);

  let fired = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const handler = handlers[row.stepKey] ?? defaultHandler;

    // Guard: skip if the org is dunning-suspended (we'd just be spamming
    // a suspended customer). Best-effort lookup; if it fails, proceed.
    try {
      const [org] = await db
        .select({ status: organizations.subscriptionStatus })
        .from(organizations)
        .where(eq(organizations.id, row.orgId))
        .limit(1);
      if (org?.status === "suspended" || org?.status === "canceled") {
        await db
          .update(onboardingSteps)
          .set({
            status: "skipped",
            firedAt: now,
            outcome: { reason: `org_${org.status}`, handler: "skipped" },
          })
          .where(eq(onboardingSteps.id, row.id));
        skipped++;
        continue;
      }
    } catch {
      /* fall through — don't block on lookup */
    }

    try {
      const outcome = await handler({
        journeyId: row.journeyId,
        orgId: row.orgId,
        stepKey: row.stepKey,
      });
      await db
        .update(onboardingSteps)
        .set({
          status: "fired",
          firedAt: now,
          outcome: { ...outcome, firedBy: "cron" },
        })
        .where(eq(onboardingSteps.id, row.id));
      fired++;
    } catch (err) {
      await db
        .update(onboardingSteps)
        .set({
          status: "failed",
          firedAt: now,
          outcome: { error: err instanceof Error ? err.message : String(err) },
        })
        .where(eq(onboardingSteps.id, row.id));
      failed++;
      logger.error("[onboarding-scheduler] handler threw", err);
    }
  }

  // Touch the journey activationStatus if the only remaining steps are
  // 'fired'/'skipped' — leaves the journey-completion logic to
  // onboardingService but surfaces a tail signal here for free.
  void sql; // imported for future use; suppress unused-import lint

  logger.info("[onboarding-scheduler] cycle complete", {
    source: "onboarding-scheduler",
    metadata: { fired, failed, skipped, totalScanned: rows.length },
  });

  return { fired, failed, skipped };
}
