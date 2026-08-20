/**
 * Who has signed a document, derived from the SIGNATURES, not from the roster.
 *
 * ── THE DEFECT THIS EXISTS TO FIX ───────────────────────────────────────────
 * Both signature-capture paths used to record progress by rewriting the signer
 * roster on the document itself:
 *
 *     const updatedSigners = signers.map((x, i) =>
 *       i === signerIdx ? { ...x, signedAt: now, signatureUrl: … } : x);
 *     await storage.updateGeneratedDocument(doc.id, {
 *       signers: updatedSigners,
 *       status: allSigned ? "signed" : "partially_signed",
 *     });
 *
 * A Postgres BEFORE-UPDATE trigger, `acreos_block_signed_doc_mutation_trigger`
 * (scripts/migrate.mjs), raises whenever a document already in status
 * 'signed' | 'partially_signed' | 'final' has its `content`, `variables` or
 * `signers` modified. So:
 *
 *   signer 1 signs → OLD.status is 'draft'/'pending_signature' → allowed →
 *                    status becomes 'partially_signed'
 *   signer 2 signs → OLD.status is 'partially_signed' AND signers changed →
 *                    TRIGGER RAISES → 500
 *
 * Every document with two or more signers was therefore impossible to complete.
 * The second signer got an "Internal error" on the public signing page, and
 * `allSigned` could never become true, so `status` never reached 'signed' and
 * `completedAt` was never set. Live on the counterparty-facing rail.
 *
 * ── WHY DERIVE RATHER THAN LOOSEN THE TRIGGER ───────────────────────────────
 * The obvious repair is to let the trigger permit `signers` edits while
 * 'partially_signed'. That is the wrong repair, because the trigger is RIGHT:
 * changing the signer roster after somebody has signed is exactly the tamper
 * vector it was built to stop. The bug was never the trigger — it was storing
 * two different things in one column. The roster is document SUBSTANCE (who is
 * asked to sign, in what role) and belongs under the trigger's protection. Who
 * actually signed is EVIDENCE, and it already has a canonical home: the
 * `signatures` table, with the signature image, the IP, the user agent, the
 * consent text and the SHA-256 content hash captured at signing time.
 *
 * Deriving progress from that table makes the trigger's existing semantics
 * correct instead of obstructive, and needs no migration. It also removes a
 * duplicate source of truth: the roster's `signedAt`/`signatureUrl` were
 * written by both paths and read by nobody outside the completion check —
 * `signatureUrl` is rendered nowhere in the entire client.
 *
 * ── HISTORICAL EVIDENCE IS PRESERVED, NOT REWRITTEN ─────────────────────────
 * Documents partly signed under the old scheme carry `signedAt` on their roster
 * entries. Those rows are truthful records of something that really happened,
 * so this module treats a roster `signedAt` as evidence too and takes the UNION
 * with the signatures table. No existing document regresses to "unsigned", and
 * nothing already written is edited or deleted to make the new model tidy.
 */

import { storage } from "../../storage";
import type { Signature } from "@shared/schema";

/** A signer as recorded on `generated_documents.signers`. */
export interface RosterSigner {
  id: string;
  name: string;
  email?: string;
  role?: string;
  order?: number;
  /** Legacy progress marker. Read as evidence, never written by this module. */
  signedAt?: string;
  /** Legacy duplicate of the signature image. Rendered nowhere. */
  signatureUrl?: string;
}

export interface SignerProgress {
  signer: RosterSigner;
  signed: boolean;
  /** When they signed, from the signature row where available. */
  signedAt: Date | null;
  /** How we know: a signature row, or a legacy roster marker. */
  source: "signature_row" | "legacy_roster" | null;
}

export interface SigningProgress {
  roster: RosterSigner[];
  perSigner: SignerProgress[];
  outstanding: RosterSigner[];
  /** True only when the roster is non-empty and every member has signed. */
  allSigned: boolean;
  hasSigned(signerId: string): boolean;
}

/**
 * Match a signature row to a roster entry.
 *
 * Email first and case-insensitively, because it is the identifier the signing
 * link is issued against. Name is the fallback for rosters with no email, which
 * is how the pre-existing code matched (`s.name === signerName || s.email ===
 * signerEmail`) — kept so no historical document changes meaning.
 *
 * Deliberately NOT a substring or fuzzy match: two signers called "J. Smith"
 * must not collapse into one, and a partial match that silently marked the
 * wrong party as having signed would be the worst possible failure here.
 */
function matches(sig: Pick<Signature, "signerEmail" | "signerName">, s: RosterSigner): boolean {
  const sigEmail = sig.signerEmail?.trim().toLowerCase();
  const rosterEmail = s.email?.trim().toLowerCase();
  if (sigEmail && rosterEmail) return sigEmail === rosterEmail;
  const sigName = sig.signerName?.trim().toLowerCase();
  const rosterName = s.name?.trim().toLowerCase();
  return Boolean(sigName && rosterName && sigName === rosterName);
}

/**
 * Compute signing progress for one document.
 *
 * `roster` is passed in rather than re-read so callers that already hold the
 * document do not fetch it twice, and so this stays usable from a path that has
 * the roster but not the row.
 */
export async function loadSigningProgress(
  organizationId: number,
  documentId: number,
  roster: RosterSigner[],
): Promise<SigningProgress> {
  const rows = await storage.getSignatures(organizationId, documentId);

  const perSigner: SignerProgress[] = roster.map((signer) => {
    const row = rows.find((r) => matches(r, signer));
    if (row) {
      return {
        signer,
        signed: true,
        signedAt: row.signedAt ?? row.createdAt ?? null,
        source: "signature_row" as const,
      };
    }
    if (signer.signedAt) {
      // Legacy marker from before progress moved to the signatures table.
      const parsed = new Date(signer.signedAt);
      return {
        signer,
        signed: true,
        signedAt: Number.isNaN(parsed.getTime()) ? null : parsed,
        source: "legacy_roster" as const,
      };
    }
    return { signer, signed: false, signedAt: null, source: null };
  });

  const outstanding = perSigner.filter((p) => !p.signed).map((p) => p.signer);

  return {
    roster,
    perSigner,
    outstanding,
    // An empty roster is NOT "everyone has signed". The old code used
    // `.every()`, which is vacuously true on [], so a document with no signers
    // would have been marked fully signed and stamped completedAt.
    allSigned: roster.length > 0 && outstanding.length === 0,
    hasSigned(signerId: string) {
      return perSigner.some((p) => p.signer.id === signerId && p.signed);
    },
  };
}

/**
 * The document-status patch implied by a progress state.
 *
 * Returns ONLY status fields — never `signers`, `content` or `variables` — so
 * the immutability trigger cannot fire on a progress update. That omission is
 * the fix; keep it. `updateGeneratedDocument` sets just the keys it is given,
 * so leaving `signers` out means NEW.signers IS NOT DISTINCT FROM OLD.signers.
 */
export function statusPatchFor(progress: SigningProgress): {
  status: "signed" | "partially_signed";
  completedAt?: Date;
  signedAt?: Date;
} {
  if (progress.allSigned) {
    const now = new Date();
    return { status: "signed", completedAt: now, signedAt: now };
  }
  return { status: "partially_signed" };
}
