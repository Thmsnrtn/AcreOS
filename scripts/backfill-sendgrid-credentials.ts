/**
 * backfill-sendgrid-credentials.ts: copy every org's legacy SendGrid apiKey from
 * organizationIntegrations into the canonical byok vault (P9-2c, Stage 2 of
 * docs/company/credential-consolidation-plan.md, SendGrid portion).
 *
 * SAFETY:
 *   - DRY RUN by default: prints counts only and writes nothing.
 *     Pass --write to copy.
 *   - NEVER overwrites an existing active vault credential.
 *   - Legacy rows are left intact (retirement is Stage 4, founder-gated).
 *   - Disabled legacy rows are skipped (the vault has no enabled flag).
 *   - IDEMPOTENT: a second --write run copies zero rows.
 *   - The report contains counts only — never a credential value.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/backfill-sendgrid-credentials.ts [--write]
 * NOTE: shipped, not run against any live environment by the P9-2c lane;
 * running it on staging is post-merge coordinator work.
 */
import {
  backfillSendGridCredentials,
  defaultSendGridBackfillDeps,
  type SendGridBackfillReport,
} from "../server/services/providers/sendgridBackfill";

export async function runSendGridBackfill(write: boolean): Promise<SendGridBackfillReport> {
  const deps = await defaultSendGridBackfillDeps();
  return backfillSendGridCredentials(deps, { write });
}

const isMain = process.argv[1]?.endsWith("backfill-sendgrid-credentials.ts");
if (isMain) {
  const write = process.argv.includes("--write");
  runSendGridBackfill(write)
    .then((r) => {
      console.log(
        `[backfill-sendgrid-credentials] ${write ? "WRITE" : "DRY RUN"}: scanned=${r.scanned} ` +
          `withLegacyKey=${r.withLegacyKey} alreadyInVault=${r.alreadyInVault} ` +
          `copied=${r.copied} wouldCopy=${r.wouldCopy} skippedNoKey=${r.skippedNoKey} ` +
          `skippedDisabled=${r.skippedDisabled}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("[backfill-sendgrid-credentials] failed:", err);
      process.exit(1);
    });
}
