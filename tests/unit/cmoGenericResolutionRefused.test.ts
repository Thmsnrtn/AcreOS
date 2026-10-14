import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), execute: vi.fn() }));
vi.mock("../../server/db", () => ({ db: { query: { decisionsInboxItems: { findFirst: h.find } }, update: h.update } }));
vi.mock("../../server/services/agentActionExecutors", () => ({ executeAction: h.execute, hasExecutor: vi.fn() }));
vi.mock("../../server/services/customerSupportAutoResolver", () => ({ customerSupportAutoResolver: { attemptResolution: vi.fn() } }));
vi.mock("../../server/services/founderInterruptArbiter", () => ({ arbitrateFounderInterrupt: vi.fn() }));
vi.mock("../../server/utils/openaiClient", () => ({ requireOpenAIClient: vi.fn() }));
import { decisionsInboxService } from "../../server/services/decisionsInbox";

beforeEach(() => { vi.resetAllMocks(); h.find.mockResolvedValue({ id: 1, itemType: "cmo_ad_review", status: "pending" }); });
describe("all generic service callers hand video bundles to their review writer", () => {
  const calls = [
    () => decisionsInboxService.approve(1),
    () => decisionsInboxService.reject(1, "quality"),
    () => decisionsInboxService.defer(1),
    () => decisionsInboxService.override(1, "publish"),
  ];
  it.each(calls)("refuses before any queue write or executor call", async call => {
    await expect(call()).rejects.toMatchObject({ code: "CMO_REVIEW_REQUIRED" });
    expect(h.update).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
  });
  it("does not guess that an unread card is generic", async () => {
    h.find.mockRejectedValue(new Error("read unavailable"));
    await expect(decisionsInboxService.approve(1)).rejects.toThrow("read unavailable");
    expect(h.update).not.toHaveBeenCalled();
  });
});
