/**
 * Pillar 5 — Communications Router.
 *
 * One choke point for every outbound SMS / voice / number-rental request,
 * with a pluggable provider interface so we can flip carriers (Twilio →
 * Telnyx → Bandwidth) by editing a row in `founder_settings` rather than
 * by re-deploying.
 *
 * The contract is intentionally narrow: providers expose just enough
 * surface for the caller (smsService, voiceService, tracking-pool) to do
 * its job. Anything provider-specific (Twilio SID format, Telnyx app id,
 * etc.) stays inside the adapter.
 *
 * Cost-based routing is the whole point — see route() below. Tom's $0
 * working-capital constraint means every fractional cent matters once
 * we're at scale, and the router is where that math gets applied.
 */
import type { Request } from "express";
import { logger } from "../../utils/logger";
import { getSetting } from "../founderSettings";

export type CommsProviderName = "twilio" | "telnyx" | "bandwidth";

// Module-level registry declared BEFORE anything else so circular
// imports (provider adapters re-importing this module) don't trip on a
// TDZ violation. See ensureProvidersRegistered() below for activation.
const REGISTRY = new Map<CommsProviderName, CommsProvider>();

export interface SendSmsOpts {
  to: string;
  from?: string;
  body: string;
  organizationId?: number;
  feature?: string;
  externalEventId?: string;
  mediaUrls?: string[];
}

export interface SendSmsResult {
  sid: string;
  costCents: number;
}

export interface InitiateCallOpts {
  to: string;
  from?: string;
  organizationId?: number;
  twimlUrl?: string;
  statusCallbackUrl?: string;
  feature?: string;
  externalEventId?: string;
}

export interface InitiateCallResult {
  sid: string;
  statusCallbackUrl?: string;
}

export interface RentNumberOpts {
  areaCode?: string;
  organizationId?: number;
}

export interface RentNumberResult {
  number: string;
  costCentsPerMonth: number;
}

export interface CostEstimateOpts {
  kind: "sms" | "voice" | "number";
  destinationCountry?: string;
  durationMinutes?: number;
}

/**
 * The pluggable carrier contract. Every concrete adapter
 * (twilio.ts / telnyx.ts / bandwidth.ts) implements this exactly so the
 * router can swap them blindly.
 *
 * NOTE: `webhookSignatureValid` accepts an express Request because each
 * carrier signs the request differently (Twilio = HMAC-SHA1 of URL+body,
 * Telnyx = Ed25519 detached, Bandwidth = Basic-Auth). The adapter knows
 * which header to read and how to verify.
 */
export interface CommsProvider {
  name: CommsProviderName;
  /** True if the provider has the env / DB creds it needs to actually act. */
  isConfigured(): boolean;
  sendSms(opts: SendSmsOpts): Promise<SendSmsResult>;
  initiateCall(opts: InitiateCallOpts): Promise<InitiateCallResult>;
  rentNumber(opts: RentNumberOpts): Promise<RentNumberResult>;
  releaseNumber(number: string): Promise<void>;
  webhookSignatureValid(req: Request): boolean;
  /** Per-action cost estimate, in cents. */
  estimateCostCents(opts: CostEstimateOpts): number;
}

export interface ProviderQuote {
  provider: CommsProviderName;
  costCents: number;
}

export interface RouteOpts extends SendSmsOpts {
  /** When set, override automatic provider selection. */
  preferredProvider?: CommsProviderName;
}

export interface RouteResult extends SendSmsResult {
  provider: CommsProviderName;
}

/**
 * In-memory provider registry. Adapters self-register at import-time via
 * `registerProvider(...)`. The router consults `founder_settings.comms.
 * providers.enabled` to decide which subset is currently routable.
 *
 * (Declared at top of module — see the early-init block.)
 */

export function registerProvider(p: CommsProvider): void {
  REGISTRY.set(p.name, p);
}

export function getProvider(name: CommsProviderName): CommsProvider | undefined {
  return REGISTRY.get(name);
}

/**
 * Read the enabled-provider list from founder_settings. Defaults to
 * `["twilio"]` — Telnyx stays off until the $3k-MRR revenue trigger
 * flips it on.
 */
export async function getEnabledProviders(): Promise<CommsProviderName[]> {
  try {
    const raw = await getSetting("comms.providers.enabled");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        return parsed as CommsProviderName[];
      }
    }
  } catch (err: any) {
    logger.warn("[comms.router] enabled-providers setting unreadable; defaulting to twilio", {
      metadata: { error: err?.message },
    });
  }
  return ["twilio"];
}

/**
 * The router. Single instance is fine — all state is in the module-level
 * REGISTRY map. Keeping it as a class makes mocking in tests trivial
 * (just construct a CommsRouter with a custom registry).
 */
export class CommsRouter {
  constructor(private readonly registry: Map<CommsProviderName, CommsProvider> = REGISTRY) {}

  /**
   * Return cost quotes from every enabled+configured provider, cheapest
   * first. Useful for /founder/studio/routing UI and for sanity-checking
   * route() decisions during tests.
   */
  async quote(opts: CostEstimateOpts): Promise<ProviderQuote[]> {
    const enabled = await getEnabledProviders();
    const quotes: ProviderQuote[] = [];
    for (const name of enabled) {
      const p = this.registry.get(name);
      if (!p || !p.isConfigured()) continue;
      try {
        quotes.push({ provider: name, costCents: p.estimateCostCents(opts) });
      } catch {
        // A provider that can't quote is excluded rather than crashing the route.
      }
    }
    quotes.sort((a, b) => a.costCents - b.costCents);
    return quotes;
  }

  /**
   * Send an SMS via the cheapest enabled provider that's configured.
   *
   * Fallback: if a provider returns a 5xx-equivalent failure, retry on
   * the next-cheapest provider until the list is exhausted. Errors are
   * swallowed per-provider — the caller only sees the final aggregate
   * failure if every provider fails.
   */
  async route(opts: RouteOpts): Promise<RouteResult> {
    let candidates: CommsProviderName[];
    if (opts.preferredProvider) {
      candidates = [opts.preferredProvider];
    } else {
      const quotes = await this.quote({ kind: "sms" });
      candidates = quotes.map((q) => q.provider);
    }

    if (candidates.length === 0) {
      throw new Error("comms.router: no enabled comms provider available");
    }

    let lastErr: unknown;
    for (const name of candidates) {
      const provider = this.registry.get(name);
      if (!provider || !provider.isConfigured()) continue;
      try {
        const result = await provider.sendSms(opts);
        return { ...result, provider: name };
      } catch (err: any) {
        lastErr = err;
        logger.warn("[comms.router] provider failed; trying next", {
          metadata: { provider: name, error: err?.message },
        });
      }
    }
    throw lastErr ?? new Error("comms.router: all providers failed");
  }

  /**
   * Provider-aware call initiation. Same retry-on-failure semantics as
   * route(), but for voice.
   */
  async initiateCall(opts: InitiateCallOpts & { preferredProvider?: CommsProviderName }): Promise<InitiateCallResult & { provider: CommsProviderName }> {
    const enabled = opts.preferredProvider
      ? [opts.preferredProvider]
      : await getEnabledProviders();
    let lastErr: unknown;
    for (const name of enabled) {
      const provider = this.registry.get(name);
      if (!provider || !provider.isConfigured()) continue;
      try {
        const result = await provider.initiateCall(opts);
        return { ...result, provider: name };
      } catch (err: any) {
        lastErr = err;
        logger.warn("[comms.router] voice provider failed; trying next", {
          metadata: { provider: name, error: err?.message },
        });
      }
    }
    throw lastErr ?? new Error("comms.router: all voice providers failed");
  }

  /**
   * Rent a new tracking number through the preferred (or cheapest)
   * provider.
   */
  async rentNumber(opts: RentNumberOpts & { preferredProvider?: CommsProviderName }): Promise<RentNumberResult & { provider: CommsProviderName }> {
    const enabled = opts.preferredProvider
      ? [opts.preferredProvider]
      : await getEnabledProviders();
    let lastErr: unknown;
    for (const name of enabled) {
      const provider = this.registry.get(name);
      if (!provider || !provider.isConfigured()) continue;
      try {
        const result = await provider.rentNumber(opts);
        return { ...result, provider: name };
      } catch (err: any) {
        lastErr = err;
        logger.warn("[comms.router] number-rent failed; trying next", {
          metadata: { provider: name, error: err?.message },
        });
      }
    }
    throw lastErr ?? new Error("comms.router: no provider available to rent a number");
  }

  /**
   * Release a previously-rented number. Caller must know which provider
   * owns the number (lookup via trackingNumberAssignments).
   */
  async releaseNumber(number: string, provider: CommsProviderName): Promise<void> {
    const p = this.registry.get(provider);
    if (!p) throw new Error(`comms.router: provider not registered: ${provider}`);
    await p.releaseNumber(number);
  }
}

// Default singleton. Adapters self-register at their own module-load
// time — `server/services/smsService.ts` performs side-effect imports
// of both `./providers/twilio` and `./providers/telnyx`, so by the time
// anything calls `commsRouter.route(...)` the registry is populated.
export const commsRouter = new CommsRouter();
