import { db } from "../server/db";
import { countyGisEndpoints } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import * as fs from "fs";

const STATE_ABBREV: Record<string, string> = {
  "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
  "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
  "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
  "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
  "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
  "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
  "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
  "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
  "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
  "Wisconsin": "WI", "Wyoming": "WY"
};

function normalizeCountyName(county: string): string {
  return county
    .replace(/\s+County$/i, "")
    .replace(/\s+Parish$/i, "")
    .replace(/\s+Borough$/i, "")
    .replace(/\(All Counties\)$/i, "")
    .trim();
}

function classifyEndpointType(url: string): string {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("/featureserver") || lowerUrl.includes("/mapserver")) {
    return "arcgis_rest";
  }
  if (lowerUrl.includes("arcgis") || lowerUrl.includes("hub.arcgis")) {
    return "arcgis_feature";
  }
  if (lowerUrl.includes("wfs") || lowerUrl.includes("geoserver")) {
    return "wfs";
  }
  return "manual";
}

interface GISPortalEntry {
  portal: string;
  status: string;
}

interface GISData {
  metadata: {
    title: string;
    total_counties_with_portals: number;
  };
  states: Record<string, {
    state_portal?: string;
    state_gis?: string;
    counties: Record<string, GISPortalEntry>;
  }>;
}

async function importGISEndpoints() {
  console.log("Reading GIS endpoints JSON...");
  
  const jsonPath = "/tmp/gis_data/complete_us_county_gis_portals.json";
  const rawData = fs.readFileSync(jsonPath, "utf-8");
  const data: GISData = JSON.parse(rawData);
  
  console.log(`\nMetadata: ${data.metadata.title}`);
  console.log(`Total counties in source: ${data.metadata.total_counties_with_portals}`);
  
  const toInsert: Array<{
    state: string;
    county: string;
    baseUrl: string;
    endpointType: string;
    notes: string;
    isVerified: boolean;
  }> = [];
  
  const skipped: string[] = [];
  
  for (const [stateName, stateData] of Object.entries(data.states)) {
    const stateCode = STATE_ABBREV[stateName];
    if (!stateCode) {
      console.warn(`Unknown state: ${stateName}`);
      continue;
    }
    
    for (const [countyName, countyData] of Object.entries(stateData.counties)) {
      if (countyName.toLowerCase().includes("statewide")) {
        skipped.push(`${stateCode}: ${countyName} (statewide)`);
        continue;
      }
      
      const normalizedCounty = normalizeCountyName(countyName);
      if (!normalizedCounty) {
        skipped.push(`${stateCode}: ${countyName} (empty after normalization)`);
        continue;
      }
      
      const portalUrl = countyData.portal;
      if (!portalUrl || !portalUrl.startsWith("http")) {
        skipped.push(`${stateCode}: ${countyName} (invalid URL)`);
        continue;
      }
      
      const endpointType = classifyEndpointType(portalUrl);
      const isActive = countyData.status?.toLowerCase() === "active";
      
      toInsert.push({
        state: stateCode,
        county: normalizedCounty,
        baseUrl: portalUrl,
        endpointType,
        notes: `Imported from OKComputer GIS Directory. Status: ${countyData.status || "Unknown"}`,
        isVerified: false
      });
    }
  }
  
  console.log(`\nPrepared ${toInsert.length} endpoints for import`);
  console.log(`Skipped ${skipped.length} entries`);
  
  if (skipped.length > 0 && skipped.length <= 20) {
    console.log("\nSkipped entries:");
    skipped.forEach(s => console.log(`  - ${s}`));
  }
  
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  
  console.log("\nUpserting endpoints...");
  
  for (const endpoint of toInsert) {
    const existing = await db.select()
      .from(countyGisEndpoints)
      .where(and(
        eq(countyGisEndpoints.state, endpoint.state),
        eq(countyGisEndpoints.county, endpoint.county)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      const existingEndpoint = existing[0];
      if (existingEndpoint.baseUrl !== endpoint.baseUrl) {
        await db.update(countyGisEndpoints)
          .set({
            baseUrl: endpoint.baseUrl,
            notes: endpoint.notes,
            updatedAt: new Date()
          })
          .where(eq(countyGisEndpoints.id, existingEndpoint.id));
        updated++;
      } else {
        unchanged++;
      }
    } else {
      await db.insert(countyGisEndpoints).values({
        state: endpoint.state,
        county: endpoint.county,
        baseUrl: endpoint.baseUrl,
        endpointType: endpoint.endpointType,
        notes: endpoint.notes,
        isVerified: endpoint.isVerified
      });
      inserted++;
    }
  }
  
  console.log("\n=== Import Summary ===");
  console.log(`Inserted: ${inserted} new endpoints`);
  console.log(`Updated: ${updated} existing endpoints`);
  console.log(`Unchanged: ${unchanged} endpoints`);
  console.log(`Total processed: ${inserted + updated + unchanged}`);
  
  const finalCount = await db.select().from(countyGisEndpoints);
  console.log(`\nTotal endpoints in database: ${finalCount.length}`);
  
  const byState = finalCount.reduce((acc, ep) => {
    acc[ep.state] = (acc[ep.state] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log("\nEndpoints by state:");
  Object.entries(byState)
    .sort((a, b) => b[1] - a[1])
    .forEach(([state, count]) => {
      console.log(`  ${state}: ${count}`);
    });
}

importGISEndpoints()
  .then(() => {
    console.log("\nImport completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Import failed:", error);
    process.exit(1);
  });
