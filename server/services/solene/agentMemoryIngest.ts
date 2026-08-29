/**
 * Agent-memory ingest into the canonical solene corpus (stage-4 turn 17,
 * docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md §1e).
 *
 * The V13 memory tower (agentEpisodicMemory/agentSemanticMemory/…) is being
 * drained; the ONE episodic/semantic store is solene_embedded_records. This
 * is the write half for the two agent writers that survive (executionEngine
 * store_learning, agentDebates precedents): content-hash dedup + Voyage
 * embedding with the fail-open placeholder, same shape founderPrecedent
 * uses. Reads come back through memoryRetrieval's cross-namespace RAG.
 *
 * organizationId stays null: these are PLATFORM agents' own learnings, not
 * tenant data. NEVER throws — a memory write must never take down the
 * action that produced the memory; failures are logged and reported false.
 */
import { createHash } from "node:crypto";
import { db } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { soleneEmbeddedRecords } from "@shared/schema";
import { embedDocumentTextFailOpen } from "./learningLoop";
import { logger } from "../../utils/logger";

const AGENT_MEMORY_NAMESPACE = "agent_memory";

const SNIPPET_MAX = 1200;

export async function ingestAgentMemory(input: {
  /** Stable identity for dedup/update, e.g. "debate:123" or "learning:<hash>". */
  sourceRef: string;
  text: string;
  metadata?: Record<string, unknown>;
}): Promise<{ stored: boolean; skippedUnchanged?: boolean; detail: string }> {
  try {
    const text = input.text.trim();
    if (!text) return { stored: false, detail: "empty memory text refused" };
    const contentHash = createHash("sha256").update(text).digest("hex");

    const existing = await db
      .select({ id: soleneEmbeddedRecords.id, contentHash: soleneEmbeddedRecords.contentHash })
      .from(soleneEmbeddedRecords)
      .where(
        and(
          isNull(soleneEmbeddedRecords.organizationId),
          eq(soleneEmbeddedRecords.namespace, AGENT_MEMORY_NAMESPACE),
          eq(soleneEmbeddedRecords.sourceRef, input.sourceRef),
        ),
      );
    if (existing[0] && existing[0].contentHash === contentHash) {
      return { stored: true, skippedUnchanged: true, detail: "unchanged" };
    }

    const { vector, model } = await embedDocumentTextFailOpen(text);
    const rowValues = {
      contentSnippet: text.slice(0, SNIPPET_MAX),
      contentHash,
      embeddingModel: model,
      embeddingDim: vector.length,
      embedding: vector,
      metadata: input.metadata ?? {},
    };
    if (existing[0]) {
      // Belt-and-braces: the id came from the platform-scoped select above,
      // and the UPDATE re-asserts the same scope so a wrong id can never
      // touch a tenant-scoped or foreign-namespace row.
      await db
        .update(soleneEmbeddedRecords)
        .set(rowValues)
        .where(
          and(
            eq(soleneEmbeddedRecords.id, existing[0].id),
            isNull(soleneEmbeddedRecords.organizationId),
            eq(soleneEmbeddedRecords.namespace, AGENT_MEMORY_NAMESPACE),
          ),
        );
    } else {
      await db.insert(soleneEmbeddedRecords).values({
        organizationId: null,
        namespace: AGENT_MEMORY_NAMESPACE,
        sourceRef: input.sourceRef,
        ...rowValues,
      });
    }
    return { stored: true, detail: `embedded into ${AGENT_MEMORY_NAMESPACE} as ${input.sourceRef}` };
  } catch (err) {
    logger.warn("[agentMemoryIngest] write failed (memory is best-effort)", {
      metadata: { sourceRef: input.sourceRef, err: err instanceof Error ? err.message : String(err) },
    });
    return { stored: false, detail: `ingest failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
