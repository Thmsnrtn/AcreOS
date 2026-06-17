/**
 * Founder Autopilot — run_ad_campaign hand (Hands roadmap P4.1).
 *
 * The highest-blast-radius hand: real ad spend. Triple-gated like every outward
 * hand AND additionally:
 *   • outwardClass "broadcast" → witnessed-send even though it's not aimed at one
 *     customer (closes the laundering hole).
 *   • requiresApproval true → the executor refuses any direct model call.
 *   • a hard per-call daily-budget ceiling enforced here.
 *   • dormant by ABSENCE: with no ad provider wired, it spends nothing and
 *     returns a draft-only result (see adProvider).
 * It earns autonomy LAST, and only on proven CAC.
 */
import { registerHand } from "./registry";
import { handError, type HandResult } from "./types";
import { runAdCampaign } from "../adProvider";

const NAME = "run_ad_campaign";
/** Hard per-launch daily-budget ceiling (cents). A blunt backstop. */
export const AD_DAILY_BUDGET_CEILING_CENTS = 5000; // $50/day

async function handler(input: Record<string, unknown>): Promise<HandResult> {
  const started = Date.now();
  try {
    const platform = String(input.platform ?? "").trim();
    const objective = String(input.objective ?? "").trim();
    const audience = String(input.audience ?? "").trim();
    const creative = String(input.creative ?? "").trim();
    const dailyBudgetCents = typeof input.daily_budget_cents === "number" ? Math.floor(input.daily_budget_cents) : NaN;
    if (!platform || !objective || !audience || !creative || !Number.isFinite(dailyBudgetCents) || dailyBudgetCents <= 0) {
      return { success: false, output: "run_ad_campaign: 'platform', 'objective', 'audience', 'creative', and a positive 'daily_budget_cents' are required.", durationMs: Date.now() - started };
    }
    if (dailyBudgetCents > AD_DAILY_BUDGET_CEILING_CENTS) {
      return {
        success: false,
        output: `run_ad_campaign: $${(dailyBudgetCents / 100).toFixed(2)}/day exceeds the $${(AD_DAILY_BUDGET_CEILING_CENTS / 100).toFixed(2)}/day autopilot ceiling. Refusing.`,
        durationMs: Date.now() - started,
      };
    }
    const result = await runAdCampaign({
      platform,
      objective,
      dailyBudgetCents,
      audience,
      creative,
      organizationId: typeof input.organization_id === "number" ? input.organization_id : undefined,
    });
    if (result.draftOnly) {
      return { success: false, output: `run_ad_campaign: ${result.reason}`, durationMs: Date.now() - started };
    }
    if (!result.success) {
      return { success: false, output: `run_ad_campaign failed: ${result.reason ?? "unknown"}`, durationMs: Date.now() - started };
    }
    return { success: true, output: JSON.stringify({ campaignId: result.campaignId }), durationMs: Date.now() - started };
  } catch (err) {
    return handError(NAME, err, started);
  }
}

registerHand({
  name: NAME,
  schema: {
    name: NAME,
    description:
      "Launch a paid ad campaign (Meta/TikTok). HIGHEST blast radius: real spend, public broadcast. Hard-capped at $50/day, witnessed-send required, draft-only until a real ad-platform adapter is wired. Earns autonomy last, only on proven CAC.",
    input_schema: {
      type: "object",
      properties: {
        platform: { type: "string", description: "meta | tiktok" },
        objective: { type: "string" },
        audience: { type: "string", description: "Targeting description." },
        creative: { type: "string", description: "Ad creative copy — honest, land-native, no hype." },
        daily_budget_cents: { type: "number", description: "Daily budget in cents (≤ 5000)." },
        organization_id: { type: "number" },
      },
      required: ["platform", "objective", "audience", "creative", "daily_budget_cents"],
    },
  },
  domain: "growth",
  isCustomerFacing: false,
  outwardClass: "broadcast",
  requiresApproval: true,
  surface: "marketing",
  handler,
});
