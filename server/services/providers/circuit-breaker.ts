/**
 * Provider circuit breaker — persisted trip state + half-open probing.
 *
 * Tier 1G (elevation blueprint 2026-06-10). The previous breaker lived as a
 * bare Map inside ProviderRegistry with two defects:
 *
 *   1. Trips were in-memory only — every deploy (and every machine in the
 *      Fly process group) reset the failure budget, so a hard-down provider
 *      got re-hammered with 3 fresh failures per machine per deploy and the
 *      cooloff clock restarted from zero.
 *   2. No half-open state — after the cooloff the breaker snapped fully
 *      closed, so a still-down provider absorbed a full burst of live
 *      traffic before re-tripping.
 *
 * State machine (per provider):
 *
 *   closed ──(threshold failures within windowMs)──▶ open
 *   open ──(cooloffMs elapsed, FIRST caller only)──▶ half_open  (one probe)
 *   half_open ──probe success──▶ closed
 *   half_open ──probe failure──▶ open  (cooloff clock restarts)
 *
 * While half_open, every caller other than the probe claimant is denied —
 * exactly ONE request per process tests the provider per cooloff cycle.
 *
 * Persistence: a pluggable BreakerStore (DB-backed in production — see
 * circuit-breaker-store.ts) is hydrated lazily once per provider and written
 * fire-and-forget on every state TRANSITION (open / re-trip / half-open
 * claim / close). Per-failure counts below the threshold are not persisted —
 * the table records trips, not noise. Cross-machine note: each process runs
 * its own state machine over the shared persisted state; after a cooloff at
 * most one probe per machine may fire concurrently, which is an accepted
 * bound (N machines ≪ unthrottled traffic).
 *
 * Pure with respect to time (injectable `now`) and storage (injectable
 * store) so the state machine is unit-testable without pg.
 */

import { logger } from "../../utils/logger";

export type BreakerStateName = "closed" | "open" | "half_open";

export interface BreakerSnapshot {
  state: BreakerStateName;
  failures: number;
  openedAt: number | null; // epoch ms
  lastFailureAt: number | null; // epoch ms
}

export interface PersistedBreakerRow {
  state: BreakerStateName;
  failures: number;
  openedAt: Date | null;
  lastFailureAt: Date | null;
}

export interface BreakerStore {
  load(providerName: string): Promise<PersistedBreakerRow | null>;
  save(providerName: string, snapshot: BreakerSnapshot): Promise<void>;
}

export interface BreakerOptions {
  /** Failures within `windowMs` required to open. Default 3. */
  failureThreshold?: number;
  /** Rolling failure window. Default 5 minutes. */
  windowMs?: number;
  /** Time an open breaker waits before allowing the half-open probe. Default 5 minutes. */
  cooloffMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Optional persistence. Absent = in-memory only (tests / dev). */
  store?: BreakerStore;
}

interface InternalState extends BreakerSnapshot {
  hydrated: Promise<void> | true | null;
}

export class ProviderCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly cooloffMs: number;
  private readonly now: () => number;
  private readonly store: BreakerStore | null;
  private readonly states = new Map<string, InternalState>();

  constructor(opts: BreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.windowMs = opts.windowMs ?? 5 * 60 * 1000;
    this.cooloffMs = opts.cooloffMs ?? 5 * 60 * 1000;
    this.now = opts.now ?? Date.now;
    this.store = opts.store ?? null;
  }

  private blank(): InternalState {
    return { state: "closed", failures: 0, openedAt: null, lastFailureAt: null, hydrated: null };
  }

  private getState(name: string): InternalState {
    let s = this.states.get(name);
    if (!s) {
      s = this.blank();
      this.states.set(name, s);
    }
    return s;
  }

  /**
   * Lazy one-time hydration from the persisted store. Concurrent callers
   * share the same promise; failures degrade to the blank (closed) state.
   */
  private async ensureHydrated(name: string): Promise<void> {
    const s = this.getState(name);
    if (s.hydrated === true) return;
    if (!this.store) {
      s.hydrated = true;
      return;
    }
    if (!s.hydrated) {
      s.hydrated = this.store
        .load(name)
        .then((row) => {
          if (row) {
            s.state = row.state;
            s.failures = row.failures;
            s.openedAt = row.openedAt ? row.openedAt.getTime() : null;
            s.lastFailureAt = row.lastFailureAt ? row.lastFailureAt.getTime() : null;
          }
          s.hydrated = true;
        })
        .catch((err) => {
          logger.warn(`Circuit breaker hydration failed for ${name} — starting closed`, {
            source: "CircuitBreaker",
            metadata: { error: err instanceof Error ? err.message : String(err) },
          });
          s.hydrated = true;
        });
    }
    // At this point `hydrated` is the in-flight promise: the `=== true` fast
    // path returned above, and the block just filled the `null` case.
    // (`await true` would be a harmless no-op regardless.)
    await s.hydrated;
  }

  private persist(name: string, s: InternalState): void {
    if (!this.store) return;
    const snapshot: BreakerSnapshot = {
      state: s.state,
      failures: s.failures,
      openedAt: s.openedAt,
      lastFailureAt: s.lastFailureAt,
    };
    this.store.save(name, snapshot).catch((err) => {
      logger.warn(`Circuit breaker persist failed for ${name} (non-fatal)`, {
        source: "CircuitBreaker",
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    });
  }

  /**
   * Gate a request. Returns:
   *   { allowed: true,  probe: false } — breaker closed, proceed normally
   *   { allowed: true,  probe: true  } — breaker just went half-open and the
   *                                       CALLER is the single probe
   *   { allowed: false }               — breaker open (or a probe is already
   *                                       in flight); skip this provider
   */
  async shouldAllow(name: string): Promise<{ allowed: boolean; probe: boolean }> {
    await this.ensureHydrated(name);
    const s = this.getState(name);
    const now = this.now();

    if (s.state === "closed") return { allowed: true, probe: false };

    if (s.state === "open") {
      const openedAt = s.openedAt ?? s.lastFailureAt ?? now;
      if (now - openedAt >= this.cooloffMs) {
        // Cooloff elapsed — this caller claims the single half-open probe.
        s.state = "half_open";
        this.persist(name, s);
        logger.info(`Circuit breaker half-open for ${name} — sending probe`, {
          source: "CircuitBreaker",
        });
        return { allowed: true, probe: true };
      }
      return { allowed: false, probe: false };
    }

    // half_open with a probe already in flight — deny everyone else until
    // the probe resolves (recordSuccess / recordFailure).
    return { allowed: false, probe: false };
  }

  /** Probe success (or any live success) closes the breaker. */
  recordSuccess(name: string): void {
    const s = this.getState(name);
    const wasNotClosed = s.state !== "closed";
    s.state = "closed";
    s.failures = 0;
    s.openedAt = null;
    if (wasNotClosed) {
      this.persist(name, s);
      logger.info(`Circuit breaker closed for ${name} (probe succeeded)`, {
        source: "CircuitBreaker",
      });
    }
  }

  /** A failure. In half_open this re-trips immediately (probe failed). */
  recordFailure(name: string): void {
    const s = this.getState(name);
    const now = this.now();

    if (s.state === "half_open") {
      // Probe failed — re-trip; cooloff clock restarts from now.
      s.state = "open";
      s.openedAt = now;
      s.lastFailureAt = now;
      this.persist(name, s);
      logger.warn(`Circuit breaker re-tripped for ${name} (half-open probe failed)`, {
        source: "CircuitBreaker",
      });
      return;
    }

    // Rolling window: failures older than windowMs don't count toward the trip.
    if (s.lastFailureAt !== null && now - s.lastFailureAt > this.windowMs) {
      s.failures = 0;
    }
    s.failures += 1;
    s.lastFailureAt = now;

    if (s.state === "closed" && s.failures >= this.failureThreshold) {
      s.state = "open";
      s.openedAt = now;
      this.persist(name, s);
      logger.warn(`Circuit breaker opened for ${name} (${s.failures} failures)`, {
        source: "CircuitBreaker",
      });
    }
  }

  /** Read-only view for health surfaces and tests. */
  snapshot(name: string): BreakerSnapshot {
    const s = this.getState(name);
    return { state: s.state, failures: s.failures, openedAt: s.openedAt, lastFailureAt: s.lastFailureAt };
  }
}
