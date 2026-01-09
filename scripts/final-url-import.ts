import { db } from "../server/db";
import { dataSources } from "../shared/schema";
import { eq, sql } from "drizzle-orm";
import * as fs from "fs";
import * as crypto from "crypto";

async function main() {
  console.log("=== Final URL Import (with unique keys) ===\n");
  
  const pdfPath = "attached_assets/list-federal-state-county-city-GIS-servers_1767975191029.pdf";
  const content = fs.readFileSync(pdfPath, "utf-8");
  
  // More aggressive URL pattern
  const urlPatterns = [
    /https?:\/\/[^\s\)\]"'<>]+arcgis[^\s\)\]"'<>]*/gi,
    /https?:\/\/[^\s\)\]"'<>]+rest\/services[^\s\)\]"'<>]*/gi,
    /https?:\/\/[^\s\)\]"'<>]+gis[^\s\)\]"'<>]*rest\/services[^\s\)\]"'<>]*/gi,
    /https?:\/\/services[0-9]?\.arcgis\.com\/[^\s\)\]"'<>]+/gi
  ];
  
  const allUrls = new Set<string>();
  
  for (const pattern of urlPatterns) {
    const matches = content.match(pattern) || [];
    for (let url of matches) {
      url = url.replace(/[)\]'"<>,;]+$/, '').trim();
      if (url.includes('tiles.arcgis.com')) continue;
      if (url.length < 25) continue;
      allUrls.add(url);
    }
  }
  
  console.log(`Found ${allUrls.size} unique URLs from PDF`);
  
  // Get all existing URLs
  const existing = await db.select({ url: dataSources.apiUrl }).from(dataSources);
  const existingUrls = new Set(existing.filter(e => e.url).map(e => e.url!));
  
  console.log(`Existing URLs in database: ${existingUrls.size}`);
  
  // Filter to new URLs only
  const newUrls: string[] = [];
  for (const url of allUrls) {
    if (!existingUrls.has(url)) {
      newUrls.push(url);
    }
  }
  
  console.log(`New URLs to add: ${newUrls.length}`);
  
  if (newUrls.length === 0) {
    console.log("No new URLs to add!");
    return;
  }
  
  // Import with unique hash-based keys
  let inserted = 0;
  let failed = 0;
  
  for (const url of newUrls) {
    try {
      // Generate truly unique key using MD5 hash of URL
      const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 16);
      const key = `gis_${hash}`;
      
      // Extract domain for title
      const domainMatch = url.match(/https?:\/\/([^\/]+)/);
      const domain = domainMatch ? domainMatch[1].replace('www.', '') : 'unknown';
      
      // Categorize
      let category = "county_gis";
      
      if (domain.includes('.gov') || domain.includes('state.') || domain.includes('.us')) {
        if (domain.includes('city') || domain.includes('ci.')) {
          category = "city_gis";
        } else {
          category = "state_gis";
        }
      } else if (domain.includes('services') && domain.includes('arcgis.com')) {
        category = "regional_gis";
      }
      
      await db.insert(dataSources).values({
        key,
        title: `GIS - ${domain}`,
        category,
        subcategory: "multi_layer",
        description: `GIS REST services from ${domain}`,
        apiUrl: url,
        coverage: "US",
        accessLevel: "free",
        priority: 2,
        isEnabled: true
      });
      
      inserted++;
      
      if (inserted % 200 === 0) {
        console.log(`  Inserted ${inserted}...`);
      }
    } catch (error: any) {
      failed++;
      if (failed <= 5) {
        console.log(`  Error: ${error.message?.substring(0, 80)}`);
      }
    }
  }
  
  console.log(`\n=== Import Results ===`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Failed: ${failed}`);
  
  // Final count
  const total = await db.select({ count: sql`count(*)` }).from(dataSources);
  console.log(`\n=== TOTAL DATA SOURCES: ${total[0].count} ===`);
  
  // Category breakdown
  const categories = await db.execute(sql`
    SELECT category, count(*) as cnt 
    FROM data_sources 
    GROUP BY category 
    ORDER BY cnt DESC
    LIMIT 20
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
