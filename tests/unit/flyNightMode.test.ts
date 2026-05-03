/**
 * fly-night-mode unit tests — pure decision logic + safety guardrails.
 *
 * The big invariants we lock in here:
 *   1. Never recommends scaling below 1 (the hard floor).
 *   2. Holds when an active P0/P1 incident is in flight.
 *   3. Skips scale-down on Fri/Sat UTC (mailer prep window).
 *   4. setMinMachines clamps any value < 1 up to 1 before any API call.
 */

import { describe, it, expect, vi } from "vitest";
import {
  decideNightMode,
  setMinMachines,
  TARGET_DAY_MIN,
  TARGET_NIGHT_MIN,
} from "../../scripts/fly-night-mode";

// ─── decideNightMode ──────────────────────────────────────────────────────────

describe("decideNightMode", () => {
  // Use a Wednesday at 03:00 UTC as the canonical "night-mode window" date.
  const WED_03_UTC = new Date(Date.UTC(2026, 4, 6, 3, 0, 0)); // 2026-05-06 = Wed
  const WED_10_UTC = new Date(Date.UTC(2026, 4, 6, 10, 0, 0));
  const FRI_03_UTC = new Date(Date.UTC(2026, 4, 8, 3, 0, 0)); // 2026-05-08 = Fri
  const SAT_03_UTC = new Date(Date.UTC(2026, 4, 9, 3, 0, 0)); // 2026-05-09 = Sat
  const SUN_03_UTC = new Date(Date.UTC(2026, 4, 10, 3, 0, 0)); // 2026-05-10 = Sun

  it("scales down from 2 → 1 inside the night window on a non-Fri/Sat", () => {
    const d = decideNightMode({
      now: WED_03_UTC,
      currentMin: 2,
      hasActiveIncident: false,
    });
    expect(d.action).toBe("scale-down");
    expect(d.targetMin).toBe(TARGET_NIGHT_MIN);
    expect(d.targetMin).toBeGreaterThanOrEqual(1);
  });

  it("scales up from 1 → 2 outside the night window on a non-Fri/Sat", () => {
    const d = decideNightMode({
      now: WED_10_UTC,
      currentMin: 1,
      hasActiveIncident: false,
    });
    expect(d.action).toBe("scale-up");
    expect(d.targetMin).toBe(TARGET_DAY_MIN);
  });

  it("noops if already at the right scale during the night window", () => {
    const d = decideNightMode({
      now: WED_03_UTC,
      currentMin: 1,
      hasActiveIncident: false,
    });
    expect(d.action).toBe("noop");
  });

  it("noops if already at the right scale during the day", () => {
    const d = decideNightMode({
      now: WED_10_UTC,
      currentMin: 2,
      hasActiveIncident: false,
    });
    expect(d.action).toBe("noop");
  });

  it("never scales down on Fridays UTC", () => {
    const d = decideNightMode({
      now: FRI_03_UTC,
      currentMin: 2,
      hasActiveIncident: false,
    });
    expect(d.action).toBe("noop");
    expect(d.targetMin).toBe(2);
  });

  it("never scales down on Saturdays UTC", () => {
    const d = decideNightMode({
      now: SAT_03_UTC,
      currentMin: 2,
      hasActiveIncident: false,
    });
    expect(d.action).toBe("noop");
    expect(d.targetMin).toBe(2);
  });

  it("does scale down on Sunday UTC inside the night window", () => {
    // Sun is a high-traffic day in many places but not for US land investors —
    // the spec calls out Fri+Sat only.
    const d = decideNightMode({
      now: SUN_03_UTC,
      currentMin: 2,
      hasActiveIncident: false,
    });
    expect(d.action).toBe("scale-down");
    expect(d.targetMin).toBe(TARGET_NIGHT_MIN);
  });

  it("still wakes on Fri/Sat if somehow asleep at scale 1", () => {
    const d = decideNightMode({
      now: FRI_03_UTC,
      currentMin: 1,
      hasActiveIncident: false,
    });
    expect(d.action).toBe("scale-up");
    expect(d.targetMin).toBe(TARGET_DAY_MIN);
  });

  it("holds capacity during an active P0/P1 incident even at 03:00 UTC", () => {
    const d = decideNightMode({
      now: WED_03_UTC,
      currentMin: 2,
      hasActiveIncident: true,
    });
    expect(d.action).toBe("noop");
    expect(d.targetMin).toBe(2);
  });

  it("never returns a targetMin below 1 (hard floor)", () => {
    // Sweep all 24 hours, all 7 days, both incident states, both currentMins.
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        for (const incident of [false, true]) {
          for (const current of [1, 2, 3]) {
            const now = new Date(Date.UTC(2026, 4, 3 + day, hour, 0, 0));
            const d = decideNightMode({
              now,
              currentMin: current,
              hasActiveIncident: incident,
            });
            expect(d.targetMin).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });
});

// ─── setMinMachines guardrail ─────────────────────────────────────────────────

describe("setMinMachines", () => {
  it("clamps targetMin < 1 up to 1 before any API call", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch: typeof fetch = (async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      // GET /machines
      if (init?.method === "GET" || !init?.method) {
        return new Response(
          JSON.stringify([
            {
              id: "m1",
              name: "app1",
              region: "iad",
              state: "started",
              config: {
                services: [
                  { internal_port: 5000, min_machines_running: 2 },
                ],
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // POST /machines/{id}
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await setMinMachines({
      flyApiToken: "fake",
      flyAppName: "acreos",
      targetMin: 0, // attempted "scale to zero"
      fetchImpl: fakeFetch,
    });

    // Find the POST body and confirm we sent min_machines_running: 1, NOT 0.
    const post = calls.find((c) => c.init?.method === "POST");
    expect(post).toBeDefined();
    const body = JSON.parse(String(post!.init!.body));
    expect(body.config.services[0].min_machines_running).toBe(1);
  });

  it("clamps a negative targetMin up to 1", async () => {
    const fakeFetch: typeof fetch = (async (_url: any, init?: any) => {
      if (init?.method === "GET" || !init?.method) {
        return new Response(
          JSON.stringify([
            {
              id: "m1",
              config: { services: [{ min_machines_running: 2 }] },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await setMinMachines({
      flyApiToken: "fake",
      flyAppName: "acreos",
      targetMin: -5,
      fetchImpl: fakeFetch,
    });
    warnSpy.mockRestore();
  });

  it("propagates the desired targetMin when it is >= 1", async () => {
    let postedMin: number | undefined;
    const fakeFetch: typeof fetch = (async (_url: any, init?: any) => {
      if (init?.method === "GET" || !init?.method) {
        return new Response(
          JSON.stringify([
            {
              id: "m1",
              config: { services: [{ min_machines_running: 2 }] },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      const body = JSON.parse(String(init!.body));
      postedMin = body.config.services[0].min_machines_running;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await setMinMachines({
      flyApiToken: "fake",
      flyAppName: "acreos",
      targetMin: 1,
      fetchImpl: fakeFetch,
    });
    expect(postedMin).toBe(1);
  });
});
