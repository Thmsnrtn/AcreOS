/**
 * 2026-07 cost audit — two founder decision cards, seeded ONCE at boot.
 *
 * Both are PRODUCT decisions the machine must not make on its own
 * (Sovereign Principle 10): they change what customers get or where
 * customer data flows. Cards are phone-answerable (2.3 options) and
 * carry actionPayload: null — a founder answer records the ruling
 * (founderOverrideAction) for a HUMAN-reviewed follow-up change; nothing
 * auto-executes on approve.
 *
 * One-shot discipline: guarded by a platform_settings marker (the arming
 * migration pattern) so boot re-runs never duplicate the cards, and a
 * founder answer is never re-asked. Class B through the interruption
 * arbiter like every machine-initiated inbox insert.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { platformSettings } from "@shared/schema";
import { decisionsInboxService } from "./decisionsInbox";
import { logger } from "../utils/logger";

const MARKER_KEY = "cost_audit_2026_07.decision_cards_seeded";

const CARDS = [
  {
    subject: "Scale-tier Pax default: Opus → Sonnet?",
    analysis:
      "Scale-tier customers get Opus by default for every Pax message until the 200-message soft cap. " +
      "Worst-case AI COGS is ~$54/month on a $79 plan; with a Sonnet default it is ~$16. " +
      "Sonnet is near-Opus quality for assistant chat, and Opus stays available per hard task type. " +
      "This changes what the top tier receives, so it is yours to call.",
    recommendedAction: "demote_scale_default_to_sonnet",
    recommendedActionLabel: "Decide: Scale tier's default Pax model",
    options: [
      { key: "demote_default", label: "Sonnet default, Opus for hard tasks" },
      { key: "keep_opus", label: "Keep Opus default on Scale" },
    ],
  },
  {
    subject: "Customer content → DeepSeek: keep or move to Haiku?",
    analysis:
      "routeSimpleTask sends customer outreach-draft content to DeepSeek via OpenRouter (~$0.14/M tokens). " +
      "Moving customer-content tasks to Haiku costs ~7x more per token (still cheap in absolute terms) " +
      "but keeps customer data on Anthropic. Internal-only tasks stay on DeepSeek either way. " +
      "This is a data-governance call about where customer content flows.",
    recommendedAction: "route_customer_content_to_haiku",
    recommendedActionLabel: "Decide: customer content on DeepSeek",
    options: [
      { key: "move_to_haiku", label: "Haiku for customer content" },
      { key: "keep_deepseek", label: "Keep DeepSeek" },
    ],
  },
] as const;

/** Seed the two cards exactly once. Fail-open: a seed failure logs and
 *  retries next boot (marker written only after both inserts succeed). */
export async function seedCostDecisionCards(): Promise<"seeded" | "already_seeded" | "failed"> {
  try {
    const existing = await db
      .select({ id: platformSettings.id })
      .from(platformSettings)
      .where(
        and(
          eq(platformSettings.scope, "global"),
          isNull(platformSettings.scopeRef),
          eq(platformSettings.key, MARKER_KEY),
        ),
      )
      .limit(1);
    if (existing.length > 0) return "already_seeded";

    for (const card of CARDS) {
      await decisionsInboxService.createDirectDecisionCard({
        itemType: "feature_request_flagged",
        riskLevel: "medium",
        urgencyScore: 40,
        sophieAnalysis: card.analysis,
        recommendedAction: card.recommendedAction,
        recommendedActionLabel: card.recommendedActionLabel,
        subject: card.subject,
        options: [...card.options],
      });
    }

    await db.insert(platformSettings).values({
      key: MARKER_KEY,
      scope: "global",
      scopeRef: null,
      value: { seededAt: new Date().toISOString(), cards: CARDS.length },
      // jsonb NOT NULL; a one-shot marker has no meaningful default.
      defaultValue: {},
      category: "cost",
      description:
        "One-shot marker: 2026-07 cost-audit founder decision cards seeded (Scale default model; DeepSeek governance).",
      lastChangedBy: "cost-audit-seed",
      lastChangedAt: new Date(),
    });
    logger.info("[costDecisionCards] seeded 2 founder decision cards (2026-07 cost audit)");
    return "seeded";
  } catch (err) {
    logger.error(
      "[costDecisionCards] seed failed — will retry next boot (marker not written)",
      err instanceof Error ? err : undefined,
    );
    return "failed";
  }
}
