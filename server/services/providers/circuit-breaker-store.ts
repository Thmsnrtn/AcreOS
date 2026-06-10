/**
 * DB-backed BreakerStore — persists provider circuit-breaker trip state to
 * the circuit_breaker_state table (migration 0154) so trips and cooloff
 * clocks survive deploys and are visible across the Fly process group.
 *
 * All writes are fire-and-forget from the breaker's perspective; a failed
 * persistence write must never block or fail a provider lookup.
 */

import { eq } from "drizzle-orm";
import { db } from "../../db";
import { circuitBreakerState } from "@shared/schema";
import type { BreakerStore, BreakerSnapshot, PersistedBreakerRow, BreakerStateName } from "./circuit-breaker";

export const dbBreakerStore: BreakerStore = {
  async load(providerName: string): Promise<PersistedBreakerRow | null> {
    const [row] = await db
      .select()
      .from(circuitBreakerState)
      .where(eq(circuitBreakerState.providerName, providerName))
      .limit(1);
    if (!row) return null;
    return {
      state: (row.state as BreakerStateName) ?? "closed",
      failures: row.failures ?? 0,
      openedAt: row.openedAt,
      lastFailureAt: row.lastFailureAt,
    };
  },

  async save(providerName: string, snapshot: BreakerSnapshot): Promise<void> {
    const values = {
      providerName,
      state: snapshot.state,
      failures: snapshot.failures,
      openedAt: snapshot.openedAt != null ? new Date(snapshot.openedAt) : null,
      lastFailureAt: snapshot.lastFailureAt != null ? new Date(snapshot.lastFailureAt) : null,
      halfOpenProbeAt: snapshot.state === "half_open" ? new Date() : null,
      updatedAt: new Date(),
    };
    await db
      .insert(circuitBreakerState)
      .values(values)
      .onConflictDoUpdate({
        target: circuitBreakerState.providerName,
        set: {
          state: values.state,
          failures: values.failures,
          openedAt: values.openedAt,
          lastFailureAt: values.lastFailureAt,
          halfOpenProbeAt: values.halfOpenProbeAt,
          updatedAt: values.updatedAt,
        },
      });
  },
};
