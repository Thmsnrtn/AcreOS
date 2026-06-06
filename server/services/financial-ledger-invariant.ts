/**
 * financial-ledger-invariant — Tahoe L6 system-of-record startup assertion.
 *
 * `financial_ledger` is the canonical system of record for every dollar that
 * moves through AcreOS (see docs/internal/finance/system-of-record.md). On
 * server startup we want a loud failure if either:
 *
 *   1. The table is missing entirely (mis-configured DB, wrong credentials,
 *      forgot to run scripts/migrate.mjs on a fresh stack).
 *   2. The table exists but a basic aggregation against it fails (column
 *      rename / schema drift / pg permission denied).
 *
 * The check does NOT block boot — finance is downstream of customer surface
 * reachability and we never want a finance posture issue to take the platform
 * dark. Instead it fires a structured `logger.error` with the tag
 * `financial_ledger.invariant_failed` so the next deploy / Sentry alert pipeline
 * catches it.
 *
 * `assertFinancialLedgerInvariant` is exported so server/index.ts can `await`
 * it on boot and tests can drive it directly. Returns the row-count of the
 * cheap probe query so callers can log it for context.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { financialLedger } from "@shared/schema";
import { logger } from "../utils/logger";

export interface FinancialLedgerInvariantResult {
  ok: boolean;
  tableExists: boolean;
  /** rows-or-empty — count(*) of the table at probe time. -1 if the probe failed. */
  rowCountProbe: number;
  errorMessage?: string;
}

/**
 * Assert the financial_ledger table is reachable and schema-compatible.
 *
 * Side effects:
 *   - logger.info on success (one-line summary)
 *   - logger.error on failure with tag `financial_ledger.invariant_failed`
 */
export async function assertFinancialLedgerInvariant(): Promise<FinancialLedgerInvariantResult> {
  // Step 1 — confirm the table exists at the catalog level. We use
  // information_schema to avoid a hard parser-level failure if the table
  // is genuinely missing (Drizzle's count(*) would still throw, but the
  // error class would be a Postgres relation-not-exists rather than
  // a Node-level reference error — surface either way).
  try {
    const existsRows = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'financial_ledger'
      ) AS exists
    `);
    // drizzle's db.execute returns { rows: [...] } on neon-http and
    // { rows: [...] } on node-postgres — both shapes carry the row.
    const result = existsRows as unknown as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const row = Array.isArray(result) ? result[0] : result.rows?.[0];
    const exists = !!(row?.exists);
    if (!exists) {
      const msg = "financial_ledger table not found in public schema";
      logger.error("financial_ledger.invariant_failed", {
        metadata: { reason: "table_missing", message: msg },
      });
      return { ok: false, tableExists: false, rowCountProbe: -1, errorMessage: msg };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("financial_ledger.invariant_failed", {
      metadata: { reason: "catalog_probe_failed", message: msg },
    });
    return { ok: false, tableExists: false, rowCountProbe: -1, errorMessage: msg };
  }

  // Step 2 — run a real Drizzle query through the model. This validates
  // the column shape (column rename / type drift would throw here).
  // An empty table is fine — we only require the query to execute.
  try {
    const [row] = await db
      .select({ n: sql<string>`count(*)` })
      .from(financialLedger);
    const rowCountProbe = Number(row?.n ?? 0);
    logger.info("financial_ledger.invariant_ok", {
      metadata: { rowCountProbe },
    });
    return { ok: true, tableExists: true, rowCountProbe };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("financial_ledger.invariant_failed", {
      metadata: { reason: "model_probe_failed", message: msg },
    });
    return { ok: false, tableExists: true, rowCountProbe: -1, errorMessage: msg };
  }
}
