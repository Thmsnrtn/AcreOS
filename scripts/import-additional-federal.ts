import { db } from "../server/db";
import { dataSources } from "../shared/schema";
import { sql } from "drizzle-orm";
import * as crypto from "crypto";

interface DataSourceInput {
  key: string;
  title: string;
  category: string;
  subcategory: string;
  description: string;
  apiUrl: string;
  coverage: string;
  accessLevel: "free" | "freemium" | "paid";
  priority: number;
}

function generateKey(url: string, prefix: string): string {
  const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
  return `${prefix}_${hash}`;
}

async function importSources(sources: DataSourceInput[], categoryName: string) {
  console.log(`\nImporting ${sources.length} ${categoryName} sources...`);
  
  let inserted = 0;
  let skipped = 0;
  
  for (const source of sources) {
    try {
      await db.insert(dataSources).values({
        ...source,
        isEnabled: true
      });
      inserted++;
    } catch (error: any) {
      if (error.message?.includes('duplicate')) {
        skipped++;
      }
    }
  }
  
  console.log(`  Inserted: ${inserted}, Skipped: ${skipped}`);
  return { inserted, skipped };
}

// The National Map (TNM) Services
const tnmSources: DataSourceInput[] = [
  { key: generateKey("tnm_topo", "tnm"), title: "USGS Topographic Map", category: "basemaps", subcategory: "topographic", description: "USGS topographic basemap tiles", apiUrl: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("tnm_imagery", "tnm"), title: "USGS Imagery Only", category: "basemaps", subcategory: "imagery", description: "USGS orthoimagery basemap", apiUrl: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("tnm_imagery_topo", "tnm"), title: "USGS Imagery Topo", category: "basemaps", subcategory: "imagery", description: "USGS imagery with topo overlay", apiUrl: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("tnm_hydro", "tnm"), title: "USGS Hydro Cached", category: "water_resources", subcategory: "hydrography", description: "National hydrography dataset", apiUrl: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("tnm_shaded", "tnm"), title: "USGS Shaded Relief", category: "topographic", subcategory: "elevation", description: "Shaded relief hillshade", apiUrl: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("tnm_boundaries", "tnm"), title: "USGS Governmental Boundaries", category: "administrative", subcategory: "boundaries", description: "State and county boundaries", apiUrl: "https://services.nationalmap.gov/arcgis/rest/services/govunits/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("tnm_structures", "tnm"), title: "USGS Structures", category: "infrastructure", subcategory: "structures", description: "Buildings and structures", apiUrl: "https://services.nationalmap.gov/arcgis/rest/services/structures/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("tnm_transportation", "tnm"), title: "USGS Transportation", category: "transportation", subcategory: "roads", description: "Roads and transportation network", apiUrl: "https://services.nationalmap.gov/arcgis/rest/services/transportation/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
];

// USGS Earthquake Services
const earthquakeSources: DataSourceInput[] = [
  { key: generateKey("eq_30day", "usgs_eq"), title: "USGS 30 Day Significant Earthquakes", category: "natural_hazards", subcategory: "seismic", description: "Significant earthquakes last 30 days", apiUrl: "https://earthquake.usgs.gov/arcgis/rest/services/eq/event_30DaySignificant/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("eq_7day", "usgs_eq"), title: "USGS 7 Day All Earthquakes", category: "natural_hazards", subcategory: "seismic", description: "All earthquakes last 7 days", apiUrl: "https://earthquake.usgs.gov/arcgis/rest/services/eq/event_7DayAll/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("eq_1day", "usgs_eq"), title: "USGS 1 Day All Earthquakes", category: "natural_hazards", subcategory: "seismic", description: "All earthquakes last 24 hours", apiUrl: "https://earthquake.usgs.gov/arcgis/rest/services/eq/event_1DayAll/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("eq_faults", "usgs_eq"), title: "USGS Quaternary Faults", category: "natural_hazards", subcategory: "seismic", description: "Known earthquake fault lines", apiUrl: "https://earthquake.usgs.gov/arcgis/rest/services/haz/Qfaults/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("eq_hazard", "usgs_eq"), title: "USGS Seismic Hazard Map", category: "natural_hazards", subcategory: "seismic", description: "Seismic hazard probability", apiUrl: "https://earthquake.usgs.gov/arcgis/rest/services/haz/hazmap2014/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
];

// Additional USGS Services
const usgsAdditional: DataSourceInput[] = [
  { key: generateKey("usgs_padus_fee", "usgs"), title: "USGS PAD-US Fee Manager", category: "public_lands", subcategory: "protected_areas", description: "Protected areas fee management data", apiUrl: "https://gis1.usgs.gov/arcgis/rest/services/padus3/PADUS3_Fee_Manager/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("usgs_padus_designation", "usgs"), title: "USGS PAD-US Designation", category: "public_lands", subcategory: "protected_areas", description: "Protected area designations", apiUrl: "https://gis1.usgs.gov/arcgis/rest/services/padus3/PADUS3_Designation/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("usgs_nfhp", "usgs"), title: "USGS National Fish Habitat", category: "environmental", subcategory: "wildlife", description: "Fish habitat partnership data", apiUrl: "https://gis1.usgs.gov/arcgis/rest/services/nfhp2015/nfhp_2015/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("usgs_minerals", "usgs"), title: "USGS Mineral Resources", category: "mineral_subsurface", subcategory: "minerals", description: "US mineral resource mapping", apiUrl: "https://gis1.usgs.gov/arcgis/rest/services/usminmap/USMinMap/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
];

// NOAA Services
const noaaSources: DataSourceInput[] = [
  { key: generateKey("noaa_nws_zones", "noaa"), title: "NOAA NWS Forecast Zones", category: "natural_hazards", subcategory: "weather", description: "National Weather Service zones", apiUrl: "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("noaa_radar", "noaa"), title: "NOAA Weather Radar", category: "natural_hazards", subcategory: "weather", description: "Live radar imagery", apiUrl: "https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("noaa_marine", "noaa"), title: "NOAA Marine Zones", category: "natural_hazards", subcategory: "marine", description: "Coastal and marine zones", apiUrl: "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/marine_zones/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("noaa_coastal", "noaa"), title: "NOAA Coastal Flood", category: "natural_hazards", subcategory: "flood", description: "Coastal flood mapping", apiUrl: "https://coast.noaa.gov/arcgis/rest/services/FloodExposureMapper/CFEM_CoastalFloodHazardComposite/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("noaa_slr", "noaa"), title: "NOAA Sea Level Rise", category: "environmental", subcategory: "climate", description: "Sea level rise projections", apiUrl: "https://coast.noaa.gov/arcgis/rest/services/dc_slr/slr_0ft/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("noaa_benthic", "noaa"), title: "NOAA Coastal Benthic Habitats", category: "environmental", subcategory: "marine", description: "Benthic habitat mapping", apiUrl: "https://coast.noaa.gov/arcgis/rest/services/MarineCadastre/NationalViewer/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
];

// DOT Transportation Services
const dotSources: DataSourceInput[] = [
  { key: generateKey("dot_nhpn", "dot"), title: "DOT National Highway Network", category: "transportation", subcategory: "highways", description: "National highway planning network", apiUrl: "https://geo.dot.gov/server/rest/services/Hosted/National_Highway_Planning_Network_NHPN/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("dot_hpms", "dot"), title: "DOT Highway Performance", category: "transportation", subcategory: "highways", description: "Highway performance monitoring", apiUrl: "https://geo.dot.gov/server/rest/services/Hosted/Highway_Performance_Monitoring_System_HPMS/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("dot_intermodal", "dot"), title: "DOT Intermodal Terminals", category: "transportation", subcategory: "intermodal", description: "Intermodal freight terminals", apiUrl: "https://geo.dot.gov/server/rest/services/Hosted/Intermodal_Passenger_Connectivity_Database_IPCD/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("dot_rail", "dot"), title: "DOT Railroad Network", category: "transportation", subcategory: "rail", description: "North American rail network", apiUrl: "https://geo.dot.gov/server/rest/services/Hosted/North_American_Rail_Network_Lines/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("dot_fatality", "dot"), title: "DOT Traffic Fatality Analysis", category: "transportation", subcategory: "safety", description: "FARS crash data locations", apiUrl: "https://geo.dot.gov/server/rest/services/Hosted/FARS/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
];

// FAA Aviation Services
const faaSources: DataSourceInput[] = [
  { key: generateKey("faa_airports", "faa"), title: "FAA Airports", category: "transportation", subcategory: "aviation", description: "Airport facility locations", apiUrl: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("faa_runways", "faa"), title: "FAA Runways", category: "transportation", subcategory: "aviation", description: "Airport runway data", apiUrl: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Runway/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("faa_airspace", "faa"), title: "FAA Airspace Classes", category: "transportation", subcategory: "aviation", description: "Airspace classification zones", apiUrl: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airspace_Classes/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
];

// FCC Communications
const fccSources: DataSourceInput[] = [
  { key: generateKey("fcc_broadband", "fcc"), title: "FCC Broadband Map", category: "infrastructure", subcategory: "communications", description: "Broadband availability data", apiUrl: "https://broadbandmap.fcc.gov/api/", coverage: "US", accessLevel: "free", priority: 1 },
];

// CDC Health Data
const cdcSources: DataSourceInput[] = [
  { key: generateKey("cdc_places", "cdc"), title: "CDC PLACES Health Data", category: "demographics", subcategory: "health", description: "Local health outcomes by tract", apiUrl: "https://data.cdc.gov/resource/cwsq-ngmh.json", coverage: "US", accessLevel: "free", priority: 2 },
];

// FHWA Highway Data
const fhwaSources: DataSourceInput[] = [
  { key: generateKey("fhwa_nbi_bridges", "fhwa"), title: "FHWA National Bridge Inventory", category: "infrastructure", subcategory: "bridges", description: "Bridge condition and inventory", apiUrl: "https://geo.dot.gov/server/rest/services/Hosted/National_Bridge_Inventory_NBI/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
];

// Esri/Living Atlas National Layers
const livingAtlasSources: DataSourceInput[] = [
  { key: generateKey("la_usa_counties", "esri"), title: "Esri USA Counties", category: "administrative", subcategory: "boundaries", description: "US county boundaries generalized", apiUrl: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Counties_Generalized/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("la_usa_states", "esri"), title: "Esri USA States", category: "administrative", subcategory: "boundaries", description: "US state boundaries generalized", apiUrl: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_States_Generalized/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("la_usa_census_tracts", "esri"), title: "Esri USA Census Tracts", category: "census_boundaries", subcategory: "tracts", description: "Census tract boundaries", apiUrl: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Tracts/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("la_usa_zip", "esri"), title: "Esri USA ZIP Codes", category: "census_boundaries", subcategory: "postal", description: "ZIP code boundaries", apiUrl: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_ZIP_Codes/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("la_usa_congressional", "esri"), title: "Esri USA Congressional Districts", category: "administrative", subcategory: "legislative", description: "Congressional district boundaries", apiUrl: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_118th_Congressional_Districts/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("la_usa_major_cities", "esri"), title: "Esri USA Major Cities", category: "administrative", subcategory: "places", description: "Major US city points", apiUrl: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Major_Cities/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("la_world_urban", "esri"), title: "Esri World Urban Areas", category: "land_cover", subcategory: "urban", description: "Global urban area extents", apiUrl: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Urban_Areas/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
];

async function main() {
  console.log("=== Additional Federal Sources Import ===\n");
  
  const startCount = await db.select({ count: sql`count(*)` }).from(dataSources);
  console.log(`Starting count: ${startCount[0].count}`);
  
  let totalInserted = 0;
  let totalSkipped = 0;
  
  const categories = [
    { sources: tnmSources, name: "The National Map" },
    { sources: earthquakeSources, name: "USGS Earthquake" },
    { sources: usgsAdditional, name: "USGS Additional" },
    { sources: noaaSources, name: "NOAA" },
    { sources: dotSources, name: "DOT Transportation" },
    { sources: faaSources, name: "FAA Aviation" },
    { sources: fccSources, name: "FCC Communications" },
    { sources: cdcSources, name: "CDC Health" },
    { sources: fhwaSources, name: "FHWA Bridges" },
    { sources: livingAtlasSources, name: "Esri Living Atlas" },
  ];
  
  for (const cat of categories) {
    const result = await importSources(cat.sources, cat.name);
    totalInserted += result.inserted;
    totalSkipped += result.skipped;
  }
  
  const endCount = await db.select({ count: sql`count(*)` }).from(dataSources);
  
  console.log("\n=== SUMMARY ===");
  console.log(`Total inserted: ${totalInserted}`);
  console.log(`Total skipped: ${totalSkipped}`);
  console.log(`New total: ${endCount[0].count}`);
}

main()
  .then(() => {
    console.log("\nDone!");
    process.exit(0);
  })
  .catch(err => {
    console.error("Error:", err);
    process.exit(1);
  });
