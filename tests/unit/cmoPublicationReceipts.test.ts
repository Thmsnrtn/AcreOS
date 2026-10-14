import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
const h = vi.hoisted(() => ({
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
import { handleCmoBroadcast } from "../../server/jobs/cmoBroadcast"
beforeEach(() => {
  vi.resetAllMocks()
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
  h.review.mockResolvedValue({ itemType: "cmo_ad_review", status: "approved", contextBundle: { bundleId: "bundle-1", renders: [{ id: "render-1" }], approvedPlatforms: ["meta", "tiktok"], approvedReviewRevision: "test-revision", approvedDestinations: [{ renderId: "render-1", platform: "meta" }, { renderId: "render-1", platform: "tiktok" }] } });
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
  it("returns the same destination receipt after another destination changed aggregate status", async () => {
    h.render.mockResolvedValue({
      status: "live",
      manifestJson: { platforms: { meta: { externalId: "existing" } } },
    })
    expect(await handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).toEqual({
      externalId: "existing",
    })
    expect(h.meta).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })
  it("allows the second destination after the first has a receipt", async () => {
    h.render.mockResolvedValue({
      id: "render-1",
      aspectRatio: "9:16",
      status: "live",
      bundleId: "bundle-1",
    scriptId: "script-1",
      brandProfileId: 1,
      storagePath: "local:test.mp4",
      manifestJson: { platforms: { meta: { externalId: "existing" } } },
    })
    expect(await handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "tiktok" })).toEqual({
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
    await expect(handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow(
      "reconciliation"
    )
    expect(h.meta).not.toHaveBeenCalled()
  })
  it.each([null, []])("refuses malformed legacy destination records without any effect: %j", async (platforms) => {
    h.render.mockResolvedValue({ status: "approved", manifestJson: { platforms } });
    await expect(handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("reconciliation");
    expect(h.update).not.toHaveBeenCalled(); expect(h.meta).not.toHaveBeenCalled();
  });
  it("checks configuration and pause before the upload", async () => {
    vi.stubEnv("META_PAGE_ID", "")
    await expect(handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow(
      "configuration"
    )
    expect(h.meta).not.toHaveBeenCalled()
    vi.stubEnv("META_PAGE_ID", "test-page")
    h.enabled.mockResolvedValue(false)
    await expect(handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow(
      "paused"
    )
    expect(h.meta).not.toHaveBeenCalled()
  })
  it("refuses a competing destination claim before any provider effect", async () => {
    h.returning.mockResolvedValue([])
    await expect(handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow(
      "already claimed"
    )
    expect(h.meta).not.toHaveBeenCalled()
  })
  it("rechecks pause after upload and retains an uncertain receipt", async () => {
    h.enabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow(
      "paused"
    )
    expect(h.meta).toHaveBeenCalledOnce()
    expect(h.creative).not.toHaveBeenCalled()
    expect(h.set.mock.calls.every(([update]) => update.status !== "live")).toBe(true)
    expect(h.set.mock.calls.at(-1)?.[0]).not.toHaveProperty("errorMessage")
  })
  it("records creative creation without promoting it to confirmed delivery", async () => {
    await handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })
    expect(h.creative).toHaveBeenCalledOnce()
    expect(h.set.mock.calls.every(([update]) => update.status !== "live")).toBe(true)
    expect(h.set.mock.calls.at(-1)?.[0]).not.toHaveProperty("status");
  })
  it("forwards the actual Meta upload account into polling and creative creation", async () => {
    await handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" });
    expect(h.ready).toHaveBeenCalledWith("video-1", { expectedAdAccountId: "act_123" });
    expect(h.creative).toHaveBeenCalledWith(expect.objectContaining({ expectedAdAccountId: "act_123" }));
  });
  it("refuses an upload receipt without an account identity before polling or creation", async () => {
    h.meta.mockResolvedValue({ videoId: "video-1" });
    await expect(handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("account identity is unavailable");
    expect(h.ready).not.toHaveBeenCalled(); expect(h.creative).not.toHaveBeenCalled();
    expect(h.set.mock.calls.at(-1)?.[0]).not.toHaveProperty("status");
  });
  it.each([undefined, "", "   ", 17])("does not record object_created when the provider returns no usable receipt ID: %j", async creativeId => {
    h.creative.mockResolvedValue({ creativeId });
    await expect(handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("receipt");
    expect(h.set.mock.calls.at(-1)?.[0]).not.toHaveProperty("status");
    const states = h.set.mock.calls.flatMap(([update]) => update.manifestJson
      ? new PgDialect().sqlToQuery(update.manifestJson).params.filter((value): value is string => typeof value === "string" && value.startsWith("{")).map(value => JSON.parse(value).state)
      : []);
    expect(states).toContain("uncertain"); expect(states).not.toContain("object_created");
  });
  it.each([null, "", 17])("refuses malformed existing receipt IDs without any new effect: %j", async externalId => {
    h.render.mockResolvedValue({ status: "live", manifestJson: { platforms: { meta: { externalId } } } });
    await expect(handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("reconciliation");
    expect(h.meta).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });
  it("requires this review's approved destination before upload", async () => {
    h.review.mockResolvedValue({ itemType: "cmo_ad_review", status: "approved", contextBundle: { bundleId: "bundle-1", renders: [{ id: "render-1" }], approvedPlatforms: ["meta"] } });
    await expect(handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "tiktok" })).rejects.toThrow("approval");
    expect(h.tiktok).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });
  it("refuses an unapproved render/platform pair even when that platform is approved", async () => {
    h.review.mockResolvedValue({ itemType: "cmo_ad_review", status: "approved", contextBundle: { bundleId: "bundle-1", renders: [{ id: "render-1" }], approvedPlatforms: ["meta"], approvedReviewRevision: "test-revision", approvedDestinations: [{ renderId: "other-render", platform: "meta" }] } });
    await expect(handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("approval");
    expect(h.meta).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });
  it("refuses a queued job from a different displayed revision before effects", async () => {
    await expect(handleCmoBroadcast({ reviewRevision: "other-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("approval");
    expect(h.meta).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });
  it("refuses revoked approval after upload and never creates the external object", async () => {
    h.review.mockResolvedValueOnce({ itemType: "cmo_ad_review", status: "approved", contextBundle: { bundleId: "bundle-1", renders: [{ id: "render-1" }], approvedPlatforms: ["meta"], approvedReviewRevision: "test-revision", approvedDestinations: [{ renderId: "render-1", platform: "meta" }] } }).mockResolvedValueOnce({ status: "rejected" });
    await expect(handleCmoBroadcast({ reviewRevision: "test-revision", inboxItemId: 1, renderId: "render-1", platform: "meta" })).rejects.toThrow("approval");
    expect(h.meta).toHaveBeenCalledOnce(); expect(h.creative).not.toHaveBeenCalled();
    expect(h.set.mock.calls.at(-1)?.[0]).not.toHaveProperty("status");
  });
})
