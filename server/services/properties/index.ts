/**
 * Domain barrel — property-related services.
 *
 * New code can import from "services/properties" while existing imports
 * continue to work unchanged.
 *
 * Several of these modules are function-based (no service class), so they are
 * re-exported as namespaces. acreOSValuation exposes a singleton instance and
 * propertyEnrichment a service class.
 */
export { PropertyEnrichmentService } from "../propertyEnrichment";
export { acreOSValuation } from "../acreOSValuation";
export * as Comps from "../comps";
export * as Parcel from "../parcel";
export * as AVMFeedback from "../avmFeedback";
export * as PropertyTax from "../propertyTaxService";
export * as ParcelIntelligenceFusion from "../parcelIntelligenceFusion";
export * as PropertyIntelligence from "../propertyIntelligenceEnhancements";
