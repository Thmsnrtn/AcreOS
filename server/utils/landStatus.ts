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
 * surface a manual-review prompt to the user. Its message depends on WHY the
 * parcel is held (unverified vs trust vs restricted-fee vs fee-in-reservation,
 * shared/land-status-copy.ts); the gate itself does not — only fee unblocks.
 *
 * TODO(LAR-overlay): Phase B will resolve landStatus automatically from
 * the BIA Land Area Representations shapefile. Until then this is a
 * manual-verification workflow.
 */

import { landStatusSchema, type LandStatus } from "@shared/schema";
import { landStatusCategory, landStatusHoldReason, type LandStatusCategory } from "@shared/land-status-copy";
import type { Response } from "express";
import { sendError } from "./errors";

export const LAND_STATUS_REQUIRES_REVIEW = "LAND_STATUS_REQUIRES_REVIEW" as const;

export class LandStatusBlockError extends Error {
  readonly code = LAND_STATUS_REQUIRES_REVIEW;
  readonly landStatus: LandStatus | string | null | undefined;
  readonly action: string;
  /** What the status means — decides the message; `fee` never reaches here. */
  readonly category: Exclude<LandStatusCategory, "fee">;

  constructor(action: string, landStatus: LandStatus | string | null | undefined) {
    const folded = landStatusCategory(landStatus);
    // A caller that throws for a fee parcel is a caller bug; describe it as
    // unverified rather than inventing a trust characterisation.
    const category = folded === "fee" ? "unverified" : folded;
    super(
      category === "unverified"
        ? `Auto-${action} is on hold: ${landStatusHoldReason(category)} Automation runs once it is verified as fee simple.`
        : `Auto-${action} blocked: ${landStatusHoldReason(category)} Automation runs only on verified fee-simple parcels.`,
    );
    this.name = "LandStatusBlockError";
    this.landStatus = landStatus;
    this.action = action;
    this.category = category;
  }
}

/**
 * Thrown by a property WRITER handed a `landStatus` that is not one of
 * `LAND_STATUS_VALUES`. The column is free text, so before this any string
 * reached it — and a value that is not a status reads as "not fee" to the
 * gate above but as nothing at all to a person. `Errors.internal` maps this
 * to a 400 by name, so every writer that funnels its failure there refuses
 * cleanly without importing it.
 */
export class InvalidLandStatusError extends Error {
  readonly received: unknown;
  constructor(received: unknown) {
    super(
      `"${String(received)}" is not a land status. Use one of: ${landStatusSchema.options.join(", ")}.`,
    );
    this.name = "InvalidLandStatusError";
    this.received = received;
  }
}

/**
 * The write-side check every property writer runs: a payload that carries a
 * `landStatus` must carry a real one. Absent is fine (the column defaults to
 * "unknown"); `null` is not (the column is NOT NULL).
 */
export function assertWritableLandStatus(payload: { landStatus?: unknown } | null | undefined): void {
  if (!payload || !("landStatus" in payload) || payload.landStatus === undefined) return;
  if (!landStatusSchema.safeParse(payload.landStatus).success) {
    throw new InvalidLandStatusError(payload.landStatus);
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
      category: err.category,
      regulatoryBasis: ["25 USC §177", "25 CFR §152"],
    });
    return true;
  }
  return false;
}
