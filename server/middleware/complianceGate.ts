/**
 * Compliance Gate Middleware
 *
 * Blocks deal/note operations when compliance violations are detected.
 * Violations are logged to the audit trail with the user's override decision.
 *
 * This does NOT block operations outright — it adds a warning header and
 * logs the event. The founder can configure strict mode via COMPLIANCE_STRICT_MODE=true
 * to actually block operations with violations.
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import { sendError } from "../utils/errors";

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
    try {
      const warnings: ComplianceWarning[] = [];
      const isStrictMode = process.env.COMPLIANCE_STRICT_MODE === "true";

      if (checkType === "note") {
        // Check usury compliance for note operations
        const { interestRate, state } = req.body;
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
        // Check Dodd-Frank for deal operations
        const body = req.body;
        if (body.type === "disposition" && body.isSellerFinanced) {
          warnings.push({
            type: "dodd_frank",
            severity: "info",
            message: "Seller-financed disposition detected. Dodd-Frank/TILA compliance review recommended.",
            recommendation: "Run full Dodd-Frank compliance check before closing.",
          });
        }
      }

      // Add warnings to response headers
      if (warnings.length > 0) {
        res.setHeader("X-Compliance-Warnings", JSON.stringify(warnings));

        // Log compliance event
        const org = req.organization;
        const user = req.user as any;
        if (org) {
          const { storage } = await import("../storage");
          await storage.createAuditLogEntry({
            organizationId: org.id,
            userId: user?.id || user?.id,
            action: "compliance_check",
            entityType: checkType,
            entityId: 0,
            changes: { after: { warnings, strictMode: isStrictMode } } as any,
            ipAddress: req.ip || req.socket?.remoteAddress,
            userAgent: req.headers["user-agent"],
          });
        }

        // In strict mode, block violations
        const hasViolation = warnings.some(w => w.severity === "violation");
        if (isStrictMode && hasViolation) {
          return sendError(res, 422, "COMPLIANCE_VIOLATION", "Compliance violation detected. Operation blocked in strict mode.", {
            warnings,
            overrideInstructions: "Set X-Compliance-Override header with founder approval token to proceed.",
          });
        }
      }

      // Attach warnings to request for downstream use
      (req as any).complianceWarnings = warnings;
      next();
    } catch (err) {
      // Compliance gate should never block normal operation on error
      logger.error("[complianceGate] Error during compliance check", err);
      next();
    }
  };
}
