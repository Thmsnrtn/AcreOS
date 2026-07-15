/**
 * Data-provider BYOK helpers — R1d (BYO data keys, 2026-07-15).
 *
 * The reshape doctrine (docs/company/home-base-reshape.md): the customer
 * connects their own property-data vendor account, and AcreOS routes the
 * lookup through it. When a customer key serves a lookup the CUSTOMER pays
 * their vendor directly — platform COGS is $0 and the AcreOS credit pool is
 * never debited. Same billing rule as the AI-channel BYOK path (aiByok.ts).
 *
 * This is the canonical resolver the provider registry consults. It answers
 * two questions:
 *   getConnectedDataProviders(orgId) → cheap presence set of provider NAMES
 *                                      the org holds a data key for (no
 *                                      decrypt) — used for the affordability
 *                                      gate and the pool-bypass decision.
 *   resolveDataProviderKey(orgId, providerName) → the decrypted customer key
 *                                      for that provider, or null (falls back
 *                                      to the platform key). Decrypts only
 *                                      when actually about to hit the vendor.
 *
 * SECURITY: the decrypted key is returned only to the provider adapter that
 * makes the outbound call. It must NEVER be logged, serialized, or included
 * in any error/telemetry payload. Log provider names / channels only.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { byokCredentials, type ByokChannel } from "@shared/schema";
import { getByokCredential } from "./key-vault";
import { logger } from "../../utils/logger";

/**
 * Map a registry provider `name` onto the BYOK channel its key is stored
 * under. BatchData's property lookups reuse the existing "batch_skiptracing"
 * channel — one BatchData key unlocks both skip-trace and property lookups.
 * ATTOM and Regrid each have their own channel. Providers absent from this
 * map (all open-data / federal sources) never BYOK-resolve and always fall
 * through to the platform path.
 */
export const DATA_BYOK_CHANNEL_FOR_PROVIDER: Readonly<Record<string, ByokChannel>> = {
  batchdata: "batch_skiptracing",
  attom: "attom",
  regrid: "regrid",
};

/** The channels that count as data-provider BYOK (for the presence query). */
const DATA_BYOK_CHANNELS = Array.from(
  new Set(Object.values(DATA_BYOK_CHANNEL_FOR_PROVIDER)),
) as ByokChannel[];

/** Reverse map: channel → the provider names it satisfies. */
const PROVIDERS_FOR_CHANNEL: Readonly<Record<string, readonly string[]>> = (() => {
  const out: Record<string, string[]> = {};
  for (const [provider, channel] of Object.entries(DATA_BYOK_CHANNEL_FOR_PROVIDER)) {
    (out[channel] ??= []).push(provider);
  }
  return out;
})();

/**
 * Cheapest possible check: which data-provider NAMES does this org hold an
 * active BYOK key for? One indexed query, no decryption. The registry calls
 * this once per lookup to decide (a) whether a paid provider is affordable
 * even with an empty pool and (b) whether to skip the pool debit.
 */
export async function getConnectedDataProviders(
  organizationId: number,
): Promise<Set<string>> {
  const providers = new Set<string>();
  try {
    const rows = await db
      .select({ channel: byokCredentials.channel })
      .from(byokCredentials)
      .where(
        and(
          eq(byokCredentials.organizationId, organizationId),
          inArray(byokCredentials.channel, DATA_BYOK_CHANNELS),
          isNull(byokCredentials.revokedAt),
        ),
      );
    for (const row of rows) {
      for (const name of PROVIDERS_FOR_CHANNEL[row.channel] ?? []) {
        providers.add(name);
      }
    }
  } catch (err) {
    // Presence check must never break a lookup — degrade to "no BYOK", which
    // preserves the platform path exactly as it behaved before R1d.
    logger.warn(
      `[data-byok] presence check failed for org=${organizationId} — treating as no BYOK`,
      err instanceof Error ? err : undefined,
    );
  }
  return providers;
}

/**
 * Resolve the decrypted customer key for a specific data provider, or null
 * when the org has no active key for it (or decryption failed — in which
 * case the caller falls back to the platform key rather than erroring the
 * lookup). Only called when getConnectedDataProviders already reported the
 * provider present, so the decrypt is not wasted.
 */
export async function resolveDataProviderKey(
  organizationId: number,
  providerName: string,
): Promise<string | null> {
  const channel = DATA_BYOK_CHANNEL_FOR_PROVIDER[providerName];
  if (!channel) return null;

  const key = await getByokCredential({ organizationId, channel }).catch(() => null);
  if (!key) {
    logger.warn(
      `[data-byok] active ${channel} credential for org=${organizationId} failed to resolve — falling back to platform key`,
    );
    return null;
  }
  return key;
}
