import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), execute: vi.fn() }));
vi.mock("../../server/db", () => ({ db: { query: { decisionsInboxItems: { findFirst: h.find } }, update: h.update } }));
vi.mock("../../server/services/agentActionExecutors", () => ({ executeAction: h.execute, hasExecutor: vi.fn() }));
vi.mock("../../server/services/customerSupportAutoResolver", () => ({ customerSupportAutoResolver: { attemptResolution: vi.fn() } }));
vi.mock("../../server/services/founderInterruptArbiter", () => ({ arbitrateFounderInterrupt: vi.fn() }));
vi.mock("../../server/utils/openaiClient", () => ({ requireOpenAIClient: vi.fn() }));
import { PgDialect } from "drizzle-orm/pg-core";
import { decisionsInboxService } from "../../server/services/decisionsInbox";

const predicates: string[] = [];
beforeEach(() => {
  vi.resetAllMocks(); predicates.length = 0;
  h.find.mockResolvedValue({ id: 1, itemType: "cmo_ad_review", status: "pending" });
  h.update.mockReturnValue({ set: () => ({ where: (predicate: any) => {
    predicates.push(new PgDialect().sqlToQuery(predicate).sql);
    return { returning: async () => [] };
  } }) });
});
describe("all generic service callers hand video bundles to their review writer", () => {
  const calls = [
    () => decisionsInboxService.approve(1),
    () => decisionsInboxService.reject(1, "quality"),
    () => decisionsInboxService.defer(1),
    () => decisionsInboxService.override(1, "publish"),
  ];
  it.each(calls)("refuses video resolution and never executes its action", async call => {
    await expect(call()).rejects.toMatchObject({ code: "CMO_REVIEW_REQUIRED" });
    for (const predicate of predicates) expect(predicate).toContain('"item_type" <>');
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("does not execute an ordinary action when its guarded write loses the row", async () => {
    h.find.mockResolvedValue({ id: 1, itemType: "critical_alert", actionPayload: { action: "acknowledge" } });
    await expect(decisionsInboxService.approve(1)).rejects.toMatchObject({ code: "CMO_REVIEW_REQUIRED" });
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("continues resolving an ordinary card when the guarded write returns its ID", async () => {
    h.find.mockResolvedValue({ id: 1, itemType: "critical_alert", actionPayload: null });
    h.update.mockReturnValue({ set: () => ({ where: () => ({ returning: async () => [{ id: 1 }] }) }) });
    await expect(decisionsInboxService.approve(1)).resolves.toMatchObject({ executed: false });
    await expect(decisionsInboxService.reject(1)).resolves.toBeUndefined();
    await expect(decisionsInboxService.defer(1)).resolves.toBeUndefined();
    await expect(decisionsInboxService.override(1, "fixture")).resolves.toBeUndefined();
  });
  it("does not guess that an unread card is generic", async () => {
    h.find.mockRejectedValue(new Error("read unavailable"));
    await expect(decisionsInboxService.approve(1)).rejects.toThrow("read unavailable");
    expect(h.update).not.toHaveBeenCalled();
  });
});
