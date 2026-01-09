import { db } from "../server/db";
import { dataSources } from "../shared/schema";
import { eq, sql, like } from "drizzle-orm";
import * as fs from "fs";

const STATE_SECTIONS = [
  { name: "Alabama", abbr: "AL", lineStart: 1545, lineEnd: 1800 },
  { name: "Alaska", abbr: "AK", lineStart: 1842, lineEnd: 2000 },
  { name: "Arizona", abbr: "AZ", lineStart: 1967, lineEnd: 2200 },
  { name: "Arkansas", abbr: "AR", lineStart: 2200, lineEnd: 2300 },
  { name: "California", abbr: "CA", lineStart: 2400, lineEnd: 4000 },
  { name: "Colorado", abbr: "CO", lineStart: 4000, lineEnd: 4400 },
  { name: "Connecticut", abbr: "CT", lineStart: 4400, lineEnd: 4600 },
  { name: "Delaware", abbr: "DE", lineStart: 4600, lineEnd: 4800 },
  { name: "Florida", abbr: "FL", lineStart: 4800, lineEnd: 5600 },
  { name: "Georgia", abbr: "GA", lineStart: 5600, lineEnd: 6200 },
  { name: "Hawaii", abbr: "HI", lineStart: 6200, lineEnd: 6400 },
  { name: "Idaho", abbr: "ID", lineStart: 6400, lineEnd: 6700 },
  { name: "Illinois", abbr: "IL", lineStart: 6700, lineEnd: 7200 },
  { name: "Indiana", abbr: "IN", lineStart: 7200, lineEnd: 7600 },
  { name: "Iowa", abbr: "IA", lineStart: 7600, lineEnd: 8000 },
  { name: "Kansas", abbr: "KS", lineStart: 8000, lineEnd: 8400 },
  { name: "Kentucky", abbr: "KY", lineStart: 8400, lineEnd: 8800 },
  { name: "Louisiana", abbr: "LA", lineStart: 8800, lineEnd: 9200 },
  { name: "Maine", abbr: "ME", lineStart: 9200, lineEnd: 9500 },
  { name: "Maryland", abbr: "MD", lineStart: 9500, lineEnd: 10000 },
  { name: "Massachusetts", abbr: "MA", lineStart: 10000, lineEnd: 10600 },
  { name: "Michigan", abbr: "MI", lineStart: 10600, lineEnd: 11200 },
  { name: "Minnesota", abbr: "MN", lineStart: 11200, lineEnd: 11700 },
  { name: "Mississippi", abbr: "MS", lineStart: 11700, lineEnd: 12100 },
  { name: "Missouri", abbr: "MO", lineStart: 12100, lineEnd: 12600 },
  { name: "Montana", abbr: "MT", lineStart: 12600, lineEnd: 13000 },
  { name: "Nebraska", abbr: "NE", lineStart: 13000, lineEnd: 13400 },
  { name: "Nevada", abbr: "NV", lineStart: 13400, lineEnd: 13800 },
  { name: "New Hampshire", abbr: "NH", lineStart: 13800, lineEnd: 14100 },
  { name: "New Jersey", abbr: "NJ", lineStart: 14100, lineEnd: 14600 },
  { name: "New Mexico", abbr: "NM", lineStart: 14600, lineEnd: 15000 },
  { name: "New York", abbr: "NY", lineStart: 15000, lineEnd: 16200 },
  { name: "North Carolina", abbr: "NC", lineStart: 16200, lineEnd: 17000 },
  { name: "North Dakota", abbr: "ND", lineStart: 17000, lineEnd: 17300 },
  { name: "Ohio", abbr: "OH", lineStart: 17300, lineEnd: 18000 },
  { name: "Oklahoma", abbr: "OK", lineStart: 18000, lineEnd: 18400 },
  { name: "Oregon", abbr: "OR", lineStart: 18400, lineEnd: 18900 },
  { name: "Pennsylvania", abbr: "PA", lineStart: 18900, lineEnd: 19700 },
  { name: "Rhode Island", abbr: "RI", lineStart: 19700, lineEnd: 19900 },
  { name: "South Carolina", abbr: "SC", lineStart: 19900, lineEnd: 20400 },
  { name: "South Dakota", abbr: "SD", lineStart: 20400, lineEnd: 20700 },
  { name: "Tennessee", abbr: "TN", lineStart: 20700, lineEnd: 21200 },
  { name: "Texas", abbr: "TX", lineStart: 21200, lineEnd: 22500 },
  { name: "Utah", abbr: "UT", lineStart: 22500, lineEnd: 22800 },
];

interface ExtractedEndpoint {
  state: string;
  stateAbbr: string;
  organization: string;
  url: string;
  entityType: string;
}

async function extractUrlsFromContent(content: string): Promise<ExtractedEndpoint[]> {
  const lines = content.split('\n');
  const endpoints: ExtractedEndpoint[] = [];
  
  let currentState = "";
  let currentStateAbbr = "";
  let currentOrg = "";
  let currentEntityType = "county";
  
  const urlPattern = /https?:\/\/[^\s\)\]"'<>]+/g;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines and PDF artifacts
    if (!line || line.length < 5 || line.match(/^\d+\s*$/) || line.match(/^%/)) continue;
    
    // Detect state headers
    for (const section of STATE_SECTIONS) {
      if (line.includes(section.name) && (line.includes("State") || line.includes("County") || line.includes("City"))) {
        currentState = section.name;
        currentStateAbbr = section.abbr;
        
        if (line.includes("County") || line.includes("Borough")) {
          currentEntityType = "county";
        } else if (line.includes("City") || line.includes("Town") || line.includes("Village")) {
          currentEntityType = "city";
        } else if (line.includes("Regional")) {
          currentEntityType = "regional";
        } else if (line.includes("Water")) {
          currentEntityType = "water";
        } else {
          currentEntityType = "state";
        }
        break;
      }
    }
    
    // Detect organization names
    if (!line.includes("http") && !line.includes("GIS:") && !line.includes("Website:")) {
      // Look for county/city names at start of lines
      const orgMatch = line.match(/^([A-Z][a-zA-Z\s\-'\.]+?)(?:\s{2,}|$)/);
      if (orgMatch && orgMatch[1].length > 2 && orgMatch[1].length < 50) {
        currentOrg = orgMatch[1].trim();
      }
    }
    
    // Extract URLs
    const urls = line.match(urlPattern);
    if (urls) {
      for (let url of urls) {
        // Skip dead links
        if (line.includes("dead link") || line.includes("SSL problem")) continue;
        
        // Skip tile servers
        if (url.includes("tiles.arcgis.com")) continue;
        
        // Clean URL
        url = url.replace(/[)\]'"]+$/, '');
        
        // Only process valid GIS URLs
        if (!url.includes("rest/services") && !url.includes("arcgis")) continue;
        
        endpoints.push({
          state: currentState,
          stateAbbr: currentStateAbbr || "US",
          organization: currentOrg || "Unknown",
          url: url,
          entityType: currentEntityType
        });
      }
    }
  }
  
  return endpoints;
}

async function importExtractedEndpoints(endpoints: ExtractedEndpoint[]) {
  console.log(`\nImporting ${endpoints.length} endpoints...`);
  
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const ep of endpoints) {
    try {
      // Check if URL already exists
      const existing = await db.select()
        .from(dataSources)
        .where(eq(dataSources.apiUrl, ep.url))
        .limit(1);
      
      if (existing.length > 0) {
        skipped++;
        continue;
      }
      
      // Generate unique key
      const orgKey = ep.organization
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .substring(0, 25);
      const urlHash = Buffer.from(ep.url).toString('base64').substring(0, 6).replace(/[^a-z0-9]/gi, '');
      const key = `${ep.stateAbbr.toLowerCase()}_${orgKey}_${urlHash}`.substring(0, 63);
      
      // Determine category
      let category = "county_gis";
      let subcategory = "parcels";
      
      switch (ep.entityType) {
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
      }
      
      await db.insert(dataSources).values({
        key,
        title: `${ep.stateAbbr} - ${ep.organization}`,
        category,
        subcategory,
        description: `GIS data from ${ep.organization} in ${ep.state || ep.stateAbbr}`,
        apiUrl: ep.url,
        coverage: ep.stateAbbr,
        accessLevel: "free",
        priority: ep.entityType === "county" ? 1 : 2,
        isEnabled: true
      });
      
      inserted++;
      
      if (inserted % 100 === 0) {
        console.log(`  Inserted ${inserted} endpoints...`);
      }
    } catch (error) {
      failed++;
    }
  }
  
  console.log(`\n=== Import Summary ===`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped (duplicates): ${skipped}`);
  console.log(`Failed: ${failed}`);
  
  return { inserted, skipped, failed };
}

async function main() {
  console.log("=== Enhanced GIS URL Extractor ===\n");
  
  const pdfPath = "attached_assets/list-federal-state-county-city-GIS-servers_1767975191029.pdf";
  const content = fs.readFileSync(pdfPath, "utf-8");
  
  console.log(`PDF size: ${(content.length / 1024 / 1024).toFixed(2)} MB`);
  
  // Extract all GIS URLs
  const extracted = await extractUrlsFromContent(content);
  console.log(`\nExtracted ${extracted.length} total GIS URLs`);
  
  // Group by state
  const byState = extracted.reduce((acc, ep) => {
    const key = ep.stateAbbr || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log("\nEndpoints by state:");
  Object.entries(byState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([state, count]) => {
      console.log(`  ${state}: ${count}`);
    });
  
  // Import
  await importExtractedEndpoints(extracted);
  
  // Final count
  const total = await db.select({ count: sql`count(*)` }).from(dataSources);
  console.log(`\n=== Final Total: ${total[0].count} data sources ===`);
  
  // Category breakdown
  const categories = await db.execute(sql`
    SELECT category, count(*) as cnt 
    FROM data_sources 
    GROUP BY category 
    ORDER BY cnt DESC
    LIMIT 25
  `);
  
  console.log("\nBy category:");
  categories.rows.forEach((row: any) => {
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
