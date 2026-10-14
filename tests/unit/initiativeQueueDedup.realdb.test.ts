import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";
useRealDb("initiativeQueueDedup.realdb.test.ts");
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastFounderEvent: vi.fn() } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const ids: number[] = [];
const proposal = (leadId: number) => ({
  agentCodename: "sophie", type: "opportunity" as const, title: "Review stale lead", description: "No recent contact is recorded.",
  action: "send_follow_up", actionInput: { leadId, channel: "email" }, confidence: 0.85,
  reasoning: "Contact suitability needs review.", estimatedImpact: "Unknown until reviewed",
});
describe.runIf(realDbAvailable)("initiative pending-card uniqueness on real PostgreSQL", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
  beforeAll(async () => {
    const { db } = await import("../../server/db"); const { organizations } = await import("@shared/schema");
    for (let n = 0; n < 2; n++) {
      const tag = `initiative-proof-${randomUUID()}`;
      const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: tag }).returning({ id: organizations.id });
      ids.push(org.id);
    }
  });
  afterAll(async () => {
    if (!ids.length) return;
    const { db } = await import("../../server/db"); const { organizations, decisionsInboxItems, agentEvents } = await import("@shared/schema");
    const { inArray } = await import("drizzle-orm");
    await db.delete(decisionsInboxItems).where(inArray(decisionsInboxItems.organizationId, ids));
    await db.delete(agentEvents).where(inArray(agentEvents.organizationId, ids));
    await db.delete(organizations).where(inArray(organizations.id, ids));
  });
  it("eight competing scanner calls create one active card and one event", async () => {
    const { agentInitiativeEngine } = await import("../../server/services/agentInitiativeEngine");
    const results = await Promise.all(Array.from({ length: 8 }, () => agentInitiativeEngine.enqueueProposal(ids[0], proposal(101), 20)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const { db } = await import("../../server/db"); const { decisionsInboxItems, agentEvents } = await import("@shared/schema"); const { eq } = await import("drizzle-orm");
    expect(await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.organizationId, ids[0]))).toHaveLength(1);
    expect(await db.select().from(agentEvents).where(eq(agentEvents.organizationId, ids[0]))).toHaveLength(1);
  });
  it("a deferred legacy-format card remains one question and another org is independent", async () => {
    const { db } = await import("../../server/db"); const { decisionsInboxItems } = await import("@shared/schema"); const { eq } = await import("drizzle-orm");
    await db.update(decisionsInboxItems).set({ status: "deferred" }).where(eq(decisionsInboxItems.organizationId, ids[0]));
    const { agentInitiativeEngine } = await import("../../server/services/agentInitiativeEngine");
    expect(await agentInitiativeEngine.enqueueProposal(ids[0], proposal(101), 20)).toBe(false);
    expect(await agentInitiativeEngine.enqueueProposal(ids[1], proposal(101), 20)).toBe(true);
    expect(await agentInitiativeEngine.enqueueProposal(ids[0], proposal(102), 20)).toBe(true);
  });
});
