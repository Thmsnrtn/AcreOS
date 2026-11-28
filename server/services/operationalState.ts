/**
 * Operational state — the access layer for the `operational_state` table
 * (migration 0315, P12-1c slice 1c-1).
 *
 * This table holds machine-kept key-value state that is NOT founder
 * settings: the autopilot gate watcher's per-gate state, the decisions-
 * inbox throttle's subject/day counters, the LQ22 tripwire's latest
 * report, and the channel pause/throttle overrides. Unlike
 * `founder_settings` there is no seeding, no KNOBS validation, and no
 * per-write audit row — any (namespace, key) may be created by its first
 * upsert, and subsystems that need an audit trail (the inspector, the
 * Atlas tools) already write their own at the call site. Design record:
 * seat2-q8v5-p12-1c-design-2026-11.md §6.
 *
 * TWO WRITE SHAPES exist over the one table, deliberately:
 *  - `upsertOpState` is a RAW-SQL upsert executed via `handle.execute`.
 *    The decisions-inbox throttle requires exactly this shape (its D-5
 *    constraint): drizzle builder inserts would appear inside its
 *    producers' pinned insert sequences, and `.execute` exists on every
 *    handle shape — the shared `db`, a caller-supplied transaction, and
 *    test stub handles alike.
 *  - `upsertOpStateRow` is the drizzle-chain convenience shape
 *    (`.insert().values().onConflictDoUpdate().returning()`) mirroring
 *    what the non-transactional callers (gate watcher, LQ22, Atlas
 *    tools, inspector helper) write today, so their existing db mocks
 *    keep working when they switch.
 *
 * NO CACHE. Every consumer of this state reads the table directly and
 * uncached today (the founderSettings 30s cache never applied to the
 * direct-table subsystems); adding one would change throttle/gate dedup
 * freshness. Explicit non-goal.
 *
 * Slice 1c-1 is additive only: NOTHING in production reads or writes
 * this table yet. The consumers arrive in slices 1c-2…1c-5 (gate
 * watcher, throttle, LQ22, channel overrides).
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { operationalState } from "@shared/schema";
import { clock } from "../utils/clock";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The slice of a db/transaction handle this layer uses. */
type OpStateHandle = Pick<Tx, "select" | "execute" | "insert">;

/** The namespaces `operational_state` carries (design §6). */
export type OpStateNamespace =
  | "gate_watcher"
  | "inbox_throttle"
  | "lq22_tripwire"
  | "channel_overrides"
  | "dial"
  | "org_overrides";

export interface OpStateWrite {
  namespace: OpStateNamespace;
  /** Full legacy key, verbatim (e.g. `inbox_throttle.v1.<producer>.<hash>`). */
  key: string;
  value: string;
  valueType?: string;
  description?: string | null;
  updatedBy?: string | null;
}

/**
 * Raw-SQL upsert over any handle that can `.execute` — the throttle's
 * shape. Runs on `db`, on a caller-supplied tx, and on stub handles.
 */
export async function upsertOpState(handle: OpStateHandle, row: OpStateWrite): Promise<void> {
  await handle.execute(
    sql`INSERT INTO operational_state (namespace, key, value, value_type, description, updated_by) VALUES (${row.namespace}, ${row.key}, ${row.value}, ${row.valueType ?? "string"}, ${row.description ?? null}, ${row.updatedBy ?? null}) ON CONFLICT (namespace, key) DO UPDATE SET value = EXCLUDED.value, value_type = EXCLUDED.value_type, description = EXCLUDED.description, updated_at = ${clock.now()}, updated_by = EXCLUDED.updated_by`,
  );
}

/** Read one row by its full key; `null` when no row exists. */
export async function getOpState(handle: OpStateHandle, key: string) {
  const rows = await handle
    .select()
    .from(operationalState)
    .where(eq(operationalState.key, key))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Drizzle-chain upsert for the non-transactional callers; returns the
 * row as written.
 */
export async function upsertOpStateRow(handle: OpStateHandle, row: OpStateWrite) {
  const [saved] = await handle
    .insert(operationalState)
    .values({
      namespace: row.namespace,
      key: row.key,
      value: row.value,
      valueType: row.valueType ?? "string",
      description: row.description ?? null,
      updatedBy: row.updatedBy ?? null,
    })
    .onConflictDoUpdate({
      target: [operationalState.namespace, operationalState.key],
      set: {
        value: row.value,
        valueType: row.valueType ?? "string",
        description: row.description ?? null,
        updatedAt: clock.now(),
        updatedBy: row.updatedBy ?? null,
      },
    })
    .returning();
  return saved;
}
