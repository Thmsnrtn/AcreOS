/**
 * Outbox consumer — broadcast an approved render to a single platform.
 *
 * Event payload: { renderId, platform, bundleId, inboxItemId }
 *
 * Idempotency: if the render already has external IDs recorded for this
 * platform, short-circuits. Re-runnable forever.
 *
 * Reads from approved cmo_ad_renders (status='approved'), uploads to the
 * platform, then writes a row to growth_campaigns (or updates an existing
 * one keyed by tracking_id) so the existing performance ingest paths can
 * pull data on day +1.
 */

import * as path from "path";
import { db } from "../db";
import {
  cmoAdRenders,
  cmoScripts,
  brandProfiles,
  growthCampaigns,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { uploadVideoToMeta, waitForVideoReady, createMetaCreative } from "../integrations/metaAdsVideo";
import { uploadVideoToTikTok, createTikTokAd } from "../integrations/tiktokAds";
import { logger } from "../utils/logger";

export interface CmoBroadcastPayload {
  renderId: string;
  platform: "meta" | "tiktok";
  bundleId?: string;
  inboxItemId?: number;
}

export async function handleCmoBroadcast(payload: CmoBroadcastPayload): Promise<{
  externalId: string;
  externalCampaignId?: string;
}> {
  const render = await db.query.cmoAdRenders.findFirst({
    where: eq(cmoAdRenders.id, payload.renderId),
  });
  if (!render) throw new Error(`[cmo:broadcast] render ${payload.renderId} not found`);

  if (render.status !== "approved" && render.status !== "broadcasting") {
    throw new Error(
      `[cmo:broadcast] render ${payload.renderId} status='${render.status}' — must be 'approved' to broadcast`,
    );
  }

  // Idempotency: check manifest for previously-recorded external IDs.
  const existingManifest = render.manifestJson as { platforms?: Record<string, { externalId?: string }> } | null;
  const existingExternalId = existingManifest?.platforms?.[payload.platform]?.externalId;
  if (existingExternalId) {
    logger.info(
      `[cmo:broadcast] render ${render.id.slice(0, 8)} already broadcast to ${payload.platform}: ${existingExternalId}`,
    );
    return { externalId: existingExternalId };
  }

  const script = await db.query.cmoScripts.findFirst({ where: eq(cmoScripts.id, render.scriptId) });
  if (!script) throw new Error(`[cmo:broadcast] script for render ${render.id} not found`);
  const brand = await db.query.brandProfiles.findFirst({
    where: eq(brandProfiles.id, render.brandProfileId),
  });
  if (!brand) throw new Error(`[cmo:broadcast] brand for render ${render.id} not found`);

  await db
    .update(cmoAdRenders)
    .set({ status: "broadcasting", updatedAt: new Date() })
    .where(eq(cmoAdRenders.id, render.id));

  const storageRoot = process.env.CMO_STORAGE_ROOT ?? "/data/cmo";
  const videoKey = render.storagePath.replace(/^local:/, "");
  const videoAbsPath = path.join(storageRoot, videoKey);

  const funnelStages = brand.funnelStages as Record<string, { ctaLabel: string; ctaUrl: string }>;
  const ctaConfig = funnelStages[script.funnelStage] ?? { ctaLabel: "Start free trial", ctaUrl: "https://acreos.io/auth?mode=register" };

  let externalId: string;
  let externalCampaignId: string | undefined;

  try {
    if (payload.platform === "meta") {
      const uploaded = await uploadVideoToMeta({
        videoAbsolutePath: videoAbsPath,
        name: `${brand.displayName} ${script.hookArchetype}`,
        trackingId: render.trackingId,
      });
      await waitForVideoReady(uploaded.videoId);

      // The creative needs an FB Page ID. Read from env until we add a
      // founder_ad_accounts.pageId column (likely v2). Fail loud if absent
      // so the founder knows the broadcast can't complete.
      const pageId = process.env.META_PAGE_ID;
      if (!pageId) {
        throw new Error(
          "[cmo:broadcast] META_PAGE_ID env not set. Set it via `fly secrets set META_PAGE_ID=<page-id>` before broadcasting to Meta.",
        );
      }

      const creative = await createMetaCreative({
        videoId: uploaded.videoId,
        pageId,
        ctaUrl: ctaConfig.ctaUrl,
        ctaType: "SIGN_UP",
        primaryText: script.body,
        headline: script.hook.slice(0, 40),
        trackingId: render.trackingId,
      });

      externalId = creative.creativeId;
    } else if (payload.platform === "tiktok") {
      const uploaded = await uploadVideoToTikTok({
        videoAbsolutePath: videoAbsPath,
        videoName: `${brand.displayName} ${script.hookArchetype}`,
        trackingId: render.trackingId,
      });

      const identityId = process.env.TIKTOK_IDENTITY_ID;
      const adGroupId = process.env.TIKTOK_DEFAULT_ADGROUP_ID;
      if (!identityId || !adGroupId) {
        throw new Error(
          "[cmo:broadcast] TIKTOK_IDENTITY_ID and TIKTOK_DEFAULT_ADGROUP_ID required. " +
            "Set via `fly secrets set` — pick an existing ad group on TikTok Ads Manager " +
            "(or create one) and grab the identity ID from your business center.",
        );
      }

      const ad = await createTikTokAd({
        videoId: uploaded.videoId,
        advertiserId: uploaded.advertiserId,
        identityId,
        identityType: "TT_USER",
        adText: `${script.hook} ${script.body}`.slice(0, 200),
        ctaButtonText: "SIGN_UP",
        landingPageUrl: ctaConfig.ctaUrl,
        trackingId: render.trackingId,
        adGroupId,
      });

      externalId = ad.adId;
    } else {
      throw new Error(`[cmo:broadcast] unknown platform '${payload.platform}'`);
    }

    // Persist external IDs in the manifest + flip status.
    const updatedManifest = {
      ...(render.manifestJson as Record<string, unknown>),
      platforms: {
        ...(existingManifest?.platforms ?? {}),
        [payload.platform]: { externalId, externalCampaignId, broadcastAt: new Date().toISOString() },
      },
    };

    await db
      .update(cmoAdRenders)
      .set({
        status: "live",
        broadcastAt: new Date(),
        manifestJson: updatedManifest as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(cmoAdRenders.id, render.id));

    logger.info(
      `[cmo:broadcast] render ${render.id.slice(0, 8)} now live on ${payload.platform}: ${externalId}`,
    );
    return { externalId, externalCampaignId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[cmo:broadcast] failed on ${payload.platform}: ${message}`, err instanceof Error ? err : undefined);
    await db
      .update(cmoAdRenders)
      .set({
        status: "error",
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(cmoAdRenders.id, render.id));
    throw err;
  }
}
