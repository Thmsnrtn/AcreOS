/**
 * Usage-rail sunset — founder decision cards, seeded ONCE at boot.
 *
 * The founder chose the phased "free taste → bring-your-own" direction
 * (2026-07-16). That settles the STRATEGY; it does not set any number. These
 * cards surface the two calls that remain the founder's — the sunset ORDER and
 * the free-taste ALLOWANCE SHAPE — as phone-answerable decisions in the inbox.
 *
 * Hard-stop discipline (same as costDecisionCards.ts): these are PRODUCT/money
 * decisions the machine must never make on its own. actionPayload is null via
 * createDirectDecisionCard — a founder answer records a ruling for a
 * HUMAN-reviewed follow-up change; NOTHING auto-executes on approve, and no
 * price or threshold number is set here. The exact per-rail numbers are set by
 * the founder in the cost panel after the shape is chosen.
 *
 * One-shot: guarded by a platform_settings marker so boot re-runs never
 * duplicate the cards and an answered card is never re-asked.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { platformSettings } from "@shared/schema";
import { decisionsInboxService } from "./decisionsInbox";
import { logger } from "../utils/logger";

const MARKER_KEY = "rail_sunset_2026_07.decision_cards_seeded";

const CARDS = [
  {
    subject: "Rail sunset order: which rails graduate to bring-your-own first?",
    analysis:
      "You chose the phased model — a free taste on our accounts, then customers connect their own. " +
      "The order matters. Property-data lookups and letter mail carry the most cost and the cleanest " +
      "bring-your-own story, so they can lead. Email follows. SMS gates on A2P registration regardless, " +
      "so it is the natural last mover. Nothing changes for any customer until you set the per-rail " +
      "allowances (next card) — this only fixes the sequence.",
    recommendedAction: "rail_sunset_order_data_mail_first",
    recommendedActionLabel: "Decide: which rails move to bring-your-own first",
    options: [
      { key: "data_mail_first", label: "Data + mail first, email next, SMS last" },
      { key: "all_together", label: "All four rails at once" },
      { key: "one_at_a_time", label: "One at a time — I'll pace each in the cost panel" },
    ],
  },
  {
    subject: "Free-taste allowance: what shape before bring-your-own kicks in?",
    analysis:
      "Mirroring your proven AI-key threshold: each plan includes a monthly allowance of platform " +
      "sends/lookups, and past it (or on the higher tiers) the customer connects their own account — " +
      "which is cheaper for them and $0 cost to you. The exact allowance numbers per rail stay yours " +
      "to set in the cost panel; this card only fixes the shape, not the figures.",
    recommendedAction: "free_taste_shape_mirror_ai_threshold",
    recommendedActionLabel: "Decide: the free-taste allowance shape",
    options: [
      { key: "mirror_ai_threshold", label: "Monthly included allowance, then bring-your-own required" },
      { key: "starter_only", label: "Included on Starter only; Pro & Scale bring-your-own from day one" },
      { key: "set_exact_numbers", label: "I'll set exact per-rail numbers in the cost panel" },
    ],
  },
] as const;

/**
 * Seed the rail-sunset cards exactly once. Fail-open: a seed failure logs and
 * retries next boot (marker written only after all inserts succeed).
 */
export async function seedRailSunsetDecisionCards(): Promise<"seeded" | "already_seeded" | "failed"> {
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
      defaultValue: {},
      category: "cost",
      description:
        "One-shot marker: 2026-07 usage-rail sunset founder decision cards seeded (sunset order; free-taste allowance shape).",
      lastChangedBy: "rail-sunset-seed",
      lastChangedAt: new Date(),
    });
    logger.info("[railSunsetDecisionCards] seeded 2 founder decision cards (2026-07 rail sunset)");
    return "seeded";
  } catch (err) {
    logger.error(
      "[railSunsetDecisionCards] seed failed — will retry next boot (marker not written)",
      err instanceof Error ? err : undefined,
    );
    return "failed";
  }
}
