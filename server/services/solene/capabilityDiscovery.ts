/**
 * SOLENE — capability discovery (Phase B L5.24).
 *
 * Agents introspect their own tools/APIs and propose new capabilities. A
 * "capability proposal" is an agent saying "I noticed I do X often + there
 * is no tool for it; here is what a tool for X would look like." Solene
 * reviews + decides to build (accepted), defer, or reject. Once built, the
 * proposal is linked to the implementing dispatch and marked 'implemented'.
 *
 * Lifecycle:
 *   proposed → accepted → implemented
 *   proposed → deferred
 *   proposed → rejected
 *
 * Pure helpers (rankProposalsByROI, findDuplicateProposals) are exported for
 * testability and for the founder review surface.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneCapabilityProposals,
  soleneCapabilityIntrospections,
  CAPABILITY_NAME_PATTERN,
  CAPABILITY_PROPOSAL_STATUSES,
  PROBLEM_STATEMENT_MAX_CHARS,
  TOOL_SIGNATURE_MAX_CHARS,
  TRUNCATION_SUFFIX,
  DUPLICATE_SIMILARITY_THRESHOLD,
  type CapabilityDeciderKind,
  type CapabilityProposalRow,
  type CapabilityProposalStatus,
  type CapabilityIntrospectionRow,
} from "@shared/schema/solene-capability-proposals";
import {
  DISPATCH_AGENT_ROLES,
  type SoleneDispatchAgentRole,
} from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";

// ============================================================================
// proposeCapability
// ============================================================================

export interface ProposeCapabilityInput {
  proposingAgentRole: SoleneDispatchAgentRole;
  proposedCapabilityName: string;
  problemStatement: string;
  proposedToolSignature: string;
  expectedValueUsd?: number;
  expectedInvocationsPerWeek?: number;
  estimatedBuildCostUsd?: number;
  referencesExistingTools?: string[];
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  // Reserve space for the suffix.
  const head = s.slice(0, Math.max(0, max - TRUNCATION_SUFFIX.length));
  return head + TRUNCATION_SUFFIX;
}

export async function proposeCapability(
  input: ProposeCapabilityInput,
): Promise<{ proposalId: number }> {
  if (!DISPATCH_AGENT_ROLES.includes(input.proposingAgentRole)) {
    throw new Error(
      `proposeCapability: invalid proposingAgentRole=${input.proposingAgentRole}`,
    );
  }
  if (
    typeof input.proposedCapabilityName !== "string" ||
    !CAPABILITY_NAME_PATTERN.test(input.proposedCapabilityName)
  ) {
    throw new Error(
      `proposeCapability: proposedCapabilityName=${input.proposedCapabilityName} must be snake_case matching /^[a-z][a-z0-9_]{2,49}$/ (starts with a letter, 3-50 chars, lowercase letters + digits + underscores)`,
    );
  }
  if (
    typeof input.problemStatement !== "string" ||
    input.problemStatement.trim().length === 0
  ) {
    throw new Error("proposeCapability: problemStatement must be non-empty");
  }
  if (
    typeof input.proposedToolSignature !== "string" ||
    input.proposedToolSignature.trim().length === 0
  ) {
    throw new Error("proposeCapability: proposedToolSignature must be non-empty");
  }

  const problemStatement = truncate(
    input.problemStatement,
    PROBLEM_STATEMENT_MAX_CHARS,
  );
  const proposedToolSignature = truncate(
    input.proposedToolSignature,
    TOOL_SIGNATURE_MAX_CHARS,
  );

  // Inline ROI compute + warn if low — Solene sees the warning in logs.
  if (
    typeof input.estimatedBuildCostUsd === "number" &&
    input.estimatedBuildCostUsd > 0 &&
    typeof input.expectedValueUsd === "number" &&
    input.expectedValueUsd > 0 &&
    typeof input.expectedInvocationsPerWeek === "number" &&
    input.expectedInvocationsPerWeek > 0
  ) {
    const annualValue =
      input.expectedValueUsd * input.expectedInvocationsPerWeek * 52;
    const roi = annualValue / input.estimatedBuildCostUsd;
    if (roi < 1.0) {
      logger.warn(
        `[capabilityDiscovery] low-ROI proposal name=${input.proposedCapabilityName} roi=${roi.toFixed(3)} annualValue=$${annualValue.toFixed(2)} buildCost=$${input.estimatedBuildCostUsd.toFixed(2)}`,
      );
    }
  }

  const [inserted] = await db
    .insert(soleneCapabilityProposals)
    .values({
      proposingAgentRole: input.proposingAgentRole,
      proposedCapabilityName: input.proposedCapabilityName,
      problemStatement,
      proposedToolSignature,
      expectedValueUsd:
        typeof input.expectedValueUsd === "number"
          ? input.expectedValueUsd.toFixed(4)
          : null,
      expectedInvocationsPerWeek:
        typeof input.expectedInvocationsPerWeek === "number"
          ? Math.floor(input.expectedInvocationsPerWeek)
          : null,
      estimatedBuildCostUsd:
        typeof input.estimatedBuildCostUsd === "number"
          ? input.estimatedBuildCostUsd.toFixed(4)
          : null,
      referencesExistingTools: input.referencesExistingTools ?? null,
      status: "proposed",
    })
    .returning({ id: soleneCapabilityProposals.id });

  if (!inserted) {
    throw new Error("proposeCapability: insert returned no id");
  }

  logger.info(
    `[capabilityDiscovery] proposed id=${inserted.id} role=${input.proposingAgentRole} name=${input.proposedCapabilityName}`,
  );

  return { proposalId: inserted.id };
}

// ============================================================================
// decideOnProposal
// ============================================================================

export interface DecideOnProposalInput {
  decision: "accepted" | "deferred" | "rejected";
  decidedBy: CapabilityDeciderKind;
  decisionRationale: string;
}

export async function decideOnProposal(
  proposalId: number,
  opts: DecideOnProposalInput,
): Promise<void> {
  if (
    opts.decision !== "accepted" &&
    opts.decision !== "deferred" &&
    opts.decision !== "rejected"
  ) {
    throw new Error(
      `decideOnProposal: invalid decision=${opts.decision} (must be accepted|deferred|rejected)`,
    );
  }
  if (
    opts.decidedBy !== "solene" &&
    opts.decidedBy !== "tom" &&
    opts.decidedBy !== "auto-policy"
  ) {
    throw new Error(
      `decideOnProposal: invalid decidedBy=${opts.decidedBy} (must be solene|tom|auto-policy)`,
    );
  }
  if (
    typeof opts.decisionRationale !== "string" ||
    opts.decisionRationale.trim().length === 0
  ) {
    throw new Error("decideOnProposal: decisionRationale must be non-empty");
  }

  const proposal = await getProposal(proposalId);
  if (!proposal) {
    throw new Error(`decideOnProposal: proposal id=${proposalId} not found`);
  }
  if (proposal.status !== "proposed") {
    throw new Error(
      `decideOnProposal: proposal id=${proposalId} is not in 'proposed' state (current=${proposal.status}); only 'proposed' proposals can be decided`,
    );
  }

  const now = new Date();
  await db
    .update(soleneCapabilityProposals)
    .set({
      status: opts.decision,
      decidedAt: now,
      decidedBy: opts.decidedBy,
      decisionRationale: opts.decisionRationale,
    })
    .where(eq(soleneCapabilityProposals.id, proposalId));

  logger.info(
    `[capabilityDiscovery] decided id=${proposalId} decision=${opts.decision} by=${opts.decidedBy}`,
  );
}

// ============================================================================
// markImplemented
// ============================================================================

export async function markImplemented(
  proposalId: number,
  implementingDispatchId: number,
): Promise<void> {
  if (
    !Number.isInteger(implementingDispatchId) ||
    implementingDispatchId <= 0
  ) {
    throw new Error(
      `markImplemented: implementingDispatchId=${implementingDispatchId} must be a positive integer`,
    );
  }

  const proposal = await getProposal(proposalId);
  if (!proposal) {
    throw new Error(`markImplemented: proposal id=${proposalId} not found`);
  }
  if (proposal.status !== "accepted") {
    throw new Error(
      `markImplemented: proposal id=${proposalId} is not 'accepted' (current=${proposal.status}); only accepted proposals can be marked implemented`,
    );
  }

  await db
    .update(soleneCapabilityProposals)
    .set({
      status: "implemented",
      implementingDispatchId,
    })
    .where(eq(soleneCapabilityProposals.id, proposalId));

  logger.info(
    `[capabilityDiscovery] implemented id=${proposalId} dispatchId=${implementingDispatchId}`,
  );
}

// ============================================================================
// listProposalsByStatus / getProposal
// ============================================================================

export async function getProposal(
  proposalId: number,
): Promise<CapabilityProposalRow | null> {
  const [row] = await db
    .select()
    .from(soleneCapabilityProposals)
    .where(eq(soleneCapabilityProposals.id, proposalId))
    .limit(1);
  return row ?? null;
}

export async function listProposalsByStatus(
  status: CapabilityProposalStatus,
  limit = 50,
): Promise<CapabilityProposalRow[]> {
  if (!CAPABILITY_PROPOSAL_STATUSES.includes(status)) {
    throw new Error(`listProposalsByStatus: invalid status=${status}`);
  }
  const bounded = Math.min(Math.max(1, Math.floor(limit)), 200);
  return db
    .select()
    .from(soleneCapabilityProposals)
    .where(eq(soleneCapabilityProposals.status, status))
    .orderBy(desc(soleneCapabilityProposals.proposedAt))
    .limit(bounded);
}

// ============================================================================
// recordIntrospection / getLatestIntrospection
// ============================================================================

export interface RecordIntrospectionInput {
  agentRole: SoleneDispatchAgentRole;
  availableTools: Array<{ name: string; description: string }>;
  gapSignals: Array<{ pattern: string; occurrences: number; example: string }>;
}

export async function recordIntrospection(
  input: RecordIntrospectionInput,
): Promise<{ introspectionId: number }> {
  if (!DISPATCH_AGENT_ROLES.includes(input.agentRole)) {
    throw new Error(
      `recordIntrospection: invalid agentRole=${input.agentRole}`,
    );
  }
  if (!Array.isArray(input.availableTools)) {
    throw new Error("recordIntrospection: availableTools must be an array");
  }
  if (!Array.isArray(input.gapSignals)) {
    throw new Error("recordIntrospection: gapSignals must be an array");
  }

  const [inserted] = await db
    .insert(soleneCapabilityIntrospections)
    .values({
      agentRole: input.agentRole,
      availableTools: input.availableTools,
      gapSignals: input.gapSignals,
    })
    .returning({ id: soleneCapabilityIntrospections.id });

  if (!inserted) {
    throw new Error("recordIntrospection: insert returned no id");
  }

  logger.info(
    `[capabilityDiscovery] introspection id=${inserted.id} role=${input.agentRole} tools=${input.availableTools.length} gaps=${input.gapSignals.length}`,
  );

  return { introspectionId: inserted.id };
}

export async function getLatestIntrospection(
  agentRole: SoleneDispatchAgentRole,
): Promise<CapabilityIntrospectionRow | null> {
  if (!DISPATCH_AGENT_ROLES.includes(agentRole)) {
    throw new Error(
      `getLatestIntrospection: invalid agentRole=${agentRole}`,
    );
  }
  const [row] = await db
    .select()
    .from(soleneCapabilityIntrospections)
    .where(eq(soleneCapabilityIntrospections.agentRole, agentRole))
    .orderBy(desc(soleneCapabilityIntrospections.introspectedAt))
    .limit(1);
  return row ?? null;
}

// ============================================================================
// PURE HELPERS — exported for testability + founder review surface.
// ============================================================================

export interface RankedProposal {
  proposalId: number;
  roi: number;
  breakdown: { annualValue: number; buildCost: number };
}

/**
 * Rank proposals by ROI = (expectedValue × invocationsPerWeek × 52) / buildCost.
 * Rows with missing or non-positive numeric inputs are skipped (not crashed).
 * Returns proposals sorted high-to-low.
 */
export function rankProposalsByROI(
  rows: CapabilityProposalRow[],
): RankedProposal[] {
  const out: RankedProposal[] = [];
  for (const row of rows) {
    const valueRaw = row.expectedValueUsd;
    const invocations = row.expectedInvocationsPerWeek;
    const costRaw = row.estimatedBuildCostUsd;
    if (valueRaw === null || valueRaw === undefined) continue;
    if (invocations === null || invocations === undefined) continue;
    if (costRaw === null || costRaw === undefined) continue;
    const value = typeof valueRaw === "string" ? Number(valueRaw) : valueRaw;
    const cost = typeof costRaw === "string" ? Number(costRaw) : costRaw;
    if (!Number.isFinite(value) || value <= 0) continue;
    if (!Number.isFinite(invocations) || invocations <= 0) continue;
    if (!Number.isFinite(cost) || cost <= 0) continue;
    const annualValue = value * invocations * 52;
    const roi = annualValue / cost;
    out.push({
      proposalId: row.id,
      roi,
      breakdown: { annualValue, buildCost: cost },
    });
  }
  out.sort((a, b) => b.roi - a.roi);
  return out;
}

export interface DuplicatePair {
  a: number;
  b: number;
  similarity: number;
  reason: string;
}

/**
 * Tokenize a string into a set of lowercase word-ish tokens. Strips punctuation
 * but keeps underscores/digits (snake_case identifiers stay intact). Empty
 * tokens are dropped.
 */
function tokenize(s: string): Set<string> {
  const tokens = new Set<string>();
  const lowered = s.toLowerCase();
  // Split on anything that isn't a letter, digit, or underscore.
  for (const raw of lowered.split(/[^a-z0-9_]+/)) {
    if (raw.length > 0) tokens.add(raw);
  }
  return tokens;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  if (union === 0) return 0;
  return inter / union;
}

/**
 * Detect duplicate proposals by Jaccard token overlap on (name + signature).
 * Pairs whose similarity ≥ DUPLICATE_SIMILARITY_THRESHOLD (0.6) are returned.
 */
export function findDuplicateProposals(
  rows: CapabilityProposalRow[],
): DuplicatePair[] {
  const tokens = rows.map((r) =>
    tokenize(`${r.proposedCapabilityName} ${r.proposedToolSignature}`),
  );
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const sim = jaccard(tokens[i]!, tokens[j]!);
      if (sim >= DUPLICATE_SIMILARITY_THRESHOLD) {
        pairs.push({
          a: rows[i]!.id,
          b: rows[j]!.id,
          similarity: sim,
          reason: `jaccard(name+signature) = ${sim.toFixed(3)} ≥ ${DUPLICATE_SIMILARITY_THRESHOLD}`,
        });
      }
    }
  }
  // Stable: highest similarity first.
  pairs.sort((p1, p2) => p2.similarity - p1.similarity);
  return pairs;
}
