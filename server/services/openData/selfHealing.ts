/**
 * Self-Healing Data Plane — detection→annunciation loop (ruling #9 wave 4,
 * docs/company/founder-decisions-2026-07-28.md).
 *
 * The synthetic canary (server/jobs/dataSourceProbe.ts) already detects
 * free-endpoint drift and writes `provider_health` — but until this module,
 * nobody was TOLD. HIFLD died in Aug 2025 and sat silently rotting until a
 * manual audit found it; the SDA soil query rotted the same way. This module
 * closes the loop: persistent canary failure becomes ONE founder decision
 * card with a plain-words diagnosis.
 *
 * What this module deliberately does NOT do (no-fabrication + human-approval
 * doctrine): it never swaps a data source, never promises an auto-fix, and
 * never invents a fallback. Replacement proposals are a SEPARATE reviewed
 * flow (the discovery pipeline); this module only detects, diagnoses, and
 * annunciates. On recovery it closes the drift window silently — good news
 * needs no card.
 *
 * ── Persistence threshold (documented, conservative) ─────────────────────
 * The probe writes one provider_health row per golden probe per run (~every
 * 30 minutes). A single blip is NEVER drift. A category is CONFIRMED_DRIFT
 * only when, within the lookback window, ALL of the following hold:
 *
 *   1. EVERY golden probe for that category is currently failing (its most
 *      recent row is unhealthy) — one county coordinate misbehaving while a
 *      sibling probe passes is not category drift;
 *   2. every probe's CURRENT consecutive-failure streak is at least
 *      DRIFT_MIN_CONSECUTIVE_RUNS (3) rows deep — measured directly from
 *      stored rows, newest backwards until a healthy row; and
 *   3. the category has been fully dark for at least DRIFT_MIN_SPAN_MS
 *      (2 hours): newest failing checkedAt minus firstFailedAt >= 2h, where
 *      firstFailedAt is the moment the LAST probe in the category started
 *      its current streak (max over probes of each streak's oldest row).
 *
 * At the ~30-minute cadence, conditions 2+3 together mean roughly five
 * consecutive fully-failed runs before a card is raised.
 *
 * ── Marker discipline ────────────────────────────────────────────────────
 * One platform_settings marker per category (`self_healing.drift.<category>`)
 * records the open/closed drift window. An OPEN window never raises a second
 * card (re-runs dedupe); a CLOSED window only re-raises for a NEW failure
 * window (firstFailedAt strictly after the previous window closed). Recovery
 * (all probes for the category passing again) closes the window with no card.
 */

import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "../../db";
import { platformSettings, providerHealth } from "@shared/schema";
import { decisionsInboxService } from "../decisionsInbox";
import { logger } from "../../utils/logger";

// ── Threshold constants (see module doc for the rationale) ────────────────

/** Minimum current consecutive-failure streak, per probe, in stored rows. */
export const DRIFT_MIN_CONSECUTIVE_RUNS = 3;

/** Minimum time the whole category must have been dark (ms). */
export const DRIFT_MIN_SPAN_MS = 2 * 60 * 60 * 1000; // 2 hours

/** How far back to read provider_health when evaluating (ms). */
export const PROBE_HEALTH_LOOKBACK_MS = 48 * 60 * 60 * 1000; // 48 hours

/** platform_settings marker key prefix — one marker per category. */
export const DRIFT_MARKER_PREFIX = "self_healing.drift.";

// ── Types ─────────────────────────────────────────────────────────────────

/** The provider_health columns the evaluator needs (subset of the table). */
export interface ProbeHealthRow {
  source: string;
  category: string;
  probe: string;
  healthy: boolean;
  detail: string | null;
  checkedAt: Date;
}

export interface ConfirmedDrift {
  kind: "CONFIRMED_DRIFT";
  /** Registry source name from the newest failing row (diagnosis aid). */
  source: string;
  category: string;
  /** When the LAST probe in the category went dark — the whole-category dark point. */
  firstFailedAt: Date;
  /** Conservative: the SMALLEST current streak across the category's probes. */
  consecutiveFailures: number;
  /** detail column of the newest failing row. */
  lastError: string | null;
  /** Golden-probe labels that are dark. */
  probes: string[];
}

export interface ProbeHealthEvaluation {
  drifts: ConfirmedDrift[];
  /** Categories whose LATEST row per probe is healthy — recovery candidates. */
  healthyCategories: string[];
}

interface DriftMarkerValue {
  status: "open" | "closed";
  category: string;
  source: string;
  firstFailedAt: string; // ISO
  openedAt?: string;
  closedAt?: string;
  cardItemId?: number | null;
}

// ── Honest impact map: category → what breaks in the product ──────────────
// Small and honest by design: each line names the customer-facing surface
// that leans on the category, in plain words. Unknown categories fall back
// to a generic-but-truthful line.

export const CATEGORY_IMPACT: Record<string, string> = {
  flood_zone: "flood-zone answers on the Map and in due-diligence reports",
  soil: "soil suitability in due-diligence reports",
  wetlands: "wetlands overlays on the Map and due-diligence checks",
  elevation: "slope and elevation figures on parcel cards",
  environmental: "the combined environmental snapshot on parcel lookups",
  demographics: "area demographics on market pages",
  parcel_data: "parcel boundary and ownership lookups",
  wildfire_hazard: "wildfire risk ratings in due-diligence reports",
  broadband: "broadband availability answers on parcel cards",
  infrastructure: "infrastructure proximity answers",
};

export function categoryImpact(category: string): string {
  return CATEGORY_IMPACT[category] ?? `${category.replace(/_/g, " ")} lookups across the product`;
}

// ── Pure evaluator (unit-testable, no I/O) ────────────────────────────────

/**
 * Evaluate raw provider_health rows against the documented persistence
 * threshold. Pure function — the DB wrapper (evaluateProbeHealth) feeds it.
 */
export function evaluateProbeRows(rows: ProbeHealthRow[]): ProbeHealthEvaluation {
  // category → probe label → rows sorted newest-first.
  const byCategory = new Map<string, Map<string, ProbeHealthRow[]>>();
  for (const row of rows) {
    let probes = byCategory.get(row.category);
    if (!probes) byCategory.set(row.category, (probes = new Map()));
    let list = probes.get(row.probe);
    if (!list) probes.set(row.probe, (list = []));
    list.push(row);
  }

  const drifts: ConfirmedDrift[] = [];
  const healthyCategories: string[] = [];

  for (const [category, probes] of byCategory) {
    let allProbesFailing = true;
    let allProbesHealthy = true;
    let minStreak = Infinity;
    let firstFailedAt: Date | null = null; // max over probes of streak start
    let newestFail: ProbeHealthRow | null = null;
    const darkProbes: string[] = [];

    for (const [label, list] of probes) {
      list.sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
      const newest = list[0];
      if (newest.healthy) {
        allProbesFailing = false;
        continue;
      }
      allProbesHealthy = false;

      // Current consecutive-failure streak: newest backwards until healthy.
      let streak = 0;
      let streakOldest = newest;
      for (const r of list) {
        if (r.healthy) break;
        streak++;
        streakOldest = r;
      }
      darkProbes.push(label);
      minStreak = Math.min(minStreak, streak);
      if (!firstFailedAt || streakOldest.checkedAt > firstFailedAt) {
        firstFailedAt = streakOldest.checkedAt;
      }
      if (!newestFail || newest.checkedAt > newestFail.checkedAt) {
        newestFail = newest;
      }
    }

    if (allProbesHealthy) {
      healthyCategories.push(category);
      continue;
    }
    if (!allProbesFailing || !newestFail || !firstFailedAt) continue; // mixed — not category drift

    const spanMs = newestFail.checkedAt.getTime() - firstFailedAt.getTime();
    if (minStreak >= DRIFT_MIN_CONSECUTIVE_RUNS && spanMs >= DRIFT_MIN_SPAN_MS) {
      drifts.push({
        kind: "CONFIRMED_DRIFT",
        source: newestFail.source,
        category,
        firstFailedAt,
        consecutiveFailures: minStreak,
        lastError: newestFail.detail,
        probes: darkProbes.sort(),
      });
    }
  }

  return { drifts, healthyCategories };
}

/** Read recent provider_health rows and evaluate them (DB wrapper). */
export async function evaluateProbeHealth(): Promise<ProbeHealthEvaluation> {
  const cutoff = new Date(Date.now() - PROBE_HEALTH_LOOKBACK_MS);
  const rows = await db
    .select({
      source: providerHealth.source,
      category: providerHealth.category,
      probe: providerHealth.probe,
      healthy: providerHealth.healthy,
      detail: providerHealth.detail,
      checkedAt: providerHealth.checkedAt,
    })
    .from(providerHealth)
    .where(gte(providerHealth.checkedAt, cutoff))
    .orderBy(desc(providerHealth.checkedAt));
  return evaluateProbeRows(rows as ProbeHealthRow[]);
}

// ── Marker plumbing ───────────────────────────────────────────────────────

function markerKey(category: string): string {
  return `${DRIFT_MARKER_PREFIX}${category}`;
}

async function readDriftMarker(
  category: string,
): Promise<{ id: number; value: DriftMarkerValue } | null> {
  const rows = await db
    .select({ id: platformSettings.id, value: platformSettings.value })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.scope, "global"),
        isNull(platformSettings.scopeRef),
        eq(platformSettings.key, markerKey(category)),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, value: row.value as DriftMarkerValue };
}

async function writeDriftMarker(
  category: string,
  existing: { id: number } | null,
  value: DriftMarkerValue,
): Promise<void> {
  if (existing) {
    await db
      .update(platformSettings)
      .set({
        value,
        lastChangedBy: "self-healing-data-plane",
        lastChangedAt: new Date(),
      })
      .where(
        and(
          eq(platformSettings.scope, "global"),
          isNull(platformSettings.scopeRef),
          eq(platformSettings.key, markerKey(category)),
        ),
      );
  } else {
    await db.insert(platformSettings).values({
      key: markerKey(category),
      scope: "global",
      scopeRef: null,
      value,
      defaultValue: {},
      category: "data_plane",
      description:
        "Self-Healing Data Plane drift-window marker: open/closed annunciation state for this data category's canary probes (ruling #9 wave 4).",
      lastChangedBy: "self-healing-data-plane",
      lastChangedAt: new Date(),
    });
  }
}

// ── Card copy ─────────────────────────────────────────────────────────────

function humanCategory(category: string): string {
  return category.replace(/_/g, "-");
}

export function buildDriftCard(finding: ConfirmedDrift): {
  subject: string;
  analysis: string;
  recommendedAction: string;
  recommendedActionLabel: string;
  options: Array<{ key: string; label: string }>;
} {
  const since = finding.firstFailedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const hours = Math.floor(
    Math.max(0, Date.now() - finding.firstFailedAt.getTime()) / (60 * 60 * 1000),
  );
  const label = humanCategory(finding.category);
  return {
    subject: `Data instrument dark: ${label} — since ${since}`,
    analysis:
      `The ${label} instrument went dark on ${since} and has stayed dark for ` +
      `${finding.consecutiveFailures}+ consecutive probe runs (about ${hours}h). Every synthetic ` +
      `canary for this category is failing (${finding.probes.join(", ")}); the last upstream ` +
      `source answering was "${finding.source}" and the last error was: ` +
      `"${finding.lastError ?? "no detail recorded"}". ` +
      `What this feeds: ${categoryImpact(finding.category)} — those answers are degraded until the ` +
      `upstream recovers or a replacement is approved. ` +
      `What the machine will do on its own: keep serving previously fetched answers from cache ` +
      `where one exists (marked as cached), and report the gap honestly everywhere else — no ` +
      `invented numbers, no silent substitute. It will NOT auto-fix this or swap in a replacement ` +
      `source on its own: any replacement is proposed separately through the reviewed discovery ` +
      `flow and goes live only after your approval.`,
    recommendedAction: "self_healing_drift_acknowledge",
    recommendedActionLabel: "Acknowledge the dark instrument",
    options: [
      {
        key: "acknowledge",
        label: "Acknowledge — I've seen it; keep reporting the gap honestly meanwhile",
      },
      { key: "hold", label: "Hold — keep this open while we watch the upstream" },
    ],
  };
}

// ── Annunciation ──────────────────────────────────────────────────────────

export type AnnunciationResult =
  | "card_raised"
  | "window_already_open"
  | "same_window_already_annunciated"
  | "failed";

/**
 * Raise ONE founder decision card for a confirmed drift finding.
 * Marker-guarded per (category, failure window): an open window never gets a
 * second card; a closed window only re-raises when the finding's
 * firstFailedAt is strictly AFTER the previous window closed (a NEW failure
 * window). Card first, marker second — a marker-write failure retries next
 * run, where createDirectDecisionCard's own open-card subject dedupe still
 * prevents a duplicate. Never throws.
 */
export async function annunciateDrift(finding: ConfirmedDrift): Promise<AnnunciationResult> {
  try {
    const marker = await readDriftMarker(finding.category);
    if (marker?.value?.status === "open") return "window_already_open";
    if (marker?.value?.status === "closed") {
      const prevWindowEnd = Date.parse(marker.value.closedAt ?? marker.value.firstFailedAt);
      if (Number.isFinite(prevWindowEnd) && finding.firstFailedAt.getTime() <= prevWindowEnd) {
        // Same (or stale) window as one already annunciated and closed.
        return "same_window_already_annunciated";
      }
    }

    const card = buildDriftCard(finding);
    const { itemId } = await decisionsInboxService.createDirectDecisionCard({
      itemType: "critical_alert",
      riskLevel: "high",
      urgencyScore: 70,
      sophieAnalysis: card.analysis,
      recommendedAction: card.recommendedAction,
      recommendedActionLabel: card.recommendedActionLabel,
      subject: card.subject,
      options: card.options,
    });

    await writeDriftMarker(finding.category, marker, {
      status: "open",
      category: finding.category,
      source: finding.source,
      firstFailedAt: finding.firstFailedAt.toISOString(),
      openedAt: new Date().toISOString(),
      cardItemId: itemId,
    });

    logger.warn(
      `[selfHealing] CONFIRMED_DRIFT annunciated: ${finding.category} dark since ${finding.firstFailedAt.toISOString()}`,
      {
        source: "selfHealing",
        metadata: {
          category: finding.category,
          driftSource: finding.source,
          consecutiveFailures: finding.consecutiveFailures,
          lastError: finding.lastError,
          cardItemId: itemId,
        },
      },
    );
    return "card_raised";
  } catch (err) {
    logger.error(
      `[selfHealing] annunciation failed for ${finding.category} (will retry next probe run)`,
      err instanceof Error ? err : undefined,
    );
    return "failed";
  }
}

/**
 * Recovery: a category with an OPEN drift window whose probes all pass again
 * gets its window closed (so a FUTURE failure raises a fresh card). Silence
 * on good — no card, no alert. Returns true when a window was closed.
 */
export async function closeDriftWindowIfOpen(category: string): Promise<boolean> {
  try {
    const marker = await readDriftMarker(category);
    if (!marker || marker.value?.status !== "open") return false;
    await writeDriftMarker(category, marker, {
      ...marker.value,
      status: "closed",
      closedAt: new Date().toISOString(),
    });
    logger.info(`[selfHealing] drift window closed on recovery: ${category}`, {
      source: "selfHealing",
      metadata: { category, openedAt: marker.value.openedAt },
    });
    return true;
  } catch (err) {
    logger.warn(`[selfHealing] recovery marker write failed for ${category} (non-blocking)`, {
      source: "selfHealing",
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return false;
  }
}

// ── Sweep (called by dataSourceProbe at the end of each run) ──────────────

export interface SelfHealingSweepResult {
  confirmedDrifts: number;
  cardsRaised: number;
  windowsClosed: number;
}

/**
 * The full detection→annunciation pass: evaluate stored probe history,
 * annunciate confirmed drift (marker-deduped), close recovered windows.
 * Best-effort by contract — each finding is isolated; a total failure logs
 * and returns zeros rather than throwing into the probe job.
 */
export async function runSelfHealingSweep(): Promise<SelfHealingSweepResult> {
  const result: SelfHealingSweepResult = { confirmedDrifts: 0, cardsRaised: 0, windowsClosed: 0 };
  try {
    const { drifts, healthyCategories } = await evaluateProbeHealth();
    result.confirmedDrifts = drifts.length;
    for (const finding of drifts) {
      if ((await annunciateDrift(finding)) === "card_raised") result.cardsRaised++;
    }
    for (const category of healthyCategories) {
      if (await closeDriftWindowIfOpen(category)) result.windowsClosed++;
    }
  } catch (err) {
    logger.warn("[selfHealing] sweep failed (non-blocking)", {
      source: "selfHealing",
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }
  return result;
}
