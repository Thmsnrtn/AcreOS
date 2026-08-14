/**
 * Compliance Gate Middleware
 *
 * Blocks deal/note operations when compliance violations are detected.
 * Violations are logged to the audit trail with the user's override decision.
 *
 * This does NOT block operations outright — it adds a warning header and
 * logs the event. The founder can configure strict mode via COMPLIANCE_STRICT_MODE=true
 * to actually block operations with violations.
 *
 * STRICT MODE USED TO FAIL OPEN, WHICH UNDID IT (fixed 2026-08-14).
 * ----------------------------------------------------------------
 * One `try` wrapped the whole middleware and its catch called `next()` under the
 * comment *"Compliance gate should never block normal operation on error"*. That
 * is right for the ADVISORY default and wrong for strict mode, where the gate's
 * entire promise is to block. A `checkUsury` throw meant an operation with a
 * usury violation proceeded — in the mode configured to stop it.
 *
 * The audit write sat inside the same `try`, BEFORE the block, so a failure
 * writing the record also skipped the block: the two things that make strict
 * mode meaningful — the refusal and the evidence — failed together, silently,
 * in the permitting direction.
 *
 * Now: warnings are collected in their own try; a failure to DETERMINE
 * compliance refuses with 503 in strict mode and falls open in advisory mode as
 * designed; the audit write has its own try, and a failure to RECORD refuses in
 * strict mode only. "We could not check" is not "there is nothing to find".
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import { Errors } from "../utils/errors";

export interface ComplianceWarning {
  type: "dodd_frank" | "usury" | "tcpa";
  severity: "info" | "warning" | "violation";
  message: string;
  recommendation: string;
}

/**
 * Check and log compliance status for note/deal operations.
 * In strict mode (COMPLIANCE_STRICT_MODE=true), blocks operations with violations.
 * In normal mode, adds X-Compliance-Warnings header and logs to audit trail.
 */
export function complianceGate(checkType: "note" | "deal") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const isStrictMode = process.env.COMPLIANCE_STRICT_MODE === "true";
    let warnings: ComplianceWarning[];

    // ── 1. DETERMINE ────────────────────────────────────────────────────────
    try {
      warnings = await collectWarnings(checkType, req);
    } catch (err) {
      logger.error("[complianceGate] Error during compliance check", err);
      if (isStrictMode) {
        return Errors.serviceUnavailable(
          res,
          "Compliance could not be verified. This is not a clearance — strict mode refuses rather than proceed on an unchecked operation.",
        );
      }
      (req as Request & { complianceWarnings?: ComplianceWarning[] }).complianceWarnings = [];
      return next();
    }

    // ── 2. RECORD ───────────────────────────────────────────────────────────
    if (warnings.length > 0) {
      res.setHeader("X-Compliance-Warnings", JSON.stringify(warnings));

      const org = req.organization;
      if (org) {
        try {
          const user = req.user as { id?: string } | undefined;
          const { storage } = await import("../storage");
          await storage.createAuditLogEntry({
            organizationId: org.id,
            userId: user?.id,
            action: "compliance_check",
            entityType: checkType,
            entityId: 0,
            changes: { after: { warnings, strictMode: isStrictMode } } as any,
            ipAddress: req.ip || req.socket?.remoteAddress,
            userAgent: req.headers["user-agent"],
          });
        } catch (err) {
          // Its OWN try, and this is the point: the audit write used to sit in
          // the same block as the decision below, so a failed INSERT skipped the
          // refusal. In strict mode the record is half the promise — a blocked
          // violation nobody can evidence is not much better than an unblocked
          // one — so a failure to record refuses too.
          logger.error("[complianceGate] Failed to record the compliance event", err);
          if (isStrictMode) {
            return Errors.serviceUnavailable(
              res,
              "The compliance check ran but could not be recorded. Strict mode refuses rather than proceed with an unevidenced operation.",
            );
          }
        }
      }
    }

    // ── 3. DECIDE ───────────────────────────────────────────────────────────
    if (isStrictMode && warnings.some((w) => w.severity === "violation")) {
      return res.status(422).json({
        message: "Compliance violation detected. Operation blocked in strict mode.",
        warnings,
        overrideInstructions: "Set X-Compliance-Override header with founder approval token to proceed.",
      });
    }

    (req as Request & { complianceWarnings?: ComplianceWarning[] }).complianceWarnings = warnings;
    next();
  };
}

/**
 * The checks themselves, extracted so the middleware can tell "the check threw"
 * from "the record threw" — two failures that used to share one catch and one
 * permissive outcome.
 */
async function collectWarnings(
  checkType: "note" | "deal",
  req: Request,
): Promise<ComplianceWarning[]> {
  const warnings: ComplianceWarning[] = [];

  if (checkType === "note") {
    const { interestRate, state } = req.body ?? {};
    if (interestRate && state) {
      const { checkUsury } = await import("../services/usury");
      const result = checkUsury(state, parseFloat(interestRate));
      if (result.warningLevel === "violation") {
        warnings.push({
          type: "usury",
          severity: "violation",
          message: `Interest rate ${interestRate}% may violate ${state} usury law (max: ${result.maxAllowedRate}%)`,
          recommendation: "Consult a licensed attorney before proceeding.",
        });
      } else if (result.warningLevel === "warning") {
        warnings.push({
          type: "usury",
          severity: "warning",
          message: `Interest rate ${interestRate}% is near ${state} usury limit (max: ${result.maxAllowedRate}%)`,
          recommendation: "Consider reducing the rate to maintain a safety margin.",
        });
      }
    }
  }

  if (checkType === "deal") {
    const body = req.body ?? {};
    if (body.type === "disposition" && body.isSellerFinanced) {
      warnings.push({
        type: "dodd_frank",
        severity: "info",
        message: "Seller-financed disposition detected. Dodd-Frank/TILA compliance review recommended.",
        recommendation: "Run full Dodd-Frank compliance check before closing.",
      });
    }
  }

  return warnings;
}
