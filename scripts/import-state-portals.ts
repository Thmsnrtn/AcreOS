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

// State-Level GIS Portal Aggregators
const statePortals: DataSourceInput[] = [
  // Major State Parcel Aggregators
  { key: generateKey("ny_parcels", "state"), title: "New York State Parcels", category: "state_parcels", subcategory: "parcels", description: "All 62 NY counties parcel data", apiUrl: "https://gisservices.its.ny.gov/arcgis/rest/services/", coverage: "NY", accessLevel: "free", priority: 1 },
  { key: generateKey("fl_parcels", "state"), title: "Florida DOT Parcels", category: "state_parcels", subcategory: "parcels", description: "Statewide Florida parcel data", apiUrl: "https://gis.fdot.gov/arcgis/rest/services/Parcels/FeatureServer", coverage: "FL", accessLevel: "free", priority: 1 },
  { key: generateKey("ca_geoportal", "state"), title: "California Geoportal", category: "state_gis", subcategory: "multi_layer", description: "California official geospatial data", apiUrl: "https://gis.data.ca.gov/", coverage: "CA", accessLevel: "free", priority: 1 },
  { key: generateKey("tx_tnris", "state"), title: "Texas TNRIS", category: "state_gis", subcategory: "multi_layer", description: "Texas Natural Resources Information System", apiUrl: "https://tnris.org/data/", coverage: "TX", accessLevel: "free", priority: 1 },
  
  // State GIS Portals A-M
  { key: generateKey("al_gis", "state"), title: "Alabama Open Data", category: "state_gis", subcategory: "multi_layer", description: "Alabama statewide GIS data", apiUrl: "https://open.alabama.gov/", coverage: "AL", accessLevel: "free", priority: 2 },
  { key: generateKey("ak_gis", "state"), title: "Alaska Geoportal", category: "state_gis", subcategory: "multi_layer", description: "Alaska statewide GIS data", apiUrl: "https://gis.data.alaska.gov/", coverage: "AK", accessLevel: "free", priority: 2 },
  { key: generateKey("az_gis", "state"), title: "Arizona AZGEO Clearinghouse", category: "state_gis", subcategory: "multi_layer", description: "Arizona GIS data clearinghouse", apiUrl: "https://azgeo.az.gov/", coverage: "AZ", accessLevel: "free", priority: 2 },
  { key: generateKey("ar_gis", "state"), title: "Arkansas GeoStor", category: "state_gis", subcategory: "multi_layer", description: "Arkansas GIS platform", apiUrl: "https://gis.arkansas.gov/", coverage: "AR", accessLevel: "free", priority: 2 },
  { key: generateKey("co_gis", "state"), title: "Colorado GIS Portal", category: "state_gis", subcategory: "multi_layer", description: "Colorado statewide GIS", apiUrl: "https://gis.colorado.gov/", coverage: "CO", accessLevel: "free", priority: 2 },
  { key: generateKey("ct_gis", "state"), title: "Connecticut GIS Portal", category: "state_gis", subcategory: "multi_layer", description: "Connecticut statewide GIS", apiUrl: "https://portal.ct.gov/gis", coverage: "CT", accessLevel: "free", priority: 2 },
  { key: generateKey("de_gis", "state"), title: "Delaware FirstMap", category: "state_gis", subcategory: "multi_layer", description: "Delaware GIS data hub", apiUrl: "https://firstmap.delaware.gov/", coverage: "DE", accessLevel: "free", priority: 2 },
  { key: generateKey("ga_gis", "state"), title: "Georgia Geospatial", category: "state_gis", subcategory: "multi_layer", description: "Georgia statewide GIS", apiUrl: "https://www.georgiageospatial.org/", coverage: "GA", accessLevel: "free", priority: 2 },
  { key: generateKey("hi_gis", "state"), title: "Hawaii Statewide GIS", category: "state_gis", subcategory: "multi_layer", description: "Hawaii GIS program", apiUrl: "https://geoportal.hawaii.gov/", coverage: "HI", accessLevel: "free", priority: 2 },
  { key: generateKey("id_gis", "state"), title: "Idaho INSIDE", category: "state_gis", subcategory: "multi_layer", description: "Idaho statewide GIS clearinghouse", apiUrl: "https://gis.idaho.gov/", coverage: "ID", accessLevel: "free", priority: 2 },
  { key: generateKey("il_gis", "state"), title: "Illinois Geospatial Clearinghouse", category: "state_gis", subcategory: "multi_layer", description: "Illinois statewide GIS", apiUrl: "https://clearinghouse.isgs.illinois.edu/", coverage: "IL", accessLevel: "free", priority: 2 },
  { key: generateKey("in_gis", "state"), title: "Indiana Map", category: "state_gis", subcategory: "multi_layer", description: "Indiana statewide GIS hub", apiUrl: "https://maps.indiana.edu/", coverage: "IN", accessLevel: "free", priority: 2 },
  { key: generateKey("ia_gis", "state"), title: "Iowa Geographic Data", category: "state_gis", subcategory: "multi_layer", description: "Iowa GIS data clearinghouse", apiUrl: "https://geodata.iowa.gov/", coverage: "IA", accessLevel: "free", priority: 2 },
  { key: generateKey("ks_gis", "state"), title: "Kansas Data Access", category: "state_gis", subcategory: "multi_layer", description: "Kansas GIS data access", apiUrl: "https://www.kansasgis.org/", coverage: "KS", accessLevel: "free", priority: 2 },
  { key: generateKey("ky_gis", "state"), title: "Kentucky KyGeoportal", category: "state_gis", subcategory: "multi_layer", description: "Kentucky GIS portal", apiUrl: "https://kygeoportal.ky.gov/", coverage: "KY", accessLevel: "free", priority: 2 },
  { key: generateKey("la_gis", "state"), title: "Louisiana Atlas", category: "state_gis", subcategory: "multi_layer", description: "Louisiana GIS mapping portal", apiUrl: "https://atlas.ga.lsu.edu/", coverage: "LA", accessLevel: "free", priority: 2 },
  { key: generateKey("me_gis", "state"), title: "Maine GeoLibrary", category: "state_gis", subcategory: "multi_layer", description: "Maine GIS data library", apiUrl: "https://www.maine.gov/geolib/", coverage: "ME", accessLevel: "free", priority: 2 },
  { key: generateKey("md_gis", "state"), title: "Maryland iMAP", category: "state_gis", subcategory: "multi_layer", description: "Maryland GIS data platform", apiUrl: "https://imap.maryland.gov/", coverage: "MD", accessLevel: "free", priority: 2 },
  { key: generateKey("ma_gis", "state"), title: "MassGIS", category: "state_gis", subcategory: "multi_layer", description: "Massachusetts GIS data", apiUrl: "https://www.mass.gov/orgs/massgis-bureau-of-geographic-information", coverage: "MA", accessLevel: "free", priority: 2 },
  { key: generateKey("mi_gis", "state"), title: "Michigan Open Data", category: "state_gis", subcategory: "multi_layer", description: "Michigan statewide GIS", apiUrl: "https://gis-michigan.opendata.arcgis.com/", coverage: "MI", accessLevel: "free", priority: 2 },
  { key: generateKey("mn_gis", "state"), title: "Minnesota Geospatial Commons", category: "state_gis", subcategory: "multi_layer", description: "Minnesota GIS data commons", apiUrl: "https://gisdata.mn.gov/", coverage: "MN", accessLevel: "free", priority: 2 },
  { key: generateKey("ms_gis", "state"), title: "Mississippi MARIS", category: "state_gis", subcategory: "multi_layer", description: "Mississippi GIS data", apiUrl: "https://www.maris.state.ms.us/", coverage: "MS", accessLevel: "free", priority: 2 },
  { key: generateKey("mo_gis", "state"), title: "Missouri MSDIS", category: "state_gis", subcategory: "multi_layer", description: "Missouri spatial data clearinghouse", apiUrl: "https://msdis.missouri.edu/", coverage: "MO", accessLevel: "free", priority: 2 },
  
  // State GIS Portals N-Z
  { key: generateKey("mt_gis", "state"), title: "Montana State Library GIS", category: "state_gis", subcategory: "multi_layer", description: "Montana GIS clearinghouse", apiUrl: "https://geoinfo.msl.mt.gov/", coverage: "MT", accessLevel: "free", priority: 2 },
  { key: generateKey("ne_gis", "state"), title: "Nebraska NESDI", category: "state_gis", subcategory: "multi_layer", description: "Nebraska spatial data infrastructure", apiUrl: "https://www.nebraskamap.gov/", coverage: "NE", accessLevel: "free", priority: 2 },
  { key: generateKey("nv_gis", "state"), title: "Nevada SNEDI", category: "state_gis", subcategory: "multi_layer", description: "Nevada spatial data infrastructure", apiUrl: "https://www.nevadanaturalresources.org/", coverage: "NV", accessLevel: "free", priority: 2 },
  { key: generateKey("nh_gis", "state"), title: "New Hampshire GRANIT", category: "state_gis", subcategory: "multi_layer", description: "NH geographically referenced analysis", apiUrl: "https://granit.unh.edu/", coverage: "NH", accessLevel: "free", priority: 2 },
  { key: generateKey("nj_gis", "state"), title: "New Jersey NJGIN", category: "state_gis", subcategory: "multi_layer", description: "NJ geographic information network", apiUrl: "https://njgin.nj.gov/", coverage: "NJ", accessLevel: "free", priority: 2 },
  { key: generateKey("nm_gis", "state"), title: "New Mexico RGIS", category: "state_gis", subcategory: "multi_layer", description: "NM resource GIS", apiUrl: "https://rgis.unm.edu/", coverage: "NM", accessLevel: "free", priority: 2 },
  { key: generateKey("nc_gis", "state"), title: "NC OneMap", category: "state_gis", subcategory: "multi_layer", description: "North Carolina GIS portal", apiUrl: "https://www.nconemap.gov/", coverage: "NC", accessLevel: "free", priority: 2 },
  { key: generateKey("nd_gis", "state"), title: "North Dakota Hub", category: "state_gis", subcategory: "multi_layer", description: "North Dakota data portal", apiUrl: "https://www.gis.nd.gov/", coverage: "ND", accessLevel: "free", priority: 2 },
  { key: generateKey("oh_gis", "state"), title: "Ohio GEOhio", category: "state_gis", subcategory: "multi_layer", description: "Ohio GIS data portal (40+ TB)", apiUrl: "https://geohio.ohio.gov/", coverage: "OH", accessLevel: "free", priority: 2 },
  { key: generateKey("ok_gis", "state"), title: "Oklahoma OKMaps", category: "state_gis", subcategory: "multi_layer", description: "Oklahoma GIS data", apiUrl: "https://www.okmaps.gov/", coverage: "OK", accessLevel: "free", priority: 2 },
  { key: generateKey("or_gis", "state"), title: "Oregon Spatial Data Library", category: "state_gis", subcategory: "multi_layer", description: "Oregon GIS data library", apiUrl: "https://spatialdata.oregonexplorer.info/", coverage: "OR", accessLevel: "free", priority: 2 },
  { key: generateKey("pa_gis", "state"), title: "Pennsylvania PASDA", category: "state_gis", subcategory: "multi_layer", description: "PA spatial data access", apiUrl: "https://www.pasda.psu.edu/", coverage: "PA", accessLevel: "free", priority: 2 },
  { key: generateKey("ri_gis", "state"), title: "Rhode Island RIGIS", category: "state_gis", subcategory: "multi_layer", description: "Rhode Island GIS data", apiUrl: "https://www.rigis.org/", coverage: "RI", accessLevel: "free", priority: 2 },
  { key: generateKey("sc_gis", "state"), title: "South Carolina GIS", category: "state_gis", subcategory: "multi_layer", description: "South Carolina GIS portal", apiUrl: "https://www.scdhec.gov/", coverage: "SC", accessLevel: "free", priority: 2 },
  { key: generateKey("sd_gis", "state"), title: "South Dakota GIS", category: "state_gis", subcategory: "multi_layer", description: "South Dakota GIS data", apiUrl: "https://sdbit.sd.gov/", coverage: "SD", accessLevel: "free", priority: 2 },
  { key: generateKey("tn_gis", "state"), title: "Tennessee GIS Data", category: "state_gis", subcategory: "multi_layer", description: "Tennessee GIS downloads", apiUrl: "https://www.tn.gov/environment/program-areas/data-gis.html", coverage: "TN", accessLevel: "free", priority: 2 },
  { key: generateKey("ut_gis", "state"), title: "Utah AGRC", category: "state_gis", subcategory: "multi_layer", description: "Utah automated geographic reference", apiUrl: "https://gis.utah.gov/", coverage: "UT", accessLevel: "free", priority: 2 },
  { key: generateKey("vt_gis", "state"), title: "Vermont GIS Data", category: "state_gis", subcategory: "multi_layer", description: "Vermont GIS program", apiUrl: "https://geodata.vermont.gov/", coverage: "VT", accessLevel: "free", priority: 2 },
  { key: generateKey("va_gis", "state"), title: "Virginia VGIN", category: "state_gis", subcategory: "multi_layer", description: "Virginia geographic information", apiUrl: "https://www.vita.virginia.gov/integrated-services/geographic-information-network-vgin/", coverage: "VA", accessLevel: "free", priority: 2 },
  { key: generateKey("wa_gis", "state"), title: "Washington Geospatial Open Data", category: "state_gis", subcategory: "multi_layer", description: "Washington state GIS data", apiUrl: "https://geo.wa.gov/", coverage: "WA", accessLevel: "free", priority: 2 },
  { key: generateKey("wv_gis", "state"), title: "West Virginia GIS", category: "state_gis", subcategory: "multi_layer", description: "West Virginia GIS data", apiUrl: "https://wvgis.wvu.edu/", coverage: "WV", accessLevel: "free", priority: 2 },
  { key: generateKey("wi_gis", "state"), title: "Wisconsin GIS Open Data", category: "state_gis", subcategory: "multi_layer", description: "Wisconsin DPI GIS data", apiUrl: "https://data-wi-dnr.opendata.arcgis.com/", coverage: "WI", accessLevel: "free", priority: 2 },
  { key: generateKey("wy_gis", "state"), title: "Wyoming WYGISC", category: "state_gis", subcategory: "multi_layer", description: "Wyoming GIS center", apiUrl: "https://www.wygisc.org/", coverage: "WY", accessLevel: "free", priority: 2 },
];

// Additional Specialty Sources
const specialtySources: DataSourceInput[] = [
  // Zoning
  { key: generateKey("zoning_atlas", "specialty"), title: "National Zoning Atlas", category: "zoning_land_use", subcategory: "zoning", description: "Standardized zoning classifications across states", apiUrl: "https://www.zoningatlas.org/", coverage: "US", accessLevel: "free", priority: 1 },
  
  // Air Quality
  { key: generateKey("airnow", "specialty"), title: "AirNow Air Quality Index", category: "environmental", subcategory: "air_quality", description: "Real-time air quality index data", apiUrl: "https://www.airnowapi.org/aq/", coverage: "US", accessLevel: "free", priority: 1 },
  
  // Living Atlas Layers
  { key: generateKey("esri_parcels", "specialty"), title: "Esri US Parcel Boundaries", category: "national_parcels", subcategory: "parcels", description: "Nationwide parcel boundaries via Living Atlas", apiUrl: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Parcels/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("esri_nlcd", "specialty"), title: "Esri NLCD Land Cover", category: "land_cover", subcategory: "classification", description: "National Land Cover Database imagery", apiUrl: "https://landscape10.arcgis.com/arcgis/rest/services/USA_NLCD_Land_Cover/ImageServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("esri_federal_lands", "specialty"), title: "Esri USA Federal Lands", category: "public_lands", subcategory: "ownership", description: "Federal land ownership boundaries", apiUrl: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Federal_Lands/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  
  // NWS Weather
  { key: generateKey("nws_alerts", "specialty"), title: "NWS Weather Alerts", category: "natural_hazards", subcategory: "weather", description: "National Weather Service active alerts", apiUrl: "https://api.weather.gov/alerts/active", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("nws_forecast", "specialty"), title: "NWS Forecast API", category: "natural_hazards", subcategory: "weather", description: "National Weather Service forecast data", apiUrl: "https://api.weather.gov/", coverage: "US", accessLevel: "free", priority: 2 },
  
  // NOAA
  { key: generateKey("noaa_climate", "specialty"), title: "NOAA Climate Data Online", category: "environmental", subcategory: "climate", description: "Historical climate and weather data", apiUrl: "https://www.ncdc.noaa.gov/cdo-web/api/v2/", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("noaa_tides", "specialty"), title: "NOAA Tides and Currents", category: "water_resources", subcategory: "tides", description: "Tide predictions and water levels", apiUrl: "https://tidesandcurrents.noaa.gov/api/", coverage: "US", accessLevel: "free", priority: 2 },
  
  // HUD
  { key: generateKey("hud_fmr", "specialty"), title: "HUD Fair Market Rents", category: "housing", subcategory: "rental", description: "HUD fair market rent data by area", apiUrl: "https://www.huduser.gov/hudapi/public/fmr", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("hud_income", "specialty"), title: "HUD Income Limits", category: "housing", subcategory: "income", description: "Area median income limits", apiUrl: "https://www.huduser.gov/hudapi/public/il", coverage: "US", accessLevel: "free", priority: 2 },
  
  // DOT
  { key: generateKey("dot_nhpn", "specialty"), title: "DOT National Highway Planning Network", category: "transportation", subcategory: "highways", description: "National highway network data", apiUrl: "https://geo.dot.gov/server/rest/services/", coverage: "US", accessLevel: "free", priority: 2 },
  
  // NPS
  { key: generateKey("nps_boundaries", "specialty"), title: "NPS Park Boundaries", category: "public_lands", subcategory: "parks", description: "National Park Service unit boundaries", apiUrl: "https://mapservices.nps.gov/arcgis/rest/services/", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("nps_api", "specialty"), title: "NPS Developer API", category: "public_lands", subcategory: "parks", description: "National Park Service park information", apiUrl: "https://developer.nps.gov/api/v1/", coverage: "US", accessLevel: "free", priority: 2 },
  
  // Data.gov Aggregated
  { key: generateKey("datagov_parcels", "specialty"), title: "Data.gov Parcel Datasets", category: "federal_aggregator", subcategory: "parcels", description: "Federated parcel data catalog", apiUrl: "https://catalog.data.gov/dataset?tags=parcels", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("datagov_gis", "specialty"), title: "Data.gov GIS Datasets", category: "federal_aggregator", subcategory: "multi_layer", description: "Federal GIS data catalog", apiUrl: "https://catalog.data.gov/dataset?res_format=XML&tags=gis", coverage: "US", accessLevel: "free", priority: 1 },
];

async function main() {
  console.log("=== State Portals & Specialty Import ===\n");
  
  const startCount = await db.select({ count: sql`count(*)` }).from(dataSources);
  console.log(`Starting count: ${startCount[0].count}`);
  
  let totalInserted = 0;
  let totalSkipped = 0;
  
  // Import all categories
  const categories = [
    { sources: statePortals, name: "State GIS Portals" },
    { sources: specialtySources, name: "Specialty Sources" },
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
  
  // Category breakdown
  const categories_breakdown = await db.execute(sql`
    SELECT category, count(*) as cnt 
    FROM data_sources 
    GROUP BY category 
    ORDER BY cnt DESC
    LIMIT 30
  `);
  
  console.log("\nBy category:");
  categories_breakdown.rows.forEach((row: any) => {
    console.log(`  ${row.category}: ${row.cnt}`);
  });
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
