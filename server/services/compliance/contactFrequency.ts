/**
 * Contact-frequency caps — the enforcement half of the contact-fatigue detector.
 *
 * WHY THIS FILE EXISTS (2026-07-29 audit finding): the fatigue detector
 * (`services/campaignOverlapDetector.ts`) has always COMPUTED a per-lead
 * `fatigueLevel: "suppress"` verdict and printed it in a report — and nothing
 * anywhere honored it. A lead could be messaged again, and again, past the
 * point the system itself had flagged as too much. The SMS choke point already
 * chains consent → recipient-local quiet hours → DNC; frequency is simply the
 * refusal that was missing from that chain.
 *
 * DESIGN
 *  - `evaluateContactFrequency()` is PURE: timestamps in, verdict out. No DB,
 *    no clock reads (the caller passes `now`). That's what the tests drive.
 *  - `frequencyGateForLead()` is the DB-backed gate called from the send choke
 *    point. It NEVER bypasses an earlier refusal — it is only ever an
 *    ADDITIONAL reason to refuse, evaluated last.
 *  - `recordContactTouch()` is the only writer of the touch ledger, called
 *    AFTER a send actually succeeds. A refused/skipped send never records a
 *    touch, and is never recorded as sent.
 *
 * THE TOUCH LEDGER
 * `lead_activities` rows whose `type` is one of TOUCH_ACTIVITY_TYPES. That
 * table already carried `communication_email` / `communication_sms` rows
 * written by `services/communications.ts`, so this reuses an existing,
 * org-scoped, per-lead, append-only record rather than inventing a table.
 * Consequence worth stating plainly: a send path that does not call
 * `recordContactTouch()` is INVISIBLE to the cap. The count is therefore a
 * floor — it can undercount (a channel not yet wired), never overcount. It is
 * never estimated or extrapolated.
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { leadActivities, organizations } from "@shared/schema";
import { logger } from "../../utils/logger";

// ─── Channels + ledger types ──────────────────────────────────────────────────

export type ContactChannel = "sms" | "email" | "direct_mail" | "phone";

/**
 * Activity types that represent a REAL outbound touch that reached a provider.
 * `communication_${channel}` is the convention `communications.ts` already
 * wrote, so historical rows count without a backfill.
 */
export const TOUCH_ACTIVITY_TYPES: readonly string[] = [
  "communication_sms",
  "communication_email",
  "communication_direct_mail",
  "communication_phone",
];

export function touchActivityType(channel: ContactChannel): string {
  return `communication_${channel}`;
}

// ─── Windows + caps ───────────────────────────────────────────────────────────

export type FrequencyWindowKey = "24h" | "7d" | "30d" | "90d";

export interface FrequencyWindow {
  key: FrequencyWindowKey;
  ms: number;
  label: string;
  /** Env var that overrides this window's cap globally. */
  envVar: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const FREQUENCY_WINDOWS: readonly FrequencyWindow[] = [
  { key: "24h", ms: DAY_MS, label: "24 hours", envVar: "CONTACT_FREQUENCY_CAP_24H" },
  { key: "7d", ms: 7 * DAY_MS, label: "7 days", envVar: "CONTACT_FREQUENCY_CAP_7D" },
  { key: "30d", ms: 30 * DAY_MS, label: "30 days", envVar: "CONTACT_FREQUENCY_CAP_30D" },
  { key: "90d", ms: 90 * DAY_MS, label: "90 days", envVar: "CONTACT_FREQUENCY_CAP_90D" },
];

/** Longest window we ever need history for — bounds the ledger read. */
export const MAX_FREQUENCY_WINDOW_MS = 90 * DAY_MS;

/**
 * The fatigue detector's own thresholds, hoisted here so the REPORT and the
 * ENFORCEMENT can never drift apart. `suppress` at 7 touches / 90 days is the
 * number the detector has always printed; the 90d cap below is exactly it.
 */
export const FATIGUE_WATCH_TOUCHES_90D = 4;
export const FATIGUE_SUPPRESS_TOUCHES_90D = 7;

export type FrequencyCaps = Record<FrequencyWindowKey, number>;

/**
 * Conservative defaults. Reasoning, because "defensible" means someone can
 * argue with the number:
 *
 *  • 1 per rolling 24h — no cold outreach cadence in this business needs two
 *    messages to the same human in one day. Two-in-a-day is what a person
 *    reads as harassment and what carriers score as spam. If an operator
 *    wants a same-day follow-up they can raise it deliberately (org setting);
 *    the default should not make that mistake for them.
 *  • 3 per rolling 7 days — one touch every ~2 days is already an aggressive
 *    land-acquisition cadence. This is the cap the operator will actually
 *    feel, and it is the one the example skip reason speaks to.
 *  • 6 per rolling 30 days — keeps a month from becoming six touches in week
 *    one plus silence; combined with the 7d cap it enforces spacing, not just
 *    a total.
 *  • 7 per rolling 90 days — NOT a new opinion. It is the detector's own
 *    `touchCount >= 7 → suppress` threshold, now enforced instead of merely
 *    printed. This is the cap that closes the audit finding.
 *
 * These are NOT statutory numbers — the TCPA fixes quiet hours and consent,
 * not frequency — so they are stated as product policy, tunable per org, and
 * deliberately set at the tight end. Over-refusing costs a delayed message;
 * under-refusing costs the opt-out (and the lead) permanently.
 */
export const DEFAULT_FREQUENCY_CAPS: FrequencyCaps = {
  "24h": 1,
  "7d": 3,
  "30d": 6,
  "90d": FATIGUE_SUPPRESS_TOUCHES_90D,
};

// ─── Pure policy ──────────────────────────────────────────────────────────────

export interface FrequencyDecision {
  allowed: boolean;
  /** Operator-readable, e.g. "contacted 4× in the last 7 days (cap 3)". */
  reason?: string;
  /** Which window tripped, when refused. */
  window?: FrequencyWindowKey;
  counts: Record<FrequencyWindowKey, number>;
  caps: FrequencyCaps;
  /**
   * Earliest moment the send could pass, computed from when the oldest
   * in-window touches age out. Absent when allowed. This is a real
   * computation over real timestamps — never a guess.
   */
  nextEligibleAt?: Date;
}

function toMillis(t: Date | string | number): number {
  if (t instanceof Date) return t.getTime();
  if (typeof t === "number") return t;
  return new Date(t).getTime();
}

/**
 * Pure frequency verdict over a lead's prior-touch timestamps.
 *
 * `touchTimes` are the timestamps of touches ALREADY delivered (the send being
 * evaluated is not among them). A window is violated when the in-window count
 * is at or above its cap, because allowing this send would push it past.
 */
export function evaluateContactFrequency(
  touchTimes: Array<Date | string | number>,
  caps: FrequencyCaps = DEFAULT_FREQUENCY_CAPS,
  now: Date = new Date(),
): FrequencyDecision {
  const nowMs = now.getTime();
  const times = touchTimes
    .map(toMillis)
    .filter((ms) => Number.isFinite(ms) && ms <= nowMs)
    .sort((a, b) => a - b); // ascending (oldest first)

  const counts = {} as Record<FrequencyWindowKey, number>;
  let violated: FrequencyWindow | undefined;
  let violatedCount = 0;
  let nextEligibleMs = 0;

  for (const win of FREQUENCY_WINDOWS) {
    const cutoff = nowMs - win.ms;
    const inWindow = times.filter((ms) => ms > cutoff);
    counts[win.key] = inWindow.length;

    const cap = caps[win.key];
    if (!Number.isFinite(cap) || cap < 0) continue;
    if (inWindow.length < cap) continue;

    // This window refuses. Report the TIGHTEST violated window (windows are
    // ordered shortest-first) but compute next-eligible across all of them.
    if (!violated) {
      violated = win;
      violatedCount = inWindow.length;
    }
    if (cap === 0) {
      // Cap of zero = this org never wants this lead contacted on this
      // cadence. There is no future time that clears it.
      nextEligibleMs = Number.POSITIVE_INFINITY;
      continue;
    }
    // Enough of the oldest in-window touches must age out to leave cap-1.
    // The (length - cap + 1)-th oldest is the last one that must expire.
    const idx = inWindow.length - cap;
    const clearsAt = inWindow[idx] + win.ms;
    if (clearsAt > nextEligibleMs) nextEligibleMs = clearsAt;
  }

  if (!violated) {
    return { allowed: true, counts, caps };
  }

  const cap = caps[violated.key];
  return {
    allowed: false,
    window: violated.key,
    counts,
    caps,
    reason: `contacted ${violatedCount}× in the last ${violated.label} (cap ${cap})`,
    nextEligibleAt: Number.isFinite(nextEligibleMs) ? new Date(nextEligibleMs) : undefined,
  };
}

/** Single honest sentence for logs, API errors, and operator surfaces. */
export function describeFrequencySkip(decision: FrequencyDecision): string {
  if (decision.allowed) return "within contact-frequency caps";
  const base = `contact-frequency cap: ${decision.reason ?? "over cap"}`;
  return decision.nextEligibleAt
    ? `${base} — next eligible ${decision.nextEligibleAt.toISOString()}`
    : base;
}

/** Maps a real touch count to the detector's published fatigue level. */
export function fatigueLevelForTouchCount(
  touchCount: number,
): "ok" | "watch" | "suppress" {
  if (touchCount >= FATIGUE_SUPPRESS_TOUCHES_90D) return "suppress";
  if (touchCount >= FATIGUE_WATCH_TOUCHES_90D) return "watch";
  return "ok";
}

// ─── Cap resolution (env + existing org settings seam) ────────────────────────

function parseCapOverride(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/** Env-level (deployment-wide) overrides. */
export function capsFromEnv(env: NodeJS.ProcessEnv = process.env): FrequencyCaps {
  const caps: FrequencyCaps = { ...DEFAULT_FREQUENCY_CAPS };
  for (const win of FREQUENCY_WINDOWS) {
    const override = parseCapOverride(env[win.envVar]);
    if (override !== null) caps[win.key] = override;
  }
  return caps;
}

/**
 * Org-level override read from the EXISTING `organizations.settings` jsonb
 * seam (`settings.contactFrequencyCaps`) — no new settings surface is built
 * here, per the standing no-new-doors rule. Unknown/invalid values are ignored
 * (and logged) rather than silently widening a cap.
 */
export function applyOrgCapOverrides(
  base: FrequencyCaps,
  settings: unknown,
  organizationId?: number,
): FrequencyCaps {
  const raw = (settings as { contactFrequencyCaps?: unknown } | null | undefined)
    ?.contactFrequencyCaps;
  if (!raw || typeof raw !== "object") return base;
  // `settings` is an untyped jsonb blob, so the shape is only known here.
  // Narrow ONCE to a precise index signature rather than `as any`: every
  // read below stays type-checked, and a cap override is a compliance
  // number — an untyped hop is exactly where a silently-widened cap hides.
  const rawCaps = raw as Record<string, unknown>;
  const caps: FrequencyCaps = { ...base };
  for (const win of FREQUENCY_WINDOWS) {
    if (!(win.key in rawCaps)) continue;
    const override = parseCapOverride(rawCaps[win.key]);
    if (override === null) {
      logger.warn("[contactFrequency] ignoring invalid org cap override", {
        metadata: { organizationId, window: win.key, value: String(rawCaps[win.key]) },
      });
      continue;
    }
    caps[win.key] = override;
  }
  return caps;
}

export async function resolveFrequencyCaps(organizationId: number): Promise<FrequencyCaps> {
  const base = capsFromEnv();
  try {
    const rows = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return applyOrgCapOverrides(base, rows[0]?.settings, organizationId);
  } catch (err) {
    // Settings unreadable → conservative defaults. Never a bypass.
    logger.warn("[contactFrequency] could not read org cap overrides — using defaults", {
      metadata: { organizationId, error: err instanceof Error ? err.message : String(err) },
    });
    return base;
  }
}

// ─── Touch ledger reads ───────────────────────────────────────────────────────

/** Prior-touch timestamps for one lead, bounded to the longest window. */
export async function getTouchTimestamps(
  organizationId: number,
  leadId: number,
  now: Date = new Date(),
): Promise<Date[]> {
  const since = new Date(now.getTime() - MAX_FREQUENCY_WINDOW_MS);
  const rows = await db
    .select({ createdAt: leadActivities.createdAt })
    .from(leadActivities)
    .where(
      and(
        eq(leadActivities.organizationId, organizationId),
        eq(leadActivities.leadId, leadId),
        inArray(leadActivities.type, TOUCH_ACTIVITY_TYPES as string[]),
        gte(leadActivities.createdAt, since),
      ),
    )
    .orderBy(desc(leadActivities.createdAt));
  // drizzle types timestamp columns as Date, but the value that comes back is
  // driver-dependent (node-postgres parses to Date; some pool/proxy configs
  // hand back the raw ISO string). Narrow to the precise union rather than
  // `as any` — these timestamps decide whether a contact is suppressed, and an
  // untyped hop is where a silently-dropped touch hides.
  return rows
    .map((r) => {
      const ts = r.createdAt as unknown as Date | string | null;
      return ts instanceof Date ? ts : new Date(ts ?? NaN);
    })
    .filter((d) => !Number.isNaN(d.getTime()));
}

/**
 * Real 90-day touch counts for every lead in the org, keyed by lead id.
 * Used by the fatigue REPORT so what it prints is what the gate enforces.
 */
export async function countTouchesByLead(
  organizationId: number,
  windowMs: number = MAX_FREQUENCY_WINDOW_MS,
  now: Date = new Date(),
): Promise<Map<number, number>> {
  const since = new Date(now.getTime() - windowMs);
  const rows = await db
    .select({ leadId: leadActivities.leadId, n: sql<number>`count(*)::int` })
    .from(leadActivities)
    .where(
      and(
        eq(leadActivities.organizationId, organizationId),
        inArray(leadActivities.type, TOUCH_ACTIVITY_TYPES as string[]),
        gte(leadActivities.createdAt, since),
      ),
    )
    .groupBy(leadActivities.leadId);
  const out = new Map<number, number>();
  for (const r of rows) out.set(Number(r.leadId), Number(r.n) || 0);
  return out;
}

// ─── The gate ─────────────────────────────────────────────────────────────────

/**
 * Frequency gate for a lead-matched send. Call it LAST, after consent, quiet
 * hours and DNC — it is an additional refusal, never a bypass of theirs.
 *
 * Failure posture: FAIL CLOSED for the same reason `tcpaGateForRecipient` does
 * on unverifiable consent. This gate only runs for lead-matched (marketing)
 * traffic; transactional/customer sends never reach it, so a DB hiccup delays
 * marketing rather than breaking billing mail.
 */
export async function frequencyGateForLead(
  organizationId: number,
  leadId: number,
  now: Date = new Date(),
): Promise<FrequencyDecision> {
  try {
    const [caps, times] = await Promise.all([
      resolveFrequencyCaps(organizationId),
      getTouchTimestamps(organizationId, leadId, now),
    ]);
    const decision = evaluateContactFrequency(times, caps, now);
    if (!decision.allowed) {
      logger.warn("[contactFrequency] send refused by frequency cap", {
        metadata: {
          organizationId,
          leadId,
          window: decision.window,
          counts: decision.counts,
          caps: decision.caps,
          reason: decision.reason,
          nextEligibleAt: decision.nextEligibleAt?.toISOString(),
        },
      });
    }
    return decision;
  } catch (err) {
    logger.error(
      "[contactFrequency] contact history unverifiable — refusing send (fail closed)",
      err instanceof Error ? err : undefined,
      { metadata: { organizationId, leadId } },
    );
    return {
      allowed: false,
      reason: "contact history unverifiable — refusing to send (fail closed)",
      counts: { "24h": 0, "7d": 0, "30d": 0, "90d": 0 },
      caps: DEFAULT_FREQUENCY_CAPS,
    };
  }
}

// ─── Touch ledger write ───────────────────────────────────────────────────────

export interface RecordTouchInput {
  organizationId: number;
  leadId: number;
  channel: ContactChannel;
  /** Provider message id, when the channel returned one. */
  messageId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Record ONE real, completed outbound touch. Call only after the send
 * genuinely succeeded — this row is what the cap counts, and a skipped or
 * refused send must never produce one.
 *
 * Best-effort: a ledger write failure is logged, never thrown, because the
 * message already went out and the caller must not be told otherwise.
 */
export async function recordContactTouch(input: RecordTouchInput): Promise<void> {
  try {
    await db.insert(leadActivities).values({
      organizationId: input.organizationId,
      leadId: input.leadId,
      type: touchActivityType(input.channel),
      description: input.description ?? `${input.channel.toUpperCase()} sent`,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
      },
    });
  } catch (err) {
    logger.error(
      "[contactFrequency] failed to record contact touch — frequency caps will undercount this send",
      err instanceof Error ? err : undefined,
      { metadata: { organizationId: input.organizationId, leadId: input.leadId, channel: input.channel } },
    );
  }
}
