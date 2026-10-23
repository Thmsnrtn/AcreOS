/**
 * D1c — statewide-layer change detection, the A2 policy blocks and the A4
 * snapshot series.
 *
 * Offline by construction: every server response here is SYNTHETIC (built
 * in this file), standing in for the ArcGIS layer JSON and count queries the
 * live poller fetches. It proves the poller's logic, not any state's data.
 * Everything is driven through pollAllStatewideLayers — the function the
 * scheduled job calls — not through its internals.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { STATEWIDE_PARCEL_ENDPOINTS } from "../../server/services/statewideParcelEndpoints";
import { pollAllStatewideLayers, type LayerSnapshot, type PollDeps } from "../../server/services/openData/statewideLayerPoller";
import { overdueVsCadence, statewideSource } from "../../server/services/openData/statewideSourceRegistry";

const NOW = new Date("2026-10-22T12:00:00Z");
const FL = STATEWIDE_PARCEL_ENDPOINTS.find((e) => e.state === "FL")!;
const USE_CLASSES = ["internal", "display", "redistribution", "resale"] as const;
const RESTRICTIVE = { can_display: false, can_export: false, can_mail: false, can_resell: false, can_cache: false, attribution_required: true };

/** A synthetic server: per-state lastEditDate (ms) and count. */
function server(state: Record<string, { lastEdit?: number; count?: number; fail?: boolean }>): PollDeps & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    now: () => NOW,
    async getJson(url) {
      urls.push(url);
      const ep = STATEWIDE_PARCEL_ENDPOINTS.find((e) => url.startsWith(`${e.baseUrl.replace(/\/+$/, "")}/${e.layerId}`))!;
      const s = state[ep.state] ?? {};
      if (s.fail) return { ok: false, status: 503, body: null, etag: null };
      if (url.includes("returnCountOnly=true")) return { ok: true, status: 200, body: { count: s.count ?? 100 }, etag: null };
      return { ok: true, status: 200, body: s.lastEdit ? { editingInfo: { lastEditDate: s.lastEdit } } : {}, etag: `"etag-${ep.state}"` };
    },
  };
}

const pollFl = (srv: PollDeps, previous: LayerSnapshot | null = null, lastIngested: Date | null = null) =>
  pollAllStatewideLayers(srv, new Map(previous ? [["FL", previous]] : []), new Map(lastIngested ? [["FL", lastIngested]] : []), [FL]);

const snap = (over: Partial<LayerSnapshot>): LayerSnapshot => ({
  state: "FL", layerUrl: "u", fetchedAt: NOW.toISOString(), ok: true, lastEditDate: "2026-08-15T00:00:00.000Z", rowCount: 100, etag: null, error: null, ...over,
});
const AUG15 = Date.parse("2026-08-15T00:00:00Z");

describe("source registry: one entry per statewide row (population pinned)", () => {
  it("every seeded statewide row has a registry entry", () => {
    expect(STATEWIDE_PARCEL_ENDPOINTS.length).toBeGreaterThanOrEqual(9); // vacuity floor: the seeded population
    for (const ep of STATEWIDE_PARCEL_ENDPOINTS) expect(statewideSource(ep.state), ep.state).toBeDefined();
    expect(statewideSource("ZZ")).toBeUndefined();
  });

  it("A2: every row carries the policy block, restrictive until its dossier resolves a use class", () => {
    for (const ep of STATEWIDE_PARCEL_ENDPOINTS) {
      const e = statewideSource(ep.state)!;
      expect(e.dossier.termsUrl).toBe(ep.termsUrl ?? null);
      for (const u of USE_CLASSES) expect(e.dossier.useClasses[u].status, `${e.state} ${u}`).toBe("unresolved");
      expect(e.policy, e.state).toEqual(RESTRICTIVE);
    }
  });

  it("cadence is documented for FL, MT and AR only — every other source is an honest null", () => {
    const documented = STATEWIDE_PARCEL_ENDPOINTS.map((e) => statewideSource(e.state)!).filter((e) => e.cadence).map((e) => e.state).sort();
    expect(documented).toEqual(["AR", "FL", "MT"]);
    for (const ep of STATEWIDE_PARCEL_ENDPOINTS) {
      const e = statewideSource(ep.state)!;
      if (e.cadence) expect(e.cadenceSource).toBeTruthy();
      else expect(e.cadenceSource).toBeNull();
    }
    expect(statewideSource("FL")!.cadence).toEqual({ kind: "annual", publishedMonth: 8 });
  });

  it("WA's dossier records the owner-name restriction (design §8)", () => {
    expect(statewideSource("WA")!.dossier.restrictions.join(" ")).toMatch(/RCW/);
  });
});

describe("one source's snapshot", () => {
  it("reads lastEditDate, row count and ETag with metadata-only calls (never a feature page)", async () => {
    const srv = server({ FL: { lastEdit: AUG15, count: 10_434_000 } });
    const { snapshots } = await pollFl(srv);
    expect(snapshots[0]).toMatchObject({ state: "FL", ok: true, lastEditDate: "2026-08-15T00:00:00.000Z", rowCount: 10_434_000, etag: '"etag-FL"', error: null });
    expect(srv.urls).toHaveLength(2);
    expect(srv.urls[0]).toMatch(/FeatureServer\/0\?f=json$/);
    expect(srv.urls[1]).toMatch(/returnCountOnly=true/);
    for (const u of srv.urls) expect(u).not.toMatch(/returnGeometry|outFields/);
  });

  it("a server that publishes no lastEditDate is a null, not a guessed date", async () => {
    const { snapshots } = await pollFl(server({ FL: { count: 5 } }));
    expect(snapshots[0].ok).toBe(true);
    expect(snapshots[0].lastEditDate).toBeNull();
  });

  it("a failed poll is a snapshot with ok=false — it never throws", async () => {
    const { snapshots } = await pollFl(server({ FL: { fail: true } }));
    expect(snapshots[0]).toMatchObject({ ok: false, lastEditDate: null, rowCount: null });
    expect(snapshots[0].error).toMatch(/503/);
  });
});

describe("drift", () => {
  it("first run: change since last poll is unknown (null), not 'no change'", async () => {
    expect((await pollFl(server({ FL: { lastEdit: AUG15 } }))).drift[0].changedSinceLastPoll).toBeNull();
  });

  it("a new lastEditDate is a change; the same one is not", async () => {
    expect((await pollFl(server({ FL: { lastEdit: Date.parse("2026-09-01T00:00:00Z") } }), snap({}))).drift[0].changedSinceLastPoll).toBe(true);
    expect((await pollFl(server({ FL: { lastEdit: AUG15 } }), snap({}))).drift[0].changedSinceLastPoll).toBe(false);
  });

  it("without a lastEditDate on either side, the row count decides", async () => {
    expect((await pollFl(server({ FL: { count: 101 } }), snap({ lastEditDate: null }))).drift[0].changedSinceLastPoll).toBe(true);
  });

  it("change since ingest is null while nothing was ever ingested (today, everywhere)", async () => {
    expect((await pollFl(server({ FL: { lastEdit: AUG15 } }), snap({}))).drift[0].changedSinceIngest).toBeNull();
    expect((await pollFl(server({ FL: { lastEdit: AUG15 } }), snap({}), new Date("2026-01-01T00:00:00Z"))).drift[0].changedSinceIngest).toBe(true);
  });

  it("overdue only where a cadence is documented", async () => {
    expect(overdueVsCadence({ kind: "annual", publishedMonth: 8 }, new Date("2026-08-15T00:00:00Z"), NOW)).toBe(false);
    expect(overdueVsCadence({ kind: "annual", publishedMonth: 8 }, new Date("2025-06-01T00:00:00Z"), NOW)).toBe(true);
    expect(overdueVsCadence({ kind: "monthly" }, new Date("2026-08-01T00:00:00Z"), NOW)).toBe(true);
    expect(overdueVsCadence(null, new Date("2020-01-01T00:00:00Z"), NOW)).toBeNull();
    const nj = STATEWIDE_PARCEL_ENDPOINTS.find((e) => e.state === "NJ")!;
    const obs = await pollAllStatewideLayers(server({ NJ: { lastEdit: Date.parse("2020-01-01T00:00:00Z") } }), new Map(), new Map(), [nj]);
    expect(obs.drift[0].overdueVsCadence).toBeNull();
  });
});

describe("the whole poll (one run's observation, A4)", () => {
  it("snapshots every seeded source, in seed order, with a drift line each", async () => {
    const obs = await pollAllStatewideLayers(server({ FL: { lastEdit: AUG15 }, NY: { fail: true } }), new Map(), new Map());
    expect(obs.kind).toBe("statewide_layer_metadata");
    expect(obs.snapshots.map((s) => s.state)).toEqual(STATEWIDE_PARCEL_ENDPOINTS.map((e) => e.state));
    expect(obs.drift.map((d) => d.state)).toEqual(STATEWIDE_PARCEL_ENDPOINTS.map((e) => e.state));
    expect(obs.snapshots.find((s) => s.state === "NY")!.ok).toBe(false);
    for (const s of obs.snapshots) expect(s.fetchedAt).toBe(NOW.toISOString());
  });

  it("the second run compares against the first run's snapshots", async () => {
    const first = await pollAllStatewideLayers(server({ FL: { lastEdit: AUG15 } }), new Map(), new Map());
    const prev = new Map(first.snapshots.map((s) => [s.state, s]));
    const second = await pollAllStatewideLayers(server({ FL: { lastEdit: Date.parse("2026-09-30T00:00:00Z") } }), prev, new Map());
    expect(second.drift.find((d) => d.state === "FL")!.changedSinceLastPoll).toBe(true);
    // A source whose count and (absent) edit date held steady reads as unchanged.
    expect(second.drift.find((d) => d.state === "MT")!.changedSinceLastPoll).toBe(false);
  });
});
