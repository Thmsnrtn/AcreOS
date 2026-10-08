/**
 * The keyed (exactly-once) Solene enqueue must emit an ON CONFLICT clause that
 * PostgreSQL can match to the index that actually exists.
 *
 * The only unique index on solene_dispatch_queue.idempotency_key is PARTIAL
 * (`WHERE idempotency_key IS NOT NULL` — shared/schema/solene-dispatch.ts and
 * scripts/migrate.mjs). PostgreSQL infers a partial index as the conflict
 * arbiter only when the conflict target repeats its predicate; a bare
 * `ON CONFLICT ("idempotency_key")` is rejected outright ("no unique or
 * exclusion constraint matching the ON CONFLICT specification"), so every keyed
 * enqueue threw on a migration-built database. The sibling dispatchQueue.test.ts
 * mocks `onConflictDoNothing(_t)` and ignores its argument, so it agreed with
 * the broken clause.
 *
 * This test renders the REAL SQL through drizzle's pg dialect (only the wire is
 * faked) and compares the emitted conflict clause with the predicate the schema
 * declares on the index — read from the table config, not restated here.
 * A real-database proof lives in tests/db/soleneDispatchEnqueueOnBuiltSchema.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const captured: string[] = [];

vi.mock("../../server/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const client = {
    query: async (q: { text: string } | string) => {
      captured.push(typeof q === "string" ? q : q.text);
      return { rows: [[7]], fields: [{ name: "id" }], rowCount: 1, command: "INSERT" };
    },
  };
  return { db: drizzle(client as never) };
});
vi.mock("../../server/services/solene/capitalTracker", () => ({
  assertWithinEnsembleCap: vi.fn(async () => undefined),
  getMonthlyEnvelopeStatus: vi.fn(async () => ({ status: "green" })),
}));
vi.mock("../../server/services/solene/tokenEconomyScorer", () => ({
  scoreDispatchProposal: vi.fn(),
  backfillScoreEventDispatchId: vi.fn(),
}));

import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { soleneDispatchQueue } from "@shared/schema/solene-dispatch";
import { enqueueDispatch } from "../../server/services/solene/dispatchQueue";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function indexPredicate(): string {
  const idx = getTableConfig(soleneDispatchQueue).indexes.find(
    (i) => i.config.name === "solene_dispatch_queue_idempotency_key_uq",
  );
  expect(idx, "the idempotency unique index is declared").toBeDefined();
  expect(idx!.config.unique).toBe(true);
  const where = idx!.config.where;
  expect(where, "the index is partial — that is why the target needs a predicate").toBeDefined();
  return norm(new PgDialect().sqlToQuery(where!).sql);
}

describe("keyed Solene enqueue — ON CONFLICT matches the partial unique index", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("repeats the index predicate in the conflict target", async () => {
    const id = await enqueueDispatch({
      sourceType: "auto_dispatch",
      sourceId: "autopilot:optimize",
      agentRole: "iris",
      promptText: "do the thing",
      priority: 0.5,
      idempotencyKey: "effect:abc",
    });
    expect(id).toBe(7);
    const insert = captured.map(norm).find((t) => t.startsWith('insert into "solene_dispatch_queue"'));
    expect(insert, "the enqueue issued an insert").toBeDefined();
    const pred = indexPredicate();
    expect(insert).toContain(`on conflict ("idempotency_key") where ${pred} do nothing`);
  });

  it("an unkeyed enqueue carries no conflict clause at all", async () => {
    await enqueueDispatch({
      sourceType: "auto_dispatch",
      sourceId: "autopilot:optimize",
      agentRole: "iris",
      promptText: "do the thing",
      priority: 0.5,
    });
    const insert = captured.map(norm).find((t) => t.startsWith('insert into "solene_dispatch_queue"'));
    expect(insert).toBeDefined();
    expect(insert).not.toContain("on conflict");
  });
});
