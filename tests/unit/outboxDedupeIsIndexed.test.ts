/**
 * DEFECT-0146 — the durable-emit dedupe lookup is indexed.
 *
 * stageWorkflowEvent looks for an earlier row with the same
 * payload->>'dedupeKey' before it stages. With only event_type indexed, that
 * scanned the outbox once per emit — per ROW of a worker import once imports
 * staged lead/property/deal events durably (DEFECT-0130). The expression
 * index must match the query's expression exactly, or Postgres cannot use it;
 * both sides are pinned here, and the release migrator must carry it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const read = (p: string) => stripComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

describe("DEFECT-0146 — outbox dedupe key index", () => {
  it("the query filters on payload->>'dedupeKey'", () => {
    expect(read("server/services/workflowOutbox.ts")).toMatch(/\$\{outbox\.payload\}->>'dedupeKey' = /);
  });

  it("the release migrator creates the matching expression index", () => {
    expect(read("scripts/migrate.mjs")).toMatch(/CREATE INDEX IF NOT EXISTS "outbox_dedupe_key_idx" ON "outbox" \(\(payload->>'dedupeKey'\)\)/);
  });

  it("the schema declares it, so the ORM and the database agree", () => {
    expect(read("shared/schema/accounting-ops.ts")).toMatch(/index\("outbox_dedupe_key_idx"\)\.on\(sql`\(\$\{table\.payload\}->>'dedupeKey'\)`\)/);
  });
});
