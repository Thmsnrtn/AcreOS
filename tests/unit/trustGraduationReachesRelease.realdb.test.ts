import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";
import { trustGraduationReleaseDDL } from "../helpers/trustGraduationReleaseDDL";
useRealDb("trustGraduationReachesRelease.realdb.test.ts");

describe.runIf(realDbAvailable)("release-only trust stores on an empty isolated PostgreSQL schema", () => {
  it("boots twice and serves the actual observation/graduation ORM without applying base migrations", async () => {
    const { db } = await import("../../server/db");
    const { agentProposalObservations, agentActionGraduations } = await import("@shared/schema");
    const { and, eq, sql } = await import("drizzle-orm");
    const namespace = `release_proof_${randomUUID().replace(/-/g, "")}`;
    const rollback = new Error("fixture transaction rollback");
    await expect(db.transaction(async tx => {
      await tx.execute(sql.raw(`CREATE SCHEMA "${namespace}"`));
      await tx.execute(sql.raw(`SET LOCAL search_path TO "${namespace}"`));
      const ddl = trustGraduationReleaseDDL(); expect(ddl).toHaveLength(7);
      for (let n = 0; n < 2; n++) for (const statement of ddl) await tx.execute(sql.raw(statement));
      const at = new Date("2026-10-13T12:00:00Z");
      await tx.insert(agentProposalObservations).values({ agentCodename: "fixture", actionCategory: "code", shippedRef: "fixture-sha", shippedRefType: "git_sha", shippedAt: at, observationEndsAt: at });
      const observations = await tx.select().from(agentProposalObservations).where(eq(agentProposalObservations.status, "observing")).limit(200);
      expect(observations).toHaveLength(1); expect(observations[0].retractCommitSha).toBeNull();
      await tx.insert(agentActionGraduations).values({ agentCodename: "fixture", actionCategory: "code" });
      const [graduation] = await tx.select().from(agentActionGraduations).where(and(eq(agentActionGraduations.agentCodename, "fixture"), eq(agentActionGraduations.actionCategory, "code")));
      expect(graduation.graduationTier).toBe("manual");
      throw rollback; // schema and fixture writes never commit
    })).rejects.toBe(rollback);
  }, 60_000);
});
