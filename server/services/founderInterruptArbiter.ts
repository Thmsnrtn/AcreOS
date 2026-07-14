/**
 * Founder Interrupt Arbiter — Jarvis 2.2 (audit finding G3, founder GO 2026-07-14).
 *
 * ONE ARBITER, A CHOKE POINT. Founder-facing delivery used to be five silos
 * each choosing its own channel with its own severity vocabulary (pager,
 * decisions inbox, notification dispatcher, weekly digest, morning pulse) —
 * with quiet hours stored but never enforced, and the founder-minutes budget
 * a metric, not a gate. The three interrupting silos now route THROUGH this
 * arbiter; the digest and the pulse are batch surfaces — they are deferral
 * TARGETS, not interrupters.
 *
 * TAXONOMY — the constitutional decision classes (sovereign-protocol
 * immutables, objective block, FOUNDER_MINUTES_BUDGET.decisionClasses):
 *
 *   A — reaches the founder promptly (panic/legal/money-ceiling/pricing/
 *       constitutional). The budget NEVER blocks A; quiet hours never hold A.
 *   B — batched-into-the-Letter material that may interrupt only while this
 *       week's founder-decision count is under the constitutional budget.
 *   C — never interrupts. A Class-C arrival at this arbiter is by definition
 *       a DEFECT SIGNAL (the escalation should have been answerable inside
 *       earned autonomy) — suppressed with a structured log, and counted so
 *       Jarvis 2.3 can patch the evidence files.
 *
 * Each silo maps its OWN enum onto A/B/C explicitly at its wrapper — this
 * module never guesses a class from content.
 *
 * BUDGET AS GATE: the numerator is the same counting seam the tick metric
 * and the Letter use (countFounderDecisionsThisWeek in solene/tickMetric.ts:
 * cascade_resolutions.founder_escalated + founder_overrides, trailing 7
 * days), so the gate and the Letter can never disagree. The limit is the
 * CONSTITUTIONAL FOUNDER_MINUTES_BUDGET.classABDecisionsPerWeek — never a
 * local constant.
 *
 * QUIET HOURS ENFORCED: the founder's own stored preference
 * (users.appearance_preferences.notificationQuietHours — the store behind
 * Settings → Notifications → "Quiet hours"; founder rows resolved via
 * getFounderUserIds()). During quiet hours: A breaks through; B defers to
 * the next pulse. No preference row / disabled toggle = no quiet hours —
 * the honest default, logged once per process.
 *
 * FAILURE PHYSICS: this function NEVER throws. Class A fails OPEN — an
 * arbiter error must never block a critical page. Class B/C fail
 * CLOSED-quiet — an error defers (B) or suppresses (C) with a log, never
 * spams. Deferrals are never dropped: they persist as decisions_inbox_items
 * rows (status='deferred') that the existing processDeferredItems() re-opens
 * and the Letter batches — reusing an existing store instead of a new table.
 *
 * AUDIT: every decision emits a structured logger line AND a
 * logActivity(job:"interrupt") row, so "why didn't I hear about X?" is
 * always answerable from system_activity.
 */

import { db } from "../db";
import { inArray } from "drizzle-orm";
import { users } from "@shared/models/auth";
import { decisionsInboxItems } from "@shared/schema";
import { FOUNDER_MINUTES_BUDGET } from "@sovereign/immutables";
import { logger } from "../utils/logger";
import { logActivity } from "./systemActivityLogger";
import { countFounderDecisionsThisWeek } from "./solene/tickMetric";
import { getFounderUserIds } from "./founder";

// ─── Types ──────────────────────────────────────────────────────────────────

export type InterruptClass = "A" | "B" | "C";

export type InterruptSource =
  | "pager"
  | "decisions_inbox"
  | "notification_dispatcher";

export type InterruptOutcome =
  | "deliver"
  | "defer_next_pulse"
  | "defer_to_letter"
  | "suppress";

export interface FounderInterrupt {
  source: InterruptSource;
  /** Constitutional decision class — mapped EXPLICITLY by the silo wrapper. */
  interruptClass: InterruptClass;
  /** The silo channel this would deliver on (e.g. "ntfy_push"). Audit-only. */
  channel: string;
  subject: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface ArbiterDecision {
  outcome: InterruptOutcome;
  interruptClass: InterruptClass;
  reason: string;
  /** null = could not be measured (read failure) — never a fabricated false. */
  quietHoursActive: boolean | null;
  /** null = could not be measured (read failure) — never a fabricated zero. */
  budget: { used: number; limit: number } | null;
  /** For deferrals: when the item should resurface. */
  deferUntil: Date | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Quiet-hours preference stores hours in the founder's LOCAL time with no
 * timezone column (browser-local at enable time). Interpreted in
 * FOUNDER_TIMEZONE, falling back to America/Chicago — the same founder-time
 * default the daily briefing, weekly digest, and quiet_hours_config schema
 * already use.
 */
function founderTimezone(): string {
  return process.env.FOUNDER_TIMEZONE || "America/Chicago";
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Decide what happens to a founder-facing interrupt. NEVER throws.
 *
 * Class A → always "deliver" (fail-open on any internal error).
 * Class B → budget gate, then quiet hours (fail-closed-quiet: defer on error).
 * Class C → always "suppress" (with defect-signal log).
 */
export async function arbitrateFounderInterrupt(
  interrupt: FounderInterrupt,
  now: Date = new Date(),
): Promise<ArbiterDecision> {
  try {
    let decision: ArbiterDecision;
    if (interrupt.interruptClass === "A") {
      decision = await decideClassA(now);
    } else if (interrupt.interruptClass === "C") {
      decision = {
        outcome: "suppress",
        interruptClass: "C",
        reason:
          "class C never interrupts the founder — its arrival at the arbiter is a defect signal (should have been answerable inside earned autonomy; patch the evidence file)",
        quietHoursActive: null,
        budget: null,
        deferUntil: null,
      };
    } else {
      decision = await decideClassB(now);
    }
    await auditDecision(interrupt, decision);
    return decision;
  } catch (err) {
    // Contract: never throw. A fails OPEN; B/C fail CLOSED-quiet.
    const decision = failPolicyDecision(interrupt.interruptClass, now);
    logger.error(
      "[interruptArbiter] internal error — applying fail policy",
      err instanceof Error ? err : undefined,
      {
        metadata: {
          source: interrupt.source,
          interruptClass: interrupt.interruptClass,
          outcome: decision.outcome,
        },
      },
    );
    await auditDecision(interrupt, decision);
    return decision;
  }
}

function failPolicyDecision(interruptClass: InterruptClass, now: Date): ArbiterDecision {
  if (interruptClass === "A") {
    return {
      outcome: "deliver",
      interruptClass,
      reason: "arbiter error — Class A fails OPEN (a critical page must never be blocked by the arbiter)",
      quietHoursActive: null,
      budget: null,
      deferUntil: null,
    };
  }
  if (interruptClass === "B") {
    return {
      outcome: "defer_next_pulse",
      interruptClass,
      reason: "arbiter error — Class B fails CLOSED-quiet (deferred with a logged row, never dropped, never spammed)",
      quietHoursActive: null,
      budget: null,
      deferUntil: new Date(now.getTime() + DAY_MS),
    };
  }
  return {
    outcome: "suppress",
    interruptClass,
    reason: "arbiter error — Class C fails CLOSED-quiet (suppressed with log)",
    quietHoursActive: null,
    budget: null,
    deferUntil: null,
  };
}

// ─── Class A: always delivers; context gathered best-effort for the audit ───

async function decideClassA(now: Date): Promise<ArbiterDecision> {
  let budget: ArbiterDecision["budget"] = null;
  try {
    budget = await readBudgetUsage(now);
  } catch {
    /* audit-only context — A must not depend on any read */
  }
  let quietHoursActive: boolean | null = null;
  try {
    const qh = await readFounderQuietHours();
    quietHoursActive = qh ? quietWindowActive(qh, hourInFounderTz(now)) : false;
  } catch {
    /* audit-only context */
  }

  const notes: string[] = ["class A always delivers immediately"];
  if (budget && budget.used >= budget.limit) {
    notes.push(`delivered OVER the weekly budget (${budget.used}/${budget.limit}) — the budget never blocks A`);
  }
  if (quietHoursActive === true) {
    notes.push("broke through quiet hours — A always does");
  }
  return {
    outcome: "deliver",
    interruptClass: "A",
    reason: notes.join("; "),
    quietHoursActive,
    budget,
    deferUntil: null,
  };
}

// ─── Class B: budget gate, then quiet hours ─────────────────────────────────

async function decideClassB(now: Date): Promise<ArbiterDecision> {
  // Budget gate first — the stronger deferral (batch to the Letter).
  let budget: ArbiterDecision["budget"];
  try {
    budget = await readBudgetUsage(now);
  } catch (err) {
    logger.warn(
      "[interruptArbiter] founder-decision budget unreadable — Class B fails CLOSED-quiet (deferred to next pulse)",
      err instanceof Error ? err : undefined,
    );
    return {
      outcome: "defer_next_pulse",
      interruptClass: "B",
      reason: "weekly founder-decision count unmeasurable (read failure) — failing quiet, deferred to next pulse",
      quietHoursActive: null,
      budget: null,
      deferUntil: new Date(now.getTime() + DAY_MS),
    };
  }

  if (budget.used >= budget.limit) {
    return {
      outcome: "defer_to_letter",
      interruptClass: "B",
      reason: `weekly founder-decision budget consumed (${budget.used}/${budget.limit}) — batched to the Letter, never dropped`,
      quietHoursActive: null,
      budget,
      // The budget window is trailing-7-day; resurface when it has rolled.
      deferUntil: new Date(now.getTime() + WEEK_MS),
    };
  }

  // Quiet hours second — B defers to the next pulse during the window.
  let quietHours: FounderQuietHours | null;
  try {
    quietHours = await readFounderQuietHours();
  } catch (err) {
    logger.warn(
      "[interruptArbiter] founder quiet-hours preference unreadable — Class B fails CLOSED-quiet (deferred to next pulse)",
      err instanceof Error ? err : undefined,
    );
    return {
      outcome: "defer_next_pulse",
      interruptClass: "B",
      reason: "quiet-hours preference unreadable — failing quiet, deferred to next pulse",
      quietHoursActive: null,
      budget,
      deferUntil: new Date(now.getTime() + DAY_MS),
    };
  }

  if (quietHours && quietWindowActive(quietHours, hourInFounderTz(now))) {
    return {
      outcome: "defer_next_pulse",
      interruptClass: "B",
      reason: `founder quiet hours active (${quietHours.startHour}:00–${quietHours.endHour}:00 ${founderTimezone()}) — deferred to next pulse`,
      quietHoursActive: true,
      budget,
      deferUntil: quietWindowEnd(quietHours, now),
    };
  }

  return {
    outcome: "deliver",
    interruptClass: "B",
    reason: `class B within the weekly budget (${budget.used}/${budget.limit}), outside quiet hours`,
    quietHoursActive: false,
    budget,
    deferUntil: null,
  };
}

async function readBudgetUsage(now: Date): Promise<{ used: number; limit: number }> {
  const used = await countFounderDecisionsThisWeek(now);
  return { used, limit: FOUNDER_MINUTES_BUDGET.classABDecisionsPerWeek };
}

// ─── Quiet hours ────────────────────────────────────────────────────────────

interface FounderQuietHours {
  enabled: boolean;
  startHour: number;
  endHour: number;
}

let loggedNoQuietHoursPreference = false;

/**
 * Read the founder's quiet-hours preference. The founder's own row is keyed
 * the same way every founder path keys it: getFounderUserIds() (env
 * FOUNDER_USER_IDS + FOUNDER_EMAIL/FOUNDER_EMAILS email lookup) → users.id →
 * users.appearance_preferences.notificationQuietHours. Returns null when no
 * founder row carries an enabled window — the honest default (no quiet
 * hours), logged once per process. Throws only on a genuine read failure so
 * the Class-B caller can fail CLOSED-quiet instead of fabricating "no quiet
 * hours".
 */
async function readFounderQuietHours(): Promise<FounderQuietHours | null> {
  const founderIds = await getFounderUserIds();
  if (founderIds.length === 0) {
    logNoQuietHoursOnce("no founder user resolvable (FOUNDER_EMAIL/FOUNDER_USER_IDS unset or no matching users row)");
    return null;
  }

  const rows = await db
    .select({ id: users.id, appearancePreferences: users.appearancePreferences })
    .from(users)
    .where(inArray(users.id, founderIds));

  for (const row of rows) {
    const qh = row.appearancePreferences?.notificationQuietHours;
    if (qh?.enabled === true) {
      return {
        enabled: true,
        // The settings UI defaults to 19→8 when enabling; mirror it for a
        // row that stored `enabled` without explicit hours.
        startHour: clampHour(qh.startHour, 19),
        endHour: clampHour(qh.endHour, 8),
      };
    }
  }

  logNoQuietHoursOnce("founder has no enabled quiet-hours preference");
  return null;
}

function clampHour(h: number | undefined, fallback: number): number {
  return typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23 ? h : fallback;
}

function logNoQuietHoursOnce(detail: string): void {
  if (loggedNoQuietHoursPreference) return;
  loggedNoQuietHoursPreference = true;
  logger.info(`[interruptArbiter] no quiet hours in effect — ${detail} (honest default: none)`);
}

/** Test seam: reset the log-once latch. */
export function _resetQuietHoursLogLatch(): void {
  loggedNoQuietHoursPreference = false;
}

function hourInFounderTz(now: Date): number {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: founderTimezone(),
      hour: "numeric",
      hour12: false,
    }).format(now);
    const h = parseInt(formatted, 10);
    // Intl renders midnight as "24" in some ICU versions — normalize.
    return Number.isFinite(h) ? h % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

function quietWindowActive(qh: FounderQuietHours, hour: number): boolean {
  if (!qh.enabled) return false;
  if (qh.startHour === qh.endHour) return false; // zero-length window
  return qh.startHour < qh.endHour
    ? hour >= qh.startHour && hour < qh.endHour
    : hour >= qh.startHour || hour < qh.endHour;
}

/**
 * Next moment the quiet window ends: `now` advanced by whole hours until the
 * founder-local hour equals endHour. Keeping `now`'s minutes means the result
 * lands within [endHour:00, endHour:59] — always AT or AFTER the window end,
 * never inside it.
 */
function quietWindowEnd(qh: FounderQuietHours, now: Date): Date {
  const current = hourInFounderTz(now);
  const hoursUntilEnd = (qh.endHour - current + 24) % 24 || 24;
  return new Date(now.getTime() + hoursUntilEnd * HOUR_MS);
}

// ─── Deferral persistence (reuses decisions_inbox_items — no new table) ─────

/**
 * Persist a deferred interrupt so it is NEVER dropped: a decisions_inbox_items
 * row with status='deferred' + deferredUntil. The existing
 * processDeferredItems() re-opens it when the window passes, and the Letter
 * batches deferred/pending decision items — reusing the existing store per
 * the binding design (no migration needed).
 *
 * Callers: the pager and notification-dispatcher wrappers. The decisions-inbox
 * wrapper does NOT call this — its deferral IS the original row inserted with
 * status='deferred'.
 *
 * Never throws. Returns the row id, or null when the outcome is not a
 * deferral or the insert failed (the audit log line is the durable record).
 */
export async function recordDeferredInterrupt(
  interrupt: FounderInterrupt,
  decision: ArbiterDecision,
): Promise<number | null> {
  if (decision.outcome !== "defer_next_pulse" && decision.outcome !== "defer_to_letter") {
    return null;
  }
  try {
    const orgId = interrupt.metadata?.organizationId;
    const [row] = await db
      .insert(decisionsInboxItems)
      .values({
        itemType: "deferred_interrupt",
        riskLevel: "medium",
        urgencyScore: 60,
        sophieAnalysis:
          `Class ${decision.interruptClass} founder interrupt deferred by the interrupt arbiter — ${decision.reason}. ` +
          `Source: ${interrupt.source}; original channel: ${interrupt.channel}.`,
        recommendedAction: (interrupt.body
          ? `${interrupt.subject}\n\n${interrupt.body}`
          : interrupt.subject
        ).slice(0, 4000),
        recommendedActionLabel: "Review deferred interrupt",
        actionPayload: {
          source: interrupt.source,
          channel: interrupt.channel,
          arbiterOutcome: decision.outcome,
        },
        contextBundle: {
          subject: interrupt.subject,
          reason: decision.reason,
          deferUntil: decision.deferUntil?.toISOString() ?? null,
          ...(interrupt.metadata ?? {}),
        },
        organizationId: typeof orgId === "number" ? orgId : null,
        status: "deferred",
        deferredUntil: decision.deferUntil ?? new Date(Date.now() + DAY_MS),
      })
      .returning({ id: decisionsInboxItems.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error(
      "[interruptArbiter] failed to persist deferral row — the audit log line remains the durable record",
      err instanceof Error ? err : undefined,
      { metadata: { source: interrupt.source, subject: interrupt.subject.slice(0, 200) } },
    );
    return null;
  }
}

// ─── Audit ──────────────────────────────────────────────────────────────────

const OUTCOME_ACTION: Record<InterruptOutcome, string> = {
  deliver: "interrupt_delivered",
  defer_next_pulse: "interrupt_deferred_next_pulse",
  defer_to_letter: "interrupt_deferred_to_letter",
  suppress: "interrupt_suppressed",
};

/** Structured logger line + logActivity(job:"interrupt"). Never throws. */
async function auditDecision(
  interrupt: FounderInterrupt,
  decision: ArbiterDecision,
): Promise<void> {
  const summary =
    `Founder interrupt [class ${decision.interruptClass}] from ${interrupt.source} ` +
    `via ${interrupt.channel} → ${decision.outcome}: ${decision.reason}`;
  try {
    logger.info(`[interruptArbiter] ${summary}`, {
      metadata: {
        source: interrupt.source,
        interruptClass: decision.interruptClass,
        channel: interrupt.channel,
        outcome: decision.outcome,
        reason: decision.reason,
        quietHoursActive: decision.quietHoursActive,
        budgetUsed: decision.budget?.used ?? null,
        budgetLimit: decision.budget?.limit ?? null,
        deferUntil: decision.deferUntil?.toISOString() ?? null,
        subject: interrupt.subject.slice(0, 200),
      },
    });
  } catch {
    /* never let audit block the decision */
  }
  try {
    await logActivity({
      job: "interrupt",
      action: OUTCOME_ACTION[decision.outcome],
      summary: summary.slice(0, 1000),
      entityType: "founder_interrupt",
      metadata: {
        source: interrupt.source,
        interruptClass: decision.interruptClass,
        channel: interrupt.channel,
        outcome: decision.outcome,
        reason: decision.reason,
        quietHoursActive: decision.quietHoursActive,
        budgetUsed: decision.budget?.used ?? null,
        budgetLimit: decision.budget?.limit ?? null,
        deferUntil: decision.deferUntil?.toISOString() ?? null,
        subject: interrupt.subject.slice(0, 200),
      },
    });
  } catch {
    /* logActivity never throws by contract; belt-and-braces anyway */
  }
}
