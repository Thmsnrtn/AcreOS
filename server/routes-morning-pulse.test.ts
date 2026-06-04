/**
 * Tests for the founder HTTP surface of the Solene morning pulse
 * (server/routes-morning-pulse.ts).
 *
 * Coverage:
 *  - 401 when unauthenticated
 *  - 404 when authenticated but not founder (requireFounder returns 404
 *    to hide route existence — we assert the actual behavior)
 *  - GET returns the cached pulse when one exists
 *  - GET falls back to live compute when no cached pulse
 *  - POST /refresh forces re-compute + persist
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// In-memory pulse store + canned snapshots.
// ---------------------------------------------------------------------------

interface StoredPulse {
  id: number;
  oneLine: string;
  dayLabel: string;
}
const PULSE_STORE: StoredPulse[] = [];
let NEXT_ID = 1;

function resetStore() {
  PULSE_STORE.length = 0;
  NEXT_ID = 1;
}

const COMPOSED_SNAPSHOT = {
  generatedAt: new Date("2026-06-04T12:00:00Z"),
  dayLabel: "Thu 2026-06-04",
  oneLine:
    "Thu 2026-06-04 · $0 MRR · +0 trials · 99.9% uptime · 0/0 compliance · $0.00 week-cost · 0 decisions waiting · Horizon: 7 days",
  mrr: 0,
  trials: 0,
  uptimePct: 99.9,
  prodVersion: "abcd1234",
  complianceOpenCount: 0,
  weeklySpendUsd: 0,
  decisionsWaitingCount: 0,
  autonomyHorizonDays: 7,
  envelopeStatus: "green" as const,
  dispatchesCompletedLast24h: 0,
  dispatchesFlaggedLast24h: 0,
  asksOpenCount: 0,
  asksUrgentCount: 0,
  agentActivity: [],
};

// ---------------------------------------------------------------------------
// Mocks: continuousLoop service + logger + auth middleware.
// ---------------------------------------------------------------------------

vi.mock("./utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("./services/solene/continuousLoop", () => ({
  composeMorningPulse: vi.fn(async () => COMPOSED_SNAPSHOT),
  persistMorningPulse: vi.fn(async (snap: any) => {
    const id = NEXT_ID++;
    PULSE_STORE.push({
      id,
      oneLine: snap.oneLine,
      dayLabel: snap.dayLabel,
    });
    return { pulseId: id };
  }),
  getLatestMorningPulse: vi.fn(async () => {
    if (PULSE_STORE.length === 0) return null;
    const last = PULSE_STORE[PULSE_STORE.length - 1];
    return { ...COMPOSED_SNAPSHOT, oneLine: last.oneLine, dayLabel: last.dayLabel };
  }),
}));

const AUTH_STATE = {
  authenticated: true,
  founder: true,
};

vi.mock("./auth", () => ({
  isAuthenticated: (_req: any, res: any, next: any) => {
    if (!AUTH_STATE.authenticated) {
      return res
        .status(401)
        .json({ error: "UNAUTHORIZED", message: "No session" });
    }
    return next();
  },
  requireFounder: (_req: any, res: any, next: any) => {
    if (!AUTH_STATE.founder) {
      // Mirrors the real middleware: 404 (hide existence).
      return res.status(404).json({ message: "Not found" });
    }
    return next();
  },
}));

// ---------------------------------------------------------------------------
// Test app builder.
// ---------------------------------------------------------------------------

async function buildApp() {
  const { registerMorningPulseRoutes } = await import("./routes-morning-pulse");
  const app = express();
  app.use(express.json());
  registerMorningPulseRoutes(app);
  return app;
}

beforeEach(() => {
  resetStore();
  AUTH_STATE.authenticated = true;
  AUTH_STATE.founder = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// AUTH GATES
// ---------------------------------------------------------------------------

describe("auth gates", () => {
  it("returns 401 when unauthenticated", async () => {
    AUTH_STATE.authenticated = false;
    const app = await buildApp();
    const res = await request(app).get(
      "/api/founder/solene/morning-pulse",
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 (hide-existence) when authenticated but not founder", async () => {
    AUTH_STATE.authenticated = true;
    AUTH_STATE.founder = false;
    const app = await buildApp();
    const res = await request(app).get(
      "/api/founder/solene/morning-pulse",
    );
    expect(res.status).toBe(404);
  });

  it("POST /refresh also enforces founder", async () => {
    AUTH_STATE.founder = false;
    const app = await buildApp();
    const res = await request(app).post(
      "/api/founder/solene/morning-pulse/refresh",
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/founder/solene/morning-pulse
// ---------------------------------------------------------------------------

describe("GET /api/founder/solene/morning-pulse", () => {
  it("returns cached pulse when latest exists", async () => {
    // Seed the store with a pulse first (simulating the cron having run).
    const seed = { ...COMPOSED_SNAPSHOT, oneLine: "seeded-one-line", dayLabel: "Seed-day" };
    PULSE_STORE.push({ id: 99, oneLine: seed.oneLine, dayLabel: seed.dayLabel });

    const app = await buildApp();
    const res = await request(app).get(
      "/api/founder/solene/morning-pulse",
    );
    expect(res.status).toBe(200);
    expect(res.body.freshFromCache).toBe(true);
    expect(res.body.pulse.oneLine).toBe("seeded-one-line");
  });

  it("falls back to live compute when no cached pulse", async () => {
    const app = await buildApp();
    const res = await request(app).get(
      "/api/founder/solene/morning-pulse",
    );
    expect(res.status).toBe(200);
    expect(res.body.freshFromCache).toBe(false);
    expect(res.body.pulse.oneLine).toBe(COMPOSED_SNAPSHOT.oneLine);
    // Live compute path also persists for next time.
    expect(PULSE_STORE.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/founder/solene/morning-pulse/refresh
// ---------------------------------------------------------------------------

describe("POST /api/founder/solene/morning-pulse/refresh", () => {
  it("forces re-compute even when cached pulse exists", async () => {
    PULSE_STORE.push({ id: 1, oneLine: "old", dayLabel: "Old" });
    const before = PULSE_STORE.length;

    const app = await buildApp();
    const res = await request(app).post(
      "/api/founder/solene/morning-pulse/refresh",
    );
    expect(res.status).toBe(200);
    expect(res.body.pulse.oneLine).toBe(COMPOSED_SNAPSHOT.oneLine);
    expect(res.body.pulseId).toBeGreaterThan(0);
    // New row appended even though a cached row existed.
    expect(PULSE_STORE.length).toBe(before + 1);
  });
});
