/**
 * backfill-twilio-credentials.ts: copy every org's legacy Twilio credential
 * from organizationIntegrations into the canonical byok vault as the tuple
 * "<accountSid>:<authToken>:<fromPhoneNumber>" (P9-2d, Stage 2 of
 * docs/company/credential-consolidation-plan.md, Twilio portion).
 *
 * SAFETY:
 *   - DRY RUN by default: prints counts only and writes nothing.
 *     Pass --write to copy.
 *   - NEVER overwrites an existing active vault credential.
 *   - Legacy rows are left intact (retirement is Stage 4, founder-gated).
 *   - Disabled legacy rows are skipped (the vault has no enabled flag).
 *   - Rows missing any tuple field are skipped (skippedIncomplete), and
 *     rows with a ":" inside any field are skipped (skippedUnmigratable):
 *     neither can round-trip through the tuple's split(":") parse.
 *   - IDEMPOTENT: a second --write run copies zero rows.
 *   - The report contains counts only — never a credential value.
 *
 * Usage: DATABASE_URL=<redacted>
 * NOTE: shipped, not run against any live environment by the P9-2d lane;
 * running it on staging is post-merge coordinator work.
 */
import {
  backfillTwilioCredentials,
  defaultTwilioBackfillDeps,
  type TwilioBackfillReport,
} from "../server/services/providers/twilioBackfill";

export async function runTwilioBackfill(write: boolean): Promise<TwilioBackfillReport> {
  const deps = await defaultTwilioBackfillDeps();
  return backfillTwilioCredentials(deps, { write });
}

const isMain = process.argv[1]?.endsWith("backfill-twilio-credentials.ts");
if (isMain) {
  const write = process.argv.includes("--write");
  runTwilioBackfill(write)
    .then((r) => {
      console.log(
        `[backfill-twilio-credentials] ${write ? "WRITE" : "DRY RUN"}: scanned=${r.scanned} ` +
          `withLegacyTuple=${r.withLegacyTuple} alreadyInVault=${r.alreadyInVault} ` +
          `copied=${r.copied} wouldCopy=${r.wouldCopy} skippedIncomplete=${r.skippedIncomplete} ` +
          `skippedUnmigratable=${r.skippedUnmigratable} skippedDisabled=${r.skippedDisabled}`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("[backfill-twilio-credentials] failed:", err);
      process.exit(1);
    });
}
