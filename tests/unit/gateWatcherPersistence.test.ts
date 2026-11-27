/**
 * P12-1c slice 1c-2 — the gate watcher's FIRST store-level persistence test.
 *
 * tests/unit/gateWatcher.test.ts pins the pure functions only; nothing
 * pinned loadGateStates/saveGateState before this file. Slice 1c-2
 * retargets both from founder_settings to the operational_state table
 * (namespace 'gate_watcher') via server/services/operationalState.ts.
 * This suite pins, over an in-memory fake db:
 *  (a) saveGateState upserts namespace 'gate_watcher' + the verbatim key
 *      (gate_watcher.state.<gateId>) + the exact JSON value bytes +
 *      valueType 'json' + updatedBy 'gate-watcher', on the
 *      [namespace, key] conflict target — and a second save replaces;
 *  (b) loadGateStates issues ONE batched select filtered to namespace
 *      'gate_watcher' with an inArray over the verbatim keys, returns the
 *      parsed states for stored rows, and treats an unparseable row (or
 *      a row whose status is not a GateState status) as no state;
 *  (c) a save → load round trip returns the state byte-for-byte.
 *
 * loadGateStates/saveGateState are exported from gateWatcher.ts as a
 * TEST SEAM for this file (see scripts/ratchets/reachability.json).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// In-memory fake db: insert().values().onConflictDoUpdate().returning()
// applies upsert semantics to a Map keyed by (namespace, key);
// select().from().where() returns the stored rows (the where clause is
// captured so the test can pin its rendered shape separately).
const h = vi.hoisted(() => {
  interface Row {
    namespace: string;
    key: string;
    value: string;
    valueType?: string;
    description?: string | null;
    updatedBy?: string | null;
  }
  const store = new Map<string, Row>();
  const inserts: Array<{
    values: Row;
    target?: unknown;
    set?: Record<string, unknown>;
  }> = [];
  const selects: Array<{ where?: unknown }> = [];
  const storeKey = (ns: string, key: string) => `${ns}::${key}`;

  const db = {
    insert: (_table: unknown) => ({
      values: (v: Row) => {
        const rec: (typeof inserts)[number] = { values: { ...v } };
        inserts.push(rec);
        return {
          onConflictDoUpdate: (cfg: { target?: unknown; set: Record<string, unknown> }) => {
            rec.target = cfg.target;
            rec.set = cfg.set;
            return {
              returning: async () => {
                const row: Row = {
                  ...v,
                  value: (cfg.set.value as string) ?? v.value,
                  valueType: (cfg.set.valueType as string) ?? v.valueType,
                  description: (cfg.set.description as string | null) ?? v.description,
                  updatedBy: (cfg.set.updatedBy as string | null) ?? v.updatedBy,
                };
                store.set(storeKey(v.namespace, v.key), row);
                return [row];
              },
            };
          },
        };
      },
    }),
    select: (_fields: unknown) => {
      const rec: (typeof selects)[number] = {};
      selects.push(rec);
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = (w: unknown) => {
        rec.where = w;
        return Promise.resolve(
          [...store.values()].map((r) => ({ key: r.key, value: r.value })),
        );
      };
      return chain;
    },
  };
  return { store, inserts, selects, db, storeKey };
});

vi.mock("../../server/db", () => ({ db: h.db }));

import {
  GATES,
  GATE_STATE_KEY_PREFIX,
  loadGateStates,
  saveGateState,
  type GateState,
} from "../../server/services/autopilot/gateWatcher";
import { operationalState } from "@shared/schema";

const gate = GATES[0]!;
const KEY = `${GATE_STATE_KEY_PREFIX}${gate.id}`;
const STATE: GateState = {
  status: "ask_raised",
  askId: 4242,
  at: "2026-11-26T14:00:00.000Z",
  detail: "studio dial says ask",
};

beforeEach(() => {
  h.store.clear();
  h.inserts.length = 0;
  h.selects.length = 0;
});

describe("gateWatcher persistence — saveGateState (operational_state upsert)", () => {
  it("upserts namespace 'gate_watcher', the verbatim key, the exact JSON bytes, and updatedBy 'gate-watcher'", async () => {
    await saveGateState(gate, STATE);

    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]!.values).toMatchObject({
      namespace: "gate_watcher",
      key: KEY,
      value: JSON.stringify(STATE),
      valueType: "json",
      description: `Gate-watcher state for '${gate.id}' (${gate.description})`,
      updatedBy: "gate-watcher",
    });
    expect(h.inserts[0]!.target).toEqual([
      operationalState.namespace,
      operationalState.key,
    ]);
    const stored = h.store.get(h.storeKey("gate_watcher", KEY));
    expect(stored?.value).toBe(JSON.stringify(STATE));
    expect(stored?.updatedBy).toBe("gate-watcher");
  });

  it("a second save for the same gate replaces the row (one row per gate, ever)", async () => {
    await saveGateState(gate, STATE);
    const next: GateState = { ...STATE, status: "auto_executed", askId: null };
    await saveGateState(gate, next);

    expect(h.store.size).toBe(1);
    expect(h.store.get(h.storeKey("gate_watcher", KEY))?.value).toBe(
      JSON.stringify(next),
    );
  });
});

describe("gateWatcher persistence — loadGateStates (batched operational_state read)", () => {
  it("issues one select filtered to namespace 'gate_watcher' with the verbatim keys in an inArray", async () => {
    await loadGateStates([gate.id, "some-other-gate"]);

    expect(h.selects).toHaveLength(1);
    const q = new PgDialect().sqlToQuery(h.selects[0]!.where as SQL);
    expect(q.sql).toContain('"namespace" = $1');
    expect(q.sql).toContain('"key" in (');
    expect(q.params).toContain("gate_watcher");
    expect(q.params).toContain(KEY);
    expect(q.params).toContain(`${GATE_STATE_KEY_PREFIX}some-other-gate`);
  });

  it("returns parsed states for stored rows; an unparseable row is no state", async () => {
    h.store.set(h.storeKey("gate_watcher", KEY), {
      namespace: "gate_watcher",
      key: KEY,
      value: JSON.stringify(STATE),
    });
    const badKey = `${GATE_STATE_KEY_PREFIX}broken-gate`;
    h.store.set(h.storeKey("gate_watcher", badKey), {
      namespace: "gate_watcher",
      key: badKey,
      value: "{not json",
    });
    const oddKey = `${GATE_STATE_KEY_PREFIX}odd-gate`;
    h.store.set(h.storeKey("gate_watcher", oddKey), {
      namespace: "gate_watcher",
      key: oddKey,
      value: JSON.stringify({ status: "something_else", at: STATE.at }),
    });

    const states = await loadGateStates([gate.id, "broken-gate", "odd-gate"]);

    expect(states.get(gate.id)).toEqual(STATE);
    expect(states.has("broken-gate")).toBe(false);
    expect(states.has("odd-gate")).toBe(false);
    expect(states.size).toBe(1);
  });
});

describe("gateWatcher persistence — save → load round trip", () => {
  it("a saved state loads back byte-for-byte", async () => {
    await saveGateState(gate, STATE);
    const states = await loadGateStates([gate.id]);
    expect(states.get(gate.id)).toEqual(STATE);
    expect(JSON.stringify(states.get(gate.id))).toBe(JSON.stringify(STATE));
  });
});
