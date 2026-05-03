/**
 * Aniyah §2 — Indian-Country awareness for property automations.
 *
 * 25 USC §177 + 25 CFR §152 + tribal law govern alienability of tribal
 * trust, individual trust, and restricted-fee land. A federally-void
 * contract auto-generated against a trust parcel is a serious harm.
 *
 * The guard below is the single chokepoint that auto-AVM, blind-offer
 * generation, and contract auto-doc must funnel through. Anything other
 * than landStatus === 'fee' raises LandStatusBlockError so the caller can
 * surface a manual-review prompt to the user.
 *
 * TODO(LAR-overlay): Phase B will resolve landStatus automatically from
 * the BIA Land Area Representations shapefile. Until then this is a
 * manual-verification workflow.
 */

import type { LandStatus } from "@shared/schema";
import type { Response } from "express";
import { sendError } from "./errors";

export const LAND_STATUS_REQUIRES_REVIEW = "LAND_STATUS_REQUIRES_REVIEW" as const;

export class LandStatusBlockError extends Error {
  readonly code = LAND_STATUS_REQUIRES_REVIEW;
  readonly landStatus: LandStatus | string | null | undefined;
  readonly action: string;

  constructor(action: string, landStatus: LandStatus | string | null | undefined) {
    super(
      `Auto-${action} blocked: parcel landStatus is "${
        landStatus ?? "unknown"
      }". Federal trust property — title transfers require BIA approval ` +
        `(25 CFR §152). Verify land status manually before retrying.`,
    );
    this.name = "LandStatusBlockError";
    this.landStatus = landStatus;
    this.action = action;
  }
}

/**
 * Throws LandStatusBlockError if the property's landStatus is anything other
 * than 'fee'. Use this at the entry point of any property automation that
 * could produce a binding legal artifact (valuation, offer, contract, deed).
 */
export function assertFeeSimpleOrThrow(
  property: { landStatus?: string | null } | null | undefined,
  action: string,
): void {
  const status = property?.landStatus ?? "unknown";
  if (status !== "fee") {
    throw new LandStatusBlockError(action, status);
  }
}

/**
 * Express helper — converts a caught LandStatusBlockError into a 422 with
 * the standard `{ error, message, details, statusCode }` envelope. Returns
 * true if the error was handled, false otherwise.
 */
export function handleLandStatusError(res: Response, err: unknown): boolean {
  if (err instanceof LandStatusBlockError) {
    sendError(res, 422, LAND_STATUS_REQUIRES_REVIEW, err.message, {
      action: err.action,
      landStatus: err.landStatus,
      regulatoryBasis: ["25 USC §177", "25 CFR §152"],
    });
    return true;
  }
  return false;
}
