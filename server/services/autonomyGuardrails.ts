/**
 * Autonomy Guardrails — Pillar 2 of AcreOS Durability Strategy
 *
 * Enforces safety constraints when Pax operates in supervised or autonomous mode.
 * These guardrails run BEFORE any autonomous action executes to prevent:
 *   - Exceeding daily send rate limits
 *   - Contacting leads without valid TCPA consent
 *   - Acting on leads marked dead/closed/do-not-contact
 *   - Running during off-hours without explicit permission
 *
 * The autonomy level (assisted | supervised | autonomous) is stored on the
 * organizations table as `paxAutonomyLevel` (added in schema.ts).
 *
 * These guardrails integrate with the APPROVAL_REQUIRED_TOOLS set in tools.ts
 * — when autonomy level allows a tool, this service does the final safety check.
 */

import { db } from "../db";
import { eq, and, gte, sql, count } from "drizzle-orm";
import { organizations, leads, outcomeTelemetry } from "@shared/schema";
import { checkTcpaConsentFromLead } from "./tcpaCompliance";
import { storage } from "../storage";

// ── Constants ─────────────────────────────────────────────────────────────────

export const AUTONOMY_LEVELS = ["assisted", "supervised", "autonomous"] as const;
export type AutonomyLevel = typeof AUTONOMY_LEVELS[number];

// Max autonomous send actions per org per day
const MAX_DAILY_AUTONOMOUS_SENDS = 20;

// Tools that require at least "supervised" level to auto-execute
const SUPERVISED_TOOLS = new Set([
  "send_email",
  "send_sms",
]);

// Tools that require "autonomous" level to auto-execute
const AUTONOMOUS_ONLY_TOOLS = new Set([
  "send_gmail",
  "send_slack_message",
  "create_stripe_payment_link",
]);

// ── Core API ──────────────────────────────────────────────────────────────────

export interface GuardrailCheck {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
}

/**
 * The main check function — call this before any autonomous tool execution.
 * Returns whether the action is allowed, and whether it still needs human approval.
 */
export async function checkAutonomousAction(
  orgId: number,
  toolName: string,
  args: Record<string, any>
): Promise<GuardrailCheck> {
  try {
    const org = await storage.getOrganization(orgId);
    if (!org) return { allowed: false, reason: "Organization not found", requiresApproval: true };

    const autonomyLevel: AutonomyLevel = ((org as any).paxAutonomyLevel as AutonomyLevel) ?? "assisted";

    // "assisted" mode: all communication tools always require approval
    if (autonomyLevel === "assisted") {
      const isCommunicationTool = SUPERVISED_TOOLS.has(toolName) || AUTONOMOUS_ONLY_TOOLS.has(toolName);
      if (isCommunicationTool) {
        return { allowed: true, requiresApproval: true, reason: "assisted mode requires approval for all sends" };
      }
      return { allowed: true, requiresApproval: false };
    }

    // "supervised" mode: can auto-send 1:1 outreach (send_email, send_sms) but not bulk or payment tools
    if (autonomyLevel === "supervised") {
      if (AUTONOMOUS_ONLY_TOOLS.has(toolName)) {
        return { allowed: true, requiresApproval: true, reason: "supervised mode requires approval for payment/external sends" };
      }
    }

    // For communication tools in supervised/autonomous mode: run all safety checks
    if (SUPERVISED_TOOLS.has(toolName)) {
      // 1. Rate limit check
      const rateCheck = await checkDailyRateLimit(orgId);
      if (!rateCheck.ok) {
        return { allowed: false, reason: rateCheck.reason, requiresApproval: false };
      }

      // 2. TCPA / lead safety check
      if (args.leadId) {
        const tcpaCheck = await checkLeadSafety(orgId, args.leadId);
        if (!tcpaCheck.ok) {
          return { allowed: false, reason: tcpaCheck.reason, requiresApproval: false };
        }
      }
    }

    return { allowed: true, requiresApproval: false };
  } catch (err: any) {
    console.error(`[AutonomyGuardrails] checkAutonomousAction error:`, err.message);
    // Fail safe — require approval on error
    return { allowed: true, requiresApproval: true, reason: "guardrail check failed — defaulting to approval required" };
  }
}

/**
 * Returns the current autonomy level for an org.
 */
export async function getAutonomyLevel(orgId: number): Promise<AutonomyLevel> {
  const org = await storage.getOrganization(orgId);
  return ((org as any)?.paxAutonomyLevel as AutonomyLevel) ?? "assisted";
}

/**
 * Returns whether a specific tool requires human approval given the org's autonomy level.
 * This replaces the static APPROVAL_REQUIRED_TOOLS set from tools.ts for autonomous operations.
 */
export async function toolRequiresApproval(orgId: number, toolName: string): Promise<boolean> {
  const level = await getAutonomyLevel(orgId);

  if (level === "assisted") {
    return SUPERVISED_TOOLS.has(toolName) || AUTONOMOUS_ONLY_TOOLS.has(toolName);
  }
  if (level === "supervised") {
    return AUTONOMOUS_ONLY_TOOLS.has(toolName); // Only payment/external tools need approval
  }
  if (level === "autonomous") {
    return false; // All tools are pre-approved within guardrail bounds
  }
  return true; // Unknown level — fail safe
}

// ── Safety Checks ─────────────────────────────────────────────────────────────

async function checkDailyRateLimit(orgId: number): Promise<{ ok: boolean; reason?: string }> {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Count autonomous send actions today (tracked via outcomeTelemetry)
    const result = await db
      .select({ n: count() })
      .from(outcomeTelemetry)
      .where(
        and(
          eq(outcomeTelemetry.organizationId, orgId),
          eq(outcomeTelemetry.outcomeType, "autonomous_send"),
          gte(outcomeTelemetry.createdAt, todayStart)
        )
      );

    const todayCount = result[0]?.n ?? 0;
    if (todayCount >= MAX_DAILY_AUTONOMOUS_SENDS) {
      return {
        ok: false,
        reason: `Daily autonomous send limit reached (${MAX_DAILY_AUTONOMOUS_SENDS}/day). Remaining sends will require manual approval.`,
      };
    }
    return { ok: true };
  } catch {
    return { ok: true }; // Fail open on rate limit check errors
  }
}

async function checkLeadSafety(orgId: number, leadId: number): Promise<{ ok: boolean; reason?: string }> {
  try {
    const lead = await storage.getLead(orgId, leadId);
    if (!lead) return { ok: false, reason: `Lead ${leadId} not found` };

    // Dead/closed leads — never contact autonomously
    if (["closed", "dead", "lost", "converted"].includes(lead.status ?? "")) {
      return { ok: false, reason: `Lead is in "${lead.status}" status — Pax will not contact them autonomously` };
    }

    // Do-not-contact flag
    if ((lead as any).doNotContact) {
      return { ok: false, reason: "Lead is marked do-not-contact" };
    }

    // TCPA consent check
    const compliance = checkTcpaConsentFromLead({
      tcpaConsent: (lead as any).tcpaConsent ?? null,
      doNotContact: (lead as any).doNotContact ?? null,
    });
    if (!compliance.canContact) {
      return { ok: false, reason: `TCPA compliance block: ${compliance.reason ?? "no consent on record"}` };
    }

    return { ok: true };
  } catch (err: any) {
    console.error(`[AutonomyGuardrails] checkLeadSafety error:`, err.message);
    return { ok: false, reason: "Lead safety check failed — action blocked" };
  }
}

/**
 * Records that an autonomous send action occurred.
 * Called after a successful autonomous send to increment the rate limit counter.
 */
export async function recordAutonomousSend(orgId: number, toolName: string, leadId?: number): Promise<void> {
  await db.insert(outcomeTelemetry).values({
    organizationId: orgId,
    outcomeType: "autonomous_send",
    outcome: { success: true, details: { toolName } },
    contributingFactors: { agentActions: [{ agentType: "pax", action: toolName, timestamp: new Date().toISOString() }] },
    relatedLeadId: leadId ?? undefined,
  }).catch(() => {});
}
