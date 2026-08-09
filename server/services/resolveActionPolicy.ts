/**
 * P-1 — "Make autonomy enforcement-true" (master handoff Part 2 §7.2 · Wave 0
 * item 0.4, 2026-08-09).
 *
 * ONE function turns the customer autonomy matrix (users.autonomyPreferences:
 * Observe/Draft/Execute/Autonomous × per-action overrides × $ thresholds ×
 * time guardrails) from a stored preference into policy, consulted at the
 * SINGLE chokepoint where pending_actions are written
 * (approvalKernel.proposePendingAction — the only insert(pendingActions) site
 * in server/, pinned by tests/unit/autonomyEnforcement.test.ts). The autonomy
 * panel reads the SAME function via GET /api/me/autonomy/effective, so the
 * UI's promise and the kernel's behavior cannot diverge.
 *
 * ORG SCOPING (storage is per-user; the promise is org-level)
 * ───────────────────────────────────────────────────────────
 * Same derivation and fail-safe direction as paxPause: the snapshot is the
 * org OWNER's preferences plus every ACTIVE team member's, and the MOST
 * RESTRICTIVE human wins — the effective level for an action is the minimum
 * across users who expressed one, any user's active pause binds, any user's
 * pause window binds, the lowest configured $ ceiling binds, and any user's
 * explicit dailyActionLimit=0 forbids. Users who stored nothing for an agent
 * express no intent and neither grant nor restrict.
 *
 * DEFAULTS ARE LOAD-BEARING
 * ─────────────────────────
 * An org with NO stored matrix resolves to `require_approval` — exactly
 * today's de-facto kernel behavior (every consequential action freezes for a
 * witnessed human tap). Level 0 (Observe) is a HARD ceiling: a per-action
 * override can never raise it, and nothing resolves to `auto_with_receipt`
 * at level 0. A failed policy read FAILS CLOSED to `require_approval`
 * (`checkFailed: true`) — never auto, never silently open, and never
 * `forbid` (forbidding on infrastructure error would break today's witnessed
 * flow, which is not this module's call to make).
 *
 * WHAT IS ENFORCED vs DEFERRED (refuse-not-fabricate: stated, not implied)
 * ────────────────────────────────────────────────────────────────────────
 * Enforced here: level → decision mapping; per-action overrides; $ threshold
 * downgrade (over-ceiling OR money with no ceiling ⇒ require_approval);
 * agent pausedUntil downgrade; timeGuards pause-window downgrade (evaluated
 * in the ORG's IANA timezone, organizations.timezone — the stored hours
 * carry no timezone of their own); dailyActionLimit === 0 ⇒ forbid.
 * Deferred, deliberately: (a) count-based enforcement of dailyActionLimit>0
 * — "how many actions today" needs a counting definition (proposals vs
 * executions) and a day boundary the stored model doesn't specify; inventing
 * one silently would be fabrication. (b) organizations.paxAutonomyLevel
 * ("assisted"/"supervised"/"autonomous") is a LEGACY parallel store consumed
 * only by the defense-in-depth branch inside tools.ts send paths; it never
 * gated the kernel and is NOT consulted here — the matrix is P-1's canonical
 * promise surface. (c) notificationQuietHours (appearance prefs) is a
 * notification-display preference, not agent policy — not consulted.
 *
 * ── WAVE 6.5 SEAM (standing-instruction consent artifacts) ──────────────────
 * `auto_with_receipt` today means "the matrix grants autonomy". Wave 6.5 adds
 * the standing-instruction consent artifact (handoff Part 3 §5.4): resolution
 * will additionally require a LIVE consent artifact before returning
 * `auto_with_receipt`, downgrading to `require_approval` when the instruction
 * is missing/revoked. That lands INSIDE this function — callers and the
 * decision type do not change. Until then no execution lane acts on
 * `auto_with_receipt`: every kernel action still freezes for a human tap
 * (the only executors are the two human-tap endpoints in
 * routes-pax-insights.ts), so stamping the grant turns nothing on.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { organizations, teamMembers } from "@shared/schema";
import { users } from "@shared/models/auth";
import type {
  ActionPolicyDecision,
  AgentAutonomy,
  AutonomyAgent,
  AutonomyPreferences,
} from "@shared/models/auth";
import { logger } from "../utils/logger";

// ── Public shapes ───────────────────────────────────────────────────────────

export interface ResolveActionPolicyInput {
  organizationId: number;
  /**
   * Which matrix agent is acting. Defaults to "pax": every kernel
   * approval-required tool today (send_email/send_sms/send_gmail/
   * send_slack_message/create_stripe_payment_link) is a comms/payment tool
   * in Pax's lane.
   */
  agent?: AutonomyAgent;
  /** Kernel tool name (send_email, …) or matrix action id (replies, …). */
  actionType: string;
  /** Monetary size of the action, when it has one. */
  amountCents?: number | null;
  /** The instant the action would happen. Defaults to now. */
  when?: Date;
}

export interface ResolvedActionPolicy {
  decision: ActionPolicyDecision;
  /** The matrix rule that produced the decision — stamped on the ledger row. */
  reason: string;
  agent: AutonomyAgent;
  actionType: string;
  /** True when the stored policy could not be read and we failed closed. */
  checkFailed?: boolean;
}

/** Thrown by the approval-kernel chokepoint when the resolution is `forbid`. */
export class ActionPolicyForbiddenError extends Error {
  readonly policy: ResolvedActionPolicy;
  constructor(policy: ResolvedActionPolicy) {
    super(
      `This action is not allowed by your autonomy settings: ${policy.reason} ` +
        "Adjust the matrix in Settings → Autonomy to re-enable it.",
    );
    this.name = "ActionPolicyForbiddenError";
    this.policy = policy;
  }
}

// ── Registries ──────────────────────────────────────────────────────────────

/**
 * Matrix action ids per agent — server mirror of the AGENTS registry in
 * client/src/components/settings/autonomy-panel.tsx (keep in sync; the ids
 * are the keys of perAction/thresholdsCents in stored preferences).
 */
export const MATRIX_ACTION_IDS: Record<AutonomyAgent, readonly string[]> = {
  atlas: ["comps", "valuations", "parcels", "market"],
  pax: ["replies", "mailerDraft", "mailerSend", "outreach"],
  sophie: ["servicing", "documents", "paymentFlag"],
};

/**
 * The kernel action types (APPROVAL_REQUIRED_TOOLS — kept literal here to
 * avoid an import cycle with approvalKernel; the enforcement test pins the
 * two sets equal) mapped to the stored matrix's action ids. A kernel tool
 * name is not a panel action id, so overrides/thresholds are looked up under
 * BOTH the raw tool name and every mapped id, and the most restrictive value
 * found binds. send_* tools consult both "replies" and "outreach" because the
 * tool name alone cannot distinguish a reply from first contact — the
 * stricter of the two governs. create_stripe_payment_link has no matrix
 * action id (the panel predates it); it resolves from the agent level, and
 * being money-bearing with no configured ceiling it can never reach
 * `auto_with_receipt` (see the threshold rule).
 */
export const KERNEL_ACTION_MATRIX_IDS: Record<string, readonly string[]> = {
  send_email: ["replies", "outreach"],
  send_gmail: ["replies", "outreach"],
  send_sms: ["replies", "outreach"],
  send_slack_message: ["replies", "outreach"],
  create_stripe_payment_link: [],
};

/**
 * Monetary size of a kernel tool call, from its frozen args. Only
 * create_stripe_payment_link carries an amount today (dollars, per its tool
 * schema) — everything else returns null rather than inventing a size.
 */
export function extractActionAmountCents(
  toolName: string,
  args: Record<string, unknown>,
): number | null {
  if (toolName === "create_stripe_payment_link") {
    const amount = args.amount;
    if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0) {
      return Math.round(amount * 100);
    }
  }
  return null;
}

// ── Snapshot load (org-scoped, paxPause-shaped) ─────────────────────────────

export interface OrgAutonomySnapshot {
  organizationId: number;
  /** IANA timezone from organizations.timezone; null → UTC evaluation. */
  timezone: string | null;
  /** Owner + active team members' stored autonomy preferences. */
  userPrefs: Array<AutonomyPreferences | null>;
}

/**
 * Load the org's autonomy snapshot: organizations.timezone plus the owner's
 * and every active team member's users.autonomyPreferences (identical join
 * shape to paxPause.getPaxPauseState). Throws on read failure — the async
 * resolver catches and fails closed.
 */
export async function loadOrgAutonomySnapshot(organizationId: number): Promise<OrgAutonomySnapshot> {
  const orgRows = await db
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const ownerRows = await db
    .select({ prefs: users.autonomyPreferences })
    .from(users)
    .innerJoin(organizations, eq(organizations.ownerId, users.id))
    .where(eq(organizations.id, organizationId));

  const memberRows = await db
    .select({ prefs: users.autonomyPreferences })
    .from(users)
    .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
    .where(
      and(
        eq(teamMembers.organizationId, organizationId),
        eq(teamMembers.isActive, true),
      ),
    );

  return {
    organizationId,
    timezone: orgRows[0]?.timezone ?? null,
    userPrefs: [...ownerRows, ...memberRows].map(
      (r) => (r.prefs ?? null) as AutonomyPreferences | null,
    ),
  };
}

// ── Pure resolution (unit-testable without a database) ──────────────────────

const LEVEL_LABEL: Record<number, string> = {
  0: "0 Observe",
  1: "1 Draft",
  2: "2 Execute",
  3: "3 Autonomous",
};

function isLevel(v: unknown): v is 0 | 1 | 2 | 3 {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

/** Keys under which this action's overrides/thresholds may be stored. */
function actionKeys(actionType: string): string[] {
  return [actionType, ...(KERNEL_ACTION_MATRIX_IDS[actionType] ?? [])];
}

/**
 * One user's effective level for (agent, action), or null when the user
 * expressed no intent for this agent. Level 0 is a hard ceiling — per-action
 * overrides cannot raise Observe (the P-1 mandate: at level 0, zero auto,
 * full stop). Otherwise the panel's own semantics apply: the override (the
 * minimum across the action's keys that are set) replaces the agent level.
 */
function userEffectiveLevel(
  cfg: AgentAutonomy | undefined,
  keys: string[],
): 0 | 1 | 2 | 3 | null {
  if (!cfg) return null;
  if (cfg.level === 0) return 0;
  const overrides = keys
    .map((k) => cfg.perAction?.[k])
    .filter(isLevel);
  if (overrides.length > 0) return Math.min(...overrides) as 0 | 1 | 2 | 3;
  return isLevel(cfg.level) ? cfg.level : null;
}

/** Lowest configured $ ceiling across users and action keys, or null. */
function minThresholdCents(
  prefs: Array<AutonomyPreferences | null>,
  agent: AutonomyAgent,
  keys: string[],
): number | null {
  let min: number | null = null;
  for (const p of prefs) {
    const thresholds = p?.[agent]?.thresholdsCents;
    if (!thresholds) continue;
    for (const k of keys) {
      const v = thresholds[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        if (min === null || v < min) min = v;
      }
    }
  }
  return min;
}

/** The latest ACTIVE pause for this agent across the org's users, or null. */
function activePauseUntil(
  prefs: Array<AutonomyPreferences | null>,
  agent: AutonomyAgent,
  nowMs: number,
): Date | null {
  let latest: Date | null = null;
  for (const p of prefs) {
    const iso = p?.[agent]?.pausedUntil;
    if (typeof iso !== "string") continue;
    const t = Date.parse(iso);
    if (!Number.isFinite(t) || t <= nowMs) continue;
    if (!latest || t > latest.getTime()) latest = new Date(t);
  }
  return latest;
}

/**
 * Hour-of-day of `when` in the org's IANA timezone. Falls back to UTC when
 * the timezone is unset or invalid — deterministic, and stated rather than
 * guessed (the stored guard hours carry no timezone of their own).
 */
function hourInTimeZone(when: Date, timeZone: string | null): number {
  if (timeZone) {
    try {
      const rendered = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone,
      }).format(when);
      const h = Number.parseInt(rendered, 10);
      // Some ICU builds render midnight as "24" with hour12: false.
      if (Number.isFinite(h)) return h % 24;
    } catch {
      // Invalid IANA name — fall through to UTC.
    }
  }
  return when.getUTCHours();
}

/**
 * Is `hour` inside the [start, end) pause window? A window with start > end
 * wraps midnight (19→8 = 7pm to 8am). start === end is a zero-length window
 * and matches nothing (the panel expresses "no pause" by unsetting both).
 */
function inPauseWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/**
 * Resolve the matrix verdict from an already-loaded snapshot. Pure — the
 * whole decision table is testable without a database. Precedence:
 *
 *   1. forbid   — any user's explicit timeGuards.dailyActionLimit === 0.
 *   2. level    — org-effective level (min across users who expressed one;
 *                 level 0 is a hard ceiling): none→require_approval,
 *                 0→suggest, 1→draft, 2/3→provisionally auto.
 *   3. downgrades on a provisional auto grant, in order:
 *      a. $ threshold — amount over the lowest configured ceiling, or any
 *         amount with NO configured ceiling ⇒ require_approval.
 *      b. pausedUntil — an active pause for this agent ⇒ require_approval
 *         (asking is allowed while paused; acting is not).
 *      c. time guards — inside any user's pause window (org timezone)
 *         ⇒ require_approval.
 *   4. auto_with_receipt — the surviving grant (stamped; nothing executes on
 *      it yet — see the Wave 6.5 seam note in the module header).
 */
export function resolvePolicyFromSnapshot(
  snapshot: OrgAutonomySnapshot,
  input: ResolveActionPolicyInput,
): ResolvedActionPolicy {
  const agent: AutonomyAgent = input.agent ?? "pax";
  const when = input.when ?? new Date();
  const keys = actionKeys(input.actionType);
  const prefs = snapshot.userPrefs;

  const base = { agent, actionType: input.actionType };

  // 1. forbid — an explicit zero daily-action limit disables agent actions
  //    outright (most-restrictive-human-wins, same direction as paxPause).
  for (const p of prefs) {
    if (p?.timeGuards?.dailyActionLimit === 0) {
      return {
        ...base,
        decision: "forbid",
        reason:
          "timeGuards.dailyActionLimit is 0 — agent actions are disabled by the autonomy matrix.",
      };
    }
  }

  // 2. org-effective level.
  const levels = prefs
    .map((p) => userEffectiveLevel(p?.[agent], keys))
    .filter((l): l is 0 | 1 | 2 | 3 => l !== null);

  if (levels.length === 0) {
    return {
      ...base,
      decision: "require_approval",
      reason: `No autonomy grant stored for ${agent} — defaulting to witnessed approval.`,
    };
  }

  const level = Math.min(...levels) as 0 | 1 | 2 | 3;
  const levelRule = `${agent} level ${LEVEL_LABEL[level]} (most restrictive across org users)`;

  if (level === 0) {
    return {
      ...base,
      decision: "suggest",
      reason: `${levelRule} — Observe: suggest only, overrides cannot raise level 0.`,
    };
  }
  if (level === 1) {
    return {
      ...base,
      decision: "draft",
      reason: `${levelRule} — Draft: prepare for human review, never execute.`,
    };
  }

  // Levels 2/3: a provisional auto grant, subject to downgrades.

  // 3a. $ threshold.
  if (typeof input.amountCents === "number") {
    const ceiling = minThresholdCents(prefs, agent, keys);
    if (ceiling === null) {
      return {
        ...base,
        decision: "require_approval",
        reason: `${levelRule}, but this money-bearing action has no configured $ ceiling — witnessed approval required.`,
      };
    }
    if (input.amountCents > ceiling) {
      return {
        ...base,
        decision: "require_approval",
        reason: `${levelRule}, but $${(input.amountCents / 100).toFixed(2)} exceeds the $${(ceiling / 100).toFixed(2)} autonomy ceiling.`,
      };
    }
  }

  // 3b. Active agent pause.
  const pausedUntil = activePauseUntil(prefs, agent, when.getTime());
  if (pausedUntil) {
    return {
      ...base,
      decision: "require_approval",
      reason: `${levelRule}, but ${agent} is paused until ${pausedUntil.toISOString()} — ask, don't act.`,
    };
  }

  // 3c. Time-guard pause window (org timezone; hours are stored zoneless).
  const hour = hourInTimeZone(when, snapshot.timezone);
  for (const p of prefs) {
    const tg = p?.timeGuards;
    if (
      typeof tg?.pauseStartHour === "number" &&
      typeof tg?.pauseEndHour === "number" &&
      inPauseWindow(hour, tg.pauseStartHour, tg.pauseEndHour)
    ) {
      return {
        ...base,
        decision: "require_approval",
        reason: `${levelRule}, but ${String(hour).padStart(2, "0")}:00 is inside the ${tg.pauseStartHour}:00–${tg.pauseEndHour}:00 pause window — witnessed approval required.`,
      };
    }
  }

  // 4. The grant survives. (Stamped only — no execution lane consumes this
  //    yet, and Wave 6.5 adds the consent-artifact requirement here.)
  return {
    ...base,
    decision: "auto_with_receipt",
    reason: `${levelRule} — autonomous grant within threshold and time guardrails.`,
  };
}

// ── The db-backed resolver (what the kernel and routes call) ────────────────

/**
 * Resolve the org's autonomy verdict for one action. FAILS CLOSED: a policy
 * read error resolves to require_approval (today's witnessed behavior),
 * never auto and never silently open.
 */
export async function resolveActionPolicy(
  input: ResolveActionPolicyInput,
): Promise<ResolvedActionPolicy> {
  const agent: AutonomyAgent = input.agent ?? "pax";
  try {
    const snapshot = await loadOrgAutonomySnapshot(input.organizationId);
    return resolvePolicyFromSnapshot(snapshot, { ...input, agent });
  } catch (err) {
    logger.error(
      "[resolveActionPolicy] Policy read failed — failing CLOSED to witnessed approval",
      err as Error,
      { orgId: input.organizationId, metadata: { actionType: input.actionType, agent } },
    );
    return {
      decision: "require_approval",
      reason:
        "Autonomy policy could not be read — failing closed to witnessed approval (never auto).",
      agent,
      actionType: input.actionType,
      checkFailed: true,
    };
  }
}
