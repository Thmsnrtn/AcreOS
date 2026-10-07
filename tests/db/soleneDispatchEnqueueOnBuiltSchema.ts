/**
 * tests/db/soleneDispatchEnqueueOnBuiltSchema.ts — can a database built from
 * this repository accept a keyed (exactly-once) Solene enqueue?
 *
 * Run against a REAL database that `scripts/ci/build-schema-from-repo.sh` has
 * just built:
 *
 *     DATABASE_URL=postgres://… npx tsx tests/db/soleneDispatchEnqueueOnBuiltSchema.ts
 *
 * The only unique index on solene_dispatch_queue.idempotency_key is PARTIAL.
 * A bare `ON CONFLICT (idempotency_key)` cannot use it, so every keyed enqueue
 * threw on a migration-built database. This proves, through the real
 * `enqueueDispatch`: the same key enqueued twice yields one row and the same id,
 * neither call throws, and unkeyed enqueues still insert freely.
 *
 * Then the founder path end to end: approving an autopilot move ask writes
 * exactly one dispatch row, and a second approve does not add another.
 *
 * Deletes the rows it wrote. Exits non-zero on any failure and prints why.
 */
import { eq, like } from "drizzle-orm";
import { autopilotExperiences } from "@shared/schema";
import { soleneDispatchQueue } from "@shared/schema/solene-dispatch";
import { soleneFounderAsks } from "@shared/schema/solene-founder-collab";
import { db, pool } from "../../server/db";
import { enqueueDispatch } from "../../server/services/solene/dispatchQueue";
import { createHash } from "node:crypto";
import { answerFounderAsk } from "../../server/services/solene/founderCollab";

/** The per-ask idempotency key the approval enqueue uses (act.ts). */
const approvedAskIdempotencyKey = (askId: number) => `approved-ask:${askId}`;

const failures: string[] = [];
const why = (err: unknown) => {
  const e = err as { message?: string; cause?: { message?: string } };
  return e?.cause?.message ?? e?.message ?? String(err);
};
const check = (ok: boolean, what: string) => {
  console.log(`[dispatch-on-built-schema] ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[dispatch-on-built-schema] DATABASE_URL not set — this needs a real, built database.");
    process.exit(1);
  }
  const tag = `dispatch-built-schema-${process.pid}-${Date.now()}`;
  const base = {
    sourceType: "auto_dispatch" as const,
    sourceId: tag,
    agentRole: "iris" as const,
    promptText: "built-schema probe",
    priority: 0.1,
    founderOverride: true, // the probe must not depend on this month's envelope
  };
  const askIds: number[] = [];
  try {
    let a: number | undefined;
    let b: number | undefined;
    try {
      a = await enqueueDispatch({ ...base, idempotencyKey: `${tag}:k` });
      b = await enqueueDispatch({ ...base, idempotencyKey: `${tag}:k` });
    } catch (err) {
      check(false, `keyed enqueue threw: ${why(err)}`);
    }
    if (a !== undefined) {
      check(a === b, `the same key twice returns the same id (${a} / ${b})`);
      const rows = await db
        .select({ id: soleneDispatchQueue.id })
        .from(soleneDispatchQueue)
        .where(eq(soleneDispatchQueue.idempotencyKey, `${tag}:k`));
      check(rows.length === 1, `the same key twice writes one row (got ${rows.length})`);
    }
    try {
      const u1 = await enqueueDispatch(base);
      const u2 = await enqueueDispatch(base);
      check(u1 !== u2, "unkeyed enqueues are never deduped");
    } catch (err) {
      check(false, `unkeyed enqueue threw: ${why(err)}`);
    }
    // Approve → exactly one dispatch row (real answerFounderAsk, real enqueue).
    const [ask] = await db
      .insert(soleneFounderAsks)
      .values({
        askingAgentRole: "iris",
        questionSummary: `Approve a ops action: optimize ${tag}`,
        questionBody: tag,
        answerFormat: "yes_no",
        urgency: "normal",
        status: "open",
        timeoutAt: new Date(Date.now() + 3_600_000),
        // Bound to the exact proposal and card version (migration 0265).
        actsPayload: { moveKind: "optimize", domain: "ops", rationale: `Nothing urgent ${tag}` },
        actsKey: `k-${tag}`,
        bodyHash: createHash("sha256").update(tag, "utf8").digest("hex"),
      } as any)
      .returning({ id: soleneFounderAsks.id });
    askIds.push(ask.id);
    await db.insert(autopilotExperiences).values({ moveKind: "optimize", domain: "ops", outcome: "escalated", askId: ask.id } as any);
    const shownHash = createHash("sha256").update(tag, "utf8").digest("hex");
    const stale = await answerFounderAsk({ askId: ask.id, answerText: "yes", expectedBodyHash: "stale" }).then(() => false, () => true);
    check(stale, "approving a card version that is not the stored one is refused");
    try {
      await answerFounderAsk({ askId: ask.id, answerText: "yes", expectedBodyHash: shownHash });
    } catch (err) {
      check(false, `approve threw: ${why(err)}`);
    }
    await answerFounderAsk({ askId: ask.id, answerText: "yes", expectedBodyHash: shownHash }).catch(() => undefined); // refused: not open
    const key = approvedAskIdempotencyKey(ask.id);
    const approvedRows = await db
      .select({ id: soleneDispatchQueue.id, sourceId: soleneDispatchQueue.sourceId })
      .from(soleneDispatchQueue)
      .where(eq(soleneDispatchQueue.idempotencyKey, key));
    check(approvedRows.length === 1, `approving writes exactly one dispatch row (got ${approvedRows.length})`);
    const [exp] = await db
      .select({ dispatchId: autopilotExperiences.dispatchId })
      .from(autopilotExperiences)
      .where(eq(autopilotExperiences.askId, ask.id));
    check(exp?.dispatchId === approvedRows[0]?.id, "the experience row is linked to that dispatch");
  } finally {
    await db.delete(soleneDispatchQueue).where(like(soleneDispatchQueue.sourceId, `${tag}%`));
    for (const id of askIds) {
      const key = approvedAskIdempotencyKey(id);
      await db.delete(soleneDispatchQueue).where(eq(soleneDispatchQueue.idempotencyKey, key)).catch(() => undefined);
      await db.delete(autopilotExperiences).where(eq(autopilotExperiences.askId, id)).catch(() => undefined);
      await db.delete(soleneFounderAsks).where(eq(soleneFounderAsks.id, id)).catch(() => undefined);
    }
  }
}

main()
  .catch((err) => {
    check(false, `unexpected: ${why(err)}`);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
    if (failures.length > 0) {
      console.error(`[dispatch-on-built-schema] FAIL — ${failures.length} check(s) failed`);
      process.exit(1);
    }
    console.log("[dispatch-on-built-schema] PASS");
    process.exit(0);
  });
