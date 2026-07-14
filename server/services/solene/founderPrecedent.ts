/**
 * SOLENE — founder-precedent write-back (Jarvis 2.3).
 *
 * When the founder resolves a decision-inbox card, the answer may be a
 * REUSABLE RULE the machine can consult before escalating the same class of
 * question again. This service turns qualifying resolves into
 * `founder_precedent` rows in solene_embedded_records.
 *
 * ADMISSION CONTROL — memory quality over quantity. A resolve is admitted
 * only when it carries generalizable signal:
 *
 *   (a) the founder rejected or overrode WITH a stated reason of
 *       ≥ PRECEDENT_MIN_REASON_CHARS chars, OR
 *   (b) the resolve carries an explicit chosen option from a card's
 *       options list (a deliberate pick among named alternatives).
 *
 * Plain no-reason approvals are NOT admitted — "yes, do the recommended
 * thing" carries no rule the machine doesn't already have.
 *
 * Storage: PLATFORM memory — organization_id IS NULL per
 * docs/company/three-level-boundary.md rule 5 (precedents are about running
 * AcreOS, never tenant deal detail). The originating org id lives only in
 * metadata for traceability. UPSERT on the (org IS NULL, namespace,
 * source_ref) natural key with a content-hash skip, mirroring
 * scripts/ingest-feedback-memories.mjs — ON CONFLICT can't serve the
 * NULL-org key because Postgres treats NULLs as distinct in unique indexes.
 *
 * Entirely FAIL-OPEN: any error logs a warning and returns. A decision
 * resolve must never fail because precedent bookkeeping hiccuped.
 */

import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import {
  soleneEmbeddedRecords,
  EMBEDDED_SNIPPET_MAX_CHARS,
  EMBEDDED_SNIPPET_TRUNCATION_SUFFIX,
} from "@shared/schema/solene-embeddings";
import { embedDocumentTextFailOpen } from "./learningLoop";

// ============================================================================
// Public types + constants
// ============================================================================

export const FOUNDER_PRECEDENT_NAMESPACE = "founder_precedent";

/** A rejection/override reason shorter than this is noise, not a rule. */
export const PRECEDENT_MIN_REASON_CHARS = 20;

export interface FounderPrecedentInput {
  itemId: number;
  itemType: string;
  /** What the machine asked — sophieAnalysis + recommendedActionLabel. */
  question: string;
  answer: {
    outcome: "approved" | "rejected" | "override";
    /** Founder-stated reason / custom action text, when given. */
    reason?: string | null;
    /** Label of the explicit option tapped on the card, when any. */
    chosenOptionLabel?: string | null;
  };
  /** Traceability ONLY — stored in metadata, never in organization_id. */
  organizationId?: number | null;
  /**
   * Horizon A3 — the sourceRef segment naming WHERE the ruling was witnessed.
   * Defaults to "decision" (the Jarvis 2.3 decision-inbox resolve path, kept
   * verbatim for backward compatibility with existing rows). Letter replies
   * pass "letter_reply" so their precedents carry a distinct natural key.
   */
  sourceKind?: string;
}

export interface FounderPrecedentResult {
  admitted: boolean;
  /** True when the row already existed with an identical content hash. */
  skippedUnchanged: boolean;
  reason: string;
}

// ============================================================================
// Pure helpers
// ============================================================================

/**
 * Compose the compact SITUATION / FOUNDER RULING / WHY text that gets
 * embedded and stored. Exported for tests.
 */
export function composePrecedentText(input: FounderPrecedentInput): string {
  const reason = input.answer.reason?.trim() ?? "";
  const chosen = input.answer.chosenOptionLabel?.trim() ?? "";
  const ruling = chosen
    ? `${input.answer.outcome} — chose "${chosen}"`
    : input.answer.outcome;
  const why =
    reason.length > 0
      ? reason
      : "Explicit option tapped from the card's options list.";
  return (
    `SITUATION [${input.itemType}]: ${input.question.trim()}\n` +
    `FOUNDER RULING: ${ruling}\n` +
    `WHY: ${why}`
  );
}

function truncateSnippet(text: string): string {
  if (text.length <= EMBEDDED_SNIPPET_MAX_CHARS) return text;
  return (
    text.slice(0, EMBEDDED_SNIPPET_MAX_CHARS) +
    EMBEDDED_SNIPPET_TRUNCATION_SUFFIX
  );
}

// ============================================================================
// recordFounderPrecedent
// ============================================================================

/**
 * Admission-controlled write-back of one decision resolve. NEVER throws —
 * callers fire-and-forget from the resolve path.
 */
export async function recordFounderPrecedent(
  input: FounderPrecedentInput,
): Promise<FounderPrecedentResult> {
  try {
    const reason = input.answer.reason?.trim() ?? "";
    const chosen = input.answer.chosenOptionLabel?.trim() ?? "";
    const reasonedDissent =
      (input.answer.outcome === "rejected" || input.answer.outcome === "override") &&
      reason.length >= PRECEDENT_MIN_REASON_CHARS;
    const explicitOption = chosen.length > 0;

    if (!reasonedDissent && !explicitOption) {
      return {
        admitted: false,
        skippedUnchanged: false,
        reason: "not_a_reusable_rule",
      };
    }

    const fullText = composePrecedentText(input);
    const contentHash = crypto
      .createHash("sha256")
      .update(fullText, "utf8")
      .digest("hex");
    const sourceRef = `founder_precedent:${input.sourceKind ?? "decision"}:${input.itemId}`;

    // Natural-key lookup scoped to org IS NULL (platform memory).
    const existing = await db
      .select({
        id: soleneEmbeddedRecords.id,
        contentHash: soleneEmbeddedRecords.contentHash,
      })
      .from(soleneEmbeddedRecords)
      .where(
        and(
          isNull(soleneEmbeddedRecords.organizationId),
          eq(soleneEmbeddedRecords.namespace, FOUNDER_PRECEDENT_NAMESPACE),
          eq(soleneEmbeddedRecords.sourceRef, sourceRef),
        ),
      )
      .limit(1);

    if (existing[0] && existing[0].contentHash === contentHash) {
      return {
        admitted: true,
        skippedUnchanged: true,
        reason: "content_unchanged",
      };
    }

    const { vector, model } = await embedDocumentTextFailOpen(fullText);
    const rowValues = {
      contentSnippet: truncateSnippet(fullText),
      contentHash,
      embeddingModel: model,
      embeddingDim: vector.length,
      embedding: vector,
      metadata: {
        itemId: input.itemId,
        itemType: input.itemType,
        outcome: input.answer.outcome,
        organizationId: input.organizationId ?? null,
      },
    };

    if (existing[0]) {
      await db
        .update(soleneEmbeddedRecords)
        .set(rowValues)
        .where(eq(soleneEmbeddedRecords.id, existing[0].id));
    } else {
      await db.insert(soleneEmbeddedRecords).values({
        organizationId: null,
        namespace: FOUNDER_PRECEDENT_NAMESPACE,
        sourceRef,
        ...rowValues,
      });
    }

    logger.info("founderPrecedent.recorded", {
      metadata: {
        sourceRef,
        itemType: input.itemType,
        outcome: input.answer.outcome,
        updated: Boolean(existing[0]),
        model,
      },
    });
    return {
      admitted: true,
      skippedUnchanged: false,
      reason: existing[0] ? "updated" : "inserted",
    };
  } catch (err) {
    // Fail-open by design — the resolve already happened; precedent
    // bookkeeping must never surface as a resolve failure.
    logger.warn("founderPrecedent.write_failed", {
      itemId: input.itemId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { admitted: false, skippedUnchanged: false, reason: "error" };
  }
}
