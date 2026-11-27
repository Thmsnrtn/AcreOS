/**
 * backfill-ses-credentials.ts: copy every org's legacy SES credential bag from
 * organizationIntegrations (provider `aws_ses`) into the canonical byok vault
 * (channel `ses`), packed as the JSON bag defined in
 * server/services/providers/sesCredential.ts (P9-2e, Stage 2 of
 * docs/company/credential-consolidation-plan.md, SES portion).
 *
 * SAFETY:
 *   - DRY RUN by default: prints counts only and writes nothing.
 *     Pass --write to copy.
 *   - NEVER overwrites an existing active vault credential.
 *   - Legacy rows are left intact (retirement is Stage 4, founder-gated).
 *   - Disabled legacy rows are skipped (the vault has no enabled flag).
 *   - Bags missing accessKeyId or secretAccessKey are skippedIncomplete;
 *     oversized bags are skippedUnmigratable. Neither is migrated.
 *   - IDEMPOTENT: a second --write run copies zero rows.
 *   - The report contains counts only — never a credential value.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/backfill-ses-credentials.ts [--write]
 * NOTE: shipped, not run against any live environment by the P9-2e lane;
 * running it on staging is post-merge coordinator work.
 */
import {
  backfillSesCredentials,
  defaultSesBackfillDeps,
  type SesBackfillReport,
} from "../server/services/providers/sesBackfill";

export async function runSesBackfill(write: boolean): Promise<SesBackfillReport> {
  const deps = await defaultSesBackfillDeps();
  return backfillSesCredentials(deps, { write });
}

const isMain = process.argv[1]?.endsWith("backfill-ses-credentials.ts");
if (isMain) {
  const write = process.argv.includes("--write");
  runSesBackfill(write)
    .then((r) => {
      console.log(
        `[backfill-ses-credentials] ${write ? "WRITE" : "DRY RUN"}: scanned=${r.scanned} ` +
          `withLegacyKey=${r.withLegacyKey} alreadyInVault=${r.alreadyInVault} ` +
          `copied=${r.copied} wouldCopy=${r.wouldCopy} skippedIncomplete=${r.skippedIncomplete} ` +
          `skippedUnmigratable=${r.skippedUnmigratable} skippedDisabled=${r.skippedDisabled}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("[backfill-ses-credentials] failed:", err);
      process.exit(1);
    });
}
