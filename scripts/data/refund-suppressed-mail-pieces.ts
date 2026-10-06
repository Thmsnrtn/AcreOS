#!/usr/bin/env tsx
/**
 * DEFECT-0277: repay the suppressed-mail-piece refunds that were skipped
 * before DEFECT-0271.
 *
 * From the day a refund began requiring its original debit to exist until
 * DEFECT-0271, the flusher refunded a suppressed piece's share under the
 * original id `<debit>:suppressed` — a key no debit carries — so every such
 * refund was logged "original debit not found" and skipped. Those orgs were
 * charged AcreOS credit for pieces that were never mailed. The fix does not
 * reach back; this script does.
 *
 * WHAT IT MOVES. Prepaid AcreOS CREDIT (the org's credit pool / purchased
 * credit balance) — never customer money, and nothing at a processor. It is
 * still a change to customer balances, so it is FOUNDER-RUN ONLY: no route,
 * no job, no import from server code calls it.
 *
 * SELECTION. A shipment with at least one piece in status `suppressed`, a
 * `debit_event_key`, and no `<debit>:suppressed:refund` ledger row. Its share
 * is the flusher's own rule (`debitShareCents` in
 * server/services/mail/mailFlusher.ts): floor(debited × suppressed / pieces).
 *
 * THE REFUND goes through `refundPoolDebit` (server/services/creditPool.ts)
 * with exactly the flusher's arguments — `originalEventId: <debit>`,
 * `refundKey: <debit>:suppressed:refund` — so it picks the purse the debit was
 * paid from, caps the amount at what is left of the debit after its earlier
 * refunds, and is idempotent by that key (`financial_ledger.external_event_id`
 * is UNIQUE and the insert is ON CONFLICT DO NOTHING). A re-run selects
 * nothing already repaid and refunds nothing twice.
 *
 * WHAT A "REFUND" DOES DEPENDS ON THE PURSE (refundPoolDebit, DEFECT-0227):
 *   - debit paid from PURCHASED credits → the credits are returned;
 *   - pool debit from THIS month        → this month's pool usage is netted;
 *   - pool debit from a CLOSED month    → a ledger record only: that month's
 *     allowance has lapsed, and refundPoolDebit deliberately does not credit
 *     it to the current month. The dry run lists these separately so the
 *     founder sees which rows repay credit and which only correct the books.
 *
 * `refundPoolDebit` swallows its own errors (it logs them), so the outcome of
 * each refund is read back from the ledger, never assumed.
 *
 *   DATABASE_URL=... npx tsx scripts/data/refund-suppressed-mail-pieces.ts          # dry run (the plan)
 *   DATABASE_URL=... npx tsx scripts/data/refund-suppressed-mail-pieces.ts --apply  # export, then refund
 */
import { readFileSync } from "node:fs";
import { connect, exportRows, isMain, parseFlags, type Queryable } from "./_client";

/** The refund key the flusher writes for a shipment's suppressed share. */
export function suppressedRefundKey(debitEventKey: string): string {
  return `${debitEventKey}:suppressed:refund`;
}

/**
 * The share of a shipment's debit that `pieces` of it paid for — the same
 * arithmetic as `debitShareCents` in mailFlusher.ts (not exported there).
 */
export function suppressedShareCents(debitedCents: number | null, pieceCount: number | null, pieces: number): number {
  const total = pieceCount && pieceCount > 0 ? pieceCount : null;
  if (!debitedCents || debitedCents <= 0 || !total || pieces <= 0) return 0;
  return Math.floor((debitedCents * pieces) / total);
}

/** One shipment as the read returns it. */
export interface SuppressedShipmentRow {
  shipment_id: number;
  organization_id: number;
  status: string;
  debit_event_key: string | null;
  debited_cents: number | null;
  piece_count: number | null;
  suppressed_pieces: number;
  /** The original debit's ledger row (null = not found in this org). */
  original_cents: number | string | null;
  original_posted_by: string | null;
  original_posted_at: string | Date | null;
  /** A `<debit>:suppressed:refund` row already exists (any org: the key is UNIQUE). */
  refund_exists: boolean;
  /** Refunds already posted against this debit (`<debit>:` prefix, refund writer). */
  refunded_so_far_cents: number | string | null;
}

export type Purse = "purchased_credits_returned" | "pool_netted_this_month" | "pool_prior_month_record_only";

export interface PlannedRefund {
  shipmentId: number;
  organizationId: number;
  debitEventKey: string;
  refundKey: string;
  suppressedPieces: number;
  shareCents: number;
  /** What refundPoolDebit's cap leaves of the share (what the ledger should show). */
  expectedCents: number;
  purse: Purse;
}

export type SkipReason = "already_refunded" | "no_debit_key" | "zero_share" | "original_debit_missing" | "nothing_left_to_refund";

export interface SkippedShipment {
  shipmentId: number;
  organizationId: number;
  reason: SkipReason;
}

/**
 * The pure decision: which shipments get a refund, of how much, from which
 * purse — and why every other one does not. Mirrors refundPoolDebit's own
 * rules (original must exist, cap at what is left, purse by `posted_by` and
 * month) so the plan says what the refund will do before it does it.
 */
export function planSuppressedRefunds(
  rows: SuppressedShipmentRow[],
  now: Date,
): { planned: PlannedRefund[]; skipped: SkippedShipment[] } {
  const planned: PlannedRefund[] = [];
  const skipped: SkippedShipment[] = [];
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (const r of rows) {
    const skip = (reason: SkipReason) => skipped.push({ shipmentId: r.shipment_id, organizationId: r.organization_id, reason });
    if (!r.debit_event_key) { skip("no_debit_key"); continue; }
    if (r.refund_exists) { skip("already_refunded"); continue; }
    const shareCents = suppressedShareCents(r.debited_cents, r.piece_count, Number(r.suppressed_pieces));
    if (shareCents <= 0) { skip("zero_share"); continue; }
    if (r.original_cents === null || r.original_cents === undefined) { skip("original_debit_missing"); continue; }
    const originalCents = Math.abs(Number(r.original_cents));
    const remaining = Number.isFinite(originalCents) && originalCents > 0
      ? Math.max(0, originalCents - Number(r.refunded_so_far_cents ?? 0))
      : shareCents;
    const expectedCents = Math.min(shareCents, remaining);
    if (expectedCents <= 0) { skip("nothing_left_to_refund"); continue; }
    const purse: Purse = r.original_posted_by?.endsWith(":purchased-overflow")
      ? "purchased_credits_returned"
      : r.original_posted_at != null && new Date(r.original_posted_at) >= monthStart
        ? "pool_netted_this_month"
        : "pool_prior_month_record_only";
    planned.push({
      shipmentId: r.shipment_id,
      organizationId: r.organization_id,
      debitEventKey: r.debit_event_key,
      refundKey: suppressedRefundKey(r.debit_event_key),
      suppressedPieces: Number(r.suppressed_pieces),
      shareCents,
      expectedCents,
      purse,
    });
  }
  return { planned, skipped };
}

/** The read. Every shipment with a suppressed piece — the plan decides, so the dry run can report the ones it skips. */
export const SELECT_SUPPRESSED_SHIPMENTS = `
SELECT s.id AS shipment_id,
       s.organization_id,
       s.status,
       s.debit_event_key,
       s.debited_cents,
       s.piece_count,
       sp.suppressed_pieces,
       o.amount_cents AS original_cents,
       o.posted_by AS original_posted_by,
       o.posted_at AS original_posted_at,
       EXISTS (
         SELECT 1 FROM financial_ledger r
          WHERE r.external_event_id = s.debit_event_key || ':suppressed:refund'
       ) AS refund_exists,
       COALESCE((
         SELECT sum(abs(r.amount_cents)) FROM financial_ledger r
          WHERE r.organization_id = s.organization_id
            AND r.posted_by = 'system:credit-pool:refund'
            AND starts_with(r.external_event_id, s.debit_event_key || ':')
       ), 0)::bigint AS refunded_so_far_cents
  FROM mail_shipments s
  JOIN (
        SELECT shipment_id, organization_id, count(*)::int AS suppressed_pieces
          FROM mail_shipment_pieces
         WHERE status = 'suppressed'
         GROUP BY shipment_id, organization_id
       ) sp ON sp.shipment_id = s.id AND sp.organization_id = s.organization_id
  LEFT JOIN financial_ledger o
         ON o.external_event_id = s.debit_event_key AND o.organization_id = s.organization_id
 ORDER BY s.id`;

/** The refund function's shape — `refundPoolDebit` in production, a fake in tests. */
export type RefundFn = (args: {
  organizationId: number;
  originalEventId: string;
  refundKey: string;
  amountCents: number;
  reason: string;
}) => Promise<void>;

export interface RefundOutcome {
  shipmentId: number;
  refundKey: string;
  expectedCents: number;
  /** Read back from the ledger after the call; null = no row was written. */
  postedCents: number | null;
}

export interface RunResult {
  rows: number;
  planned: PlannedRefund[];
  skipped: SkippedShipment[];
  exportPath: string | null;
  balancesExportPath: string | null;
  outcomes: RefundOutcome[];
  applied: boolean;
}

export async function refundSuppressedMailPieces(
  client: Queryable,
  opts: { apply: boolean; outDir: string; now?: Date; refund?: RefundFn },
): Promise<RunResult> {
  const now = opts.now ?? new Date();
  // One consistent snapshot for the plan and the balances it exports.
  await client.query("BEGIN READ ONLY");
  let rows: SuppressedShipmentRow[];
  let balances: Array<Record<string, unknown>> = [];
  let plan: ReturnType<typeof planSuppressedRefunds>;
  try {
    rows = (await client.query<SuppressedShipmentRow>(SELECT_SUPPRESSED_SHIPMENTS)).rows;
    plan = planSuppressedRefunds(rows, now);
    const orgIds = Array.from(new Set(plan.planned.map((p) => p.organizationId)));
    if (opts.apply && orgIds.length > 0) {
      balances = (
        await client.query(`SELECT id, credit_balance FROM organizations WHERE id = ANY($1::int[]) ORDER BY id`, [orgIds])
      ).rows;
    }
  } finally {
    await client.query("ROLLBACK");
  }

  const base: RunResult = {
    rows: rows.length,
    planned: plan.planned,
    skipped: plan.skipped,
    exportPath: null,
    balancesExportPath: null,
    outcomes: [],
    applied: false,
  };
  if (!opts.apply || plan.planned.length === 0) return base;
  if (!opts.refund) throw new Error("--apply needs the refund function — refusing to run without it");

  // Export before change: the plan (with each debit's state as read) and the
  // affected orgs' purchased-credit balances, verified on disk first.
  const exportPath = exportRows(opts.outDir, "suppressed-mail-refunds-plan", plan.planned);
  const balancesExportPath = exportRows(opts.outDir, "suppressed-mail-refunds-org-credit-balances", balances);
  const written = JSON.parse(readFileSync(exportPath, "utf8")) as unknown[];
  if (written.length !== plan.planned.length) {
    throw new Error(`export wrote ${written.length} of ${plan.planned.length} planned refunds — refusing to refund`);
  }

  const outcomes: RefundOutcome[] = [];
  for (const p of plan.planned) {
    await opts.refund({
      organizationId: p.organizationId,
      originalEventId: p.debitEventKey,
      refundKey: p.refundKey,
      amountCents: p.shareCents,
      reason: `DEFECT-0277: ${p.suppressedPieces} piece(s) of shipment ${p.shipmentId} were not sent (the recipient opted out or was removed during the hold); their refund was skipped before DEFECT-0271`,
    });
    // refundPoolDebit logs and swallows its errors: read what it wrote.
    const { rows: posted } = await client.query<{ amount_cents: number | string }>(
      `SELECT amount_cents FROM financial_ledger WHERE external_event_id = $1 AND organization_id = $2`,
      [p.refundKey, p.organizationId],
    );
    outcomes.push({
      shipmentId: p.shipmentId,
      refundKey: p.refundKey,
      expectedCents: p.expectedCents,
      postedCents: posted[0] ? Math.abs(Number(posted[0].amount_cents)) : null,
    });
  }
  return { ...base, exportPath, balancesExportPath, outcomes, applied: true };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { client, end } = await connect();
  let refund: RefundFn | undefined;
  let closeServerPool: (() => Promise<void>) | undefined;
  if (flags.apply) {
    // Only an applied run loads the server's credit pool (and its DB pool).
    const { refundPoolDebit } = await import("../../server/services/creditPool");
    const { pool } = await import("../../server/db");
    refund = refundPoolDebit;
    closeServerPool = () => pool.end();
  }
  try {
    const r = await refundSuppressedMailPieces(client, { ...flags, refund });
    const byPurse = (purse: Purse) => r.planned.filter((p) => p.purse === purse);
    const cents = (ps: PlannedRefund[]) => ps.reduce((n, p) => n + p.expectedCents, 0);
    console.log(`${r.rows} shipment(s) with suppressed pieces.`);
    for (const reason of ["already_refunded", "no_debit_key", "zero_share", "original_debit_missing", "nothing_left_to_refund"] as const) {
      const n = r.skipped.filter((s) => s.reason === reason).length;
      if (n > 0) console.log(`  skipped, ${reason}: ${n}`);
    }
    console.log(`${r.planned.length} refund(s) owed, ${cents(r.planned)} cents in all:`);
    console.log(`  purchased credits returned:              ${byPurse("purchased_credits_returned").length} (${cents(byPurse("purchased_credits_returned"))} cents)`);
    console.log(`  this month's pool usage netted:          ${byPurse("pool_netted_this_month").length} (${cents(byPurse("pool_netted_this_month"))} cents)`);
    console.log(`  closed-month pool debit, record only:    ${byPurse("pool_prior_month_record_only").length} (${cents(byPurse("pool_prior_month_record_only"))} cents)`);
    if (!r.applied) {
      console.log("Dry run: nothing changed. Re-run with --apply to export the plan and refund.");
      return;
    }
    console.log(`Exported the plan to ${r.exportPath} and the org credit balances to ${r.balancesExportPath}.`);
    const posted = r.outcomes.filter((o) => o.postedCents !== null);
    const short = posted.filter((o) => o.postedCents !== o.expectedCents);
    const missing = r.outcomes.filter((o) => o.postedCents === null);
    console.log(`${posted.length} refund row(s) now in the ledger, ${posted.reduce((n, o) => n + (o.postedCents ?? 0), 0)} cents.`);
    for (const o of short) console.log(`  shipment ${o.shipmentId}: expected ${o.expectedCents}, ledger shows ${o.postedCents}`);
    for (const o of missing) console.log(`  shipment ${o.shipmentId}: NO refund row written (${o.refundKey}) — see the [credit-pool] log lines`);
  } finally {
    await end();
    if (closeServerPool) await closeServerPool();
  }
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
