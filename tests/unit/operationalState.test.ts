/**
 * P12-1c slice 1c-1 — the `operational_state` access layer
 * (server/services/operationalState.ts), tested over stub handles.
 *
 * Slice 1c-1 is additive: no production module consumes this layer yet
 * (consumers land in slices 1c-2…1c-5). These tests pin the three
 * shapes the later slices depend on:
 *  (a) the raw-SQL upsert the decisions-inbox throttle's D-5 constraint
 *      requires — one `.execute` whose rendered SQL is the
 *      operational_state INSERT with ON CONFLICT (namespace, key);
 *  (b) the by-key read — row on a hit, null on a miss;
 *  (c) the drizzle-chain upsert — values() carries namespace/key/value
 *      and the conflict target is [namespace, key].
 */
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  upsertOpState,
  getOpState,
  upsertOpStateRow,
  type OpStateWrite,
} from "../../server/services/operationalState";
import { operationalState } from "@shared/schema";

type UpsertHandle = Parameters<typeof upsertOpState>[0];
type GetHandle = Parameters<typeof getOpState>[0];
type RowHandle = Parameters<typeof upsertOpStateRow>[0];

const WRITE: OpStateWrite = {
  namespace: "inbox_throttle",
  key: "inbox_throttle.v1.schema_drift.ab12cd34ef56ab12",
  value: '{"c":"ab12cd34ef56ab12","at":"2026-11-26T00:00:00.000Z","n":1}',
  valueType: "json",
  description: "Inbox throttle state — schema_drift: test",
  updatedBy: "decisions-inbox-throttle",
};

describe("operationalState — upsertOpState (raw-SQL shape)", () => {
  it("issues exactly one execute: the operational_state INSERT … ON CONFLICT (namespace, key) DO UPDATE", async () => {
    const executed: unknown[] = [];
    const handle = {
      execute: async (q: unknown) => {
        executed.push(q);
        return [];
      },
    } as unknown as UpsertHandle;

    await upsertOpState(handle, WRITE);

    expect(executed).toHaveLength(1);
    const q = new PgDialect().sqlToQuery(executed[0] as SQL);
    expect(q.sql).toContain("INSERT INTO operational_state");
    expect(q.sql).toContain("ON CONFLICT (namespace, key) DO UPDATE");
    expect(q.params).toContain(WRITE.namespace);
    expect(q.params).toContain(WRITE.key);
    expect(q.params).toContain(WRITE.value);
  });
});

describe("operationalState — getOpState", () => {
  function selectHandle(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = async () => rows;
    return { select: () => chain } as unknown as GetHandle;
  }

  it("returns the row on a hit", async () => {
    const row = { id: 1, namespace: "gate_watcher", key: "gate_watcher.state.g1", value: "{}" };
    await expect(getOpState(selectHandle([row]), row.key)).resolves.toBe(row);
  });

  it("returns null on a miss", async () => {
    await expect(getOpState(selectHandle([]), "gate_watcher.state.absent")).resolves.toBeNull();
  });
});

describe("operationalState — upsertOpStateRow (drizzle-chain shape)", () => {
  it("passes namespace/key/value through values() and targets [namespace, key] on conflict", async () => {
    const seen: { values?: Record<string, unknown>; conflict?: { target?: unknown } } = {};
    const saved = { id: 7, ...WRITE };
    const chain: Record<string, unknown> = {};
    chain.onConflictDoUpdate = (cfg: { target?: unknown }) => {
      seen.conflict = cfg;
      return { returning: async () => [saved] };
    };
    const handle = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          seen.values = v;
          return chain;
        },
      }),
    } as unknown as RowHandle;

    await expect(upsertOpStateRow(handle, WRITE)).resolves.toBe(saved);
    expect(seen.values).toMatchObject({
      namespace: WRITE.namespace,
      key: WRITE.key,
      value: WRITE.value,
    });
    expect(seen.conflict?.target).toEqual([operationalState.namespace, operationalState.key]);
  });
});
