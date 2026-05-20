/**
 * TikTok Marketing API integration.
 *
 * v1 surface: upload video → wait for processing → create creative → return
 * external IDs. Same shape as Meta integration so the broadcast job can fan
 * out to both platforms with the same code path.
 *
 * Auth: founder_ad_accounts row with platform='tiktok' (extend the platform
 * enum on the table; existing schema accepts text so no migration needed for
 * the value).
 *
 * Required secrets (set via `fly secrets set`):
 *   TIKTOK_APP_ID, TIKTOK_APP_SECRET (one-time, used to mint access tokens)
 *   TIKTOK_ACCESS_TOKEN (long-lived, stored in founder_ad_accounts.accessToken)
 *   TIKTOK_ADVERTISER_ID (stored in founder_ad_accounts.adAccountId)
 *
 * TikTok docs: https://business-api.tiktok.com/portal/docs (Marketing API v1.3)
 */

import * as fs from "fs";
import FormData from "form-data";
import crypto from "crypto";
import { db } from "../db";
import { founderAdAccounts, type FounderAdAccount } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../utils/logger";

const TIKTOK_BASE = "https://business-api.tiktok.com/open_api/v1.3";

async function loadTiktokAccount(): Promise<FounderAdAccount> {
  const [account] = await db
    .select()
    .from(founderAdAccounts)
    .where(and(eq(founderAdAccounts.platform, "tiktok"), eq(founderAdAccounts.isActive, true)))
    .limit(1);
  if (!account) {
    throw new Error(
      "[cmo:tiktok] no active TikTok ad account on file. " +
        "Add a founder_ad_accounts row with platform='tiktok', adAccountId=<TIKTOK_ADVERTISER_ID>, accessToken=<long-lived token>.",
    );
  }
  return account;
}

export interface TikTokUploadInput {
  videoAbsolutePath: string;
  videoName: string;
  trackingId: string;
}

export interface TikTokUploadResult {
  videoId: string;
  advertiserId: string;
}

export async function uploadVideoToTikTok(input: TikTokUploadInput): Promise<TikTokUploadResult> {
  const account = await loadTiktokAccount();
  const buffer = await fs.promises.readFile(input.videoAbsolutePath);
  const sig = crypto.createHash("md5").update(buffer).digest("hex");

  const form = new FormData();
  form.append("advertiser_id", account.adAccountId);
  form.append("upload_type", "UPLOAD_BY_FILE");
  form.append("video_file", buffer, {
    filename: `${input.trackingId}.mp4`,
    contentType: "video/mp4",
  });
  form.append("video_signature", sig);

  const response = await fetch(`${TIKTOK_BASE}/file/video/ad/upload/`, {
    method: "POST",
    headers: {
      "Access-Token": account.accessToken,
      ...form.getHeaders(),
    },
    body: form as unknown as BodyInit,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`[cmo:tiktok] upload failed (${response.status}): ${errBody.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    code: number;
    message: string;
    data: Array<{ video_id: string; preview_url?: string }>;
  };

  if (data.code !== 0) {
    throw new Error(`[cmo:tiktok] API error (code=${data.code}): ${data.message}`);
  }
  if (!data.data?.[0]?.video_id) {
    throw new Error(`[cmo:tiktok] upload returned no video_id`);
  }

  logger.info(`[cmo:tiktok] uploaded video ${data.data[0].video_id} for tracking_id=${input.trackingId}`);
  return { videoId: data.data[0].video_id, advertiserId: account.adAccountId };
}

export interface TikTokCreativeInput {
  videoId: string;
  advertiserId: string;
  identityId: string;     // TikTok BC ID (TT_USER) — required for SPARK_ADS
  identityType: "AUTH_CODE" | "CUSTOMIZED_USER" | "TT_USER";
  adText: string;         // the ad copy / caption
  ctaButtonText: string;  // "Sign Up" | "Learn More" | "Get Offer"
  landingPageUrl: string;
  trackingId: string;
  campaignId?: string;    // if attaching to an existing campaign
  adGroupId?: string;
}

export interface TikTokCreativeResult {
  adId: string;
  externalUrl?: string;
}

export async function createTikTokAd(input: TikTokCreativeInput): Promise<TikTokCreativeResult> {
  const account = await loadTiktokAccount();

  if (!input.adGroupId) {
    throw new Error(
      "[cmo:tiktok] adGroupId required. Create or pick an existing TikTok ad group before broadcasting.",
    );
  }

  const payload = {
    advertiser_id: account.adAccountId,
    adgroup_id: input.adGroupId,
    creatives: [
      {
        ad_name: `AcreOS · ${input.trackingId}`,
        ad_format: "SINGLE_VIDEO",
        video_id: input.videoId,
        ad_text: input.adText,
        call_to_action: input.ctaButtonText,
        landing_page_url: input.landingPageUrl,
        identity_id: input.identityId,
        identity_type: input.identityType,
        creative_authorized: true,
      },
    ],
  };

  const response = await fetch(`${TIKTOK_BASE}/ad/create/`, {
    method: "POST",
    headers: {
      "Access-Token": account.accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`[cmo:tiktok] create ad failed (${response.status}): ${errBody.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    code: number;
    message: string;
    data: { ad_ids: string[] };
  };

  if (data.code !== 0) {
    throw new Error(`[cmo:tiktok] create ad API error (code=${data.code}): ${data.message}`);
  }
  if (!data.data?.ad_ids?.[0]) {
    throw new Error(`[cmo:tiktok] create returned no ad id`);
  }

  return { adId: data.data.ad_ids[0] };
}
