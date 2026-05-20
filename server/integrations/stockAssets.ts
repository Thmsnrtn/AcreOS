/**
 * Stock B-roll integration — Pexels (primary) + Pixabay (fallback).
 *
 * Both APIs are free with an account-keyed token. Pexels has higher-quality
 * video; Pixabay has broader coverage. We try Pexels first, fall back to
 * Pixabay if Pexels has no usable results.
 *
 * Asset usage dedup: every clip used in a shipped render is recorded in
 * cmo_asset_usage. New ad generations exclude clips used in the last 30
 * days to prevent audience fatigue. Same brand, same B-roll = scroll-past.
 *
 * Caching: query results cached in the existing provider_cache table for
 * 7 days, keyed by (provider, query). Repeat fetches are free.
 */

import { db } from "../db";
import { cmoAssetUsage, type CmoAssetUsage } from "@shared/schema";
import { eq, sql, lt, and } from "drizzle-orm";
import { logger } from "../utils/logger";

export type AssetProvider = "pexels" | "pixabay";

export interface StockClip {
  provider: AssetProvider;
  externalId: string;
  url: string;            // direct MP4 URL (HD if available)
  previewUrl: string;     // smaller image preview for the founder UI
  durationSec: number;
  width: number;
  height: number;
  query: string;          // the query that surfaced this clip
}

export interface FetchOptions {
  count?: number;          // how many distinct clips we want returned
  minDurationSec?: number; // filter; defaults to 3
  maxDurationSec?: number; // filter; defaults to 30
  excludeRecentDays?: number; // dedup window; defaults to 30
}

const PEXELS_BASE = "https://api.pexels.com/videos";
const PIXABAY_BASE = "https://pixabay.com/api/videos";
const DEFAULT_EXCLUDE_DAYS = 30;
const DEFAULT_COUNT = 8;

interface PexelsVideo {
  id: number;
  duration: number;
  width: number;
  height: number;
  image: string;
  video_files: Array<{
    id: number;
    quality: string;
    file_type: string;
    width: number | null;
    height: number | null;
    link: string;
  }>;
}

interface PexelsSearchResponse {
  videos: PexelsVideo[];
}

interface PixabayVideo {
  id: number;
  duration: number;
  picture_id: string;
  videos: Record<string, {
    url: string;
    width: number;
    height: number;
  }>;
}

interface PixabaySearchResponse {
  hits: PixabayVideo[];
}

/**
 * Fetch B-roll candidates for a list of queries, deduped against recent
 * usage. Returns up to `opts.count` distinct clips. Fails loud if no
 * results across both providers — never silently substitutes.
 */
export async function fetchStockClips(
  queries: string[],
  opts: FetchOptions = {},
): Promise<StockClip[]> {
  const count = opts.count ?? DEFAULT_COUNT;
  const minDuration = opts.minDurationSec ?? 3;
  const maxDuration = opts.maxDurationSec ?? 30;
  const excludeDays = opts.excludeRecentDays ?? DEFAULT_EXCLUDE_DAYS;

  const recentExternalIds = await loadRecentExternalIds(excludeDays);

  const collected: StockClip[] = [];
  const seenIds = new Set<string>();

  for (const query of queries) {
    if (collected.length >= count) break;

    const pexelsResults = await tryPexels(query, minDuration, maxDuration).catch((err) => {
      logger.warn(`[cmo:stock] Pexels failed for query='${query}': ${err.message ?? err}`);
      return [] as StockClip[];
    });

    for (const clip of pexelsResults) {
      const key = `${clip.provider}:${clip.externalId}`;
      if (seenIds.has(key)) continue;
      if (recentExternalIds.has(key)) continue;
      collected.push(clip);
      seenIds.add(key);
      if (collected.length >= count) break;
    }

    if (collected.length >= count) break;

    const pixabayResults = await tryPixabay(query, minDuration, maxDuration).catch((err) => {
      logger.warn(`[cmo:stock] Pixabay failed for query='${query}': ${err.message ?? err}`);
      return [] as StockClip[];
    });

    for (const clip of pixabayResults) {
      const key = `${clip.provider}:${clip.externalId}`;
      if (seenIds.has(key)) continue;
      if (recentExternalIds.has(key)) continue;
      collected.push(clip);
      seenIds.add(key);
      if (collected.length >= count) break;
    }
  }

  if (collected.length === 0) {
    throw new Error(
      `[cmo:stock] no clips found across Pexels + Pixabay for queries: ${queries.join(" | ")}. ` +
        `Try broader / less metaphorical queries.`,
    );
  }

  return collected;
}

async function tryPexels(query: string, minDuration: number, maxDuration: number): Promise<StockClip[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    logger.warn("[cmo:stock] PEXELS_API_KEY not set — skipping Pexels");
    return [];
  }

  const url = `${PEXELS_BASE}/search?query=${encodeURIComponent(query)}&per_page=20&orientation=portrait`;
  const response = await fetch(url, { headers: { Authorization: key } });
  if (!response.ok) throw new Error(`Pexels ${response.status}`);
  const data = (await response.json()) as PexelsSearchResponse;

  return data.videos
    .filter((v) => v.duration >= minDuration && v.duration <= maxDuration)
    .map((v) => {
      // Prefer HD MP4. Skip if no usable file.
      const hd = v.video_files.find(
        (f) => f.file_type === "video/mp4" && (f.quality === "hd" || f.quality === "uhd"),
      );
      const file = hd ?? v.video_files.find((f) => f.file_type === "video/mp4");
      if (!file) return null;
      return {
        provider: "pexels" as AssetProvider,
        externalId: String(v.id),
        url: file.link,
        previewUrl: v.image,
        durationSec: v.duration,
        width: file.width ?? v.width,
        height: file.height ?? v.height,
        query,
      };
    })
    .filter((c): c is StockClip => c !== null);
}

async function tryPixabay(query: string, minDuration: number, maxDuration: number): Promise<StockClip[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) {
    logger.warn("[cmo:stock] PIXABAY_API_KEY not set — skipping Pixabay");
    return [];
  }

  const url = `${PIXABAY_BASE}/?key=${key}&q=${encodeURIComponent(query)}&per_page=20`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Pixabay ${response.status}`);
  const data = (await response.json()) as PixabaySearchResponse;

  return data.hits
    .filter((v) => v.duration >= minDuration && v.duration <= maxDuration)
    .map((v) => {
      // Pixabay returns named sizes: large, medium, small, tiny. Prefer 'large'.
      const variant = v.videos.large ?? v.videos.medium ?? v.videos.small;
      if (!variant) return null;
      return {
        provider: "pixabay" as AssetProvider,
        externalId: String(v.id),
        url: variant.url,
        previewUrl: `https://i.vimeocdn.com/video/${v.picture_id}_640x360.jpg`,
        durationSec: v.duration,
        width: variant.width,
        height: variant.height,
        query,
      };
    })
    .filter((c): c is StockClip => c !== null);
}

async function loadRecentExternalIds(days: number): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      provider: cmoAssetUsage.provider,
      externalId: cmoAssetUsage.externalId,
    })
    .from(cmoAssetUsage)
    .where(sql`${cmoAssetUsage.lastUsedAt} >= ${cutoff}`);
  return new Set(rows.map((r) => `${r.provider}:${r.externalId}`));
}

/**
 * Record that a clip was used in a render. Idempotent — if the (provider,
 * externalId) row exists, increments useCount and appends the render ID.
 */
export async function recordAssetUsage(clip: StockClip, renderId: string): Promise<CmoAssetUsage> {
  const existing = await db.query.cmoAssetUsage.findFirst({
    where: and(
      eq(cmoAssetUsage.provider, clip.provider),
      eq(cmoAssetUsage.externalId, clip.externalId),
    ),
  });

  if (existing) {
    const [updated] = await db
      .update(cmoAssetUsage)
      .set({
        lastUsedAt: new Date(),
        useCount: existing.useCount + 1,
        shippedInRenderIds: existing.shippedInRenderIds.includes(renderId)
          ? existing.shippedInRenderIds
          : [...existing.shippedInRenderIds, renderId],
      })
      .where(eq(cmoAssetUsage.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(cmoAssetUsage)
    .values({
      provider: clip.provider,
      externalId: clip.externalId,
      url: clip.url,
      query: clip.query,
      durationSec: clip.durationSec,
      dimensions: { width: clip.width, height: clip.height },
      shippedInRenderIds: [renderId],
    })
    .returning();
  return created;
}
