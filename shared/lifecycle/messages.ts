/**
 * Lifecycle program — canonical message registry.
 *
 * Phase 4 Week 17-18 (Sigrid §3, Camila §4, Indigo §1-§4).
 *
 * Two surfaces share this file:
 *   1. The 14-message customer lifecycle program — the standard touches
 *      every customer organization moves through (welcome, re-entry,
 *      morning briefing, milestones, pre-churn ladder, cancel, post-cancel
 *      win-back).
 *   2. The Indigo 6-segment 2-D win-back matrix — one cell per
 *      (cancellation reason × tier they were on) combination.
 *
 * The registry is intentionally *static config* (TypeScript), not DB-driven:
 *   - Type-safe lookup at every call site.
 *   - Compile-time guarantee every key has a default version, channel,
 *     and category.
 *   - DB rows in `email_templates` are seeded from this file but the keys
 *     and categories live here.
 *
 * Editorial / ethics rules (Indigo §3, §7):
 *   - Suppression list and notification preferences are honoured by the
 *     lifecycle dispatcher — never by the call sites.
 *   - "wrong_fit" cancellations get NO win-back touches (don't churn-bait
 *     people who explicitly said it wasn't for them).
 *   - At most 2 win-back touches per cancelled organization in a rolling
 *     12-month window. The throttle is enforced in
 *     server/services/lifecycleProgram.ts#sendWinback.
 */

// ============================================================================
// 14-message lifecycle program
// ============================================================================

/**
 * Stable keys for the 14 lifecycle messages. Keys are persisted in
 * `lifecycle_message_sends.template_key` and matched by
 * `email_templates.key`, so renaming a key requires a migration.
 */
export type LifecycleMessageKey =
  | "welcome" //                  D0 — onboarding kickoff
  | "reentry" //                  D2 — abandoned during onboarding
  | "morning_briefing" //         daily, opt-in
  | "d7_check_in" //              week-1 milestone
  | "d14_power_user" //           week-2 advanced-features nudge
  | "d30_nps" //                  month-1 NPS survey
  | "d60_retention" //            month-2 retention milestone
  | "d90_quarter_recap" //        month-3 quarter recap
  | "pre_churn_signal" //         usage drop > 50% in 7d
  | "pre_churn_ladder_1" //       D-3 from estimated cancel
  | "pre_churn_ladder_2" //       D-1 help offer
  | "cancellation_reason_ask" //  T+0 cancel survey
  | "post_cancel_d14_winback" //  Indigo segment 1
  | "post_cancel_d90_winback"; //  Indigo segment 2

export type LifecycleCategory =
  | "lifecycle.onboarding"
  | "lifecycle.daily"
  | "lifecycle.milestone"
  | "lifecycle.retention"
  | "lifecycle.pre_churn"
  | "lifecycle.cancel"
  | "lifecycle.winback";

export type Channel = "email" | "sms";

export interface LifecycleMessage {
  key: LifecycleMessageKey;
  category: LifecycleCategory;
  channel: Channel;
  /** Default copy version. Bump as part of a content refresh. */
  version: number;
  subject: string;
  body: string;
  /**
   * Trigger description (informational; the dispatcher in
   * server/services/lifecycleProgram.ts is the source of truth).
   */
  trigger: string;
}

/**
 * The 14 canonical lifecycle messages. Order is by typical customer
 * journey, not alphabetical. Copy is intentionally short — the rendered
 * HTML version lives in the templates worker, not here.
 */
export const LIFECYCLE_MESSAGES: Record<LifecycleMessageKey, LifecycleMessage> = {
  welcome: {
    key: "welcome",
    category: "lifecycle.onboarding",
    channel: "email",
    version: 1,
    subject: "Welcome to AcreOS, {firstName}",
    body:
      "Glad you're here. AcreOS is built for Land Investors, not generic " +
      "real-estate CRMs — so you'll see surfaces that map to how you " +
      "actually work: parcels, due diligence, blind offers, deal pipeline. " +
      "Your first move is to add a parcel or import a county list. Need a " +
      "hand? Reply to this email — it goes to a human.",
    trigger: "User completes onboarding step 1 (D0).",
  },
  reentry: {
    key: "reentry",
    category: "lifecycle.onboarding",
    channel: "email",
    version: 1,
    subject: "Picking up where you left off",
    body:
      "We noticed you stepped away during setup — totally fine. Most Land " +
      "Investors find AcreOS clicks once they have one parcel imported. " +
      "Here's a 90-second resume link that drops you back into the exact " +
      "step you stopped on. {resumeUrl}",
    trigger: "Onboarding incomplete after 48h (D2).",
  },
  morning_briefing: {
    key: "morning_briefing",
    category: "lifecycle.daily",
    channel: "email",
    version: 1,
    subject: "Your morning briefing — {dateLabel}",
    body:
      "Today's plate: {dueDiligenceCount} parcels in due diligence, " +
      "{offersOutstanding} offers outstanding, {dealsClosing} deals on the " +
      "calendar. Top action: {topAction}.",
    trigger: "Daily 7am local, opt-in via notification preferences.",
  },
  d7_check_in: {
    key: "d7_check_in",
    category: "lifecycle.milestone",
    channel: "email",
    version: 1,
    subject: "How's your first week with AcreOS?",
    body:
      "You've been with us for a week. Quick check: is anything getting in " +
      "the way? Reply with one word — 'great', 'stuck', or 'questions' — " +
      "and a human will follow up.",
    trigger: "T+7 days from organization create.",
  },
  d14_power_user: {
    key: "d14_power_user",
    category: "lifecycle.milestone",
    channel: "email",
    version: 1,
    subject: "Three AcreOS features most Land Investors miss",
    body:
      "You've got the basics down. Here are three features power users " +
      "rely on that you haven't touched yet: blind-offer wizard " +
      "({blindOfferUrl}), buyer matching ({buyerMatchUrl}), and the " +
      "evening review ({eveningReviewUrl}). Worth 5 minutes each.",
    trigger:
      "T+14 days, gated on 'haven't used these features' (computed at send).",
  },
  d30_nps: {
    key: "d30_nps",
    category: "lifecycle.retention",
    channel: "email",
    version: 1,
    subject: "Quick AcreOS pulse check",
    body:
      "30 days in. On a 0–10 scale, how likely are you to recommend " +
      "AcreOS to another Land Investor? {npsUrl}",
    trigger: "T+30 days from first paid event.",
  },
  d60_retention: {
    key: "d60_retention",
    category: "lifecycle.retention",
    channel: "email",
    version: 1,
    subject: "Two months in — your AcreOS scoreboard",
    body:
      "60 days. {parcelsCount} parcels tracked, {offersSent} offers sent, " +
      "{dealsClosed} deals closed. The Land Investors who stick around " +
      "long-term hit a rhythm right around now.",
    trigger: "T+60 days from first paid event.",
  },
  d90_quarter_recap: {
    key: "d90_quarter_recap",
    category: "lifecycle.retention",
    channel: "email",
    version: 1,
    subject: "Your AcreOS quarter — by the numbers",
    body:
      "Three months in. Revenue tracked: ${revenueTracked}. Leads in " +
      "system: {leadCount}. Deals closed: {dealsClosed}. " +
      "Year-to-date you're trending {trendLabel}.",
    trigger: "T+90 days from first paid event.",
  },
  pre_churn_signal: {
    key: "pre_churn_signal",
    category: "lifecycle.pre_churn",
    channel: "email",
    version: 1,
    subject: "We noticed things slowed down",
    body:
      "Your AcreOS usage has dropped meaningfully this past week. That's " +
      "usually a sign something isn't clicking. Anything we can fix? Reply " +
      "and a human will actually read it.",
    trigger: "Usage down > 50% across 7-day window.",
  },
  pre_churn_ladder_1: {
    key: "pre_churn_ladder_1",
    category: "lifecycle.pre_churn",
    channel: "email",
    version: 1,
    subject: "What's working — and what isn't?",
    body:
      "We see your renewal coming up. Before you decide either way: " +
      "what's working for you, and what isn't? Two-question reply, no " +
      "marketing chase. {feedbackUrl}",
    trigger: "D-3 from estimated cancel/renewal date.",
  },
  pre_churn_ladder_2: {
    key: "pre_churn_ladder_2",
    category: "lifecycle.pre_churn",
    channel: "email",
    version: 1,
    subject: "Before you cancel — a live setup offer",
    body:
      "If something's blocking you, we'll set it up with you live, free. " +
      "Pick a 20-minute slot here: {liveSetupUrl}. No upsell.",
    trigger: "D-1 from estimated cancel/renewal date.",
  },
  cancellation_reason_ask: {
    key: "cancellation_reason_ask",
    category: "lifecycle.cancel",
    channel: "email",
    version: 1,
    subject: "Quick question on your way out",
    body:
      "Sorry to see you go. One question — why? It genuinely shapes the " +
      "product. {surveyUrl}",
    trigger: "T+0 from cancel.",
  },
  post_cancel_d14_winback: {
    key: "post_cancel_d14_winback",
    category: "lifecycle.winback",
    channel: "email",
    version: 1,
    subject: "Two weeks gone — checking in",
    body:
      "It's been two weeks. {winbackPitch} Your data's still there if you " +
      "want it back. {reactivationUrl}",
    trigger: "T+14 from cancel; throttled by Indigo 2-touch budget.",
  },
  post_cancel_d90_winback: {
    key: "post_cancel_d90_winback",
    category: "lifecycle.winback",
    channel: "email",
    version: 1,
    subject: "Quarter check-in from AcreOS",
    body:
      "It's been 90 days. {winbackPitch} Here's what's new since you left: " +
      "{whatsNewSummary}. {reactivationUrl}",
    trigger: "T+90 from cancel; throttled by Indigo 2-touch budget.",
  },
};

/** All 14 keys, in journey order. */
export const LIFECYCLE_KEYS: LifecycleMessageKey[] = [
  "welcome",
  "reentry",
  "morning_briefing",
  "d7_check_in",
  "d14_power_user",
  "d30_nps",
  "d60_retention",
  "d90_quarter_recap",
  "pre_churn_signal",
  "pre_churn_ladder_1",
  "pre_churn_ladder_2",
  "cancellation_reason_ask",
  "post_cancel_d14_winback",
  "post_cancel_d90_winback",
];

// ============================================================================
// Indigo 6-segment 2-D win-back matrix
// ============================================================================
//
// Rows = cancellation reason. Columns = tier they were on. Per-cell behaviour:
//
//                | Starter             | Pro                | Scale
//   -------------+---------------------+--------------------+---------------------
//   price        | "$20 still works..."| "Drop to Starter"  | "Drop to Starter"
//   missing_feat | trigger when ships  | trigger when ships | trigger when ships
//   not_using    | re-onboard live     | re-onboard live    | re-onboard live
//   wrong_fit    | NO TOUCH            | NO TOUCH           | NO TOUCH
//   churned      | gentle "we built X" | gentle "we built X"| gentle "we built X"
//   unknown      | gentle "we built X" | gentle "we built X"| gentle "we built X"
//
// WinbackTier identifiers below (solo/operator/empire) are kept as the
// persisted cellKey vocabulary so cohort-analysis joins against existing
// audit rows in lifecycle_message_sends keep working. User-facing copy in
// the pitch strings uses the canonical Starter/Pro/Scale names instead.

/** Cancellation reason taxonomy aligned to cancellation_surveys.reason. */
export type CancellationReason =
  | "price"
  | "missing_feature"
  | "not_using"
  | "wrong_fit"
  | "churned_customer"
  | "unknown";

export type WinbackTier = "solo" | "operator" | "empire";

export type WinbackApproach =
  /** Send a tailored win-back email referencing the segment's pitch. */
  | "tailored_email"
  /** Wait for the missing feature to ship; trigger on changelog event. */
  | "feature_ship_trigger"
  /** Live re-onboarding offer (calendar link in email body). */
  | "reonboarding_offer"
  /** Gentle "we built X since you left" — the lowest-pressure touch. */
  | "gentle_update"
  /** No outreach. Respect the explicit signal that AcreOS wasn't a fit. */
  | "no_touch";

export interface WinbackCell {
  reason: CancellationReason;
  tier: WinbackTier;
  approach: WinbackApproach;
  /**
   * One-sentence pitch that gets substituted into the {winbackPitch}
   * placeholder of the post-cancel templates. Empty string when
   * approach === "no_touch".
   */
  pitch: string;
  /**
   * Stable cell key — used as the audit row's `template_key` so we can
   * cohort-analyse winback effectiveness by segment.
   * Format: "winback_<reason>_<tier>".
   */
  cellKey: string;
}

function cell(
  reason: CancellationReason,
  tier: WinbackTier,
  approach: WinbackApproach,
  pitch: string,
): WinbackCell {
  return {
    reason,
    tier,
    approach,
    pitch,
    cellKey: `winback_${reason}_${tier}`,
  };
}

/** All 18 cells (6 reasons × 3 tiers). The 6-segment framing groups them
 * by *approach* (price-Starter vs price-Pro/Scale are distinct
 * segments; not-using is one segment regardless of tier; etc.). */
export const WINBACK_MATRIX: WinbackCell[] = [
  // Price row
  cell(
    "price",
    "solo",
    "tailored_email",
    "Our $20 Starter tier still works for you — come back any time, your data is preserved.",
  ),
  cell(
    "price",
    "operator",
    "tailored_email",
    "Don't pay for tiers you don't use — drop to Starter at $20/mo and keep going.",
  ),
  cell(
    "price",
    "empire",
    "tailored_email",
    "Don't pay for tiers you don't use — drop to Starter at $20/mo and keep going.",
  ),
  // Missing-feature row
  cell(
    "missing_feature",
    "solo",
    "feature_ship_trigger",
    "The feature you flagged when you left is now live.",
  ),
  cell(
    "missing_feature",
    "operator",
    "feature_ship_trigger",
    "The feature you flagged when you left is now live.",
  ),
  cell(
    "missing_feature",
    "empire",
    "feature_ship_trigger",
    "The feature you flagged when you left is now live.",
  ),
  // Not-using row
  cell(
    "not_using",
    "solo",
    "reonboarding_offer",
    "We'll set AcreOS up with you live, in 20 minutes — no upsell.",
  ),
  cell(
    "not_using",
    "operator",
    "reonboarding_offer",
    "We'll set AcreOS up with you live, in 20 minutes — no upsell.",
  ),
  cell(
    "not_using",
    "empire",
    "reonboarding_offer",
    "We'll set AcreOS up with you live, in 20 minutes — no upsell.",
  ),
  // Wrong-fit row — no touches.
  cell("wrong_fit", "solo", "no_touch", ""),
  cell("wrong_fit", "operator", "no_touch", ""),
  cell("wrong_fit", "empire", "no_touch", ""),
  // Churned-customer row
  cell(
    "churned_customer",
    "solo",
    "gentle_update",
    "We've shipped a lot since you left. Worth a fresh look?",
  ),
  cell(
    "churned_customer",
    "operator",
    "gentle_update",
    "We've shipped a lot since you left. Worth a fresh look?",
  ),
  cell(
    "churned_customer",
    "empire",
    "gentle_update",
    "We've shipped a lot since you left. Worth a fresh look?",
  ),
  // Unknown row
  cell(
    "unknown",
    "solo",
    "gentle_update",
    "We built quite a bit since you left — take another look?",
  ),
  cell(
    "unknown",
    "operator",
    "gentle_update",
    "We built quite a bit since you left — take another look?",
  ),
  cell(
    "unknown",
    "empire",
    "gentle_update",
    "We built quite a bit since you left — take another look?",
  ),
];

/**
 * Look up the win-back cell for a (reason, tier) pair. Falls back to
 * the unknown × tier cell if reason is missing.
 */
export function winbackCellFor(
  reason: CancellationReason | null | undefined,
  tier: WinbackTier,
): WinbackCell {
  const r: CancellationReason = reason ?? "unknown";
  const found = WINBACK_MATRIX.find((c) => c.reason === r && c.tier === tier);
  if (found) return found;
  // Defensive: should never happen — every (reason, tier) is enumerated.
  return WINBACK_MATRIX.find(
    (c) => c.reason === "unknown" && c.tier === tier,
  )!;
}

/**
 * Maximum win-back touches per cancelled organization in a rolling
 * 12-month window (Indigo §7).
 */
export const WINBACK_MAX_TOUCHES_PER_YEAR = 2;
export const WINBACK_THROTTLE_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

// ============================================================================
// Helpers used by the dispatcher
// ============================================================================

/**
 * Map a free-text cancellation_surveys.reason value to the
 * CancellationReason taxonomy. The legacy values from migration 0042
 * were `too_expensive | not_using | missing_features | switching_competitor
 * | other`. We normalize here so the rest of the program speaks one
 * vocabulary.
 */
export function normalizeCancellationReason(
  raw: string | null | undefined,
): CancellationReason {
  if (!raw) return "unknown";
  const v = raw.toLowerCase().trim();
  if (v.includes("price") || v.includes("expensive") || v.includes("cost"))
    return "price";
  if (v.includes("missing") || v.includes("feature")) return "missing_feature";
  if (v.includes("not_using") || v.includes("not using") || v.includes("usage"))
    return "not_using";
  if (
    v.includes("wrong_fit") ||
    v.includes("wrong fit") ||
    v.includes("competitor") ||
    v.includes("switching")
  )
    return "wrong_fit";
  if (v.includes("churn")) return "churned_customer";
  return "unknown";
}

/**
 * Map an organizations.subscription_tier value (free | starter | pro |
 * scale | solo | operator | empire) to a WinbackTier. "free" defaults to
 * "solo" since they cancelled what was effectively a Solo trial.
 */
export function winbackTierFor(
  subscriptionTier: string | null | undefined,
): WinbackTier {
  if (!subscriptionTier) return "solo";
  const v = subscriptionTier.toLowerCase().trim();
  if (v === "operator" || v === "pro") return "operator";
  if (v === "empire" || v === "scale") return "empire";
  return "solo";
}
