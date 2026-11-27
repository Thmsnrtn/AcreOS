/**
 * Lob credential backfill — Stage 2 of the credential-consolidation plan
 * (docs/company/credential-consolidation-plan.md), Lob portion (P9-2b).
 *
 * Copies each org's legacy organizationIntegrations lob apiKey into the
 * canonical byok vault via setByokCredential. Both stores encrypt through the
 * shared fieldEncryption keyring, so this is a re-encrypt: the legacy row is
 * read through readIntegrationCredentials (which handles BOTH stored shapes —
 * the sealed envelope and the legacy plaintext field) and the plaintext is
 * sealed again under the vault envelope. Reading `credentials.encrypted`
 * directly would strand plaintext-shaped rows; this module never does that.
 *
 * Rules (plan Stage 2):
 *   - Never overwrite an existing active vault credential.
 *   - Legacy rows are left intact (deletion is Stage 4, a founder hard-stop).
 *   - Disabled legacy rows are NOT backfilled: the vault has no enabled flag,
 *     so copying a disabled key would silently activate it.
 *   - Idempotent: a second run copies nothing (every copied org then has a
 *     vault row and is counted as alreadyInVault).
 *   - Counts only — credential values and fingerprints are never returned,
 *     logged, or included in the report.
 *
 * Mirrors regridBackfill.ts (P9-2a) exactly, provider-swapped.
 */

export interface LobLegacyRow {
  organizationId: number;
  isEnabled: boolean;
  credentials: unknown;
}

export interface LobBackfillDeps {
  listLegacyLobRows: () => Promise<LobLegacyRow[]>;
  readLegacyApiKey: (row: LobLegacyRow) => string | null;
  getVaultCredential: (organizationId: number) => Promise<string | null>;
  setVaultCredential: (organizationId: number, plaintext: string) => Promise<void>;
}

export interface LobBackfillReport {
  scanned: number;
  withLegacyKey: number;
  alreadyInVault: number;
  copied: number;
  wouldCopy: number;
  skippedNoKey: number;
  skippedDisabled: number;
}

export async function backfillLobCredentials(
  deps: LobBackfillDeps,
  opts: { write: boolean },
): Promise<LobBackfillReport> {
  const report: LobBackfillReport = {
    scanned: 0,
    withLegacyKey: 0,
    alreadyInVault: 0,
    copied: 0,
    wouldCopy: 0,
    skippedNoKey: 0,
    skippedDisabled: 0,
  };

  const rows = await deps.listLegacyLobRows();
  for (const row of rows) {
    report.scanned += 1;
    if (!row.isEnabled) {
      report.skippedDisabled += 1;
      continue;
    }
    const apiKey = deps.readLegacyApiKey(row);
    if (!apiKey) {
      report.skippedNoKey += 1;
      continue;
    }
    report.withLegacyKey += 1;
    const existing = await deps.getVaultCredential(row.organizationId);
    if (existing) {
      report.alreadyInVault += 1;
      continue;
    }
    if (opts.write) {
      await deps.setVaultCredential(row.organizationId, apiKey);
      report.copied += 1;
    } else {
      report.wouldCopy += 1;
    }
  }
  return report;
}

/** Production wiring: legacy rows from organizationIntegrations, vault via key-vault. */
export async function defaultLobBackfillDeps(): Promise<LobBackfillDeps> {
  const { db } = await import("../../db");
  const { organizationIntegrations } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { readIntegrationCredentials } = await import("../integrationCredentials");
  const { getByokCredential, setByokCredential } = await import("../byok/key-vault");

  return {
    listLegacyLobRows: async () => {
      const rows = await db
        .select()
        .from(organizationIntegrations)
        .where(eq(organizationIntegrations.provider, "lob"));
      return rows.map((r) => ({
        organizationId: r.organizationId,
        isEnabled: !!r.isEnabled,
        credentials: r.credentials,
      }));
    },
    readLegacyApiKey: (row) => {
      const creds = readIntegrationCredentials<{ apiKey?: string }>(
        { credentials: row.credentials },
        row.organizationId,
        "lob backfill",
      );
      return creds?.apiKey ?? null;
    },
    getVaultCredential: (organizationId) =>
      getByokCredential({ organizationId, channel: "lob" }, { touchLastUsed: false }),
    setVaultCredential: async (organizationId, plaintext) => {
      await setByokCredential({ organizationId, channel: "lob", plaintext });
    },
  };
}
