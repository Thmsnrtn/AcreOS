/**
 * ALTA Pillar 2 — Wire Fraud Prevention.
 *
 * Title agents issue wire instructions when closing approaches. ALTA Pillar 2
 * ("Title Insurance & Settlement Company Best Practices — Wire Fraud
 * Prevention") requires three controls before funds move:
 *
 *   1. **Out-of-band confirmation** — the customer must call the title
 *      agent at a previously-verified phone number to confirm wire details
 *      before sending. The phone is rendered in the customer UI alongside
 *      a confirmation log.
 *
 *   2. **Encrypted PDF delivery** — wire instructions are delivered as a
 *      password-protected PDF; the password is delivered out-of-band (SMS
 *      to the customer's verified phone, separately from the email that
 *      carries the PDF). Only a *hint* (last 4 of the destination phone)
 *      is stored in the DB — never the password itself.
 *
 *   3. **Signed payload** — the encrypted PDF is HMAC-SHA256 signed by the
 *      partner using their per-partner shared secret. The signature is
 *      written onto the title_orders row alongside the S3 key, so any
 *      downstream consumer can verify the bytes haven't been swapped.
 *
 * This module deliberately does NOT generate the PDF itself or upload to
 * S3 — those concerns live in the partner integration layer / a future
 * pdf-render worker. It does generate the password (cryptographically
 * random, 12 chars, mixed-case + digits), produces the HMAC signature
 * over a canonicalised payload, and writes the resulting metadata onto
 * the title_orders row.
 *
 * Fail-closed semantics: if the partner has no hmac_secret_encrypted
 * stored, issueWireInstructions throws — we will not produce an
 * unsigned wire instruction surface.
 */

import crypto from "crypto";
import { db } from "../db";
import { titleOrders, titlePartners } from "@shared/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { decrypt } from "./fieldEncryption";
import { logger } from "../utils/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WireInstructionsPayload {
  /**
   * Bank routing details. The PDF render layer is responsible for laying
   * these out per the partner's branded template; this module only signs
   * the canonical JSON.
   */
  bankName: string;
  routingNumber: string;
  accountNumber: string;
  accountHolder: string;
  reference: string;
  amount: string; // numeric string, e.g. "125000.00"
  // Phone the customer MUST call to confirm before sending funds.
  confirmationPhone: string;
}

export interface IssuedWireInstructions {
  encryptedPdfS3Key: string;
  /**
   * The plaintext password — returned ONCE so the caller can deliver it to
   * the customer out-of-band via SMS. NEVER persisted in the database; only
   * a hint (last 4 of destination phone) is stored.
   */
  password: string;
  hmacSignature: string;
}

// ─── Password generation ─────────────────────────────────────────────────────

const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // no 0/O/1/I/l
const PASSWORD_LENGTH = 12;

function generatePassword(): string {
  const bytes = crypto.randomBytes(PASSWORD_LENGTH);
  let out = "";
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  return out;
}

// ─── HMAC signing ────────────────────────────────────────────────────────────

/**
 * Canonicalise a wire-instructions payload for HMAC signing. We sort keys
 * alphabetically so the signature is stable regardless of object property
 * order.
 */
function canonicalise(payload: WireInstructionsPayload): string {
  const keys = Object.keys(payload).sort();
  const ordered: Record<string, string> = {};
  for (const k of keys) {
    ordered[k] = (payload as unknown as Record<string, string>)[k];
  }
  return JSON.stringify(ordered);
}

export function signWireInstructions(
  payload: WireInstructionsPayload,
  encryptedPdfS3Key: string,
  hmacSecret: string
): string {
  if (!hmacSecret) {
    throw new Error("[wireInstructions] HMAC secret missing — cannot sign");
  }
  const message = `${canonicalise(payload)}\n${encryptedPdfS3Key}`;
  return crypto.createHmac("sha256", hmacSecret).update(message).digest("hex");
}

/**
 * Verify a previously-issued HMAC signature. Used by the customer-facing
 * surface to assert that the encrypted PDF and the metadata it was issued
 * with haven't been altered post-hoc.
 */
export function verifyWireInstructionsSignature(
  payload: WireInstructionsPayload,
  encryptedPdfS3Key: string,
  hmacSecret: string,
  signature: string
): boolean {
  if (!hmacSecret) return false;
  const expected = signWireInstructions(payload, encryptedPdfS3Key, hmacSecret);
  // constant-time compare
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─── Phone hint (no PII leak) ────────────────────────────────────────────────

function passwordHint(destinationPhone: string): string {
  const digits = destinationPhone.replace(/\D/g, "");
  const last4 = digits.slice(-4) || "----";
  return `Password sent by SMS to phone ending in ${last4}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Issue wire instructions for a title order, PINNED TO THE OWNING ORG.
 *
 * Side-effects:
 *   - Writes wire_instructions_pdf_s3_key, wire_instructions_password_hint,
 *     wire_instructions_hmac, wire_confirmation_phone,
 *     wire_instructions_issued_at onto the title_orders row.
 *   - Advances order status to "wire_instructions_issued".
 *
 * Returns the password ONCE so the caller can SMS it to the customer
 * out-of-band; the password is never persisted.
 *
 * Fails closed if the routing partner has no hmac_secret_encrypted.
 *
 * TENANCY (2026-08-16). Until now this resolved the order by bare primary key,
 * decrypted the routing partner's HMAC secret, and wrote the S3 key, signature
 * and out-of-band confirmation PHONE back by bare primary key. On the wire
 * rail, a wrong-tenant write of `wire_confirmation_phone` is the exact control
 * ALTA Pillar 2 exists to protect — it is the number the customer is told to
 * call before sending funds. `title_orders.organization_id` is NOT NULL and
 * leads the table's index, so both the read and the write now carry it and a
 * cross-tenant orderId resolves to "not found" by construction.
 *
 * `title_partners.organization_id` is NULLABLE by design — NULL means the
 * platform-default partner any org may route to — so the partner predicate is
 * "this org's own partner OR the platform default", not a flat equality. A
 * partner privately owned by another tenant is refused rather than having its
 * HMAC secret decrypted.
 */
export async function issueWireInstructions(
  organizationId: number,
  orderId: number,
  instructions: WireInstructionsPayload,
  destinationPhoneForPasswordSms: string
): Promise<IssuedWireInstructions> {
  const [order] = await db
    .select()
    .from(titleOrders)
    .where(
      and(
        eq(titleOrders.id, orderId),
        eq(titleOrders.organizationId, organizationId)
      )
    )
    .limit(1);

  if (!order) {
    throw new Error(`[wireInstructions] title_order ${orderId} not found`);
  }

  if (!order.titlePartnerId) {
    throw new Error(
      `[wireInstructions] title_order ${orderId} has no assigned partner — cannot sign`
    );
  }

  const [partner] = await db
    .select()
    .from(titlePartners)
    .where(
      and(
        eq(titlePartners.id, order.titlePartnerId),
        or(
          isNull(titlePartners.organizationId),
          eq(titlePartners.organizationId, organizationId)
        )
      )
    )
    .limit(1);

  if (!partner) {
    throw new Error(
      `[wireInstructions] partner ${order.titlePartnerId} not found for order ${orderId}`
    );
  }

  if (!partner.hmacSecretEncrypted) {
    // Fail closed — never issue an unsigned wire instruction surface.
    throw new Error(
      `[wireInstructions] partner ${partner.id} has no HMAC secret on record — refusing to issue`
    );
  }

  let hmacSecret: string;
  try {
    hmacSecret = decrypt(partner.hmacSecretEncrypted);
  } catch (err) {
    logger.error(
      `[wireInstructions] failed to decrypt HMAC secret for partner ${partner.id}`,
      err instanceof Error ? err : undefined
    );
    throw new Error("[wireInstructions] HMAC secret decrypt failed");
  }

  if (!hmacSecret) {
    throw new Error("[wireInstructions] HMAC secret empty after decrypt");
  }

  // The encrypted PDF lives on the shared exchange bucket; the
  // pdf-render worker writes it under this canonical key.
  const encryptedPdfS3Key = `title-orders/${order.id}/wire-instructions-${Date.now()}.pdf.enc`;
  const password = generatePassword();
  const hmacSignature = signWireInstructions(
    instructions,
    encryptedPdfS3Key,
    hmacSecret
  );

  await db
    .update(titleOrders)
    .set({
      wireInstructionsPdfS3Key: encryptedPdfS3Key,
      wireInstructionsPasswordHint: passwordHint(destinationPhoneForPasswordSms),
      wireInstructionsHmac: hmacSignature,
      wireConfirmationPhone: instructions.confirmationPhone,
      wireInstructionsIssuedAt: new Date(),
      status: "wire_instructions_issued",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(titleOrders.id, order.id),
        eq(titleOrders.organizationId, organizationId)
      )
    );

  logger.info(
    `[wireInstructions] issued for order=${order.id} partner=${partner.id} s3Key=${encryptedPdfS3Key}`
  );

  return {
    encryptedPdfS3Key,
    password,
    hmacSignature,
  };
}

/**
 * Mark a wire-instruction surface as out-of-band confirmed by the customer,
 * PINNED TO THE OWNING ORG.
 *
 * TENANCY (2026-08-16). This had NO CALLER anywhere in the repo — it was a
 * loaded gun with no trigger, not a live leak, and it is fixed on those terms:
 * the danger is the first caller, who would have wired a URL segment straight
 * into a bare-PK UPDATE on the wire rail. `wire_confirmed_at` is the flag that
 * says a human called the number back and heard the account details read
 * aloud; setting it on ANOTHER tenant's order is a forged attestation on the
 * one control standing between a title order and a misdirected wire.
 *
 * Giving it the org parameter NOW means the first caller cannot compile
 * without deciding whose order it is, rather than discovering the question
 * after the funds have moved. `title_orders.organization_id` is NOT NULL, so
 * a cross-tenant orderId matches no row and the UPDATE is a no-op.
 */
export async function recordWireConfirmation(
  organizationId: number,
  orderId: number
): Promise<void> {
  await db
    .update(titleOrders)
    .set({
      wireConfirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(titleOrders.id, orderId),
        eq(titleOrders.organizationId, organizationId)
      )
    );
  logger.info(
    `[wireInstructions] confirmation recorded for order=${orderId} org=${organizationId}`
  );
}
