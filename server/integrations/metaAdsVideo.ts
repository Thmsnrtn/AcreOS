/**
 * Meta Marketing API — video creative broadcast.
 *
 * Pipeline:
 *  1. Upload local MP4 to Meta as ad video (returns video_id)
 *  2. Wait for processing (poll status until "ready")
 *  3. Create ad creative referencing the video_id + tracking_id
 *  4. Attach to the brand's active campaign / ad set (uses existing growth_campaigns row)
 *  5. Return external IDs back to the caller for persistence
 *
 * Auth: reads founder_ad_accounts row where platform='meta' and isActive=true.
 * Idempotency: if a render already has externalCreativeId set, short-circuits.
 *
 * Failure surface: any HTTP-level Meta error throws with the Meta error body
 * preserved. cmoBroadcast.ts catches, flips render.status='error', the
 * decision item gets a "needs attention" treatment.
 */

import * as fs from "fs";
import * as path from "path";
import FormData from "form-data";
import { db } from "../db";
import { founderAdAccounts, type FounderAdAccount } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../utils/logger";

const META_BASE = "https://graph.facebook.com/v19.0";

export interface MetaUploadInput {
  videoAbsolutePath: string;
  name: string;       // human-readable name in Meta Ads Manager
  trackingId: string; // becomes part of the video name suffix
}

export interface MetaUploadResult {
  videoId: string;
  videoName: string;
  adAccountId: string;
}

async function loadMetaAccount(): Promise<FounderAdAccount> {
  const [account] = await db
    .select()
    .from(founderAdAccounts)
    .where(and(eq(founderAdAccounts.platform, "meta"), eq(founderAdAccounts.isActive, true)))
    .limit(1);
  if (!account) {
    throw new Error(
      "[cmo:meta] no active Meta ad account on file. " +
        "Add one via founder_ad_accounts (platform='meta') with adAccountId, accessToken, pixelId.",
    );
  }
  return account;
}

export async function uploadVideoToMeta(input: MetaUploadInput): Promise<MetaUploadResult> {
  const account = await loadMetaAccount();
  const adAccountId = account.adAccountId.startsWith("act_") ? account.adAccountId : `act_${account.adAccountId}`;
  const url = `${META_BASE}/${adAccountId}/advideos`;

  // Meta accepts multipart upload directly. Stream the file rather than
  // reading into memory — these MP4s are small (sub-10MB at 1080p/30s/H.264)
  // but the streaming path keeps the worker memory flat.
  if (!fs.existsSync(input.videoAbsolutePath)) {
    throw new Error(`[cmo:meta] file not found: ${input.videoAbsolutePath}`);
  }

  const form = new FormData();
  form.append("source", fs.createReadStream(input.videoAbsolutePath));
  form.append("access_token", account.accessToken);
  form.append("name", `${input.name} · ${input.trackingId}`);

  const response = await fetch(url, {
    method: "POST",
    body: form as unknown as BodyInit,
    headers: form.getHeaders(),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`[cmo:meta] upload failed (${response.status}): ${errBody.slice(0, 500)}`);
  }

  const data = (await response.json()) as { id: string };
  if (!data.id) {
    throw new Error(`[cmo:meta] upload returned no video id: ${JSON.stringify(data).slice(0, 300)}`);
  }

  logger.info(`[cmo:meta] uploaded video ${data.id} for tracking_id=${input.trackingId}`);

  return {
    videoId: data.id,
    videoName: input.name,
    adAccountId: adAccountId,
  };
}

/**
 * Poll Meta until the video is processed and ready to attach to a creative.
 * Meta usually finishes within 15-60s for sub-30s 1080p clips.
 */
export async function waitForVideoReady(videoId: string, opts?: { maxWaitMs?: number }): Promise<void> {
  const account = await loadMetaAccount();
  const maxWaitMs = opts?.maxWaitMs ?? 5 * 60 * 1000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    const response = await fetch(`${META_BASE}/${videoId}?fields=status&access_token=${account.accessToken}`);
    if (!response.ok) {
      throw new Error(`[cmo:meta] status check failed: ${response.status}`);
    }
    const data = (await response.json()) as { status?: { video_status?: string } };
    const status = data.status?.video_status;
    if (status === "ready") return;
    if (status === "error") throw new Error(`[cmo:meta] video processing errored`);
    await new Promise((r) => setTimeout(r, 4000));
  }

  throw new Error(`[cmo:meta] timed out waiting for video ${videoId} to process`);
}

export interface MetaCreativeInput {
  videoId: string;
  pageId: string;       // FB page id
  ctaUrl: string;       // destination URL
  ctaType: string;      // 'SIGN_UP' | 'LEARN_MORE' | 'GET_OFFER'
  primaryText: string;  // ad body
  headline: string;     // ad headline
  description?: string;
  trackingId: string;
}

export interface MetaCreativeResult {
  creativeId: string;
  adAccountId: string;
}

export async function createMetaCreative(input: MetaCreativeInput): Promise<MetaCreativeResult> {
  const account = await loadMetaAccount();
  const adAccountId = account.adAccountId.startsWith("act_") ? account.adAccountId : `act_${account.adAccountId}`;
  const url = `${META_BASE}/${adAccountId}/adcreatives`;

  const creativePayload = {
    name: `AcreOS · ${input.trackingId}`,
    object_story_spec: {
      page_id: input.pageId,
      video_data: {
        video_id: input.videoId,
        call_to_action: {
          type: input.ctaType,
          value: { link: input.ctaUrl },
        },
        message: input.primaryText,
        title: input.headline,
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...creativePayload,
      access_token: account.accessToken,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`[cmo:meta] create creative failed (${response.status}): ${errBody.slice(0, 500)}`);
  }

  const data = (await response.json()) as { id: string };
  return { creativeId: data.id, adAccountId };
}
