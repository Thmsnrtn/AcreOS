/**
 * backfill-chart-of-accounts.ts: give every org with NO chart of accounts the
 * default chart (server/services/chartOfAccountsSeed.ts).
 *
 * WHY. The default chart's only seeding call sat in storage.createOrganization,
 * which the real signup path (server/middleware/getOrCreateOrg.ts) never calls.
 * So no real org was ever seeded, and every recognition GL post threw. Measured
 * 2026-10-21 (G4 money-lifecycle run, staging): chart_of_accounts empty for
 * every org, account_ledger_entries empty, a full $49 refund that never
 * reached financial_ledger. New orgs are now seeded at creation, and the GL
 * path seeds an empty chart on first use. This script seeds the existing ones
 * eagerly, so the chart exists before the next money event rather than at it.
 *
 * SAFETY:
 *   - DRY RUN by default: prints the orgs it would seed and writes nothing.
 *     Pass --write to seed.
 *   - IDEMPOTENT: seedChartOfAccountsForOrg skips any org that already has an
 *     account (a custom chart is never topped up), and its insert is
 *     ON CONFLICT DO NOTHING on (organization_id, account_number). A second
 *     run seeds nothing.
 *   - Additive only: it inserts default accounts. It never updates or deletes.
 *
 * Usage: DATABASE_URL=… npx tsx scripts/backfill-chart-of-accounts.ts [--write]
 */
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { seedChartOfAccountsForOrg } from "../server/services/chartOfAccountsSeed";

export async function orgsWithoutChart(): Promise<number[]> {
  const result = await db.execute<{ id: number }>(sql`
    SELECT o.id FROM organizations o
    WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.organization_id = o.id)
    ORDER BY o.id`);
  return result.rows.map((r) => Number(r.id));
}

export async function backfillChartOfAccounts(write: boolean): Promise<{ orgs: number; accountsCreated: number }> {
  const ids = await orgsWithoutChart();
  let accountsCreated = 0;
  if (write) {
    for (const id of ids) accountsCreated += await seedChartOfAccountsForOrg(id);
  }
  return { orgs: ids.length, accountsCreated };
}

const isMain = process.argv[1]?.endsWith("backfill-chart-of-accounts.ts");
if (isMain) {
  const write = process.argv.includes("--write");
  backfillChartOfAccounts(write)
    .then(({ orgs, accountsCreated }) => {
      console.log(
        write
          ? `[backfill-chart-of-accounts] seeded ${orgs} org(s), ${accountsCreated} account(s) created`
          : `[backfill-chart-of-accounts] DRY RUN: ${orgs} org(s) have no chart of accounts; re-run with --write to seed`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("[backfill-chart-of-accounts] failed:", err);
      process.exit(1);
    });
}
