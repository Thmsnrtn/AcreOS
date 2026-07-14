/**
 * SOLENE — generic outcome verification (CP2 of Jarvis Phase 1,
 * "Verified Act-and-Confirm"; founder-approved plan in
 * docs/internal/jarvis-phase0-audit.md).
 *
 * codeReviewQueue verifies CODE (diffs). This is the sibling for OUTCOMES:
 * an independent READ-ONLY dispatch that evaluates a target against the
 * explicit successCriteria attached to it — queries the database, reads
 * files, inspects gates — and ends with the SAME structured block
 * (`VERDICT: passed | flagged` + FINDINGS) so CP1's parseReviewVerdict
 * consumes it unchanged.
 *
 * Wiring:
 *   enqueueVerifyDispatch({ targetKind, targetId, criteria, context })
 *     ├─ eligibility guards (mirrors codeReviewQueue's):
 *     │    · no criteria            → skip ('no_criteria')
 *     │    · dispatch switch OFF    → skip ('dispatch_disabled')
 *     │    · target missing        → skip ('target_not_found')
 *     │    · target IS a verify    → skip ('target_is_verify') — verifiers
 *     │      never verify verifiers (recursion guard)
 *     │    · live verify exists    → skip ('already_verifying')
 *     ├─ enqueue sourceType='verify', sourceId='verify:<kind>:<id>',
 *     │   successCriteria stored ON the verify row (audit trail), plus a
 *     │   computeEffectKey idempotencyKey so a concurrent double-fire dedups
 *     │   at the DB level (rides the existing exactly-once machinery)
 *     └─ import targets: stamp import_jobs.verify_status='pending'
 *
 *   dispatchQueue.completeDispatch()
 *     └─ when the completing dispatch's sourceType='verify', parses the
 *        verdict (CP1's parser, unchanged) and calls recordVerifyOutcome():
 *          · 'verify:dispatch:<id>' → flip target's review_status; on
 *            flagged, fire the existing self-debug chain
 *          · 'verify:import:<jobId>' → land verdict on the import_jobs row
 *            + Letter-visible logActivity(job:'verify')
 *
 * AUTONOMY POSTURE (CP2): verification dispatches are read-only OBSERVERS.
 * The prompt forbids modification (like the review template) and nothing
 * here blocks, fails, or retries the work being verified — imports complete
 * regardless of the verdict. Blocking / act-and-confirm binding is CP3.
 */

import { and, eq, inArray, not } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneDispatchQueue,
  type DispatchSuccessCriterion,
  type SoleneDispatchReviewStatus,
} from "@shared/schema/solene-dispatch";
import { importJobs } from "@shared/schema";
import { computeEffectKey, enqueueDispatch } from "./dispatchQueue";
import { logger } from "../../utils/logger";

// ----------------------------------------------------------------------------
// VERIFY_PROMPT_TEMPLATE
// ----------------------------------------------------------------------------
// Substitutions:
//   {TARGET_LABEL} — e.g. "dispatch #123" or "import job #456"
//   {CONTEXT}      — enqueuer-supplied context (claims to verify, NOT truth)
//   {CRITERIA}     — rendered numbered criteria list (description + check hint)
// ----------------------------------------------------------------------------
export const VERIFY_PROMPT_TEMPLATE = `You are a verification agent dispatched to independently verify the outcome of {TARGET_LABEL}.

Context from the enqueuer (these are CLAIMS to verify, not ground truth):
{CONTEXT}

Success criteria — evaluate EVERY criterion against the ACTUAL state of the
system: run the queries, read the files, and inspect the gates named in each
criterion's check hint (or devise an equivalent read-only check). Do not take
the enqueuer's numbers at face value; confirm them.

{CRITERIA}

For any criterion you cannot actually check with the tools available, say so
explicitly in FINDINGS — never assert a check you did not perform. An
unverifiable criterion is a finding, not a pass.

End your turn with a single structured verdict block:

   VERDICT: passed | flagged
   FINDINGS:
   - <bullet 1>
   - <bullet 2>
   ...

Do NOT modify any files, database rows, or settings. Do NOT commit.
Read-only verification.`;

export type VerifyTargetKind = "dispatch" | "import";

export interface EnqueueVerifyInput {
  targetKind: VerifyTargetKind;
  targetId: number;
  criteria: DispatchSuccessCriterion[];
  /** Short enqueuer-supplied context rendered into the prompt. */
  context?: string;
  /** Override the verify dispatch's cost cap. */
  maxCostUsd?: number;
}

/** Builds the canonical sourceId: 'verify:<targetKind>:<targetId>'. */
export function buildVerifySourceId(
  targetKind: VerifyTargetKind,
  targetId: number,
): string {
  return `verify:${targetKind}:${targetId}`;
}

/** Inverse of buildVerifySourceId — null when the sourceId isn't ours. */
export function parseVerifySourceId(
  sourceId: string,
): { targetKind: VerifyTargetKind; targetId: number } | null {
  const m = sourceId.match(/^verify:(dispatch|import):(\d+)$/);
  if (!m) return null;
  return { targetKind: m[1] as VerifyTargetKind, targetId: Number(m[2]) };
}

/** Renders the verify prompt — exported for tests + observability. */
export function buildVerifyPrompt(opts: {
  targetKind: VerifyTargetKind;
  targetId: number;
  criteria: DispatchSuccessCriterion[];
  context?: string;
}): string {
  const label =
    opts.targetKind === "dispatch"
      ? `dispatch #${opts.targetId}`
      : `import job #${opts.targetId}`;
  const criteriaText = opts.criteria
    .map((c, i) => {
      const check = c.check ? `\n   check: ${c.check}` : "";
      return `${i + 1}. [${c.id}] ${c.description}${check}`;
    })
    .join("\n");
  return VERIFY_PROMPT_TEMPLATE.replace(/\{TARGET_LABEL\}/g, label)
    .replace(/\{CONTEXT\}/g, (opts.context ?? "(none provided)").slice(0, 1000))
    .replace(/\{CRITERIA\}/g, criteriaText);
}

// ----------------------------------------------------------------------------
// enqueueVerifyDispatch
// ----------------------------------------------------------------------------

export type EnqueueVerifySkipReason =
  | "no_criteria"
  | "dispatch_disabled"
  | "target_not_found"
  | "target_is_verify"
  | "already_verifying"
  | "enqueue_failed";

export interface EnqueueVerifyResult {
  verifyDispatchId: number | null;
  skipped: boolean;
  skipReason?: EnqueueVerifySkipReason;
}

const VERIFY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — reads only, no build loop
const VERIFY_PRIORITY = 1.2; // above default work, below self-debug (1.5)
/** Default cap for import verifications (no original cap to halve). */
export const VERIFY_IMPORT_COST_USD = 2.5;

/**
 * Enqueue a read-only verification dispatch for `targetKind`/`targetId`
 * against the supplied criteria. Never throws — enqueue failures are logged
 * and surfaced as skipped so callers can stay fire-and-forget.
 */
export async function enqueueVerifyDispatch(
  input: EnqueueVerifyInput,
): Promise<EnqueueVerifyResult> {
  const { targetKind, targetId, criteria } = input;
  const sourceId = buildVerifySourceId(targetKind, targetId);

  try {
    // 1. No criteria, nothing to verify — an empty verify would be theater.
    if (!Array.isArray(criteria) || criteria.length === 0) {
      logger.info(`[verifyQueue] skip ${sourceId} — no criteria supplied`);
      return { verifyDispatchId: null, skipped: true, skipReason: "no_criteria" };
    }

    // 2. Master-switch guard — when dispatch is disabled (founder OFF /
    //    panic stop), verification quietly stands down like every other
    //    autonomous enqueue path.
    const { isDispatchEnabled } = await import("../autopilot/settings");
    if (!(await isDispatchEnabled())) {
      logger.info(`[verifyQueue] skip ${sourceId} — dispatch disabled`);
      return {
        verifyDispatchId: null,
        skipped: true,
        skipReason: "dispatch_disabled",
      };
    }

    // 3. Target existence + recursion guard.
    let targetDispatchCap: number | null = null;
    if (targetKind === "dispatch") {
      const [target] = await db
        .select({
          id: soleneDispatchQueue.id,
          sourceType: soleneDispatchQueue.sourceType,
          maxCostUsd: soleneDispatchQueue.maxCostUsd,
        })
        .from(soleneDispatchQueue)
        .where(eq(soleneDispatchQueue.id, targetId))
        .limit(1);
      if (!target) {
        logger.warn(`[verifyQueue] skip ${sourceId} — target dispatch not found`);
        return {
          verifyDispatchId: null,
          skipped: true,
          skipReason: "target_not_found",
        };
      }
      // Verifiers never verify verifiers — same non-recursion stance as
      // codeReviewQueue's "reviews never trigger reviews of themselves".
      if (target.sourceType === "verify") {
        logger.info(`[verifyQueue] skip ${sourceId} — target IS a verify dispatch`);
        return {
          verifyDispatchId: null,
          skipped: true,
          skipReason: "target_is_verify",
        };
      }
      const cap = Number(target.maxCostUsd);
      targetDispatchCap = Number.isFinite(cap) && cap > 0 ? cap : null;
    } else {
      const [job] = await db
        .select({ id: importJobs.id, organizationId: importJobs.organizationId })
        .from(importJobs)
        .where(eq(importJobs.id, targetId))
        .limit(1);
      if (!job) {
        logger.warn(`[verifyQueue] skip ${sourceId} — import job not found`);
        return {
          verifyDispatchId: null,
          skipped: true,
          skipReason: "target_not_found",
        };
      }
    }

    // 4. Idempotency — a live (non-failed/non-cancelled) verify for this
    //    target already exists. Same lookup shape as selfDebug's.
    const existing = await db
      .select({ id: soleneDispatchQueue.id })
      .from(soleneDispatchQueue)
      .where(
        and(
          eq(soleneDispatchQueue.sourceType, "verify"),
          eq(soleneDispatchQueue.sourceId, sourceId),
          not(inArray(soleneDispatchQueue.status, ["failed", "cancelled"])),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      logger.info(
        `[verifyQueue] skip ${sourceId} — verify already exists (id=${existing[0].id})`,
      );
      return {
        verifyDispatchId: null,
        skipped: true,
        skipReason: "already_verifying",
      };
    }

    // 5. Cost cap — half the target dispatch's cap (verification is lighter
    //    than the work, same ratio as code review), or a small fixed cap for
    //    import targets.
    const maxCostUsd =
      input.maxCostUsd ??
      (targetDispatchCap !== null
        ? Math.max(0.01, targetDispatchCap / 2)
        : VERIFY_IMPORT_COST_USD);

    // 6. Enqueue. The effect-key rides the existing exactly-once machinery so
    //    a concurrent double-fire (two workers completing the same seam)
    //    dedups at the DB level even if both passed the check above.
    const promptText = buildVerifyPrompt({
      targetKind,
      targetId,
      criteria,
      context: input.context,
    });
    const verifyDispatchId = await enqueueDispatch({
      sourceType: "verify",
      sourceId,
      agentRole: "general-purpose",
      promptText,
      maxCostUsd,
      timeoutMs: VERIFY_TIMEOUT_MS,
      priority: VERIFY_PRIORITY,
      enqueuedBy: `verify:auto:${targetKind}:${targetId}`,
      idempotencyKey: computeEffectKey({
        domain: "verify",
        moveKind: targetKind,
        targetId: String(targetId),
        nowMs: Date.now(),
      }),
      // Store the criteria ON the verify row — the audit trail shows exactly
      // what the verifier was asked to check.
      successCriteria: { criteria },
    });

    // 7. Import targets: stamp 'pending' so the jobs surface distinguishes
    //    "verification in flight" from "never verified".
    if (targetKind === "import") {
      await db
        .update(importJobs)
        .set({ verifyStatus: "pending" })
        .where(eq(importJobs.id, targetId));
    }

    logger.info(
      `[verifyQueue] enqueued verify id=${verifyDispatchId} for ${sourceId} (criteria=${criteria.length}, cap=$${maxCostUsd})`,
    );
    return { verifyDispatchId, skipped: false };
  } catch (err) {
    // Observer contract: verification enqueue must never propagate a failure
    // into the seam that requested it (an import completing, a dispatch
    // finishing). Log loudly and stand down.
    logger.warn(
      `[verifyQueue] enqueue failed for ${sourceId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { verifyDispatchId: null, skipped: true, skipReason: "enqueue_failed" };
  }
}

// ----------------------------------------------------------------------------
// recordVerifyOutcome — verdict routing (called from completeDispatch's hook)
// ----------------------------------------------------------------------------

/**
 * Route a completed verify dispatch's parsed verdict to its target:
 *   - 'verify:dispatch:<id>' — flip the target dispatch's review_status
 *     (passed | flagged) and, on flagged, fire the existing self-debug chain
 *     (the same reflex a flagged code review triggers).
 *   - 'verify:import:<jobId>' — write verify_status/verify_findings onto the
 *     import job row and log Letter-visibly via logActivity(job:'verify').
 *
 * Sibling of codeReviewQueue.recordReviewOutcome; that function's lookup
 * rides original_dispatch_id, which verify rows deliberately don't carry
 * (that column means "this row IS a code review of that dispatch"), so
 * routing here is by sourceId. Never throws.
 */
export async function recordVerifyOutcome(
  verifyDispatchId: number,
  outcome: "passed" | "flagged",
  findings?: string,
): Promise<void> {
  const [verifyRow] = await db
    .select({
      id: soleneDispatchQueue.id,
      sourceType: soleneDispatchQueue.sourceType,
      sourceId: soleneDispatchQueue.sourceId,
    })
    .from(soleneDispatchQueue)
    .where(eq(soleneDispatchQueue.id, verifyDispatchId))
    .limit(1);

  if (!verifyRow) {
    logger.warn(
      `[verifyQueue] recordVerifyOutcome: verify id=${verifyDispatchId} not found`,
    );
    return;
  }
  if (verifyRow.sourceType !== "verify") {
    logger.warn(
      `[verifyQueue] recordVerifyOutcome: dispatch id=${verifyDispatchId} is sourceType=${verifyRow.sourceType}, not verify`,
    );
    return;
  }
  const target = parseVerifySourceId(verifyRow.sourceId);
  if (!target) {
    logger.warn(
      `[verifyQueue] recordVerifyOutcome: unparseable sourceId '${verifyRow.sourceId}' on verify id=${verifyDispatchId}`,
    );
    return;
  }

  if (target.targetKind === "dispatch") {
    await db
      .update(soleneDispatchQueue)
      .set({ reviewStatus: outcome satisfies SoleneDispatchReviewStatus })
      .where(eq(soleneDispatchQueue.id, target.targetId));
    logger.info(
      `[verifyQueue] verify id=${verifyDispatchId} verdict=${outcome} -> dispatch id=${target.targetId}${
        findings ? ` (findings: ${findings.slice(0, 200)})` : ""
      }`,
    );
    // Flagged outcome fires the existing self-debug reflex — the target
    // agent introspects on the verifier's findings. Fire-and-forget so the
    // no-throw contract holds.
    if (outcome === "flagged") {
      const targetId = target.targetId;
      import("./selfDebug")
        .then(({ enqueueSelfDebugDispatch }) =>
          enqueueSelfDebugDispatch({
            originalDispatchId: targetId,
            reviewDispatchId: verifyDispatchId,
            findings: findings ?? "",
          }).catch((err) =>
            logger.warn(
              `[verifyQueue] self-debug failed for dispatch=${targetId}`,
              err,
            ),
          ),
        )
        .catch((err) =>
          logger.warn(
            `[verifyQueue] self-debug import failed for dispatch=${targetId}`,
            err,
          ),
        );
    }
    return;
  }

  // targetKind === "import"
  const [job] = await db
    .select({ id: importJobs.id, organizationId: importJobs.organizationId })
    .from(importJobs)
    .where(eq(importJobs.id, target.targetId))
    .limit(1);
  if (!job) {
    logger.warn(
      `[verifyQueue] recordVerifyOutcome: import job id=${target.targetId} not found for verify id=${verifyDispatchId}`,
    );
    return;
  }

  await db
    .update(importJobs)
    .set({
      verifyStatus: outcome,
      verifyFindings: findings ? findings.slice(0, 4000) : null,
    })
    .where(eq(importJobs.id, target.targetId));

  logger.info(
    `[verifyQueue] verify id=${verifyDispatchId} verdict=${outcome} -> import job id=${target.targetId}`,
  );

  // Letter-visible trail. logActivity never throws (its own contract).
  const { logActivity } = await import("../systemActivityLogger");
  await logActivity({
    orgId: job.organizationId,
    job: "verify",
    action: outcome === "passed" ? "import_verify_passed" : "import_verify_flagged",
    summary:
      outcome === "passed"
        ? `Import job #${target.targetId} independently verified: all success criteria passed.`
        : `Import job #${target.targetId} verification FLAGGED: ${(findings ?? "no findings text").slice(0, 300)}`,
    entityType: "import_job",
    entityId: target.targetId,
    metadata: findings ? { findings: findings.slice(0, 2000) } : undefined,
  });
}

// ----------------------------------------------------------------------------
// buildImportVerifyCriteria — the IMPORTS workflow's criteria (gated first)
// ----------------------------------------------------------------------------

/** Flag when failed rows exceed this fraction of attempted rows. */
export const IMPORT_VERIFY_ERROR_RATE_THRESHOLD = 0.05;

export interface ImportVerifyJobFacts {
  jobId: number;
  organizationId: number;
  kind: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  duplicatesSkipped: number;
}

/**
 * Pure. Derive verification criteria from a completed import job's own
 * record. Descriptions are deliberately HONEST about what CAN be checked:
 * imported rows are not stamped with the import-job id, so org-scoping is a
 * sanity check (time-window spot-check), not exact per-row attribution.
 */
export function buildImportVerifyCriteria(
  job: ImportVerifyJobFacts,
): DispatchSuccessCriterion[] {
  const attempted = job.totalRows;
  const criteria: DispatchSuccessCriterion[] = [
    {
      id: `import:${job.jobId}:row-accounting`,
      description:
        `Row accounting: the completed import_jobs row #${job.jobId} reports ` +
        `total_rows=${attempted}, success_count=${job.successCount}, ` +
        `error_count=${job.errorCount}, duplicates_skipped=${job.duplicatesSkipped}. ` +
        `Confirm the persisted row still matches these numbers and that ` +
        `success_count + error_count + duplicates_skipped accounts for every ` +
        `attempted row (= total_rows for CSV-shaped imports).`,
      check:
        `SELECT total_rows, processed_count, success_count, error_count, ` +
        `duplicates_skipped, status FROM import_jobs WHERE id = ${job.jobId}`,
    },
    {
      id: `import:${job.jobId}:error-rate`,
      description:
        attempted > 0
          ? `Error rate: error_count=${job.errorCount} of ${attempted} attempted ` +
            `rows must not exceed ${IMPORT_VERIFY_ERROR_RATE_THRESHOLD * 100}%. ` +
            `Flag if error_count > ${IMPORT_VERIFY_ERROR_RATE_THRESHOLD} * total_rows.`
          : `Error rate: the job record reports 0 attempted rows, so an error ` +
            `rate cannot be computed — flag if error_count=${job.errorCount} is ` +
            `non-zero despite zero attempted rows, otherwise note that this ` +
            `criterion is trivially satisfied.`,
      check: `flag if error_count > ${IMPORT_VERIFY_ERROR_RATE_THRESHOLD} * total_rows on import_jobs id = ${job.jobId}`,
    },
    {
      id: `import:${job.jobId}:org-scoping`,
      description:
        `Org-scoping sanity: every row this import inserted must carry ` +
        `organization_id=${job.organizationId}. HONEST LIMIT: imported ` +
        `'${job.kind}' rows are NOT stamped with the import-job id, so exact ` +
        `per-row attribution is not possible — instead spot-check that ` +
        `recently created '${job.kind}' rows for organization ` +
        `${job.organizationId} exist in plausible numbers around the job's ` +
        `started_at→completed_at window, and report (do not guess) if the ` +
        `target table cannot be checked this way.`,
      check:
        `spot-check created_at within the job window against the '${job.kind}' ` +
        `table, filtered by organization_id = ${job.organizationId}`,
    },
  ];
  return criteria;
}
