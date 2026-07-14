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
 *          · 'verify:mailShipment:<id>' → land verdict on the mail_shipments
 *            row + Letter-visible logActivity(job:'verify')   (CP3)
 *          · 'verify:dunningEvent:<id>' → Letter-visible
 *            logActivity(job:'verify') only — read-only, no columns  (CP3)
 *
 * AUTONOMY POSTURE (CP2 → CP3): verification dispatches are read-only
 * OBSERVERS. The prompt forbids modification (like the review template) and
 * nothing here blocks, fails, or retries the work being verified — imports
 * complete, mail stays sent, dunning actions stand, regardless of the
 * verdict. CP3 adds the act-and-confirm COUPLING without adding blocking:
 * a verdict on a dispatch in a known autopilot domain feeds the Trust
 * Ledger (applyVerifiedTrustEvidence → domainAutonomy.recordVerifiedOutcome),
 * so verified outcomes now weigh into the same clean-cycle evidence
 * promotions require — and a flagged verdict costs trust through the
 * existing circuit-breaker demotion. Enforcement remains observe-only for
 * the actions themselves.
 */

import { and, eq, inArray, not } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneDispatchQueue,
  type DispatchSuccessCriterion,
  type SoleneDispatchReviewStatus,
} from "@shared/schema/solene-dispatch";
import { dunningEvents, importJobs, mailShipments, organizations } from "@shared/schema";
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

export type VerifyTargetKind = "dispatch" | "import" | "mailShipment" | "dunningEvent";

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
  const m = sourceId.match(/^verify:(dispatch|import|mailShipment|dunningEvent):(\d+)$/);
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
  const labels: Record<VerifyTargetKind, string> = {
    dispatch: `dispatch #${opts.targetId}`,
    import: `import job #${opts.targetId}`,
    mailShipment: `mail shipment #${opts.targetId}`,
    dunningEvent: `dunning event #${opts.targetId}`,
  };
  const label = labels[opts.targetKind];
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
/** Default cap for non-dispatch verifications — imports, mail shipments,
 *  dunning events — where there is no original dispatch cap to halve. */
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
    } else if (targetKind === "import") {
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
    } else if (targetKind === "mailShipment") {
      const [ship] = await db
        .select({ id: mailShipments.id })
        .from(mailShipments)
        .where(eq(mailShipments.id, targetId))
        .limit(1);
      if (!ship) {
        logger.warn(`[verifyQueue] skip ${sourceId} — mail shipment not found`);
        return {
          verifyDispatchId: null,
          skipped: true,
          skipReason: "target_not_found",
        };
      }
    } else {
      const [event] = await db
        .select({ id: dunningEvents.id })
        .from(dunningEvents)
        .where(eq(dunningEvents.id, targetId))
        .limit(1);
      if (!event) {
        logger.warn(`[verifyQueue] skip ${sourceId} — dunning event not found`);
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
    //    non-dispatch targets (imports, mail shipments, dunning events).
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

    // 7. Import + mail-shipment targets: stamp 'pending' so their surfaces
    //    distinguish "verification in flight" from "never verified".
    if (targetKind === "import") {
      await db
        .update(importJobs)
        .set({ verifyStatus: "pending" })
        .where(eq(importJobs.id, targetId));
    } else if (targetKind === "mailShipment") {
      await db
        .update(mailShipments)
        .set({ verifyStatus: "pending" })
        .where(eq(mailShipments.id, targetId));
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
 *     (the same reflex a flagged code review triggers). CP3: the verdict is
 *     also fed to the Trust Ledger (applyVerifiedTrustEvidence) when the
 *     target dispatch maps to a known autopilot domain.
 *   - 'verify:import:<jobId>' — write verify_status/verify_findings onto the
 *     import job row and log Letter-visibly via logActivity(job:'verify').
 *   - 'verify:mailShipment:<id>' — write verify_status/verify_findings onto
 *     the mail_shipments row and log Letter-visibly (CP3).
 *   - 'verify:dunningEvent:<id>' — log Letter-visibly only; dunning_events
 *     carries no verify columns by design (CP3, read-only observer).
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
    // CP3 — the act-and-confirm coupling: a verdict on a dispatch feeds the
    // Trust Ledger when the dispatch maps to a known autopilot domain.
    // Fire-and-forget so the verdict write above stands regardless;
    // applyVerifiedTrustEvidence never throws.
    void applyVerifiedTrustEvidence({
      targetDispatchId: target.targetId,
      outcome,
      verdictDispatchId: verifyDispatchId,
      via: "verify",
      findings,
    });
    return;
  }

  if (target.targetKind === "mailShipment") {
    const [ship] = await db
      .select({ id: mailShipments.id, organizationId: mailShipments.organizationId })
      .from(mailShipments)
      .where(eq(mailShipments.id, target.targetId))
      .limit(1);
    if (!ship) {
      logger.warn(
        `[verifyQueue] recordVerifyOutcome: mail shipment id=${target.targetId} not found for verify id=${verifyDispatchId}`,
      );
      return;
    }

    await db
      .update(mailShipments)
      .set({
        verifyStatus: outcome,
        verifyFindings: findings ? findings.slice(0, 4000) : null,
      })
      .where(eq(mailShipments.id, target.targetId));

    logger.info(
      `[verifyQueue] verify id=${verifyDispatchId} verdict=${outcome} -> mail shipment id=${target.targetId}`,
    );

    const { logActivity } = await import("../systemActivityLogger");
    await logActivity({
      orgId: ship.organizationId,
      job: "verify",
      action:
        outcome === "passed" ? "mail_shipment_verify_passed" : "mail_shipment_verify_flagged",
      summary:
        outcome === "passed"
          ? `Mail shipment #${target.targetId} independently verified: piece accounting, debit ledger, and compliance posture all passed.`
          : `Mail shipment #${target.targetId} verification FLAGGED: ${(findings ?? "no findings text").slice(0, 300)}`,
      entityType: "mail_shipment",
      entityId: target.targetId,
      metadata: findings ? { findings: findings.slice(0, 2000) } : undefined,
    });
    return;
  }

  if (target.targetKind === "dunningEvent") {
    const [event] = await db
      .select({ id: dunningEvents.id, organizationId: dunningEvents.organizationId })
      .from(dunningEvents)
      .where(eq(dunningEvents.id, target.targetId))
      .limit(1);
    if (!event) {
      logger.warn(
        `[verifyQueue] recordVerifyOutcome: dunning event id=${target.targetId} not found for verify id=${verifyDispatchId}`,
      );
      return;
    }

    logger.info(
      `[verifyQueue] verify id=${verifyDispatchId} verdict=${outcome} -> dunning event id=${target.targetId}`,
    );

    // Letter-visible trail only — dunning_events deliberately carries no
    // verify columns (the verdict lives on the verify dispatch row + here).
    const { logActivity } = await import("../systemActivityLogger");
    await logActivity({
      orgId: event.organizationId,
      job: "verify",
      action: outcome === "passed" ? "dunning_verify_passed" : "dunning_verify_flagged",
      summary:
        outcome === "passed"
          ? `Dunning event #${target.targetId} independently verified: status transition, org dunning state, and ledger posture all consistent.`
          : `Dunning event #${target.targetId} verification FLAGGED: ${(findings ?? "no findings text").slice(0, 300)}`,
      entityType: "dunning_event",
      entityId: target.targetId,
      metadata: findings ? { findings: findings.slice(0, 2000) } : undefined,
    });
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
// applyVerifiedTrustEvidence — CP3: verdicts feed the Trust Ledger
// ----------------------------------------------------------------------------

export type VerifiedEvidenceVia = "verify" | "code_review";

export interface ApplyTrustEvidenceInput {
  /** The dispatch whose work was verified/reviewed (NOT the verifier). */
  targetDispatchId: number;
  outcome: "passed" | "flagged";
  /** The verify/review dispatch that produced the verdict (audit trail). */
  verdictDispatchId: number;
  via: VerifiedEvidenceVia;
  findings?: string;
}

export interface ApplyTrustEvidenceResult {
  applied: boolean;
  domain?: string;
  skipReason?: "target_not_found" | "no_domain" | "error";
}

/**
 * CP3 of Jarvis Phase 1 — bind an independent verdict (verify OR code review)
 * to the per-domain Trust Ledger. This is the act-and-confirm coupling:
 * a PASSED verdict on a dispatch in domain X counts as a verified clean cycle
 * toward that domain's promotion; a FLAGGED verdict is a bounce through the
 * EXISTING circuit-breaker demotion (domainAutonomy.recordAnomaly — no
 * parallel ledger).
 *
 * HONEST MAPPING: the dispatch row carries no domain column; the only honest
 * derivation is act.ts's autopilot sourceId convention + an explicitly-known
 * move binding (domainForDispatch). A dispatch that maps to no domain —
 * founder/manual dispatches, non-autopilot sources, unknown move kinds —
 * contributes NOTHING (skip with a debug log); we never guess.
 *
 * Nothing is loosened: unverified completions still earn exactly what the
 * existing applyAutonomyFeedback edge granted them; this only ADDS verified
 * evidence. Never throws (fire-and-forget contract — a trust-ledger hiccup
 * must never fail the verdict write that triggered it).
 */
export async function applyVerifiedTrustEvidence(
  input: ApplyTrustEvidenceInput,
): Promise<ApplyTrustEvidenceResult> {
  try {
    const [target] = await db
      .select({
        sourceType: soleneDispatchQueue.sourceType,
        sourceId: soleneDispatchQueue.sourceId,
      })
      .from(soleneDispatchQueue)
      .where(eq(soleneDispatchQueue.id, input.targetDispatchId))
      .limit(1);
    if (!target) {
      logger.debug(
        `[verifyQueue] trust evidence skip — target dispatch id=${input.targetDispatchId} not found`,
      );
      return { applied: false, skipReason: "target_not_found" };
    }

    const { domainForDispatch } = await import("../autopilot/act");
    const domain = domainForDispatch({
      sourceType: target.sourceType,
      sourceId: target.sourceId,
    });
    if (!domain) {
      // No honest domain — do NOT guess. Founder/manual work, reviews,
      // verifies, and unknown move kinds earn/cost no domain trust.
      logger.debug(
        `[verifyQueue] trust evidence skip — dispatch id=${input.targetDispatchId} (source=${target.sourceType}:${target.sourceId}) carries no known autopilot domain`,
      );
      return { applied: false, skipReason: "no_domain" };
    }

    const { recordVerifiedOutcome } = await import("../autopilot/domainAutonomy");
    await recordVerifiedOutcome(
      domain,
      input.outcome === "passed",
      `${input.via} dispatch #${input.verdictDispatchId} verdict=${input.outcome} on dispatch #${input.targetDispatchId}${
        input.findings ? `: ${input.findings.slice(0, 200)}` : ""
      }`,
    );
    logger.info(
      `[verifyQueue] trust evidence applied — domain=${domain} outcome=${input.outcome} via=${input.via} target=${input.targetDispatchId} verdictDispatch=${input.verdictDispatchId}`,
    );
    return { applied: true, domain };
  } catch (err) {
    logger.warn(
      `[verifyQueue] trust evidence failed for dispatch id=${input.targetDispatchId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { applied: false, skipReason: "error" };
  }
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

// ----------------------------------------------------------------------------
// CP3 — OUTREACH MAIL criteria (verify after a shipment actually SENDS)
// ----------------------------------------------------------------------------

export interface MailShipmentVerifyFacts {
  shipmentId: number;
  organizationId: number;
  /** The quote-locked piece count persisted at queue time. */
  pieceCount: number;
  debitEventKey: string | null;
  debitedCents: number | null;
  /** The org's subscription tier at verify-enqueue time (lowercased). */
  orgTier: string;
  provider: string | null;
}

/**
 * Pure. Derive verification criteria from a SENT mail shipment's own record.
 * Descriptions are deliberately HONEST about what CAN be checked from DB
 * state — and explicit about what CANNOT:
 *   - the recent-mail dedupe (>20% recently-mailed) is an advisory UX warning
 *     at compose time, never an enforced gate, so it is not verifiable as a
 *     control;
 *   - no suppression list is applied on the outreach-mail path today, so
 *     suppression cannot be asserted;
 *   - the physical delivery of pieces is a provider/USPS fact, not a DB fact.
 */
export function buildMailShipmentVerifyCriteria(
  f: MailShipmentVerifyFacts,
): DispatchSuccessCriterion[] {
  const isFree = f.orgTier === "free";
  const criteria: DispatchSuccessCriterion[] = [
    {
      id: `mailShipment:${f.shipmentId}:piece-accounting`,
      description:
        `Piece accounting: mail_shipments row #${f.shipmentId} was reported ` +
        `SENT with the quote-locked piece_count=${f.pieceCount}` +
        `${f.provider ? ` via provider '${f.provider}'` : ""}. Confirm the ` +
        `persisted row reads status='sent' with sent_at set, and that the ` +
        `count of mail_shipment_pieces rows for this shipment with ` +
        `status='sent' equals piece_count=${f.pieceCount}. Flag any pieces ` +
        `still 'pending' or 'failed' under a 'sent' shipment. HONEST LIMIT: ` +
        `physical delivery is a provider/USPS fact — only the recorded send ` +
        `state is checkable here.`,
      check:
        `SELECT status, sent_at, piece_count, provider FROM mail_shipments ` +
        `WHERE id = ${f.shipmentId}; SELECT status, count(*) FROM ` +
        `mail_shipment_pieces WHERE shipment_id = ${f.shipmentId} GROUP BY status`,
    },
    {
      id: `mailShipment:${f.shipmentId}:debit-ledger`,
      description:
        f.debitEventKey
          ? `Debit-ledger consistency: the enqueue debit ` +
            `(debited_cents=${f.debitedCents ?? 0}, ` +
            `debit_event_key='${f.debitEventKey}') must be recorded in ` +
            `financial_ledger under external_event_id='${f.debitEventKey}', ` +
            `and — because the shipment SENT — the refund row ` +
            `external_event_id='${f.debitEventKey}:refund' must be ABSENT ` +
            `(refunds accompany only failure/cancel; a sent shipment keeps ` +
            `its charge).`
          : `Debit-ledger consistency: this shipment persisted NO ` +
            `debit_event_key (legacy or zero-debit row), so the exact ledger ` +
            `draw is NOT attributable — report this limit rather than ` +
            `guessing. Flag only if debited_cents=${f.debitedCents ?? 0} is ` +
            `positive while the key is missing (a draw that can never be ` +
            `refunded is the inconsistency).`,
      check: f.debitEventKey
        ? `SELECT external_event_id, amount_cents FROM financial_ledger WHERE ` +
          `external_event_id IN ('${f.debitEventKey}', '${f.debitEventKey}:refund')`
        : `SELECT debit_event_key, debited_cents FROM mail_shipments WHERE id = ${f.shipmentId}`,
    },
    {
      id: `mailShipment:${f.shipmentId}:compliance-posture`,
      description:
        (isFree
          ? `Compliance posture: organization ${f.organizationId} was on the ` +
            `FREE tier, whose lifetime mail allowance is capped. Confirm the ` +
            `org's total non-cancelled mail_shipments.piece_count sum does ` +
            `not exceed the free lifetime cap (FREE_TIER_LIFETIME_PIECES in ` +
            `server/routes-outreach-mail.ts — read the constant from source, ` +
            `do not assume its value). HONEST LIMIT: a founder-queued send ` +
            `legitimately bypasses the cap and the shipment row does not ` +
            `record founder status — report an overage as a finding to ` +
            `investigate, not as proof of a breach. `
          : `Compliance posture: organization ${f.organizationId} was on the ` +
            `'${f.orgTier}' (paid) tier, so the free lifetime cap does not ` +
            `apply; the enforced control on this path is the credit-pool ` +
            `debit (previous criterion). `) +
        `FURTHER HONEST LIMITS (state, do not assert): the recent-mail ` +
        `dedupe (>20% recently-mailed warning) is advisory UX only — never ` +
        `an enforced gate — and NO suppression list is applied on the ` +
        `outreach-mail path today; neither can be verified as a control ` +
        `from DB state.`,
      check: isFree
        ? `SELECT coalesce(sum(piece_count), 0) FROM mail_shipments WHERE ` +
          `organization_id = ${f.organizationId} AND status != 'cancelled'; ` +
          `compare against FREE_TIER_LIFETIME_PIECES in server/routes-outreach-mail.ts`
        : `SELECT subscription_tier FROM organizations WHERE id = ${f.organizationId}`,
    },
  ];
  return criteria;
}

/**
 * CP3 seam for the mail flusher: after a shipment actually SENDS, enqueue a
 * READ-ONLY verify dispatch with criteria derived from the shipment's own
 * record. Fire-and-forget by contract — never throws, never fails the send
 * (the shipment is already sent; verification only observes).
 */
export async function enqueueMailShipmentVerify(
  shipmentId: number,
): Promise<EnqueueVerifyResult> {
  try {
    const [ship] = await db
      .select({
        id: mailShipments.id,
        organizationId: mailShipments.organizationId,
        pieceCount: mailShipments.pieceCount,
        debitEventKey: mailShipments.debitEventKey,
        debitedCents: mailShipments.debitedCents,
        provider: mailShipments.provider,
      })
      .from(mailShipments)
      .where(eq(mailShipments.id, shipmentId))
      .limit(1);
    if (!ship) {
      logger.warn(
        `[verifyQueue] enqueueMailShipmentVerify: shipment id=${shipmentId} not found`,
      );
      return { verifyDispatchId: null, skipped: true, skipReason: "target_not_found" };
    }
    const [org] = await db
      .select({ tier: organizations.subscriptionTier })
      .from(organizations)
      .where(eq(organizations.id, ship.organizationId))
      .limit(1);

    const criteria = buildMailShipmentVerifyCriteria({
      shipmentId: ship.id,
      organizationId: ship.organizationId,
      pieceCount: ship.pieceCount,
      debitEventKey: ship.debitEventKey,
      debitedCents: ship.debitedCents,
      orgTier: (org?.tier ?? "free").toLowerCase(),
      provider: ship.provider,
    });
    return await enqueueVerifyDispatch({
      targetKind: "mailShipment",
      targetId: shipmentId,
      criteria,
      context:
        `mailFlusher reports shipment #${shipmentId} sent ` +
        `(${ship.pieceCount} pieces${ship.provider ? ` via ${ship.provider}` : ""}, ` +
        `org ${ship.organizationId}).`,
    });
  } catch (err) {
    logger.warn(
      `[verifyQueue] enqueueMailShipmentVerify failed for shipment=${shipmentId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { verifyDispatchId: null, skipped: true, skipReason: "enqueue_failed" };
  }
}

// ----------------------------------------------------------------------------
// CP3 — NOTE-VERTICAL / DUNNING criteria (verify after a witnessed hand acts)
// ----------------------------------------------------------------------------

export type DunningHandAction = "retry" | "resolve" | "cancel";

/** The resolution_type each successful hand action writes (dunningService). */
export const DUNNING_EXPECTED_RESOLUTION: Record<DunningHandAction, string> = {
  retry: "manual_payment",
  cancel: "subscription_cancelled",
  resolve: "escalated",
};

export interface DunningVerifyFacts {
  eventId: number;
  organizationId: number;
  action: DunningHandAction;
}

/**
 * Pure. Derive verification criteria for a dunning event AFTER the witnessed
 * dunning_action hand reported success. HONEST about the limits:
 *   - the hand's manual paths do not increment retry_count (only the
 *     auto-retry ladder does), so a missing attempt marker on a
 *     hand-initiated retry is a documented limit, not a finding;
 *   - the Stripe-side charge outcome is not checkable from this database
 *     (the later invoice webhook is the closing signal);
 *   - another open dunning case can legitimately keep the org's dunning
 *     stage set.
 */
export function buildDunningVerifyCriteria(
  f: DunningVerifyFacts,
): DispatchSuccessCriterion[] {
  const expectedResolution = DUNNING_EXPECTED_RESOLUTION[f.action];
  return [
    {
      id: `dunningEvent:${f.eventId}:status-transition`,
      description:
        `Status transition: after a successful '${f.action}' the ` +
        `dunning_events row #${f.eventId} must read status='resolved' with ` +
        `resolved_at set and resolution_type='${expectedResolution}'. ` +
        `HONEST LIMIT: the witnessed hand's paths do NOT increment ` +
        `retry_count (only the auto-retry ladder stamps that attempt ` +
        `marker), so do not flag a missing retry_count bump on a ` +
        `hand-initiated '${f.action}' — report the limit instead.`,
      check:
        `SELECT status, resolved_at, resolution_type, retry_count FROM ` +
        `dunning_events WHERE id = ${f.eventId}`,
    },
    {
      id: `dunningEvent:${f.eventId}:org-state`,
      description:
        `Org dunning state coherent: a resolved case clears the org's ` +
        `posture — organizations.dunning_stage must be 'none' (and ` +
        `dunning_started_at NULL) for organization ${f.organizationId} — ` +
        `UNLESS another OPEN dunning event (status 'pending' or ` +
        `'scheduled_retry') exists for the same org, which legitimately ` +
        `keeps a stage set. Check for open siblings BEFORE flagging.`,
      check:
        `SELECT dunning_stage, dunning_started_at FROM organizations WHERE ` +
        `id = ${f.organizationId}; SELECT count(*) FROM dunning_events WHERE ` +
        `organization_id = ${f.organizationId} AND status IN ` +
        `('pending', 'scheduled_retry')`,
    },
    {
      id: `dunningEvent:${f.eventId}:ledger`,
      description:
        `Ledger untouched-or-consistent: the dunning hand moves money in ` +
        `STRIPE, not in the internal ledger — confirm no financial_ledger ` +
        `rows were written for this action (none reference dunning event ` +
        `#${f.eventId} in external_event_id or notes). HONEST LIMIT: the ` +
        `Stripe-side charge outcome is NOT checkable from this database; ` +
        `the later invoice webhook is the closing signal — report it as out ` +
        `of scope rather than asserting it.`,
      check:
        `SELECT count(*) FROM financial_ledger WHERE external_event_id ` +
        `ILIKE '%dunning%${f.eventId}%' OR notes ILIKE '%dunning event ${f.eventId}%'`,
    },
  ];
}

/**
 * CP3 seam for the witnessed dunning_action hand: after the hand reports
 * success, enqueue a READ-ONLY verify dispatch over the dunning event's
 * post-action state. Fire-and-forget by contract — never throws, never
 * fails the hand (the action already happened; verification only observes).
 */
export async function enqueueDunningEventVerify(
  eventId: number,
  action: DunningHandAction,
): Promise<EnqueueVerifyResult> {
  try {
    const [event] = await db
      .select({ id: dunningEvents.id, organizationId: dunningEvents.organizationId })
      .from(dunningEvents)
      .where(eq(dunningEvents.id, eventId))
      .limit(1);
    if (!event) {
      logger.warn(
        `[verifyQueue] enqueueDunningEventVerify: dunning event id=${eventId} not found`,
      );
      return { verifyDispatchId: null, skipped: true, skipReason: "target_not_found" };
    }
    const criteria = buildDunningVerifyCriteria({
      eventId,
      organizationId: event.organizationId,
      action,
    });
    return await enqueueVerifyDispatch({
      targetKind: "dunningEvent",
      targetId: eventId,
      criteria,
      context:
        `witnessed dunning_action hand reports '${action}' succeeded on ` +
        `dunning event #${eventId} (org ${event.organizationId}).`,
    });
  } catch (err) {
    logger.warn(
      `[verifyQueue] enqueueDunningEventVerify failed for event=${eventId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { verifyDispatchId: null, skipped: true, skipReason: "enqueue_failed" };
  }
}
