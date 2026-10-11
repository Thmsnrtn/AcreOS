/**
 * Agent-built free county parcel-source census (W2 task 3) — Tennessee seed.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/land-data/build-county-source-census.ts
 *
 * Writes shared/landData/countySourceCensus.tn.json (one row per county) and
 * shared/landData/tnCountyBoundaries.json (simplified TIGER county shapes for
 * the coverage map). Every field is read from a live source in this run:
 *
 *   - the county list and FIPS: Census TIGERweb State_County (STATE = 47);
 *   - (the state's non-commercial public service is NOT queried — founder
 *     decision 2026-10-11; blockedOutboundSources.ts);
 *   - candidate county-run services for the nine counties the Comptroller
 *     does not maintain: ArcGIS Online search, recorded as UNVERIFIED unless
 *     listed in REVIEWED below with the evidence a human-readable check found.
 *
 * Nothing is inferred: a county with no verified source says so.
 */

import { writeFileSync } from "node:fs";
import { fetchGeo } from "../../server/services/providers/fetchGeo";
import { blockedOutboundSource } from "../../server/services/providers/blockedOutboundSources";
import { TN_COMPTROLLER_DOWNLOAD, TN_SELF_MAINTAINED_COUNTIES } from "../../server/services/landData/tnParcelSources";

const today = new Date().toISOString().slice(0, 10);

/**
 * Candidates a check in this session verified (live count query + item terms
 * read). Anything else the search turns up stays "unverified".
 */
const REVIEWED: Record<string, { url: string; publisher: string; terms: string; commercialUse: "permitted" | "prohibited" | "unstated" }> = {
  Davidson: {
    url: "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Parcels_view/FeatureServer/0",
    publisher: "Metro Nashville (ArcGIS org owner 'Nashville')",
    terms: "Item licence: \"Metro's Open Data Executive Order provides the policy and guidance governing the portal\" — the order itself was not read in this pass.",
    commercialUse: "unstated",
  },
};

async function getJson(url: string): Promise<any> {
  const res = await fetchGeo(url, { timeoutMs: 60_000, ratePerSec: 2 });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

async function main() {
  // 1. Counties.
  const counties = await getJson(
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query?" +
      new URLSearchParams({
        where: "STATE='47'",
        outFields: "GEOID,BASENAME",
        returnGeometry: "true",
        outSR: "4326",
        maxAllowableOffset: "0.01",
        geometryPrecision: "3",
        f: "geojson",
      }),
  );
  const list: Array<{ fips: string; name: string; geometry: any }> = counties.features.map((f: any) => ({
    fips: String(f.properties.GEOID),
    name: String(f.properties.BASENAME),
    geometry: f.geometry,
  }));
  if (list.length !== 95) throw new Error(`expected 95 Tennessee counties, TIGERweb returned ${list.length}`);

  // 3. Rows.
  const rows: any[] = [];
  for (const c of list.sort((a, b) => a.name.localeCompare(b.name))) {
    const selfMaintained = (TN_SELF_MAINTAINED_COUNTIES as readonly string[]).includes(c.name);
    const sources: any[] = [];
    if (!selfMaintained) {
      sources.push({
        kind: "state_download",
        publisher: "Tennessee Comptroller of the Treasury",
        url: TN_COMPTROLLER_DOWNLOAD.pageUrl,
        licenseSource: TN_COMPTROLLER_DOWNLOAD.licenseSource,
        commercialUse: "permitted",
        mayStore: true,
        automatedDownload: false,
        terms: `"${TN_COMPTROLLER_DOWNLOAD.termsQuote}" Per-county shapefile via a request form; no automated or recurring extracts.`,
        verification: "terms_read",
        checkedOn: today,
      });
    }
    if (selfMaintained) {
      const reviewed = REVIEWED[c.name];
      if (reviewed) {
        const cnt = await getJson(`${reviewed.url}/query?where=1%3D1&returnCountOnly=true&f=json`);
        sources.push({
          kind: "county_service",
          publisher: reviewed.publisher,
          url: reviewed.url,
          commercialUse: reviewed.commercialUse,
          mayStore: false,
          automatedDownload: true,
          terms: reviewed.terms,
          verification: "verified_live",
          liveParcelCount: Number(cnt.count ?? 0),
          checkedOn: today,
        });
      } else {
        const q = `${c.name} County Tennessee parcels type:"Feature Service"`;
        const found = await getJson(`https://www.arcgis.com/sharing/rest/search?num=5&f=json&q=${encodeURIComponent(q)}`);
        for (const r of (found.results ?? []).slice(0, 5)) {
          // A blocked source (founder decision 2026-10-11) is never a candidate.
          if (!r.url || blockedOutboundSource(String(r.url))) continue;
          if (!/parcel/i.test(String(r.title))) continue;
          sources.push({
            kind: "county_service",
            publisher: `ArcGIS Online owner "${r.owner}" (not confirmed as the county)`,
            url: String(r.url),
            commercialUse: "unstated",
            mayStore: false,
            automatedDownload: true,
            terms: "not reviewed",
            verification: "unverified",
            checkedOn: today,
          });
        }
      }
    }
    const storable = sources.some((s) => s.mayStore);
    const verifiedLookup = sources.some((s) => s.verification === "verified_live");
    rows.push({
      state: "TN",
      countyFips: c.fips,
      county: c.name,
      maintainedBy: selfMaintained ? "county" : "state",
      coverage: storable ? "storable_with_manual_download" : verifiedLookup ? "lookup_only" : sources.length ? "unverified_candidates" : "no_source_found",
      sources,
    });
  }

  writeFileSync("shared/landData/countySourceCensus.tn.json", JSON.stringify({ state: "TN", builtOn: today, rows }, null, 1) + "\n");
  writeFileSync(
    "shared/landData/tnCountyBoundaries.json",
    JSON.stringify({
      type: "FeatureCollection",
      source: "US Census Bureau TIGERweb State_County (simplified ~1 km for display only)",
      retrievedOn: today,
      features: list.map((c) => ({ type: "Feature", properties: { fips: c.fips, name: c.name }, geometry: c.geometry })),
    }) + "\n",
  );
  const tally = rows.reduce((m: Record<string, number>, r) => ((m[r.coverage] = (m[r.coverage] ?? 0) + 1), m), {});
  console.log(`wrote ${rows.length} TN counties`, tally);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
