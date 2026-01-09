import { db } from "../server/db";
import { dataSources } from "../shared/schema";
import { eq, sql } from "drizzle-orm";
import * as fs from "fs";

interface GISEndpoint {
  key: string;
  title: string;
  category: string;
  subcategory: string;
  description: string;
  portalUrl?: string;
  apiUrl: string;
  coverage: string;
  accessLevel: string;
  priority: number;
  state: string;
  organization: string;
  entityType: "state" | "county" | "city" | "regional" | "water" | "utility" | "federal";
}

const STATE_ABBREVIATIONS: Record<string, string> = {
  "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
  "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA",
  "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
  "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
  "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO",
  "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
  "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
  "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
  "District of Columbia": "DC", "Puerto Rico": "PR", "Guam": "GU", "Virgin Islands": "VI"
};

function extractGISEndpointsFromPDF(pdfContent: string): GISEndpoint[] {
  const endpoints: GISEndpoint[] = [];
  const lines = pdfContent.split("\n");
  
  let currentState = "";
  let currentEntityType: "state" | "county" | "city" | "regional" | "water" | "utility" | "federal" = "state";
  let currentOrganization = "";
  let currentWebsite = "";
  
  const urlRegex = /https?:\/\/[^\s\)\]]+(?:arcgis|gis|rest\/services)[^\s\)\]]*/gi;
  const stateHeaderRegex = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(State|County|City|Regional|Water|Utility|Borough)/i;
  const orgNameRegex = /^([A-Z][a-zA-Z\s\-&,.'()]+(?:County|City|Town|Village|Borough|District|Department|Agency|Commission|Authority|Board|Office|Division|Service|Association|Council|Project|University|College))/;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines and PDF artifacts
    if (!line || line.startsWith("%") || line.match(/^\d+\s+\d+\s+obj/) || line.length < 3) {
      continue;
    }
    
    // Detect state section headers
    const stateMatch = line.match(stateHeaderRegex);
    if (stateMatch) {
      const stateName = stateMatch[1];
      if (STATE_ABBREVIATIONS[stateName]) {
        currentState = STATE_ABBREVIATIONS[stateName];
      }
      
      const typeStr = stateMatch[2].toLowerCase();
      if (typeStr.includes("county") || typeStr.includes("borough")) {
        currentEntityType = "county";
      } else if (typeStr.includes("city") || typeStr.includes("town") || typeStr.includes("village")) {
        currentEntityType = "city";
      } else if (typeStr.includes("regional")) {
        currentEntityType = "regional";
      } else if (typeStr.includes("water")) {
        currentEntityType = "water";
      } else if (typeStr.includes("utility")) {
        currentEntityType = "utility";
      } else {
        currentEntityType = "state";
      }
      continue;
    }
    
    // Detect organization names (before URLs)
    const orgMatch = line.match(orgNameRegex);
    if (orgMatch && !line.includes("http")) {
      currentOrganization = orgMatch[1].trim();
      continue;
    }
    
    // Look for county/city names at start of line (e.g., "Alameda", "Los Angeles")
    const countyMatch = line.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+https?:\/\//);
    if (countyMatch) {
      currentOrganization = countyMatch[1];
    }
    
    // Detect website URLs
    if (line.toLowerCase().includes("website:")) {
      const websiteMatch = line.match(/https?:\/\/[^\s]+/);
      if (websiteMatch) {
        currentWebsite = websiteMatch[0];
      }
      continue;
    }
    
    // Extract GIS URLs
    const gisUrls = line.match(urlRegex);
    if (gisUrls) {
      for (const url of gisUrls) {
        // Skip dead links, SSL problems, and tile-only services
        if (line.includes("dead link") || line.includes("SSL problem") || line.includes("not https")) {
          continue;
        }
        
        // Skip tile servers (we want feature servers primarily)
        if (url.includes("tiles.arcgis.com")) {
          continue;
        }
        
        // Clean up URL
        let cleanUrl = url.replace(/[)\]'"]+$/, "").trim();
        
        // Validate URL structure
        if (!cleanUrl.includes("rest/services") && !cleanUrl.includes("arcgis")) {
          continue;
        }
        
        // Generate unique key
        const orgKey = currentOrganization
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .substring(0, 30);
        
        const urlHash = Buffer.from(cleanUrl).toString("base64").substring(0, 8).replace(/[^a-z0-9]/gi, "");
        const key = `${currentState.toLowerCase()}_${orgKey}_${urlHash}`.substring(0, 63);
        
        // Determine category
        let category = "county_gis";
        let subcategory = "parcels";
        
        switch (currentEntityType) {
          case "state":
            category = "state_gis";
            subcategory = "multi_layer";
            break;
          case "city":
            category = "city_gis";
            subcategory = "municipal";
            break;
          case "regional":
            category = "regional_gis";
            subcategory = "planning";
            break;
          case "water":
            category = "water_district";
            subcategory = "water";
            break;
          case "utility":
            category = "utility_district";
            subcategory = "infrastructure";
            break;
          case "county":
          default:
            category = "county_gis";
            subcategory = "parcels";
        }
        
        // Determine priority based on type
        let priority = 2;
        if (currentEntityType === "county") priority = 1;
        if (currentEntityType === "state") priority = 1;
        if (cleanUrl.includes("parcel") || cleanUrl.includes("Parcel")) priority = 1;
        
        const endpoint: GISEndpoint = {
          key,
          title: `${currentState} - ${currentOrganization || "GIS Services"}`,
          category,
          subcategory,
          description: `GIS data from ${currentOrganization || "local government"} in ${currentState}`,
          portalUrl: currentWebsite || undefined,
          apiUrl: cleanUrl,
          coverage: currentState,
          accessLevel: "free",
          priority,
          state: currentState,
          organization: currentOrganization,
          entityType: currentEntityType
        };
        
        endpoints.push(endpoint);
      }
    }
  }
  
  return endpoints;
}

async function validateEndpoint(url: string, timeout: number = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(`${url}?f=json`, {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

async function importEndpoints(endpoints: GISEndpoint[], validateFirst: boolean = false) {
  console.log(`\nStarting import of ${endpoints.length} endpoints...`);
  
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  
  // Process in batches to avoid overwhelming the database
  const batchSize = 50;
  
  for (let i = 0; i < endpoints.length; i += batchSize) {
    const batch = endpoints.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(endpoints.length / batchSize)}...`);
    
    for (const endpoint of batch) {
      try {
        // Check if endpoint already exists by URL
        const existingByUrl = await db.select()
          .from(dataSources)
          .where(eq(dataSources.apiUrl, endpoint.apiUrl))
          .limit(1);
        
        if (existingByUrl.length > 0) {
          skipped++;
          continue;
        }
        
        // Check if we have a similar endpoint that might need updating
        const existingByKey = await db.select()
          .from(dataSources)
          .where(eq(dataSources.key, endpoint.key))
          .limit(1);
        
        if (existingByKey.length > 0) {
          // Update existing record with new URL
          await db.update(dataSources)
            .set({
              apiUrl: endpoint.apiUrl,
              title: endpoint.title,
              updatedAt: new Date()
            })
            .where(eq(dataSources.id, existingByKey[0].id));
          updated++;
        } else {
          // Insert new record
          await db.insert(dataSources).values({
            key: endpoint.key,
            title: endpoint.title,
            category: endpoint.category,
            subcategory: endpoint.subcategory,
            description: endpoint.description,
            portalUrl: endpoint.portalUrl || null,
            apiUrl: endpoint.apiUrl,
            coverage: endpoint.coverage,
            accessLevel: endpoint.accessLevel,
            priority: endpoint.priority,
            isEnabled: true
          });
          inserted++;
        }
      } catch (error) {
        failed++;
        // Likely duplicate key - skip silently
      }
    }
  }
  
  console.log(`\n=== Import Summary ===`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (duplicate URLs): ${skipped}`);
  console.log(`Failed: ${failed}`);
  
  return { inserted, updated, skipped, failed };
}

async function checkAndReplaceFailedEndpoints() {
  console.log("\n=== Checking for failed endpoints to replace ===");
  
  // Get all existing endpoints
  const allEndpoints = await db.select().from(dataSources);
  console.log(`Total endpoints in database: ${allEndpoints.length}`);
  
  // Sample check - test 20 random endpoints
  const sampleSize = Math.min(20, allEndpoints.length);
  const shuffled = allEndpoints.sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, sampleSize);
  
  let working = 0;
  let failing = 0;
  
  console.log(`\nTesting ${sampleSize} random endpoints...`);
  
  for (const endpoint of sample) {
    if (!endpoint.apiUrl) continue;
    const isWorking = await validateEndpoint(endpoint.apiUrl);
    if (isWorking) {
      working++;
      process.stdout.write(".");
    } else {
      failing++;
      process.stdout.write("x");
    }
  }
  
  console.log(`\n\nResults: ${working} working, ${failing} failing`);
  console.log(`Estimated health: ${((working / sampleSize) * 100).toFixed(1)}%`);
}

async function main() {
  console.log("=== Comprehensive GIS Import Tool ===\n");
  
  // Read the PDF content
  const pdfPath = "attached_assets/list-federal-state-county-city-GIS-servers_1767975191029.pdf";
  
  if (!fs.existsSync(pdfPath)) {
    console.error("PDF file not found:", pdfPath);
    process.exit(1);
  }
  
  console.log("Reading PDF content...");
  const pdfContent = fs.readFileSync(pdfPath, "utf-8");
  console.log(`PDF content length: ${pdfContent.length} characters`);
  
  console.log("\nExtracting GIS endpoints...");
  const endpoints = extractGISEndpointsFromPDF(pdfContent);
  console.log(`Found ${endpoints.length} potential GIS endpoints`);
  
  // Show breakdown by type
  const byType = endpoints.reduce((acc, ep) => {
    acc[ep.entityType] = (acc[ep.entityType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log("\nEndpoints by type:");
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
  
  // Show breakdown by state
  const byState = endpoints.reduce((acc, ep) => {
    acc[ep.state] = (acc[ep.state] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log(`\nEndpoints by state (top 15):`);
  Object.entries(byState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([state, count]) => {
      console.log(`  ${state}: ${count}`);
    });
  
  // Import endpoints
  const results = await importEndpoints(endpoints);
  
  // Check endpoint health
  await checkAndReplaceFailedEndpoints();
  
  // Final count
  const finalCount = await db.select({ count: sql`count(*)` }).from(dataSources);
  console.log(`\n=== Final Database Status ===`);
  console.log(`Total data sources: ${finalCount[0].count}`);
  
  // Category breakdown
  const categoryBreakdown = await db.execute(sql`
    SELECT category, count(*) as cnt 
    FROM data_sources 
    GROUP BY category 
    ORDER BY cnt DESC 
    LIMIT 20
  `);
  
  console.log("\nTop categories:");
  categoryBreakdown.rows.forEach((row: any) => {
    console.log(`  ${row.category}: ${row.cnt}`);
  });
}

main()
  .then(() => {
    console.log("\n=== Import completed successfully! ===");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Import failed:", error);
    process.exit(1);
  });
