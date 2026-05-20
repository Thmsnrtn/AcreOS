/**
 * Performance ingest — pulls daily CTR / CPM / spend from Meta + TikTok
 * for every live render and writes day-grain rows to cmo_ad_performance.
 *
 * Run by the scheduled job runner (server/jobs/runScheduledJobs.ts) once
 * per day at 04:00 UTC. Also runnable on-demand via scripts/cmo-ingest.ts.
 *
 * Idempotency: the (render_id, platform, date) unique index means re-runs
 * are safe — they upsert rather than duplicate.
 *
 * After ingest, archetypeScorer.recompute() updates the rolling 30d
 * archetype scores so the next generation cycle biases toward winners.
 */

import { db } from "../db";
import { cmoAdRenders, cmoAdPerformance, founderAdAccounts } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { recomputeArchetypeScores } from "../services/cmo/archetypeScorer";

const META_BASE = "https://graph.facebook.com/v19.0";
const TIKTOK_BASE = "https://business-api.tiktok.com/open_api/v1.3";

interface PlatformAccount {
  accessToken: string;
  adAccountId: string;
}

async function loadAccount(platform: "meta" | "tiktok"): Promise<PlatformAccount | null> {
  const [account] = await db
    .select()
    .from(founderAdAccounts)
    .where(and(eq(founderAdAccounts.platform, platform), eq(founderAdAccounts.isActive, true)))
    .limit(1);
  return account ?? null;
}

export async function ingestPerformanceAll(): Promise<{ ingested: number }> {
  // Live renders from the last 30 days are the universe we ingest.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const liveRenders = await db
    .select()
    .from(cmoAdRenders)
    .where(
      and(
        eq(cmoAdRenders.status, "live"),
        gte(cmoAdRenders.broadcastAt, thirtyDaysAgo),
      ),
    );

  let total = 0;
  const metaAccount = await loadAccount("meta");
  const tiktokAccount = await loadAccount("tiktok");

  for (const render of liveRenders) {
    const manifest = render.manifestJson as { platforms?: Record<string, { externalId?: string }> } | null;
    const platforms = manifest?.platforms ?? {};

    if (platforms.meta?.externalId && metaAccount) {
      try {
        const rows = await ingestMetaForRender(render.id, platforms.meta.externalId, metaAccount);
        total += rows;
      } catch (err) {
        logger.warn(`[cmo:perf] Meta ingest failed for render ${render.id.slice(0, 8)}: ${(err as Error).message}`);
      }
    }
    if (platforms.tiktok?.externalId && tiktokAccount) {
      try {
        const rows = await ingestTiktokForRender(render.id, platforms.tiktok.externalId, tiktokAccount);
        total += rows;
      } catch (err) {
        logger.warn(`[cmo:perf] TikTok ingest failed for render ${render.id.slice(0, 8)}: ${(err as Error).message}`);
      }
    }
  }

  logger.info(`[cmo:perf] ingested ${total} performance rows across ${liveRenders.length} live renders`);

  // Recompute archetype scoring after fresh data lands.
  const archetypeUpdates = await recomputeArchetypeScores();
  logger.info(`[cmo:perf] recomputed ${archetypeUpdates} archetype rolling-window scores`);

  return { ingested: total };
}

async function ingestMetaForRender(renderId: string, externalCreativeId: string, account: PlatformAccount): Promise<number> {
  const adAccountId = account.adAccountId.startsWith("act_") ? account.adAccountId : `act_${account.adAccountId}`;
  // Meta insights are at the ad level, not the creative level. We need to
  // resolve creative_id → ad_ids first. For v1, assume one ad per creative
  // (the agent only creates one ad per creative). Query: insights with
  // filtering on the creative_id field.
  const since = isoDate(daysAgo(30));
  const until = isoDate(new Date());

  const fields = "ad_id,impressions,clicks,spend,date_start";
  const url = `${META_BASE}/${adAccountId}/insights?level=ad&fields=${encodeURIComponent(fields)}&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&time_increment=1&filtering=${encodeURIComponent(JSON.stringify([{ field: "creative.id", operator: "EQUAL", value: externalCreativeId }]))}&access_token=${account.accessToken}`;

  const response = await fetch(url);
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Meta insights ${response.status}: ${errBody.slice(0, 200)}`);
  }
  const data = (await response.json()) as {
    data?: Array<{ ad_id: string; impressions?: string; clicks?: string; spend?: string; date_start?: string }>;
  };

  let rows = 0;
  for (const row of data.data ?? []) {
    if (!row.date_start) continue;
    const impressions = Number(row.impressions ?? 0);
    const clicks = Number(row.clicks ?? 0);
    const spendCents = Math.round(Number(row.spend ?? 0) * 100);
    const ctrPpm = impressions > 0 ? Math.round((clicks / impressions) * 1_000_000) : 0;
    const cpmCents = impressions > 0 ? Math.round((spendCents / impressions) * 1000) : 0;

    await db
      .insert(cmoAdPerformance)
      .values({
        renderId,
        platform: "meta",
        externalAdId: row.ad_id,
        date: new Date(row.date_start),
        spendCents,
        impressions,
        clicks,
        ctrPpm,
        cpmCents,
      })
      .onConflictDoUpdate({
        target: [cmoAdPerformance.renderId, cmoAdPerformance.platform, cmoAdPerformance.date],
        set: {
          spendCents,
          impressions,
          clicks,
          ctrPpm,
          cpmCents,
          ingestedAt: new Date(),
        },
      });
    rows++;
  }
  return rows;
}

async function ingestTiktokForRender(renderId: string, externalAdId: string, account: PlatformAccount): Promise<number> {
  const since = isoDate(daysAgo(30));
  const until = isoDate(new Date());

  const url = `${TIKTOK_BASE}/report/integrated/get/?advertiser_id=${account.adAccountId}&report_type=BASIC&data_level=AUCTION_AD&dimensions=${encodeURIComponent(JSON.stringify(["ad_id", "stat_time_day"]))}&metrics=${encodeURIComponent(JSON.stringify(["impressions", "clicks", "spend", "ctr"]))}&filters=${encodeURIComponent(JSON.stringify([{ field_name: "ad_ids", filter_type: "IN", filter_value: JSON.stringify([externalAdId]) }]))}&start_date=${since}&end_date=${until}`;

  const response = await fetch(url, { headers: { "Access-Token": account.accessToken } });
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`TikTok insights ${response.status}: ${errBody.slice(0, 200)}`);
  }
  const data = (await response.json()) as {
    code: number;
    message: string;
    data?: {
      list?: Array<{
        dimensions: { ad_id: string; stat_time_day: string };
        metrics: { impressions: string; clicks: string; spend: string; ctr: string };
      }>;
    };
  };

  if (data.code !== 0) throw new Error(`TikTok API ${data.code}: ${data.message}`);

  let rows = 0;
  for (const row of data.data?.list ?? []) {
    const date = new Date(row.dimensions.stat_time_day);
    const impressions = Number(row.metrics.impressions ?? 0);
    const clicks = Number(row.metrics.clicks ?? 0);
    const spendCents = Math.round(Number(row.metrics.spend ?? 0) * 100);
    const ctrPpm = impressions > 0 ? Math.round((clicks / impressions) * 1_000_000) : 0;
    const cpmCents = impressions > 0 ? Math.round((spendCents / impressions) * 1000) : 0;

    await db
      .insert(cmoAdPerformance)
      .values({
        renderId,
        platform: "tiktok",
        externalAdId: row.dimensions.ad_id,
        date,
        spendCents,
        impressions,
        clicks,
        ctrPpm,
        cpmCents,
      })
      .onConflictDoUpdate({
        target: [cmoAdPerformance.renderId, cmoAdPerformance.platform, cmoAdPerformance.date],
        set: {
          spendCents,
          impressions,
          clicks,
          ctrPpm,
          cpmCents,
          ingestedAt: new Date(),
        },
      });
    rows++;
  }
  return rows;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
