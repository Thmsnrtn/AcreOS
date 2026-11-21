/**
 * AUD-DEF-1 — audit_events hash chain against a REAL database.
 *
 * The v1 defect only manifests across a Postgres jsonb round-trip (jsonb
 * reorders nested keys), so a mock cannot prove the cure. This test
 * writes a chained row whose nested metadata keys are deliberately NOT
 * in jsonb order, reads the row back from the database, and proves the
 * stored row_hash recomputes from the round-tripped row — and that the
 * pure verifier accepts the freshly written segment when anchored on the
 * row's own prev_hash.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("auditEventsChain.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe.runIf(realDbAvailable)("audit_events chain — real database round-trip (AUD-DEF-1)", () => {
  afterAll(async () => {
    const { pool } = await import("../../server/db");
    await pool.end();
  });

  it("a freshly written row with multi-key nested metadata verifies after a DB round-trip", async () => {
    const { chainAndInsertAuditEvent, computeEventRowHash, verifyAuditEventRows } = await import(
      "../../server/utils/auditEventsChain"
    );
    const { db } = await import("../../server/db");
    const { auditEvents } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const created = await chainAndInsertAuditEvent({
      actorUserId: null,
      actorEmail: null,
      action: "aud_def_1.roundtrip_probe",
      targetType: "user",
      targetId: "aud-def-1-probe",
      justification: null,
      // Writer order is neither alphabetical nor jsonb (length-then-
      // bytewise) order, at two depths — exactly the v1 failure shape.
      metadata: {
        reviewedCount: 3,
        staleCount: 1,
        thresholdDays: 90,
        sentTo: ["probe@example.com"],
        nested: { zebra: 1, apple: { y: 2, b: 3 } },
      },
      ip: null,
      userAgent: "vitest-realdb",
    });
    expect(created.rowHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.prevHash).toBeTruthy();

    const [readBack] = await db.select().from(auditEvents).where(eq(auditEvents.id, created.id));
    expect(readBack).toBeTruthy();

    // The round-tripped row (metadata in whatever order jsonb returned)
    // recomputes to the stored hash under canonicalization v2.
    const recomputed = computeEventRowHash(readBack!.prevHash ?? "GENESIS", {
      id: readBack!.id,
      actorUserId: readBack!.actorUserId,
      actorEmail: readBack!.actorEmail,
      action: readBack!.action,
      targetType: readBack!.targetType,
      targetId: readBack!.targetId,
      justification: readBack!.justification,
      metadata: readBack!.metadata,
      ip: readBack!.ip,
      userAgent: readBack!.userAgent,
      createdAt: readBack!.createdAt,
    });
    expect(recomputed).toBe(readBack!.rowHash);

    // And the verifier logic accepts this segment anchored on its prev.
    const result = verifyAuditEventRows(
      [
        {
          id: readBack!.id,
          actorUserId: readBack!.actorUserId,
          actorEmail: readBack!.actorEmail,
          action: readBack!.action,
          targetType: readBack!.targetType,
          targetId: readBack!.targetId,
          justification: readBack!.justification,
          metadata: readBack!.metadata,
          ip: readBack!.ip,
          userAgent: readBack!.userAgent,
          createdAt: readBack!.createdAt,
          seq: readBack!.seq ?? null,
          prevHash: readBack!.prevHash ?? null,
          rowHash: readBack!.rowHash ?? null,
        },
      ],
      { startingPrevHash: readBack!.prevHash ?? undefined },
    );
    expect(result.ok).toBe(true);
  });
});
