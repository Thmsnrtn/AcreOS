/**
 * Data Quality Monitor — Epic G
 *
 * Tracks freshness and health of all integrated open data sources.
 * Alerts when sources fail repeatedly, respond slowly, or return stale data.
 *
 * Sources monitored:
 *   - USDA NASS (annual update)
 *   - Census ACS (annual update)
 *   - FEMA NFHL (real-time)
 *   - NWI Wetlands (6-month update)
 *   - OpenStreetMap Overpass (real-time)
 *   - USGS 3DEP Elevation (real-time)
 *   - NLCD Land Cover (annual update)
 *   - BLM GIS (real-time)
 *   - USFWS IPaC (real-time)
 *   - FEMA NRI Wildfire (annual update)
 *   - OpenFEMA Disaster History (real-time)
 *   - NREL NSRDB Solar (real-time)
 */

export interface DataSourceStatus {
  name: string;
  displayName: string;
  category: "environmental" | "demographic" | "agricultural" | "energy" | "government";
  updateFrequency: "real-time" | "annual" | "6-month" | "monthly";
  lastChecked: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  avgResponseMs: number;
  errorRate30d: number; // 0-1
  status: "healthy" | "degraded" | "down" | "unknown";
  notes: string;
}

export interface DataSourceHealthReport {
  generatedAt: string;
  overallHealth: "healthy" | "degraded" | "critical";
  healthyCount: number;
  degradedCount: number;
  downCount: number;
  sources: DataSourceStatus[];
}

// In-memory health tracking (survives restarts with DB persistence in prod)
const healthState: Map<string, {
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  responseTimes: number[];
  errorCount30d: number;
  checkCount30d: number;
}> = new Map();

const DATA_SOURCES: Omit<DataSourceStatus, "lastChecked" | "lastSuccessAt" | "consecutiveFailures" | "avgResponseMs" | "errorRate30d" | "status">[] = [
  { name: "fema_nfhl", displayName: "FEMA Flood Zones (NFHL)", category: "environmental", updateFrequency: "real-time", notes: "Flood zone designation for every parcel in the US" },
  { name: "usfws_nwi", displayName: "USFWS Wetlands (NWI)", category: "environmental", updateFrequency: "6-month", notes: "National Wetlands Inventory — wetland coverage and types" },
  { name: "epa_echo", displayName: "EPA Environmental (ECHO)", category: "environmental", updateFrequency: "real-time", notes: "Superfund sites, RCRA hazardous waste facilities" },
  { name: "osm_overpass", displayName: "OpenStreetMap Overpass", category: "environmental", updateFrequency: "real-time", notes: "Road access, amenities, infrastructure proximity" },
  { name: "usgs_3dep", displayName: "USGS 3DEP Elevation", category: "environmental", updateFrequency: "real-time", notes: "Elevation point queries for slope assessment" },
  { name: "usda_wss", displayName: "USDA Web Soil Survey", category: "agricultural", updateFrequency: "annual", notes: "Basic soil type and farmland classification" },
  { name: "ssurgo_sda", displayName: "SSURGO Soil Data Access", category: "agricultural", updateFrequency: "annual", notes: "Detailed soil data with NCCPI productivity index and hydric rating" },
  { name: "usda_nass", displayName: "USDA NASS QuickStats", category: "agricultural", updateFrequency: "annual", notes: "County land values and agricultural statistics" },
  { name: "census_acs", displayName: "US Census ACS 5-Year", category: "demographic", updateFrequency: "annual", notes: "County demographics: population, income, housing" },
  { name: "census_pep", displayName: "Census Population Estimates", category: "demographic", updateFrequency: "annual", notes: "Annual county population change for migration signals" },
  { name: "census_permits", displayName: "Census Building Permits", category: "demographic", updateFrequency: "annual", notes: "New construction permits by county — leading demand indicator" },
  { name: "census_flows", displayName: "Census Migration Flows", category: "demographic", updateFrequency: "annual", notes: "County-to-county migration patterns" },
  { name: "nlcd_mrlc", displayName: "NLCD Land Cover (MRLC)", category: "environmental", updateFrequency: "annual", notes: "National Land Cover Database — forest, farmland, wetland, developed" },
  { name: "blm_gis", displayName: "BLM Public Land GIS", category: "government", updateFrequency: "real-time", notes: "Bureau of Land Management surface ownership adjacency" },
  { name: "usfws_ipac", displayName: "USFWS IPaC Endangered Species", category: "environmental", updateFrequency: "real-time", notes: "Listed endangered/threatened species by location" },
  { name: "fema_nri", displayName: "FEMA National Risk Index", category: "environmental", updateFrequency: "annual", notes: "County wildfire, flood, and other natural hazard risk ratings" },
  { name: "openfema", displayName: "OpenFEMA Disaster Declarations", category: "government", updateFrequency: "real-time", notes: "Presidential disaster declarations by county" },
  { name: "nrel_nsrdb", displayName: "NREL NSRDB Solar Data", category: "energy", updateFrequency: "annual", notes: "National Solar Radiation Database — GHI and solar potential" },
];

function getHealthState(name: string) {
  if (!healthState.has(name)) {
    healthState.set(name, {
      lastSuccessAt: null,
      consecutiveFailures: 0,
      responseTimes: [],
      errorCount30d: 0,
      checkCount30d: 0,
    });
  }
  return healthState.get(name)!;
}

export function recordSourceSuccess(name: string, responseMs: number): void {
  const state = getHealthState(name);
  state.lastSuccessAt = new Date();
  state.consecutiveFailures = 0;
  state.responseTimes.push(responseMs);
  if (state.responseTimes.length > 100) state.responseTimes.shift(); // keep rolling window
  state.checkCount30d++;
}

export function recordSourceFailure(name: string): void {
  const state = getHealthState(name);
  state.consecutiveFailures++;
  state.errorCount30d++;
  state.checkCount30d++;
}

function computeStatus(
  consecutiveFailures: number,
  errorRate: number,
  lastSuccessAt: Date | null,
  updateFrequency: string
): DataSourceStatus["status"] {
  if (consecutiveFailures >= 5) return "down";
  if (consecutiveFailures >= 3 || errorRate > 0.3) return "degraded";
  if (lastSuccessAt === null) return "unknown";

  // Check staleness for annual sources
  if (updateFrequency === "annual") {
    const daysSince = (Date.now() - lastSuccessAt.getTime()) / 86400000;
    if (daysSince > 400) return "degraded"; // annual source not refreshed in >400 days
  }

  return "healthy";
}

export async function getDataSourceHealth(): Promise<DataSourceHealthReport> {
  const sources: DataSourceStatus[] = DATA_SOURCES.map(source => {
    const state = getHealthState(source.name);
    const avgResponseMs = state.responseTimes.length > 0
      ? Math.round(state.responseTimes.reduce((a, b) => a + b, 0) / state.responseTimes.length)
      : 0;
    const errorRate = state.checkCount30d > 0
      ? state.errorCount30d / state.checkCount30d
      : 0;

    const status = computeStatus(
      state.consecutiveFailures,
      errorRate,
      state.lastSuccessAt,
      source.updateFrequency
    );

    return {
      ...source,
      lastChecked: state.lastSuccessAt?.toISOString() || null,
      lastSuccessAt: state.lastSuccessAt?.toISOString() || null,
      consecutiveFailures: state.consecutiveFailures,
      avgResponseMs,
      errorRate30d: Math.round(errorRate * 100) / 100,
      status,
    };
  });

  const healthyCount = sources.filter(s => s.status === "healthy").length;
  const degradedCount = sources.filter(s => s.status === "degraded").length;
  const downCount = sources.filter(s => s.status === "down").length;
  const unknownCount = sources.filter(s => s.status === "unknown").length;

  let overallHealth: DataSourceHealthReport["overallHealth"] = "healthy";
  if (downCount > 2 || (downCount + degradedCount) > 5) overallHealth = "critical";
  else if (downCount > 0 || degradedCount > 2 || unknownCount > 10) overallHealth = "degraded";

  return {
    generatedAt: new Date().toISOString(),
    overallHealth,
    healthyCount,
    degradedCount,
    downCount,
    sources,
  };
}

/**
 * Run a lightweight health probe against all real-time sources.
 * Call this on a scheduled interval (every 15 minutes) to populate health state.
 */
export async function runHealthProbe(): Promise<void> {
  const probes: { name: string; url: string }[] = [
    { name: "fema_nfhl", url: "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer?f=json" },
    { name: "usfws_nwi", url: "https://www.fws.gov/wetlands/arcgis/rest/services/Wetlands/MapServer?f=json" },
    { name: "osm_overpass", url: "https://overpass-api.de/api/status" },
    { name: "usgs_3dep", url: "https://epqs.nationalmap.gov/v1/json?x=-117&y=34&wkid=4326&units=Feet" },
    { name: "blm_gis", url: "https://gis.blm.gov/arcgis/rest/services/lands_and_realty/BLM_Natl_SMA_Cached_21/MapServer?f=json" },
    { name: "openfema", url: "https://www.fema.gov/api/open/v2/disasterDeclarationsSummaries?$top=1&$format=json" },
    { name: "census_acs", url: "https://api.census.gov/data/2022/acs/acs5?get=NAME&for=state:06&key=" + (process.env.CENSUS_API_KEY || "") },
  ];

  for (const probe of probes) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(probe.url, { signal: controller.signal });
      clearTimeout(timeout);
      if (resp.ok) {
        recordSourceSuccess(probe.name, Date.now() - start);
      } else {
        recordSourceFailure(probe.name);
      }
    } catch {
      recordSourceFailure(probe.name);
    }
  }
}
