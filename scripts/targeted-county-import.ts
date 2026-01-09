import { db } from "../server/db";
import { dataSources } from "../shared/schema";
import { eq, sql } from "drizzle-orm";
import * as fs from "fs";

interface CountyEndpoint {
  state: string;
  county: string;
  url: string;
}

async function extractCountyEndpoints(): Promise<CountyEndpoint[]> {
  const pdfPath = "attached_assets/list-federal-state-county-city-GIS-servers_1767975191029.pdf";
  const content = fs.readFileSync(pdfPath, "utf-8");
  const lines = content.split('\n');
  
  const endpoints: CountyEndpoint[] = [];
  
  let currentState = "";
  let currentCounty = "";
  let inCountySection = false;
  
  const stateMap: Record<string, string> = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
    "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO",
    "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ",
    "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
    "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
    "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"
  };
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines and PDF artifacts
    if (!trimmed || trimmed.length < 3) continue;
    
    // Detect state headers for county sections
    for (const [stateName, abbr] of Object.entries(stateMap)) {
      if (trimmed.includes(`${stateName} County GIS`) || 
          trimmed.includes(`${stateName} Borough GIS`) ||
          trimmed.includes(`${stateName} Parish GIS`)) {
        currentState = abbr;
        inCountySection = true;
        break;
      }
      
      // Exit county section when hitting city section
      if (trimmed.includes(`${stateName} City GIS`) ||
          trimmed.includes(`${stateName} Regional`) ||
          trimmed.includes(`${stateName} Water`)) {
        if (currentState === abbr) {
          inCountySection = false;
        }
      }
    }
    
    if (!inCountySection || !currentState) continue;
    
    // Pattern: CountyName followed by URL on same or next line
    // Examples:
    // Adams                  https://gisapp.adcogov.org/arcgis/rest/services
    // Alameda               https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/...
    
    const urlMatch = trimmed.match(/(https?:\/\/[^\s\)\]"']+)/);
    
    if (urlMatch) {
      let url = urlMatch[1];
      
      // Skip problematic URLs
      if (line.includes("dead link") || line.includes("SSL problem") || 
          url.includes("tiles.arcgis.com")) {
        continue;
      }
      
      // Clean URL
      url = url.replace(/[)\]'"]+$/, '');
      
      // Only GIS URLs
      if (!url.includes("rest/services") && !url.includes("arcgis")) {
        continue;
      }
      
      // Try to extract county name from line
      const countyMatch = trimmed.match(/^([A-Z][a-zA-Z\s\-'\.]+?)\s{2,}https?:\/\//);
      if (countyMatch) {
        currentCounty = countyMatch[1].trim();
      }
      
      // Also check previous line for county name if not found
      if (!currentCounty && i > 0) {
        const prevLine = lines[i-1].trim();
        if (prevLine && !prevLine.includes("http") && prevLine.match(/^[A-Z][a-zA-Z\s\-'\.]+$/)) {
          currentCounty = prevLine;
        }
      }
      
      if (currentCounty && currentState) {
        endpoints.push({
          state: currentState,
          county: currentCounty,
          url: url
        });
      }
    } else {
      // This might be a county name line
      const nameMatch = trimmed.match(/^([A-Z][a-zA-Z\s\-'\.]+)$/);
      if (nameMatch && !trimmed.includes("GIS") && !trimmed.includes("Server")) {
        currentCounty = nameMatch[1].trim();
      }
    }
  }
  
  return endpoints;
}

async function importCountyEndpoints(endpoints: CountyEndpoint[]) {
  console.log(`\nImporting ${endpoints.length} county endpoints...`);
  
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  
  // Deduplicate by URL
  const uniqueUrls = new Map<string, CountyEndpoint>();
  for (const ep of endpoints) {
    if (!uniqueUrls.has(ep.url)) {
      uniqueUrls.set(ep.url, ep);
    }
  }
  
  console.log(`Unique URLs: ${uniqueUrls.size}`);
  
  for (const [url, ep] of uniqueUrls) {
    try {
      // Check if URL already exists
      const existing = await db.select()
        .from(dataSources)
        .where(eq(dataSources.apiUrl, url))
        .limit(1);
      
      if (existing.length > 0) {
        skipped++;
        continue;
      }
      
      // Generate unique key
      const countyKey = ep.county
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 25);
      
      const urlHash = Buffer.from(url).toString('base64').substring(0, 6).replace(/[^a-z0-9]/gi, '');
      const key = `${ep.state.toLowerCase()}_county_${countyKey}_${urlHash}`.substring(0, 63);
      
      await db.insert(dataSources).values({
        key,
        title: `${ep.county} County, ${ep.state}`,
        category: "county_gis",
        subcategory: "parcels",
        description: `County GIS data for ${ep.county} County in ${ep.state}`,
        apiUrl: url,
        coverage: ep.state,
        accessLevel: "free",
        priority: 1,
        isEnabled: true
      });
      
      inserted++;
      
      if (inserted % 50 === 0) {
        console.log(`  Inserted ${inserted}...`);
      }
    } catch (error) {
      failed++;
    }
  }
  
  console.log(`\n=== Import Summary ===`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped (duplicate URLs): ${skipped}`);
  console.log(`Failed: ${failed}`);
  
  return { inserted, skipped, failed };
}

async function main() {
  console.log("=== Targeted County GIS Import ===\n");
  
  // Extract county endpoints
  const endpoints = await extractCountyEndpoints();
  console.log(`Extracted ${endpoints.length} county endpoints`);
  
  // Group by state
  const byState = endpoints.reduce((acc, ep) => {
    acc[ep.state] = (acc[ep.state] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log("\nCounty endpoints by state:");
  Object.entries(byState)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([state, count]) => {
      console.log(`  ${state}: ${count}`);
    });
  
  // Import
  await importCountyEndpoints(endpoints);
  
  // Final stats
  const total = await db.select({ count: sql`count(*)` }).from(dataSources);
  console.log(`\n=== Total Data Sources: ${total[0].count} ===`);
  
  // County coverage
  const countyCount = await db.execute(sql`
    SELECT coverage, count(*) as cnt 
    FROM data_sources 
    WHERE category = 'county_gis'
    GROUP BY coverage 
    ORDER BY cnt DESC
    LIMIT 30
  `);
  
  console.log("\nCounty GIS by state:");
  countyCount.rows.forEach((row: any) => {
    console.log(`  ${row.coverage}: ${row.cnt}`);
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
