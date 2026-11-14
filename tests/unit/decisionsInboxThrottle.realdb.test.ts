import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";
useRealDb("decisionsInboxThrottle.realdb.test.ts");

const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const producer = `test_throttle_${suffix}`;
const ownerCodename = `throttle-proof-${suffix}`;

describe.runIf(realDbAvailable)("decisions inbox throttle on PostgreSQL", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  afterAll(async () => {
    const { db } = await import("../../server/db");
    const { decisionsInboxItems, founderSettings } = await import("@shared/schema");
    const { eq, like } = await import("drizzle-orm");
    await db.delete(decisionsInboxItems).where(eq(decisionsInboxItems.ownerAgentCodename, ownerCodename));
    await db.delete(founderSettings).where(like(founderSettings.key, `%${producer}%`));
  });

  it("concurrent raiseIfAllowed for the same subject yields exactly one card (advisory-lock race)", async () => {
    const { raiseIfAllowed } = await import("../../server/services/decisionsInboxThrottle");
    let inserted = 0;
    const input = { producer: `${producer}_race`, subjectKey: "race-subject", conditionKey: "c1", class: "standard" as const };
    const outs = await Promise.all(
      Array.from({ length: 8 }, () =>
        raiseIfAllowed(input, async () => {
          await new Promise((r) => setTimeout(r, 25)); // widen the decide→record window
          inserted += 1;
        }),
      ),
    );
    expect(inserted).toBe(1);
    expect(outs.filter((o) => o.inserted)).toHaveLength(1);
    expect(outs.filter((o) => o.verdict.reason === "suppressed_same_condition")).toHaveLength(7);
  });

  it("state survives writes to decisions_inbox_items: closing the prior card does not reset it", async () => {
    const { db } = await import("../../server/db");
    const { decisionsInboxItems, founderSettings } = await import("@shared/schema");
    const { eq, like } = await import("drizzle-orm");
    const { raiseIfAllowed, hash16, SUBJECT_KEY_PREFIX } = await import("../../server/services/decisionsInboxThrottle");
    const producer2 = `${producer}_survive`; // own producer: the per-producer daily cap is 3
    const input = { producer: producer2, subjectKey: "survives-subject", conditionKey: "c1", class: "standard" as const };
    const card = () =>
      db.insert(decisionsInboxItems).values({
        itemType: "pillar_review",
        riskLevel: "low",
        urgencyScore: 35,
        sophieAnalysis: "throttle proof fixture",
        recommendedAction: "none",
        recommendedActionLabel: "none",
        status: "pending",
        ownerAgentCodename: ownerCodename,
      });

    const first = await raiseIfAllowed(input, card);
    expect(first.inserted).toBe(true);
    const key = `${SUBJECT_KEY_PREFIX}${producer2}.${hash16("survives-subject")}`;
    const [before] = await db.select().from(founderSettings).where(eq(founderSettings.key, key));
    expect(before).toBeDefined();

    // soft-purge equivalent + a resolution on the prior card
    for (const status of ["rejected", "approved"] as const) {
      await db.update(decisionsInboxItems).set({ status }).where(eq(decisionsInboxItems.ownerAgentCodename, ownerCodename));
      const again = await raiseIfAllowed(input, card);
      expect(again.inserted).toBe(false);
      expect(again.verdict.reason).toBe("suppressed_same_condition");
    }
    const rows = await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.ownerAgentCodename, ownerCodename));
    expect(rows).toHaveLength(1);
    const [after] = await db.select().from(founderSettings).where(eq(founderSettings.key, key));
    expect(after.value).toBe(before.value);
    expect(
      (await db.select().from(founderSettings).where(like(founderSettings.key, `${SUBJECT_KEY_PREFIX}${producer2}.%`))).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("writes through the direct upsert shape: a second raise updates the row, never duplicates (unique on key)", async () => {
    const { db } = await import("../../server/db");
    const { founderSettings } = await import("@shared/schema");
    const { eq, like } = await import("drizzle-orm");
    const { raiseIfAllowed, hash16, SUBJECT_KEY_PREFIX, DAY_KEY_PREFIX } = await import(
      "../../server/services/decisionsInboxThrottle"
    );
    const producer3 = `${producer}_upsert`;
    const subjectKey = "upsert-subject";
    const key = `${SUBJECT_KEY_PREFIX}${producer3}.${hash16(subjectKey)}`;
    const base = { producer: producer3, subjectKey, class: "standard" as const };

    await raiseIfAllowed({ ...base, conditionKey: "A" }, async () => undefined);
    const [r1] = await db.select().from(founderSettings).where(eq(founderSettings.key, key));
    expect(r1.valueType).toBe("json");
    expect(r1.category).toBe("general");
    expect(r1.updatedBy).toBe("decisions-inbox-throttle");
    expect(r1.description ?? "").toContain(producer3);
    expect(JSON.parse(r1.value as string)).toMatchObject({ n: 1 });

    const second = await raiseIfAllowed({ ...base, conditionKey: "B" }, async () => undefined);
    expect(second.verdict.reason).toBe("condition_changed");
    const sameKey = await db.select().from(founderSettings).where(eq(founderSettings.key, key));
    expect(sameKey).toHaveLength(1);
    expect(JSON.parse(sameKey[0].value as string)).toMatchObject({ n: 2 });

    const dayRows = await db.select().from(founderSettings).where(like(founderSettings.key, `${DAY_KEY_PREFIX}${producer3}.%`));
    expect(dayRows).toHaveLength(1); // one counter row per producer per UTC day (test does not span midnight)
    expect(JSON.parse(dayRows[0].value as string).raised).toBeGreaterThanOrEqual(2);
  });
});
