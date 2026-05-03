/**
 * Chart of Accounts seed (Lavender §1, Hilda §2 — Phase 2 Week 6).
 *
 * Creates a default 15-account structure when a new organization is
 * provisioned. Customers can rename, reparent, or deactivate any of
 * these later — accountNumber is customer-defined and the seed values
 * follow the standard 1000s/2000s/3000s/4000s/5000-7000 ranges so they
 * map cleanly into QuickBooks or any CPA's working chart.
 *
 * The function is idempotent: it counts existing rows for the org and
 * short-circuits if any are present. This makes it safe to call from
 * the org-creation hook without coordinating against retries or
 * organisation re-imports.
 */
import { db } from "../db";
import { chartOfAccounts, type AccountType } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface DefaultAccountSeed {
  accountNumber: string;
  accountName: string;
  accountType: AccountType;
  description?: string;
}

/**
 * Default chart-of-accounts template. Exported so tests + import flows
 * (e.g. "restore default chart") can reuse the same canonical list.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: ReadonlyArray<DefaultAccountSeed> = [
  // ── Assets (1000s) ────────────────────────────────────────────────────
  { accountNumber: "1000", accountName: "Cash", accountType: "asset",
    description: "Operating bank balance and reconciled deposits." },
  { accountNumber: "1100", accountName: "Accounts Receivable", accountType: "asset",
    description: "Invoiced amounts not yet collected." },
  { accountNumber: "1200", accountName: "Notes Receivable", accountType: "asset",
    description: "Outstanding principal on owner-financed notes." },
  { accountNumber: "1500", accountName: "Property", accountType: "asset",
    description: "Land and parcels held for sale or held as inventory." },

  // ── Liabilities (2000s) ───────────────────────────────────────────────
  { accountNumber: "2000", accountName: "Accounts Payable", accountType: "liability",
    description: "Vendor bills not yet paid." },
  { accountNumber: "2500", accountName: "Notes Payable", accountType: "liability",
    description: "Loans owed (acquisition financing, lines of credit)." },

  // ── Equity (3000s) ────────────────────────────────────────────────────
  { accountNumber: "3000", accountName: "Owner Equity", accountType: "equity",
    description: "Owner contributions and draws." },
  { accountNumber: "3500", accountName: "Retained Earnings", accountType: "equity",
    description: "Cumulative net income closed from prior periods." },

  // ── Revenue (4000s) ───────────────────────────────────────────────────
  { accountNumber: "4000", accountName: "Subscription Revenue", accountType: "revenue",
    description: "Recurring SaaS / membership revenue." },
  { accountNumber: "4100", accountName: "Lead Revenue", accountType: "revenue",
    description: "Income from sold or assigned leads." },
  { accountNumber: "4500", accountName: "Note Interest Income", accountType: "revenue",
    description: "Interest portion of note payments received." },

  // ── Expenses (5000–7000s) ─────────────────────────────────────────────
  { accountNumber: "5000", accountName: "COGS", accountType: "expense",
    description: "Cost of goods sold — direct property cost basis." },
  { accountNumber: "6000", accountName: "Operations", accountType: "expense",
    description: "General operating expenses (software, hosting, fees)." },
  { accountNumber: "6500", accountName: "AI Costs", accountType: "expense",
    description: "LLM provider spend (Anthropic, OpenAI, voice, vision)." },
  { accountNumber: "7000", accountName: "Marketing", accountType: "expense",
    description: "Acquisition spend — direct mail, ads, list buys." },
];

/**
 * Seeds the default chart of accounts for an organization.
 *
 * Idempotent: returns early if the org already has any accounts. We use
 * a row count rather than INSERT ... ON CONFLICT so partial seeds (e.g.
 * a manual import that brought in 3 custom accounts) are not silently
 * topped up with defaults the customer never asked for.
 *
 * @returns the number of accounts inserted (0 if already seeded).
 */
export async function seedChartOfAccountsForOrg(
  organizationId: number,
): Promise<number> {
  // Idempotency check — any existing account means this org has already
  // been initialised (or has custom accounts). Don't double-seed.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.organizationId, organizationId));

  if (count > 0) {
    logger.info("chartOfAccountsSeed.skipped", {
      organizationId,
      existingAccounts: count,
    });
    return 0;
  }

  const rows = DEFAULT_CHART_OF_ACCOUNTS.map((acc) => ({
    organizationId,
    accountNumber: acc.accountNumber,
    accountName: acc.accountName,
    accountType: acc.accountType,
    description: acc.description ?? null,
    isActive: true,
  }));

  const inserted = await db
    .insert(chartOfAccounts)
    .values(rows)
    .returning({ id: chartOfAccounts.id });

  logger.info("chartOfAccountsSeed.created", {
    organizationId,
    accountsCreated: inserted.length,
  });

  return inserted.length;
}
