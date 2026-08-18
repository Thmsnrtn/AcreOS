/**
 * Outcome Verification Loop
 *
 * Asks, once a day, whether an autonomous action actually HELPED — and feeds
 * the answer to `autonomyScoreV14`, where it becomes a 0.5–1.5 multiplier on
 * the organization's autonomy score. That number is the trust metric. What this
 * file decides, the system's authority follows.
 *
 * ── THE DEFECT THIS ENDS ────────────────────────────────────────────────────
 * Until 2026-08-18 the fall-through branch re-read `agentActionLog` — the
 * ACTOR'S OWN execution record, written by the actor, about itself — and mapped
 * it straight onto an outcome verdict:
 *
 *     const actionOutcome = logEntry.outcome === "success" ? "positive" : "negative";
 *
 * Three separate things are wrong with that line, and each one is worse than
 * the last.
 *
 * 1. A RECEIPT IS NOT AN OUTCOME. `agentActionLog.outcome` records whether the
 *    call returned, not whether it worked. Of the ten sites that write the
 *    column, eight write the literal `"success"` at the moment the action is
 *    ISSUED — `predictiveAutoscaler` writes `outcome: "success"` beside
 *    `output: { scheduled: true }` and `durationMs: 0`, i.e. "I have scheduled
 *    this", and `agentActionExecutors` writes `result.success ? …`, i.e. "the
 *    executor did not throw". Reading that back as `"positive"` gave a bare
 *    dispatch receipt the same weight as "the lead progressed to qualified
 *    after our follow-up". The actor graded its own homework and the grade
 *    moved its own authority.
 *
 * 2. ESCALATION WAS SCORED AS HARM. The column's domain is
 *    `success | failure | escalated | pending`, and `agentAuthorityGate` writes
 *    all four. Everything that is not exactly `"success"` fell into the
 *    ternary's false branch, so an action the gate correctly ESCALATED to a
 *    human — the safety valve working exactly as designed — was recorded as a
 *    NEGATIVE outcome and pulled the quality score down. So did `"pending"`,
 *    which only means the work is still in flight. The loop was applying
 *    downward pressure on the one behaviour the constitution most wants: asking
 *    permission.
 *
 * 3. IT CROSSED TENANTS. `agent_action_log` has no `organization_id` column at
 *    all; the match was `agentCodename + actionName + createdAt >= …`. The
 *    driving query over `agentEvents` had no organization predicate either, and
 *    neither did the entity lookups — `eq(leads.id, leadId)` by primary key.
 *    `autonomyScoreV14.calculateDailyScore(orgId)` calls this per organization,
 *    so every organization's quality multiplier was computed from every OTHER
 *    organization's actions, and a copy of the whole global result set was
 *    written back under each `orgId`.
 *
 * ── THE RULE NOW ────────────────────────────────────────────────────────────
 * A verifier may only report an outcome it OBSERVED IN THE WORLD. The four
 * typed verifiers below do observe: they read lead status, deal creation, deal
 * resolution, job health — state the actor does not author. Everything else is
 * `"unverified"`, and `"unverified"` is EXCLUDED FROM THE QUALITY SCORE rather
 * than averaged into it. "We could not look" is not "it had no effect"; folding
 * the first into the second is the same fabrication in a quieter voice.
 *
 * The actor's own testimony is still recorded, in the reason string, plainly
 * labelled as testimony. It is evidence about EXECUTION. It is never evidence
 * about OUTCOME.
 *
 * This lowers autonomy scores that were previously lifted by self-report. That
 * is the correction, not a regression.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry, §16: an effect receipt is not an outcome. The noun did not travel;
 * the invariant did.
 */

import { db } from "../db";
import { agentEvents, leads, deals, properties, organizations } from "@shared/schema";
import { eq, and, or, sql, desc, gte, inArray } from "drizzle-orm";
import { logger } from "../utils/logger";

/**
 * `"unverified"` is a first-class result, not a failure to produce one. It
 * means: no observation of this action's effect exists. It is reported, and it
 * is kept out of the arithmetic.
 */
type VerificationOutcome = "positive" | "negative" | "neutral" | "unverified";

interface VerificationResult {
  agentCodename: string;
  action: string;
  outcome: VerificationOutcome;
  reason: string;
  createdAt: Date;
}

/** What the loop was looking at — carried explicitly, never re-derived. */
interface ActionUnderReview {
  orgId: number;
  agentCodename: string;
  actionType: string;
  /** `agent_events.created_at` is nullable; the caller resolves it once. */
  actionCreatedAt: Date;
  payload: Record<string, any>;
}

class OutcomeVerificationLoop {
  /**
   * Verify outcomes of recent autonomous actions FOR ONE ORGANIZATION.
   *
   * Every query below is scoped to `orgId`. The entity lookups filter on the
   * tenant column as well as the primary key: an id from another tenant's event
   * must find nothing, not somebody else's lead.
   */
  async verify(orgId: number): Promise<{
    verified: number;
    positive: number;
    negative: number;
    neutral: number;
    unverified: number;
    qualityScore: number;
  }> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const results: VerificationResult[] = [];

    // Get recent auto-executed actions — THIS organization's.
    const actions = await db.select()
      .from(agentEvents)
      .where(and(
        eq(agentEvents.organizationId, orgId),
        gte(agentEvents.createdAt, weekAgo),
        inArray(agentEvents.eventType, [
          "action_succeeded", "initiative_auto_executed",
        ]),
      ))
      .orderBy(desc(agentEvents.createdAt))
      .limit(100);

    for (const action of actions) {
      const payload = (action.payload ?? {}) as Record<string, any>;
      // `agent_events` has no agentCodename column; it is carried in the
      // payload. Resolved ONCE here and passed down — every verifier used to
      // read `action.agentCodename` off the row, which `action: any` hid and
      // which was `undefined` in every observed result the loop produced.
      const under: ActionUnderReview = {
        orgId,
        agentCodename: payload?.agentCodename ?? "unknown",
        actionType: payload?.action ?? "unknown",
        actionCreatedAt: action.createdAt ?? new Date(),
        payload,
      };

      try {
        let result: VerificationResult;

        switch (under.actionType) {
          case "send_follow_up":
            result = await this.verifyFollowUp(under);
            break;
          case "update_lead_status":
            result = await this.verifyLeadStatusChange(under);
            break;
          case "flag_deal_risk":
            result = await this.verifyDealRiskFlag(under);
            break;
          case "restart_failed_job":
            result = await this.verifyJobRestart(under);
            break;
          default:
            result = await this.recordSelfReport(under);
        }

        results.push(result);
      } catch { /* one unverifiable action must not end the pass */ }
    }

    // Count outcomes. `unverified` is deliberately NOT part of the denominator:
    // an action nobody observed cannot raise or lower a quality score, and
    // averaging it in as if it were a measured "no effect" would let the
    // absence of evidence masquerade as evidence.
    const positive = results.filter((r) => r.outcome === "positive").length;
    const negative = results.filter((r) => r.outcome === "negative").length;
    const neutral = results.filter((r) => r.outcome === "neutral").length;
    const unverified = results.filter((r) => r.outcome === "unverified").length;
    const verified = positive + negative + neutral;

    // Quality score over OBSERVED outcomes only, 0–100 centred at 50. With
    // nothing observed the answer is 50 — "we do not know" — which becomes a
    // 1.0 multiplier in autonomyScoreV14 and moves the score neither way.
    const qualityScore = verified > 0
      ? Math.round(((positive - negative) / verified) * 100 + 50)
      : 50;

    // Record verification results for trust evolution to query.
    for (const result of results) {
      try {
        await db.insert(agentEvents).values({
          organizationId: orgId,
          eventType: "outcome_verified",
          eventSource: "agent",
          // agent_events has no agentCodename column; carry it in the payload.
          payload: {
            agentCodename: result.agentCodename,
            action: result.action,
            outcome: result.outcome,
            reason: result.reason,
            orgId,
          },
        });
      } catch {}
    }

    logger.info(
      `[outcome-verification] org ${orgId}: ${verified} observed ` +
      `(${positive} positive, ${negative} negative, ${neutral} neutral), ` +
      `${unverified} unverified. Quality score: ${qualityScore}`,
    );

    return { verified, positive, negative, neutral, unverified, qualityScore };
  }

  /**
   * The daily pass, across every organization.
   *
   * The scheduled job used to call `verify(1)` — a hard-coded organization id —
   * which was harmless only because the queries had no tenant predicate and
   * therefore swept everyone anyway, filing the results under org 1. Now that
   * the predicate is real, "org 1" would mean "org 1 only", so the enumeration
   * has to be real too.
   */
  async verifyAllOrganizations(): Promise<{ organizations: number; observed: number }> {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    let observed = 0;
    for (const org of orgs) {
      try {
        const r = await this.verify(org.id);
        observed += r.verified;
      } catch (err) {
        logger.warn("[outcome-verification] organization pass failed", {
          metadata: { orgId: org.id, error: String(err) },
        });
      }
    }
    return { organizations: orgs.length, observed };
  }

  // ── Verification Methods ───────────────────────────────────────────────
  //
  // Each reads state the ACTOR DOES NOT AUTHOR, scoped to the actor's tenant.

  private async verifyFollowUp(under: ActionUnderReview): Promise<VerificationResult> {
    const base = { agentCodename: under.agentCodename, action: "send_follow_up", createdAt: under.actionCreatedAt };
    const leadId = under.payload?.actionInput?.leadId ?? under.payload?.leadId;
    if (!leadId) return { ...base, outcome: "unverified", reason: "No leadId to verify" };

    try {
      const [lead] = await db.select().from(leads)
        .where(and(eq(leads.id, leadId), eq(leads.organizationId, under.orgId)))
        .limit(1);
      if (!lead) {
        return { ...base, outcome: "unverified", reason: `Lead ${leadId} not found in this organization` };
      }
      const positiveStatuses = ["contacted", "qualified", "offer_sent", "under_contract"];
      if (positiveStatuses.includes(lead.status)) {
        return { ...base, outcome: "positive", reason: `Lead progressed to "${lead.status}" after follow-up` };
      }
      if (lead.status === "dead" || lead.status === "unsubscribed") {
        return { ...base, outcome: "negative", reason: `Lead went to "${lead.status}" after follow-up` };
      }
      // Observed, and it had not moved. That IS a measurement.
      return { ...base, outcome: "neutral", reason: `Lead status unchanged at "${lead.status}"` };
    } catch {
      return { ...base, outcome: "unverified", reason: "Lead lookup failed" };
    }
  }

  private async verifyLeadStatusChange(under: ActionUnderReview): Promise<VerificationResult> {
    const base = { agentCodename: under.agentCodename, action: "update_lead_status", createdAt: under.actionCreatedAt };
    const leadId = under.payload?.actionInput?.leadId ?? under.payload?.leadId;
    if (!leadId) return { ...base, outcome: "unverified", reason: "No leadId" };

    try {
      // deals has no leadId column; the lead → deal link is via the property
      // (properties.sellerId / buyerId reference leads). Join through it.
      const dealCount = await db.select({ count: sql<number>`count(*)::int` })
        .from(deals)
        .innerJoin(properties, eq(properties.id, deals.propertyId))
        .where(and(
          eq(deals.organizationId, under.orgId),
          eq(properties.organizationId, under.orgId),
          or(eq(properties.sellerId, leadId), eq(properties.buyerId, leadId)),
          gte(deals.createdAt, under.actionCreatedAt),
        ));

      if ((dealCount[0]?.count ?? 0) > 0) {
        return { ...base, outcome: "positive", reason: "Deal created after status change" };
      }
      return { ...base, outcome: "neutral", reason: "No downstream deal yet" };
    } catch {
      return { ...base, outcome: "unverified", reason: "Deal lookup failed" };
    }
  }

  private async verifyDealRiskFlag(under: ActionUnderReview): Promise<VerificationResult> {
    const base = { agentCodename: under.agentCodename, action: "flag_deal_risk", createdAt: under.actionCreatedAt };
    const dealId = under.payload?.actionInput?.dealId ?? under.payload?.dealId;
    if (!dealId) return { ...base, outcome: "unverified", reason: "No dealId" };

    try {
      const [deal] = await db.select().from(deals)
        .where(and(eq(deals.id, dealId), eq(deals.organizationId, under.orgId)))
        .limit(1);
      if (!deal) {
        return { ...base, outcome: "unverified", reason: `Deal ${dealId} not found in this organization` };
      }
      if (deal.status === "closed_won") {
        return { ...base, outcome: "negative", reason: "Deal closed won — risk flag was premature" };
      }
      if (deal.status === "closed_lost" || deal.status === "cancelled") {
        return { ...base, outcome: "positive", reason: "Deal lost/cancelled — risk flag was accurate" };
      }
      // Still open: the flag has not yet been proved right or wrong.
      return { ...base, outcome: "unverified", reason: `Deal still active at "${deal.status}" — flag not yet resolved` };
    } catch {
      return { ...base, outcome: "unverified", reason: "Deal lookup failed" };
    }
  }

  private async verifyJobRestart(under: ActionUnderReview): Promise<VerificationResult> {
    const base = { agentCodename: under.agentCodename, action: "restart_failed_job", createdAt: under.actionCreatedAt };
    const jobName = under.payload?.actionInput?.jobName ?? under.payload?.jobName;
    if (!jobName) return { ...base, outcome: "unverified", reason: "No jobName" };

    try {
      // `job_health_logs` is deliberately platform-global — scheduled jobs are
      // infrastructure, not tenant data — so there is no organization predicate
      // to add here. This is the one observation in the file that is not
      // tenant-scoped, because the thing being observed is not tenant-scoped.
      const { jobHealthLogs } = await import("@shared/schema");
      const successAfter = await db.select({ count: sql<number>`count(*)::int` })
        .from(jobHealthLogs)
        .where(and(
          eq(jobHealthLogs.jobName, jobName),
          eq(jobHealthLogs.status, "success"),
          gte(jobHealthLogs.createdAt, under.actionCreatedAt),
        ));

      if ((successAfter[0]?.count ?? 0) > 0) {
        return { ...base, outcome: "positive", reason: "Job succeeded after restart" };
      }

      const failAfter = await db.select({ count: sql<number>`count(*)::int` })
        .from(jobHealthLogs)
        .where(and(
          eq(jobHealthLogs.jobName, jobName),
          eq(jobHealthLogs.status, "failed"),
          gte(jobHealthLogs.createdAt, under.actionCreatedAt),
        ));

      if ((failAfter[0]?.count ?? 0) > 0) {
        return { ...base, outcome: "negative", reason: "Job failed again after restart" };
      }

      return { ...base, outcome: "unverified", reason: "No subsequent job run data" };
    } catch {
      return { ...base, outcome: "unverified", reason: "Job health lookup failed" };
    }
  }

  /**
   * For action types with no observation strategy: record what the ACTOR SAID,
   * and score nothing.
   *
   * This is the branch that used to manufacture a verdict. `agentActionLog` is
   * the actor's own record of its own execution — it says whether the call
   * returned, and eight of the ten sites that write it write the literal
   * `"success"` at issue time. It is testimony about execution, kept here for a
   * human reading the event stream, and it is not evidence about outcome. There
   * is no `agentActionLog` state — not `success`, not `failure`, not
   * `escalated`, not `pending` — that this method converts into a score.
   */
  private async recordSelfReport(under: ActionUnderReview): Promise<VerificationResult> {
    const base = { agentCodename: under.agentCodename, action: under.actionType, createdAt: under.actionCreatedAt };
    try {
      const { agentActionLog } = await import("@shared/schema");
      const [logEntry] = await db.select()
        .from(agentActionLog)
        .where(and(
          eq(agentActionLog.agentCodename, under.agentCodename),
          eq(agentActionLog.actionName, under.actionType),
          sql`${agentActionLog.createdAt} >= ${under.actionCreatedAt}`,
        ))
        .orderBy(desc(agentActionLog.createdAt))
        .limit(1);

      return {
        ...base,
        outcome: "unverified",
        reason: logEntry
          ? `No outcome observation for "${under.actionType}". The actor's own execution log reports "${logEntry.outcome}", which describes whether it ran, not whether it helped.`
          : `No outcome observation for "${under.actionType}", and no execution log entry either.`,
      };
    } catch {
      return { ...base, outcome: "unverified", reason: `No outcome observation for "${under.actionType}"` };
    }
  }
}

export const outcomeVerificationLoop = new OutcomeVerificationLoop();
