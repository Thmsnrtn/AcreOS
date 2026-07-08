/**
 * ledgerDeadLetter.ts — Tier 2B (one money spine): dead-letter + replay for
 * failed financial_ledger postings.
 *
 * The Stripe webhook handlers post into the ledger best-effort — a posting
 * failure must never 5xx the webhook back to Stripe. Before this module, a
 * failed postRevenue was a `logger.warn` and the money silently never reached
 * the system of record (which unitEconomics, contribution margin, and the
 * Stripe reconciliation rule all read). Now:
 *
 *   1. `recordLedgerDeadLetter` — the webhook catch blocks capture the exact
 *      posting args into `ledger_dead_letters`. Upserts on external_event_id
 *      so Stripe redelivery while the failure persists collapses to one row
 *      (with a refreshed last_error).
 *
 *   2. `runLedgerDeadLetterSweep` — the hourly `ledger_dead_letter_replay`
 *      worker job re-dispatches pending rows through the SAME posting
 *      functions. Those are idempotent on external_event_id, so a replay that
 *      races a Stripe redelivery (or a half-applied prior attempt) is safe.
 *      Rows that keep failing past MAX_REPLAY_ATTEMPTS flip to `abandoned`.
 *
 *   3. After each sweep the accumulation check raises through the ONE alert
 *      spine (Tier 1D): warning when pending entries accumulate, critical
 *      when anything is abandoned (money is provably missing from the ledger
 *      and automation has given up — founder intervention required).
 */

import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { ledgerDeadLetters, type LedgerDeadLetterRow } from "@shared/schema";
import {
  postRevenue,
  postRefund,
  postOpexSpent,
  type PostRevenueArgs,
  type PostRefundArgs,
  type PostOpexArgs,
} from "./financial-ledger";
import { logger } from "../utils/logger";

export type LedgerDeadLetterKind = "revenue" | "refund" | "opex";

/** Replay attempts before a row is abandoned (≈ 8 hourly sweeps). */
export const MAX_REPLAY_ATTEMPTS = 8;

/** Pending rows at-or-above this count ⇒ accumulation warning. */
export const PENDING_WARNING_THRESHOLD = 3;

export interface RecordDeadLetterArgs {
  kind: LedgerDeadLetterKind;
  /** The posting's idempotency anchor — also our one-row-per-event dedupe. */
  externalEventId: string;
  organizationId: number | null;
  /** Verbatim args of the failed posting call. */
  payload: PostRevenueArgs | PostRefundArgs | PostOpexArgs;
  error: unknown;
}

/**
 * Capture a failed posting. NEVER throws — this runs inside webhook catch
 * blocks whose whole contract is "the webhook response is already decided".
 *
 * @returns true if a row was written/refreshed, false if even the capture
 *          failed (logged; the original warn-and-continue behavior remains
 *          the floor).
 */
export async function recordLedgerDeadLetter(args: RecordDeadLetterArgs): Promise<boolean> {
  const errorMessage =
    args.error instanceof Error ? args.error.message : String(args.error);
  try {
    await db
      .insert(ledgerDeadLetters)
      .values({
        organizationId: args.organizationId,
        kind: args.kind,
        externalEventId: args.externalEventId,
        payload: args.payload as unknown as Record<string, unknown>,
        lastError: errorMessage,
        status: "pending",
      })
      .onConflictDoUpdate({
        target: ledgerDeadLetters.externalEventId,
        set: {
          lastError: errorMessage,
          updatedAt: new Date(),
        },
      });
    logger.warn("[ledgerDeadLetter] captured failed ledger posting", {
      metadata: {
        kind: args.kind,
        externalEventId: args.externalEventId,
        orgId: args.organizationId,
        error: errorMessage,
      },
    });
    return true;
  } catch (captureErr) {
    logger.error(
      "[ledgerDeadLetter] dead-letter capture itself failed — posting is only in logs",
      captureErr instanceof Error ? captureErr : undefined,
      {
        metadata: {
          kind: args.kind,
          externalEventId: args.externalEventId,
          orgId: args.organizationId,
          originalError: errorMessage,
        },
      },
    );
    return false;
  }
}

// ── Replay ───────────────────────────────────────────────────────────────────

/**
 * Re-hydrate a jsonb payload into posting args. jsonb serializes Date fields
 * to ISO strings; the posting functions accept Date for postedAt, so revive.
 */
function revivePayload(row: LedgerDeadLetterRow): Record<string, unknown> {
  const payload = { ...(row.payload as Record<string, unknown>) };
  if (typeof payload.postedAt === "string") {
    const d = new Date(payload.postedAt);
    payload.postedAt = Number.isNaN(d.getTime()) ? undefined : d;
  }
  return payload;
}

async function replayOne(row: LedgerDeadLetterRow): Promise<void> {
  const payload = revivePayload(row);
  switch (row.kind as LedgerDeadLetterKind) {
    case "revenue":
      await postRevenue(payload as unknown as PostRevenueArgs);
      return;
    case "refund":
      await postRefund(payload as unknown as PostRefundArgs);
      return;
    case "opex":
      await postOpexSpent(payload as unknown as PostOpexArgs);
      return;
    default:
      throw new Error(`unknown dead-letter kind "${row.kind}"`);
  }
}

export interface DeadLetterSweepResult {
  scanned: number;
  replayed: number;
  failed: number;
  abandoned: number;
  pendingAfter: number;
  abandonedTotal: number;
  alertSeverity: "none" | "warning" | "critical";
}

/**
 * One sweep: replay pending rows oldest-first, then run the accumulation
 * check. Called hourly by the `ledger_dead_letter_replay` worker job and by
 * the founder "replay now" affordance.
 */
export async function runLedgerDeadLetterSweep(
  opts: { limit?: number } = {},
): Promise<DeadLetterSweepResult> {
  const limit = opts.limit ?? 100;

  const pending = await db
    .select()
    .from(ledgerDeadLetters)
    .where(eq(ledgerDeadLetters.status, "pending"))
    .orderBy(asc(ledgerDeadLetters.createdAt))
    .limit(limit);

  let replayed = 0;
  let failed = 0;
  let abandoned = 0;

  for (const row of pending) {
    try {
      await replayOne(row);
      await db
        .update(ledgerDeadLetters)
        .set({
          status: "replayed",
          replayedAt: new Date(),
          lastAttemptAt: new Date(),
          attempts: row.attempts + 1,
          updatedAt: new Date(),
        })
        .where(eq(ledgerDeadLetters.id, row.id));
      replayed += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      const exhausted = attempts >= MAX_REPLAY_ATTEMPTS;
      try {
        await db
          .update(ledgerDeadLetters)
          .set({
            status: exhausted ? "abandoned" : "pending",
            attempts,
            lastAttemptAt: new Date(),
            lastError: err instanceof Error ? err.message : String(err),
            updatedAt: new Date(),
          })
          .where(eq(ledgerDeadLetters.id, row.id));
      } catch (updateErr) {
        logger.error(
          "[ledgerDeadLetter] failed to record replay failure",
          updateErr instanceof Error ? updateErr : undefined,
          { metadata: { deadLetterId: row.id } },
        );
      }
      if (exhausted) abandoned += 1;
      else failed += 1;
      logger.warn("[ledgerDeadLetter] replay attempt failed", {
        metadata: {
          deadLetterId: row.id,
          kind: row.kind,
          externalEventId: row.externalEventId,
          attempts,
          abandoned: exhausted,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  // ── Accumulation check (Tier 1D alert spine) ───────────────────────────────
  const [counts] = await db
    .select({
      pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${ledgerDeadLetters.status} = 'pending')::int`,
      abandonedCount: sql<number>`COUNT(*) FILTER (WHERE ${ledgerDeadLetters.status} = 'abandoned')::int`,
    })
    .from(ledgerDeadLetters)
    .where(inArray(ledgerDeadLetters.status, ["pending", "abandoned"]));

  const pendingAfter = counts?.pendingCount ?? 0;
  const abandonedTotal = counts?.abandonedCount ?? 0;

  let alertSeverity: DeadLetterSweepResult["alertSeverity"] = "none";
  if (abandonedTotal > 0) alertSeverity = "critical";
  else if (pendingAfter >= PENDING_WARNING_THRESHOLD) alertSeverity = "warning";

  if (alertSeverity !== "none") {
    try {
      const { raiseAlert } = await import("./alertSpine");
      await raiseAlert({
        severity: alertSeverity,
        source: "ledger_dead_letter",
        title:
          alertSeverity === "critical"
            ? `Ledger dead letters ABANDONED: ${abandonedTotal} posting(s) missing from financial_ledger`
            : `Ledger dead letters accumulating: ${pendingAfter} pending posting(s)`,
        detail:
          `financial_ledger postings are failing and ${alertSeverity === "critical" ? "automation has exhausted replays" : "have not drained after replay"}: ` +
          `${pendingAfter} pending, ${abandonedTotal} abandoned. The ledger is the system of record — ` +
          `until these land, unit economics, contribution margin, and the Stripe reconciliation rule are all understated. ` +
          `Inspect ledger_dead_letters (last_error per row); replays run hourly via ledger_dead_letter_replay.`,
        dedupeKey: alertSeverity === "critical" ? "abandoned" : "pending-accumulation",
        domain: "finance",
        citedReason:
          "Every external money flow must land in financial_ledger (blueprint 2B: one money spine; failed postRevenue → dead-letter + replay).",
        alertType: "ledger_dead_letter_accumulation",
        pagePriority: "P1",
        metadata: { pendingAfter, abandonedTotal, replayed, failed, abandoned },
      });
    } catch (alertErr) {
      logger.error(
        "[ledgerDeadLetter] alert spine raise failed",
        alertErr instanceof Error ? alertErr : undefined,
      );
    }
  }

  logger.info("[ledgerDeadLetter] sweep complete", {
    metadata: {
      scanned: pending.length,
      replayed,
      failed,
      abandoned,
      pendingAfter,
      abandonedTotal,
      alertSeverity,
    },
  });

  return {
    scanned: pending.length,
    replayed,
    failed,
    abandoned,
    pendingAfter,
    abandonedTotal,
    alertSeverity,
  };
}
