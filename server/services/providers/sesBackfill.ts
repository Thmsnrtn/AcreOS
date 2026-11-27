/**
 * SES credential backfill — Stage 2 of the credential-consolidation plan
 * (docs/company/credential-consolidation-plan.md), SES portion (P9-2e).
 *
 * Copies each org's legacy organizationIntegrations `aws_ses` credential
 * bag into the canonical byok vault (channel `ses` — the vault name for
 * the legacy `aws_ses` provider) via setByokCredential, packed as the JSON
 * bag defined in sesCredential.ts. Both stores encrypt through the shared
 * fieldEncryption keyring, so this is a re-encrypt: the legacy row is read
 * through readIntegrationCredentials (which handles BOTH stored shapes —
 * the sealed envelope and the legacy plaintext fields) and the bag is
 * sealed again under the vault envelope. Reading `credentials.encrypted`
 * directly would strand plaintext-shaped rows; this module never does
 * that.
 *
 * Rules (plan Stage 2):
 *   - Never overwrite an existing active vault credential.
 *   - Legacy rows are left intact (deletion is Stage 4, a founder hard-stop).
 *   - Disabled legacy rows are NOT backfilled: the vault has no enabled
 *     flag, so copying a disabled bag would silently activate it.
 *   - A bag missing accessKeyId or secretAccessKey is counted
 *     skippedIncomplete and NOT migrated — the vault reader's both-fields
 *     gate (parseSesVaultCredential) would reject it on every read, so
 *     vaulting it would strand the org behind a row that looks migrated.
 *   - A bag whose serialized JSON exceeds the vault plaintext ceiling
 *     (SES_VAULT_PLAINTEXT_MAX, the BYOK hub's limit) is counted
 *     skippedUnmigratable and NOT migrated.
 *   - Idempotent: a second run copies nothing (every copied org then has
 *     a vault row and is counted as alreadyInVault).
 *   - Counts only — credential values and fingerprints are never returned,
 *     logged, or included in the report.
 *
 * The whole bag is vaulted, config fields included (region / fromEmail /
 * fromName ride inside the JSON bag for read-parity with the legacy
 * single-bag reader — see sesCredential.ts for the classification).
 */

import {
  parseSesVaultCredential,
  SES_VAULT_PLAINTEXT_MAX,
  type SesCredentialBag,
} from "./sesCredential";

export interface SesLegacyRow {
  organizationId: number;
  isEnabled: boolean;
  credentials: unknown;
}

export interface SesBackfillDeps {
  listLegacySesRows: () => Promise<SesLegacyRow[]>;
  readLegacySesBag: (row: SesLegacyRow) => SesCredentialBag | null;
  getVaultCredential: (organizationId: number) => Promise<string | null>;
  setVaultCredential: (organizationId: number, plaintext: string) => Promise<void>;
}

export interface SesBackfillReport {
  scanned: number;
  withLegacyKey: number;
  alreadyInVault: number;
  copied: number;
  wouldCopy: number;
  skippedIncomplete: number;
  skippedUnmigratable: number;
  skippedDisabled: number;
}

export async function backfillSesCredentials(
  deps: SesBackfillDeps,
  opts: { write: boolean },
): Promise<SesBackfillReport> {
  const report: SesBackfillReport = {
    scanned: 0,
    withLegacyKey: 0,
    alreadyInVault: 0,
    copied: 0,
    wouldCopy: 0,
    skippedIncomplete: 0,
    skippedUnmigratable: 0,
    skippedDisabled: 0,
  };

  const rows = await deps.listLegacySesRows();
  for (const row of rows) {
    report.scanned += 1;
    if (!row.isEnabled) {
      report.skippedDisabled += 1;
      continue;
    }
    const bag = deps.readLegacySesBag(row);
    if (!bag) {
      report.skippedIncomplete += 1;
      continue;
    }
    const plaintext = JSON.stringify(bag);
    if (plaintext.length > SES_VAULT_PLAINTEXT_MAX) {
      report.skippedUnmigratable += 1;
      continue;
    }
    report.withLegacyKey += 1;
    const existing = await deps.getVaultCredential(row.organizationId);
    if (existing) {
      report.alreadyInVault += 1;
      continue;
    }
    if (opts.write) {
      await deps.setVaultCredential(row.organizationId, plaintext);
      report.copied += 1;
    } else {
      report.wouldCopy += 1;
    }
  }
  return report;
}

/** Production wiring: legacy rows from organizationIntegrations, vault via key-vault. */
export async function defaultSesBackfillDeps(): Promise<SesBackfillDeps> {
  const { db } = await import("../../db");
  const { organizationIntegrations } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { readIntegrationCredentials } = await import("../integrationCredentials");
  const { getByokCredential, setByokCredential } = await import("../byok/key-vault");

  return {
    listLegacySesRows: async () => {
      const rows = await db
        .select()
        .from(organizationIntegrations)
        .where(eq(organizationIntegrations.provider, "aws_ses"));
      return rows.map((r) => ({
        organizationId: r.organizationId,
        isEnabled: !!r.isEnabled,
        credentials: r.credentials,
      }));
    },
    readLegacySesBag: (row) => {
      const creds = readIntegrationCredentials<{
        accessKeyId?: string;
        secretAccessKey?: string;
        region?: string;
        fromEmail?: string;
        fromName?: string;
      }>({ credentials: row.credentials }, row.organizationId, "aws_ses backfill");
      // Reuse the vault parser's both-fields gate so a bag the reader
      // would reject is reported incomplete here, never migrated.
      return parseSesVaultCredential(creds ? JSON.stringify(creds) : null);
    },
    getVaultCredential: (organizationId) =>
      getByokCredential({ organizationId, channel: "ses" }, { touchLastUsed: false }),
    setVaultCredential: async (organizationId, plaintext) => {
      await setByokCredential({ organizationId, channel: "ses", plaintext });
    },
  };
}
