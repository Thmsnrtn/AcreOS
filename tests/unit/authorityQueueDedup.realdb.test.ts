import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";
useRealDb("authorityQueueDedup.realdb.test.ts");
vi.mock("../../server/services/temporaryDelegation", () => ({ checkTemporaryDelegation: async () => ({ hasDelegation: false }) }));
const codename = `authority-proof-${randomUUID()}`;
const action = "proactive:proof_jobs";

describe.runIf(realDbAvailable)("authority question concurrency and predicates on PostgreSQL", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
  beforeAll(async () => {
    const { db } = await import("../../server/db"); const { companyAgents } = await import("@shared/schema");
    await db.insert(companyAgents).values({ codename, title: "Fixture", wing: "ops", trustScore: 20,
      authorityConfig: { level0Actions: [], level1Actions: [], level2Actions: [], level3Actions: [] } });
  });
  afterAll(async () => {
    const { db } = await import("../../server/db"); const { companyAgents, agentActionLog, decisionsInboxItems } = await import("@shared/schema"); const { eq } = await import("drizzle-orm");
    await db.delete(decisionsInboxItems).where(eq(decisionsInboxItems.ownerAgentCodename, codename));
    await db.delete(agentActionLog).where(eq(agentActionLog.agentCodename, codename));
    await db.delete(companyAgents).where(eq(companyAgents.codename, codename));
  });
  it("eight concurrent observations with reordered nested facts create one question", async () => {
    const { executeWithAuthority } = await import("../../server/services/agentAuthorityGate"); const executor = vi.fn();
    const results = await Promise.all(Array.from({ length: 8 }, (_, n) => executeWithAuthority(codename, action, executor, {
      actionType: "proactive", input: n % 2 ? { failures: [{ count: 48, jobName: "retract" }], source: "worker" } : { source: "worker", failures: [{ jobName: "retract", count: 48 }] },
    })));
    expect(results.every(r => r.escalated && !r.success)).toBe(true); expect(executor).not.toHaveBeenCalled();
    const { db } = await import("../../server/db"); const { decisionsInboxItems, agentActionLog } = await import("@shared/schema"); const { eq } = await import("drizzle-orm");
    expect(await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.ownerAgentCodename, codename))).toHaveLength(1);
    expect(await db.select().from(agentActionLog).where(eq(agentActionLog.agentCodename, codename))).toHaveLength(8);
  });
  it("keeps deferred facts, preserves distinct facts, and allows a new question after rejection", async () => {
    const { db } = await import("../../server/db"); const { decisionsInboxItems } = await import("@shared/schema"); const { eq } = await import("drizzle-orm");
    const { executeWithAuthority } = await import("../../server/services/agentAuthorityGate");
    const input = { source: "worker", failures: [{ jobName: "retract", count: 48 }] };
    const ask = (facts: Record<string, unknown>) => executeWithAuthority(codename, action, vi.fn(), { actionType: "proactive", input: facts });
    await db.update(decisionsInboxItems).set({ status: "deferred" }).where(eq(decisionsInboxItems.ownerAgentCodename, codename));
    await ask(input);
    expect(await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.ownerAgentCodename, codename))).toHaveLength(1);
    await ask({ ...input, failures: [{ jobName: "retract", count: 49 }] });
    expect(await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.ownerAgentCodename, codename))).toHaveLength(2);
    await db.update(decisionsInboxItems).set({ status: "rejected" }).where(eq(decisionsInboxItems.ownerAgentCodename, codename));
    await ask(input);
    const rows = await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.ownerAgentCodename, codename));
    expect(rows).toHaveLength(3); expect(rows.filter(r => r.status === "rejected")).toHaveLength(2);
  });
});
