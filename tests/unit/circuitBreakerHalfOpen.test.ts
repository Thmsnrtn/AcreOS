/**
 * Provider circuit breaker — half-open probe state machine (Tier 1G).
 *
 * Pins the full transition contract of ProviderCircuitBreaker with an
 * injectable fake clock and a fake BreakerStore:
 *
 *   closed ──(3 failures in 5-min window)──▶ open
 *   open ──(cooloff elapsed, FIRST caller only)──▶ half_open (single probe)
 *   half_open ──probe success──▶ closed
 *   half_open ──probe failure──▶ open (cooloff restarts)
 *
 * Plus: rolling-window failure reset, transition-only persistence, and
 * hydration of a persisted open state from the store.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProviderCircuitBreaker,
  type BreakerSnapshot,
  type BreakerStore,
  type PersistedBreakerRow,
} from "../../server/services/providers/circuit-breaker";

const WINDOW_MS = 5 * 60 * 1000;
const COOLOFF_MS = 5 * 60 * 1000;

function makeFakeStore(rows: Record<string, PersistedBreakerRow> = {}) {
  const saves: Array<{ name: string; snapshot: BreakerSnapshot }> = [];
  const store: BreakerStore = {
    load: vi.fn(async (name: string) => rows[name] ?? null),
    save: vi.fn(async (name: string, snapshot: BreakerSnapshot) => {
      saves.push({ name, snapshot });
    }),
  };
  return { store, saves };
}

describe("ProviderCircuitBreaker — half-open probe state machine", () => {
  let t: number;
  const now = () => t;
  let breaker: ProviderCircuitBreaker;

  beforeEach(() => {
    t = 1_000_000;
    breaker = new ProviderCircuitBreaker({
      failureThreshold: 3,
      windowMs: WINDOW_MS,
      cooloffMs: COOLOFF_MS,
      now,
    });
  });

  it("stays closed (allowed) through 2 failures", async () => {
    breaker.recordFailure("regrid");
    breaker.recordFailure("regrid");
    expect(await breaker.shouldAllow("regrid")).toEqual({ allowed: true, probe: false });
    expect(breaker.snapshot("regrid").state).toBe("closed");
  });

  it("opens on the 3rd failure within the window and denies requests", async () => {
    breaker.recordFailure("regrid");
    t += 60_000;
    breaker.recordFailure("regrid");
    t += 60_000;
    breaker.recordFailure("regrid");
    expect(breaker.snapshot("regrid").state).toBe("open");
    expect(await breaker.shouldAllow("regrid")).toEqual({ allowed: false, probe: false });
  });

  it("denies until the cooloff elapses", async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure("regrid");
    t += COOLOFF_MS - 1;
    expect((await breaker.shouldAllow("regrid")).allowed).toBe(false);
  });

  it("after cooloff, exactly one caller gets the probe; the next is denied", async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure("regrid");
    t += COOLOFF_MS;
    expect(await breaker.shouldAllow("regrid")).toEqual({ allowed: true, probe: true });
    expect(breaker.snapshot("regrid").state).toBe("half_open");
    // Second caller while the probe is in flight: denied.
    expect(await breaker.shouldAllow("regrid")).toEqual({ allowed: false, probe: false });
  });

  it("probe failure re-trips and restarts the cooloff clock", async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure("regrid");
    t += COOLOFF_MS;
    expect((await breaker.shouldAllow("regrid")).probe).toBe(true);

    breaker.recordFailure("regrid"); // probe failed
    expect(breaker.snapshot("regrid").state).toBe("open");
    expect(breaker.snapshot("regrid").openedAt).toBe(t); // clock restarted

    // Still denied just before the NEW cooloff expires…
    t += COOLOFF_MS - 1;
    expect((await breaker.shouldAllow("regrid")).allowed).toBe(false);
    // …and a fresh probe is granted after it.
    t += 1;
    expect(await breaker.shouldAllow("regrid")).toEqual({ allowed: true, probe: true });
  });

  it("probe success closes the breaker and resets the failure count", async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure("regrid");
    t += COOLOFF_MS;
    expect((await breaker.shouldAllow("regrid")).probe).toBe(true);

    breaker.recordSuccess("regrid"); // probe succeeded
    const snap = breaker.snapshot("regrid");
    expect(snap.state).toBe("closed");
    expect(snap.failures).toBe(0);
    expect(snap.openedAt).toBeNull();
    expect(await breaker.shouldAllow("regrid")).toEqual({ allowed: true, probe: false });
  });

  it("rolling window: failures spaced wider than windowMs never trip", async () => {
    breaker.recordFailure("regrid");
    t += WINDOW_MS + 1;
    breaker.recordFailure("regrid");
    t += WINDOW_MS + 1;
    breaker.recordFailure("regrid");
    expect(breaker.snapshot("regrid").state).toBe("closed");
    // The stale count was reset, so only the latest failure is on the books.
    expect(breaker.snapshot("regrid").failures).toBe(1);
    expect((await breaker.shouldAllow("regrid")).allowed).toBe(true);
  });

  it("breakers are independent per provider", async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure("regrid");
    expect((await breaker.shouldAllow("regrid")).allowed).toBe(false);
    expect((await breaker.shouldAllow("reportallusa")).allowed).toBe(true);
  });

  describe("persistence (transition-only writes + hydration)", () => {
    it("saves on open, half-open claim, and close — not on sub-threshold failures", async () => {
      const { store, saves } = makeFakeStore();
      const b = new ProviderCircuitBreaker({
        failureThreshold: 3,
        windowMs: WINDOW_MS,
        cooloffMs: COOLOFF_MS,
        now,
        store,
      });

      b.recordFailure("regrid");
      b.recordFailure("regrid");
      await vi.waitFor(() => expect(saves).toHaveLength(0)); // noise not persisted

      b.recordFailure("regrid"); // trips
      await vi.waitFor(() => expect(saves).toHaveLength(1));
      expect(saves[0].snapshot.state).toBe("open");

      t += COOLOFF_MS;
      await b.shouldAllow("regrid"); // claims probe
      await vi.waitFor(() => expect(saves).toHaveLength(2));
      expect(saves[1].snapshot.state).toBe("half_open");

      b.recordSuccess("regrid"); // probe wins
      await vi.waitFor(() => expect(saves).toHaveLength(3));
      expect(saves[2].snapshot.state).toBe("closed");
      expect(saves[2].snapshot.failures).toBe(0);
    });

    it("hydrates a persisted open state and keeps denying after a 'deploy'", async () => {
      const openedAt = new Date(t - 60_000); // tripped 1 min ago, cooloff is 5
      const { store } = makeFakeStore({
        regrid: { state: "open", failures: 3, openedAt, lastFailureAt: openedAt },
      });
      // Fresh breaker instance = fresh process after a deploy.
      const b = new ProviderCircuitBreaker({
        failureThreshold: 3,
        windowMs: WINDOW_MS,
        cooloffMs: COOLOFF_MS,
        now,
        store,
      });
      expect(await b.shouldAllow("regrid")).toEqual({ allowed: false, probe: false });
      expect(b.snapshot("regrid").state).toBe("open");

      // And the persisted trip still graduates to a probe once cooloff passes.
      t = openedAt.getTime() + COOLOFF_MS;
      expect(await b.shouldAllow("regrid")).toEqual({ allowed: true, probe: true });
    });

    it("a failed hydration degrades to closed (fail open)", async () => {
      const store: BreakerStore = {
        load: vi.fn(async () => {
          throw new Error("db down");
        }),
        save: vi.fn(async () => {}),
      };
      const b = new ProviderCircuitBreaker({ now, store });
      expect(await b.shouldAllow("regrid")).toEqual({ allowed: true, probe: false });
    });
  });
});
