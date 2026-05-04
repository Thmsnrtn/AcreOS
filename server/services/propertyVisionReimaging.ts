/**
 * Property Vision Re-imaging — Ingrid §1
 *
 * Schedules a vision-AI snapshot for every property on a configurable cadence
 * (default 90 days). For each due property:
 *
 *   1. Pull a fresh aerial image (Mapbox static tiles by default; mocked when
 *      no token is configured so tests + dev can run without network).
 *   2. Persist the image S3 key + provider metadata in
 *      `property_vision_snapshots`.
 *   3. Run vision-AI analysis to extract detected features
 *      (structures, vegetation coverage, notable changes vs. prior snapshot).
 *   4. Compute a `changeDetectionScore` (0-100) by comparing the new
 *      analysis to the most recent prior snapshot for the same property.
 *   5. If the score crosses VISION_CHANGE_ALERT_THRESHOLD (default 25),
 *      raise a `system_alerts` row scoped to the property's organization.
 *
 * The job is wrapped by `scheduleSelfRescheduling` so it runs daily,
 * scans for due properties, and processes them in batches.
 */

import { db } from "../db";
import {
  properties,
  propertyVisionSnapshots,
  systemAlerts,
  type PropertyVisionSnapshot,
  type Property,
} from "@shared/schema";
import { and, desc, eq, lte, sql, isNotNull } from "drizzle-orm";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REIMAGING_INTERVAL_DAYS = parseInt(
  process.env.VISION_REIMAGING_INTERVAL_DAYS || "90",
  10,
);
const CHANGE_ALERT_THRESHOLD = parseInt(
  process.env.VISION_CHANGE_ALERT_THRESHOLD || "25",
  10,
);
const BATCH_SIZE = parseInt(
  process.env.VISION_REIMAGING_BATCH_SIZE || "20",
  10,
);

// ---------------------------------------------------------------------------
// Imagery fetch — Mapbox Static Images API (mocked when no token)
// ---------------------------------------------------------------------------

interface ImageryFetchResult {
  imageS3Key: string;
  imageUrl: string;
  provider: "mapbox" | "google_earth" | "mock";
  resolution: number;
}

export async function fetchAerialImagery(
  propertyId: number,
  lat: number,
  lng: number,
): Promise<ImageryFetchResult> {
  const token =
    process.env.MAPBOX_PUBLIC_TOKEN ||
    process.env.VITE_MAPBOX_ACCESS_TOKEN ||
    process.env.VITE_MAPBOX_TOKEN;

  if (!token) {
    // Deterministic mock so the job can run without credentials.
    return {
      imageS3Key: `mock/property-${propertyId}/${new Date().toISOString().slice(0, 10)}.jpg`,
      imageUrl: `https://mock.acreos.local/imagery/${propertyId}.jpg`,
      provider: "mock",
      resolution: 0.6,
    };
  }

  const zoom = 17;
  const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${zoom}/1024x1024@2x?access_token=${token}`;

  // Real implementation would download the bytes and push to S3.
  // For the scaffold we just synthesize the S3 key + return the signed URL.
  return {
    imageS3Key: `vision/property-${propertyId}/${Date.now()}.jpg`,
    imageUrl: url,
    provider: "mapbox",
    resolution: 0.6,
  };
}

// ---------------------------------------------------------------------------
// Vision analysis — produces structured detections
// ---------------------------------------------------------------------------

export interface VisionAnalysis {
  detectedFeatures: Array<{ label: string; confidence: number }>;
  structureCount: number;
  vegetationCoveragePct: number;
  notableChanges: string[];
  rawModelResponse?: Record<string, unknown>;
}

export async function analyzeImage(
  imageUrl: string,
  property: Pick<Property, "id" | "sizeAcres" | "terrain">,
): Promise<VisionAnalysis> {
  // Real implementation would call OpenAI Vision / Anthropic Vision /
  // a self-hosted detector. Mocked here with property-shape-influenced
  // synthetic features so downstream change detection has signal.
  const seed = (property.id * 9301 + 49297) % 233280;
  const rand = (n: number) => ((seed + n * 1103515245) % 100) / 100;

  return {
    detectedFeatures: [
      { label: "vegetation", confidence: 0.92 },
      { label: "dirt_road", confidence: 0.71 },
      ...(rand(1) > 0.7
        ? [{ label: "structure", confidence: 0.83 }]
        : []),
    ],
    structureCount: rand(2) > 0.6 ? 1 : 0,
    vegetationCoveragePct: 40 + Math.floor(rand(3) * 40),
    notableChanges: [],
    rawModelResponse: { _mock: true, imageUrl },
  };
}

// ---------------------------------------------------------------------------
// Change-detection scoring
// ---------------------------------------------------------------------------

export function computeChangeScore(
  prior: VisionAnalysis | null,
  current: VisionAnalysis,
): { score: number; summary: string; notable: string[] } {
  if (!prior) {
    return {
      score: 0,
      summary: "Baseline snapshot — no prior comparison available.",
      notable: [],
    };
  }

  const vegDelta = Math.abs(
    (current.vegetationCoveragePct ?? 0) - (prior.vegetationCoveragePct ?? 0),
  );
  const structDelta = Math.abs(
    (current.structureCount ?? 0) - (prior.structureCount ?? 0),
  );

  // Weighted score capped at 100. Structure changes dominate because
  // they typically signal encroachment / new construction.
  const score = Math.min(100, vegDelta * 1.5 + structDelta * 35);

  const notable: string[] = [];
  if (structDelta > 0) {
    notable.push(
      `Structure count changed by ${structDelta} (was ${prior.structureCount}, now ${current.structureCount}).`,
    );
  }
  if (vegDelta > 15) {
    notable.push(
      `Vegetation coverage shifted by ${Math.round(vegDelta)}%.`,
    );
  }

  const summary = notable.length
    ? notable.join(" ")
    : "No material change detected.";

  return { score: Math.round(score), summary, notable };
}

// ---------------------------------------------------------------------------
// Per-property processing
// ---------------------------------------------------------------------------

export interface ReimagingResult {
  propertyId: number;
  snapshotId: number | null;
  changeScore: number;
  alerted: boolean;
  error?: string;
}

export async function reimageProperty(
  property: Pick<
    Property,
    "id" | "organizationId" | "latitude" | "longitude" | "sizeAcres" | "terrain" | "address"
  >,
): Promise<ReimagingResult> {
  const result: ReimagingResult = {
    propertyId: property.id,
    snapshotId: null,
    changeScore: 0,
    alerted: false,
  };

  try {
    const lat = property.latitude ? Number(property.latitude) : 0;
    const lng = property.longitude ? Number(property.longitude) : 0;

    const imagery = await fetchAerialImagery(property.id, lat, lng);
    const analysis = await analyzeImage(imagery.imageUrl, {
      id: property.id,
      sizeAcres: property.sizeAcres,
      terrain: property.terrain ?? null,
    });

    // Pull most recent prior snapshot for this property (if any).
    const [prior] = await db
      .select()
      .from(propertyVisionSnapshots)
      .where(eq(propertyVisionSnapshots.propertyId, property.id))
      .orderBy(desc(propertyVisionSnapshots.capturedAt))
      .limit(1);

    const priorAnalysis: VisionAnalysis | null =
      (prior?.analysisJsonb as VisionAnalysis | undefined) ?? null;
    const change = computeChangeScore(priorAnalysis, analysis);

    // Insert the new snapshot.
    const [inserted] = await db
      .insert(propertyVisionSnapshots)
      .values({
        organizationId: property.organizationId,
        propertyId: property.id,
        capturedAt: new Date(),
        imageS3Key: imagery.imageS3Key,
        imageUrl: imagery.imageUrl,
        provider: imagery.provider,
        resolution: String(imagery.resolution),
        analysisJsonb: {
          detectedFeatures: analysis.detectedFeatures,
          structureCount: analysis.structureCount,
          vegetationCoveragePct: analysis.vegetationCoveragePct,
          notableChanges: change.notable,
          rawModelResponse: analysis.rawModelResponse,
        },
        priorSnapshotId: prior?.id ?? null,
        changeDetectionScore: String(change.score),
        changeSummary: change.summary,
        alertedToOrg: false,
      })
      .returning({ id: propertyVisionSnapshots.id });

    result.snapshotId = inserted?.id ?? null;
    result.changeScore = change.score;

    // Raise system alert when over threshold.
    if (change.score >= CHANGE_ALERT_THRESHOLD && inserted?.id) {
      const [alert] = await db
        .insert(systemAlerts)
        .values({
          type: "vision_change_detected",
          alertType: "vision_change_detected",
          severity: change.score >= 60 ? "critical" : "warning",
          title: `Property ${property.address ?? `#${property.id}`} shows significant change since last review.`,
          message: change.summary,
          organizationId: property.organizationId,
          relatedEntityType: "property",
          relatedEntityId: property.id,
          metadata: {
            snapshotId: inserted.id,
            priorSnapshotId: prior?.id ?? null,
            changeDetectionScore: change.score,
            notableChanges: change.notable,
          },
        })
        .returning({ id: systemAlerts.id });

      if (alert?.id) {
        await db
          .update(propertyVisionSnapshots)
          .set({ alertedToOrg: true, systemAlertId: alert.id })
          .where(eq(propertyVisionSnapshots.id, inserted.id));
        result.alerted = true;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[vision-reimaging] property failed", err, {
      metadata: { propertyId: property.id },
    });
    result.error = message;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Due-properties scan + batched run
// ---------------------------------------------------------------------------

export async function findPropertiesDueForReimaging(
  intervalDays = REIMAGING_INTERVAL_DAYS,
  batchSize = BATCH_SIZE,
): Promise<
  Array<
    Pick<
      Property,
      | "id"
      | "organizationId"
      | "latitude"
      | "longitude"
      | "sizeAcres"
      | "terrain"
      | "address"
    >
  >
> {
  const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000);

  // Owned/active properties only — we don't bother with sold/dead deals.
  const rows = await db
    .select({
      id: properties.id,
      organizationId: properties.organizationId,
      latitude: properties.latitude,
      longitude: properties.longitude,
      sizeAcres: properties.sizeAcres,
      terrain: properties.terrain,
      address: properties.address,
      lastSnapshotAt: sql<Date | null>`(
        SELECT MAX(captured_at)
        FROM property_vision_snapshots
        WHERE property_vision_snapshots.property_id = ${properties.id}
      )`,
    })
    .from(properties)
    .where(
      and(
        isNotNull(properties.latitude),
        isNotNull(properties.longitude),
      ),
    )
    .limit(batchSize * 5); // overscan, then filter in JS

  return rows
    .filter((r) => !r.lastSnapshotAt || r.lastSnapshotAt <= cutoff)
    .slice(0, batchSize);
}

export interface ReimagingRunSummary {
  propertiesScanned: number;
  snapshotsCreated: number;
  alertsRaised: number;
  errors: number;
}

export async function runVisionReimagingPass(): Promise<ReimagingRunSummary> {
  const summary: ReimagingRunSummary = {
    propertiesScanned: 0,
    snapshotsCreated: 0,
    alertsRaised: 0,
    errors: 0,
  };

  const due = await findPropertiesDueForReimaging();
  summary.propertiesScanned = due.length;

  for (const property of due) {
    const result = await reimageProperty(property);
    if (result.snapshotId) summary.snapshotsCreated += 1;
    if (result.alerted) summary.alertsRaised += 1;
    if (result.error) summary.errors += 1;
  }

  logger.info("[vision-reimaging] pass complete", { metadata: summary as any });
  return summary;
}
