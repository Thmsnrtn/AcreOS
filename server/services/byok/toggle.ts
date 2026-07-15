/**
 * BYOK toggle/resolution helpers.
 *
 * Two thin entry points that every provider adapter + every ledger-post
 * site uses to ask "does this org have a BYOK credential for this channel?":
 *
 *   isByokEnabled(orgId, channel)  → boolean
 *   getEffectiveCredential(orgId, channel)
 *                                  → { source: 'byok'|'platform', credential|null }
 *
 * Crucial billing rule: when source === 'byok', the customer pays the
 * provider directly. Caller MUST NOT debit our opex bucket for that
 * spend — see postOpexSpent call-sites that guard on isByokEnabled().
 */

import { db } from "../../db";
import { byokCredentials, type ByokChannel } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getByokCredential } from "./key-vault";

/**
 * Map of channel → env-var name the platform default reads from. Used by
 * getEffectiveCredential() in fallback-to-platform mode.
 *
 * For multi-secret channels (Twilio = sid + token + phone, S3 = key id +
 * secret + bucket, etc.) we expose the canonical "primary" secret here;
 * the channel-specific adapter is still responsible for assembling the
 * full creds tuple. The toggle helper exists for the "is there any
 * BYOK?" decision and the simple single-secret channels.
 */
const PLATFORM_ENV_MAP: Record<ByokChannel, string | null> = {
  twilio: "TWILIO_AUTH_TOKEN",
  telnyx: "TELNYX_API_KEY",
  sendgrid: "SENDGRID_API_KEY",
  ses: "AWS_ACCESS_KEY_ID",
  lob: "LOB_LIVE_API_KEY",
  postgrid: "POSTGRID_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  batch_skiptracing: "BATCH_SKIP_TRACING_API_KEY",
  mapbox: "MAPBOX_ACCESS_TOKEN",
  s3: "AWS_ACCESS_KEY_ID",
  // R1d BYO-data-keys — property-data providers (platform fallback keys).
  attom: "ATTOM_API_KEY",
  regrid: "REGRID_API_KEY",
};

/**
 * Cheap existence check — does this org have a non-revoked BYOK
 * credential for this channel? Doesn't decrypt anything.
 */
export async function isByokEnabled(
  organizationId: number,
  channel: ByokChannel,
): Promise<boolean> {
  const [row] = await db
    .select({ id: byokCredentials.id })
    .from(byokCredentials)
    .where(
      and(
        eq(byokCredentials.organizationId, organizationId),
        eq(byokCredentials.channel, channel),
        isNull(byokCredentials.revokedAt),
      ),
    )
    .limit(1);
  return !!row;
}

export interface EffectiveCredential {
  source: "byok" | "platform";
  credential: string | null;
}

/**
 * Resolve the effective credential for (org, channel). Prefers BYOK; falls
 * back to the platform env var. Returns { credential: null } if neither
 * exists.
 *
 * NEVER log the credential field of the return value.
 */
export async function getEffectiveCredential(
  organizationId: number,
  channel: ByokChannel,
): Promise<EffectiveCredential> {
  const byok = await getByokCredential({ organizationId, channel }).catch(() => null);
  if (byok) {
    return { source: "byok", credential: byok };
  }
  const envName = PLATFORM_ENV_MAP[channel];
  const platform = envName ? process.env[envName] ?? null : null;
  return { source: "platform", credential: platform };
}
