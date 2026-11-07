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
 * The same gate withholds 1099-NEC output behind its OWN determination — the
 * reporting threshold — see QUALIFIED_1099_GATES below.
 *
 * Shaped after `requireLadderFlag` (server/middleware/featureGate.ts) rather
 * than reusing it: that helper answers 404 "feature unavailable", and a tax
 * form that is withheld for a stated reason must say the reason.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { buildFlagContext, featureFlagService } from "./featureFlags";
import { isFounderEmail } from "./founder";
import { NEC_THRESHOLD_CENTS } from "./form1099NecPayer";
import { sendError } from "../utils/errors";
import { logger } from "../utils/logger";

/**
 * The forms this gate withholds, each behind its OWN qualified determination.
 *
 * One mechanism, one flag per form (founder decision 2026-11-05): the INT
 * determination is the direction review (DEFECT-0101); the NEC determination is
 * the reporting threshold for the tax year, which a qualified tax reviewer
 * (K13) must confirm. An INT determination never opens NEC, and an NEC
 * determination never opens INT — each form reads only its own flag key.
 */
type Qualified1099Form = "1099-INT" | "1099-NEC";

/** Founder ladder flag: the 1099-INT direction has been reviewed and the org may generate. */
const TAX_1099_DIRECTION_FLAG = "tax.1099int.direction_reviewed";

/** Founder ladder flag: a qualified tax reviewer has confirmed the 1099-NEC reporting threshold. */
const TAX_1099NEC_THRESHOLD_FLAG = "tax.1099nec.threshold_confirmed";

const NOT_QUALIFIED_1099_ERROR = "not_qualified_filing_output" as const;

const REFUSAL_MESSAGE =
  "1099-INT generation is withheld: this generator reports interest the organization RECEIVED " +
  "as interest it PAID, which is the wrong direction for Form 1099-INT. It is not a qualified filing " +
  "output until a qualified tax reviewer defines payer, recipient, instrument and threshold " +
  "(docs/audits/defect-registry.md DEFECT-0101).";

const NEC_THRESHOLD_DOLLARS = (NEC_THRESHOLD_CENTS / 100).toLocaleString("en-US");

const NEC_REFUSAL_MESSAGE =
  `1099-NEC generation is withheld: the reporting threshold this generator applies ($${NEC_THRESHOLD_DOLLARS}) ` +
  "has not been confirmed by a qualified tax reviewer for this tax year, and the figure for payments " +
  "made after 2025 may differ. No forms were generated. It is not a qualified filing output until the " +
  "threshold is confirmed.";

type GateSpec = {
  flagKey: string;
  message: string;
  details: Record<string, unknown>;
};

const QUALIFIED_1099_GATES: Readonly<Record<Qualified1099Form, GateSpec>> = {
  "1099-INT": {
    flagKey: TAX_1099_DIRECTION_FLAG,
    message: REFUSAL_MESSAGE,
    details: { defect: "DEFECT-0101", flagKey: TAX_1099_DIRECTION_FLAG },
  },
  "1099-NEC": {
    flagKey: TAX_1099NEC_THRESHOLD_FLAG,
    message: NEC_REFUSAL_MESSAGE,
    details: {
      reason: "nec_threshold_unconfirmed",
      thresholdCents: NEC_THRESHOLD_CENTS,
      flagKey: TAX_1099NEC_THRESHOLD_FLAG,
    },
  },
};

function refuseUnqualified1099(res: Response, gate: GateSpec): void {
  sendError(res, 422, NOT_QUALIFIED_1099_ERROR, gate.message, gate.details);
}

/**
 * Route middleware. Founder → through. This form's flag enabled for this org
 * → through. Anything else, including a flag-store failure → 422 refusal.
 *
 * The form defaults to 1099-INT so the existing INT entry points are unchanged;
 * every other form must name itself.
 */
export function requireQualified1099Output(form: Qualified1099Form = "1099-INT"): RequestHandler {
  const gate = QUALIFIED_1099_GATES[form];
  return async (req: Request, res: Response, next: NextFunction) => {
    const email = req.user?.email;
    if (isFounderEmail(email)) return next();
    try {
      const ctx = buildFlagContext(req);
      if (!ctx.isFounder && isFounderEmail(ctx.email)) ctx.isFounder = true;
      const enabled = await featureFlagService.isEnabled(gate.flagKey, ctx);
      if (enabled) return next();
    } catch (err) {
      logger.warn("form1099Refusal: flag read failed — refusing (fail closed)", {
        metadata: { form, error: err instanceof Error ? err.message : String(err) },
      });
    }
    return refuseUnqualified1099(res, gate);
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
