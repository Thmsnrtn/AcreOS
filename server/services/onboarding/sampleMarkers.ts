/**
 * Sample-data marker convention — the SINGLE definition of what "sample"
 * means, shared by the two sides of the contract:
 *
 *   - the seeder (sampleSeeder.ts) WRITES the markers on every seeded row
 *     (lead.source = "sample_data", property.apn starts with "SAMPLE-");
 *   - the activation recorder (services/activation.ts) REFUSES events whose
 *     entity carries them, so onboarding fixtures can never light the
 *     /founder/activation funnel (G1.1 real-entities-only rule).
 *
 * Lives in its own dependency-free module so activation.ts can import the
 * contract without dragging in the seeder's storage graph.
 */

export const SAMPLE_LEAD_SOURCE = "sample_data" as const;
export const SAMPLE_APN_PREFIX = "SAMPLE-" as const;

/** The marker fields of the real entity behind an activation event. */
export interface SampleEntityMarkers {
  /** A lead's source column — "sample_data" marks a seeded lead. */
  source?: string | null;
  /** A property/listing apn — a "SAMPLE-" prefix marks a seeded parcel. */
  apn?: string | null;
}

export function isSampleEntity(entity: SampleEntityMarkers | null | undefined): boolean {
  if (!entity) return false;
  if (entity.source === SAMPLE_LEAD_SOURCE) return true;
  if (typeof entity.apn === "string" && entity.apn.startsWith(SAMPLE_APN_PREFIX)) return true;
  return false;
}
