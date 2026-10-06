/**
 * The markers that make a row SAMPLE data ("Try with sample data"), in a leaf
 * module with no imports: the deal-close path reads them on every close, and
 * reaching them through sampleSeeder would pull the storage facade into a
 * module the deal repository loads (W10.4 re-audit, finding 3).
 */
export const SAMPLE_LEAD_SOURCE = "sample_data" as const;
export const SAMPLE_APN_PREFIX = "SAMPLE-" as const;
