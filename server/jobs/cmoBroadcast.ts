/**
 * Outbox consumer — broadcast an approved render to a single platform.
 *
 * Event payload: { renderId, platform, bundleId, inboxItemId }
 *
 * Idempotency: if the render already has external IDs recorded for this
 * platform, short-circuits. In-flight or uncertain work requires reconciliation.
 *
 * Reads approved renders, uploads to the selected paid instrument and
 * records an ad creative/ad object receipt. Delivery is unverified until
 * provider read-back confirms it. This is not an organic posting adapter.
 */

import * as path from "path";
import { db } from "../db";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import {
  cmoAdRenders,
  cmoScripts,
  brandProfiles,
  decisionsInboxItems,
} from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { isPublishingEnabledFresh } from "../services/autopilot/settings";
import { uploadVideoToMeta, waitForVideoReady, createMetaCreative } from "../integrations/metaAdsVideo";
import { uploadVideoToTikTok, createTikTokAd } from "../integrations/tiktokAds";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

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

  // Return this destination's own receipt before inspecting aggregate status.
  const existingManifest = render.manifestJson as { platforms?: Record<string, { externalId?: string; state?: string }> } | null;
  const platformRecords = existingManifest?.platforms;
  if (platformRecords !== undefined && (platformRecords === null || typeof platformRecords !== "object" || Array.isArray(platformRecords))) {
    throw new Error("Malformed destination records require reconciliation before publication");
  }
  const existingReceipt = existingManifest?.platforms?.[payload.platform];
  if (existingReceipt?.externalId) return { externalId: existingReceipt.externalId };
  if (existingReceipt?.state) throw new Error("Publication requires reconciliation before retry");
  if (!["approved", "broadcasting", "live"].includes(render.status)) throw new Error("Render is not approved for publication");
  if (!["meta", "tiktok"].includes(payload.platform)) throw new Error("Unsupported publication platform");
  const requireCurrentReview = async () => {
    if (!Number.isInteger(payload.inboxItemId) || !payload.inboxItemId) throw new Error("Current video review approval is unavailable");
    const review = await unscopedForPlatformOps("CMO worker: verify the founder's platform-wide video approval before provider effects")
      .query.decisionsInboxItems.findFirst({ where: eq(decisionsInboxItems.id, payload.inboxItemId) });
    const ctx = review?.contextBundle as { bundleId?: string; renders?: Array<{ id: string }>; approvedPlatforms?: string[] } | null;
    const current = await db.query.cmoAdRenders.findFirst({ where: eq(cmoAdRenders.id, render.id) });
    if (review?.itemType !== "cmo_ad_review" || review.status !== "approved" ||
      !ctx?.bundleId || ctx.bundleId !== render.bundleId || !ctx.renders?.some(r => r.id === render.id) ||
      !ctx.approvedPlatforms?.includes(payload.platform) || !current ||
      !["approved", "broadcasting", "live"].includes(current.status) ||
      current.bundleId !== render.bundleId || current.storagePath !== render.storagePath) {
      throw new Error("Video review approval or assets changed; publication refused");
    }
  };
  await requireCurrentReview();
  if (!(await isPublishingEnabledFresh())) throw new Error("Publication is paused");
  // Configuration is checked before any upload or billable provider effect.
  const pageId = process.env.META_PAGE_ID;
  const identityId = process.env.TIKTOK_IDENTITY_ID;
  const adGroupId = process.env.TIKTOK_DEFAULT_ADGROUP_ID;
  if (payload.platform === "meta" && !pageId) throw new Error("Meta Page configuration is unavailable");
  if (payload.platform === "tiktok" && (!identityId || !adGroupId)) throw new Error("TikTok destination configuration is unavailable");

  const script = await db.query.cmoScripts.findFirst({ where: eq(cmoScripts.id, render.scriptId) });
  if (!script) throw new Error(`[cmo:broadcast] script for render ${render.id} not found`);
  const brand = await db.query.brandProfiles.findFirst({
    where: eq(brandProfiles.id, render.brandProfileId),
  });
  if (!brand) throw new Error(`[cmo:broadcast] brand for render ${render.id} not found`);

  // Atomic per-destination claim. Another platform's receipt is never copied
  // from a stale read. A crash after the claim requires reconciliation, not a
  // blind repeat of an ambiguous external effect.
  const claim = { state: "processing", startedAt: clock.now().toISOString() };
  const [claimed] = await db.update(cmoAdRenders).set({
    status: "broadcasting", updatedAt: clock.now(),
    manifestJson: sql`jsonb_set(coalesce(${cmoAdRenders.manifestJson}, '{}'::jsonb), '{platforms}', coalesce(${cmoAdRenders.manifestJson}->'platforms', '{}'::jsonb) || jsonb_build_object(${payload.platform}::text, ${JSON.stringify(claim)}::jsonb), true)`,
  }).where(and(eq(cmoAdRenders.id, render.id), inArray(cmoAdRenders.status, ["approved", "broadcasting", "live"]), sql`NOT (coalesce(${cmoAdRenders.manifestJson}->'platforms', '{}'::jsonb) ? ${payload.platform})`)).returning({ id: cmoAdRenders.id });
  if (!claimed) throw new Error("Publication already claimed or approval changed; refresh before retry");

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

      await requireCurrentReview();
      if (!(await isPublishingEnabledFresh())) throw new Error("Publication paused after upload");
      const creative = await createMetaCreative({
        videoId: uploaded.videoId,
        pageId: pageId!,
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

      await requireCurrentReview();
      if (!(await isPublishingEnabledFresh())) throw new Error("Publication paused after upload");
      const ad = await createTikTokAd({
        videoId: uploaded.videoId,
        advertiserId: uploaded.advertiserId,
        identityId: identityId!,
        identityType: "TT_USER",
        adText: `${script.hook} ${script.body}`.slice(0, 200),
        ctaButtonText: "SIGN_UP",
        landingPageUrl: ctaConfig.ctaUrl,
        trackingId: render.trackingId,
        adGroupId: adGroupId!,
      });

      externalId = ad.adId;
    } else {
      throw new Error(`[cmo:broadcast] unknown platform '${payload.platform}'`);
    }

    // Creative/ad creation is a receipt, not proof of delivery or organic publication.
    const receipt = { state: "object_created", objectKind: payload.platform === "meta" ? "ad_creative" : "ad", externalId, delivery: "unverified", recordedAt: clock.now().toISOString() };
    await db.update(cmoAdRenders).set({
      broadcastAt: clock.now(), updatedAt: clock.now(),
      manifestJson: sql`jsonb_set(coalesce(${cmoAdRenders.manifestJson}, '{}'::jsonb), '{platforms}', coalesce(${cmoAdRenders.manifestJson}->'platforms', '{}'::jsonb) || jsonb_build_object(${payload.platform}::text, ${JSON.stringify(receipt)}::jsonb), true)`,
    }).where(eq(cmoAdRenders.id, render.id));
    logger.info(`[cmo:broadcast] ${payload.platform} object recorded; delivery unverified`);
    return { externalId, externalCampaignId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[cmo:broadcast] failed on ${payload.platform}: ${message}`, err instanceof Error ? err : undefined);
    const uncertain = { state: "uncertain", reason: "Provider or receipt write failed; reconcile before retry", recordedAt: clock.now().toISOString() };
    await db.update(cmoAdRenders).set({
      updatedAt: clock.now(),
      manifestJson: sql`jsonb_set(coalesce(${cmoAdRenders.manifestJson}, '{}'::jsonb), '{platforms}', coalesce(${cmoAdRenders.manifestJson}->'platforms', '{}'::jsonb) || jsonb_build_object(${payload.platform}::text, ${JSON.stringify(uncertain)}::jsonb), true)`,
    }).where(eq(cmoAdRenders.id, render.id));
    throw err;
  }
}
