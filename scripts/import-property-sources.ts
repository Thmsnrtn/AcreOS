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

// Major Metropolitan County GIS Systems
const metroCountySources: DataSourceInput[] = [
  // California Major Counties
  { key: generateKey("ca_la_county", "county"), title: "Los Angeles County GIS", category: "county_gis", subcategory: "parcels", description: "LA County parcel and property data", apiUrl: "https://public.gis.lacounty.gov/public/rest/services", coverage: "CA", accessLevel: "free", priority: 1 },
  { key: generateKey("ca_orange_county", "county"), title: "Orange County GIS", category: "county_gis", subcategory: "parcels", description: "OC assessor parcel data", apiUrl: "https://gis.ocpw.ocgov.com/arcgis/rest/services", coverage: "CA", accessLevel: "free", priority: 1 },
  { key: generateKey("ca_san_diego", "county"), title: "San Diego County GIS", category: "county_gis", subcategory: "parcels", description: "SAN parcel and land data", apiUrl: "https://gis.sandiegocounty.gov/arcgis/rest/services", coverage: "CA", accessLevel: "free", priority: 1 },
  { key: generateKey("ca_sf_county", "county"), title: "San Francisco County GIS", category: "county_gis", subcategory: "parcels", description: "SF property mapping", apiUrl: "https://gis.sf.gov/arcgis/rest/services", coverage: "CA", accessLevel: "free", priority: 1 },
  { key: generateKey("ca_alameda", "county"), title: "Alameda County GIS", category: "county_gis", subcategory: "parcels", description: "Alameda County property data", apiUrl: "https://gis.acgov.org/arcgis/rest/services", coverage: "CA", accessLevel: "free", priority: 1 },
  
  // Texas Major Counties
  { key: generateKey("tx_harris", "county"), title: "Harris County (Houston) GIS", category: "county_gis", subcategory: "parcels", description: "Harris County appraisal data", apiUrl: "https://arcgis.harriscountytx.gov/arcgis/rest/services", coverage: "TX", accessLevel: "free", priority: 1 },
  { key: generateKey("tx_dallas", "county"), title: "Dallas County GIS", category: "county_gis", subcategory: "parcels", description: "Dallas County mapping", apiUrl: "https://gis.dallascounty.org/arcgis/rest/services", coverage: "TX", accessLevel: "free", priority: 1 },
  { key: generateKey("tx_bexar", "county"), title: "Bexar County (San Antonio) GIS", category: "county_gis", subcategory: "parcels", description: "Bexar County property data", apiUrl: "https://gis.bexar.org/arcgis/rest/services", coverage: "TX", accessLevel: "free", priority: 1 },
  { key: generateKey("tx_travis", "county"), title: "Travis County (Austin) GIS", category: "county_gis", subcategory: "parcels", description: "Travis County mapping", apiUrl: "https://gis.traviscountytx.gov/arcgis/rest/services", coverage: "TX", accessLevel: "free", priority: 1 },
  { key: generateKey("tx_tarrant", "county"), title: "Tarrant County (Ft Worth) GIS", category: "county_gis", subcategory: "parcels", description: "Tarrant County GIS data", apiUrl: "https://maps.tarrantcounty.com/arcgis/rest/services", coverage: "TX", accessLevel: "free", priority: 1 },
  
  // Florida Major Counties
  { key: generateKey("fl_miami_dade", "county"), title: "Miami-Dade County GIS", category: "county_gis", subcategory: "parcels", description: "Miami-Dade property data", apiUrl: "https://gisims.miamidade.gov/arcgis/rest/services", coverage: "FL", accessLevel: "free", priority: 1 },
  { key: generateKey("fl_broward", "county"), title: "Broward County GIS", category: "county_gis", subcategory: "parcels", description: "Broward County mapping", apiUrl: "https://gis.broward.org/arcgis/rest/services", coverage: "FL", accessLevel: "free", priority: 1 },
  { key: generateKey("fl_palm_beach", "county"), title: "Palm Beach County GIS", category: "county_gis", subcategory: "parcels", description: "Palm Beach County data", apiUrl: "https://maps.co.palm-beach.fl.us/arcgis/rest/services", coverage: "FL", accessLevel: "free", priority: 1 },
  { key: generateKey("fl_hillsborough", "county"), title: "Hillsborough County (Tampa) GIS", category: "county_gis", subcategory: "parcels", description: "Tampa area GIS", apiUrl: "https://gis.hillsboroughcounty.org/arcgis/rest/services", coverage: "FL", accessLevel: "free", priority: 1 },
  { key: generateKey("fl_orange", "county"), title: "Orange County (Orlando) GIS", category: "county_gis", subcategory: "parcels", description: "Orlando area mapping", apiUrl: "https://maps.ocfl.net/arcgis/rest/services", coverage: "FL", accessLevel: "free", priority: 1 },
  
  // Arizona Major Counties
  { key: generateKey("az_maricopa", "county"), title: "Maricopa County (Phoenix) GIS", category: "county_gis", subcategory: "parcels", description: "Phoenix metro parcel data", apiUrl: "https://gis.maricopa.gov/arcgis/rest/services", coverage: "AZ", accessLevel: "free", priority: 1 },
  { key: generateKey("az_pima", "county"), title: "Pima County (Tucson) GIS", category: "county_gis", subcategory: "parcels", description: "Tucson area GIS", apiUrl: "https://gis.pima.gov/arcgis/rest/services", coverage: "AZ", accessLevel: "free", priority: 1 },
  
  // Nevada
  { key: generateKey("nv_clark", "county"), title: "Clark County (Las Vegas) GIS", category: "county_gis", subcategory: "parcels", description: "Las Vegas metro parcels", apiUrl: "https://gisgate.co.clark.nv.us/opengisportal/rest/services", coverage: "NV", accessLevel: "free", priority: 1 },
  { key: generateKey("nv_washoe", "county"), title: "Washoe County (Reno) GIS", category: "county_gis", subcategory: "parcels", description: "Reno area property data", apiUrl: "https://gismaps.washoecounty.us/arcgis/rest/services", coverage: "NV", accessLevel: "free", priority: 1 },
  
  // Georgia
  { key: generateKey("ga_fulton", "county"), title: "Fulton County (Atlanta) GIS", category: "county_gis", subcategory: "parcels", description: "Atlanta metro GIS", apiUrl: "https://gis.fultoncountyga.gov/arcgis/rest/services", coverage: "GA", accessLevel: "free", priority: 1 },
  { key: generateKey("ga_gwinnett", "county"), title: "Gwinnett County GIS", category: "county_gis", subcategory: "parcels", description: "Gwinnett County data", apiUrl: "https://gis.gwinnettcounty.com/arcgis/rest/services", coverage: "GA", accessLevel: "free", priority: 1 },
  
  // North Carolina
  { key: generateKey("nc_mecklenburg", "county"), title: "Mecklenburg County (Charlotte) GIS", category: "county_gis", subcategory: "parcels", description: "Charlotte area mapping", apiUrl: "https://maps.mecknc.gov/arcgis/rest/services", coverage: "NC", accessLevel: "free", priority: 1 },
  { key: generateKey("nc_wake", "county"), title: "Wake County (Raleigh) GIS", category: "county_gis", subcategory: "parcels", description: "Raleigh area GIS", apiUrl: "https://maps.wakegov.com/arcgis/rest/services", coverage: "NC", accessLevel: "free", priority: 1 },
  
  // Washington
  { key: generateKey("wa_king", "county"), title: "King County (Seattle) GIS", category: "county_gis", subcategory: "parcels", description: "Seattle metro parcels", apiUrl: "https://gismaps.kingcounty.gov/arcgis/rest/services", coverage: "WA", accessLevel: "free", priority: 1 },
  { key: generateKey("wa_pierce", "county"), title: "Pierce County (Tacoma) GIS", category: "county_gis", subcategory: "parcels", description: "Tacoma area mapping", apiUrl: "https://gis.piercecountywa.gov/arcgis/rest/services", coverage: "WA", accessLevel: "free", priority: 1 },
  
  // Colorado
  { key: generateKey("co_denver", "county"), title: "Denver County GIS", category: "county_gis", subcategory: "parcels", description: "Denver city/county GIS", apiUrl: "https://gis.denvergov.org/arcgis/rest/services", coverage: "CO", accessLevel: "free", priority: 1 },
  { key: generateKey("co_arapahoe", "county"), title: "Arapahoe County GIS", category: "county_gis", subcategory: "parcels", description: "Arapahoe County parcels", apiUrl: "https://gis.arapahoegov.com/arcgis/rest/services", coverage: "CO", accessLevel: "free", priority: 1 },
  
  // Pennsylvania
  { key: generateKey("pa_philadelphia", "county"), title: "Philadelphia City/County GIS", category: "county_gis", subcategory: "parcels", description: "Philadelphia mapping", apiUrl: "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services", coverage: "PA", accessLevel: "free", priority: 1 },
  { key: generateKey("pa_allegheny", "county"), title: "Allegheny County (Pittsburgh) GIS", category: "county_gis", subcategory: "parcels", description: "Pittsburgh area data", apiUrl: "https://gis.alleghenycounty.us/arcgis/rest/services", coverage: "PA", accessLevel: "free", priority: 1 },
  
  // Illinois
  { key: generateKey("il_cook", "county"), title: "Cook County (Chicago) GIS", category: "county_gis", subcategory: "parcels", description: "Chicago metro GIS", apiUrl: "https://gisportal.cookcountyil.gov/arcgis/rest/services", coverage: "IL", accessLevel: "free", priority: 1 },
  
  // Michigan
  { key: generateKey("mi_wayne", "county"), title: "Wayne County (Detroit) GIS", category: "county_gis", subcategory: "parcels", description: "Detroit area mapping", apiUrl: "https://gis.waynecounty.com/arcgis/rest/services", coverage: "MI", accessLevel: "free", priority: 1 },
  
  // Ohio
  { key: generateKey("oh_cuyahoga", "county"), title: "Cuyahoga County (Cleveland) GIS", category: "county_gis", subcategory: "parcels", description: "Cleveland area GIS", apiUrl: "https://gis.cuyahogacounty.us/arcgis/rest/services", coverage: "OH", accessLevel: "free", priority: 1 },
  { key: generateKey("oh_franklin", "county"), title: "Franklin County (Columbus) GIS", category: "county_gis", subcategory: "parcels", description: "Columbus area mapping", apiUrl: "https://gis.franklincountyohio.gov/arcgis/rest/services", coverage: "OH", accessLevel: "free", priority: 1 },
  
  // New York
  { key: generateKey("ny_westchester", "county"), title: "Westchester County GIS", category: "county_gis", subcategory: "parcels", description: "Westchester County data", apiUrl: "https://gis.westchestergov.com/arcgis/rest/services", coverage: "NY", accessLevel: "free", priority: 1 },
  { key: generateKey("ny_nassau", "county"), title: "Nassau County (Long Island) GIS", category: "county_gis", subcategory: "parcels", description: "Nassau County mapping", apiUrl: "https://gis.nassaucountyny.gov/arcgis/rest/services", coverage: "NY", accessLevel: "free", priority: 1 },
  
  // Massachusetts
  { key: generateKey("ma_suffolk", "county"), title: "Suffolk County (Boston) GIS", category: "county_gis", subcategory: "parcels", description: "Boston area property", apiUrl: "https://gis.boston.gov/arcgis/rest/services", coverage: "MA", accessLevel: "free", priority: 1 },
  
  // Maryland
  { key: generateKey("md_baltimore_city", "county"), title: "Baltimore City GIS", category: "county_gis", subcategory: "parcels", description: "Baltimore City mapping", apiUrl: "https://gis.baltimorecity.gov/arcgis/rest/services", coverage: "MD", accessLevel: "free", priority: 1 },
  { key: generateKey("md_montgomery", "county"), title: "Montgomery County GIS", category: "county_gis", subcategory: "parcels", description: "Montgomery County data", apiUrl: "https://gis.montgomerycountymd.gov/arcgis/rest/services", coverage: "MD", accessLevel: "free", priority: 1 },
  
  // Virginia
  { key: generateKey("va_fairfax", "county"), title: "Fairfax County GIS", category: "county_gis", subcategory: "parcels", description: "Fairfax County mapping", apiUrl: "https://gis.fairfaxcounty.gov/arcgis/rest/services", coverage: "VA", accessLevel: "free", priority: 1 },
  { key: generateKey("va_loudoun", "county"), title: "Loudoun County GIS", category: "county_gis", subcategory: "parcels", description: "Loudoun County data", apiUrl: "https://gis.loudoun.gov/arcgis/rest/services", coverage: "VA", accessLevel: "free", priority: 1 },
];

// National Property Data APIs (Freemium)
const propertyAPIs: DataSourceInput[] = [
  { key: generateKey("regrid_free", "property"), title: "Regrid Free Parcel Tiles", category: "national_parcels", subcategory: "parcels", description: "Nationwide parcel tile layer (free tier)", apiUrl: "https://tiles.regrid.com/api/v2/", coverage: "US", accessLevel: "freemium", priority: 1 },
  { key: generateKey("pluto_nyc", "property"), title: "NYC PLUTO Dataset", category: "county_gis", subcategory: "parcels", description: "NYC tax lot and land use data", apiUrl: "https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/MAPPLUTO/FeatureServer", coverage: "NY", accessLevel: "free", priority: 1 },
];

// Wildfire and Fire Risk
const wildfireSources: DataSourceInput[] = [
  { key: generateKey("nifc_perimeters", "wildfire"), title: "NIFC Fire Perimeters", category: "natural_hazards", subcategory: "wildfire", description: "National Interagency Fire Center boundaries", apiUrl: "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/Current_WildlandFire_Perimeters/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("nifc_locations", "wildfire"), title: "NIFC Active Fire Locations", category: "natural_hazards", subcategory: "wildfire", description: "Current fire incident points", apiUrl: "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/Current_WildlandFire_Locations/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("wfigs", "wildfire"), title: "WFIGS Wildland Fire", category: "natural_hazards", subcategory: "wildfire", description: "Wildland Fire Interagency Geospatial Services", apiUrl: "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/", coverage: "US", accessLevel: "free", priority: 1 },
];

// Opportunity Zones and Economic Data
const economicSources: DataSourceInput[] = [
  { key: generateKey("opp_zones", "economic"), title: "Opportunity Zones", category: "economic", subcategory: "investment", description: "Federal opportunity zone boundaries", apiUrl: "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Opportunity_Zones/FeatureServer", coverage: "US", accessLevel: "free", priority: 1 },
  { key: generateKey("enterprise_zones", "economic"), title: "Enterprise Zones", category: "economic", subcategory: "incentives", description: "State enterprise zone designations", apiUrl: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Enterprise_Zones/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
];

// School District Boundaries
const schoolSources: DataSourceInput[] = [
  { key: generateKey("school_districts", "education"), title: "US School District Boundaries", category: "administrative", subcategory: "education", description: "K-12 school district boundaries", apiUrl: "https://services1.arcgis.com/Ua5sjt3LWTPigjyD/arcgis/rest/services/School_District_Boundaries/FeatureServer", coverage: "US", accessLevel: "free", priority: 2 },
];

async function main() {
  console.log("=== Property & County Sources Import ===\n");
  
  const startCount = await db.select({ count: sql`count(*)` }).from(dataSources);
  console.log(`Starting count: ${startCount[0].count}`);
  
  let totalInserted = 0;
  let totalSkipped = 0;
  
  const categories = [
    { sources: metroCountySources, name: "Metro County GIS" },
    { sources: propertyAPIs, name: "Property APIs" },
    { sources: wildfireSources, name: "Wildfire" },
    { sources: economicSources, name: "Economic Zones" },
    { sources: schoolSources, name: "School Districts" },
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
  
  // Final category breakdown
  const categories_breakdown = await db.execute(sql`
    SELECT category, count(*) as cnt 
    FROM data_sources 
    GROUP BY category 
    ORDER BY cnt DESC
    LIMIT 35
  `);
  
  console.log("\n=== FINAL BREAKDOWN BY CATEGORY ===");
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
