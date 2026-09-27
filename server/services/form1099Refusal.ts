/**
 * DEFECT-0101 — the 1099-INT generator names the organization as the PAYER
 * of interest it RECEIVED.
 *
 * `generateAnnualInterestReport` marks a note `requires1099` when the org
 * collected ≥ $600 of interest from its borrower; `generate1099IntForms` then
 * casts the org as payer and the borrower as recipient of that income, and
 * `form1099Batch` renders per-borrower PDFs, a 1096 and a FIRE file from it.
 * Form 1099-INT reports interest PAID to a recipient. Interest RECEIVED on a
 * note is the 1098 direction, which `form1098Batch` already handles — and
 * whose own header describes this module's sibling as covering interest orgs
 * "pay out". The code contradicts it.
 *
 * Whether any 1099-INT is owed by an AcreOS org, to whom, on which instrument
 * and above which threshold is a question for a qualified tax reviewer, not
 * for this file. Until that review lands, no customer path may produce a
 * 1099-INT artifact: every entry point refuses with one structured body the
 * client renders as a refusal card, and the worker refuses too, so an outbox
 * row queued before this landed cannot produce a filing file after it.
 *
 * The founder can bypass the refusal — that is how the review itself gets
 * exercised against real data — and a ladder flag can open it for a customer
 * once the direction is settled. The gate fails CLOSED: a flag store error is
 * a refusal, not a filing.
 *
 * Shaped after `requireLadderFlag` (server/middleware/featureGate.ts) rather
 * than reusing it: that helper answers 404 "feature unavailable", and a tax
 * form that is withheld for a stated reason must say the reason.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { buildFlagContext, featureFlagService } from "./featureFlags";
import { isFounderEmail } from "./founder";
import { sendError } from "../utils/errors";
import { logger } from "../utils/logger";

/** Founder ladder flag: the 1099-INT direction has been reviewed and the org may generate. */
const TAX_1099_DIRECTION_FLAG = "tax.1099int.direction_reviewed";

const NOT_QUALIFIED_1099_ERROR = "not_qualified_filing_output" as const;

const REFUSAL_MESSAGE =
  "1099-INT generation is withheld: this generator reports interest the organization RECEIVED " +
  "as interest it PAID, which is the wrong direction for Form 1099-INT. It is not a qualified filing " +
  "output until a qualified tax reviewer defines payer, recipient, instrument and threshold " +
  "(docs/audits/defect-registry.md DEFECT-0101).";

function refuseUnqualified1099(res: Response): void {
  sendError(res, 422, NOT_QUALIFIED_1099_ERROR, REFUSAL_MESSAGE, {
    defect: "DEFECT-0101",
    flagKey: TAX_1099_DIRECTION_FLAG,
  });
}

/**
 * Route middleware. Founder → through. Flag enabled for this org → through.
 * Anything else, including a flag-store failure → 422 refusal.
 */
export function requireQualified1099Output(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const email = req.user?.email;
    if (isFounderEmail(email)) return next();
    try {
      const ctx = buildFlagContext(req);
      if (!ctx.isFounder && isFounderEmail(ctx.email)) ctx.isFounder = true;
      const enabled = await featureFlagService.isEnabled(TAX_1099_DIRECTION_FLAG, ctx);
      if (enabled) return next();
    } catch (err) {
      logger.warn("form1099Refusal: flag read failed — refusing (fail closed)", {
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }
    return refuseUnqualified1099(res);
  };
}

/**
 * The value the route stamps on an async batch payload AFTER the middleware
 * passed. The worker demands it, so a row enqueued by any other path — or
 * before this refusal existed — cannot produce a filing artifact.
 */
export const QUALIFIED_1099_PAYLOAD_MARK = TAX_1099_DIRECTION_FLAG;

type Qualified1099PayloadVerdict =
  | { ok: true }
  | { ok: false; error: typeof NOT_QUALIFIED_1099_ERROR; defect: "DEFECT-0101"; message: string };

export function assertQualified1099JobPayload(
  payload: Record<string, unknown>,
): Qualified1099PayloadVerdict {
  if (payload.qualifiedBy === QUALIFIED_1099_PAYLOAD_MARK) return { ok: true };
  return {
    ok: false,
    error: NOT_QUALIFIED_1099_ERROR,
    defect: "DEFECT-0101",
    message: REFUSAL_MESSAGE,
  };
}
