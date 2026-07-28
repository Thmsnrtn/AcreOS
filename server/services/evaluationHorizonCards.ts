/**
 * Evaluation horizon — founder decision cards, seeded ONCE at boot.
 *
 * The month-3 trust breaker for the platform's customer acquisition is
 * "green dashboards, red bank account": the machine spends real money with
 * perfect process receipts while few or zero prospects convert to paying
 * customers — which is NORMAL early, because the acquisition feedback loop
 * is months long. (One founder: the platform owner. The "mail program" is
 * AcreOS's own acquisition + free-taste spend, never customers' land deals.) Without a PRE-COMMITTED evaluation frame agreed while calm,
 * the founder ends up adjudicating honest variance emotionally mid-drawdown
 * and revoking trust in a correct system. These two cards ask the founder to
 * pre-commit the judgment rules BEFORE the drawdown: WHEN the mail program
 * gets judged, and what SHAPE of stop-loss pauses spending.
 *
 * Hard-stop discipline (same as railSunsetDecisionCards.ts): these are money
 * decisions the machine must never make on its own. actionPayload is null via
 * createDirectDecisionCard — a founder answer records a ruling for a
 * HUMAN-reviewed follow-up change; NOTHING auto-executes on approve, and no
 * dollar number is set here. The founder sets any actual dollar line in the
 * cost panel.
 *
 * Honesty note (verified 2026-07-28): no spend-threshold automatic pause is
 * wired to mail/data outreach today. The only live spend auto-pause is the
 * Solene agent-dispatch cap (capitalTracker), which covers AI dispatch spend,
 * not the mail program; campaign/enrollment pause is manual. Card 2 says so
 * plainly — answering records the ruling, the wiring is a follow-up PR.
 *
 * One-shot: guarded by a platform_settings marker so boot re-runs never
 * duplicate the cards and an answered card is never re-asked.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { platformSettings } from "@shared/schema";
import { decisionsInboxService } from "./decisionsInbox";
import { logger } from "../utils/logger";

const MARKER_KEY = "evaluation_horizon_2026_07.decision_cards_seeded";

const CARDS = [
  {
    subject: "When do we judge the mail program — decide now, while it's calm",
    analysis:
      "Customer acquisition runs on months-long feedback loops — cold outreach to prospective " +
      "land-investor customers becomes trials, and trials become paying subscribers, slowly. So " +
      "the mail program will spend real money for a long stretch with few or zero converted " +
      "customers — and that is NORMAL early, not a signal the " +
      "system is broken. The danger is judging that stretch in the moment: mid-drawdown, honest " +
      "variance looks like failure, and a correct system gets its trust revoked emotionally. " +
      "Deciding the judgment rules now, while it's calm, means when the uncomfortable stretch " +
      "comes we already agreed how long to wait before calling it. Nothing changes today — no " +
      "spend moves, no campaign changes — this only fixes WHEN we evaluate.",
    recommendedAction: "eval_horizon_both_whichever_first",
    recommendedActionLabel: "Decide: when the mail program gets judged",
    options: [
      { key: "six_months", label: "Judge at 6 months of sending" },
      {
        key: "spend_threshold",
        label: "Judge when total mail+data spend crosses a $ line I'll set in the cost panel",
      },
      { key: "both_whichever_first", label: "Both — whichever comes first (recommended)" },
    ],
  },
  {
    subject: "The stop-loss shape — what pauses spending automatically",
    analysis:
      "This decides the SHAPE of the stop-loss only — no number. You set the actual dollar line " +
      "in the cost panel; the machine never picks the number (pricing and spend lines are a " +
      "founder-only hard-stop). Today, no automatic spend-triggered pause is wired to mail or " +
      "data outreach — the only live auto-pause covers AI agent-dispatch spend, and campaign " +
      "pause is a manual switch. Answering records your ruling; wiring the actual pause is a " +
      "follow-up change you'll see in a PR before it's live.",
    recommendedAction: "stop_loss_shape_monthly_cap_pause",
    recommendedActionLabel: "Decide: the stop-loss shape",
    options: [
      {
        key: "monthly_cap_pause",
        label: "A monthly spend line — crossing it pauses outreach until I look",
      },
      {
        key: "cumulative_cap_pause",
        label: "A cumulative program line — crossing it pauses until I look",
      },
      { key: "no_auto_pause", label: "No automatic pause — just warn me loudly" },
    ],
  },
] as const;

/**
 * Seed the evaluation-horizon cards exactly once. Fail-open: a seed failure
 * logs and retries next boot (marker written only after all inserts succeed).
 */
export async function seedEvaluationHorizonCards(): Promise<"seeded" | "already_seeded" | "failed"> {
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
        "One-shot marker: 2026-07 evaluation-horizon founder decision cards seeded (when to judge the mail program; stop-loss shape).",
      lastChangedBy: "evaluation-horizon-seed",
      lastChangedAt: new Date(),
    });
    logger.info(
      "[evaluationHorizonCards] seeded 2 founder decision cards (2026-07 evaluation horizon)",
    );
    return "seeded";
  } catch (err) {
    logger.error(
      "[evaluationHorizonCards] seed failed — will retry next boot (marker not written)",
      err instanceof Error ? err : undefined,
    );
    return "failed";
  }
}
