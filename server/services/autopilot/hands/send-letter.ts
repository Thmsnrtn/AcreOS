/**
 * Founder Autopilot — send_letter hand (Hands roadmap P1.4).
 *
 * Thin adapter over mailProvider.sendLetter (Lob). Direct mail is the
 * land-investor-native channel — how land deals actually get sourced. It is
 * also higher-cost and irreversible once mailed, so beyond the standard
 * witnessed-send tap it is a natural fit for the risk-calibrated gate
 * (riskautonomy escalates on value). Lob runs in test mode until the founder
 * sets a live key, so an approved send is a no-cost proof until then.
 */
import { registerHand } from "./registry";
import { handError, type HandResult } from "./types";
import { sendLetter, type MailAddress } from "../../mailProvider";

const NAME = "send_letter";

function parseAddress(v: unknown): MailAddress | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  const name = String(a.name ?? "").trim();
  const addressLine1 = String(a.address_line1 ?? a.addressLine1 ?? "").trim();
  const city = String(a.city ?? "").trim();
  const state = String(a.state ?? "").trim();
  const zip = String(a.zip ?? "").trim();
  if (!name || !addressLine1 || !city || !state || !zip) return null;
  const addressLine2 = a.address_line2 ?? a.addressLine2;
  return {
    name,
    addressLine1,
    addressLine2: typeof addressLine2 === "string" ? addressLine2 : undefined,
    city,
    state,
    zip,
  };
}

async function handler(input: Record<string, unknown>): Promise<HandResult> {
  const started = Date.now();
  try {
    const to = parseAddress(input.to);
    const from = parseAddress(input.from);
    const file = String(input.file ?? "").trim();
    const organizationId = typeof input.organization_id === "number" ? input.organization_id : undefined;
    if (!to || !from || !file) {
      return { success: false, output: "send_letter: a complete 'to' + 'from' address and a 'file' (PDF URL) are required.", durationMs: Date.now() - started };
    }
    const result = await sendLetter({ to, from, file, organizationId, description: typeof input.description === "string" ? input.description : undefined });
    if (!result.success) {
      return { success: false, output: `send_letter failed: ${result.error ?? "unknown"}`, durationMs: Date.now() - started };
    }
    return {
      success: true,
      output: JSON.stringify({ mailingId: result.mailingId, isTestMode: result.isTestMode, cost: result.cost, expectedDelivery: result.expectedDeliveryDate }),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return handError(NAME, err, started);
  }
}

registerHand({
  name: NAME,
  schema: {
    name: NAME,
    description:
      "Mail a physical letter via Lob (the land-investor-native channel). Higher-cost + irreversible once mailed. Runs in Lob test mode until a live key is set. REQUIRES a founder tap.",
    input_schema: {
      type: "object",
      properties: {
        to: {
          type: "object",
          properties: {
            name: { type: "string" },
            address_line1: { type: "string" },
            address_line2: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            zip: { type: "string" },
          },
          required: ["name", "address_line1", "city", "state", "zip"],
        },
        from: {
          type: "object",
          properties: {
            name: { type: "string" },
            address_line1: { type: "string" },
            address_line2: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            zip: { type: "string" },
          },
          required: ["name", "address_line1", "city", "state", "zip"],
        },
        file: { type: "string", description: "URL to the letter PDF." },
        organization_id: { type: "number" },
        description: { type: "string" },
      },
      required: ["to", "from", "file"],
    },
  },
  domain: "growth",
  isCustomerFacing: true,
  requiresApproval: true,
  surface: "content",
  handler,
});
