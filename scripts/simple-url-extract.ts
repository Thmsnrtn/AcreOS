import { db } from "../server/db";
import { dataSources } from "../shared/schema";
import { eq, sql } from "drizzle-orm";
import * as fs from "fs";

async function main() {
  console.log("=== Simple URL Extraction ===\n");
  
  const pdfPath = "attached_assets/list-federal-state-county-city-GIS-servers_1767975191029.pdf";
  const content = fs.readFileSync(pdfPath, "utf-8");
  
  // Extract all URLs that look like GIS REST services
  const urlPattern = /https?:\/\/[a-zA-Z0-9\-\.]+(?:\/[a-zA-Z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;=%]*)?rest\/services[^\s\)\]"']*/gi;
  
  const allUrls = content.match(urlPattern) || [];
  console.log(`Found ${allUrls.length} potential GIS URLs`);
  
  // Clean and deduplicate
  const cleanedUrls = new Set<string>();
  
  for (let url of allUrls) {
    // Clean trailing characters
    url = url.replace(/[)\]'"<>,]+$/, '');
    
    // Skip tile servers
    if (url.includes('tiles.arcgis.com')) continue;
    
    // Skip if too short
    if (url.length < 30) continue;
    
    cleanedUrls.add(url);
  }
  
  console.log(`Unique valid URLs: ${cleanedUrls.size}`);
  
  // Get existing URLs
  const existing = await db.select({ url: dataSources.apiUrl }).from(dataSources);
  const existingUrls = new Set(existing.map(e => e.url));
  
  console.log(`Existing URLs in database: ${existingUrls.size}`);
  
  // Find new URLs
  const newUrls: string[] = [];
  for (const url of cleanedUrls) {
    if (!existingUrls.has(url)) {
      newUrls.push(url);
    }
  }
  
  console.log(`New URLs to add: ${newUrls.length}`);
  
  // Import new URLs
  let inserted = 0;
  let failed = 0;
  
  for (const url of newUrls) {
    try {
      // Extract domain for naming
      const domainMatch = url.match(/https?:\/\/([^\/]+)/);
      const domain = domainMatch ? domainMatch[1] : 'unknown';
      
      // Generate key
      const urlHash = Buffer.from(url).toString('base64').substring(0, 12).replace(/[^a-z0-9]/gi, '');
      const domainKey = domain.replace(/[^a-z0-9]/gi, '_').substring(0, 30);
      const key = `gis_${domainKey}_${urlHash}`.substring(0, 63);
      
      // Determine if it's county, city, or state based on URL patterns
      let category = "county_gis";
      let title = `GIS - ${domain}`;
      
      if (url.includes('.gov/') || url.includes('state.')) {
        category = "state_gis";
      } else if (url.includes('city') || url.includes('ci.') || url.includes('.org')) {
        category = "city_gis";
      }
      
      await db.insert(dataSources).values({
        key,
        title,
        category,
        subcategory: "parcels",
        description: `GIS REST services at ${domain}`,
        apiUrl: url,
        coverage: "US",
        accessLevel: "free",
        priority: 2,
        isEnabled: true
      });
      
      inserted++;
      
      if (inserted % 100 === 0) {
        console.log(`  Inserted ${inserted}...`);
      }
    } catch (error) {
      failed++;
    }
  }
  
  console.log(`\n=== Results ===`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Failed: ${failed}`);
  
  // Final count
  const total = await db.select({ count: sql`count(*)` }).from(dataSources);
  console.log(`\nTotal data sources: ${total[0].count}`);
  
  // Category breakdown
  const categories = await db.execute(sql`
    SELECT category, count(*) as cnt 
    FROM data_sources 
    GROUP BY category 
    ORDER BY cnt DESC
    LIMIT 15
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
