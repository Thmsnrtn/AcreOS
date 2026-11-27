/**
 * Twilio credential backfill — Stage 2 of the credential-consolidation plan
 * (docs/company/credential-consolidation-plan.md), Twilio portion (P9-2d).
 *
 * Copies each org's legacy organizationIntegrations twilio credential into
 * the canonical byok vault via setByokCredential, as the tuple
 * "<accountSid>:<authToken>:<fromPhoneNumber>" every twilio reader parses
 * with split(":"). The legacy row is read through
 * readIntegrationCredentials (which handles BOTH stored shapes — the
 * sealed envelope and the legacy plaintext field); reading
 * `credentials.encrypted` directly would strand plaintext-shaped rows.
 *
 * Rules (plan Stage 2, family pattern):
 *   - Never overwrite an existing active vault credential.
 *   - Legacy rows are left intact (deletion is Stage 4, a founder hard-stop).
 *   - Disabled legacy rows are NOT backfilled: the vault has no enabled
 *     flag, so copying a disabled credential would silently activate it.
 *   - Idempotent: a second run copies nothing (every copied org then has
 *     a vault row and is counted as alreadyInVault).
 *   - Counts only — credential values and fingerprints are never returned,
 *     logged, or included in the report.
 *
 * Twilio-specific gates (the tuple must round-trip):
 *   - A row missing ANY of accountSid / authToken / fromPhoneNumber is
 *     counted skippedIncomplete and NOT migrated — a partial tuple would
 *     be unreadable by every consumer, which requires exactly 3 parts.
 *   - A row where ANY field contains ":" is counted skippedUnmigratable
 *     and NOT migrated — the joined tuple would split into more than 3
 *     parts and silently corrupt the credential.
 */

export interface TwilioLegacyRow {
  organizationId: number;
  isEnabled: boolean;
  credentials: unknown;
}

export interface TwilioTuple {
  accountSid: string;
  authToken: string;
  fromPhoneNumber: string;
}

export interface TwilioBackfillDeps {
  listLegacyTwilioRows: () => Promise<TwilioLegacyRow[]>;
  readLegacyTuple: (row: TwilioLegacyRow) => Partial<TwilioTuple> | null;
  getVaultCredential: (organizationId: number) => Promise<string | null>;
  setVaultCredential: (organizationId: number, plaintext: string) => Promise<void>;
}

export interface TwilioBackfillReport {
  scanned: number;
  withLegacyTuple: number;
  alreadyInVault: number;
  copied: number;
  wouldCopy: number;
  skippedIncomplete: number;
  skippedUnmigratable: number;
  skippedDisabled: number;
}

export async function backfillTwilioCredentials(
  deps: TwilioBackfillDeps,
  opts: { write: boolean },
): Promise<TwilioBackfillReport> {
  const report: TwilioBackfillReport = {
    scanned: 0,
    withLegacyTuple: 0,
    alreadyInVault: 0,
    copied: 0,
    wouldCopy: 0,
    skippedIncomplete: 0,
    skippedUnmigratable: 0,
    skippedDisabled: 0,
  };

  const rows = await deps.listLegacyTwilioRows();
  for (const row of rows) {
    report.scanned += 1;
    if (!row.isEnabled) {
      report.skippedDisabled += 1;
      continue;
    }
    const tuple = deps.readLegacyTuple(row);
    const accountSid = tuple?.accountSid;
    const authToken = tuple?.authToken;
    const fromPhoneNumber = tuple?.fromPhoneNumber;
    if (!accountSid || !authToken || !fromPhoneNumber) {
      report.skippedIncomplete += 1;
      continue;
    }
    if (accountSid.includes(":") || authToken.includes(":") || fromPhoneNumber.includes(":")) {
      report.skippedUnmigratable += 1;
      continue;
    }
    report.withLegacyTuple += 1;
    const existing = await deps.getVaultCredential(row.organizationId);
    if (existing) {
      report.alreadyInVault += 1;
      continue;
    }
    if (opts.write) {
      await deps.setVaultCredential(
        row.organizationId,
        `${accountSid}:${authToken}:${fromPhoneNumber}`,
      );
      report.copied += 1;
    } else {
      report.wouldCopy += 1;
    }
  }
  return report;
}

/** Production wiring: legacy rows from organizationIntegrations, vault via key-vault. */
export async function defaultTwilioBackfillDeps(): Promise<TwilioBackfillDeps> {
  const { db } = await import("../../db");
  const { organizationIntegrations } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { readIntegrationCredentials } = await import("../integrationCredentials");
  const { getByokCredential, setByokCredential } = await import("../byok/key-vault");

  return {
    listLegacyTwilioRows: async () => {
      const rows = await db
        .select()
        .from(organizationIntegrations)
        .where(eq(organizationIntegrations.provider, "twilio"));
      return rows.map((r) => ({
        organizationId: r.organizationId,
        isEnabled: !!r.isEnabled,
        credentials: r.credentials,
      }));
    },
    readLegacyTuple: (row) => {
      const creds = readIntegrationCredentials<Partial<TwilioTuple>>(
        { credentials: row.credentials },
        row.organizationId,
        "twilio backfill",
      );
      return creds ?? null;
    },
    getVaultCredential: (organizationId) =>
      getByokCredential({ organizationId, channel: "twilio" }, { touchLastUsed: false }),
    setVaultCredential: async (organizationId, plaintext) => {
      await setByokCredential({ organizationId, channel: "twilio", plaintext });
    },
  };
}
