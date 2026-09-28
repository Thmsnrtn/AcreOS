/**
 * DEFECT-0138 — a stored parcel-intelligence report is served only for the
 * scenario it was computed for.
 *
 * POST /api/data-intel/parcel-intelligence keyed its store on the parcel
 * alone (APN/state/county or coordinates), while the report — score and
 * recommendation — depends on the asking price, assessed value, owner and
 * tax inputs. Re-opening the parcel with a different asking price was served
 * the report computed for the old one. This drives the real route with the
 * real key helpers and an in-memory store.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  store: new Map<string, { staleAfter: Date; report: Record<string, unknown> }>(),
  fusion: vi.fn(async (input: { askingPrice?: number }) => ({
    landIntelligenceScore: 50,
    recommendation: `computed for ${input.askingPrice ?? "none"}`,
  })),
}));

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/parcelIntelligenceFusion", () => ({ generateLandIntelligenceReport: h.fusion }));
vi.mock("../../server/services/data-cache/land-intelligence-store", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    readStoredReport: async (parcelKey: string) => h.store.get(parcelKey) ?? null,
    writeStoredReport: async (a: { parcelKey: string; report: Record<string, unknown> }) => {
      h.store.set(a.parcelKey, { staleAfter: new Date(Date.now() + 86_400_000), report: a.report });
    },
  };
});

import router from "../../server/routes-data-intelligence";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { organization: { id: number } }).organization = { id: 7 };
  next();
});
app.use("/api/data-intel", router);

const parcel = { latitude: 30.1, longitude: -97.7, state: "TX", county: "Travis", apn: "123-45", acres: 5 };
const post = (body: Record<string, unknown>) => request(app).post("/api/data-intel/parcel-intelligence").send({ ...parcel, ...body });

beforeEach(() => {
  h.store.clear();
  h.fusion.mockClear();
});

describe("DEFECT-0138 — the report cache is keyed on the scenario", () => {
  it("a different asking price recomputes instead of serving the old report", async () => {
    const a = await post({ askingPrice: 20000 });
    expect(a.body.recommendation).toBe("computed for 20000");
    await new Promise((r) => setTimeout(r, 0)); // the write is fire-and-forget
    const b = await post({ askingPrice: 45000 });
    expect(b.headers["x-lis-cache"]).toBe("miss");
    expect(b.body.recommendation).toBe("computed for 45000");
    expect(h.fusion).toHaveBeenCalledTimes(2);
  });

  it("the same scenario is still a hit, and the key never reaches the client", async () => {
    await post({ askingPrice: 20000 });
    await new Promise((r) => setTimeout(r, 0));
    const b = await post({ askingPrice: 20000 });
    expect(b.headers["x-lis-cache"]).toBe("hit");
    expect(h.fusion).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(b.body)).not.toContain("_scenarioKey");
  });
});
