import { db } from "../server/db";
import { dataSources } from "../shared/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";

interface SourceToInsert {
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
  notes?: string;
  priority?: number;
}

async function importAdvancedSources() {
  const raw = fs.readFileSync("/tmp/county_gis_update/advanced_land_investor_data_sources.json", "utf-8");
  const data = JSON.parse(raw);
  const sources: SourceToInsert[] = [];

  for (const [categoryKey, categoryData] of Object.entries(data.categories || {})) {
    const category = categoryKey.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    
    for (const [name, info] of Object.entries(categoryData as Record<string, any>)) {
      const key = `advanced-${categoryKey}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      sources.push({
        key,
        title: name,
        category: "advanced_analytics",
        subcategory: category,
        description: (info as any).use_case || "",
        portalUrl: (info as any).portal_url,
        apiUrl: (info as any).api_endpoint,
        coverage: (info as any).coverage,
        accessLevel: (info as any).pricing?.includes("Free") ? "free" : "paid",
        dataTypes: (info as any).data_types,
        notes: (info as any).pricing,
        priority: 50,
      });
    }
  }
  return sources;
}

async function importGISPortals() {
  const raw = fs.readFileSync("/tmp/county_gis_update/exhaustive_us_gis_portals.json", "utf-8");
  const data = JSON.parse(raw);
  const sources: SourceToInsert[] = [];

  for (const [state, stateData] of Object.entries(data.states || {})) {
    const sd = stateData as any;
    
    if (sd.state_portal) {
      const key = `gis-state-${state.toLowerCase().replace(/\s+/g, "-")}`;
      sources.push({
        key,
        title: `${state} State GIS Portal`,
        category: "county_gis",
        subcategory: state,
        description: `State-level GIS portal for ${state}`,
        portalUrl: sd.state_portal,
        apiUrl: sd.state_gis,
        coverage: state,
        accessLevel: "free",
        dataTypes: ["parcel_data", "property_boundaries", "zoning"],
        priority: 10,
      });
    }

    for (const [county, countyInfo] of Object.entries(sd.counties || {})) {
      const ci = countyInfo as any;
      const key = `gis-county-${state.toLowerCase().replace(/\s+/g, "-")}-${county.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      sources.push({
        key,
        title: `${county}, ${state}`,
        category: "county_gis",
        subcategory: state,
        description: `County GIS portal for ${county}, ${state}`,
        portalUrl: ci.portal,
        coverage: `${county}, ${state}`,
        accessLevel: "free",
        dataTypes: ["parcel_data", "property_boundaries", "tax_maps"],
        notes: ci.status,
        priority: 20,
      });
    }
  }

  for (const [territory, territoryData] of Object.entries(data.territories || {})) {
    const td = territoryData as any;
    if (td.portal) {
      const key = `gis-territory-${territory.toLowerCase().replace(/\s+/g, "-")}`;
      sources.push({
        key,
        title: `${territory} GIS Portal`,
        category: "county_gis",
        subcategory: "Territories",
        description: `GIS portal for ${territory}`,
        portalUrl: td.portal,
        coverage: territory,
        accessLevel: "free",
        dataTypes: ["parcel_data", "property_boundaries"],
        priority: 30,
      });
    }
  }

  for (const [tribalName, tribalData] of Object.entries(data.tribal_nations || {})) {
    const td = tribalData as any;
    if (td.portal) {
      const key = `gis-tribal-${tribalName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      sources.push({
        key,
        title: `${tribalName} GIS`,
        category: "county_gis",
        subcategory: "Tribal Nations",
        description: `Tribal GIS portal for ${tribalName}`,
        portalUrl: td.portal,
        coverage: td.coverage || tribalName,
        accessLevel: "free",
        dataTypes: ["parcel_data", "land_boundaries"],
        priority: 40,
      });
    }
  }

  return sources;
}

async function importRealEstateSources() {
  const raw = fs.readFileSync("/tmp/county_gis_update/us_real_estate_data_sources.json", "utf-8");
  const data = JSON.parse(raw);
  const sources: SourceToInsert[] = [];

  for (const [categoryKey, categoryData] of Object.entries(data.categories || {})) {
    const category = categoryKey.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    
    for (const [name, info] of Object.entries(categoryData as Record<string, any>)) {
      const i = info as any;
      const key = `realestate-${categoryKey}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      sources.push({
        key,
        title: name,
        category: "real_estate_market",
        subcategory: category,
        description: i.description,
        portalUrl: i.portal_url,
        apiUrl: i.api_url,
        coverage: i.coverage,
        accessLevel: i.access_level?.includes("free") || i.access_level?.includes("Free") ? "free" : "limited",
        dataTypes: i.data_types,
        priority: 60,
      });
    }
  }
  return sources;
}

async function main() {
  console.log("Starting import of updated data sources...\n");

  const advancedSources = await importAdvancedSources();
  console.log(`Parsed ${advancedSources.length} advanced analytics sources`);

  const gisSources = await importGISPortals();
  console.log(`Parsed ${gisSources.length} GIS portal sources`);

  const realEstateSources = await importRealEstateSources();
  console.log(`Parsed ${realEstateSources.length} real estate market sources`);

  const allSources = [...advancedSources, ...gisSources, ...realEstateSources];
  console.log(`\nTotal sources to process: ${allSources.length}`);

  let inserted = 0;
  let skipped = 0;

  for (const source of allSources) {
    const existing = await db.select().from(dataSources).where(eq(dataSources.key, source.key)).limit(1);
    
    if (existing.length > 0) {
      skipped++;
      continue;
    }

    await db.insert(dataSources).values({
      key: source.key,
      title: source.title,
      category: source.category,
      subcategory: source.subcategory || null,
      description: source.description || null,
      portalUrl: source.portalUrl || null,
      apiUrl: source.apiUrl || null,
      coverage: source.coverage || null,
      accessLevel: source.accessLevel,
      dataTypes: source.dataTypes || null,
      notes: source.notes || null,
      priority: source.priority || 100,
      isEnabled: true,
      isVerified: false,
    });
    inserted++;
  }

  console.log(`\nImport complete!`);
  console.log(`- Inserted: ${inserted}`);
  console.log(`- Skipped (already exist): ${skipped}`);

  const total = await db.select().from(dataSources);
  console.log(`\nTotal data sources in database: ${total.length}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
