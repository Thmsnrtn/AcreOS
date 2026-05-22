/**
 * BYOK Key Vault — store/retrieve/revoke customer-supplied provider keys.
 *
 * Universal BYOK (2026-05-22). Extends BYOK from data providers to every
 * paid channel (Twilio, Telnyx, SendGrid, SES, Lob, PostGrid, OpenRouter,
 * Anthropic, OpenAI, BatchSkipTracing, Mapbox, S3).
 *
 * Encryption: delegates to the canonical
 * server/services/fieldEncryption.ts (AES-256-GCM, envelope
 * "enc:v1:<base64>"). We store the envelope as bytea so dump tools that
 * print TEXT columns don't accidentally leak it into log streams.
 *
 * Invariants enforced at this layer:
 *   - Plaintext is NEVER logged. Errors include only the fingerprint
 *     suffix.
 *   - At most one active (non-revoked) credential per (org, channel).
 *     setByokCredential() revokes the prior active row in the same
 *     transaction as the insert.
 *   - All mutations write to founder_audit with redacted detail.
 */

import { db } from "../../db";
import { byokCredentials, type ByokChannel } from "@shared/schema";
import { and, eq, isNull, desc } from "drizzle-orm";
import { encrypt, decrypt } from "../fieldEncryption";
import { logger } from "../../utils/logger";
import { founderAudit } from "../founderAuditService";

export interface SetByokCredentialArgs {
  organizationId: number;
  channel: ByokChannel;
  plaintext: string;
}

export interface ByokCredentialMetadata {
  channel: string;
  fingerprint: string;
  createdAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Compute the non-secret fingerprint shown in UI ("...x4az"). Last four
 * plaintext chars are enough for "did I just paste the right key?" without
 * being sufficient to derive the rest. Returns "****" for keys ≤ 4 chars.
 */
function computeFingerprint(plaintext: string): string {
  if (!plaintext || plaintext.length <= 4) return "****";
  return plaintext.slice(-4);
}

/**
 * Encrypt + upsert a customer-supplied credential for (org, channel).
 * Revokes any prior active row in the same transaction so the partial
 * UNIQUE index never sees two non-revoked rows.
 *
 * Posts a founder_audit row with ONLY the fingerprint. NEVER the
 * plaintext or the ciphertext.
 */
export async function setByokCredential(args: SetByokCredentialArgs): Promise<ByokCredentialMetadata> {
  const { organizationId, channel, plaintext } = args;
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("[byok] plaintext credential must be a non-empty string");
  }

  const fingerprint = computeFingerprint(plaintext);
  const envelope = encrypt(plaintext);
  // Persist as bytea — the envelope is utf-8-safe, so a Buffer.from is exact.
  const cipherBytes = Buffer.from(envelope, "utf8");

  // Two-step transaction: revoke prior active row(s) → insert new active row.
  // Done inside db.transaction so the partial-unique index never sees two
  // non-revoked rows for the same (org, channel) pair.
  const inserted = await db.transaction(async (tx) => {
    await tx
      .update(byokCredentials)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(byokCredentials.organizationId, organizationId),
          eq(byokCredentials.channel, channel),
          isNull(byokCredentials.revokedAt),
        ),
      );

    const [row] = await tx
      .insert(byokCredentials)
      .values({
        organizationId,
        channel,
        credentialKeyEncrypted: cipherBytes,
        credentialKeyFingerprint: fingerprint,
      })
      .returning();
    return row;
  });

  // Best-effort audit. Never throws.
  founderAudit
    .log({
      category: "security_event",
      severity: "info",
      action: "byok.set",
      description: `BYOK credential set for channel=${channel} (fingerprint=...${fingerprint})`,
      organizationId,
      metadata: { channel, fingerprint },
    })
    .catch(() => {});

  return {
    channel: inserted.channel,
    fingerprint: inserted.credentialKeyFingerprint,
    createdAt: inserted.createdAt,
    lastUsedAt: inserted.lastUsedAt,
    revokedAt: inserted.revokedAt,
  };
}

/**
 * Decrypt the active credential for (org, channel). Returns null when no
 * active credential exists. Updates last_used_at on hit.
 *
 * IMPORTANT: callers must NEVER log the returned plaintext.
 */
export async function getByokCredential(args: {
  organizationId: number;
  channel: ByokChannel;
}): Promise<string | null> {
  const { organizationId, channel } = args;

  const [row] = await db
    .select()
    .from(byokCredentials)
    .where(
      and(
        eq(byokCredentials.organizationId, organizationId),
        eq(byokCredentials.channel, channel),
        isNull(byokCredentials.revokedAt),
      ),
    )
    .orderBy(desc(byokCredentials.createdAt))
    .limit(1);

  if (!row) return null;

  // bytea round-trips as Buffer via node-postgres. Some drivers (Neon HTTP)
  // may return a string — guard both shapes.
  const envelope = Buffer.isBuffer(row.credentialKeyEncrypted)
    ? row.credentialKeyEncrypted.toString("utf8")
    : String(row.credentialKeyEncrypted);

  let plaintext: string;
  try {
    plaintext = decrypt(envelope);
  } catch (err) {
    logger.error(
      `[byok] decrypt failed for org=${organizationId} channel=${channel} fingerprint=...${row.credentialKeyFingerprint}`,
      err,
    );
    return null;
  }

  // Fire-and-forget lastUsedAt bump.
  db
    .update(byokCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(byokCredentials.id, row.id))
    .catch(() => {});

  return plaintext;
}

/**
 * Revoke the currently-active credential for (org, channel). No-op if no
 * active row exists. Audit-logged.
 */
export async function revokeByokCredential(args: {
  organizationId: number;
  channel: ByokChannel;
}): Promise<boolean> {
  const { organizationId, channel } = args;
  const result = await db
    .update(byokCredentials)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(byokCredentials.organizationId, organizationId),
        eq(byokCredentials.channel, channel),
        isNull(byokCredentials.revokedAt),
      ),
    )
    .returning({ id: byokCredentials.id, fingerprint: byokCredentials.credentialKeyFingerprint });

  const revoked = result.length > 0;
  if (revoked) {
    founderAudit
      .log({
        category: "security_event",
        severity: "info",
        action: "byok.revoke",
        description: `BYOK credential revoked for channel=${channel} (fingerprint=...${result[0].fingerprint})`,
        organizationId,
        metadata: { channel, fingerprint: result[0].fingerprint },
      })
      .catch(() => {});
  }
  return revoked;
}

/**
 * List BYOK credential metadata for an org. NEVER returns plaintext.
 * Returns one row per (channel, lifecycle-instance) — includes revoked
 * rows so the UI can show "key X revoked 3 days ago" history.
 */
export async function listByokCredentials(organizationId: number): Promise<ByokCredentialMetadata[]> {
  const rows = await db
    .select({
      channel: byokCredentials.channel,
      fingerprint: byokCredentials.credentialKeyFingerprint,
      createdAt: byokCredentials.createdAt,
      lastUsedAt: byokCredentials.lastUsedAt,
      revokedAt: byokCredentials.revokedAt,
    })
    .from(byokCredentials)
    .where(eq(byokCredentials.organizationId, organizationId))
    .orderBy(desc(byokCredentials.createdAt));

  return rows;
}
