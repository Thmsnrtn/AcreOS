/**
 * Data Source Verification Script
 * Probes all 18 open data sources and reports health status.
 * Usage: npx tsx scripts/verify-data-sources.ts
 */

interface ProbeResult {
  name: string;
  category: string;
  url: string;
  status: "PASS" | "FAIL";
  statusCode: number | null;
  latencyMs: number;
  error?: string;
}

const DATA_SOURCES = [
  { name: "FEMA Flood Hazard Layer", category: "flood_zone", probeUrl: "https://hazards.fema.gov/gis/nfhl/rest/services?f=json" },
  { name: "USFWS National Wetlands Inventory", category: "wetlands", probeUrl: "https://fwsprimary.wim.usgs.gov/server/rest/services/Wetlands/MapServer?f=json" },
  { name: "USDA NRCS Soil Survey", category: "soil", probeUrl: "https://sdmdataaccess.sc.egov.usda.gov/" },
  { name: "EPA Envirofacts/TRI", category: "environmental", probeUrl: "https://data.epa.gov/efservice/tri_facility/rows/1:1/JSON" },
  { name: "USGS Earthquake Hazards", category: "natural_hazards", probeUrl: "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=1" },
  { name: "Census Geocoder", category: "demographics", probeUrl: "https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=-97.743&y=30.267&benchmark=Public_AR_Current&vintage=Current_Current&format=json" },
  { name: "Census ACS Demographics", category: "demographics", probeUrl: "https://api.census.gov/data/2022/acs/acs5?get=NAME&for=state:48" },
  { name: "BLM Surface Management", category: "public_lands", probeUrl: "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer?f=json" },
  { name: "USGS Elevation (EPQS)", category: "elevation", probeUrl: "https://epqs.nationalmap.gov/v1/json?x=-97.743&y=30.267&units=Feet&wkid=4326" },
  { name: "Open-Meteo Climate", category: "climate", probeUrl: "https://climate-api.open-meteo.com/v1/climate?latitude=30.267&longitude=-97.743&start_date=2020-01-01&end_date=2020-01-02&daily=temperature_2m_mean" },
  { name: "HIFLD Hospitals", category: "infrastructure", probeUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Hospitals_1/FeatureServer/0?f=json" },
  { name: "HIFLD Fire Stations", category: "infrastructure", probeUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Fire_Stations/FeatureServer/0?f=json" },
  { name: "DOT Highway Network", category: "transportation", probeUrl: "https://geo.dot.gov/server/rest/services?f=json" },
  { name: "USGS Water Services", category: "water_resources", probeUrl: "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=08158000&parameterCd=00060&period=PT1H" },
  { name: "USDA Agricultural Values", category: "agricultural_values", probeUrl: "https://quickstats.nass.usda.gov/" },
  { name: "MRLC NLCD Land Cover", category: "land_cover", probeUrl: "https://landscape11.arcgis.com/arcgis/rest/services/USA_NLCD_Land_Cover/ImageServer?f=json" },
  { name: "BLM PLSS Cadastral", category: "plss", probeUrl: "https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer?f=json" },
  { name: "FEMA National Risk Index", category: "fema_nri", probeUrl: "https://hazards.fema.gov/nri/rest/services/NRI/MapServer?f=json" },
];

async function probeSource(source: typeof DATA_SOURCES[0]): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const response = await fetch(source.probeUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "AcreOS Data Source Verifier" },
    });
    const latency = Date.now() - start;
    return {
      name: source.name,
      category: source.category,
      url: source.probeUrl,
      status: response.ok ? "PASS" : "FAIL",
      statusCode: response.status,
      latencyMs: latency,
      error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`,
    };
  } catch (err: any) {
    return {
      name: source.name,
      category: source.category,
      url: source.probeUrl,
      status: "FAIL",
      statusCode: null,
      latencyMs: Date.now() - start,
      error: err.message || "Connection failed",
    };
  }
}

async function main() {
  console.log("=== AcreOS Data Source Verification ===\n");
  console.log(`Testing ${DATA_SOURCES.length} open data sources...\n`);

  const results: ProbeResult[] = [];

  for (const source of DATA_SOURCES) {
    const result = await probeSource(source);
    results.push(result);
    const icon = result.status === "PASS" ? "\u2713" : "\u2717";
    const statusStr = result.statusCode ? `${result.statusCode}` : "ERR";
    console.log(
      `  ${icon} ${result.name.padEnd(40)} ${statusStr.padEnd(5)} ${result.latencyMs}ms${result.error ? ` — ${result.error}` : ""}`
    );
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log(`\n=== Summary ===`);
  console.log(`  Passed: ${passed}/${results.length}`);
  console.log(`  Failed: ${failed}/${results.length}`);
  console.log(`  Avg Latency: ${Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length)}ms`);

  // Write markdown report
  const fs = await import("fs");
  const path = await import("path");
  const docsDir = path.join(process.cwd(), "docs");
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

  const md = [
    `# Data Source Verification Report`,
    ``,
    `**Date:** ${new Date().toISOString()}`,
    `**Sources Tested:** ${results.length}`,
    `**Passed:** ${passed} | **Failed:** ${failed}`,
    ``,
    `## Results`,
    ``,
    `| Status | Source | Category | HTTP | Latency | Error |`,
    `|--------|--------|----------|------|---------|-------|`,
    ...results.map((r) =>
      `| ${r.status === "PASS" ? "PASS" : "**FAIL**"} | ${r.name} | ${r.category} | ${r.statusCode || "-"} | ${r.latencyMs}ms | ${r.error || "-"} |`
    ),
    ``,
    `## Failed Sources`,
    ``,
    ...results
      .filter((r) => r.status === "FAIL")
      .map((r) => `- **${r.name}** (${r.category}): ${r.error}\n  URL: \`${r.url}\``),
    ...(failed === 0 ? ["_All sources passed._"] : []),
    ``,
  ].join("\n");

  fs.writeFileSync(path.join(docsDir, "data-source-verification.md"), md);
  console.log(`\nReport written to docs/data-source-verification.md`);

  if (failed > 0) {
    console.log(`\nWARNING: ${failed} source(s) failed. Review the report for details.`);
  }
}

main().catch(console.error);
