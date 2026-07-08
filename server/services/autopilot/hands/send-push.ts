/**
 * Founder Autopilot — send_push hand (Hands roadmap P1.3).
 *
 * Thin adapter over pushNotificationService.sendPushToUser. Web push is the
 * lowest-risk outward channel: delivery requires an opt-in subscription the
 * user created, and an expired subscription is auto-pruned. Still treated as
 * customer-facing + approval-required for consistency — the founder taps before
 * any message leaves the building.
 */
import { registerHand } from "./registry";
import { handError, type HandResult } from "./types";
import { sendPushToUser } from "../../pushNotificationService";

const NAME = "send_push";

async function handler(input: Record<string, unknown>): Promise<HandResult> {
  const started = Date.now();
  try {
    const organizationId = typeof input.organization_id === "number" ? input.organization_id : NaN;
    const userId = String(input.user_id ?? "").trim();
    const title = String(input.title ?? "").trim();
    const body = String(input.body ?? "").trim();
    if (!Number.isFinite(organizationId) || !userId || !title || !body) {
      return { success: false, output: "send_push: 'organization_id', 'user_id', 'title', and 'body' are required.", durationMs: Date.now() - started };
    }
    const url = typeof input.url === "string" ? input.url : undefined;
    const { sent, failed } = await sendPushToUser(organizationId, userId, { title, body, url });
    return { success: sent > 0, output: JSON.stringify({ sent, failed }), durationMs: Date.now() - started };
  } catch (err) {
    return handError(NAME, err, started);
  }
}

registerHand({
  name: NAME,
  schema: {
    name: NAME,
    description:
      "Send a web push notification to a user's subscribed devices. Lowest-risk channel (opt-in). REQUIRES a founder tap.",
    input_schema: {
      type: "object",
      properties: {
        organization_id: { type: "number" },
        user_id: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        url: { type: "string", description: "Optional deep-link to open on tap." },
      },
      required: ["organization_id", "user_id", "title", "body"],
    },
  },
  domain: "support",
  isCustomerFacing: true,
  requiresApproval: true,
  surface: "generic",
  handler,
});
