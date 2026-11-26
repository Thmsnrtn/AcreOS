/**
 * Founder Autopilot — send_letter hand (Hands roadmap P1.4).
 *
 * Thin adapter over the canonical direct-mail operation in
 * directMailService.ts (K7-2a: this hand used to call mailProvider's own
 * Lob send paths; those are retired). Direct mail is the
 * land-investor-native channel — how land deals actually get sourced. It is
 * also higher-cost and irreversible once mailed, so beyond the standard
 * witnessed-send tap it is a natural fit for the risk-calibrated gate
 * (riskautonomy escalates on value). Lob runs in test mode until the founder
 * sets a live key, so an approved send is a no-cost proof until then.
 *
 * Shape mapping (the hand is {to, from, file}-shaped; the canonical
 * operation is sender-identity-shaped):
 *
 *   ORG sends (organization_id present) → directMailService.sendLetter.
 *   The lane is resolved first, exactly as the retired path resolved it:
 *   a HOUSE piece prints under the lane's verified sender identity (the
 *   typed `from` is replaced — the retired path's behaviour, preserved);
 *   an OWN-ACCOUNT piece prints the typed `from` exactly as given; a
 *   REFUSED lane returns the lane's own message and nothing is sent.
 *   The canonical operation then re-resolves the lane internally, takes
 *   the house charge, and refunds it only when Lob certainly did not bill
 *   (its withBillingVerdict machinery — the retired path's
 *   providerNotBilled verdict, now owned by the operation itself).
 *
 *   ORG-LESS sends (no organization_id) → directMailService.sendSystemLetter,
 *   the narrow system-send path: AcreOS's own mail on the platform key
 *   under the live-send interlock, typed `from` printed as given, no
 *   charge. This hand — founder-tap-gated — is its only caller.
 *
 * Timeout: the retired path raced Lob against an 18s timer ('lob timeout',
 * retryable, billing unknown). The canonical operation has no timeout, so
 * the ORG call is raced here with the same timer and the same distinct
 * error; the system path carries its own identical timer inside
 * directMailService.
 */
import { registerHand } from "./registry";
import { handError, type HandResult } from "./types";
import { sendLetter as sendCanonicalLetter, sendSystemLetter, type SystemLetterOptions } from "../../directMailService";
import { resolveMailLane, letterSpec } from "../../mail/mailLane";
import { getProviderInfo, MailProvider, type MailAddress } from "../../mailProvider";
import type { MailSenderIdentity } from "@shared/schema";
import { clock } from "../../../utils/clock";

const NAME = "send_letter";

// Bounded timeout for the canonical send (carried over from the retired
// mailProvider path): a stalled Lob endpoint must not hang the hand.
const LOB_TIMEOUT_MS = 18_000;

class LobTimeoutError extends Error {
  constructor() {
    super('lob timeout');
    this.name = 'LobTimeoutError';
  }
}

function withLobTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LobTimeoutError()), LOB_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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

function toRecipientAddress(a: MailAddress) {
  return { line1: a.addressLine1, line2: a.addressLine2, city: a.city, state: a.state, zip: a.zip };
}

/**
 * The typed `from`, mapped onto the canonical operation's sender-identity
 * shape. Only the address fields are ever read (the operation prints them
 * as the return address); on the own-account lane the lane resolver ignores
 * the identity's verification state, so an org printing on its OWN Lob key
 * keeps the typed return address exactly as the retired path printed it.
 */
function typedSenderIdentity(from: MailAddress, organizationId: number): MailSenderIdentity {
  return {
    organizationId,
    name: from.name,
    companyName: from.name,
    addressLine1: from.addressLine1,
    addressLine2: from.addressLine2 ?? null,
    city: from.city,
    state: from.state,
    zipCode: from.zip,
  } as unknown as MailSenderIdentity;
}

async function handler(input: Record<string, unknown>): Promise<HandResult> {
  const started = clock.nowMs();
  const fail = (error: string): HandResult => ({
    success: false,
    output: `send_letter failed: ${error}`,
    durationMs: clock.nowMs() - started,
  });
  try {
    const to = parseAddress(input.to);
    const from = parseAddress(input.from);
    const file = String(input.file ?? "").trim();
    const organizationId = typeof input.organization_id === "number" ? input.organization_id : undefined;
    if (!to || !from || !file) {
      return { success: false, output: "send_letter: a complete 'to' + 'from' address and a 'file' (PDF URL) are required.", durationMs: clock.nowMs() - started };
    }
    const description = typeof input.description === "string" ? input.description : undefined;
    // The recorded per-piece cost the retired path reported (mailProvider's
    // cost table, still the single source via getProviderInfo).
    const cost = getProviderInfo().costs[MailProvider.LOB].letter;

    if (organizationId === undefined) {
      // Org-less system mail — the narrow platform-key path in the
      // canonical module. Its errors already carry the retired path's
      // exact messages ('mail provider not configured', 'lob timeout').
      const result = await sendSystemLetter({
        recipientName: to.name,
        recipientAddress: toRecipientAddress(to),
        senderName: from.name,
        senderAddress: toRecipientAddress(from),
        htmlContent: file,
        description,
      } satisfies SystemLetterOptions);
      return {
        success: true,
        output: JSON.stringify({ mailingId: result.lobId, isTestMode: result.testMode, cost, expectedDelivery: result.expectedDeliveryDate }),
        durationMs: clock.nowMs() - started,
      };
    }

    // Org mail: resolve the lane first (the retired path's planLobSend did
    // the same) so the printed return address is the lane's decision —
    // verified identity on the house lane, the typed `from` on the org's
    // own account — and a refusal surfaces the lane's own message.
    const lane = await resolveMailLane(organizationId, letterSpec({ color: false, file }), { via: 'lob' });
    if (lane.lane === 'refused') return fail(lane.message);
    const senderIdentity = lane.lane === 'house' ? lane.senderIdentity : typedSenderIdentity(from, organizationId);

    const result = await withLobTimeout(sendCanonicalLetter({
      organizationId,
      senderIdentity,
      recipientName: to.name,
      recipientAddress: toRecipientAddress(to),
      htmlContent: file,
      description,
    }));
    return {
      success: true,
      output: JSON.stringify({ mailingId: result.lobId, isTestMode: result.testMode, cost, expectedDelivery: result.expectedDeliveryDate }),
      durationMs: clock.nowMs() - started,
    };
  } catch (err) {
    if (err instanceof LobTimeoutError) return fail('lob timeout');
    // The canonical operation throws (lane refusals before contact, Lob
    // failures with its billing verdict attached); the retired path
    // returned {success:false, error} — the hand's contract to its caller
    // is unchanged, so the message is surfaced the same way.
    if (err instanceof Error) return fail(err.message);
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
  // Declared explicitly (required since 2026-08-18): One recipient. Lob postage is our cost, not customer money moving — contrast run-ad-campaign, where the spend IS the action.
  movesMoney: false,
  outwardClass: "none",
  requiresApproval: true,
  surface: "content",
  handler,
});
