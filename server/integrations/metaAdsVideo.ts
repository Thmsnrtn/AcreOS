/**
 * Meta Marketing API — video creative broadcast.
 *
 * Uploads the caller's verified video Buffer, polls processing and creates an
 * ad creative. This adapter does not attach it to a campaign or prove delivery.
 * Reads one unambiguous active founder account and preserves upload identity.
 * The worker records uncertain effects for reconciliation rather than retrying.

 */

import FormData from "form-data";
import { openFounderAdAccount } from "../services/founderAdAccountSecrets";
import { db } from "../db";
import { founderAdAccounts, type FounderAdAccount } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

const META_BASE = "https://graph.facebook.com/v19.0";

export interface MetaUploadInput {
  videoBytes: Buffer;
  name: string;       // human-readable name in Meta Ads Manager
  trackingId: string; // becomes part of the video name suffix
}

export interface MetaUploadResult {
  videoId: string;
  videoName: string;
  adAccountId: string;
}

function normalizedMetaAccountId(id: string): string {
  if (typeof id !== "string" || !id.trim()) throw new Error("[cmo:meta] upload account identity is unavailable");
  const value = id.trim();
  return value.startsWith("act_") ? value : `act_${value}`;
}

async function loadMetaAccount(): Promise<FounderAdAccount> {
  const accounts = await db
    .select()
    .from(founderAdAccounts)
    .where(and(eq(founderAdAccounts.platform, "meta"), eq(founderAdAccounts.isActive, true)))
    .limit(2);
  if (accounts.length > 1) throw new Error("[cmo:meta] multiple active accounts require explicit reconciliation");
  const [account] = accounts;
  if (!account) {
    throw new Error(
      "[cmo:meta] no active Meta ad account on file. " +
        "Add one via founder_ad_accounts (platform='meta') with adAccountId, accessToken, pixelId.",
    );
  }
  // Secrets are sealed at rest (DEFECT-0054).
  return openFounderAdAccount(account);
}

export async function uploadVideoToMeta(input: MetaUploadInput): Promise<MetaUploadResult> {
  const account = await loadMetaAccount();
  const adAccountId = normalizedMetaAccountId(account.adAccountId);
  const url = `${META_BASE}/${adAccountId}/advideos`;

  if (!Buffer.isBuffer(input.videoBytes) || input.videoBytes.length === 0) throw new Error("[cmo:meta] approved video bytes are unavailable");
  const form = new FormData();
  form.append("source", input.videoBytes, { filename: `${input.trackingId}.mp4`, contentType: "video/mp4" });
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
export async function waitForVideoReady(videoId: string, opts: { expectedAdAccountId: string; maxWaitMs?: number }): Promise<void> {
  const account = await loadMetaAccount();
  if (normalizedMetaAccountId(account.adAccountId) !== normalizedMetaAccountId(opts?.expectedAdAccountId)) {
    throw new Error("[cmo:meta] account changed since upload; publication requires reconciliation");
  }
  const maxWaitMs = opts?.maxWaitMs ?? 5 * 60 * 1000;
  const startedAt = clock.nowMs();

  while (clock.nowMs() - startedAt < maxWaitMs) {
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
  expectedAdAccountId: string; // identity returned by this video's upload
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
  const adAccountId = normalizedMetaAccountId(account.adAccountId);
  if (adAccountId !== normalizedMetaAccountId(input.expectedAdAccountId)) {
    throw new Error("[cmo:meta] account changed since upload; publication requires reconciliation");
  }
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

  const data = (await response.json()) as { id?: unknown };
  if (typeof data.id !== "string" || !data.id.trim()) {
    throw new Error("[cmo:meta] create returned no valid object receipt identifier; reconcile before retry");
  }
  return { creativeId: data.id, adAccountId };
}
