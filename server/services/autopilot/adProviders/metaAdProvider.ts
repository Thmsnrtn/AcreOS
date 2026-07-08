/**
 * Founder Autopilot — the FIRST real ad provider (step-away gap #7).
 *
 * Plugs the Meta Marketing API into the adProvider seam, riding the
 * meta_ads Platform Connection (OAuth token + ad account id the founder
 * links on the Control Center). Self-registers at import — hands/index
 * pulls this in at boot, so the registry is live exactly when the hand is.
 *
 * Blast-radius posture (ad spend is the highest-risk limb in the system):
 *   • the hand stays witnessed — this code runs only AFTER a founder tap
 *     (or a witness grant that explicitly allows money);
 *   • every campaign is created status=PAUSED — a real campaign shell with
 *     the budget bound attached, activated by the founder in Ads Manager.
 *     The autopilot can PREPARE spend end-to-end; it cannot START it;
 *   • special_ad_categories=["HOUSING"] always — land/property marketing is
 *     housing-class under Meta policy; omitting it gets accounts flagged;
 *   • not connected → the same honest draft-only result as before this
 *     provider existed. Nothing is faked.
 */
import { logger } from "../../../utils/logger";
import { registerAdProvider, type AdCampaignSpec, type AdCampaignResult } from "../adProvider";

const GRAPH = "https://graph.facebook.com/v19.0";

/** Pure: our free-text objective → a Meta OUTCOME_* enum. Traffic default. */
export function mapMetaObjective(objective: string): string {
  const o = objective.toLowerCase();
  if (o.includes("lead")) return "OUTCOME_LEADS";
  if (o.includes("aware") || o.includes("brand")) return "OUTCOME_AWARENESS";
  if (o.includes("sale") || o.includes("convert") || o.includes("signup")) return "OUTCOME_SALES";
  return "OUTCOME_TRAFFIC";
}

async function creds(): Promise<{ token: string | null; adAccountId: string | null }> {
  try {
    const { resolveConnectionValue } = await import("../../connections/platformConnections");
    return {
      token: await resolveConnectionValue("meta_ads", "oauth_access_token"),
      adAccountId: await resolveConnectionValue("meta_ads", "ad_account_id"),
    };
  } catch {
    return { token: null, adAccountId: null };
  }
}

export const metaAdProvider = {
  platform: "meta",
  async launch(spec: AdCampaignSpec): Promise<AdCampaignResult> {
    const { token, adAccountId } = await creds();
    if (!token) {
      return {
        success: false,
        draftOnly: true,
        reason: "Meta account not connected — this stays a draft; nothing was spent. Connect it under Controls → Connections → Meta Ads.",
      };
    }
    if (!adAccountId || !/^\d+$/.test(adAccountId)) {
      return {
        success: false,
        draftOnly: true,
        reason: "Meta is connected but no ad account ID is saved (numbers only) — add it under Controls → Connections → Meta Ads.",
      };
    }

    try {
      const body = new URLSearchParams({
        name: `AcreOS: ${spec.objective}`.slice(0, 120),
        objective: mapMetaObjective(spec.objective),
        // THE safety line: real campaign, real budget bound, NEVER started by
        // the machine. The founder flips it live in Ads Manager.
        status: "PAUSED",
        special_ad_categories: JSON.stringify(["HOUSING"]),
        daily_budget: String(spec.dailyBudgetCents),
        access_token: token,
      });
      const res = await fetch(`${GRAPH}/act_${adAccountId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return {
          success: false,
          draftOnly: false,
          reason: `Meta rejected the campaign (HTTP ${res.status}): ${detail.slice(0, 300)}`,
        };
      }
      const created = (await res.json()) as { id?: string };
      if (!created.id) {
        return { success: false, draftOnly: false, reason: "Meta returned no campaign id" };
      }
      logger.warn(
        `[autopilot/ads] Meta campaign ${created.id} created PAUSED (daily cap $${(spec.dailyBudgetCents / 100).toFixed(2)}) — founder activates in Ads Manager`,
      );
      return {
        success: true,
        draftOnly: false,
        campaignId: created.id,
        reason: `Campaign ${created.id} created PAUSED with a $${(spec.dailyBudgetCents / 100).toFixed(2)}/day cap — activate it in Meta Ads Manager when ready. No spend until you do.`,
      };
    } catch (err) {
      return {
        success: false,
        draftOnly: false,
        reason: `Meta call failed: ${err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)}`,
      };
    }
  },
};

registerAdProvider(metaAdProvider);
