/**
 * Data Ingest Job
 *
 * Nightly training-data ingestion pipeline:
 *   1. Pulls newly closed transaction data from the deals table.
 *   2. Validates data quality (completeness, plausible value ranges).
 *   3. Filters out anomalies and deduplicates by transaction hash.
 *   4. Appends valid records to transactionTraining table.
 *   5. Generates an ingest summary report logged to backgroundJobs.
 *
 * Scheduled via BullMQ repeatable job (nightly at 10 PM UTC).
 */

import { Worker, Queue, Job } from "bullmq";
import { createHash } from "crypto";
import { db } from "../db";
import {
  deals,
  properties,
  transactionTraining,
  backgroundJobs,
} from "@shared/schema";
import { eq, and, desc, gte, isNotNull, sql } from "drizzle-orm";
import { subDays } from "date-fns";
import { logger } from "../utils/logger";

export const DATA_INGEST_QUEUE_NAME = "data-ingest";

const LOOKBACK_DAYS = 7;            // Pull deals closed in the last N days
const MIN_PRICE = 500;              // Minimum plausible sale price (USD)
const MAX_PRICE = 50_000_000;       // Maximum plausible sale price
const MIN_ACRES = 0.1;              // Minimum acreage
const MAX_ACRES = 100_000;          // Maximum acreage (100k acre ranches exist)

// ---------------------------------------------------------------------------
// Transaction hash for deduplication
// ---------------------------------------------------------------------------

function buildTransactionHash(deal: any, property: any): string {
  return createHash("sha256")
    .update(`${property?.apn || ""}|${property?.county || ""}|${property?.state || ""}|${deal.purchasePrice || ""}|${deal.closedDate || ""}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Data quality validation
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  quality: "high" | "medium" | "low";
  reasons: string[];
}

function validateTransaction(deal: any, property: any): ValidationResult {
  const reasons: string[] = [];
  let qualityScore = 100;

  const price = parseFloat(deal.purchasePrice || deal.listPrice || "0");
  const acres = parseFloat(property?.sizeAcres || "0");

  // Hard failures
  if (!price || price < MIN_PRICE || price > MAX_PRICE) {
    return { valid: false, quality: "low", reasons: [`Price out of range: ${price}`] };
  }
  if (!acres || acres < MIN_ACRES || acres > MAX_ACRES) {
    return { valid: false, quality: "low", reasons: [`Acreage out of range: ${acres}`] };
  }
  if (!property?.state) {
    return { valid: false, quality: "low", reasons: ["Missing state"] };
  }
  if (!property?.county) {
    return { valid: false, quality: "low", reasons: ["Missing county"] };
  }

  // Quality deductions
  if (!property?.apn) { reasons.push("Missing APN"); qualityScore -= 20; }
  if (!property?.zoning) { reasons.push("Missing zoning"); qualityScore -= 10; }
  if (!deal.closedDate) { reasons.push("Missing closed date"); qualityScore -= 15; }

  // Price per acre sanity (< $100/acre or > $500k/acre is suspicious for raw land)
  const pricePerAcre = price / acres;
  if (pricePerAcre < 100 || pricePerAcre > 500_000) {
    reasons.push(`Unusual price/acre: $${pricePerAcre.toFixed(0)}`);
    qualityScore -= 25;
  }

  const quality: "high" | "medium" | "low" =
    qualityScore >= 80 ? "high" : qualityScore >= 50 ? "medium" : "low";

  return { valid: true, quality, reasons };
}

// ---------------------------------------------------------------------------
// Main ingest processor
// ---------------------------------------------------------------------------

async function processDataIngestJob(job: Job): Promise<void> {
  const startedAt = new Date();
  const cutoffDate = subDays(startedAt, LOOKBACK_DAYS);

  const jobRecord = await db
    .insert(backgroundJobs)
    .values({
      type: "data_ingest",
      status: "running",
      scheduledFor: startedAt,
      payload: { bullmqJobId: job.id, lookbackDays: LOOKBACK_DAYS },
    })
    .returning({ id: backgroundJobs.id });

  const bgJobId = jobRecord[0]?.id;

  let totalPulled = 0;
  let totalValid = 0;
  let totalDuplicates = 0;
  let totalRejected = 0;
  let qualityHigh = 0;
  let qualityMedium = 0;
  let qualityLow = 0;

  try {
    // Pull recently closed deals
    const recentDeals = await db
      .select()
      .from(deals)
      .where(
        and(
          eq(deals.status, "closed"),
          gte(deals.closingDate, cutoffDate)
        )
      )
      .orderBy(desc(deals.closingDate))
      .limit(2000);

    totalPulled = recentDeals.length;
    logger.info(`[DataIngest] Pulled ${totalPulled} closed deals from last ${LOOKBACK_DAYS} days`);

    for (const deal of recentDeals) {
      // Fetch associated property
      const [property] = deal.propertyId
        ? await db
            .select()
            .from(properties)
            .where(eq(properties.id, deal.propertyId))
            .limit(1)
        : [null];

      // Validate
      const validation = validateTransaction(deal, property);

      if (!validation.valid) {
        totalRejected++;
        continue;
      }

      // Check for duplicates
      const hash = buildTransactionHash(deal, property);
      const [existing] = await db
        .select({ id: transactionTraining.id })
        .from(transactionTraining)
        .where(eq(transactionTraining.transactionHash, hash))
        .limit(1);

      if (existing) {
        totalDuplicates++;
        continue;
      }

      const price = parseFloat(deal.acceptedAmount || property?.purchasePrice || property?.listPrice || "0");
      const acres = parseFloat(property?.sizeAcres || "0");
      const pricePerAcre = price / acres;

      // Environmental features from the property's persisted enrichment jsonb
      // (FEMA NFHL / USFWS NWI / USDA NRCS via PropertyEnrichmentService) —
      // the properties table itself has no floodZone/wetlands/soilQuality
      // columns; enrichmentData is where the real lookups live. Honest nulls
      // when the parcel was never enriched or a layer returned nothing.
      const enrichment = (property?.enrichmentData ?? null) as {
        hazards?: { floodZone?: string; wetlandsPresent?: boolean };
        environment?: { soilSuitability?: string };
      } | null;
      const floodZone =
        typeof enrichment?.hazards?.floodZone === "string" && enrichment.hazards.floodZone.trim()
          ? enrichment.hazards.floodZone
          : null;
      const hasWetlands =
        typeof enrichment?.hazards?.wetlandsPresent === "boolean"
          ? enrichment.hazards.wetlandsPresent
          : null;
      // The broker's suitability is capability-derived only for
      // prime/suitable/limited; "good" is its no-capability-data default and
      // must not be stored as a measured soil fact (refuse-not-fabricate).
      const soilSuitability = enrichment?.environment?.soilSuitability;
      const soilQuality =
        soilSuitability === "prime" || soilSuitability === "suitable" || soilSuitability === "limited"
          ? soilSuitability
          : null;

      // Insert into training table
      try {
        await db.insert(transactionTraining).values({
          transactionHash: hash,
          state: property?.state || "",
          county: property?.county || "",
          // properties has no propertyType column; land is the only ingested type.
          propertyType: "land",
          sizeAcres: String(acres),
          zoning: property?.zoning || null,
          hasRoadAccess: property?.roadAccess ? property.roadAccess !== "none" : null,
          hasUtilities: property?.utilities ? Object.values(property.utilities).some(Boolean) : null,
          hasWater: property?.utilities?.water ?? null,
          floodZone,
          hasWetlands,
          soilQuality,
          countyMedianIncome: null,
          populationDensity: null,
          distanceToMetro: null,
          salePrice: String(price),
          pricePerAcre: String(pricePerAcre.toFixed(2)),
          saleDate: deal.closingDate ? new Date(deal.closingDate) : new Date(),
          dataQuality: validation.quality,
          isOutlier: false,
        });

        totalValid++;
        if (validation.quality === "high") qualityHigh++;
        else if (validation.quality === "medium") qualityMedium++;
        else qualityLow++;
      } catch (insertErr: any) {
        // Unique constraint violation = already exists under different path
        if (insertErr.code === "23505") {
          totalDuplicates++;
        } else {
          logger.error(`[DataIngest] Insert failed for deal ${deal.id}`, undefined, { metadata: { detail: insertErr.message } });
          totalRejected++;
        }
      }
    }

    const report = {
      totalPulled,
      totalValid,
      totalDuplicates,
      totalRejected,
      qualityBreakdown: { high: qualityHigh, medium: qualityMedium, low: qualityLow },
    };

    const finishedAt = new Date();
    if (bgJobId) {
      await db
        .update(backgroundJobs)
        .set({
          status: "completed",
          completedAt: finishedAt,
          result: report,
        })
        .where(eq(backgroundJobs.id, bgJobId));
    }

    logger.info(`[DataIngest] Done. Pulled: ${totalPulled}, Valid: ${totalValid} (H:${qualityHigh}/M:${qualityMedium}/L:${qualityLow}), Duplicates: ${totalDuplicates}, Rejected: ${totalRejected}`);
  } catch (err: any) {
    logger.error("[DataIngest] Fatal error", err);
    if (bgJobId) {
      await db
        .update(backgroundJobs)
        .set({ status: "failed", completedAt: new Date(), error: err.message })
        .where(eq(backgroundJobs.id, bgJobId));
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function createDataIngestQueue(redisConnection: any): Queue {
  return new Queue(DATA_INGEST_QUEUE_NAME, { connection: redisConnection });
}

export async function registerDataIngestJob(queue: Queue): Promise<void> {
  await queue.add(
    "data-ingest",
    {},
    {
      repeat: {
        pattern: "0 22 * * *", // 10 PM UTC nightly
      },
      removeOnComplete: 7,
      removeOnFail: 5,
    }
  );
  logger.info("[DataIngest] Registered nightly data ingestion job at 10 PM UTC");
}

export function dataIngestJob(redisConnection: any): Worker {
  const worker = new Worker(
    DATA_INGEST_QUEUE_NAME,
    async (job: Job) => {
      await processDataIngestJob(job);
    },
    {
      connection: redisConnection,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    logger.info(`[DataIngest] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`[DataIngest] Job ${job?.id} failed`, err);
  });

  return worker;
}
