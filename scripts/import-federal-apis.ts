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
      } else {
        console.log(`  Error: ${source.title} - ${error.message?.substring(0, 50)}`);
      }
    }
  }
  
  console.log(`  Inserted: ${inserted}, Skipped: ${skipped}`);
  return { inserted, skipped };
}

// HIFLD Infrastructure Data
const hifldSources: DataSourceInput[] = [
  // Healthcare
  { key: generateKey("hifld_hospitals", "hifld"), title: "HIFLD Hospitals", category: "infrastructure", subcategory: "healthcare", description: "Nationwide hospital locations from HIFLD", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Hospitals_1/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("hifld_urgent_care", "hifld"), title: "HIFLD Urgent Care Facilities", category: "infrastructure", subcategory: "healthcare", description: "Urgent care facility locations", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Urgent_Care_Facilities/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("hifld_nursing_homes", "hifld"), title: "HIFLD Nursing Homes", category: "infrastructure", subcategory: "healthcare", description: "Nursing home and long-term care facilities", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Nursing_Homes/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("hifld_pharmacies", "hifld"), title: "HIFLD Pharmacies", category: "infrastructure", subcategory: "healthcare", description: "Pharmacy locations nationwide", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Pharmacies/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  
  // Emergency Services
  { key: generateKey("hifld_fire_stations", "hifld"), title: "HIFLD Fire Stations", category: "infrastructure", subcategory: "emergency", description: "Fire station locations nationwide", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Fire_Stations/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("hifld_ems_stations", "hifld"), title: "HIFLD EMS Stations", category: "infrastructure", subcategory: "emergency", description: "Emergency medical service stations", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/EMS_Stations/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("hifld_local_law", "hifld"), title: "HIFLD Local Law Enforcement", category: "infrastructure", subcategory: "emergency", description: "Police and sheriff locations", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Local_Law_Enforcement_Locations/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("hifld_psap", "hifld"), title: "HIFLD 911 Call Centers (PSAP)", category: "infrastructure", subcategory: "emergency", description: "Public Safety Answering Points", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Public_Safety_Answering_Points_PSAP/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  
  // Education
  { key: generateKey("hifld_public_schools", "hifld"), title: "HIFLD Public Schools", category: "infrastructure", subcategory: "education", description: "Public school locations K-12", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Public_Schools/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("hifld_private_schools", "hifld"), title: "HIFLD Private Schools", category: "infrastructure", subcategory: "education", description: "Private school locations K-12", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Private_Schools/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("hifld_colleges", "hifld"), title: "HIFLD Colleges & Universities", category: "infrastructure", subcategory: "education", description: "Higher education institutions", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Colleges_and_Universities/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  
  // Energy & Utilities
  { key: generateKey("hifld_power_plants", "hifld"), title: "HIFLD Power Plants", category: "infrastructure", subcategory: "energy", description: "Electric power generation facilities", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Power_Plants/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("hifld_substations", "hifld"), title: "HIFLD Electric Substations", category: "infrastructure", subcategory: "energy", description: "Electric transmission substations", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Substations/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("hifld_transmission", "hifld"), title: "HIFLD Electric Transmission Lines", category: "infrastructure", subcategory: "energy", description: "High voltage transmission lines", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("hifld_natural_gas", "hifld"), title: "HIFLD Natural Gas Pipelines", category: "infrastructure", subcategory: "energy", description: "Natural gas transmission pipelines", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Natural_Gas_Pipelines/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("hifld_petroleum", "hifld"), title: "HIFLD Petroleum Terminals", category: "infrastructure", subcategory: "energy", description: "Oil and petroleum storage terminals", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Petroleum_Terminals/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  
  // Communications
  { key: generateKey("hifld_cell_towers", "hifld"), title: "HIFLD Cellular Towers", category: "infrastructure", subcategory: "communications", description: "Cell tower locations", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Cellular_Towers/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("hifld_broadcast", "hifld"), title: "HIFLD Broadcast Towers", category: "infrastructure", subcategory: "communications", description: "TV and radio broadcast towers", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/FM_Transmission_Towers/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  
  // Transportation
  { key: generateKey("hifld_airports", "hifld"), title: "HIFLD Airports", category: "infrastructure", subcategory: "transportation", description: "Airport locations and runways", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Airports/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("hifld_ports", "hifld"), title: "HIFLD Ports", category: "infrastructure", subcategory: "transportation", description: "Major port facilities", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Ports/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("hifld_rail", "hifld"), title: "HIFLD Railroad Lines", category: "infrastructure", subcategory: "transportation", description: "Railroad network lines", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Railroad_Lines/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("hifld_bridges", "hifld"), title: "HIFLD Bridges", category: "infrastructure", subcategory: "transportation", description: "Bridge locations and data", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/All_Roads_Bridges/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  
  // Water Infrastructure
  { key: generateKey("hifld_dams", "hifld"), title: "HIFLD Dams", category: "infrastructure", subcategory: "water", description: "Dam locations and data", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Dams/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("hifld_water_treatment", "hifld"), title: "HIFLD Water Treatment Plants", category: "infrastructure", subcategory: "water", description: "Public water treatment facilities", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Public_Water_Systems/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("hifld_wastewater", "hifld"), title: "HIFLD Wastewater Treatment", category: "infrastructure", subcategory: "water", description: "Wastewater treatment facilities", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Wastewater_Treatment_Plants/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  
  // Government & Public
  { key: generateKey("hifld_federal_buildings", "hifld"), title: "HIFLD Federal Buildings", category: "infrastructure", subcategory: "government", description: "Federal government facilities", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Federal_Courthouse/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("hifld_post_offices", "hifld"), title: "HIFLD Post Offices", category: "infrastructure", subcategory: "government", description: "USPS post office locations", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/USPS_Post_Offices/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("hifld_va_facilities", "hifld"), title: "HIFLD VA Facilities", category: "infrastructure", subcategory: "government", description: "Veterans Affairs health facilities", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Veterans_Health_Administration_Medical_Facilities/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  
  // Retail & Commerce
  { key: generateKey("hifld_shopping_centers", "hifld"), title: "HIFLD Major Shopping Centers", category: "infrastructure", subcategory: "commercial", description: "Major retail shopping centers", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Major_Shopping_Centers/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("hifld_stadiums", "hifld"), title: "HIFLD Stadiums & Arenas", category: "infrastructure", subcategory: "commercial", description: "Major sports and event venues", apiUrl: "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Stadiums/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
];

// OpenFEMA API Endpoints
const femaSources: DataSourceInput[] = [
  { key: generateKey("fema_disasters", "fema"), title: "FEMA Disaster Declarations", category: "natural_hazards", subcategory: "disasters", description: "Historical disaster declarations summary", apiUrl: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("fema_web_disasters", "fema"), title: "FEMA Web Disaster Declarations", category: "natural_hazards", subcategory: "disasters", description: "Detailed disaster declaration information", apiUrl: "https://www.fema.gov/api/open/v2/FemaWebDisasterDeclarations", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("fema_hma_projects", "fema"), title: "FEMA Hazard Mitigation Projects", category: "natural_hazards", subcategory: "mitigation", description: "Hazard mitigation assistance projects", apiUrl: "https://www.fema.gov/api/open/v2/HazardMitigationAssistanceProjects", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("fema_pa_projects", "fema"), title: "FEMA Public Assistance Projects", category: "natural_hazards", subcategory: "assistance", description: "Public assistance funded project details", apiUrl: "https://www.fema.gov/api/open/v2/PublicAssistanceFundedProjectsDetails", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("fema_nfip_policies", "fema"), title: "FEMA NFIP Policies", category: "natural_hazards", subcategory: "flood_insurance", description: "National Flood Insurance Program policies in force", apiUrl: "https://www.fema.gov/api/open/v2/FimaNfipPolicies", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("fema_nfip_claims", "fema"), title: "FEMA NFIP Claims", category: "natural_hazards", subcategory: "flood_insurance", description: "Flood insurance claims data", apiUrl: "https://www.fema.gov/api/open/v2/FimaNfipClaims", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("fema_ipaws_alerts", "fema"), title: "FEMA IPAWS Archived Alerts", category: "natural_hazards", subcategory: "alerts", description: "Integrated Public Alert and Warning System archives", apiUrl: "https://www.fema.gov/api/open/v2/IpawsArchivedAlerts", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("fema_registrations", "fema"), title: "FEMA Individual Assistance Registrations", category: "natural_hazards", subcategory: "assistance", description: "Individual assistance housing registrations by ZIP", apiUrl: "https://www.fema.gov/api/open/v2/IndividualAssistanceHousingRegistrantsLargeDisasters", coverage: "US", accessLevel: "free", priority: 2 },
];

// USGS API Endpoints
const usgsSources: DataSourceInput[] = [
  // Water Services
  { key: generateKey("usgs_water_iv", "usgs"), title: "USGS Instantaneous Water Values", category: "water_resources", subcategory: "streamflow", description: "Real-time streamflow and gage height data", apiUrl: "https://waterservices.usgs.gov/nwis/iv/", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("usgs_water_dv", "usgs"), title: "USGS Daily Water Values", category: "water_resources", subcategory: "streamflow", description: "Historical daily water statistics", apiUrl: "https://waterservices.usgs.gov/nwis/dv/", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("usgs_water_site", "usgs"), title: "USGS Water Monitoring Sites", category: "water_resources", subcategory: "monitoring", description: "USGS water monitoring site locations", apiUrl: "https://waterservices.usgs.gov/nwis/site/", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("usgs_water_stats", "usgs"), title: "USGS Water Statistics", category: "water_resources", subcategory: "statistics", description: "Statistical summaries for water sites", apiUrl: "https://waterservices.usgs.gov/nwis/stat/", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("usgs_groundwater", "usgs"), title: "USGS Groundwater Levels", category: "water_resources", subcategory: "groundwater", description: "Groundwater level measurements", apiUrl: "https://waterservices.usgs.gov/nwis/gwlevels/", coverage: "US", accessLevel: "free", priority: 2 },
  
  // Earthquake
  { key: generateKey("usgs_earthquake", "usgs"), title: "USGS Earthquake Catalog", category: "natural_hazards", subcategory: "seismic", description: "Historical and real-time earthquake data", apiUrl: "https://earthquake.usgs.gov/fdsnws/event/1/query", coverage: "US", accessLevel: "free", priority: 1 },
  
  // National Map
  { key: generateKey("usgs_tnm", "usgs"), title: "USGS The National Map Access", category: "topographic", subcategory: "elevation", description: "Elevation, imagery, and topo map access", apiUrl: "https://apps.nationalmap.gov/tnmaccess/api/v1/products", coverage: "US", accessLevel: "free", priority: 1 },
  
  // 3DEP Elevation
  { key: generateKey("usgs_3dep", "usgs"), title: "USGS 3DEP Elevation", category: "topographic", subcategory: "elevation", description: "3D Elevation Program data services", apiUrl: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer", coverage: "US", accessLevel: "free", priority: 1 },
  
  // Protected Areas (PAD-US)
  { key: generateKey("usgs_padus", "usgs"), title: "USGS PAD-US Protected Areas", category: "public_lands", subcategory: "conservation", description: "Protected Areas Database of the United States", apiUrl: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Protected_Areas/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
];

// Census Bureau Endpoints
const censusSources: DataSourceInput[] = [
  { key: generateKey("census_acs5", "census"), title: "Census ACS 5-Year Estimates", category: "demographics", subcategory: "survey", description: "American Community Survey 5-year detailed demographics", apiUrl: "https://api.census.gov/data/2022/acs/acs5", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("census_acs1", "census"), title: "Census ACS 1-Year Estimates", category: "demographics", subcategory: "survey", description: "American Community Survey 1-year recent estimates", apiUrl: "https://api.census.gov/data/2022/acs/acs1", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("census_dec2020", "census"), title: "Census 2020 Decennial", category: "demographics", subcategory: "decennial", description: "2020 Decennial Census population data", apiUrl: "https://api.census.gov/data/2020/dec/pl", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("census_pep", "census"), title: "Census Population Estimates", category: "demographics", subcategory: "estimates", description: "Annual population estimates program", apiUrl: "https://api.census.gov/data/2023/pep/population", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("census_tiger", "census"), title: "Census TIGER/Line Boundaries", category: "census_boundaries", subcategory: "administrative", description: "Geographic boundary files (states, counties, tracts)", apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("census_blocks", "census"), title: "Census Block Boundaries", category: "census_boundaries", subcategory: "blocks", description: "Census block level boundaries", apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/Tracts_Blocks/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
];

// EPA Envirofacts Endpoints
const epaSources: DataSourceInput[] = [
  { key: generateKey("epa_facilities", "epa"), title: "EPA Facility Registry", category: "environmental", subcategory: "facilities", description: "EPA regulated facility locations", apiUrl: "https://data.epa.gov/efservice/FACILITY/", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("epa_air", "epa"), title: "EPA Air Quality System", category: "environmental", subcategory: "air_quality", description: "Air quality monitoring data", apiUrl: "https://aqs.epa.gov/aqsweb/documents/data_api.html", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("epa_water", "epa"), title: "EPA Safe Drinking Water", category: "environmental", subcategory: "water_quality", description: "Public water system information", apiUrl: "https://data.epa.gov/efservice/SDWIS/", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("epa_superfund", "epa"), title: "EPA Superfund Sites", category: "environmental", subcategory: "contamination", description: "Superfund hazardous waste sites (NPL)", apiUrl: "https://data.epa.gov/efservice/SEMS/", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("epa_tri", "epa"), title: "EPA Toxics Release Inventory", category: "environmental", subcategory: "toxics", description: "Toxic chemical releases by facilities", apiUrl: "https://data.epa.gov/efservice/TRI_FACILITY/", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("epa_radnet", "epa"), title: "EPA RadNet Radiation", category: "environmental", subcategory: "radiation", description: "Radiation monitoring network data", apiUrl: "https://www.epa.gov/radnet/radnet-csv-file-downloads", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("epa_brownfields", "epa"), title: "EPA Brownfields", category: "environmental", subcategory: "contamination", description: "Brownfield contaminated land sites", apiUrl: "https://data.epa.gov/efservice/ACRES/", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("epa_ejscreen", "epa"), title: "EPA EJScreen", category: "environmental", subcategory: "environmental_justice", description: "Environmental justice screening tool", apiUrl: "https://ejscreen.epa.gov/mapper/ejscreenRESTbroker1.aspx", coverage: "US", accessLevel: "free", priority: 1 },
];

// BLM National Endpoints
const blmSources: DataSourceInput[] = [
  { key: generateKey("blm_plss", "blm"), title: "BLM PLSS Cadastral", category: "public_lands", subcategory: "cadastral", description: "Public Land Survey System township/range/section", apiUrl: "https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("blm_sma", "blm"), title: "BLM Surface Management Agency", category: "public_lands", subcategory: "ownership", description: "Federal surface land management agency", apiUrl: "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Surface_Mgmt_Agency/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("blm_nlcs", "blm"), title: "BLM National Landscape Conservation", category: "public_lands", subcategory: "conservation", description: "National Conservation Lands system", apiUrl: "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_NLCS/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("blm_minerals", "blm"), title: "BLM Mineral Estate", category: "mineral_subsurface", subcategory: "minerals", description: "Federal mineral estate ownership", apiUrl: "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_Mineral_Estate/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("blm_wilderness", "blm"), title: "BLM Wilderness Areas", category: "public_lands", subcategory: "wilderness", description: "BLM wilderness and wilderness study areas", apiUrl: "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_WSA_Wilderness/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("blm_grazing", "blm"), title: "BLM Grazing Allotments", category: "agricultural_data", subcategory: "grazing", description: "BLM grazing allotment boundaries", apiUrl: "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_Grazing_Allotments/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
];

// USDA/NRCS Endpoints
const usdaSources: DataSourceInput[] = [
  { key: generateKey("nrcs_soils", "usda"), title: "NRCS Web Soil Survey", category: "agricultural_data", subcategory: "soils", description: "SSURGO soil survey geographic data", apiUrl: "https://sdmdataaccess.sc.egov.usda.gov/Tabular/SDMTabularService.asmx", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("nrcs_soils_wms", "usda"), title: "NRCS Soil Survey WMS", category: "agricultural_data", subcategory: "soils", description: "Soil survey map services", apiUrl: "https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDMWGS84Geographic.wfs", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("usfs_boundaries", "usda"), title: "USFS National Forest Boundaries", category: "public_lands", subcategory: "forests", description: "National Forest System land boundaries", apiUrl: "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("usfs_roads", "usda"), title: "USFS Forest Roads", category: "transportation", subcategory: "forest_roads", description: "National Forest road network", apiUrl: "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RoadCore_01/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("usfs_trails", "usda"), title: "USFS Trail System", category: "transportation", subcategory: "trails", description: "National Forest trail network", apiUrl: "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
  { key: generateKey("usfs_wilderness", "usda"), title: "USFS Wilderness Areas", category: "public_lands", subcategory: "wilderness", description: "National Forest wilderness boundaries", apiUrl: "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_Wilderness_01/MapServer", coverage: "US", accessLevel: "free", priority: 2 },
];

// National Wetlands Inventory
const wetlandsSources: DataSourceInput[] = [
  { key: generateKey("fws_wetlands", "fws"), title: "USFWS National Wetlands Inventory", category: "environmental", subcategory: "wetlands", description: "National Wetlands Inventory polygon data", apiUrl: "https://www.fws.gov/wetlands/arcgis/rest/services/Wetlands/MapServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("fws_wetlands_raster", "fws"), title: "USFWS Wetlands Raster", category: "environmental", subcategory: "wetlands", description: "Wetlands raster imagery service", apiUrl: "https://www.fws.gov/wetlands/arcgis/rest/services/Wetlands_Raster/ImageServer", coverage: "US", accessLevel: "free", priority: 2 },
];

async function main() {
  console.log("=== Federal API Import ===\n");
  
  const startCount = await db.select({ count: sql`count(*)` }).from(dataSources);
  console.log(`Starting count: ${startCount[0].count}`);
  
  let totalInserted = 0;
  let totalSkipped = 0;
  
  // Import all categories
  const categories = [
    { sources: hifldSources, name: "HIFLD Infrastructure" },
    { sources: femaSources, name: "OpenFEMA" },
    { sources: usgsSources, name: "USGS" },
    { sources: censusSources, name: "Census Bureau" },
    { sources: epaSources, name: "EPA Envirofacts" },
    { sources: blmSources, name: "BLM" },
    { sources: usdaSources, name: "USDA/NRCS/USFS" },
    { sources: wetlandsSources, name: "USFWS Wetlands" },
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
