/**
 * Founder Autopilot — the loop-stall detector (the self-watchdog).
 *
 * P0 batch 6. The autopilot's promise is that it runs the company while the
 * founder is away. The corollary: the ONE failure that must never be silent is
 * the autopilot itself going dark. A stalled brain that doesn't know it's
 * stalled is worse than no brain — it gives false confidence. This module is
 * the independent observer that watches the loop's vital signs and decides when
 * the founder must be paged.
 *
 * Two parts, same split as the rest of the autopilot:
 *  - detectLoopStall(obs)  — PURE classification of pre-gathered observations.
 *                            `now` is passed in, so it's deterministic + testable.
 *  - observeLoopHealth()   — gathers the observations from live sources
 *                            (latest morning pulse + dispatch queue). Injectable
 *                            so tests never touch the DB.
 *
 * Honesty: it watches only signals that genuinely exist. The morning-pulse
 * timestamp is the loop's heartbeat (the tick refreshes it); the dispatch queue
 * age is the hands' heartbeat. A backlog is only a stall signal when the
 * consumer is ENABLED — while gated off, a queue that doesn't drain is expected,
 * not broken, and the detector says so rather than crying wolf.
 */
import { logger } from "../../utils/logger";

export type StallSeverity = "healthy" | "degraded" | "stalled";

export interface LoopHealthObservation {
  /** Current time (epoch ms) — injected for determinism. */
  now: number;
  /** Epoch ms of the most recent morning pulse (the loop's heartbeat); null if none. */
  lastPulseAt: number | null;
  /** Queued-but-not-run dispatch count. */
  dispatchBacklog: number;
  /** Age (ms) of the oldest queued dispatch; null if the queue is empty. */
  oldestQueuedDispatchAgeMs: number | null;
  /** Whether the dispatch consumer is switched on. A backlog only matters if so. */
  dispatchConsumerEnabled: boolean;
}

export interface StallVerdict {
  severity: StallSeverity;
  /** Human-readable signals that tripped, for the page body + audit log. */
  signals: string[];
  /** True only when the autopilot has genuinely gone dark — page the founder. */
  shouldPageFounder: boolean;
  summary: string;
}

// Thresholds. The tick runs every ~30m and refreshes the pulse when it's >6h
// old, so a pulse older than ~7h means the loop missed its safety net; >24h
// means it's dark. Dispatch ages assume the consumer drains within minutes.
const PULSE_DEGRADED_MS = 7 * 60 * 60 * 1000; // 7h
const PULSE_STALLED_MS = 24 * 60 * 60 * 1000; // 24h
const DISPATCH_DEGRADED_MS = 60 * 60 * 1000; // 1h
const DISPATCH_STALLED_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Classify loop health from pre-gathered observations. Pure + total.
 * Severity is the worst signal that tripped; healthy if none did.
 */
export function detectLoopStall(obs: LoopHealthObservation): StallVerdict {
  const signals: string[] = [];
  const RANK: Record<StallSeverity, number> = { healthy: 0, degraded: 1, stalled: 2 };
  let rank = 0;
  const worsen = (s: StallSeverity) => {
    if (RANK[s] > rank) rank = RANK[s];
  };

  // ── Heartbeat: is the loop still ticking? ─────────────────────────────────
  if (obs.lastPulseAt == null) {
    // No pulse ever recorded. Pre-first-run this is benign; we flag it as
    // degraded (not stalled) so a fresh deploy doesn't page on boot.
    signals.push("No morning pulse has ever been recorded.");
    worsen("degraded");
  } else {
    const pulseAge = obs.now - obs.lastPulseAt;
    if (pulseAge >= PULSE_STALLED_MS) {
      signals.push(`Loop heartbeat is dark: no pulse in ${hours(pulseAge)}h (≥24h).`);
      worsen("stalled");
    } else if (pulseAge >= PULSE_DEGRADED_MS) {
      signals.push(`Loop heartbeat is late: no pulse in ${hours(pulseAge)}h (missed the 6h refresh).`);
      worsen("degraded");
    }
  }

  // ── Hands: is the dispatch consumer draining? ─────────────────────────────
  // Only meaningful when the consumer is enabled — a backlog while gated off is
  // expected, not a stall.
  if (obs.dispatchConsumerEnabled && obs.oldestQueuedDispatchAgeMs != null) {
    const age = obs.oldestQueuedDispatchAgeMs;
    if (age >= DISPATCH_STALLED_MS) {
      signals.push(
        `Dispatch consumer is stuck: ${obs.dispatchBacklog} queued, oldest waiting ${hours(age)}h (≥6h).`,
      );
      worsen("stalled");
    } else if (age >= DISPATCH_DEGRADED_MS) {
      signals.push(
        `Dispatch consumer is slow: ${obs.dispatchBacklog} queued, oldest waiting ${hours(age)}h.`,
      );
      worsen("degraded");
    }
  }

  const severity: StallSeverity = rank === 2 ? "stalled" : rank === 1 ? "degraded" : "healthy";
  const shouldPageFounder = severity === "stalled";
  const summary =
    severity === "healthy"
      ? "Autopilot loop is healthy — ticking and draining normally."
      : severity === "degraded"
        ? `Autopilot loop is degraded: ${signals.join(" ")}`
        : `Autopilot loop has STALLED: ${signals.join(" ")}`;

  return { severity, signals, shouldPageFounder, summary };
}

function hours(ms: number): string {
  return (ms / (60 * 60 * 1000)).toFixed(1);
}

/** Injectable sources for observeLoopHealth — real implementations by default. */
export interface LoopHealthDeps {
  now: () => number;
  getLatestPulseAt: () => Promise<number | null>;
  getQueuedDispatches: () => Promise<Array<{ queuedAtMs: number }>>;
  dispatchConsumerEnabled: boolean;
}

/**
 * Gather live observations and classify. Never throws — a failure to read a
 * source degrades to the safe "unknown" default for that signal rather than
 * crashing the watchdog (a watchdog that crashes is no watchdog).
 */
export async function observeLoopHealth(deps?: Partial<LoopHealthDeps>): Promise<StallVerdict> {
  const now = deps?.now?.() ?? Date.now();

  let lastPulseAt: number | null = null;
  try {
    lastPulseAt = deps?.getLatestPulseAt
      ? await deps.getLatestPulseAt()
      : await defaultGetLatestPulseAt();
  } catch (err) {
    logger.warn("[loopStall] failed to read latest pulse", err instanceof Error ? err : undefined);
  }

  let queued: Array<{ queuedAtMs: number }> = [];
  try {
    queued = deps?.getQueuedDispatches
      ? await deps.getQueuedDispatches()
      : await defaultGetQueuedDispatches();
  } catch (err) {
    logger.warn("[loopStall] failed to read dispatch queue", err instanceof Error ? err : undefined);
  }

  const oldestQueuedDispatchAgeMs =
    queued.length > 0 ? now - Math.min(...queued.map((q) => q.queuedAtMs)) : null;

  const dispatchConsumerEnabled =
    deps?.dispatchConsumerEnabled ?? process.env.SOLENE_DISPATCH_ENABLED === "true";

  return detectLoopStall({
    now,
    lastPulseAt,
    dispatchBacklog: queued.length,
    oldestQueuedDispatchAgeMs,
    dispatchConsumerEnabled,
  });
}

async function defaultGetLatestPulseAt(): Promise<number | null> {
  const { getLatestMorningPulse } = await import("../solene/continuousLoop");
  const pulse = await getLatestMorningPulse();
  return pulse ? pulse.generatedAt.getTime() : null;
}

async function defaultGetQueuedDispatches(): Promise<Array<{ queuedAtMs: number }>> {
  const { listDispatches } = await import("../solene/dispatchQueue");
  const rows = await listDispatches({ status: "queued", limit: 200 });
  return rows.map((r) => ({ queuedAtMs: r.queue.queuedAt.getTime() }));
}
