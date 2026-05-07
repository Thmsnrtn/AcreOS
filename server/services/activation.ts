/**
 * Phase 3 Week 14 — Activation event recording (Yuna §8, Konstantin §2).
 *
 * recordActivationEvent() is idempotent on (organizationId, eventName) so
 * the FIRST occurrence of any canonical event wins. Subsequent calls are
 * silently no-op'd at the DB layer via ON CONFLICT DO NOTHING.
 *
 * The /founder/activation funnel reads activation_events to compute
 * "% of orgs hitting each canonical event in their first 7/30/90 days."
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { activationEvents, type ActivationEvent } from "@shared/schema";
import { logger } from "../utils/logger";

interface RecordActivationEventArgs {
  orgId: number;
  userId?: string | null;
  eventName: ActivationEvent;
  eventValue?: Record<string, unknown>;
}

/**
 * Returns the canonical event name for a completed onboarding step.
 * Step numbers are 1-indexed against the canonical wizard step list in
 * components/onboarding/OnboardingWizard.tsx.
 */
export function onboardingStepCompletedEvent(stepNumber: number): ActivationEvent {
  return `onboarding_step_${stepNumber}_completed` as ActivationEvent;
}

/**
 * Returns the canonical event name for an entered onboarding step.
 * Pair-fired with the corresponding `_completed` event so per-step bail
 * rate is computable as `entered_N AND NOT completed_N`. Step numbers are
 * 1-indexed and align with the wizard's currentStepIndex+1.
 */
export function onboardingStepEnteredEvent(stepNumber: number): ActivationEvent {
  return `onboarding_step_${stepNumber}_entered` as ActivationEvent;
}

/**
 * Record a first-occurrence activation event. Safe to call from anywhere —
 * fires-and-forgets, never throws into the caller.
 */
export async function recordActivationEvent(args: RecordActivationEventArgs): Promise<void> {
  const { orgId, userId, eventName, eventValue } = args;

  if (!orgId || !eventName) {
    logger.warn("[activation] recordActivationEvent called without orgId/eventName", {
      metadata: { orgId, eventName },
    });
    return;
  }

  try {
    await db
      .insert(activationEvents)
      .values({
        organizationId: orgId,
        userId: userId ?? null,
        eventName,
        eventValue: (eventValue ?? {}) as Record<string, any>,
      })
      .onConflictDoNothing({ target: [activationEvents.organizationId, activationEvents.eventName] });
  } catch (err) {
    logger.warn("[activation] failed to record event", {
      metadata: { orgId, eventName, error: (err as Error).message },
    });
  }
}

/**
 * Fire-and-forget wrapper for hot paths that don't want to await.
 */
export function recordActivationEventAsync(args: RecordActivationEventArgs): void {
  recordActivationEvent(args).catch((err) => {
    logger.warn("[activation] async record failed", {
      metadata: { eventName: args.eventName, error: (err as Error).message },
    });
  });
}

/**
 * Compute funnel: for each canonical event, what % of orgs hit the event
 * within N days of org creation. Used by /founder/activation.
 */
export async function getActivationFunnel(windowDays: 7 | 30 | 90): Promise<{
  events: Array<{
    eventName: string;
    orgsHit: number;
    totalOrgs: number;
    pct: number;
  }>;
  totalOrgs: number;
  windowDays: number;
}> {
  const result = await db.execute(sql`
    WITH org_base AS (
      SELECT id, created_at FROM organizations
    ),
    funnel AS (
      SELECT
        ae.event_name,
        COUNT(DISTINCT ae.organization_id) AS orgs_hit
      FROM activation_events ae
      JOIN org_base o ON o.id = ae.organization_id
      WHERE ae.occurred_at <= o.created_at + (${windowDays}::int * INTERVAL '1 day')
      GROUP BY ae.event_name
    ),
    totals AS (
      SELECT COUNT(*)::int AS total_orgs FROM org_base
    )
    SELECT
      f.event_name AS "eventName",
      f.orgs_hit::int AS "orgsHit",
      t.total_orgs AS "totalOrgs"
    FROM funnel f, totals t
    ORDER BY f.orgs_hit DESC
  `);

  const rows = (result as any).rows ?? (result as any) ?? [];
  const totalOrgs = rows[0]?.totalOrgs ?? 0;
  const events = rows.map((r: any) => ({
    eventName: String(r.eventName),
    orgsHit: Number(r.orgsHit) || 0,
    totalOrgs: Number(r.totalOrgs) || 0,
    pct: totalOrgs > 0 ? Math.round(((Number(r.orgsHit) || 0) / totalOrgs) * 1000) / 10 : 0,
  }));

  return { events, totalOrgs, windowDays };
}
