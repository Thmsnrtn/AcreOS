/**
 * SOLENE — adversarial self-testing (Phase B L3.15).
 *
 * Each successful dispatch can be paired with an ADVERSARY: a sibling
 * dispatch whose explicit job is to try to break the original's work before
 * the work is considered fully landed.
 *
 * Distinct from L2.8 multi-agent code review:
 *   - code-review checks for correctness against the brief.
 *   - adversarial-testing ACTIVELY PROBES for edge cases, security holes,
 *     race conditions, mis-specified requirements, and regressions.
 *
 * Three public entrypoints:
 *
 *   scheduleAdversarialTest({ originalDispatchId, originalAgentRole,
 *                             adversaryStrategy, testFocus })
 *     Writes a row in status='pending'. Returns { testId }. Cheap; does not
 *     enqueue a dispatch yet.
 *
 *   enqueueAdversaryDispatch(testId)
 *     Loads the test row, builds the adversary system prompt for its strategy,
 *     and enqueues a real dispatch via the existing queue (sourceType=
 *     'adversarial_test', agentRole='general-purpose', $15 cap, 8min timeout).
 *     Stamps adversarial_dispatch_id + status='enqueued' on the test row.
 *     If enqueueDispatch throws, returns `{ adversarialDispatchId: null,
 *     reason: 'enqueue_failed: <msg>' }`.
 *
 *   recordAdversaryFindings(testId, { status, findings, severity? })
 *     Persists the adversary's findings to the test row and stamps reported_at.
 *     `found_issues` requires a severity; `clean` and `inconclusive` allow null.
 *
 * Plus two read helpers (listPendingTests, listFindingsByOriginal) for the
 * founder visibility surface, and one pure helper (buildAdversaryPrompt) that
 * shapes the per-strategy attack prompt.
 */

import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneAdversarialTests,
  ADVERSARY_STRATEGIES,
  ADVERSARIAL_TEST_STATUSES,
  ADVERSARIAL_SEVERITIES,
  type AdversaryStrategy,
  type AdversarialTestRow,
  type AdversarialSeverity,
} from "@shared/schema/solene-adversarial-tests";
import {
  soleneDispatchQueue,
  soleneDispatchResults,
  type SoleneDispatchAgentRole,
} from "@shared/schema/solene-dispatch";
import { enqueueDispatch } from "./dispatchQueue";
import { logger } from "../../utils/logger";

// Hard-coded cost + timeout caps for adversary dispatches. Adversaries should
// be cheap reads/grep/git-show calls plus a focused analysis turn, not
// open-ended exploration.
const ADVERSARY_MAX_COST_USD = 15;
const ADVERSARY_TIMEOUT_MS = 8 * 60 * 1000;

// ============================================================================
// buildAdversaryPrompt — pure helper, exported for testability.
// ============================================================================

const STRATEGY_HEADER: Record<AdversaryStrategy, string> = {
  edge_case_hunter:
    "You are the EDGE_CASE_HUNTER adversary. Find the boundary condition the original didn't think about. Empty input, max input, off-by-one, locale issues, unicode, leap-second, timezone, integer overflow, NaN, null vs undefined.",
  security_red_team:
    "You are the SECURITY_RED_TEAM adversary. What could an attacker do with this? Injection (SQL/HTML/shell/log), auth bypass, IDOR, side-channel timing, supply chain (transitive deps), secret leakage, CSRF/SSRF, privilege escalation across tenants.",
  race_condition_prober:
    "You are the RACE_CONDITION_PROBER adversary. Where is concurrency assumed to be safe but isn't? What if two callers hit the same row simultaneously? TOCTOU, double-claim, lost updates, idempotency gaps, replay attacks, lock ordering, partial writes.",
  spec_misinterpretation:
    "You are the SPEC_MISINTERPRETATION adversary. What did the spec ACTUALLY require vs what was built? Find the gap. Missing requirements, over-built scope drift, ambiguous wording the implementer guessed wrong on, requirements that are mutually contradictory.",
  regression_predictor:
    "You are the REGRESSION_PREDICTOR adversary. What existing behavior might this break? Which currently-passing test would fail under this change? Which API contract did this shift? Which downstream feature depended on the old semantics?",
};

const STRATEGY_PLAYBOOK: Record<AdversaryStrategy, string> = {
  edge_case_hunter:
    "Enumerate inputs the original wouldn't have tested. For each, predict the failure mode. Skim the diff for assumptions (numeric ranges, non-empty arrays, well-formed dates) and pick the ones not validated.",
  security_red_team:
    "Walk every external input. Where does it land in a query, a shell, a file path, a URL, a JSON parse? Check for auth in the route handler. Check that org-scoping is present (multi-tenant isolation).",
  race_condition_prober:
    "Look for `SELECT ... FOR UPDATE` or its absence on hot paths. Look for read-modify-write that isn't transactional. Look for unique-by-id that allows two enqueues. Cron + worker simultaneity.",
  spec_misinterpretation:
    "Quote the spec, quote the implementation. Show where they diverge. If the spec is silent on a behavior the code implements, that's scope drift.",
  regression_predictor:
    "Grep for callers of any function whose signature/behavior changed. Grep for tests touching the modified files. Identify which assertion would now fail.",
};

export interface BuildAdversaryPromptInput {
  strategy: AdversaryStrategy;
  originalDispatchId: number;
  originalAgentRole: SoleneDispatchAgentRole;
  testFocus: string;
  originalCommitShas: string[];
}

export function buildAdversaryPrompt(
  input: BuildAdversaryPromptInput,
): string {
  if (!ADVERSARY_STRATEGIES.includes(input.strategy)) {
    throw new Error(
      `buildAdversaryPrompt: invalid strategy=${input.strategy}`,
    );
  }
  const shas =
    input.originalCommitShas.length > 0
      ? input.originalCommitShas.join(" ")
      : "(no commits recorded)";
  const focus = input.testFocus.trim();

  return [
    STRATEGY_HEADER[input.strategy],
    "",
    `Your target: dispatch #${input.originalDispatchId} (agent=${input.originalAgentRole}).`,
    `Commits to attack: ${shas}`,
    "",
    `TEST FOCUS: ${focus}`,
    "",
    `Strategy: ${input.strategy}`,
    STRATEGY_PLAYBOOK[input.strategy],
    "",
    "Your method:",
    `1. Run \`git show <sha>\` for each commit to read the full diff.`,
    `2. Apply the ${input.strategy} lens above to find the weakest assumption.`,
    "3. State the most concrete attack/failure case you can articulate.",
    "4. Estimate the severity honestly. 'inconclusive' is an acceptable verdict — better than overclaiming.",
    "",
    "Do NOT modify any files. Do NOT commit. Read-only adversarial probe.",
    "",
    "End your turn with EXACTLY this structured block:",
    "",
    "FINDINGS_STATUS: clean | found_issues | inconclusive",
    "SEVERITY: critical | high | medium | low | informational",
    "FINDINGS:",
    "- <bullet>",
    "- <bullet>",
  ].join("\n");
}

// ============================================================================
// scheduleAdversarialTest
// ============================================================================

export interface ScheduleAdversarialTestInput {
  originalDispatchId: number;
  originalAgentRole: SoleneDispatchAgentRole;
  adversaryStrategy: AdversaryStrategy;
  testFocus: string;
}

export async function scheduleAdversarialTest(
  input: ScheduleAdversarialTestInput,
): Promise<{ testId: number }> {
  if (
    !Number.isInteger(input.originalDispatchId) ||
    input.originalDispatchId <= 0
  ) {
    throw new Error(
      `scheduleAdversarialTest: invalid originalDispatchId=${input.originalDispatchId}`,
    );
  }
  if (!ADVERSARY_STRATEGIES.includes(input.adversaryStrategy)) {
    throw new Error(
      `scheduleAdversarialTest: invalid adversaryStrategy=${input.adversaryStrategy}`,
    );
  }
  if (
    typeof input.testFocus !== "string" ||
    input.testFocus.trim().length === 0
  ) {
    throw new Error("scheduleAdversarialTest: testFocus must be non-empty");
  }

  const [inserted] = await db
    .insert(soleneAdversarialTests)
    .values({
      originalDispatchId: input.originalDispatchId,
      originalAgentRole: input.originalAgentRole,
      adversaryStrategy: input.adversaryStrategy,
      testFocus: input.testFocus.trim(),
      status: "pending",
    })
    .returning({ id: soleneAdversarialTests.id });

  if (!inserted) {
    throw new Error("scheduleAdversarialTest: insert returned no id");
  }

  logger.info(
    `[adversarialTests] scheduled testId=${inserted.id} original=${input.originalDispatchId} strategy=${input.adversaryStrategy}`,
  );

  return { testId: inserted.id };
}

// ============================================================================
// enqueueAdversaryDispatch
// ============================================================================

export interface EnqueueAdversaryResult {
  adversarialDispatchId: number | null;
  reason?: string;
}

/**
 * Materialize a pending adversarial-test row into a real queue dispatch.
 * Looks up the original dispatch's commits, builds the strategy-specific
 * attack prompt, and enqueues with sourceType='adversarial_test',
 * agentRole='general-purpose' (adversary is a fresh perspective, not the
 * original role), $15 cap, 8min timeout.
 *
 * Returns { adversarialDispatchId: null, reason: '...' } on any failure
 * pathway — this surface never throws so callers (e.g. cron / detector)
 * can keep advancing.
 */
export async function enqueueAdversaryDispatch(
  testId: number,
): Promise<EnqueueAdversaryResult> {
  // 1. Load the test row.
  const [testRow] = await db
    .select({
      id: soleneAdversarialTests.id,
      originalDispatchId: soleneAdversarialTests.originalDispatchId,
      originalAgentRole: soleneAdversarialTests.originalAgentRole,
      adversaryStrategy: soleneAdversarialTests.adversaryStrategy,
      testFocus: soleneAdversarialTests.testFocus,
      status: soleneAdversarialTests.status,
      adversarialDispatchId: soleneAdversarialTests.adversarialDispatchId,
    })
    .from(soleneAdversarialTests)
    .where(eq(soleneAdversarialTests.id, testId))
    .limit(1);

  if (!testRow) {
    logger.warn(`[adversarialTests] enqueue: test id=${testId} not found`);
    return { adversarialDispatchId: null, reason: "test_not_found" };
  }

  if (testRow.adversarialDispatchId !== null) {
    logger.info(
      `[adversarialTests] enqueue: test id=${testId} already has dispatch id=${testRow.adversarialDispatchId}`,
    );
    return {
      adversarialDispatchId: testRow.adversarialDispatchId,
      reason: "already_enqueued",
    };
  }

  // 2. Pull commits from the original's most recent result row (if any).
  const [resultRow] = await db
    .select({
      commitsReferenced: soleneDispatchResults.commitsReferenced,
    })
    .from(soleneDispatchResults)
    .where(eq(soleneDispatchResults.dispatchId, testRow.originalDispatchId))
    .orderBy(desc(soleneDispatchResults.recordedAt))
    .limit(1);

  const shas: string[] = Array.isArray(resultRow?.commitsReferenced)
    ? resultRow!.commitsReferenced.filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      )
    : [];

  // 3. Build the strategy-specific prompt.
  const promptText = buildAdversaryPrompt({
    strategy: testRow.adversaryStrategy as AdversaryStrategy,
    originalDispatchId: testRow.originalDispatchId,
    originalAgentRole: testRow.originalAgentRole as SoleneDispatchAgentRole,
    testFocus: testRow.testFocus,
    originalCommitShas: shas,
  });

  // 4. Enqueue via the existing dispatch queue. Never let an enqueue throw
  //    propagate — caller is observability/cron, not transactional.
  let adversarialDispatchId: number;
  try {
    adversarialDispatchId = await enqueueDispatch({
      sourceType: "adversarial_test",
      sourceId: `adversarial:${testId}:original:${testRow.originalDispatchId}`,
      agentRole: "general-purpose",
      promptText,
      maxCostUsd: ADVERSARY_MAX_COST_USD,
      timeoutMs: ADVERSARY_TIMEOUT_MS,
      enqueuedBy: `adversarialTests:${testId}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `[adversarialTests] enqueue failed for test id=${testId}: ${msg}`,
    );
    return {
      adversarialDispatchId: null,
      reason: `enqueue_failed: ${msg}`,
    };
  }

  // 5. Stamp the test row.
  await db
    .update(soleneAdversarialTests)
    .set({
      adversarialDispatchId,
      status: "enqueued",
    })
    .where(eq(soleneAdversarialTests.id, testId));

  logger.info(
    `[adversarialTests] enqueued adversary dispatch id=${adversarialDispatchId} for test id=${testId} (strategy=${testRow.adversaryStrategy})`,
  );

  return { adversarialDispatchId };
}

// ============================================================================
// recordAdversaryFindings
// ============================================================================

export interface RecordAdversaryFindingsInput {
  status: "found_issues" | "clean" | "inconclusive";
  findings: string;
  severity?: AdversarialSeverity;
}

export async function recordAdversaryFindings(
  testId: number,
  input: RecordAdversaryFindingsInput,
): Promise<void> {
  if (!ADVERSARIAL_TEST_STATUSES.includes(input.status)) {
    throw new Error(
      `recordAdversaryFindings: invalid status=${input.status}`,
    );
  }
  if (input.status === "found_issues") {
    if (
      input.severity === undefined ||
      !ADVERSARIAL_SEVERITIES.includes(input.severity)
    ) {
      throw new Error(
        `recordAdversaryFindings: status='found_issues' requires a valid severity, got ${input.severity}`,
      );
    }
  }
  if (input.severity !== undefined && input.severity !== null) {
    if (!ADVERSARIAL_SEVERITIES.includes(input.severity)) {
      throw new Error(
        `recordAdversaryFindings: invalid severity=${input.severity}`,
      );
    }
  }
  if (typeof input.findings !== "string") {
    throw new Error("recordAdversaryFindings: findings must be a string");
  }

  const [existing] = await db
    .select({ id: soleneAdversarialTests.id })
    .from(soleneAdversarialTests)
    .where(eq(soleneAdversarialTests.id, testId))
    .limit(1);

  if (!existing) {
    logger.warn(
      `[adversarialTests] recordFindings: test id=${testId} not found`,
    );
    return;
  }

  await db
    .update(soleneAdversarialTests)
    .set({
      status: input.status,
      findings: input.findings,
      severity: input.severity ?? null,
      reportedAt: new Date(),
    })
    .where(eq(soleneAdversarialTests.id, testId));

  logger.info(
    `[adversarialTests] recorded findings for test id=${testId} status=${input.status} severity=${input.severity ?? "n/a"}`,
  );
}

// ============================================================================
// listPendingTests
// ============================================================================

export async function listPendingTests(
  limit: number = 50,
): Promise<AdversarialTestRow[]> {
  const n = Math.min(Math.max(1, Math.floor(limit)), 200);
  const rows = await db
    .select()
    .from(soleneAdversarialTests)
    .where(eq(soleneAdversarialTests.status, "pending"))
    .orderBy(desc(soleneAdversarialTests.createdAt))
    .limit(n);
  return rows;
}

// ============================================================================
// listFindingsByOriginal
// ============================================================================

export async function listFindingsByOriginal(
  originalDispatchId: number,
): Promise<AdversarialTestRow[]> {
  const rows = await db
    .select()
    .from(soleneAdversarialTests)
    .where(eq(soleneAdversarialTests.originalDispatchId, originalDispatchId))
    .orderBy(desc(soleneAdversarialTests.createdAt));
  return rows;
}

// Quiet unused-import warnings for symbols kept for forward use.
void and;
void isNotNull;
void isNull;
void sql;
void soleneDispatchQueue;
