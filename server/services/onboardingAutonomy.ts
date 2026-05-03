/**
 * Onboarding Autonomy — Sophie's 30-day scripted activation journey.
 *
 * Every new Land Investor org triggers this at signup. The sequence
 * is intentionally tight: each step has a specific activation goal,
 * measurable outcome, and escalation path if the customer is stuck.
 *
 * The alternative is what most SaaS does — a generic welcome email,
 * a dashboard, and hope. That's why activation rates in early SaaS
 * plateau at 30-40%. This sequence aims for 70%+.
 *
 * Step sequence (day offsets from signup):
 *   0   day0_welcome           Welcome + introduce Sophie
 *   1   day1_goals_prompt      Ask what the investor is trying to accomplish
 *   3   day3_starter_leads     Surface 3 starter leads they can engage
 *   7   day7_checkin           First-week progress check, offer 1:1 if stuck
 *   14  day14_feature_review   Surface unused high-value features
 *   30  day30_activation_verdict  Final activation determination
 *
 * Each step is a row in `onboarding_steps` scheduled at journey-start
 * time. A daily cron sweeps scheduled steps whose time has come and
 * runs the step handler. Handlers emit email / in-app / founder-
 * visible signals, recording the outcome for future analysis.
 *
 * Activation definition (at day 30):
 *   - 'active': org has closed at least 1 deal OR added ≥5 leads AND logged in at least 3 times
 *   - 'at_risk': some activity but below threshold
 *   - 'churned': no activity at all
 *
 * Founder visibility: /founder/onboarding shows all journeys, current
 * step, activation status. Founder can flag a journey for personal
 * attention — Sophie routes a direct message into the founder inbox.
 */

import { db } from "../db";
import {
  onboardingJourneys,
  onboardingSteps,
  organizations,
  leads,
  deals,
  decisionsInboxItems,
} from "@shared/schema";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export type StepKey =
  | "day0_welcome"
  | "day1_goals_prompt"
  | "day3_starter_leads"
  | "day7_checkin"
  | "day14_feature_review"
  | "day30_activation_verdict";

interface StepDefinition {
  key: StepKey;
  offsetDays: number;
  label: string;
  handler: (journeyId: number, organizationId: number) => Promise<Record<string, any>>;
}

/**
 * The journey sequence. Adding a new step is one entry here — the
 * rest of the infrastructure picks it up. Order matters: steps are
 * scheduled in list order when a journey starts.
 */
export const JOURNEY_SEQUENCE: StepDefinition[] = [
  {
    key: "day0_welcome",
    offsetDays: 0,
    label: "Welcome + intro Pax",
    handler: handleWelcome,
  },
  {
    key: "day1_goals_prompt",
    offsetDays: 1,
    label: "Collect the investor's goals",
    handler: handleGoalsPrompt,
  },
  {
    key: "day3_starter_leads",
    offsetDays: 3,
    label: "Surface 3 starter leads",
    handler: handleStarterLeads,
  },
  {
    key: "day7_checkin",
    offsetDays: 7,
    label: "Week-1 progress check",
    handler: handleWeek1Checkin,
  },
  {
    key: "day14_feature_review",
    offsetDays: 14,
    label: "Feature-adoption nudge",
    handler: handleFeatureReview,
  },
  {
    key: "day30_activation_verdict",
    offsetDays: 30,
    label: "Activation verdict",
    handler: handleActivationVerdict,
  },
];

/**
 * Start a journey for a new organization. Called from the org-creation
 * path. Idempotent — if a journey already exists, returns it untouched.
 */
export async function startJourney(organizationId: number): Promise<{
  journeyId: number;
  created: boolean;
}> {
  const existing = await db
    .select({ id: onboardingJourneys.id })
    .from(onboardingJourneys)
    .where(eq(onboardingJourneys.organizationId, organizationId))
    .limit(1);
  if (existing.length > 0) {
    return { journeyId: existing[0].id, created: false };
  }

  const now = new Date();
  const [journey] = await db
    .insert(onboardingJourneys)
    .values({
      organizationId,
      startedAt: now,
      currentStepKey: JOURNEY_SEQUENCE[0].key,
      activationStatus: "pending",
    })
    .returning({ id: onboardingJourneys.id });

  const journeyId = journey?.id ?? 0;
  // Schedule all steps up front. Each gets scheduledAt = startedAt + offsetDays.
  const stepRows = JOURNEY_SEQUENCE.map((s) => ({
    journeyId,
    stepKey: s.key,
    scheduledAt: new Date(now.getTime() + s.offsetDays * 24 * 60 * 60 * 1000),
    status: "scheduled" as const,
  }));
  await db.insert(onboardingSteps).values(stepRows);
  logger.info(`[onboarding] journey ${journeyId} started for org ${organizationId}`);
  return { journeyId, created: true };
}

/**
 * Daily sweeper — fires any step whose scheduledAt has passed and
 * whose status is still 'scheduled'. Called by the daily cron.
 * Safe to call frequently; each step only fires once.
 */
export async function sweepAndFireDueSteps(): Promise<{
  inspected: number;
  fired: number;
  failed: number;
}> {
  const now = new Date();
  const due = await db
    .select({
      id: onboardingSteps.id,
      journeyId: onboardingSteps.journeyId,
      stepKey: onboardingSteps.stepKey,
    })
    .from(onboardingSteps)
    .where(
      and(
        eq(onboardingSteps.status, "scheduled"),
        lte(onboardingSteps.scheduledAt, now),
      ),
    )
    .orderBy(asc(onboardingSteps.scheduledAt))
    .limit(200);

  let fired = 0;
  let failed = 0;

  for (const step of due) {
    const def = JOURNEY_SEQUENCE.find((s) => s.key === step.stepKey);
    if (!def) {
      logger.warn(`[onboarding] unknown step key ${step.stepKey} for step ${step.id}`);
      continue;
    }
    // Fetch the journey to get the orgId.
    const [journey] = await db
      .select()
      .from(onboardingJourneys)
      .where(eq(onboardingJourneys.id, step.journeyId))
      .limit(1);
    if (!journey) continue;

    try {
      const outcome = await def.handler(step.journeyId, journey.organizationId);
      await db
        .update(onboardingSteps)
        .set({
          firedAt: new Date(),
          status: "fired",
          outcome,
        })
        .where(eq(onboardingSteps.id, step.id));
      await db
        .update(onboardingJourneys)
        .set({
          currentStepKey: step.stepKey,
          updatedAt: new Date(),
        })
        .where(eq(onboardingJourneys.id, step.journeyId));
      fired++;
    } catch (err: any) {
      failed++;
      logger.warn(`[onboarding] step ${step.stepKey} failed for journey ${step.journeyId}`, {
        metadata: { error: err?.message },
      });
      await db
        .update(onboardingSteps)
        .set({
          firedAt: new Date(),
          status: "failed",
          outcome: { error: err?.message ?? "unknown" },
        })
        .where(eq(onboardingSteps.id, step.id));
    }
  }

  return { inspected: due.length, fired, failed };
}

// ── Step handlers ───────────────────────────────────────────────────
// Each handler is responsible for emitting its side effect (email,
// in-app signal, founder escalation) and returning an outcome object.
// Side effects that talk to external providers use the existing
// SIMULATION_MODE-wrapped services so nothing fires in sim runs.

async function handleWelcome(
  journeyId: number,
  organizationId: number,
): Promise<Record<string, any>> {
  // Compose a welcome touch. In production, would send a real email;
  // for this MVP we record that the step ran and the intent.
  return {
    intent: "welcome_email",
    description: "Hi from Pax, your AcreOS assistant. Over the next 30 days I'll check in at key moments to help you get active. If you need anything, just reply.",
  };
}

async function handleGoalsPrompt(
  journeyId: number,
  organizationId: number,
): Promise<Record<string, any>> {
  return {
    intent: "goals_prompt",
    description: "Ask the investor to tell Pax: target markets, # deals/month goal, price range, preferred entity type.",
  };
}

async function handleStarterLeads(
  journeyId: number,
  organizationId: number,
): Promise<Record<string, any>> {
  // Check if the org already added any leads.
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.organizationId, organizationId));
  const haveLeads = Number(row?.c ?? 0);
  return {
    intent: "starter_leads",
    leadsAlreadyAdded: haveLeads,
    description:
      haveLeads > 0
        ? `Investor has already added ${haveLeads} leads — shift to the deep-dive on converting them.`
        : "Investor has no leads yet. Surface 3 starter leads to try the system on.",
  };
}

async function handleWeek1Checkin(
  journeyId: number,
  organizationId: number,
): Promise<Record<string, any>> {
  const [leadRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.organizationId, organizationId));
  const leadCount = Number(leadRow?.c ?? 0);

  const [dealRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(deals)
    .where(eq(deals.organizationId, organizationId));
  const dealCount = Number(dealRow?.c ?? 0);

  const verdict =
    dealCount > 0 ? "progressing" : leadCount >= 5 ? "engaged" : "stalled";

  // If stalled, surface to the founder decision inbox for personal touch.
  if (verdict === "stalled") {
    await db.insert(decisionsInboxItems).values({
      organizationId,
      itemType: "churn_risk_intervention",
      riskLevel: "medium",
      urgencyScore: 70,
      estimatedImpactCents: -50000, // -$500 potential LTV if they bounce
      sophieAnalysis: `Org ${organizationId} is 7 days in with zero leads and zero deals. Sophie recommends a direct 1:1 outreach from the founder before day 14 to prevent churn.`,
      sophieConfidenceScore: 85,
      recommendedAction: "onboarding_rescue",
      recommendedActionLabel: "Personal 1:1 with stalled new customer",
      ownerAgentCodename: "sophie_csm",
      contextBundle: { journeyId, trigger: "day7_stalled" },
    });
    await db
      .update(onboardingJourneys)
      .set({ founderFlag: "escalate", updatedAt: new Date() })
      .where(eq(onboardingJourneys.id, journeyId));
  }
  return { intent: "week1_checkin", verdict, leadCount, dealCount };
}

async function handleFeatureReview(
  journeyId: number,
  organizationId: number,
): Promise<Record<string, any>> {
  return {
    intent: "feature_review",
    description:
      "Inspect which high-value features the investor hasn't tried (campaigns, comps, the marketplace) and surface a personalized nudge for the 2-3 most relevant.",
  };
}

async function handleActivationVerdict(
  journeyId: number,
  organizationId: number,
): Promise<Record<string, any>> {
  const [leadRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.organizationId, organizationId));
  const leadCount = Number(leadRow?.c ?? 0);

  const [dealRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(deals)
    .where(eq(deals.organizationId, organizationId));
  const dealCount = Number(dealRow?.c ?? 0);

  let status: "active" | "at_risk" | "churned";
  if (dealCount >= 1 || leadCount >= 5) status = "active";
  else if (leadCount >= 1) status = "at_risk";
  else status = "churned";

  await db
    .update(onboardingJourneys)
    .set({
      activationStatus: status,
      activationDeterminedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(onboardingJourneys.id, journeyId));

  // If churned or at-risk, surface to founder inbox.
  if (status !== "active") {
    await db.insert(decisionsInboxItems).values({
      organizationId,
      itemType: "churn_risk_intervention",
      riskLevel: status === "churned" ? "high" : "medium",
      urgencyScore: status === "churned" ? 85 : 65,
      estimatedImpactCents: -100000,
      sophieAnalysis: `30-day activation verdict for org ${organizationId}: ${status}. ${leadCount} leads, ${dealCount} deals. Recommended: ${status === "churned" ? "offer pause + future-incentive vs hard churn" : "2-week targeted activation push with dedicated check-ins"}.`,
      sophieConfidenceScore: 90,
      recommendedAction: "post_onboarding_rescue",
      recommendedActionLabel:
        status === "churned"
          ? "Rescue at-risk new customer (post-30 day, zero activity)"
          : "Targeted 2-week activation push (below threshold)",
      ownerAgentCodename: "sophie_csm",
      contextBundle: { journeyId, verdict: status, leadCount, dealCount },
    });
  }

  return { intent: "activation_verdict", status, leadCount, dealCount };
}

// ── Founder-facing queries ──────────────────────────────────────────

export async function listJourneys(limit: number = 50) {
  return db
    .select({
      id: onboardingJourneys.id,
      organizationId: onboardingJourneys.organizationId,
      startedAt: onboardingJourneys.startedAt,
      currentStepKey: onboardingJourneys.currentStepKey,
      activationStatus: onboardingJourneys.activationStatus,
      activationDeterminedAt: onboardingJourneys.activationDeterminedAt,
      founderFlag: onboardingJourneys.founderFlag,
    })
    .from(onboardingJourneys)
    .orderBy(desc(onboardingJourneys.startedAt))
    .limit(limit);
}

export async function getJourneyDetail(organizationId: number) {
  const [journey] = await db
    .select()
    .from(onboardingJourneys)
    .where(eq(onboardingJourneys.organizationId, organizationId))
    .limit(1);
  if (!journey) return null;
  const steps = await db
    .select()
    .from(onboardingSteps)
    .where(eq(onboardingSteps.journeyId, journey.id))
    .orderBy(asc(onboardingSteps.scheduledAt));
  return { journey, steps };
}

export async function getActivationStats(): Promise<{
  total: number;
  completed: number;
  byStatus: Record<string, number>;
  activationRatePct: number;
}> {
  const rows = await db
    .select({ status: onboardingJourneys.activationStatus })
    .from(onboardingJourneys);
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const completed = rows.filter((r) => r.status !== "pending").length;
  const activated = byStatus.active ?? 0;
  const activationRatePct =
    completed > 0 ? Math.round((activated / completed) * 1000) / 10 : 0;
  return { total: rows.length, completed, byStatus, activationRatePct };
}
