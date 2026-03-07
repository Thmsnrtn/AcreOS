/**
 * AcreOS MCP Server
 *
 * Exposes AcreOS property intelligence as MCP tools so Claude Desktop
 * (or any MCP-compatible host) can perform live land-data lookups,
 * property enrichments, and portfolio queries on behalf of users.
 *
 * Transport options:
 *  - stdio  : run `npx tsx server/mcp/index.ts` and point Claude Desktop at it
 *  - http   : mounted at /mcp via Express (server/index.ts)
 *
 * All free-tier public data sources are used by default (FEMA, NWI, USDA,
 * EPA, Census, USGS, BLM, NPS, USFS, DOT, Open-Meteo, NLCD, …).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { dataSourceBroker } from "../services/data-source-broker.js";
import { propertyEnrichmentService } from "../services/propertyEnrichment.js";
import { storage } from "../storage.js";

// ─── Helper ──────────────────────────────────────────────────────────────────

function ok(data: unknown, note?: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: note
          ? `${note}\n\n${JSON.stringify(data, null, 2)}`
          : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function err(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

// ─── Server ──────────────────────────────────────────────────────────────────

export function createMcpServer() {
  const server = new McpServer({
    name: "AcreOS",
    version: "1.0.0",
  });

  // ── 1. Flood Zone ─────────────────────────────────────────────────────────
  server.tool(
    "get_flood_zone",
    "Look up the FEMA flood zone classification for a lat/lng coordinate. Returns zone label (e.g. Zone AE) and risk level. Free – uses FEMA NFHL ArcGIS REST service.",
    {
      latitude: z.number().describe("Decimal latitude (WGS84)"),
      longitude: z.number().describe("Decimal longitude (WGS84)"),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("flood_zone", { latitude, longitude });
        return ok(result.data, `Flood zone data via ${result.source.title}`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 2. Wetlands ───────────────────────────────────────────────────────────
  server.tool(
    "get_wetlands",
    "Check USFWS National Wetlands Inventory (NWI) for wetlands at a coordinate. Free API.",
    {
      latitude: z.number().describe("Decimal latitude"),
      longitude: z.number().describe("Decimal longitude"),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("wetlands", { latitude, longitude });
        return ok(result.data, "NWI Wetlands data:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 3. Soil Data ─────────────────────────────────────────────────────────
  server.tool(
    "get_soil_data",
    "Retrieve USDA NRCS SSURGO soil survey data (soil type, hydrologic group, drainage class) for a coordinate. Free API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("soil", { latitude, longitude });
        return ok(result.data, "USDA Soil Survey data:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 4. Demographics ───────────────────────────────────────────────────────
  server.tool(
    "get_demographics",
    "Fetch Census ACS 5-year demographic estimates (population, median income, home value, unemployment) for a coordinate's census tract. Free API.",
    {
      latitude: z.number(),
      longitude: z.number(),
      state: z.string().optional().describe("Two-letter state code (optional, improves accuracy)"),
    },
    async ({ latitude, longitude, state }) => {
      try {
        const result = await dataSourceBroker.lookup("demographics", { latitude, longitude, state });
        return ok(result.data, "Census ACS 5-Year Estimates:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 5. Public Lands ───────────────────────────────────────────────────────
  server.tool(
    "get_public_lands",
    "Check if a coordinate is on BLM, NPS, or USFS managed land. Returns managing agency and unit details. Free API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("public_lands", { latitude, longitude });
        return ok(result.data, "Public Lands data (BLM/NPS/USFS):");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 6. Natural Hazards ────────────────────────────────────────────────────
  server.tool(
    "get_natural_hazards",
    "Get natural hazard data: recent USGS earthquakes within 100km, active WFIGS wildfire perimeters within 50km, and FEMA flood information. Free APIs.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("natural_hazards", { latitude, longitude });
        return ok(result.data, "Natural Hazards assessment:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 7. Infrastructure ─────────────────────────────────────────────────────
  server.tool(
    "get_infrastructure",
    "Find hospitals, fire stations, and schools within 10 miles of a coordinate using HIFLD federal datasets. Free API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("infrastructure", { latitude, longitude });
        return ok(result.data, "Infrastructure within 10 miles:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 8. Transportation ─────────────────────────────────────────────────────
  server.tool(
    "get_transportation",
    "Find highways (NHPN), bridges (NBI), and railroads within 5 miles of a coordinate. Free DOT/ESRI APIs.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("transportation", { latitude, longitude });
        return ok(result.data, "Transportation data:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 9. Water Resources ────────────────────────────────────────────────────
  server.tool(
    "get_water_resources",
    "Fetch USGS stream gauge data, current flow conditions, and HUC12 watershed information near a coordinate. Free API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("water_resources", { latitude, longitude });
        return ok(result.data, "Water resources data:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 10. Elevation ─────────────────────────────────────────────────────────
  server.tool(
    "get_elevation",
    "Get precise elevation in feet and meters from USGS 3DEP National Elevation Dataset. Falls back to SRTM via Open-Elevation. Free API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("elevation", { latitude, longitude });
        return ok(result.data, "Elevation data:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 11. Climate ───────────────────────────────────────────────────────────
  server.tool(
    "get_climate",
    "Get 30-year climate normals (1991-2020): average high/low temperatures and annual precipitation. Uses Open-Meteo ERA5 reanalysis. Free, no API key required.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("climate", { latitude, longitude });
        return ok(result.data, "30-year climate normals:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 12. Agricultural Land Values ──────────────────────────────────────────
  server.tool(
    "get_agricultural_values",
    "Get USDA farm real estate land values per acre at county, state, and national levels. Uses USDA ERS and NASS QuickStats. Free API.",
    {
      latitude: z.number(),
      longitude: z.number(),
      state: z.string().optional().describe("Two-letter state code"),
      county: z.string().optional().describe("County name"),
    },
    async ({ latitude, longitude, state, county }) => {
      try {
        const result = await dataSourceBroker.lookup("agricultural_values", { latitude, longitude, state, county });
        return ok(result.data, "USDA agricultural land values:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 13. Land Cover ────────────────────────────────────────────────────────
  server.tool(
    "get_land_cover",
    "Get USGS National Land Cover Database (NLCD 2021) land cover class for a coordinate: cropland, forest, wetland, developed, etc. Free ArcGIS REST API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("land_cover", { latitude, longitude });
        return ok(result.data, "NLCD 2021 land cover:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 14. Full Property Enrichment ──────────────────────────────────────────
  server.tool(
    "enrich_property",
    "Run a comprehensive free-data enrichment on a coordinate: floods, wetlands, soil, environmental, infrastructure, hazards, demographics, public lands, transportation, water, elevation, climate, ag values, and land cover — all from free public APIs in one call.",
    {
      latitude: z.number().describe("Decimal latitude (WGS84)"),
      longitude: z.number().describe("Decimal longitude (WGS84)"),
      state: z.string().optional().describe("Two-letter state code"),
      county: z.string().optional().describe("County name"),
      apn: z.string().optional().describe("Assessor Parcel Number"),
    },
    async ({ latitude, longitude, state, county, apn }) => {
      try {
        const enrichment = await propertyEnrichmentService.enrichByCoordinates(latitude, longitude, {
          state,
          county,
          apn,
        });
        return ok(enrichment, "Full property enrichment (all free public data sources):");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 15. Reverse Geocode ───────────────────────────────────────────────────
  server.tool(
    "reverse_geocode",
    "Convert lat/lng coordinates to a street address using Nominatim (OpenStreetMap). Free, no API key required.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=jsonv2&addressdetails=1`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "AcreOS Land Investment Platform (contact@acreos.com)",
            "Accept-Language": "en",
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);
        const data = await res.json();
        return ok({
          displayName: data.display_name,
          address: data.address,
          placeId: data.place_id,
          osmType: data.osm_type,
          category: data.category,
          type: data.type,
          source: "OpenStreetMap Nominatim",
        }, "Reverse geocode result:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 16. Forward Geocode ───────────────────────────────────────────────────
  server.tool(
    "geocode_address",
    "Convert a street address or place name to lat/lng coordinates using Nominatim (OpenStreetMap). Free, no API key required.",
    {
      address: z.string().describe("Street address, city, or place name to geocode"),
      country: z.string().optional().default("US").describe("Country code (default: US)"),
    },
    async ({ address, country }) => {
      try {
        const query = encodeURIComponent(address);
        const url = `https://nominatim.openstreetmap.org/search?q=${query}&countrycodes=${country}&format=jsonv2&addressdetails=1&limit=5`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "AcreOS Land Investment Platform (contact@acreos.com)",
            "Accept-Language": "en",
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);
        const results = await res.json();
        return ok(
          results.map((r: any) => ({
            displayName: r.display_name,
            latitude: parseFloat(r.lat),
            longitude: parseFloat(r.lon),
            importance: r.importance,
            address: r.address,
            type: r.type,
            source: "OpenStreetMap Nominatim",
          })),
          `Geocode results for "${address}":`
        );
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 17. EPA Environmental Query ───────────────────────────────────────────
  server.tool(
    "get_epa_data",
    "Search EPA TRI (Toxic Release Inventory) facilities within 3 miles of a coordinate. Free EPA Envirofacts API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("environmental", { latitude, longitude });
        return ok(result.data, "EPA environmental data:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 18. Search Organization Properties ───────────────────────────────────
  server.tool(
    "search_properties",
    "Search properties in an AcreOS organization's portfolio by state, county, status, or free-text. Returns a list of matching properties.",
    {
      organizationId: z.number().describe("AcreOS organization ID"),
      state: z.string().optional().describe("Filter by state (two-letter code)"),
      county: z.string().optional().describe("Filter by county name"),
      status: z.string().optional().describe("Filter by status (available, under_contract, sold, etc.)"),
      limit: z.number().optional().default(20).describe("Max results to return"),
    },
    async ({ organizationId, state, county, status, limit }) => {
      try {
        const all = await storage.getProperties(organizationId);
        let filtered = all;
        if (state) filtered = filtered.filter(p => p.state?.toUpperCase() === state.toUpperCase());
        if (county) filtered = filtered.filter(p => p.county?.toLowerCase().includes(county.toLowerCase()));
        if (status) filtered = filtered.filter(p => p.status === status);
        const sliced = filtered.slice(0, limit ?? 20);
        return ok(sliced.map(p => ({
          id: p.id,
          address: p.address,
          city: p.city,
          state: p.state,
          county: p.county,
          sizeAcres: p.sizeAcres,
          status: p.status,
          listPrice: p.listPrice,
          purchasePrice: p.purchasePrice,
          latitude: p.latitude,
          longitude: p.longitude,
          apn: p.apn,
        })), `Found ${sliced.length} of ${filtered.length} matching properties:`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 19. Get Property Details ──────────────────────────────────────────────
  server.tool(
    "get_property",
    "Get full details for a specific property by ID within an AcreOS organization.",
    {
      organizationId: z.number(),
      propertyId: z.number(),
    },
    async ({ organizationId, propertyId }) => {
      try {
        const property = await storage.getProperty(organizationId, propertyId);
        if (!property) return err(`Property ${propertyId} not found`);
        return ok(property, `Property #${propertyId}:`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 20. Search Leads ──────────────────────────────────────────────────────
  server.tool(
    "search_leads",
    "Search leads/sellers in an AcreOS organization by state, county, lead score range, or status.",
    {
      organizationId: z.number(),
      state: z.string().optional(),
      county: z.string().optional(),
      minScore: z.number().optional().describe("Minimum lead score (0-100)"),
      status: z.string().optional().describe("Lead status filter"),
      limit: z.number().optional().default(20),
    },
    async ({ organizationId, state, county, minScore, status, limit }) => {
      try {
        const all = await storage.getLeads(organizationId);
        let filtered: any[] = all;
        if (state) filtered = filtered.filter((l: any) => l.state?.toUpperCase() === state.toUpperCase());
        if (county) filtered = filtered.filter((l: any) => l.address?.toLowerCase().includes(county.toLowerCase()));
        if (minScore !== undefined) filtered = filtered.filter((l: any) => (l.score ?? 0) >= minScore);
        if (status) filtered = filtered.filter((l: any) => l.status === status);
        const sliced = filtered.slice(0, limit ?? 20);
        return ok(sliced.map((l: any) => ({
          id: l.id,
          firstName: l.firstName,
          lastName: l.lastName,
          email: l.email,
          phone: l.phone,
          state: l.state,
          score: l.score,
          status: l.status,
          createdAt: l.createdAt,
        })), `Found ${sliced.length} of ${filtered.length} matching leads:`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 21. Get Deals ─────────────────────────────────────────────────────────
  server.tool(
    "get_deals",
    "Retrieve active deals in an AcreOS organization's pipeline. Optionally filter by stage.",
    {
      organizationId: z.number(),
      stage: z.string().optional().describe("Pipeline stage filter (e.g. due_diligence, offer, closed)"),
      limit: z.number().optional().default(20),
    },
    async ({ organizationId, stage, limit }) => {
      try {
        const all = await storage.getDeals(organizationId);
        let filtered = stage ? all.filter((d: any) => d.status === stage) : all;
        const sliced = filtered.slice(0, limit ?? 20);
        return ok(sliced.map((d: any) => ({
          id: d.id,
          type: d.type,
          status: d.status,
          propertyId: d.propertyId,
          offerAmount: d.offerAmount,
          acceptedAmount: d.acceptedAmount,
          closingDate: d.closingDate,
          createdAt: d.createdAt,
        })), `Found ${sliced.length} of ${filtered.length} deals:`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 22. Portfolio Summary ─────────────────────────────────────────────────
  server.tool(
    "get_portfolio_summary",
    "Get a high-level summary of an organization's AcreOS portfolio: lead counts, property counts, deal pipeline, active seller-financed notes, and monthly cash flow.",
    {
      organizationId: z.number(),
    },
    async ({ organizationId }) => {
      try {
        const [org, leads, properties, deals, notes] = await Promise.all([
          storage.getOrganization(organizationId),
          storage.getLeads(organizationId),
          storage.getProperties(organizationId),
          storage.getDeals(organizationId),
          storage.getNotes(organizationId),
        ]);

        const activeNotes = notes.filter((n: any) => n.status === "active");
        const monthlyCashflow = activeNotes.reduce((s: number, n: any) => s + Number(n.monthlyPayment ?? 0), 0);
        const totalOutstanding = activeNotes.reduce((s: number, n: any) => s + Number(n.currentBalance ?? 0), 0);
        const pipelineValue = deals.reduce((s: number, d: any) => s + Number(d.offerAmount ?? d.acceptedAmount ?? 0), 0);

        return ok({
          organization: { id: org?.id, name: (org as any)?.name },
          leads: {
            total: leads.length,
            byStatus: leads.reduce((acc: Record<string, number>, l) => { acc[l.status ?? "unknown"] = (acc[l.status ?? "unknown"] ?? 0) + 1; return acc; }, {}),
          },
          properties: {
            total: properties.length,
            byStatus: properties.reduce((acc: Record<string, number>, p) => { acc[p.status ?? "unknown"] = (acc[p.status ?? "unknown"] ?? 0) + 1; return acc; }, {}),
          },
          deals: {
            total: deals.length,
            pipelineValue,
            byStatus: deals.reduce((acc: Record<string, number>, d) => { acc[d.status ?? "unknown"] = (acc[d.status ?? "unknown"] ?? 0) + 1; return acc; }, {}),
          },
          finance: {
            activeNotes: activeNotes.length,
            monthlyCashflow,
            totalOutstanding,
          },
        }, "Portfolio summary:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  return server;
}

// ─── Standalone stdio entry point ─────────────────────────────────────────────
// Run: npx tsx server/mcp/index.ts
// Then configure Claude Desktop to use this as an MCP server.

if (process.argv[1]?.endsWith("mcp/index.ts") || process.argv[1]?.endsWith("mcp/index.js")) {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    process.stderr.write("[AcreOS MCP] Server running on stdio\n");
  });
}
