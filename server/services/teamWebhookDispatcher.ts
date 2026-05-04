/**
 * Slack / Teams webhook dispatcher — Phase 5 §5 Part D (team readiness).
 *
 * Fires-and-forgets a JSON payload to every active org_integrations_slack
 * row whose `eventTypes` includes the requested event. Slack uses the
 * Incoming Webhook payload format ({ text }); Teams uses the simpler
 * MessageCard format. Failures are caught and logged so a misconfigured
 * webhook never breaks a deal-closed workflow.
 *
 * Supported event keys:
 *   • deal_closed       — payload: { dealId, propertyAddress, purchasePrice }
 *   • big_lead_arrived  — payload: { leadId, ownerName, score, source }
 *   • offer_pending_approval — payload: { offerId, offerAmount, threshold }
 */

import { db } from "../storage";
import { orgIntegrationsSlack } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export type TeamEventKey =
  | "deal_closed"
  | "big_lead_arrived"
  | "offer_pending_approval";

interface DispatchPayload {
  title: string;
  body: string;
  context?: Record<string, unknown>;
}

export async function dispatchTeamEvent(
  organizationId: number,
  eventKey: TeamEventKey,
  payload: DispatchPayload,
): Promise<void> {
  try {
    const integrations = await db
      .select()
      .from(orgIntegrationsSlack)
      .where(
        and(
          eq(orgIntegrationsSlack.organizationId, organizationId),
          eq(orgIntegrationsSlack.isActive, true),
        ),
      );

    const targets = integrations.filter((i) =>
      Array.isArray(i.eventTypes) && i.eventTypes.includes(eventKey),
    );
    if (targets.length === 0) return;

    await Promise.allSettled(
      targets.map(async (target) => {
        const body = target.provider === "teams"
          ? buildTeamsPayload(payload)
          : buildSlackPayload(payload);
        try {
          const response = await fetch(target.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!response.ok) {
            const text = await response.text().catch(() => "");
            await markError(target.id, `HTTP ${response.status}: ${text.slice(0, 200)}`);
          } else {
            await markDispatched(target.id);
          }
        } catch (err) {
          await markError(target.id, (err as Error).message);
        }
      }),
    );
  } catch (err) {
    logger.warn("dispatchTeamEvent failed", {
      organizationId,
      eventKey,
      error: (err as Error).message,
    });
  }
}

function buildSlackPayload(p: DispatchPayload) {
  return {
    text: `*${p.title}*\n${p.body}`,
    attachments: p.context ? [{ text: JSON.stringify(p.context, null, 2) }] : undefined,
  };
}

function buildTeamsPayload(p: DispatchPayload) {
  return {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    summary: p.title,
    title: p.title,
    text: p.body,
    sections: p.context
      ? [{
          facts: Object.entries(p.context).map(([name, value]) => ({
            name,
            value: String(value),
          })),
        }]
      : undefined,
  };
}

async function markDispatched(integrationId: number): Promise<void> {
  try {
    await db
      .update(orgIntegrationsSlack)
      .set({ lastDispatchedAt: new Date(), lastError: null })
      .where(eq(orgIntegrationsSlack.id, integrationId));
  } catch { /* non-fatal */ }
}

async function markError(integrationId: number, message: string): Promise<void> {
  try {
    await db
      .update(orgIntegrationsSlack)
      .set({ lastError: message })
      .where(eq(orgIntegrationsSlack.id, integrationId));
  } catch { /* non-fatal */ }
}
