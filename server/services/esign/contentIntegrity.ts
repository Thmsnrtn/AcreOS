/**
 * Content integrity of a signed document: the one hash every signature write
 * records, and the one verdict every reader renders.
 *
 * Each `signatures` row carries `document_content_hash`, the SHA-256 (hex) of
 * `generated_documents.content` as it stood when that signature was recorded.
 * A reader recomputes the same hash over the content as it stands now and
 * compares. Writers and readers must hash the same bytes the same way, so they
 * all call `hashDocumentContent` — the computation the operator route
 * (`POST /api/signatures`) has always used, moved here unchanged so that the
 * public signing route, the sealed PDF and the completion certificate share
 * it instead of restating it.
 *
 * WHY THREE OUTCOMES PER SIGNATURE, NOT TWO
 * -----------------------------------------
 *   match         a hash was recorded and equals the current content's hash.
 *   mismatch      a hash was recorded and differs: the content changed after
 *                 that signature. This, and only this, is a tamper warning.
 *   not_recorded  no hash was recorded at signing, so there is nothing to
 *                 compare. That is not evidence of a change, and it is not
 *                 evidence of integrity either.
 *
 * Collapsing `not_recorded` into `mismatch` printed a tamper warning on every
 * counterparty-signed document, because the public signing route did not
 * record the hash. Collapsing it into `match` would certify content nobody
 * hashed. Rows written before that route recorded it are not backfilled: a
 * hash computed later would describe the content at that later time, not what
 * was signed, so those rows read as `not_recorded` — permanently, and
 * accurately.
 *
 * Pure: no db, no storage, no express.
 */

import crypto from "node:crypto";

/**
 * SHA-256 (hex) of a document's content, or null when there is no content to
 * hash. Every signature write records this; every integrity check recomputes
 * it. Do not hash a derived form (plain text, trimmed, the PDF bytes) anywhere
 * else: a reader comparing a different representation reports a mismatch for
 * content that never changed.
 */
export function hashDocumentContent(content: string | null | undefined): string | null {
  if (!content) return null;
  return crypto.createHash("sha256").update(content).digest("hex");
}

export type SignatureIntegrity = "match" | "mismatch" | "not_recorded";

export type DocumentIntegrityStatus = "verified" | "mismatch" | "not_recorded" | "no_signatures";

/** Compare one signature's recorded hash with the current content's hash. */
export function signatureIntegrity(
  recordedHash: string | null | undefined,
  currentContentHash: string | null,
): SignatureIntegrity {
  if (!recordedHash) return "not_recorded";
  return recordedHash === currentContentHash ? "match" : "mismatch";
}

export interface DocumentIntegrity {
  status: DocumentIntegrityStatus;
  /** Hash of the content as it stands now (null when there is no content). */
  currentContentHash: string | null;
  /** One entry per signature, in the order the signatures were given. */
  perSignature: SignatureIntegrity[];
  matched: number;
  mismatched: number;
  notRecorded: number;
}

/**
 * The document-level verdict. A real mismatch outranks everything; a missing
 * hash outranks a match, because a document is only verified when every
 * signature on it can be checked.
 */
export function assessDocumentIntegrity(
  content: string | null | undefined,
  signatures: ReadonlyArray<{ documentContentHash?: string | null }>,
): DocumentIntegrity {
  const currentContentHash = hashDocumentContent(content);
  const perSignature = signatures.map((s) => signatureIntegrity(s.documentContentHash, currentContentHash));
  const count = (v: SignatureIntegrity) => perSignature.filter((p) => p === v).length;
  const matched = count("match");
  const mismatched = count("mismatch");
  const notRecorded = count("not_recorded");
  const status: DocumentIntegrityStatus =
    perSignature.length === 0
      ? "no_signatures"
      : mismatched > 0
        ? "mismatch"
        : notRecorded > 0
          ? "not_recorded"
          : "verified";
  return { status, currentContentHash, perSignature, matched, mismatched, notRecorded };
}

/**
 * "Does this signature's hash match the content now?" — null when no hash was
 * recorded, because that question has no answer. `false` means a real
 * mismatch and nothing else.
 */
export function hashMatchesNow(integrity: SignatureIntegrity): boolean | null {
  return integrity === "not_recorded" ? null : integrity === "match";
}

/**
 * "Does every signature's hash match the content now?" — true only when
 * verified, false only on a real mismatch, null when it cannot be answered
 * (no signatures, or a signature recorded no hash).
 */
export function allHashesMatchNow(status: DocumentIntegrityStatus): boolean | null {
  if (status === "verified") return true;
  if (status === "mismatch") return false;
  return null;
}

/** Per-signature line shown on the sealed PDF. */
export const SIGNATURE_INTEGRITY_LABEL: Record<SignatureIntegrity, string> = {
  match: "Matches the current content",
  mismatch: "Does not match the current content",
  not_recorded: "Cannot be checked: no hash was recorded at signing",
};

/** Shown in place of a hash for a signature that recorded none. */
export const HASH_NOT_RECORDED = "Not recorded at signing";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The integrity statement, worded once for every surface that states it (the
 * sealed PDF's attestation and the completion certificate). `tone` is the
 * renderer's cue; the words carry the meaning on their own.
 */
export function integrityStatement(integrity: DocumentIntegrity): {
  tone: "ok" | "danger" | "caution" | "muted";
  text: string;
} {
  const total = integrity.perSignature.length;
  switch (integrity.status) {
    case "no_signatures":
      return { tone: "muted", text: "No signatures to verify." };
    case "verified":
      return {
        tone: "ok",
        text:
          "VERIFIED — the document content matches the hash captured by every signature. " +
          "No tampering detected.",
      };
    case "mismatch":
      return {
        tone: "danger",
        text:
          "TAMPER WARNING — the document content no longer matches the hash captured at signing " +
          `(${integrity.mismatched} of ${total} ${plural(total, "signature", "signatures")}).`,
      };
    case "not_recorded": {
      const n = integrity.notRecorded;
      const others =
        integrity.matched > 0
          ? ` ${integrity.matched} other ${plural(integrity.matched, "signature matches", "signatures match")} the current content.`
          : "";
      return {
        tone: "caution",
        text:
          `INTEGRITY HASH NOT RECORDED AT SIGNING — ${n} of ${total} ${plural(total, "signature", "signatures")} ` +
          `recorded no content hash, so the document content cannot be checked against ${plural(n, "it", "them")}.` +
          others,
      };
    }
  }
}
