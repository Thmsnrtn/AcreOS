/**
 * Data-API partner keys (roadmap W1.6 — security hardening).
 *
 * BEFORE: keys were minted `ak_` + base64(Math.random()) — a single
 * non-CSPRNG call, low predictable entropy — then stored and compared as
 * PLAINTEXT, so one table read disclosed every live partner credential.
 *
 * NOW:
 *   • generation: crypto.randomBytes(32), base64url — 256 bits of real
 *     entropy behind the `ak_` prefix;
 *   • at rest: SHA-256 hex only (key_hash) + last4 for display. The
 *     plaintext exists exactly once, in the create response;
 *   • verification: hash the PRESENTED key and look the hash up — the
 *     lookup key is derived from the caller's input, so no stored secret
 *     participates in a byte-by-byte comparison;
 *   • migration: legacy plaintext rows verify via equality ONCE, then are
 *     upgraded in place (hash written, plaintext nulled) so the legacy
 *     window closes itself with use.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { systemApiKeys } from "@shared/schema";
import { logger } from "../utils/logger";

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function generateApiKey(): { plaintext: string; hash: string; last4: string } {
  const plaintext = `ak_${randomBytes(32).toString("base64url")}`;
  return { plaintext, hash: hashApiKey(plaintext), last4: plaintext.slice(-4) };
}

export interface VerifiedApiKey {
  id: number;
  provider: string;
}

/**
 * Verify a presented key against active rows. Hash-first; legacy plaintext
 * fallback upgrades the row in place. Returns null on no match. Never throws.
 */
export async function verifyApiKey(presented: string): Promise<VerifiedApiKey | null> {
  if (!presented || presented.length < 8) return null;
  try {
    const hash = hashApiKey(presented);
    const [byHash] = await db
      .select({ id: systemApiKeys.id, provider: systemApiKeys.provider })
      .from(systemApiKeys)
      .where(and(eq(systemApiKeys.keyHash, hash), eq(systemApiKeys.isActive, true)))
      .limit(1);
    if (byHash) return byHash;

    // Legacy plaintext row — verify once, then upgrade in place so the
    // plaintext leaves the database.
    const [legacy] = await db
      .select({ id: systemApiKeys.id, provider: systemApiKeys.provider })
      .from(systemApiKeys)
      .where(and(eq(systemApiKeys.apiKey, presented), eq(systemApiKeys.isActive, true)))
      .limit(1);
    if (legacy) {
      try {
        await db
          .update(systemApiKeys)
          .set({ keyHash: hash, keyLast4: presented.slice(-4), apiKey: null, updatedAt: new Date() })
          .where(eq(systemApiKeys.id, legacy.id));
        logger.warn(`[dataApiKeys] legacy plaintext key #${legacy.id} upgraded to hash-at-rest on use`);
      } catch (err) {
        logger.warn(
          `[dataApiKeys] legacy key upgrade failed (auth still granted): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return legacy;
    }
    return null;
  } catch (err) {
    logger.error("[dataApiKeys] verification errored — refusing", err instanceof Error ? err : undefined);
    return null;
  }
}
