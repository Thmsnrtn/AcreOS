import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ accounts: [] as any[], fetch: vi.fn() }));
vi.mock("../../server/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async (n: number) => h.accounts.slice(0, n) }) }) }) } }));
vi.mock("../../server/services/founderAdAccountSecrets", () => ({ openFounderAdAccount: (account: unknown) => account }));
import { createMetaCreative, uploadVideoToMeta, waitForVideoReady } from "../../server/integrations/metaAdsVideo";
import { createTikTokAd, uploadVideoToTikTok } from "../../server/integrations/tiktokAds";
const meta = { videoId: "video", pageId: "page", ctaUrl: "https://example.com", ctaType: "SIGN_UP", primaryText: "Fixture", headline: "Fixture", trackingId: "fixture", expectedAdAccountId: "act_123" };
const tiktok = { videoId: "video", advertiserId: "123", identityId: "identity", identityType: "TT_USER" as const, adText: "Fixture", ctaButtonText: "SIGN_UP", landingPageUrl: "https://example.com", trackingId: "fixture", adGroupId: "group" };
beforeEach(() => {
  vi.resetAllMocks(); h.accounts = [{ id: 1, adAccountId: "123", accessToken: "fixture-only" }];
  vi.stubGlobal("fetch", h.fetch); h.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: "creative", code: 0, data: { ad_ids: ["ad" ] }, status: { video_status: "ready" } }) });
});
it("refuses TikTok account replacement between upload and creation", async () => {
  h.accounts[0].adAccountId = "456";
  await expect(createTikTokAd(tiktok)).rejects.toThrow(/account.*changed/i); expect(h.fetch).not.toHaveBeenCalled();
});
it("creates TikTok objects only on the uploaded advertiser identity", async () => {
  await createTikTokAd(tiktok);
  expect(JSON.parse(h.fetch.mock.calls[0][1].body).advertiser_id).toBe("123");
});
it("refuses Meta account replacement before creative creation", async () => {
  h.accounts[0].adAccountId = "456";
  await expect(createMetaCreative(meta)).rejects.toThrow(/account.*changed/i); expect(h.fetch).not.toHaveBeenCalled();
});
it("normalizes Meta's account prefix when checking the upload identity", async () => {
  await createMetaCreative(meta); expect(h.fetch.mock.calls[0][0]).toContain("/act_123/adcreatives");
});
it("refuses Meta account replacement before status polling", async () => {
  h.accounts[0].adAccountId = "456";
  await expect(waitForVideoReady("video", { expectedAdAccountId: "act_123" })).rejects.toThrow(/account.*changed/i);
  expect(h.fetch).not.toHaveBeenCalled();
});
it.each(["meta", "tiktok"] as const)("refuses ambiguous %s accounts before any upload", async platform => {
  h.accounts.push({ id: 2, adAccountId: "456", accessToken: "another-fixture" });
  const upload = platform === "meta" ? uploadVideoToMeta({ videoBytes: Buffer.from("fixture"), name: "Fixture", trackingId: "fixture" }) : uploadVideoToTikTok({ videoBytes: Buffer.from("fixture"), videoName: "Fixture", trackingId: "fixture" });
  await expect(upload).rejects.toThrow(/multiple|ambiguous/i); expect(h.fetch).not.toHaveBeenCalled();
});
it.each(["meta", "tiktok"] as const)("refuses ambiguous %s accounts before object creation", async platform => {
  h.accounts.push({ id: 2, adAccountId: "456", accessToken: "another-fixture" });
  await expect(platform === "meta" ? createMetaCreative(meta) : createTikTokAd(tiktok)).rejects.toThrow(/multiple|ambiguous/i);
  expect(h.fetch).not.toHaveBeenCalled();
});

afterEach(() => vi.unstubAllGlobals());

it("does not replace a provider failure with an invented successful object", async () => {
  h.fetch.mockResolvedValue({ ok: false, status: 503, text: async () => "fixture unavailable" });
  await expect(createTikTokAd(tiktok)).rejects.toThrow("503");
  await expect(createMetaCreative(meta)).rejects.toThrow("503");
});
it.each([undefined, "", "   ", 17])("refuses an ambiguous Meta 200 response with invalid ID %j", async id => {
  h.fetch.mockResolvedValue({ ok: true, json: async () => ({ id }) });
  await expect(createMetaCreative(meta)).rejects.toThrow(/receipt|identifier|id/i);
});

it.each([undefined, "", "   ", 17])("refuses an ambiguous TikTok 200 response with invalid ID %j", async id => {
  h.fetch.mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { ad_ids: [id] } }) });
  await expect(createTikTokAd(tiktok)).rejects.toThrow(/id/i);
});

it.each(["meta", "tiktok"] as const)("uploads the exact verified buffer through %s multipart", async platform => {
  const videoBytes = Buffer.from("verified-buffer-no-filesystem");
  h.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: "video", code: 0, data: [{ video_id: "video" }] }) });
  if (platform === "meta") await uploadVideoToMeta({ videoBytes, name: "Fixture", trackingId: "fixture" });
  else await uploadVideoToTikTok({ videoBytes, videoName: "Fixture", trackingId: "fixture" });
  const body = h.fetch.mock.calls[0][1].body.getBuffer() as Buffer;
  expect(body.includes(videoBytes)).toBe(true);
  expect(body.toString()).toContain('filename="fixture.mp4"');
});
