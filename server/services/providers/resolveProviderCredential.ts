/**
 * resolveProviderCredential — the single vault-first credential read.
 *
 * AcreOS still holds per-org provider keys in two stores: the canonical
 * byok_credentials vault (what the connectors hub writes) and the legacy
 * organizationIntegrations table (what ~30 older modules read). Some providers
 * read only one, so a key connected in the hub can be silently ignored by code
 * that only checks legacy (regrid was exactly this bug).
 *
 * This resolver is Stage 1 of the credential-vault consolidation
 * (docs/company/credential-consolidation-plan.md): one read path, vault first,
 * legacy fallback. It returns the RAW decrypted secret (a single string) or
 * null — the caller keeps its own platform/env fallback and interprets the
 * secret (a single key, or a JSON tuple it parses). Nothing here writes,
 * deletes, or retires the legacy store; the flip to vault-only is a later,
 * founder-gated stage.
 */

import type { ByokChannel } from "@shared/schema";
import { getByokCredential } from "../byok/key-vault";
import { logger } from "../../utils/logger";

export interface ResolveCredentialOpts {
  /** Canonical vault channel (what the connectors hub writes). */
  channel: ByokChannel;
  /** Legacy organizationIntegrations provider key. */
  legacyProvider: string;
  /** Field to pull out of the decrypted legacy JSON blob (e.g. "apiKey"). */
  legacyField: string;
}

/**
 * Resolve a provider secret for an org: canonical vault first, legacy
 * organizationIntegrations second. Returns the raw decrypted secret string, or
 * null when neither store has an active credential. Fail-soft: a read error in
 * either store logs and falls through rather than throwing.
 */
export async function resolveProviderCredential(
  organizationId: number,
  opts: ResolveCredentialOpts,
): Promise<string | null> {
  // 1. Canonical vault — a key connected through the connectors hub wins.
  try {
    const vaultSecret = await getByokCredential({ organizationId, channel: opts.channel });
    if (vaultSecret) return vaultSecret;
  } catch (err) {
    logger.warn(
      `[resolveProviderCredential] vault read failed (channel=${opts.channel})`,
      err instanceof Error ? err : undefined,
    );
  }

  // 2. Legacy organizationIntegrations — decrypt the JSON blob, pull the field.
  try {
    const { storage } = await import("../../storage");
    const integration = await storage.getOrganizationIntegration(organizationId, opts.legacyProvider);
    if (integration?.isEnabled) {
      const { readIntegrationCredentials } = await import("../integrationCredentials");
      // Either stored shape. This read looked only for an envelope, so a key
      // set through the BYOK panel in Settings — stored in the clear — was
      // invisible to the canonical resolver and every provider behind it.
      const creds = readIntegrationCredentials<Record<string, string>>(
        integration,
        organizationId,
        `legacy ${opts.legacyProvider}`,
      );
      const value = creds?.[opts.legacyField];
      if (value) return value;
    }
  } catch (err) {
    logger.warn(
      `[resolveProviderCredential] legacy read failed (provider=${opts.legacyProvider})`,
      err instanceof Error ? err : undefined,
    );
  }

  return null;
}
