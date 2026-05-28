/**
 * Deal Hunter Auto-Scrape Job
 *
 * BullMQ queue worker that processes each active deal source on its schedule.
 * Deduplicates results by hash (apn + county + state), normalizes field formats,
 * sends alerts for high-score deals matching autoBidRules, and updates source
 * health metrics. Failed sources are retried with exponential backoff.
 *
 * Scheduled via BullMQ repeatable job (every 2 hours by default).
 */

import { Worker, Queue, Job } from "bullmq";
import { db } from "../db";
import {
  dealSources,
  scrapedDeals,
  autoBidRules,
  dealAlerts,
  backgroundJobs,
} from "@shared/schema";
import { eq, and, ne, sql, desc } from "drizzle-orm";
import { dealHunterService } from "../services/dealHunter";
import { createHash } from "crypto";
import { logger } from "../utils/logger";

export const DEAL_HUNTER_QUEUE_NAME = "deal-hunter-scrape";

// ---------------------------------------------------------------------------
// Field normalizers
// ---------------------------------------------------------------------------

function normalizePrice(raw: any): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

function normalizeAcreage(raw: any): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

function normalizeAddress(raw: any): string {
  if (!raw) return "";
  return String(raw).trim().replace(/\s+/g, " ").toUpperCase();
}

function buildDealHash(apn: string, county: string, state: string): string {
  return createHash("sha256")
    .update(`${(apn || "").trim()}|${(county || "").trim().toLowerCase()}|${(state || "").trim().toUpperCase()}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Deduplication helper
// ---------------------------------------------------------------------------

// scraped_deals has no contentHash column; dedup on the natural parcel key
// (apn + county + state) instead, excluding the row currently being normalized.
async function isDuplicate(
  apn: string,
  county: string,
  state: string,
  excludeId: number,
): Promise<boolean> {
  if (!apn) return false;
  const existing = await db
    .select({ id: scrapedDeals.id })
    .from(scrapedDeals)
    .where(
      and(
        eq(scrapedDeals.apn, apn),
        eq(scrapedDeals.county, county),
        eq(scrapedDeals.state, state),
        ne(scrapedDeals.id, excludeId),
      ),
    )
    .limit(1);
  return existing.length > 0;
}

// ---------------------------------------------------------------------------
// Alert check for high-score deals
// ---------------------------------------------------------------------------

async function sendHighScoreAlerts(deal: any): Promise<void> {
  if ((deal.distressScore || 0) < 70) return;

  const rules = await db
    .select()
    .from(autoBidRules)
    .where(eq(autoBidRules.isActive, true));

  for (const rule of rules) {
    try {
      // Geographic filter
      if (rule.states && !rule.states.includes(deal.state)) continue;
      if (rule.counties && !rule.counties.includes(deal.county)) continue;
      // Acreage filter
      if (rule.minAcres && (deal.sizeAcres || 0) < parseFloat(rule.minAcres)) continue;
      if (rule.maxAcres && (deal.sizeAcres || 0) > parseFloat(rule.maxAcres)) continue;
      // Score filter
      if (rule.minDistressScore && (deal.distressScore || 0) < rule.minDistressScore) continue;

      await db.insert(dealAlerts).values({
        organizationId: rule.organizationId,
        scrapedDealId: deal.id,
        autoBidRuleId: rule.id,
        alertType: "high_score_match",
        priority: deal.distressScore >= 85 ? "high" : "medium",
        message: `High-score deal found: ${deal.county}, ${deal.state} — ${deal.sizeAcres} acres, Distress Score: ${deal.distressScore}/100`,
        actionRequired: true,
        actionUrl: `/deal-hunter/${deal.id}`,
      });
    } catch (err: any) {
      logger.error(`[DealHunterScrape] Alert insert failed for rule ${rule.id}`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Process a single source
// ---------------------------------------------------------------------------

async function processSource(sourceId: number): Promise<{ dealsFound: number; newDeals: number; duplicates: number }> {
  const [source] = await db
    .select()
    .from(dealSources)
    .where(eq(dealSources.id, sourceId))
    .limit(1);

  if (!source || !source.isActive) {
    return { dealsFound: 0, newDeals: 0, duplicates: 0 };
  }

  const result = await dealHunterService.scrapeSource(sourceId);

  if (!result.success) {
    // Exponential backoff: source failure count already tracked in scrapeSource
    logger.warn(`[DealHunterScrape] Source ${sourceId} (${source.name}) failed: ${result.error}`);
    return { dealsFound: 0, newDeals: 0, duplicates: 0 };
  }

  let newDeals = 0;
  let duplicates = 0;

  // Fetch freshly scraped deals for this source (last scrape window)
  const recentDeals = await db
    .select()
    .from(scrapedDeals)
    .where(eq(scrapedDeals.sourceId, sourceId))
    .orderBy(desc(scrapedDeals.scrapedAt))
    .limit(result.dealsFound || 0);

  for (const deal of recentDeals) {
    // Normalize fields
    const normalized = {
      listPrice: normalizePrice(deal.listPrice),
      minimumBid: normalizePrice(deal.minimumBid),
      assessedValue: normalizePrice(deal.assessedValue),
      sizeAcres: normalizeAcreage(deal.sizeAcres),
      address: normalizeAddress(deal.address),
    };

    // Check deduplication (skip if already stored from another source)
    if (await isDuplicate(deal.apn || "", deal.county || "", deal.state || "", deal.id)) {
      duplicates++;
      continue;
    }

    await db.update(scrapedDeals)
      .set({
        // numeric columns are stored as strings in Drizzle
        listPrice: normalized.listPrice == null ? null : String(normalized.listPrice),
        minimumBid: normalized.minimumBid == null ? null : String(normalized.minimumBid),
        assessedValue: normalized.assessedValue == null ? null : String(normalized.assessedValue),
        sizeAcres: normalized.sizeAcres == null ? null : String(normalized.sizeAcres),
        address: normalized.address,
        updatedAt: new Date(),
      })
      .where(eq(scrapedDeals.id, deal.id));

    // Send alerts for high-score deals
    await sendHighScoreAlerts({ ...deal, ...normalized });
    newDeals++;
  }

  // Update source health metrics
  await db.update(dealSources)
    .set({
      lastScraped: new Date(),
      lastSuccessful: new Date(),
      consecutiveFailures: 0,
    })
    .where(eq(dealSources.id, sourceId));

  return { dealsFound: result.dealsFound || 0, newDeals, duplicates };
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

async function processDealHunterScrapeJob(job: Job): Promise<void> {
  const startedAt = new Date();
  let totalDeals = 0;
  let totalNew = 0;
  let totalDuplicates = 0;
  let sourcesProcessed = 0;
  let sourcesFailed = 0;

  const jobRecord = await db
    .insert(backgroundJobs)
    .values({
      type: "deal_hunter_scrape",
      status: "running",
      scheduledFor: startedAt,
      payload: { bullmqJobId: job.id },
    })
    .returning({ id: backgroundJobs.id });

  const jobId = jobRecord[0]?.id;

  try {
    const sources = await db
      .select({ id: dealSources.id, name: dealSources.name })
      .from(dealSources)
      .where(eq(dealSources.isActive, true))
      .orderBy(desc(dealSources.priority));

    logger.info(`[DealHunterScrape] Processing ${sources.length} active sources`);

    for (const source of sources) {
      try {
        const { dealsFound, newDeals, duplicates } = await processSource(source.id);
        totalDeals += dealsFound;
        totalNew += newDeals;
        totalDuplicates += duplicates;
        sourcesProcessed++;
        logger.info(`[DealHunterScrape] Source ${source.name}: ${dealsFound} found, ${newDeals} new, ${duplicates} duplicates`);
      } catch (err: any) {
        sourcesFailed++;
        logger.error(`[DealHunterScrape] Source ${source.id} threw`, err);
      }
    }

    const finishedAt = new Date();
    if (jobId) {
      await db.update(backgroundJobs)
        .set({
          status: "completed",
          completedAt: finishedAt,
          result: { totalDeals, totalNew, totalDuplicates, sourcesProcessed, sourcesFailed },
        })
        .where(eq(backgroundJobs.id, jobId));
    }

    logger.info(`[DealHunterScrape] Done. Sources: ${sourcesProcessed} ok, ${sourcesFailed} failed. Deals: ${totalNew} new of ${totalDeals} found`);
  } catch (err: any) {
    logger.error("[DealHunterScrape] Fatal error", err);
    if (jobId) {
      await db.update(backgroundJobs)
        .set({ status: "failed", completedAt: new Date(), error: err.message })
        .where(eq(backgroundJobs.id, jobId));
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Create and return the BullMQ queue for deal hunter scraping.
 */
export function createDealHunterScrapeQueue(redisConnection: any): Queue {
  return new Queue(DEAL_HUNTER_QUEUE_NAME, { connection: redisConnection });
}

/**
 * Register the repeatable scrape job with the queue (every 2 hours).
 */
export async function registerDealHunterScrapeJob(queue: Queue): Promise<void> {
  await queue.add(
    "deal-hunter-scrape",
    {},
    {
      repeat: {
        pattern: "0 */2 * * *", // Every 2 hours
      },
      removeOnComplete: 5,
      removeOnFail: 3,
    }
  );
  logger.info("[DealHunterScrape] Registered scrape job (every 2 hours)");
}

/**
 * Start the BullMQ worker that processes deal hunter scrape jobs.
 */
export function dealHunterScrapeJob(redisConnection: any): Worker {
  const worker = new Worker(
    DEAL_HUNTER_QUEUE_NAME,
    async (job: Job) => {
      await processDealHunterScrapeJob(job);
    },
    {
      connection: redisConnection,
      concurrency: 1,
      limiter: { max: 1, duration: 5000 },
    }
  );

  worker.on("completed", (job) => {
    logger.info(`[DealHunterScrape] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`[DealHunterScrape] Job ${job?.id} failed`, err);
  });

  return worker;
}
