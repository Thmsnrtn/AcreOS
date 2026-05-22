/**
 * Telnyx CommsProvider adapter — STUBBED + DISABLED.
 *
 * The Telnyx account doesn't exist yet. Per the Phase 0 revenue-trigger
 * ladder, signup happens at $3k MRR (A2P 10DLC brand registration $50 +
 * per-campaign fee). Until then this adapter exists only so the router
 * can type-check against the same CommsProvider interface and the
 * `comms.providers.enabled` setting can list "telnyx" the moment the
 * envvar lands.
 *
 * Every method throws `TELNYX_NOT_CONFIGURED` unless `TELNYX_API_KEY` is
 * set in the process env. `isConfigured()` is the single source of
 * truth — once true, the methods can be filled in with real Telnyx REST
 * calls without touching the router.
 *
 * TODO(revenue-trigger): activate at $3k MRR. See plan
 * /Users/user/.claude/plans/how-can-we-either-ticklish-ocean.md.
 */
import type { Request } from "express";
import {
  registerProvider,
  type CommsProvider,
  type SendSmsOpts,
  type SendSmsResult,
  type InitiateCallOpts,
  type InitiateCallResult,
  type RentNumberOpts,
  type RentNumberResult,
  type CostEstimateOpts,
} from "../router";

const TELNYX_DISABLED_ERROR = "TELNYX_NOT_CONFIGURED";

function ensureConfigured(): void {
  if (!process.env.TELNYX_API_KEY) {
    throw new Error(TELNYX_DISABLED_ERROR);
  }
}

/**
 * Universal BYOK (2026-05-22): resolve the effective Telnyx API key for
 * `organizationId`. Returns the BYOK key when present, else the platform
 * default from TELNYX_API_KEY. Used once Telnyx is activated; today every
 * send still throws TELNYX_NOT_CONFIGURED at the platform layer.
 */
export async function resolveTelnyxApiKey(organizationId?: number): Promise<string | null> {
  if (organizationId != null) {
    try {
      const { getEffectiveCredential } = await import("../../byok/toggle");
      const eff = await getEffectiveCredential(organizationId, "telnyx");
      if (eff.credential) return eff.credential;
    } catch {
      /* fall through to platform env */
    }
  }
  return process.env.TELNYX_API_KEY ?? null;
}

class TelnyxProvider implements CommsProvider {
  readonly name = "telnyx" as const;

  isConfigured(): boolean {
    return !!process.env.TELNYX_API_KEY;
  }

  async sendSms(_opts: SendSmsOpts): Promise<SendSmsResult> {
    ensureConfigured();
    // TODO(revenue-trigger): implement Telnyx Messaging API call.
    throw new Error(TELNYX_DISABLED_ERROR);
  }

  async initiateCall(_opts: InitiateCallOpts): Promise<InitiateCallResult> {
    ensureConfigured();
    // TODO(revenue-trigger): implement Telnyx Call Control API.
    throw new Error(TELNYX_DISABLED_ERROR);
  }

  async rentNumber(_opts: RentNumberOpts): Promise<RentNumberResult> {
    ensureConfigured();
    // TODO(revenue-trigger): implement Telnyx Number Search + Order.
    throw new Error(TELNYX_DISABLED_ERROR);
  }

  async releaseNumber(_number: string): Promise<void> {
    ensureConfigured();
    // TODO(revenue-trigger): implement Telnyx number release.
    throw new Error(TELNYX_DISABLED_ERROR);
  }

  webhookSignatureValid(_req: Request): boolean {
    // Telnyx signs webhooks with Ed25519 (telnyx-signature-ed25519 header).
    // Until activated, never trust an inbound Telnyx webhook.
    return false;
  }

  estimateCostCents(opts: CostEstimateOpts): number {
    // Published Telnyx US rates, used so the router can compare against
    // Twilio even before activation. Once configured we'll refresh these
    // from `comms_provider_quotes`.
    switch (opts.kind) {
      case "sms":
        // Telnyx US SMS ≈ $0.004 — rounds to <1¢; report 1¢ minimum so
        // integer math doesn't undercount.
        return 1;
      case "voice":
        // $0.007/min outbound — cents-per-minute × minutes.
        return Math.max(1, Math.ceil(0.7 * (opts.durationMinutes ?? 1)));
      case "number":
        // Telnyx local number ≈ $1.00/mo.
        return 100;
    }
  }
}

export const telnyxProvider = new TelnyxProvider();
registerProvider(telnyxProvider);
