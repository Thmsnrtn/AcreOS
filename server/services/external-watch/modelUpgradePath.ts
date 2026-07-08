/**
 * EXTERNAL-WATCH — model-upgrade path (L4.18).
 *
 * Closes the L4.17 → L4.18 gap. L4.17 (anthropic-watch, shipped in
 * commit cd290f4c) already ingests Anthropic release-notes items into
 * external_watch_events. This service is the layer that *acts* on each
 * one:
 *
 *   1. Classify  — pure-function regex/keyword classifier maps each
 *      ingested release-note to one of MODEL_UPGRADE_EVENT_KINDS:
 *        new_model_available | model_deprecated | pricing_change |
 *        feature_added | rate_limit_change
 *      Returns null for items that are neither model-related nor
 *      pricing/rate-limit (the upstream changelog ships some general
 *      announcements that don't need a recommendation).
 *
 *   2. Decide    — pure-function policy matrix maps (classification ×
 *      current-model-in-use) to a recommendation:
 *        adopt_now      — deprecation of the in-use model
 *        schedule_eval  — same-family upgrade or > 10% price increase
 *        flag_only      — informational / good-news / unrelated model
 *
 *   3. Persist   — one solene_model_upgrade_recommendations row per
 *      source_event_id (UNIQUE) so re-running the classifier never
 *      double-recommends the same upstream item.
 *
 *   4. Page      — adopt_now triggers sendSolenePage(severity='urgent').
 *      Migration deadlines on a model AcreOS actively uses are
 *      non-negotiable; the COO needs to know between sessions.
 *
 * Hooked from anthropicWatch.ts after the existing persistence loop
 * (fire-and-forget, guarded so a classifier failure cannot propagate
 * back to the ingest run).
 */

import { and, eq, isNull } from "drizzle-orm";
import { ANTHROPIC_MODELS } from "../models";
import { db } from "../../db";
import {
  externalWatchEvents,
  type ExternalWatchEvent,
} from "@shared/schema/external-watch";
import {
  soleneModelUpgradeRecommendations,
  type ModelUpgradeEventKind,
  type ModelUpgradeRecommendation,
} from "@shared/schema/solene-model-upgrade";
import { sendSolenePage } from "../solene/pagerService";
import { logger } from "../../utils/logger";

// ============================================================================
// CURRENT-MODEL RESOLUTION
// ============================================================================

/**
 * The model the dispatch runner is configured to use. Mirrors the env
 * lookup in dispatchRunner.ts so the classifier doesn't need to import
 * that module (would create a runtime cycle). The fallback previously said
 * "claude-opus-4-7" while dispatchRunner actually defaults to SONNET —
 * corrected 2026-07-08 to the same source of truth.
 */
export function getCurrentDispatchModel(): string {
  return process.env.SOLENE_DISPATCH_MODEL ?? ANTHROPIC_MODELS.SONNET;
}

// ============================================================================
// CLASSIFIER — pure function, fully tested
// ============================================================================

/**
 * Patterns inline (const arrays) so they're reviewable and easy to extend.
 * Order matters: deprecation/pricing are checked before new-model so that a
 * "Deprecation: claude-opus-4.5" item doesn't get misclassified as a release.
 */
const DEPRECATION_PATTERNS = [
  /\bdeprecat/i,
  /\bend[\s-]?of[\s-]?life\b/i,
  /\bretire(ment|d|s|ing)?\b/i,
  /\bsunset\b/i,
  /\bEOL\b/,
] as const;

const PRICING_PATTERNS = [
  /\bpricing\b/i,
  /\bprice\b/i,
  /per\s+million\s+tokens?/i,
  /\bcost\b.*\btoken/i,
] as const;

const RATE_LIMIT_PATTERNS = [
  /\brate[\s-]?limit/i,
  /\brate[\s-]?limits?\b/i,
  /\btier\b.*\blimit/i,
] as const;

const NEW_MODEL_TRIGGER_PATTERNS = [
  /\b(now\s+available|generally\s+available|GA|launch(ed|ing)?|release(d|s)?|available)\b/i,
] as const;

/**
 * Anthropic's canonical model identifier shape:
 *   claude-(opus|sonnet|haiku)-<major>(.<minor>)?
 * Matches "claude-opus-4.7", "Claude Opus 4.7", "claude-haiku-3.5", etc.
 * Case-insensitive; separator can be space or hyphen.
 */
const MODEL_IDENTIFIER_PATTERN =
  /claude[\s-](opus|sonnet|haiku)[\s-]?(\d+(?:\.\d+)?)/i;

/**
 * Legacy / fallback model identifiers (e.g. "claude-2.1") still surface
 * in deprecation notices. Matched explicitly so we don't lose them.
 */
const LEGACY_MODEL_IDENTIFIER_PATTERN = /\bclaude[\s-](\d+(?:\.\d+)?)\b/i;

const FEATURE_PATTERNS = [
  /\bextended\s+thinking\b/i,
  /\bvision\b/i,
  /\btool\s+use\b/i,
  /\bprompt\s+caching\b/i,
  /\bfiles?\s+API\b/i,
  /\bbatch\s+API\b/i,
] as const;

export interface ClassifiedEvent {
  kind: ModelUpgradeEventKind;
  affectedModel: string;
}

function extractModelIdentifier(text: string): string | null {
  const m = text.match(MODEL_IDENTIFIER_PATTERN);
  if (m) {
    // Normalize to canonical form "claude-<family>-<version>".
    return `claude-${m[1].toLowerCase()}-${m[2]}`;
  }
  const legacy = text.match(LEGACY_MODEL_IDENTIFIER_PATTERN);
  if (legacy) {
    return `claude-${legacy[1]}`;
  }
  return null;
}

function anyMatch(text: string, patterns: readonly RegExp[]): boolean {
  for (const p of patterns) {
    if (p.test(text)) return true;
  }
  return false;
}

/**
 * Classify an Anthropic release-notes event. Returns null when the event
 * is neither model-related nor pricing/rate-limit (e.g. generic community
 * announcements).
 */
export function classifyAnthropicEvent(event: {
  title: string;
  body: string;
  sourceUrl: string;
}): ClassifiedEvent | null {
  const haystack = `${event.title}\n${event.body}`;

  // 1. Deprecation has highest priority — wording often co-occurs with
  // a model identifier and we never want to miss this.
  if (anyMatch(haystack, DEPRECATION_PATTERNS)) {
    const model = extractModelIdentifier(haystack);
    if (model) {
      return { kind: "model_deprecated", affectedModel: model };
    }
  }

  // 2. Rate-limit changes — must mention a model or "rate limit" + tier.
  if (anyMatch(haystack, RATE_LIMIT_PATTERNS)) {
    const model = extractModelIdentifier(haystack);
    if (model) {
      return { kind: "rate_limit_change", affectedModel: model };
    }
  }

  // 3. Pricing changes — title or body contains pricing + a model
  // identifier OR explicit "per million tokens".
  if (anyMatch(haystack, PRICING_PATTERNS)) {
    const model = extractModelIdentifier(haystack);
    if (model) {
      return { kind: "pricing_change", affectedModel: model };
    }
  }

  // 4. Feature added — title contains a known feature term. Checked
  // before new_model_available because "extended thinking now available
  // on Claude Sonnet 4.6" matches both patterns and the feature framing
  // is the more precise classification.
  if (anyMatch(event.title, FEATURE_PATTERNS)) {
    const model = extractModelIdentifier(haystack) ?? "all";
    return { kind: "feature_added", affectedModel: model };
  }

  // 5. New model available — title mentions a model identifier paired
  // with a release/launch/GA trigger word.
  const titleModel = extractModelIdentifier(event.title);
  if (titleModel && anyMatch(event.title, NEW_MODEL_TRIGGER_PATTERNS)) {
    return { kind: "new_model_available", affectedModel: titleModel };
  }

  return null;
}

// ============================================================================
// DECISION MATRIX — pure function, fully tested
// ============================================================================

export interface DecisionOutcome {
  recommendation: ModelUpgradeRecommendation;
  rationale: string;
}

/**
 * Extract a percent-change from a pricing-change event body. Returns
 * positive on increase, negative on decrease, null if no clear signal.
 *   "Input pricing reduced by 15%" → -15
 *   "Price increase of 12%"        → +12
 *   "Pricing update for Haiku"     → null
 */
function detectPriceChangePercent(body: string): number | null {
  const decrease = body.match(
    /(reduc|decreas|lower|cut|drop)[a-z]*\s+(by\s+)?(\d+(?:\.\d+)?)\s*%/i,
  );
  if (decrease) return -Number(decrease[3]);
  const increase = body.match(
    /(increas|rais|hik|up)[a-z]*\s+(by\s+|of\s+)?(\d+(?:\.\d+)?)\s*%/i,
  );
  if (increase) return Number(increase[3]);
  return null;
}

/**
 * Strip the version suffix off a canonical model identifier so we can
 * compare families. "claude-opus-4.7" → "claude-opus". Legacy ids
 * ("claude-2.1") fall back to the bare token.
 */
function modelFamily(identifier: string): string {
  const m = identifier.match(/^claude-(opus|sonnet|haiku)/i);
  if (m) return `claude-${m[1].toLowerCase()}`;
  return identifier.replace(/-\d.*$/, "");
}

function sameFamily(a: string, b: string): boolean {
  return modelFamily(a) === modelFamily(b);
}

export function decideAction(
  event: ClassifiedEvent & { body?: string },
  currentModel: string,
): DecisionOutcome {
  const isCurrentModel = sameFamily(event.affectedModel, currentModel);

  switch (event.kind) {
    case "model_deprecated":
      if (isCurrentModel) {
        return {
          recommendation: "adopt_now",
          rationale: `Deprecation of in-use model ${event.affectedModel}; migration deadline non-negotiable.`,
        };
      }
      return {
        recommendation: "flag_only",
        rationale: `Deprecation of ${event.affectedModel} (not currently in use).`,
      };

    case "pricing_change": {
      const pct = detectPriceChangePercent(event.body ?? "");
      if (isCurrentModel) {
        if (pct !== null && pct < 0) {
          return {
            recommendation: "flag_only",
            rationale: `Pricing decrease (${pct}%) on in-use model ${event.affectedModel}; informational.`,
          };
        }
        if (pct !== null && pct > 10) {
          return {
            recommendation: "schedule_eval",
            rationale: `Pricing increase (+${pct}%) on in-use model ${event.affectedModel}; evaluate alternatives.`,
          };
        }
        return {
          recommendation: "flag_only",
          rationale: `Pricing change on in-use model ${event.affectedModel}; no material delta detected.`,
        };
      }
      return {
        recommendation: "flag_only",
        rationale: `Pricing change on ${event.affectedModel} (not currently in use).`,
      };
    }

    case "new_model_available":
      if (isCurrentModel) {
        return {
          recommendation: "schedule_eval",
          rationale: `New model in the in-use family: ${event.affectedModel}. Eval against quality bar before adoption.`,
        };
      }
      return {
        recommendation: "flag_only",
        rationale: `New model ${event.affectedModel} (different family from ${currentModel}).`,
      };

    case "feature_added":
      return {
        recommendation: "flag_only",
        rationale: `Feature addition affecting ${event.affectedModel}; informational.`,
      };

    case "rate_limit_change":
      if (isCurrentModel) {
        return {
          recommendation: "flag_only",
          rationale: `Rate-limit change on in-use model ${event.affectedModel}; informational.`,
        };
      }
      return {
        recommendation: "flag_only",
        rationale: `Rate-limit change on ${event.affectedModel} (not currently in use).`,
      };

    default:
      return {
        recommendation: "flag_only",
        rationale: `Unhandled event kind; default to flag_only.`,
      };
  }
}

// ============================================================================
// PERSISTENCE — processWatchEvent
// ============================================================================

export interface ProcessWatchEventResult {
  recommendationId: number | null;
  classification: ClassifiedEvent | null;
}

/**
 * Pull an external_watch_events row by id, classify it, decide the
 * recommendation, persist it, and (for adopt_now) page Solene. Idempotent
 * via the UNIQUE source_event_id index — calling twice for the same
 * event is a no-op on the second call.
 */
export async function processWatchEvent(
  eventId: number,
): Promise<ProcessWatchEventResult> {
  const rows = await db
    .select()
    .from(externalWatchEvents)
    .where(eq(externalWatchEvents.id, eventId))
    .limit(1);
  const event: ExternalWatchEvent | undefined = rows[0];
  if (!event) {
    logger.warn(
      `[modelUpgradePath] processWatchEvent: event ${eventId} not found`,
    );
    return { recommendationId: null, classification: null };
  }

  // Only act on Anthropic-sourced events. The schema permits any source
  // here defensively; today only anthropic_api flows through this path.
  if (event.source !== "anthropic_api") {
    return { recommendationId: null, classification: null };
  }

  const classification = classifyAnthropicEvent({
    title: event.title,
    body: event.summary,
    sourceUrl: event.sourceUrl,
  });
  if (!classification) {
    return { recommendationId: null, classification: null };
  }

  const currentModel = getCurrentDispatchModel();
  const decision = decideAction(
    { ...classification, body: event.summary },
    currentModel,
  );

  // Insert with onConflictDoNothing on the UNIQUE source_event_id so a
  // second call for the same event is a safe no-op.
  let recommendationId: number | null = null;
  try {
    const inserted = await db
      .insert(soleneModelUpgradeRecommendations)
      .values({
        sourceEventId: event.id,
        eventKind: classification.kind,
        affectedModel: classification.affectedModel,
        currentModelInUse: currentModel,
        recommendation: decision.recommendation,
        rationale: decision.rationale,
      })
      .onConflictDoNothing({
        target: soleneModelUpgradeRecommendations.sourceEventId,
      })
      .returning({ id: soleneModelUpgradeRecommendations.id });
    if (inserted.length > 0) {
      recommendationId = inserted[0].id;
    } else {
      // Duplicate — recommendation already exists for this event.
      logger.info(
        `[modelUpgradePath] event ${event.id} already has a recommendation; skipping`,
      );
      return { recommendationId: null, classification };
    }
  } catch (err) {
    logger.warn(
      `[modelUpgradePath] persist failed for event ${event.id}`,
      err instanceof Error
        ? { metadata: { err: err.message } }
        : { metadata: { err: String(err) } },
    );
    return { recommendationId: null, classification };
  }

  // adopt_now → page Solene urgent. Wrap so a pager failure cannot
  // overturn the persisted recommendation.
  if (decision.recommendation === "adopt_now") {
    try {
      await sendSolenePage({
        severity: "urgent",
        subject: `Model deprecation: ${classification.affectedModel}`,
        body: `${decision.rationale}\nSource: ${event.sourceUrl}\nRecommendation id: ${recommendationId}`,
      });
    } catch (err) {
      logger.warn(
        `[modelUpgradePath] page send failed for recommendation ${recommendationId}`,
        err instanceof Error
          ? { metadata: { err: err.message } }
          : { metadata: { err: String(err) } },
      );
    }
  }

  return { recommendationId, classification };
}

// ============================================================================
// BACKFILL — processUnactionedEvents
// ============================================================================

export interface ProcessUnactionedEventsResult {
  processed: number;
  recommended: number;
}

/**
 * Scan external_watch_events for anthropic_api items that have no
 * corresponding recommendation row yet. Used as a backfill / catch-up
 * path so the system can recover after a downtime window or after the
 * classifier is first deployed (covers historical rows).
 */
export async function processUnactionedEvents(): Promise<ProcessUnactionedEventsResult> {
  // LEFT JOIN style via drizzle: find external_watch_events rows whose
  // id is NOT yet referenced by solene_model_upgrade_recommendations.
  const candidates = await db
    .select({
      id: externalWatchEvents.id,
      recommendationId: soleneModelUpgradeRecommendations.id,
      ackStatus: externalWatchEvents.ackStatus,
      source: externalWatchEvents.source,
    })
    .from(externalWatchEvents)
    .leftJoin(
      soleneModelUpgradeRecommendations,
      eq(soleneModelUpgradeRecommendations.sourceEventId, externalWatchEvents.id),
    )
    .where(
      and(
        eq(externalWatchEvents.source, "anthropic_api"),
        eq(externalWatchEvents.ackStatus, "pending"),
        isNull(soleneModelUpgradeRecommendations.id),
      ),
    );

  let processed = 0;
  let recommended = 0;
  for (const c of candidates) {
    processed++;
    try {
      const result = await processWatchEvent(c.id);
      if (result.recommendationId !== null) {
        recommended++;
      }
    } catch (err) {
      logger.warn(
        `[modelUpgradePath] processUnactionedEvents: event ${c.id} failed`,
        err instanceof Error
          ? { metadata: { err: err.message } }
          : { metadata: { err: String(err) } },
      );
    }
  }

  return { processed, recommended };
}
