/**
 * Owner suppression — the platform-wide "stop contacting me" list (W5a).
 *
 * A property owner who asks AcreOS to stop contacting them (the public opt-out
 * form, server/routes-owner-optout.ts) becomes, once verified, a suppression
 * that EVERY outreach path honours for EVERY org: mail, email, SMS, voice,
 * skip-trace and list import. The population of those paths is enumerated in
 * tests/unit/ownerSuppressionEverySendPath.test.ts — a new vendor call that does
 * not reach a guard here fails that test.
 *
 * Three guards, one per shape of send path:
 *   - `assertOwnerContactAllowed` THROWS `OwnerSuppressedError` (a
 *     ProviderNotContactedError: nothing left the process) — for paths whose
 *     failure contract is an exception (mail, skip-trace, voice, mailbox).
 *   - `ownerContactRefusal` RETURNS the refusal text, or null — for paths that
 *     report failure as a value (emailService, the SMS router).
 *   - `stampOwnerSuppression` MARKS lead rows about to be inserted
 *     (do_not_contact + opt-out date) — the list-import path, which must keep
 *     the org's row but never let it be contacted.
 *
 * FAIL CLOSED: a suppression lookup that errors refuses the send. A request
 * that could not be checked is not a request that passed.
 *
 * Only keyed hashes are stored (HMAC-SHA256 under OWNER_SUPPRESSION_HASH_KEY);
 * this module never writes a plaintext identifier anywhere.
 */
import { createHmac } from "node:crypto";
import { and, inArray, eq, or } from "drizzle-orm";
import { db } from "../../db";
import { ownerSuppressions } from "@shared/schema";
import {
  normalizeEmail,
  normalizedOwnerIdentifiers,
  type OwnerIdentifierKind,
  type OwnerIdentifiers,
} from "@shared/trust/ownerIdentifiers";
import { ProviderNotContactedError } from "../actions/outwardAction";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";

export type OwnerContactChannel = "mail" | "email" | "sms" | "voice" | "skip_trace" | "list_import";

/**
 * The hash keys. A deployment should set OWNER_SUPPRESSION_HASH_KEY once.
 *
 * EVERY KEY EVER USED KEEPS MATCHING. A suppression is stored under the key in
 * force when it was recorded, and an opted-out owner must stay opted out when
 * the key changes — otherwise setting the real key (or rotating it) silently
 * un-suppresses everyone recorded before, and they are contacted again. So:
 *   - new hashes are written under the PRIMARY key (the configured one, else
 *     the built-in one);
 *   - lookups compare against hashes under EVERY key: the primary, any listed
 *     in OWNER_SUPPRESSION_PREVIOUS_HASH_KEYS (comma-separated, for a
 *     rotation), and always the built-in key — which every deployment used
 *     until OWNER_SUPPRESSION_HASH_KEY was set.
 * Without a configured key the hash still never stores the identifier, but it
 * is only as strong as an unkeyed SHA-256 of a phone number — the log says so.
 */
const BUILT_IN_LEGACY_KEY = "acreos-owner-suppression-v1";
let warnedFallback = false;
function primaryHashKey(): string {
  const k = process.env.OWNER_SUPPRESSION_HASH_KEY;
  if (k && k.length >= 16) return k;
  if (!warnedFallback) {
    warnedFallback = true;
    logger.warn("[ownerSuppression] OWNER_SUPPRESSION_HASH_KEY is unset; identifier hashes use the built-in key", {
      metadata: { kind: "founder_config" },
    });
  }
  return BUILT_IN_LEGACY_KEY;
}

/** Primary first, then every earlier key (previous keys, then the built-in one). Deduplicated. */
function ownerSuppressionMatchKeys(): string[] {
  const previous = (process.env.OWNER_SUPPRESSION_PREVIOUS_HASH_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  return Array.from(new Set([primaryHashKey(), ...previous, BUILT_IN_LEGACY_KEY]));
}

function hmac(key: string, kind: OwnerIdentifierKind, normalizedValue: string): string {
  return createHmac("sha256", key).update(`${kind}:${normalizedValue}`).digest("hex");
}

/** Keyed hashes (PRIMARY key) for every identifier present in `ids` — what is STORED. */
export function ownerIdentifierHashes(ids: OwnerIdentifiers): Array<{ kind: OwnerIdentifierKind; hash: string }> {
  const key = primaryHashKey();
  return normalizedOwnerIdentifiers(ids).map(({ kind, value }) => ({ kind, hash: hmac(key, kind, value) }));
}

/** Anything shaped like an address inside a recipient string ("A <a@x>, b@y"). */
/**
 * Split a recipient string on every character an address cannot contain;
 * each piece holding an "@" is a candidate. A split is linear in the input,
 * where the earlier single regex (`[^…]+@[^…]+\.[^…]+`, global) backtracked
 * polynomially on a long run like "a@a.a.a…" — and a model writes this field.
 */
const RECIPIENT_DELIMITERS = /[\s<>,;:"'()[\]]+/;
function embeddedEmails(field: string): string[] {
  return field.split(RECIPIENT_DELIMITERS).filter((t) => t.includes("@"));
}

/**
 * Every hash a stored suppression of `ids` could carry: each identifier under
 * EVERY key ever used. An email field is read for every address inside it, so
 * a display-name form ("Jane <jane@x.com>") or a list ("a@x.com, b@y.com")
 * cannot slip a suppressed address past a guard that only understood one bare
 * address.
 */
function ownerIdentifierMatchHashes(ids: OwnerIdentifiers): Array<{ kind: OwnerIdentifierKind; hash: string }> {
  const values = normalizedOwnerIdentifiers(ids);
  for (const token of embeddedEmails(ids.email ?? "")) {
    const email = normalizeEmail(token);
    if (email && !values.some((v) => v.kind === "email" && v.value === email)) values.push({ kind: "email", value: email });
  }
  const out: Array<{ kind: OwnerIdentifierKind; hash: string }> = [];
  for (const key of ownerSuppressionMatchKeys()) {
    for (const { kind, value } of values) out.push({ kind, hash: hmac(key, kind, value) });
  }
  return out;
}

class OwnerSuppressedError extends ProviderNotContactedError {
  constructor(readonly channel: OwnerContactChannel, readonly matchedKinds: OwnerIdentifierKind[]) {
    super(
      `Not sent: this owner asked AcreOS to stop all contact (platform-wide opt-out, matched on ${matchedKinds.join(", ")}). ` +
        "Their request covers every org; there is nothing to override.",
    );
    this.name = "OwnerSuppressedError";
  }
}

class OwnerSuppressionUnverifiableError extends ProviderNotContactedError {
  constructor(readonly channel: OwnerContactChannel) {
    super("Not sent: the owner opt-out list could not be checked, so the send was refused (fail closed). Try again shortly.");
    this.name = "OwnerSuppressionUnverifiableError";
  }
}

/** The kinds of `hashes` present on the suppression list. Throws on a DB error. */
async function matchedKindsFor(hashes: Array<{ kind: OwnerIdentifierKind; hash: string }>): Promise<OwnerIdentifierKind[]> {
  if (hashes.length === 0) return [];
  const rows = await db
    .select({ kind: ownerSuppressions.kind })
    .from(ownerSuppressions)
    .where(or(...hashes.map((h) => and(eq(ownerSuppressions.kind, h.kind), eq(ownerSuppressions.identifierHash, h.hash)))));
  return Array.from(new Set(rows.map((r) => r.kind)));
}

/**
 * Null when the contact may proceed; otherwise the refusal sentence. Never
 * throws: a lookup error returns the fail-closed refusal.
 */
export async function ownerContactRefusal(channel: OwnerContactChannel, ids: OwnerIdentifiers): Promise<string | null> {
  try {
    const kinds = await matchedKindsFor(ownerIdentifierMatchHashes(ids));
    if (kinds.length === 0) return null;
    logger.info("[ownerSuppression] contact refused — owner opt-out on file", { metadata: { channel, matchedKinds: kinds } });
    return new OwnerSuppressedError(channel, kinds).message;
  } catch (err) {
    logger.error("[ownerSuppression] lookup failed — refusing (fail closed)", err instanceof Error ? err : undefined, {
      metadata: { channel },
    });
    return new OwnerSuppressionUnverifiableError(channel).message;
  }
}

/** Throws OwnerSuppressedError / OwnerSuppressionUnverifiableError; returns when contact may proceed. */
export async function assertOwnerContactAllowed(channel: OwnerContactChannel, ids: OwnerIdentifiers): Promise<void> {
  let kinds: OwnerIdentifierKind[];
  try {
    kinds = await matchedKindsFor(ownerIdentifierMatchHashes(ids));
  } catch (err) {
    logger.error("[ownerSuppression] lookup failed — refusing (fail closed)", err instanceof Error ? err : undefined, {
      metadata: { channel },
    });
    throw new OwnerSuppressionUnverifiableError(channel);
  }
  if (kinds.length > 0) {
    logger.info("[ownerSuppression] contact refused — owner opt-out on file", { metadata: { channel, matchedKinds: kinds } });
    throw new OwnerSuppressedError(channel, kinds);
  }
}

export const OWNER_OPTOUT_REASON = "Owner opt-out request on file with AcreOS (platform-wide; do not contact)";

interface StampableLead {
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  zip?: string | null;
  doNotContact?: boolean | null;
  optOutDate?: Date | null;
  optOutReason?: string | null;
}

/**
 * List import: rows matching the suppression list are kept (they are the
 * org's own data) but stamped do-not-contact with the opt-out date, so no
 * campaign, sequence or manual send selects them. One query for the batch.
 * THROWS on a lookup error — an import that cannot be checked is refused.
 */
export async function stampOwnerSuppression<T extends StampableLead>(
  rows: T[],
): Promise<{ rows: Array<T & Pick<StampableLead, "doNotContact" | "optOutDate" | "optOutReason">>; suppressedCount: number }> {
  const perRow = rows.map((r) => ownerIdentifierMatchHashes({ email: r.email, phone: r.phone, addressLine1: r.address, zip: r.zip }));
  const all = perRow.flat();
  if (all.length === 0) return { rows, suppressedCount: 0 };
  const hashes = Array.from(new Set(all.map((h) => h.hash)));
  const found = new Set<string>();
  for (let i = 0; i < hashes.length; i += 500) {
    const chunk = hashes.slice(i, i + 500);
    const hit = await db
      .select({ kind: ownerSuppressions.kind, hash: ownerSuppressions.identifierHash })
      .from(ownerSuppressions)
      .where(inArray(ownerSuppressions.identifierHash, chunk));
    for (const h of hit) found.add(`${h.kind}:${h.hash}`);
  }
  let suppressedCount = 0;
  const now = clock.now();
  const out = rows.map((r, i) => {
    if (!perRow[i].some((h) => found.has(`${h.kind}:${h.hash}`))) return r;
    suppressedCount += 1;
    return { ...r, doNotContact: true, optOutDate: r.optOutDate ?? now, optOutReason: OWNER_OPTOUT_REASON };
  });
  if (suppressedCount > 0) {
    logger.info("[ownerSuppression] import rows stamped do-not-contact", { metadata: { suppressedCount } });
  }
  return { rows: out, suppressedCount };
}
