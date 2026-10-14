import type { CmoApprovedAsset } from "@shared/cmo/publicationAssets";
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { PgDialect } from "drizzle-orm/pg-core"
const h = vi.hoisted(() => ({
  read: vi.fn(),
  render: vi.fn(),
  script: vi.fn(),
  brand: vi.fn(),
  review: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
  enabled: vi.fn(),
  meta: vi.fn(),
  ready: vi.fn(),
  creative: vi.fn(),
  tiktok: vi.fn(),
  ad: vi.fn(),
}))
vi.mock("../../server/db", () => ({
  db: {
    query: {
      cmoAdRenders: { findFirst: h.render },
      cmoScripts: { findFirst: h.script },
      brandProfiles: { findFirst: h.brand },
      decisionsInboxItems: { findFirst: h.review },
    },
    update: h.update,
  },
}))
vi.mock("../../server/services/autopilot/settings", () => ({ isPublishingEnabledFresh: h.enabled }))
vi.mock("../../server/integrations/metaAdsVideo", () => ({
  uploadVideoToMeta: h.meta,
  waitForVideoReady: h.ready,
  createMetaCreative: h.creative,
}))
vi.mock("../../server/integrations/tiktokAds", () => ({
  uploadVideoToTikTok: h.tiktok,
  createTikTokAd: h.ad,
}))
vi.mock("../../server/services/cmo/storage", () => ({ getStorage: () => ({ read: h.read }) }))
const videoBytes = Buffer.from("approved-video-fixture");
const videoRevision = createHash("sha256").update(videoBytes).digest("hex");
const approvedAsset: CmoApprovedAsset = { renderId: "render-1", scriptId: "script-1", brandProfileId: 1, trackingId: "tracking", aspectRatio: "9:16", storagePath: "local:test.mp4", publication: { schema: "cmo.publication.v1", video: { sha256: videoRevision, byteLength: videoBytes.length }, copy: { name: "Frozen creative", primaryText: "Approved body", headline: "Approved headline", adText: "Approved caption", ctaUrl: "https://acreos.io/approved", ctaType: "SIGN_UP" } } };
import { publicationAssetRevision } from "../../server/services/cmo/publicationAssets";
const assetRevision = publicationAssetRevision(approvedAsset);
import { handleCmoBroadcast } from "../../server/jobs/cmoBroadcast"
beforeEach(() => {
  vi.resetAllMocks()
  h.read.mockResolvedValue(videoBytes)
  vi.stubEnv("META_PAGE_ID", "test-page")
  vi.stubEnv("TIKTOK_IDENTITY_ID", "test-identity")
  vi.stubEnv("TIKTOK_DEFAULT_ADGROUP_ID", "test-group")
  h.render.mockResolvedValue({
    id: "render-1",
    aspectRatio: "9:16",
    status: "approved",
    bundleId: "bundle-1",
    scriptId: "script-1",
    brandProfileId: 1,
    manifestJson: {},
    storagePath: "local:test.mp4",
    trackingId: "tracking",
  })
  h.review.mockResolvedValue({ itemType: "cmo_ad_review", status: "approved", contextBundle: { bundleId: "bundle-1", renders: [{ id: "render-1" }], approvedPlatforms: ["meta", "tiktok"], approvedAssets: { "render-1": approvedAsset }, approvedReviewRevision: "test-revision", approvedDestinations: [{ renderId: "render-1", platform: "meta" }, { renderId: "render-1", platform: "tiktok" }] } });
  h.script.mockResolvedValue({ hook: "Research", body: "Read evidence", funnelStage: "cold" })
  h.brand.mockResolvedValue({ displayName: "AcreOS", funnelStages: {} })
  h.update.mockReturnValue({ set: h.set })
  h.set.mockReturnValue({ where: h.where })
  h.where.mockReturnValue({ returning: h.returning })
  h.returning.mockResolvedValue([{ id: "render-1" }])
  h.enabled.mockResolvedValue(true)
  h.meta.mockResolvedValue({ videoId: "video-1", adAccountId: "act_123" })
  h.creative.mockResolvedValue({ creativeId: "creative-1" })
  h.tiktok.mockResolvedValue({ videoId: "video-2", advertiserId: "account-2" })
  h.ad.mockResolvedValue({ adId: "ad-1" })
})
describe("CMO per-destination publication boundary", () => {
  it("publishes the frozen approved bytes and copy without reading mutable script or brand", async () => {
    await handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" });
    expect(h.meta).toHaveBeenCalledWith(expect.objectContaining({ videoBytes, name: "Frozen creative" }));
    expect(h.meta.mock.calls[0][0].videoBytes).not.toBe(videoBytes);
    expect(h.meta.mock.calls[0][0]).not.toHaveProperty("videoAbsolutePath");
    expect(h.creative).toHaveBeenCalledWith(expect.objectContaining({ primaryText: "Approved body", headline: "Approved headline", ctaUrl: "https://acreos.io/approved" }));
    expect(h.script).not.toHaveBeenCalled(); expect(h.brand).not.toHaveBeenCalled();
  });
  it("uses the frozen TikTok caption and CTA", async () => {
    await handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "tiktok" });
    expect(h.tiktok).toHaveBeenCalledWith(expect.objectContaining({ videoBytes, videoName: "Frozen creative" }));
    expect(h.ad).toHaveBeenCalledWith(expect.objectContaining({ adText: "Approved caption", landingPageUrl: "https://acreos.io/approved" }));
    expect(h.script).not.toHaveBeenCalled(); expect(h.brand).not.toHaveBeenCalled();
  });
  it("refuses a frozen approval changed after upload", async () => {
    const review = await h.review();
    h.review.mockResolvedValueOnce(review).mockResolvedValueOnce({ ...review, contextBundle: { ...review.contextBundle, approvedAssets: { "render-1": { ...approvedAsset, publication: { ...approvedAsset.publication, copy: { ...approvedAsset.publication.copy, ctaUrl: "https://acreos.io/replacement" } } } } } });
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("proof changed");
    expect(h.meta).toHaveBeenCalledOnce(); expect(h.creative).not.toHaveBeenCalled();
  });
  it("refuses copy replaced before the worker first reads the approved context", async () => {
    const review = await h.review();
    review.contextBundle.approvedAssets["render-1"] = { ...approvedAsset, publication: { ...approvedAsset.publication, copy: { ...approvedAsset.publication.copy, ctaUrl: "https://acreos.io/replacement" } } };
    h.review.mockResolvedValue(review);
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("proof changed");
    expect(h.meta).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });
  it("refuses replaced video bytes before claiming or uploading", async () => {
    h.read.mockResolvedValue(Buffer.from("replaced-video-fixture"));
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("bytes");
    expect(h.update).not.toHaveBeenCalled(); expect(h.meta).not.toHaveBeenCalled();
  });
  it("refuses legacy approval without frozen assets before any effects", async () => {
    const review = await h.review(); delete review.contextBundle.approvedAssets; h.review.mockResolvedValue(review);
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("proof");
    expect(h.update).not.toHaveBeenCalled(); expect(h.meta).not.toHaveBeenCalled();
  });
  it("returns the same destination receipt after another destination changed aggregate status", async () => {
    h.render.mockResolvedValue({
      status: "live",
      manifestJson: { platforms: { meta: { externalId: "existing" } } },
    })
    expect(await handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).toEqual({
      externalId: "existing",
    })
    expect(h.meta).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })
  it("allows the second destination after the first has a receipt", async () => {
    h.render.mockResolvedValue({
      id: "render-1",
      aspectRatio: "9:16",
      trackingId: "tracking",
      status: "live",
      bundleId: "bundle-1",
    scriptId: "script-1",
      brandProfileId: 1,
      storagePath: "local:test.mp4",
      manifestJson: { platforms: { meta: { externalId: "existing" } } },
    })
    expect(await handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "tiktok" })).toEqual({
      externalId: "ad-1",
      externalCampaignId: undefined,
    })
    expect(h.ad).toHaveBeenCalledOnce()
    expect(h.meta).not.toHaveBeenCalled()
  })
  it("refuses ambiguous and in-flight destinations without republishing", async () => {
    h.render.mockResolvedValue({
      status: "broadcasting",
      manifestJson: { platforms: { meta: { state: "uncertain" } } },
    })
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow(
      "reconciliation"
    )
    expect(h.meta).not.toHaveBeenCalled()
  })
  it.each([null, []])("refuses malformed legacy destination records without any effect: %j", async (platforms) => {
    h.render.mockResolvedValue({ status: "approved", manifestJson: { platforms } });
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("reconciliation");
    expect(h.update).not.toHaveBeenCalled(); expect(h.meta).not.toHaveBeenCalled();
  });
  it("checks configuration and pause before the upload", async () => {
    vi.stubEnv("META_PAGE_ID", "")
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow(
      "configuration"
    )
    expect(h.meta).not.toHaveBeenCalled()
    vi.stubEnv("META_PAGE_ID", "test-page")
    h.enabled.mockResolvedValue(false)
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow(
      "paused"
    )
    expect(h.meta).not.toHaveBeenCalled()
  })
  it("refuses a competing destination claim before any provider effect", async () => {
    h.returning.mockResolvedValue([])
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow(
      "already claimed"
    )
    expect(h.meta).not.toHaveBeenCalled()
  })
  it("rechecks pause after upload and retains an uncertain receipt", async () => {
    h.enabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow(
      "paused"
    )
    expect(h.meta).toHaveBeenCalledOnce()
    expect(h.creative).not.toHaveBeenCalled()
    expect(h.set.mock.calls.every(([update]) => update.status !== "live")).toBe(true)
    expect(h.set.mock.calls.at(-1)?.[0]).not.toHaveProperty("errorMessage")
  })
  it("records creative creation without promoting it to confirmed delivery", async () => {
    await handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })
    expect(h.creative).toHaveBeenCalledOnce()
    expect(h.set.mock.calls.every(([update]) => update.status !== "live")).toBe(true)
    expect(h.set.mock.calls.at(-1)?.[0]).not.toHaveProperty("status");
  })
  it("forwards the actual Meta upload account into polling and creative creation", async () => {
    await handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" });
    expect(h.ready).toHaveBeenCalledWith("video-1", { expectedAdAccountId: "act_123" });
    expect(h.creative).toHaveBeenCalledWith(expect.objectContaining({ expectedAdAccountId: "act_123" }));
  });
  it("refuses an upload receipt without an account identity before polling or creation", async () => {
    h.meta.mockResolvedValue({ videoId: "video-1" });
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("account identity is unavailable");
    expect(h.ready).not.toHaveBeenCalled(); expect(h.creative).not.toHaveBeenCalled();
    expect(h.set.mock.calls.at(-1)?.[0]).not.toHaveProperty("status");
  });
  it.each([undefined, "", "   ", 17])("does not record object_created when the provider returns no usable receipt ID: %j", async creativeId => {
    h.creative.mockResolvedValue({ creativeId });
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("receipt");
    expect(h.set.mock.calls.at(-1)?.[0]).not.toHaveProperty("status");
    const states = h.set.mock.calls.flatMap(([update]) => update.manifestJson
      ? new PgDialect().sqlToQuery(update.manifestJson).params.filter((value): value is string => typeof value === "string" && value.startsWith("{")).map(value => JSON.parse(value).state)
      : []);
    expect(states).toContain("uncertain"); expect(states).not.toContain("object_created");
  });
  it.each([null, "", 17])("refuses malformed existing receipt IDs without any new effect: %j", async externalId => {
    h.render.mockResolvedValue({ status: "live", manifestJson: { platforms: { meta: { externalId } } } });
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("reconciliation");
    expect(h.meta).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });
  it("requires this review's approved destination before upload", async () => {
    h.review.mockResolvedValue({ itemType: "cmo_ad_review", status: "approved", contextBundle: { bundleId: "bundle-1", renders: [{ id: "render-1" }], approvedPlatforms: ["meta"] } });
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "tiktok" })).rejects.toThrow("approval");
    expect(h.tiktok).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });
  it("refuses an unapproved render/platform pair even when that platform is approved", async () => {
    h.review.mockResolvedValue({ itemType: "cmo_ad_review", status: "approved", contextBundle: { bundleId: "bundle-1", renders: [{ id: "render-1" }], approvedPlatforms: ["meta"], approvedAssets: { "render-1": approvedAsset }, approvedReviewRevision: "test-revision", approvedDestinations: [{ renderId: "other-render", platform: "meta" }] } });
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("approval");
    expect(h.meta).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });
  it("refuses a queued job from a different displayed revision before effects", async () => {
    await expect(handleCmoBroadcast({ reviewRevision: "other-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("approval");
    expect(h.meta).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });
  it("refuses revoked approval after upload and never creates the external object", async () => {
    h.review.mockResolvedValueOnce({ itemType: "cmo_ad_review", status: "approved", contextBundle: { bundleId: "bundle-1", renders: [{ id: "render-1" }], approvedPlatforms: ["meta"], approvedAssets: { "render-1": approvedAsset }, approvedReviewRevision: "test-revision", approvedDestinations: [{ renderId: "render-1", platform: "meta" }] } }).mockResolvedValueOnce({ status: "rejected" });
    await expect(handleCmoBroadcast({ assetRevision, reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("approval");
    expect(h.meta).toHaveBeenCalledOnce(); expect(h.creative).not.toHaveBeenCalled();
    expect(h.set.mock.calls.at(-1)?.[0]).not.toHaveProperty("status");
  });
})
