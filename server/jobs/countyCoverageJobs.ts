/**
 * County coverage jobs, extracted from runScheduledJobs.ts (the god-file
 * ratchet shrinks one cohesive job group at a time). Three self-rescheduling
 * jobs that grow and keep free county parcel coverage:
 *
 *   1. county_endpoint_discovery (7d)  — broad ArcGIS sweep for county parcel
 *      services (Rosy River B3).
 *   2. county_discovery_queue_drain (30m) — demand-driven discovery-on-miss
 *      (Iris/Iyari).
 *   3. county_parcel_pipeline (10m) — W2: owns a searched county's free
 *      parcels and their facts, one county at a time.
 *
 * Moved verbatim (1, 2); every job keeps its name, cadence and lock.
 */
import { withJobLock, jobLog as log } from "../utils/jobRuntime";

export function startCountyCoverageJobs(): void {
  // ─── Rosy River B / county-GIS autonomous discovery (weekly) ──────────
  // Pillar B / B3 — perpetual discovery of new county ArcGIS parcel
  // endpoints. Every Sunday at 5:30am UTC the agent searches ArcGIS Online
  // for "parcel" / "assessor" / "cadastral" services, validates each, and
  // inserts verified rows into county_gis_endpoints. Goal: drive the
  // Regrid fallback rate down by cold-discovering counties our seed list
  // missed.
  import("../services/countyEndpointDiscovery").then(({ runCountyEndpointDiscovery }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("County endpoint discovery cron registered (self-rescheduling, 7d)", "data");
      scheduleSelfRescheduling({
        name: "county_endpoint_discovery",
        intervalMs: 7 * 24 * 60 * 60 * 1000,
        initialDelayMs: 30 * 60 * 1000,
        run: async () => {
          await withJobLock("county_endpoint_discovery", 60 * 60, async () => {
            const r = await runCountyEndpointDiscovery({ maxResults: 200 });
            log(
              `[county-discovery] scanned=${r.scanned} candidates=${r.candidatesExtracted} ` +
                `known=${r.alreadyKnown} validated=${r.validated} inserted=${r.inserted} failed=${r.failed}`,
              "data",
            );
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import county discovery cron: ${err}`, "data");
  });

  // ─── Iris/Iyari — demand-driven discovery-on-miss queue drain (30m) ───
  // The weekly cron above does a broad ArcGIS sweep. THIS job drains the
  // county_discovery_queue — the (state, county) pairs enqueued on real
  // parcel-lookup misses + customer "request this county" CTAs — in
  // demand+priority order. For each it probes ArcGIS, inserts the endpoint
  // as isActive=false / redistributable='review-required', and flips active
  // only after a real feature comes back for a test APN. $0, compounding:
  // every miss makes the next customer's lookup for that county hit free.
  import("../services/coverageLedger").then(({ runDiscoveryQueueDrain }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Discovery-on-miss queue drain registered (self-rescheduling, 30m)", "data");
      scheduleSelfRescheduling({
        name: "county_discovery_queue_drain",
        intervalMs: 30 * 60 * 1000,
        initialDelayMs: 5 * 60 * 1000,
        run: async () => {
          await withJobLock("county_discovery_queue_drain", 25 * 60, async () => {
            const r = await runDiscoveryQueueDrain(5);
            if (r.drained > 0) {
              log(
                `[discovery-on-miss] drained=${r.drained} activated=${r.activated} ` +
                  `reviewPending=${r.reviewPending} noCandidate=${r.noCandidate} ` +
                  `exhausted=${r.exhausted} errors=${r.errors}`,
                "data",
              );
            }
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to import discovery-on-miss queue drain: ${err}`, "data");
  });

  // ─── W2 — on-demand county parcel pipeline (10m) ─────────────────────
  // Drains county_parcel_jobs (created by the first customer search in a
  // county) one county at a time — MAX_CONCURRENT_COUNTIES = 1 via this lock,
  // ≤ MAX_PAGES_PER_TICK × PAGE_SIZE parcels per tick — so the 1 GB worker
  // stays safe. Refusals (no free source / terms forbid storing) are decided
  // and recorded, never worked around.
  import("../services/landData/countyPipeline").then(({ runCountyPipelineTick }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("County parcel pipeline registered (self-rescheduling, 10m)", "data");
      scheduleSelfRescheduling({
        name: "county_parcel_pipeline",
        intervalMs: 10 * 60 * 1000,
        initialDelayMs: 7 * 60 * 1000,
        run: async () => {
          await withJobLock("county_parcel_pipeline", 9 * 60, async () => {
            const r = await runCountyPipelineTick();
            if (r.county) log(`[county-pipeline] county=${r.county} stored=${r.stored} outcome=${r.outcome}`, "data");
          });
        },
      });
    });
  }).catch((err) => {
    log(`Failed to register county parcel pipeline: ${err}`, "data");
  });
}
