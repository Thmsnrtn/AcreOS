/**
 * SOLENE — persistent agent identity (Layer 1 capability L1.4).
 *
 * Each role (iris / soren / beatrice / krieger / general-purpose) accumulates
 * past-decision context across dispatches. The dispatchRunner reads the
 * N-most-recent rows for the active role and renders them into a markdown
 * block injected at the top of the system prompt — Iris-on-Tuesday
 * structurally sees what Iris-on-Monday decided + why.
 *
 * Two entrypoints:
 *
 *   recordAgentDecision(input)
 *     Fire-and-forget INSERT, never throws. Mirrors the discipline of
 *     capitalTracker.recordCapitalEvent — callers do not block on this.
 *     Returns the new row id (or 0 on swallowed failure).
 *
 *   loadAgentIdentityBlock(agentRole, limit?)
 *     Query the most-recent `limit` decisions (default IDENTITY_BLOCK_DEFAULT_LIMIT)
 *     for the role, render as markdown. Empty result → a fallback string so
 *     the prompt always has *something* coherent. 8 KB cap with a
 *     `… [truncated]` suffix.
 *
 * ----------------------------------------------------------------------------
 * INTENDED TOOL EXPOSURE (Solene wires in a follow-up commit)
 * ----------------------------------------------------------------------------
 * A future `record_decision` tool exposed via dispatchToolExecutor will let a
 * dispatched agent persist its own decisions mid-dispatch. The intended
 * Anthropic-tool schema:
 *
 *   {
 *     name: "record_decision",
 *     description:
 *       "Record a load-bearing decision (architecture / bug fix / policy / " +
 *       "escalation) so future-you, on the next dispatch for this role, " +
 *       "starts with this context already in your system prompt.",
 *     input_schema: {
 *       type: "object",
 *       required: ["decision_kind", "summary", "rationale"],
 *       properties: {
 *         decision_kind: {
 *           type: "string",
 *           enum: ["architecture", "bug_fix", "policy", "escalation", "other"],
 *         },
 *         summary:       { type: "string", maxLength: 500 },
 *         rationale:     { type: "string" },
 *         referenced_files: { type: "array", items: { type: "string" } },
 *         evidence_url:  { type: "string" },
 *       },
 *     },
 *   }
 *
 * The executor wrapper calls recordAgentDecision({ agentRole, dispatchId,
 * sessionToken, ...input }), filling agentRole / dispatchId / sessionToken
 * from the runner's own context (not from the model). dispatchToolExecutor.ts
 * is owned by Sibling D's L6.29 work this wave, so the tool wiring lands in
 * a follow-up commit by Solene.
 * ----------------------------------------------------------------------------
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneAgentIdentityDecisions,
  IDENTITY_BLOCK_DEFAULT_LIMIT,
  IDENTITY_BLOCK_MAX_BYTES,
  IDENTITY_SUMMARY_MAX_CHARS,
  IDENTITY_DECISION_KINDS,
  type SoleneIdentityDecisionKind,
} from "@shared/schema/solene-agent-identity";
import type { SoleneDispatchAgentRole } from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";

// ============================================================================
// Types
// ============================================================================

export interface RecordAgentDecisionInput {
  agentRole: SoleneDispatchAgentRole;
  decisionKind: SoleneIdentityDecisionKind;
  summary: string;
  rationale: string;
  referencedFiles?: string[];
  dispatchId?: number | null;
  evidenceUrl?: string | null;
  sessionToken?: string | null;
}

// Fallback rendered when no decisions exist for the role yet. Kept short so
// the prompt block remains coherent — the model knows *why* it's empty.
export const IDENTITY_EMPTY_FALLBACK =
  "_No prior decisions on record for this role. Fresh start._";

// Suffix appended after byte-truncation. Same shape as the team-state
// preamble's truncation suffix so transcript analyzers can find it.
const TRUNCATION_SUFFIX = "\n… [truncated]";

// ============================================================================
// recordAgentDecision — fire-and-forget INSERT, never throws.
// ============================================================================

export async function recordAgentDecision(
  input: RecordAgentDecisionInput,
): Promise<number> {
  try {
    if (!isKnownDecisionKind(input.decisionKind)) {
      logger.warn(
        `[agentIdentity] unknown decisionKind=${input.decisionKind}; coercing to other`,
      );
    }
    const summary = truncate(input.summary ?? "", IDENTITY_SUMMARY_MAX_CHARS);
    const decisionKind = isKnownDecisionKind(input.decisionKind)
      ? input.decisionKind
      : "other";

    const [inserted] = await db
      .insert(soleneAgentIdentityDecisions)
      .values({
        agentRole: input.agentRole,
        decisionKind,
        summary,
        rationale: input.rationale ?? "",
        referencedFiles: input.referencedFiles ?? [],
        dispatchId: input.dispatchId ?? null,
        evidenceUrl: input.evidenceUrl ?? null,
        sessionToken: input.sessionToken ?? null,
      })
      .returning({ id: soleneAgentIdentityDecisions.id });

    if (!inserted) {
      logger.warn("[agentIdentity] recordAgentDecision: insert returned no id");
      return 0;
    }
    return inserted.id;
  } catch (err) {
    logger.warn(
      "[agentIdentity] recordAgentDecision swallow",
      err instanceof Error ? err : undefined,
    );
    return 0;
  }
}

// ============================================================================
// loadAgentIdentityBlock — render the most-recent N decisions as markdown.
// ============================================================================

export async function loadAgentIdentityBlock(
  agentRole: SoleneDispatchAgentRole,
  limit: number = IDENTITY_BLOCK_DEFAULT_LIMIT,
): Promise<string> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));

  let rows: Array<{
    decidedAt: Date;
    decisionKind: string;
    summary: string;
    rationale: string;
    referencedFiles: string[] | null;
  }>;
  try {
    rows = await db
      .select({
        decidedAt: soleneAgentIdentityDecisions.decidedAt,
        decisionKind: soleneAgentIdentityDecisions.decisionKind,
        summary: soleneAgentIdentityDecisions.summary,
        rationale: soleneAgentIdentityDecisions.rationale,
        referencedFiles: soleneAgentIdentityDecisions.referencedFiles,
      })
      .from(soleneAgentIdentityDecisions)
      .where(eq(soleneAgentIdentityDecisions.agentRole, agentRole))
      .orderBy(desc(soleneAgentIdentityDecisions.decidedAt))
      .limit(safeLimit);
  } catch (err) {
    logger.warn(
      `[agentIdentity] loadAgentIdentityBlock query failed for role=${agentRole}`,
      err instanceof Error ? err : undefined,
    );
    return IDENTITY_EMPTY_FALLBACK;
  }

  if (rows.length === 0) {
    return IDENTITY_EMPTY_FALLBACK;
  }

  const lines: string[] = [];
  for (const row of rows) {
    const date = formatDate(row.decidedAt);
    const files = (row.referencedFiles ?? []).filter(
      (f) => typeof f === "string" && f.length > 0,
    );
    const filesPart = files.length > 0 ? ` [files: ${files.join(", ")}]` : "";
    // Collapse internal whitespace on summary + rationale so each line stays
    // on a single bullet — easier for the model to ingest.
    const summary = collapseWs(row.summary);
    const rationale = collapseWs(row.rationale);
    lines.push(
      `- **${date}** (${row.decisionKind}): ${summary} — ${rationale}${filesPart}`,
    );
  }

  let block = lines.join("\n");
  if (Buffer.byteLength(block, "utf8") > IDENTITY_BLOCK_MAX_BYTES) {
    const buf = Buffer.from(block, "utf8");
    // Reserve room for the suffix so the final byte count stays within cap.
    const room = IDENTITY_BLOCK_MAX_BYTES - Buffer.byteLength(TRUNCATION_SUFFIX, "utf8");
    block = buf.slice(0, Math.max(0, room)).toString("utf8") + TRUNCATION_SUFFIX;
  }
  return block;
}

// ============================================================================
// Internal helpers
// ============================================================================

function isKnownDecisionKind(
  kind: string,
): kind is SoleneIdentityDecisionKind {
  return (IDENTITY_DECISION_KINDS as readonly string[]).includes(kind);
}

function truncate(s: string, max: number): string {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function collapseWs(s: string): string {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim();
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "unknown";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "unknown";
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Touch unused import to keep the tree-shaker honest if downstream callers
// need `and` for filtered loads (e.g. role + sessionToken thread view).
void and;
