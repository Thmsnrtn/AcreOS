/**
 * Founder Autopilot — ad-platform provider seam (Hands roadmap P4.1).
 *
 * Paid distribution is the ONE genuinely-new external limb. This is the pluggable
 * seam a real Meta / TikTok adapter plugs into — mirroring comms/providers. It
 * ships with NO live provider registered: that is honest dormancy by ABSENCE, not
 * a stub. Until a real adapter + API key is wired, runAdCampaign returns a clear
 * "no ad provider configured — draft-only" result and spends nothing. Nothing is
 * faked; the limb simply has no hand on the lever yet.
 *
 * Ad spend is the highest-blast-radius action in the whole system, so even once a
 * provider exists the hand stays witnessed + budget-gated + risk-escalated and
 * earns autonomy LAST.
 */
import { logger } from "../../utils/logger";

export interface AdCampaignSpec {
  /** "meta" | "tiktok" | ... — which platform. */
  platform: string;
  objective: string;
  /** Daily budget cap in cents — the hard spend bound. */
  dailyBudgetCents: number;
  audience: string;
  creative: string;
  organizationId?: number;
}

export interface AdCampaignResult {
  success: boolean;
  /** True when no live provider exists — the safe dormant default (no spend). */
  draftOnly: boolean;
  campaignId?: string;
  reason?: string;
}

export interface AdProvider {
  platform: string;
  launch(spec: AdCampaignSpec): Promise<AdCampaignResult>;
}

const PROVIDERS = new Map<string, AdProvider>();

/** Register a real ad provider (a future Meta/TikTok adapter). */
export function registerAdProvider(p: AdProvider): void {
  PROVIDERS.set(p.platform, p);
  logger.info(`[autopilot/ads] ad provider registered: ${p.platform}`);
}

export function hasAdProvider(platform: string): boolean {
  return PROVIDERS.has(platform);
}

/**
 * Launch a campaign through the platform's provider. With NO provider registered
 * (today), returns draftOnly=true and spends nothing — the honest dormant state.
 */
export async function runAdCampaign(spec: AdCampaignSpec): Promise<AdCampaignResult> {
  const provider = PROVIDERS.get(spec.platform);
  if (!provider) {
    return {
      success: false,
      draftOnly: true,
      reason: `no ad provider configured for '${spec.platform}' — this is a draft only; nothing was spent. Wire a real ${spec.platform} adapter + key to enable.`,
    };
  }
  return provider.launch(spec);
}

/** TEST-ONLY: clear registered providers. */
export function __resetAdProvidersForTest(): void {
  PROVIDERS.clear();
}
