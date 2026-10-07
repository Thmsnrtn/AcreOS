/**
 * Founder controls the autopilot obeys MECHANICALLY (Stage 2, task 3 + S10).
 *
 *   pause / resume a domain — "pause growth": the tick stops acting on that
 *     domain's moves, its queued and in-flight dispatches are cancelled, and
 *     planAndAct refuses it (defence in depth). Resume lifts it.
 *   the ad switch — "stop spending money on ads": ads_enabled=false makes
 *     run_ad_campaign refuse at the hand, rejects every PENDING ad action, and
 *     the tick suppresses any ad-shaped move. Turning it back on re-allows ads
 *     (each still behind the hand's ceiling and a witness).
 *   the panic-stop snapshot — what a panic stop switched off, recorded AT the
 *     stop, so the resume can put it back as ONE founder confirm.
 *
 * Standing orders (standingOrders.ts) are instruction-level — composed into a
 * prompt. These are not: the reply text of a chat turn is never the evidence;
 * the settings row, the dispatch queue and the pending-action queue are.
 */
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "../../db";
import { autopilotPendingActions, autopilotSettings } from "@shared/schema";
import { soleneDispatchQueue } from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";
import type { AutopilotDomain } from "./policyGate";

export const PAUSABLE = ["growth", "support", "deploy", "ops", "finance", "ads"] as const;
export type Pausable = (typeof PAUSABLE)[number];

export function isPausable(v: unknown): v is Pausable {
  return typeof v === "string" && (PAUSABLE as readonly string[]).includes(v);
}

/** Ad-shaped move kinds/rationales (paid reach). Pure. */
export function isAdMove(move: { kind: string; rationale?: string }): boolean {
  return /\b(ads?|advertis\w*|ad[\s_-]?spend|paid[\s_-]?(?:reach|acquisition|social|search)|ppc|meta[\s_-]?ads|facebook[\s_-]?ads|google[\s_-]?ads|run_ad_campaign)\b/i.test(
    `${move.kind.replace(/_/g, " ")} ${move.kind} ${move.rationale ?? ""}`,
  );
}

export interface ControlState {
  pausedDomains: AutopilotDomain[];
  adsEnabled: boolean;
}

/** Read the controls. A read failure is "nothing paused, ads as the env says" — logged. */
export async function getControlState(): Promise<ControlState> {
  try {
    const [row] = await db
      .select({ paused: autopilotSettings.pausedDomains, ads: autopilotSettings.adsEnabled })
      .from(autopilotSettings)
      .where(eq(autopilotSettings.id, 1))
      .limit(1);
    const paused = Array.isArray(row?.paused) ? (row!.paused as string[]) : [];
    return {
      pausedDomains: paused.filter((d) => d !== "ads") as AutopilotDomain[],
      // null → not set → ads are allowed (still ceiling-bound + witnessed).
      adsEnabled: row?.ads !== false,
    };
  } catch (err) {
    logger.warn("[founderControls] control read failed", err instanceof Error ? err : undefined);
    return { pausedDomains: [], adsEnabled: true };
  }
}

/** Should the loop act on this move right now? Pure over a state. */
export function moveBlockedByControls(move: { domain: string; kind: string; rationale?: string }, state: ControlState): string | null {
  if ((state.pausedDomains as string[]).includes(move.domain)) return `the founder paused ${move.domain}`;
  if (!state.adsEnabled && isAdMove(move)) return "the founder turned ad spending off";
  return null;
}

/** Cancel queued + in-flight autopilot dispatches whose move belongs to `match`. */
async function cancelDispatchesWhere(match: (moveKind: string) => boolean, reason: string): Promise<number[]> {
  const rows = await db
    .select({ id: soleneDispatchQueue.id, sourceId: soleneDispatchQueue.sourceId })
    .from(soleneDispatchQueue)
    .where(and(inArray(soleneDispatchQueue.status, ["queued", "in_progress"]), like(soleneDispatchQueue.sourceId, "autopilot:%")));
  const ids = rows.filter((r) => match(r.sourceId.slice("autopilot:".length))).map((r) => r.id);
  if (ids.length === 0) return [];
  await db
    .update(soleneDispatchQueue)
    .set({ status: "cancelled", completedAt: new Date(), resultSummary: `cancelled: ${reason}`.slice(0, 4000) })
    .where(and(inArray(soleneDispatchQueue.id, ids), inArray(soleneDispatchQueue.status, ["queued", "in_progress"])));
  return ids;
}

export interface PauseResult {
  target: Pausable;
  paused: boolean;
  dispatchesCancelled: number[];
  pendingActionsRejected: number[];
}

/**
 * Pause (or resume) a domain, or switch ads off (or on). Writes the settings
 * row FIRST — the tick reads it — then cancels what is already queued.
 */
export async function setPaused(target: Pausable, paused: boolean, by: string): Promise<PauseResult> {
  const out: PauseResult = { target, paused, dispatchesCancelled: [], pendingActionsRejected: [] };
  if (target === "ads") {
    await db
      .insert(autopilotSettings)
      .values({ id: 1, adsEnabled: !paused, updatedBy: by })
      .onConflictDoUpdate({ target: autopilotSettings.id, set: { adsEnabled: !paused, updatedAt: new Date(), updatedBy: by } });
    if (paused) {
      const rejected = await db
        .update(autopilotPendingActions)
        .set({ status: "rejected", approvedBy: `${by} (ads switched off)` })
        .where(and(eq(autopilotPendingActions.handName, "run_ad_campaign"), eq(autopilotPendingActions.status, "pending")))
        .returning({ id: autopilotPendingActions.id });
      out.pendingActionsRejected = rejected.map((r) => r.id);
      out.dispatchesCancelled = await cancelDispatchesWhere((k) => isAdMove({ kind: k }), "the founder turned ad spending off");
    }
  } else {
    const state = await getControlState();
    const next = new Set<string>(state.pausedDomains);
    if (paused) next.add(target);
    else next.delete(target);
    const value = [...next].sort();
    await db
      .insert(autopilotSettings)
      .values({ id: 1, pausedDomains: value, updatedBy: by })
      .onConflictDoUpdate({ target: autopilotSettings.id, set: { pausedDomains: value, updatedAt: new Date(), updatedBy: by } });
    if (paused) {
      const { bindingFor } = await import("./act");
      out.dispatchesCancelled = await cancelDispatchesWhere((k) => bindingFor(k).domain === target, `the founder paused ${target}`);
    }
  }
  try {
    const { __resetSettingsCacheForTest } = await import("./settings");
    __resetSettingsCacheForTest();
  } catch {
    /* cache bust is best-effort */
  }
  logger.warn("[founderControls] founder control changed", { metadata: { target, paused, by, cancelled: out.dispatchesCancelled.length, rejected: out.pendingActionsRejected.length } });
  return out;
}

// ── S10: the panic-stop snapshot ─────────────────────────────────────────────

export interface PreStopSnapshot {
  at: string;
  by: string;
  switches: { dispatchEnabled: boolean; publishEnabled: boolean; cognitionEnabled: boolean };
  levels: Record<string, string>;
}

/**
 * Record what is ON right now, before a panic stop turns it off. Only the
 * FIRST stop of an episode is recorded — a second stop while already stopped
 * would otherwise overwrite the real prior state with "everything off".
 */
export async function recordPreStopSnapshot(by: string): Promise<PreStopSnapshot | null> {
  const [row] = await db.select({ snap: autopilotSettings.preStopSnapshot }).from(autopilotSettings).where(eq(autopilotSettings.id, 1)).limit(1);
  if (row?.snap) return row.snap as PreStopSnapshot;
  const { getEffectiveSettings, __resetSettingsCacheForTest } = await import("./settings");
  __resetSettingsCacheForTest();
  const s = await getEffectiveSettings();
  const { getTrustLedger } = await import("./domainAutonomy");
  const ledger = await getTrustLedger();
  const snap: PreStopSnapshot = {
    at: new Date().toISOString(),
    by,
    switches: { dispatchEnabled: s.dispatchEnabled, publishEnabled: s.publishEnabled, cognitionEnabled: s.cognitionEnabled },
    levels: Object.fromEntries(ledger.map((l) => [l.domain, l.level])),
  };
  await db
    .insert(autopilotSettings)
    .values({ id: 1, preStopSnapshot: snap, updatedBy: by })
    .onConflictDoUpdate({ target: autopilotSettings.id, set: { preStopSnapshot: snap, updatedAt: new Date() } });
  return snap;
}

export async function readPreStopSnapshot(): Promise<PreStopSnapshot | null> {
  const [row] = await db.select({ snap: autopilotSettings.preStopSnapshot }).from(autopilotSettings).where(eq(autopilotSettings.id, 1)).limit(1);
  return (row?.snap as PreStopSnapshot | null) ?? null;
}

export async function clearPreStopSnapshot(by: string): Promise<void> {
  await db.update(autopilotSettings).set({ preStopSnapshot: null, updatedAt: new Date(), updatedBy: by }).where(eq(autopilotSettings.id, 1));
}

/**
 * Stage 2 — the move the tick should work: the first one the founder has not
 * blocked (pause / ads off) and that is not already WAITING on him (an open
 * ask whose summary names it, `…: <kind>`). Falls back to the first unblocked
 * move when every one is waiting (its ask then folds). Pure.
 */
export function firstWorkableMove<M extends { domain: string; kind: string; rationale?: string }>(
  moves: M[],
  state: ControlState,
  openAskSummaries: string[],
): M | null {
  const unblocked = moves.filter((m) => !moveBlockedByControls(m, state));
  const waiting = (kind: string) => openAskSummaries.some((sum) => sum.endsWith(`: ${kind}`));
  return unblocked.find((m) => !waiting(m.kind)) ?? unblocked[0] ?? null;
}
