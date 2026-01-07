import { db } from "../server/db";
import { dataSources } from "../shared/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";

interface RealEstateSource {
  portal_url?: string;
  api_url?: string;
  data_types?: string[];
  coverage?: string;
  access_level?: string;
  description?: string;
}

interface LandEnhancementSource {
  portal_url?: string;
  api_url?: string;
  coverage?: string;
  data_types?: string[];
  access_level?: string;
  description?: string;
}

function toKey(category: string, name: string): string {
  return `${category.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

async function importDataSources() {
  console.log("=== Importing Data Sources ===\n");
  
  const allSources: Array<{
    key: string;
    title: string;
    category: string;
    subcategory?: string;
    description?: string;
    portalUrl?: string;
    apiUrl?: string;
    coverage?: string;
    accessLevel: string;
    dataTypes?: string[];
    priority: number;
  }> = [];

  // 1. Import Real Estate Data Sources
  console.log("1. Reading Real Estate Data Sources...");
  const realEstateData = JSON.parse(fs.readFileSync("/tmp/gis_data2/us_real_estate_data_sources.json", "utf-8"));
  
  for (const [category, sources] of Object.entries(realEstateData.categories || {})) {
    for (const [name, data] of Object.entries(sources as Record<string, RealEstateSource>)) {
      allSources.push({
        key: toKey(category, name),
        title: name,
        category: "real_estate",
        subcategory: category,
        description: data.description,
        portalUrl: data.portal_url,
        apiUrl: data.api_url,
        coverage: data.coverage,
        accessLevel: data.access_level?.toLowerCase().includes("free") ? "free" : 
                     data.access_level?.toLowerCase().includes("limited") ? "limited_free" : "paid",
        dataTypes: data.data_types,
        priority: category === "national_portals" ? 10 : category === "government_housing_data" ? 20 : 50,
      });
    }
  }
  console.log(`   Found ${allSources.length} real estate sources`);

  // 2. Import Land Enhancement Proposal Sources
  console.log("2. Reading Land Enhancement Proposal Sources...");
  const landData = JSON.parse(fs.readFileSync("/tmp/gis_data2/land_enhancement_proposal.json", "utf-8"));
  const startCount = allSources.length;
  
  for (const [category, sources] of Object.entries(landData.recommended_categories || {})) {
    for (const [name, data] of Object.entries(sources as Record<string, LandEnhancementSource>)) {
      allSources.push({
        key: toKey(category, name),
        title: name,
        category: category.replace(/_/g, ' '),
        subcategory: undefined,
        description: data.description,
        portalUrl: data.portal_url,
        apiUrl: data.api_url,
        coverage: data.coverage,
        accessLevel: data.access_level?.toLowerCase().includes("free") ? "free" : 
                     data.access_level?.toLowerCase().includes("limited") ? "limited_free" : "paid",
        dataTypes: data.data_types,
        priority: category === "environmental_data" ? 5 : 
                  category === "natural_hazards" ? 10 : 
                  category === "zoning_land_use" ? 15 : 30,
      });
    }
  }
  console.log(`   Found ${allSources.length - startCount} land enhancement sources`);

  // 3. Add Priority Government Sources
  console.log("3. Adding Priority Government Data Sources...");
  const govSources = [
    {
      key: "fema_flood_zones",
      title: "FEMA Flood Map Service",
      category: "environmental",
      subcategory: "flood_hazards",
      description: "Official FEMA flood zone mapping for all US locations",
      portalUrl: "https://msc.fema.gov/portal/home",
      apiUrl: "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer",
      coverage: "National",
      accessLevel: "free",
      dataTypes: ["flood_zones", "flood_insurance_rate_maps", "base_flood_elevations"],
      priority: 1,
    },
    {
      key: "usgs_national_wetlands",
      title: "National Wetlands Inventory",
      category: "environmental",
      subcategory: "wetlands",
      description: "US Fish & Wildlife Service wetlands mapping",
      portalUrl: "https://www.fws.gov/program/national-wetlands-inventory/wetlands-data",
      apiUrl: "https://www.fws.gov/wetlands/data/web-map-services.html",
      coverage: "National",
      accessLevel: "free",
      dataTypes: ["wetland_locations", "wetland_types", "deepwater_habitats"],
      priority: 2,
    },
    {
      key: "epa_superfund_sites",
      title: "EPA Superfund Site Database",
      category: "environmental",
      subcategory: "contamination",
      description: "Environmental contamination and cleanup status data",
      portalUrl: "https://www.epa.gov/superfund",
      apiUrl: "https://enviro.epa.gov/facts/rcrainfo/search.html",
      coverage: "National",
      accessLevel: "free",
      dataTypes: ["contaminated_sites", "cleanup_status", "environmental_restrictions"],
      priority: 3,
    },
    {
      key: "usda_soil_survey",
      title: "USDA Web Soil Survey",
      category: "natural_resources",
      subcategory: "soil",
      description: "Detailed soil mapping for agricultural and development potential",
      portalUrl: "https://websoilsurvey.nrcs.usda.gov/",
      apiUrl: "https://SDMDataAccess.nrcs.usda.gov/Tabular/SDMTabularService.asmx",
      coverage: "National",
      accessLevel: "free",
      dataTypes: ["soil_types", "soil_properties", "land_capability", "prime_farmland"],
      priority: 4,
    },
    {
      key: "usps_address_validation",
      title: "USPS Address Validation",
      category: "address_validation",
      subcategory: "postal",
      description: "Official US Postal Service address standardization",
      portalUrl: "https://tools.usps.com/zip-code-lookup.htm",
      apiUrl: "https://production.shippingapis.com/ShippingAPI.dll",
      coverage: "United States",
      accessLevel: "free",
      dataTypes: ["address_validation", "address_standardization", "zip_codes"],
      priority: 5,
    },
    {
      key: "census_geocoder",
      title: "Census Bureau Geocoder",
      category: "address_validation",
      subcategory: "geocoding",
      description: "Free geocoding and address matching from Census Bureau",
      portalUrl: "https://geocoding.geo.census.gov/",
      apiUrl: "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
      coverage: "United States",
      accessLevel: "free",
      dataTypes: ["geocoding", "address_matching", "geographic_areas"],
      priority: 6,
    },
    {
      key: "blm_land_records",
      title: "BLM General Land Office Records",
      category: "land_ownership",
      subcategory: "federal_lands",
      description: "Historical land patents and federal land records",
      portalUrl: "https://glorecords.blm.gov/",
      apiUrl: "https://glorecords.blm.gov/",
      coverage: "National",
      accessLevel: "free",
      dataTypes: ["land_patents", "survey_plats", "federal_land_status"],
      priority: 7,
    },
    {
      key: "usgs_national_map",
      title: "USGS National Map",
      category: "topography",
      subcategory: "elevation",
      description: "Topographic data, elevation, and terrain information",
      portalUrl: "https://www.usgs.gov/programs/national-geospatial-program/national-map",
      apiUrl: "https://elevation.nationalmap.gov/arcgis/rest/services",
      coverage: "National",
      accessLevel: "free",
      dataTypes: ["elevation", "topography", "land_cover", "hydrography"],
      priority: 8,
    },
    {
      key: "usgs_earthquake_hazards",
      title: "USGS Earthquake Hazards Program",
      category: "natural_hazards",
      subcategory: "seismic",
      description: "Earthquake hazard maps and seismic data",
      portalUrl: "https://earthquake.usgs.gov/",
      apiUrl: "https://earthquake.usgs.gov/fdsnws/event/1/",
      coverage: "National",
      accessLevel: "free",
      dataTypes: ["earthquake_risk", "seismic_activity", "fault_lines"],
      priority: 9,
    },
    {
      key: "noaa_wildfire_risk",
      title: "NOAA Wildfire Risk Data",
      category: "natural_hazards",
      subcategory: "wildfire",
      description: "Wildfire risk assessment and historical fire data",
      portalUrl: "https://www.nifc.gov/",
      apiUrl: "https://data-nifc.opendata.arcgis.com/",
      coverage: "National",
      accessLevel: "free",
      dataTypes: ["wildfire_risk", "fire_history", "burn_areas"],
      priority: 10,
    },
  ];
  
  allSources.push(...govSources);
  console.log(`   Added ${govSources.length} priority government sources`);

  // Upsert all sources
  console.log(`\n4. Upserting ${allSources.length} total data sources...`);
  
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  
  for (const source of allSources) {
    try {
      const existing = await db.select()
        .from(dataSources)
        .where(eq(dataSources.key, source.key))
        .limit(1);
      
      if (existing.length > 0) {
        await db.update(dataSources)
          .set({
            title: source.title,
            category: source.category,
            subcategory: source.subcategory,
            description: source.description,
            portalUrl: source.portalUrl,
            apiUrl: source.apiUrl,
            coverage: source.coverage,
            accessLevel: source.accessLevel,
            dataTypes: source.dataTypes,
            priority: source.priority,
            updatedAt: new Date(),
          })
          .where(eq(dataSources.id, existing[0].id));
        updated++;
      } else {
        await db.insert(dataSources).values({
          key: source.key,
          title: source.title,
          category: source.category,
          subcategory: source.subcategory,
          description: source.description,
          portalUrl: source.portalUrl,
          apiUrl: source.apiUrl,
          coverage: source.coverage,
          accessLevel: source.accessLevel,
          dataTypes: source.dataTypes,
          priority: source.priority,
        });
        inserted++;
      }
    } catch (error: any) {
      console.warn(`   Skipped ${source.key}: ${error.message}`);
      skipped++;
    }
  }

  console.log("\n=== Import Summary ===");
  console.log(`Inserted: ${inserted}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  
  // Show categories breakdown
  const result = await db.select().from(dataSources);
  const byCategory = result.reduce((acc, ds) => {
    acc[ds.category] = (acc[ds.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log(`\nTotal data sources in database: ${result.length}`);
  console.log("\nBy category:");
  Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      console.log(`  ${cat}: ${count}`);
    });
}

importDataSources()
  .then(() => {
    console.log("\nImport completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Import failed:", error);
    process.exit(1);
  });
