/**
 * Outreach stop-loss — founder decisions 2026-07-28, rulings #4 + #5.
 *
 * Ruling #4: a MONTHLY mail+data spend line; crossing it PAUSES outreach
 * until the founder looks. Resets monthly so a bad month can never compound
 * silently. Ruling #5: the line starts at $500/month (coherent with the
 * constitutional $500 autonomous-spend scale), raisable by the founder
 * anytime from the cost panel. The dollar number is set by the founder,
 * never the machine (money hard-stop).
 *
 * The line lives in founder_settings under OUTREACH_STOPLOSS_MONTHLY_CENTS
 * (same pattern as FINANCIAL_HARD_CAP_CENTS in financialAuthorityGate.ts).
 *
 * The LEDGER (verified, actual provider cost — never credit weights):
 *   - Mail: financial_ledger rows with category IN ('mail','skip_trace') —
 *     the Lob/PostGrid piece costs posted by directMailService / the
 *     postgrid adapter (the sole opex writers for mail spend, Pillar 1.6)
 *     plus skip-trace data pulls.
 *   - Data: provider_lookup_log.cost_cents — the actual per-lookup provider
 *     cost the registry records for paid property-data lookups (0 for free
 *     tiers, cache hits and BYOK-served lookups, so those never count).
 *   NOT included: AI reasoning spend (solene_capital_events / ai_usage) —
 *   the AI-dispatch monthly cap already self-pauses separately.
 *
 * Fail-closed per house precedent (capitalTracker's
 * EnsembleCapReadFailedError): if month-to-date spend can't be read, the
 * status is PAUSED with an honest reason — we refuse to spend blind. A
 * skipped send is fully recoverable (it stays queued); an overspend is not.
 *
 * Founder resume: crossing the line pauses outreach until the founder taps
 * "I've looked — resume this month" in Costs. The acknowledgment is stored
 * in platform_settings scoped to the current month as
 * { monthKey, acknowledgedAtCents }; outreach then runs until MTD spend
 * crosses acknowledgedAtCents + line (another full line of spend) or the
 * month rolls over — pause math:
 *
 *   paused = mtd >= line AND (no ack for this month OR mtd >= ack + line)
 */

import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { financialLedger, providerLookupLog, platformSettings } from "@shared/schema";
import { logger } from "../utils/logger";

// ─── Constants ───────────────────────────────────────────────────────────────

export const OUTREACH_STOPLOSS_SETTING_KEY = "OUTREACH_STOPLOSS_MONTHLY_CENTS";

/** $500/month — the founder's ruling (#5, 2026-07-28). */
export const DEFAULT_OUTREACH_STOPLOSS_MONTHLY_CENTS = 50_000;

/** The exact honest words for the fail-closed posture. */
export const LEDGER_UNREADABLE_REASON =
  "couldn't read the ledger — pausing outreach rather than spending blind";

/** financial_ledger categories that count as outreach mail+data spend. */
export const MAIL_DATA_LEDGER_CATEGORIES = ["mail", "skip_trace"] as const;

const ACK_SETTING_KEY = "outreach.stoploss.ack";
const PAGE_MARKER_SETTING_KEY = "outreach.stoploss.page_marker";

// ─── Pure math ───────────────────────────────────────────────────────────────

export interface StopLossAck {
  monthKey: string; // UTC "YYYY-MM" the ack applies to
  acknowledgedAtCents: number; // MTD spend at the moment the founder looked
}

export interface StopLossInputs {
  lineCents: number;
  /** null = the ledger could not be read (fail closed). */
  mtdSpendCents: number | null;
  ack: StopLossAck | null;
  monthKey: string;
}

export interface StopLossState {
  paused: boolean;
  reason: string;
  /**
   * The spend level at which outreach pauses (line, or ack + line after a
   * founder resume). null when the ledger is unreadable — there is no honest
   * threshold to report, only the refusal.
   */
  effectiveThresholdCents: number | null;
}

/** UTC month key, e.g. "2026-07". */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Normalize a raw line value. A non-finite / non-positive line would either
 * pause everything forever or disable the brake — both dishonest — so any
 * invalid value falls back to the founder's $500 default.
 */
export function normalizeLineCents(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_OUTREACH_STOPLOSS_MONTHLY_CENTS;
  return Math.floor(n);
}

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * The whole pause decision, pure and unit-tested.
 *
 *   paused = mtd >= line AND (no valid ack for this month OR mtd >= ack + line)
 *
 * An ack from a different month is ignored (the line resets monthly). An
 * unreadable ledger (mtd null) is always paused — fail closed.
 */
export function computeStopLossState(inputs: StopLossInputs): StopLossState {
  const line = normalizeLineCents(inputs.lineCents);
  const mtd = inputs.mtdSpendCents;

  if (mtd == null || !Number.isFinite(mtd)) {
    return {
      paused: true,
      reason: LEDGER_UNREADABLE_REASON,
      effectiveThresholdCents: null,
    };
  }

  const ack =
    inputs.ack &&
    inputs.ack.monthKey === inputs.monthKey &&
    Number.isFinite(inputs.ack.acknowledgedAtCents) &&
    inputs.ack.acknowledgedAtCents >= 0
      ? inputs.ack
      : null;

  const threshold = ack ? ack.acknowledgedAtCents + line : line;

  // Below the base line: always running, ack or not.
  if (mtd < line) {
    return {
      paused: false,
      reason: `mail+data spend ${usd(mtd)} this month is under your ${usd(line)} monthly line`,
      effectiveThresholdCents: threshold,
    };
  }

  if (mtd >= threshold) {
    return {
      paused: true,
      reason: ack
        ? `mail+data spend ${usd(mtd)} this month crossed ${usd(threshold)} — another full ${usd(line)} past your last "I've looked" — paused until you look again`
        : `mail+data spend ${usd(mtd)} this month crossed your ${usd(line)} monthly line — paused until you look`,
      effectiveThresholdCents: threshold,
    };
  }

  // Over the line but resumed by the founder, and not yet a full line past
  // the acknowledgment.
  return {
    paused: false,
    reason: `running on your "I've looked" from this month (at ${usd(ack!.acknowledgedAtCents)}) — pauses again at ${usd(threshold)}`,
    effectiveThresholdCents: threshold,
  };
}

// ─── Ledger read (MTD mail+data spend, actual cents) ─────────────────────────

export interface MailDataSpendBreakdown {
  mailCents: number;
  dataCents: number;
  totalCents: number;
}

function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * Month-to-date mail+data spend in cents from the verified ledgers. THROWS
 * on any read/shape failure — the caller treats that as "unreadable" and
 * fails closed. Never fabricates a zero for a failed read.
 */
export async function readMonthToDateMailDataSpendCents(
  now: Date = new Date(),
): Promise<MailDataSpendBreakdown> {
  const start = monthStartUtc(now);

  // Mail (+ skip-trace) — opex debits are negative amount_cents.
  const [ledgerRow] = await db
    .select({
      sum: sql<string>`COALESCE(SUM(-${financialLedger.amountCents}), 0)`,
    })
    .from(financialLedger)
    .where(
      and(
        inArray(financialLedger.category, [...MAIL_DATA_LEDGER_CATEGORIES]),
        lt(financialLedger.amountCents, 0),
        gte(financialLedger.postedAt, start),
      ),
    );

  // Property-data lookups — actual provider cost cents; cached rows record
  // avoided cost separately and cost 0, but exclude them explicitly anyway.
  const [lookupRow] = await db
    .select({
      sum: sql<string>`COALESCE(SUM(${providerLookupLog.costCents}), 0)`,
    })
    .from(providerLookupLog)
    .where(
      and(
        eq(providerLookupLog.cached, false),
        gte(providerLookupLog.createdAt, start),
      ),
    );

  const mailCents = Number(ledgerRow?.sum);
  const dataCents = Number(lookupRow?.sum);
  if (!Number.isFinite(mailCents) || !Number.isFinite(dataCents)) {
    throw new Error(
      `non-finite MTD sums (mail=${ledgerRow?.sum}, data=${lookupRow?.sum})`,
    );
  }
  return { mailCents, dataCents, totalCents: mailCents + dataCents };
}

// ─── platform_settings helpers (global scope) ────────────────────────────────

async function readGlobalSettingValue<T>(key: string): Promise<T | null> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.key, key),
        eq(platformSettings.scope, "global"),
        isNull(platformSettings.scopeRef),
      ),
    )
    .limit(1);
  return (row?.value as T) ?? null;
}

async function writeGlobalSettingValue(
  key: string,
  value: unknown,
  changedBy: string,
  description: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: platformSettings.id })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.key, key),
        eq(platformSettings.scope, "global"),
        isNull(platformSettings.scopeRef),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .update(platformSettings)
      .set({ value, lastChangedBy: changedBy, lastChangedAt: new Date() })
      .where(eq(platformSettings.id, existing.id));
  } else {
    await db.insert(platformSettings).values({
      key,
      scope: "global",
      scopeRef: null,
      value,
      // defaultValue is NOT NULL on platform_settings; for these state
      // markers the first-written value doubles as the recorded default.
      defaultValue: value,
      category: "safety",
      description,
      lastChangedBy: changedBy,
      lastChangedAt: new Date(),
    });
  }
}

// ─── Status ──────────────────────────────────────────────────────────────────

export interface OutreachStopLossStatus {
  lineCents: number;
  /** null = ledger unreadable (and therefore paused). */
  mtdSpendCents: number | null;
  mailCents: number | null;
  dataCents: number | null;
  paused: boolean;
  reason: string;
  monthKey: string;
  /** The founder's "I've looked" for THIS month, if any. */
  acknowledgedAtCents: number | null;
  effectiveThresholdCents: number | null;
}

async function readLineCents(): Promise<number> {
  try {
    const { getNumberSetting } = await import("./founderSettings");
    return normalizeLineCents(
      await getNumberSetting(
        OUTREACH_STOPLOSS_SETTING_KEY,
        DEFAULT_OUTREACH_STOPLOSS_MONTHLY_CENTS,
      ),
    );
  } catch {
    return DEFAULT_OUTREACH_STOPLOSS_MONTHLY_CENTS;
  }
}

/**
 * The live stop-loss status. Never throws — every failure mode collapses to
 * an honest fail-closed state (unreadable ledger → paused with the exact
 * refusal reason; unreadable ack → treated as no ack, which can only pause
 * MORE, never less).
 */
export async function getOutreachStopLossStatus(): Promise<OutreachStopLossStatus> {
  const monthKey = currentMonthKey();
  const lineCents = await readLineCents();

  let breakdown: MailDataSpendBreakdown | null = null;
  try {
    breakdown = await readMonthToDateMailDataSpendCents();
  } catch (err) {
    logger.error(
      "[outreachStopLoss] MTD mail+data spend unreadable — failing CLOSED (outreach paused)",
      err instanceof Error ? err : undefined,
    );
  }

  let ack: StopLossAck | null = null;
  try {
    const raw = await readGlobalSettingValue<StopLossAck>(ACK_SETTING_KEY);
    if (raw && typeof raw === "object") ack = raw;
  } catch (err) {
    // No ack = paused sooner, never later — safe direction to fail.
    logger.warn(
      "[outreachStopLoss] ack read failed; treating as no acknowledgment",
      err instanceof Error ? err : undefined,
    );
  }

  const state = computeStopLossState({
    lineCents,
    mtdSpendCents: breakdown ? breakdown.totalCents : null,
    ack,
    monthKey,
  });

  return {
    lineCents,
    mtdSpendCents: breakdown ? breakdown.totalCents : null,
    mailCents: breakdown ? breakdown.mailCents : null,
    dataCents: breakdown ? breakdown.dataCents : null,
    paused: state.paused,
    reason: state.reason,
    monthKey,
    acknowledgedAtCents: ack && ack.monthKey === monthKey ? ack.acknowledgedAtCents : null,
    effectiveThresholdCents: state.effectiveThresholdCents,
  };
}

// ─── Founder resume ("I've looked") ──────────────────────────────────────────

export interface AcknowledgeResult {
  ok: boolean;
  message: string;
  status: OutreachStopLossStatus;
}

/**
 * The founder's "I've looked — resume this month". Records
 * { monthKey, acknowledgedAtCents: current MTD } so outreach runs until
 * spend crosses another full line, or the month rolls over.
 *
 * REFUSES while the ledger is unreadable — an ack needs a real number to
 * anchor to; resuming blind would be exactly the overspend the ruling
 * exists to prevent.
 */
export async function acknowledgeOutreachStopLoss(
  founderId: string,
): Promise<AcknowledgeResult> {
  const before = await getOutreachStopLossStatus();

  if (before.mtdSpendCents == null) {
    return {
      ok: false,
      message:
        "Can't resume: the mail+data spend ledger is unreadable right now, so resuming would mean spending blind. Outreach stays paused until the ledger read recovers.",
      status: before,
    };
  }

  if (!before.paused) {
    return { ok: true, message: "Outreach is already running.", status: before };
  }

  const ack: StopLossAck = {
    monthKey: before.monthKey,
    acknowledgedAtCents: before.mtdSpendCents,
  };
  await writeGlobalSettingValue(
    ACK_SETTING_KEY,
    ack,
    `founder:${founderId}`,
    "Outreach stop-loss founder acknowledgment ({ monthKey, acknowledgedAtCents }) — 'I've looked — resume this month'. Ruling #4, 2026-07-28.",
  );

  logger.info("[outreachStopLoss] founder acknowledged — outreach resumed", {
    metadata: {
      founderId,
      monthKey: ack.monthKey,
      acknowledgedAtCents: ack.acknowledgedAtCents,
      lineCents: before.lineCents,
    },
  });

  const status = await getOutreachStopLossStatus();
  return {
    ok: true,
    message: `Resumed. Outreach pauses again if mail+data spend crosses ${usd(
      ack.acknowledgedAtCents + before.lineCents,
    )} this month.`,
    status,
  };
}

// ─── Pause-event page (once per pause event, marker-guarded) ─────────────────

interface PageMarker {
  monthKey: string;
  /** -1 = the ledger-unreadable pause (no numeric threshold exists). */
  thresholdCents: number;
}

/**
 * Page the founder (urgent, Class A — money) ONCE per pause event. A pause
 * event is identified by (monthKey, effectiveThreshold): the initial line
 * crossing, each re-crossing after an ack, and the unreadable-ledger state
 * each get exactly one page. Marker lives in platform_settings. Best-effort:
 * paging must never affect the refusal itself. If the marker can't be READ
 * we page anyway — a duplicate page beats a silent pause.
 */
export async function notifyOutreachPausedOnce(
  status: OutreachStopLossStatus,
): Promise<void> {
  if (!status.paused) return;
  const marker: PageMarker = {
    monthKey: status.monthKey,
    thresholdCents: status.effectiveThresholdCents ?? -1,
  };

  try {
    let alreadyPaged = false;
    try {
      const prev = await readGlobalSettingValue<PageMarker>(PAGE_MARKER_SETTING_KEY);
      alreadyPaged =
        !!prev &&
        prev.monthKey === marker.monthKey &&
        prev.thresholdCents === marker.thresholdCents;
    } catch {
      // Marker unreadable → page anyway (duplicate beats silence).
    }
    if (alreadyPaged) return;

    const body =
      status.mtdSpendCents == null
        ? "Outreach paused: couldn't read the mail+data spend ledger — pausing outreach rather than spending blind. Nothing sends until the ledger read recovers."
        : `Outreach paused: mail+data spend hit your ${usd(
            status.effectiveThresholdCents ?? status.lineCents,
          )} monthly line. Nothing sends until you tap resume in Costs.`;

    const { sendSolenePage } = await import("./solene/pagerService");
    await sendSolenePage({
      severity: "urgent",
      subject: "Outreach paused — spend line",
      body,
      interruptClass: "A", // money — must reach the founder
    });

    await writeGlobalSettingValue(
      PAGE_MARKER_SETTING_KEY,
      marker,
      "system:outreachStopLoss",
      "Outreach stop-loss pause-page marker ({ monthKey, thresholdCents }) — guards the one-page-per-pause-event guarantee.",
    ).catch((err) =>
      logger.warn(
        "[outreachStopLoss] page marker write failed (page already sent)",
        err instanceof Error ? err : undefined,
      ),
    );
  } catch (err) {
    logger.warn(
      "[outreachStopLoss] pause page failed (pause still enforced)",
      err instanceof Error ? err : undefined,
    );
  }
}

// ─── Dispatch gate ───────────────────────────────────────────────────────────

export class OutreachPausedError extends Error {
  readonly code = "OUTREACH_STOPLOSS_PAUSED" as const;
  constructor(public readonly status: OutreachStopLossStatus) {
    super(
      `Outreach paused by the monthly mail+data stop-loss: ${status.reason}. ` +
        `Nothing was sent; the item stays queued. Resume from the Costs panel.`,
    );
    this.name = "OutreachPausedError";
  }
}

/**
 * Chokepoint gate for outbound-mail dispatch paths. When the stop-loss is
 * paused it logs one structured line, pages the founder (once per pause
 * event) and THROWS OutreachPausedError so the caller skips the send —
 * leaving the work queued, never dropped, never fabricated as sent.
 */
export async function assertOutreachNotPaused(context: string): Promise<void> {
  const status = await getOutreachStopLossStatus();
  if (!status.paused) return;
  logger.warn("[outreachStopLoss] outreach send skipped — stop-loss paused", {
    metadata: {
      context,
      reason: status.reason,
      lineCents: status.lineCents,
      mtdSpendCents: status.mtdSpendCents,
      monthKey: status.monthKey,
    },
  });
  void notifyOutreachPausedOnce(status);
  throw new OutreachPausedError(status);
}
