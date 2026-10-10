/**
 * tests/db/countyPipelineOnBuiltSchema.ts — does the W2 on-demand county
 * pipeline actually run against a database built from this repository?
 *
 *     DATABASE_URL=postgres://… npx tsx tests/db/countyPipelineOnBuiltSchema.ts
 *
 * The W2 build tested the pipeline with injected deps and a mocked `db` only.
 * This drives the REAL entry points — enqueueCountyProcessing() (what a
 * customer search calls) and runCountyPipelineTick() (what the worker job
 * calls) — against real tables, with the network replaced by a fixture:
 *
 *   - the county's parcel service is a fixture ArcGIS layer that, like many
 *     real services, caps a page BELOW the pipeline's PAGE_SIZE and returns a
 *     feature with no geometry mid-county;
 *   - every context layer answers with an empty FeatureCollection and the
 *     3DEP tile with 404, so facts are honest "unavailable"/"none" answers;
 *   - every URL fetched is recorded, so "refused before any fetch" is a
 *     measured claim, not a comment.
 *
 * WHAT IT PROVES
 *   1. Each refusal (no free source / review pending / terms forbid storing)
 *      is recorded on the coverage row with zero fetches; an unsourced county
 *      also becomes a discovery demand signal.
 *   2. The TN statewide non-commercial service is refused whether it arrives
 *      as the statewide row (even one marked redistributable) or as a COUNTY
 *      row pointing at the same service.
 *   3. A storable county is drained to completion — every parcel with a
 *      geometry stored, none lost to a short page — as global
 *      (organization_id NULL) parcel_snapshots rows with source
 *      'owned_pipeline', a parcel key, and facts that each carry sources with
 *      a retrieval date.
 *   4. A re-run updates in place (no duplicates), the lookup cache neither
 *      serves nor overwrites a kept parcel.
 *
 * Seeds its own rows and deletes them afterwards. Exits non-zero on failure.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { countyDiscoveryQueue, countyGisEndpoints, parcelSnapshots } from "@shared/schema";
import { PARCEL_FACT_KEYS } from "@shared/landData/parcelFacts";

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`[county-pipeline-on-built-schema] ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

// ── Network fixture ───────────────────────────────────────────────────────
const FIXTURE_HOST = "fixture-county-gis.invalid";
const FIXTURE_LAYER = `https://${FIXTURE_HOST}/arcgis/rest/services/Parcels/FeatureServer/0`;
const TN_PUBLIC_SERVICE =
  "https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer";
/** Like many real ArcGIS layers: maxRecordCount below the pipeline's PAGE_SIZE. */
const SERVER_MAX_RECORDS = 50;
/** Enough parcels that the county takes six worker ticks (8 pages × 50 each). */
const TOTAL = 2600;
const NO_GEOMETRY_OID = 30; // a parcel row with no shape, mid-page
/** One transient upstream failure, in the county's sixth tick. */
const TRANSIENT_FAILURE_AFTER = 2000;
let transientFailed = false;

function square(i: number) {
  // A 60 m square on a grid in rural DeKalb County, TN (synthetic shapes).
  const lng0 = -85.85 + (i % 60) * 0.0008;
  const lat0 = 35.95 + Math.floor(i / 60) * 0.0008;
  const d = 0.0006;
  return { type: "Polygon", coordinates: [[[lng0, lat0], [lng0 + d, lat0], [lng0 + d, lat0 + d], [lng0, lat0 + d], [lng0, lat0]]] };
}

const fetched: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  fetched.push(url);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.startsWith(`${FIXTURE_LAYER}?`)) {
    return json({ objectIdField: "OBJECTID", maxRecordCount: SERVER_MAX_RECORDS, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }] });
  }
  if (url.startsWith(`${FIXTURE_LAYER}/query?`)) {
    const p = new URL(url).searchParams;
    const after = Number(/OBJECTID > (\d+)/.exec(p.get("where") ?? "")?.[1] ?? 0);
    if (after >= TRANSIENT_FAILURE_AFTER && !transientFailed) {
      transientFailed = true;
      return json({ error: { code: 500, message: "transient upstream failure" } }, 500);
    }
    const n = Math.min(Number(p.get("resultRecordCount") ?? 1000), SERVER_MAX_RECORDS);
    const features = [];
    for (let oid = after + 1; oid <= TOTAL && features.length < n; oid++) {
      features.push({
        type: "Feature",
        geometry: oid === NO_GEOMETRY_OID ? null : square(oid),
        properties: { OBJECTID: oid, PIN: `FX-${String(oid).padStart(4, "0")}`, DEEDAC: 0.9 },
      });
    }
    return json({ type: "FeatureCollection", features, exceededTransferLimit: after + n < TOTAL });
  }
  if (url.includes("/query?")) return json({ type: "FeatureCollection", features: [] });
  return new Response("not found", { status: 404 });
}) as typeof fetch;

async function main() {
  const { db, pool } = await import("../../server/db");
  const { enqueueCountyProcessing, runCountyPipelineTick, OWNED_SNAPSHOT_SOURCE } = await import(
    "../../server/services/landData/countyPipeline"
  );
  const { storage } = await import("../../server/storage");

  const STATE = "TN";
  const COUNTIES = ["nowhere fixture", "pending fixture", "dekalb", "warren fixture", "owned fixture"];
  const cleanup = async () => {
    await db.delete(parcelSnapshots).where(and(eq(parcelSnapshots.state, STATE), inArray(parcelSnapshots.county, COUNTIES)));
    await db.delete(countyDiscoveryQueue).where(and(eq(countyDiscoveryQueue.state, STATE), inArray(countyDiscoveryQueue.county, COUNTIES)));
    await db.delete(countyGisEndpoints).where(and(eq(countyGisEndpoints.state, STATE), inArray(countyGisEndpoints.county, [...COUNTIES, "*"])));
  };
  const rowOf = async (county: string) =>
    (await db.select().from(countyDiscoveryQueue).where(and(eq(countyDiscoveryQueue.state, STATE), eq(countyDiscoveryQueue.county, county))))[0];

  await cleanup();
  try {
    // 1. No free source → refused, demand recorded, discovery enqueued, no fetch.
    fetched.length = 0;
    const none = await enqueueCountyProcessing(STATE, "Nowhere Fixture County");
    const noneRow = await rowOf("nowhere fixture");
    check(none.status === "refused" && /not found a free parcel source/.test(none.refusalReason ?? ""), "no source → refused with the customer-facing reason");
    check(noneRow?.status === "pending" && noneRow.ownedDemand === 1, "no source → a discovery demand signal (queue row pending, demand 1)");
    check(fetched.length === 0, `no source → zero fetches (saw ${fetched.length})`);

    // 2. Review pending: an inactive county row.
    await db.insert(countyGisEndpoints).values({ state: STATE, county: "Pending Fixture", endpointType: "arcgis_feature", baseUrl: `https://${FIXTURE_HOST}/x/FeatureServer`, layerId: "0", isActive: false, redistributable: "yes" });
    const pend = await enqueueCountyProcessing(STATE, "Pending Fixture");
    check(pend.status === "refused" && /not passed review/.test(pend.refusalReason ?? ""), "inactive source → refused as review pending");

    // 3. The TN statewide row exactly as seedCountyGisEndpoints writes it, then
    //    one a reviewer wrongly marked redistributable.
    await db.insert(countyGisEndpoints).values({ state: STATE, county: "*", endpointType: "arcgis_feature", baseUrl: TN_PUBLIC_SERVICE, layerId: "0", isActive: true });
    const sw1 = await enqueueCountyProcessing(STATE, "DeKalb");
    check(sw1.status === "refused" && /does not allow us to keep a copy/.test(sw1.refusalReason ?? ""), "TN statewide (as seeded) → refused: terms forbid storing");
    await db.update(countyGisEndpoints).set({ redistributable: "yes" }).where(and(eq(countyGisEndpoints.state, STATE), eq(countyGisEndpoints.county, "*")));
    const sw2 = await enqueueCountyProcessing(STATE, "DeKalb");
    check(sw2.status === "refused", "TN statewide marked redistributable → still refused (the licence register says no)");

    // 4. The same non-commercial service arriving as a COUNTY row (how
    //    discovery-on-miss would insert it), reviewed as redistributable.
    await db.insert(countyGisEndpoints).values({ state: STATE, county: "Warren Fixture", endpointType: "arcgis_feature", baseUrl: `${TN_PUBLIC_SERVICE}/`, layerId: "0", isActive: true, redistributable: "yes" });
    const warren = await enqueueCountyProcessing(STATE, "Warren Fixture");
    check(warren.status === "refused", `TN non-commercial service as a county row → refused (got ${warren.status})`);
    const tickWhileRefused = await runCountyPipelineTick();
    check(tickWhileRefused.outcome === "idle", `nothing refused is worked (tick outcome ${tickWhileRefused.outcome})`);
    check(fetched.length === 0, `every refusal decided before any fetch (saw ${fetched.length}: ${fetched.slice(0, 2).join(", ")})`);

    // 5. A storable county, drained by the worker tick.
    await db.insert(countyGisEndpoints).values({
      state: STATE, county: "Owned Fixture", endpointType: "arcgis_feature", baseUrl: FIXTURE_LAYER.replace(/\/0$/, ""), layerId: "0",
      isActive: true, redistributable: "attribution", fieldMappings: { apn: "PIN", acres: "DEEDAC" },
    });
    const owned = await enqueueCountyProcessing(STATE, "Owned Fixture County");
    check(owned.status === "pending", `storable county → pending (got ${owned.status})`);
    // Drain as the worker would, tick after tick. One upstream failure in a
    // long county must not condemn it: it is retried on the next tick.
    const outcomes: string[] = [];
    let tick = await runCountyPipelineTick();
    outcomes.push(tick.outcome);
    for (let i = 0; i < 12 && tick.outcome !== "complete" && tick.county === "owned fixture"; i++) {
      tick = await runCountyPipelineTick();
      outcomes.push(tick.outcome);
    }
    console.log(`[county-pipeline-on-built-schema] ticks: ${outcomes.join(" ")}`);
    check(transientFailed && outcomes.includes("error"), "the fixture's transient failure was hit");
    const job = await rowOf("owned fixture");
    const rows = await db.select().from(parcelSnapshots).where(and(eq(parcelSnapshots.state, STATE), eq(parcelSnapshots.county, "owned fixture")));
    const expected = TOTAL - 1;
    check(tick.outcome === "complete" && job?.ownedStatus === "complete", `county drained to complete (outcome ${tick.outcome}, status ${job?.ownedStatus})`);
    check(rows.length === expected, `every parcel with a shape stored: ${rows.length} of ${expected}`);
    check(rows.length > 0 && job?.ownedParcelsStored === rows.length, `parcels_stored counter matches the rows (${job?.ownedParcelsStored} vs ${rows.length})`);
    check(rows.length > 0 && rows.every((r) => r.source === OWNED_SNAPSHOT_SOURCE && r.organizationId === null && !!r.parcelKey && r.expiresAt === null), "rows are global owned_pipeline rows with a parcel key and no expiry");
    const factsOk = rows.length > 0 && rows.every((r) => {
      const f = r.facts as Record<string, { status: string; sources?: Array<{ retrievedOn?: string }>; confidence?: unknown; reason?: string }> | null;
      if (!f) return false;
      return PARCEL_FACT_KEYS.every((k) => {
        const x = f[k];
        if (!x) return false;
        if (x.status === "computed") return !!x.confidence && (x.sources?.length ?? 0) > 0 && x.sources!.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.retrievedOn ?? ""));
        return x.status === "unavailable" && typeof x.reason === "string" && x.reason.length > 0;
      });
    });
    check(factsOk, "every stored fact is computed-with-sources-and-confidence or unavailable-with-a-reason");
    check(!fetched.some((u) => u.includes("Tennessee_Property_Boundaries_Public_Use")), "the non-commercial TN service was never fetched");

    // 6. Idempotent re-run: reset the cursor and drain again — no duplicates.
    await db.update(countyDiscoveryQueue).set({ ownedStatus: "pending", ownedNextOffset: 0 }).where(eq(countyDiscoveryQueue.id, job!.id));
    tick = await runCountyPipelineTick();
    for (let i = 0; i < 12 && tick.outcome === "partial"; i++) tick = await runCountyPipelineTick();
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(parcelSnapshots).where(and(eq(parcelSnapshots.state, STATE), eq(parcelSnapshots.county, "owned fixture")));
    check(n === expected, `a re-run updates in place (${n} rows)`);

    // 7. The lookup cache neither serves nor overwrites a kept parcel.
    if (rows.length === 0) throw new Error("no kept parcels to check the cache against");
    const apn = rows[0].apn;
    const cached = await storage.getParcelSnapshot(apn, STATE, "owned fixture", 30);
    check(!cached, "the lookup cache never serves a kept parcel");
    await storage.upsertParcelSnapshot({ apn, state: STATE, county: "owned fixture", source: "county_gis", organizationId: null, acres: "99" } as never);
    const [keptAfter] = await db.select().from(parcelSnapshots).where(eq(parcelSnapshots.id, rows[0].id));
    check(keptAfter.source === OWNED_SNAPSHOT_SOURCE && keptAfter.acres !== "99", "a cache upsert for the same APN does not overwrite the kept parcel");
  } finally {
    await cleanup();
    globalThis.fetch = realFetch;
    await pool.end();
  }

  if (failures.length > 0) {
    console.error(`[county-pipeline-on-built-schema] ${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log("[county-pipeline-on-built-schema] PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error("[county-pipeline-on-built-schema] crashed:", err);
  process.exit(1);
});
