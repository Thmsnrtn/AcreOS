/**
 * The HTTP answer for an enrichment the record cannot support — shared by every
 * route that calls `propertyEnrichmentService.enrichProperty`, so none of them
 * turns "this parcel has no coordinates" into a 500 again.
 *
 *   PropertyNotFoundForEnrichmentError → 404
 *   MissingCoordinatesError            → 422, with a message that says what to add
 *
 * Returns true when it answered; the caller falls through to Errors.internal
 * otherwise.
 */
import type { Response } from "express";
import { Errors } from "./errors";
import {
  MissingCoordinatesError,
  PropertyNotFoundForEnrichmentError,
} from "../services/propertyEnrichment";

export function respondToEnrichmentRefusal(res: Response, err: unknown): boolean {
  if (err instanceof PropertyNotFoundForEnrichmentError) {
    Errors.notFound(res, "Property");
    return true;
  }
  if (err instanceof MissingCoordinatesError) {
    Errors.unprocessable(res, err.message, { reason: "missing_coordinates", propertyId: err.propertyId });
    return true;
  }
  return false;
}

/** A per-item refusal for bulk endpoints, or null when `err` is not one. */
export function enrichmentRefusalOf(err: unknown): { propertyId: number; reason: string; message: string } | null {
  if (err instanceof PropertyNotFoundForEnrichmentError) {
    return { propertyId: err.propertyId, reason: "not_found", message: err.message };
  }
  if (err instanceof MissingCoordinatesError) {
    return { propertyId: err.propertyId, reason: "missing_coordinates", message: err.message };
  }
  return null;
}
