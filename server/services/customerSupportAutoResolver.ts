/**
 * Customer Support Auto-Resolver — Extracted from decisionsInbox.ts
 *
 * Handles automated customer support ticket resolution using a two-tier AI system:
 * 1. Sophie (primary): resolves high-confidence tickets directly
 * 2. Sophie Genius Mode (Opus): second opinion for borderline cases (40-89% confidence)
 *
 * This is a CUSTOMER-FACING service. It was previously embedded in the founder's
 * decisions inbox, which mixed customer support automation with founder decision-making.
 *
 * Now cleanly separated:
 *   - customerSupportAutoResolver → handles all automated ticket resolution
 *   - decisionsInbox → only receives tickets that NEITHER model could resolve
 *
 * Transparency: all auto-resolutions are logged so the founder can review
 * aggregate stats ("Sophie auto-resolved X tickets this week") without
 * being in the critical path.
 */

import { db } from "../db";
import { supportTickets, supportTicketMessages } from "@shared/schema";
import { eq, gte, count, and, desc } from "drizzle-orm";
import { logger } from "../utils/logger";

// Confidence thresholds per SOPHIE_CONFIDENCE_MODE env var
const CONFIDENCE_THRESHOLDS: Record<string, number> = {
  conservative: 90,
  balanced: 70,
  aggressive: 60,
};

function getConfidenceThreshold(): number {
  const mode = process.env.SOPHIE_CONFIDENCE_MODE ?? "balanced";
  return CONFIDENCE_THRESHOLDS[mode] ?? 70;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOPHIE GENIUS MODE — Opus second opinion for borderline support tickets
//
// When Sophie's confidence is 40-89% (borderline), instead of immediately
// escalating to the founder inbox, we call Opus with the full ticket context.
//
// If Opus confidence >= 80%, we auto-resolve.
// If Opus < 80%, the ticket goes to the decisions inbox for founder review.
//
// Net effect: 90%+ of support tickets never reach any human.
// ─────────────────────────────────────────────────────────────────────────────

async function sophieGeniusMode(
  ticketId: number,
  originalDraft: string | undefined,
  sophieAnalysis: string | undefined,
  category: string,
): Promise<{ resolved: boolean; response?: string; confidence: number }> {
  try {
    const ticket = await db.query.supportTickets.findFirst({
      where: eq(supportTickets.id, ticketId),
    });
    if (!ticket) return { resolved: false, confidence: 0 };

    const messages = await db.select()
      .from(supportTicketMessages)
      .where(eq(supportTicketMessages.ticketId, ticketId))
      .orderBy(supportTicketMessages.createdAt)
      .limit(15);

    const { routeCriticalTask } = await import("./aiRouter");
    const aiResponse = await routeCriticalTask(
      "executive_decision",
      `You are Pax, the AcreOS assistant — the senior support specialist persona for the platform.
AcreOS is a land investment management platform (CRM, deal pipeline, seller-financed notes, AI agents, marketplace).

A previous, lower-confidence Pax draft attempt was made on this ticket. Review the full context and produce a definitive, high-quality customer reply.

RESPONSE FORMAT (JSON only):
{
  "confidence": 0-100,
  "response": "the full support response to send to the customer",
  "internalNote": "brief note on what you think the root cause is"
}

Sign the customer-facing response as Pax / AcreOS Support. Do not refer to yourself by any internal codename. Be direct and helpful. Resolve the ticket if at all possible. Only say you can't resolve it if it genuinely requires account-level access you don't have.`,

      `SUPPORT TICKET #${ticketId}
Subject: ${ticket.subject ?? "No subject"}
Category: ${category}
Status: ${ticket.status}
Organization ID: ${ticket.organizationId ?? "unknown"}

CONVERSATION:
${messages.map(m => `[${m.senderName}]: ${m.content}`).join("\n\n---\n\n")}

PRIOR INTERNAL ANALYSIS: ${sophieAnalysis ?? "No analysis provided"}
PRIOR DRAFT (use as starting point or improve): ${originalDraft ?? "None"}

Please provide a definitive resolution. Address the customer as Pax / AcreOS Support — do not echo any internal codenames.`,
    );

    const parsed = JSON.parse(aiResponse.content.replace(/```json\n?|```/g, "").trim());
    const confidence = Math.max(0, Math.min(100, parseInt(parsed.confidence) || 0));

    if (confidence >= 80 && parsed.response) {
      // Opus is confident — auto-send
      await db.insert(supportTicketMessages).values({
        ticketId,
        senderId: "sophie_genius",
        senderName: "AcreOS Support",
        content: parsed.response,
        messageType: "reply",
        isInternal: false,
      } as any);
      await db.update(supportTickets)
        .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId));
      return { resolved: true, response: parsed.response, confidence };
    }

    return { resolved: false, response: parsed.response, confidence };
  } catch (err: any) {
    logger.warn("[SophieGeniusMode] Opus second-opinion failed", { metadata: { detail: err.message } });
    return { resolved: false, confidence: 0 };
  }
}

// ─── Exported Service ─────────────────────────────────────────────────────────

export const customerSupportAutoResolver = {

  /**
   * Attempt to auto-resolve a support ticket.
   *
   * Resolution ladder:
   *   1. confidence >= threshold → Sophie auto-resolves directly
   *   2. confidence 40-89% → Sophie Genius Mode (Opus second opinion)
   *      - If Opus >= 80% → auto-resolves
   *      - If Opus < 80% → returns false (caller should create inbox item)
   *   3. confidence < 40% → Opus genius mode, then returns false if needed
   *
   * Returns { autoResolved: true } if the ticket was handled without founder.
   * Returns { autoResolved: false } if it needs to go to the decisions inbox.
   */
  async attemptResolution(ticketId: number, opts?: {
    sophieAnalysis?: string;
    draftResponse?: string;
    confidenceScore?: number;
    category?: string;
  }): Promise<{ autoResolved: boolean; geniusResponse?: string; geniusConfidence?: number }> {
    const ticket = await db.query.supportTickets.findFirst({
      where: eq(supportTickets.id, ticketId),
    });
    if (!ticket) return { autoResolved: false };

    const threshold = getConfidenceThreshold();
    const confidence = opts?.confidenceScore ?? 0;
    const isBilling = (opts?.category ?? ticket.category ?? "") === "billing";
    const effectiveThreshold = isBilling ? 90 : threshold;

    // Path 1: Sophie is confident — auto-resolve directly
    // (Internal codename `sophie` retained for senderId / agent telemetry; customer-facing
    // senderName is the Pax-canonical brand. Customers must never see internal codenames.)
    if (confidence >= effectiveThreshold && opts?.draftResponse) {
      await db.insert(supportTicketMessages).values({
        ticketId,
        senderId: "sophie",
        senderName: "Pax (AcreOS Support)",
        content: opts.draftResponse,
        messageType: "reply",
        isInternal: false,
      });
      await db.update(supportTickets)
        .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId));

      logger.info(`[AutoResolver] Ticket #${ticketId} auto-resolved by Sophie (confidence: ${confidence}%)`);
      return { autoResolved: true };
    }

    // Path 2: Sophie Genius Mode — Opus second opinion for borderline cases
    // Skip for billing tickets (too risky for auto-resolve)
    const shouldTryGenius = confidence >= 40 && !isBilling;
    if (shouldTryGenius) {
      const geniusResult = await sophieGeniusMode(
        ticketId,
        opts?.draftResponse,
        opts?.sophieAnalysis,
        opts?.category ?? ticket.category ?? "general",
      );
      if (geniusResult.resolved) {
        logger.info(`[AutoResolver] Ticket #${ticketId} auto-resolved by Genius Mode (confidence: ${geniusResult.confidence}%)`);
        return { autoResolved: true };
      }
      // Pass back the genius response/confidence for the inbox item context
      return {
        autoResolved: false,
        geniusResponse: geniusResult.response,
        geniusConfidence: geniusResult.confidence,
      };
    }

    // Path 3: Low confidence + billing → goes straight to inbox
    return { autoResolved: false };
  },

  /**
   * Get auto-resolution stats for the founder briefing.
   * Shows how many tickets were handled without founder intervention.
   */
  async getResolutionStats(periodHours: number = 24): Promise<{
    sophieAutoResolved: number;
    geniusAutoResolved: number;
    totalAutoResolved: number;
    escalatedToFounder: number;
  }> {
    const since = new Date(Date.now() - periodHours * 60 * 60 * 1000);

    const [sophieResult] = await db.select({ c: count() })
      .from(supportTicketMessages)
      .where(and(
        eq(supportTicketMessages.senderId, "sophie"),
        gte(supportTicketMessages.createdAt, since),
      ));

    const [geniusResult] = await db.select({ c: count() })
      .from(supportTicketMessages)
      .where(and(
        eq(supportTicketMessages.senderId, "sophie_genius"),
        gte(supportTicketMessages.createdAt, since),
      ));

    const sophieCount = Number(sophieResult?.c ?? 0);
    const geniusCount = Number(geniusResult?.c ?? 0);

    return {
      sophieAutoResolved: sophieCount,
      geniusAutoResolved: geniusCount,
      totalAutoResolved: sophieCount + geniusCount,
      escalatedToFounder: 0, // populated by decisionsInbox
    };
  },

  getConfidenceThreshold,
};
