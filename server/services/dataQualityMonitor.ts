/**
 * Data Quality Monitor — tracks health and availability of all 18 open data sources.
 * Provides probe URLs, health recording, and status reporting.
 */

export interface DataSourceEntry {
  name: string;
  category: string;
  probeUrl: string;
  expectedStatus: number;
  timeout: number;
}

export const DATA_SOURCES: DataSourceEntry[] = [
  {
    name: "FEMA Flood Hazard Layer",
    category: "flood_zone",
    probeUrl: "https://hazards.fema.gov/gis/nfhl/rest/services?f=json",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "USFWS National Wetlands Inventory",
    category: "wetlands",
    probeUrl: "https://fwsprimary.wim.usgs.gov/server/rest/services/Wetlands/MapServer?f=json",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "USDA NRCS Soil Survey",
    category: "soil",
    probeUrl: "https://sdmdataaccess.sc.egov.usda.gov/",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "EPA Envirofacts/TRI",
    category: "environmental",
    probeUrl: "https://data.epa.gov/efservice/tri_facility/rows/1:1/JSON",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "USGS Earthquake Hazards",
    category: "natural_hazards",
    probeUrl: "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=1",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "Census Geocoder",
    category: "demographics",
    probeUrl: "https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=-97.743&y=30.267&benchmark=Public_AR_Current&vintage=Current_Current&format=json",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "Census ACS Demographics",
    category: "demographics",
    probeUrl: "https://api.census.gov/data/2022/acs/acs5?get=NAME&for=state:48",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "BLM Surface Management",
    category: "public_lands",
    probeUrl: "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer?f=json",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "USGS Elevation (EPQS)",
    category: "elevation",
    probeUrl: "https://epqs.nationalmap.gov/v1/json?x=-97.743&y=30.267&units=Feet&wkid=4326",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "Open-Meteo Climate",
    category: "climate",
    probeUrl: "https://climate-api.open-meteo.com/v1/climate?latitude=30.267&longitude=-97.743&start_date=2020-01-01&end_date=2020-01-02&daily=temperature_2m_mean",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "HIFLD Hospitals",
    category: "infrastructure",
    probeUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Hospitals_1/FeatureServer/0?f=json",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "HIFLD Fire Stations",
    category: "infrastructure",
    probeUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Fire_Stations/FeatureServer/0?f=json",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "DOT Highway Network",
    category: "transportation",
    probeUrl: "https://geo.dot.gov/server/rest/services?f=json",
    expectedStatus: 200,
    timeout: 10000,
  },
  {
    name: "USGS Water Services",
    category: "water_resources",
    probeUrl: "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=08158000&parameterCd=00060&period=PT1H",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "USDA ERS Land Values",
    category: "agricultural_values",
    probeUrl: "https://quickstats.nass.usda.gov/",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "MRLC NLCD Land Cover",
    category: "land_cover",
    probeUrl: "https://landscape11.arcgis.com/arcgis/rest/services/USA_NLCD_Land_Cover/ImageServer?f=json",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "BLM PLSS Cadastral",
    category: "plss",
    probeUrl: "https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer?f=json",
    expectedStatus: 200,
    timeout: 5000,
  },
  {
    name: "FEMA National Risk Index",
    category: "fema_nri",
    probeUrl: "https://hazards.fema.gov/nri/rest/services/NRI/MapServer?f=json",
    expectedStatus: 200,
    timeout: 5000,
  },
];

export interface SourceHealthRecord {
  name: string;
  category: string;
  status: "up" | "down" | "degraded";
  statusCode: number | null;
  latencyMs: number;
  lastChecked: Date;
  error?: string;
}

const healthHistory: Map<string, SourceHealthRecord[]> = new Map();

const consecutiveDataSourceFailures = new Map<string, number>();

export function recordSourceFailure(name: string, error: string, latencyMs: number): void {
  const entry = DATA_SOURCES.find((s) => s.name === name);
  if (!entry) return;
  const record: SourceHealthRecord = {
    name,
    category: entry.category,
    status: "down",
    statusCode: null,
    latencyMs,
    lastChecked: new Date(),
    error,
  };
  const history = healthHistory.get(name) || [];
  history.push(record);
  if (history.length > 100) history.shift();
  healthHistory.set(name, history);

  // Track consecutive failures and alert after 3
  const failures = (consecutiveDataSourceFailures.get(name) || 0) + 1;
  consecutiveDataSourceFailures.set(name, failures);
  if (failures === 3) {
    import("../storage").then(({ storage }) => {
      storage.createSystemAlert({
        type: "data_source_down",
        alertType: "data_source_down",
        severity: "warning",
        title: `Data source down: ${name}`,
        message: `${name} has failed 3 consecutive health checks. Last error: ${error}`,
        status: "new",
        metadata: { sourceName: name, category: entry.category, error, consecutiveFailures: failures },
      }).catch(() => {});
    }).catch(() => {});
  }
}

export function recordSourceSuccess(name: string, latencyMs: number): void {
  const entry = DATA_SOURCES.find((s) => s.name === name);
  if (!entry) return;

  // Reset consecutive failure count on success
  consecutiveDataSourceFailures.delete(name);

  const record: SourceHealthRecord = {
    name,
    category: entry.category,
    status: latencyMs > 3000 ? "degraded" : "up",
    statusCode: 200,
    latencyMs,
    lastChecked: new Date(),
  };
  const history = healthHistory.get(name) || [];
  history.push(record);
  if (history.length > 100) history.shift();
  healthHistory.set(name, history);
}

export async function runHealthProbe(): Promise<SourceHealthRecord[]> {
  const results: SourceHealthRecord[] = [];

  for (const source of DATA_SOURCES) {
    const start = Date.now();
    try {
      const response = await fetch(source.probeUrl, {
        signal: AbortSignal.timeout(source.timeout),
        headers: { "User-Agent": "AcreOS Health Monitor" },
      });
      const latency = Date.now() - start;
      const record: SourceHealthRecord = {
        name: source.name,
        category: source.category,
        status: response.ok ? (latency > 3000 ? "degraded" : "up") : "down",
        statusCode: response.status,
        latencyMs: latency,
        lastChecked: new Date(),
      };
      if (response.ok) {
        recordSourceSuccess(source.name, latency);
      } else {
        recordSourceFailure(source.name, `HTTP ${response.status}`, latency);
      }
      results.push(record);
    } catch (err: any) {
      const latency = Date.now() - start;
      const record: SourceHealthRecord = {
        name: source.name,
        category: source.category,
        status: "down",
        statusCode: null,
        latencyMs: latency,
        lastChecked: new Date(),
        error: err.message || "Connection failed",
      };
      recordSourceFailure(source.name, err.message || "Connection failed", latency);
      results.push(record);
    }
  }

  return results;
}

export function getHealthHistory(): Map<string, SourceHealthRecord[]> {
  return healthHistory;
}

export function getLatestHealth(): SourceHealthRecord[] {
  return DATA_SOURCES.map((source) => {
    const history = healthHistory.get(source.name);
    if (!history || history.length === 0) {
      return {
        name: source.name,
        category: source.category,
        status: "down" as const,
        statusCode: null,
        latencyMs: 0,
        lastChecked: new Date(0),
      };
    }
    return history[history.length - 1];
  });
}
