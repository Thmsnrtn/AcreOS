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
import { logger } from "../utils/logger.js";
import { screenToolResultData } from "../services/licenseEgress.js";

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Every tool result leaves the platform, so `ok()` IS an egress boundary and
 * routes through the license chokepoint. Records whose provider-derived
 * regions carry no provenance stamp (a full `properties` row's `parcelData` /
 * `enrichmentData`) are withheld and the result SAYS so, rather than handing
 * an MCP host bytes we may not redistribute.
 *
 * `declaredSource` is for call sites that hold a real source name. Every
 * broker-backed tool passes `result.source.title` (through `brokerOk` below) —
 * the same string the tool already prints to the host — so this screen is no
 * longer a near no-op on the one channel that hands bytes to a third party.
 *
 * A title the license register cannot resolve fails CLOSED: the result becomes
 * `{ data: null, _license: … }` with the reason on the first line, never a
 * silent empty object. See BROKER_TITLE_TO_REGISTER_SOURCE in licenseEgress.ts
 * for which broker titles reconcile to a register key and which deliberately
 * do not.
 */
function ok(data: unknown, note?: string, declaredSource?: string | null) {
  const screened = screenToolResultData(
    "mcp-tool-result",
    data,
    declaredSource === undefined ? {} : { declaredSource },
  );
  const body = screened.disclosure
    ? { data: screened.data, _license: screened.disclosure }
    : screened.data;
  // A released `attribution`-postured source (ODbL/OSM) must carry its
  // attribution string out with it, or the posture check passes while the
  // licence is still breached.
  const credit = screened.attributions.length
    ? screened.attributions.join(" · ")
    : null;
  const header = screened.disclosure
    ? `${note ? `${note}\n` : ""}${screened.disclosure.notice}`
    : [note, credit].filter(Boolean).join("\n") || undefined;
  return {
    content: [
      {
        type: "text" as const,
        text: header
          ? `${header}\n\n${JSON.stringify(body, null, 2)}`
          : JSON.stringify(body, null, 2),
      },
    ],
  };
}

/** The shape of a `dataSourceBroker.lookup()` result these tools consume. */
interface BrokerToolResult {
  success: boolean;
  data: unknown;
  source: { title: string };
  fallbacksUsed?: string[];
}

/**
 * Broker-backed tool results, with the EMPTY case separated from the WITHHELD
 * case.
 *
 * The broker stamps a source title on results that carry no data at all — a
 * retired category ("HIFLD (discontinued)"), a miss ("None"), a thrown lookup
 * ("Error"), an unkeyed optional source. Handing those to `ok()` with a
 * declared source made the chokepoint screen a title attached to nothing and
 * report "1 field withheld from this MCP tool result", which is a suppression
 * notice for bytes that never existed — and it buried the real reason (the
 * upstream is dead, or returned nothing) under a licence story.
 *
 * So: no data → say there is no data, name the source we tried and the
 * broker's own reason. Data → `ok()` screens it against the declared source,
 * and an unresolvable source still fails closed there.
 */
function brokerOk(result: BrokerToolResult, note: string) {
  if (!result.success || result.data === null || result.data === undefined) {
    const why = result.fallbacksUsed?.length
      ? result.fallbacksUsed.join("; ")
      : "no configured upstream returned data for this location";
    return {
      content: [
        {
          type: "text" as const,
          text:
            `${note}\nNo data was returned. Source attempted: ${result.source.title}. Reason: ${why}\n` +
            `This is an empty result, not a withheld one — nothing was suppressed on data-licence grounds.`,
        },
      ],
    };
  }
  return ok(result.data, note, result.source.title);
}

/**
 * The source name the two geocode tools already stamp into their own payloads.
 * Declared once so the printed provenance and the provenance the chokepoint is
 * asked about cannot drift apart. It reconciles to the register's
 * "OpenStreetMap" (ODbL) entry, so results are released WITH the ODbL
 * attribution rather than released bare.
 */
const NOMINATIM_SOURCE = "OpenStreetMap Nominatim";

function err(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

// ─── Server ──────────────────────────────────────────────────────────────────

export interface McpServerOptions {
  /**
   * T0-3 (2026-06-10): the org this MCP session is authenticated for.
   * Resolved server-side at auth time (server/mcp/auth.ts) — per-org API
   * key → its org, static MCP_API_KEY → MCP_ORG_ID. Org-scoped tools no
   * longer accept an organizationId argument from the client; they are
   * forced to this binding and refuse when it's absent.
   */
  organizationId?: number;
}

export function createMcpServer(options: McpServerOptions = {}) {
  const boundOrgId = options.organizationId;

  const server = new McpServer({
    name: "AcreOS",
    version: "1.0.0",
  });

  // T0-3 (2026-06-10): every tool registration goes through this wrapper so
  // each call emits a structured audit line — tool name, bound org, duration,
  // error flag. Never the arguments, never any credential material.
  const tool = (
    name: string,
    description: string,
    schema: Record<string, z.ZodTypeAny>,
    handler: (args: any) => Promise<any>,
  ) => {
    server.tool(name, description, schema, async (args: any) => {
      const startedAt = Date.now();
      let isError = false;
      try {
        const result = await handler(args);
        isError = Boolean(result?.isError);
        return result;
      } catch (e) {
        isError = true;
        throw e;
      } finally {
        logger.info("[mcp] tool call", {
          source: "mcp",
          organizationId: boundOrgId,
          metadata: { tool: name, durationMs: Date.now() - startedAt, isError },
        });
      }
    });
  };

  /** Resolve the session's org binding or produce a uniform refusal. */
  const requireBoundOrg = (): number => {
    if (boundOrgId === undefined || boundOrgId === null) {
      throw new Error(
        "This MCP session is not bound to an organization. Authenticate with a per-org API key (ak_live_…) or set MCP_ORG_ID for the static key.",
      );
    }
    return boundOrgId;
  };

  // ── 1. Flood Zone ─────────────────────────────────────────────────────────
  tool(
    "get_flood_zone",
    "Look up the FEMA flood zone classification for a lat/lng coordinate. Returns zone label (e.g. Zone AE) and risk level. Free – uses FEMA NFHL ArcGIS REST service.",
    {
      latitude: z.number().describe("Decimal latitude (WGS84)"),
      longitude: z.number().describe("Decimal longitude (WGS84)"),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("flood_zone", { latitude, longitude });
        return brokerOk(result, `Flood zone data via ${result.source.title}`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 2. Wetlands ───────────────────────────────────────────────────────────
  tool(
    "get_wetlands",
    "Check USFWS National Wetlands Inventory (NWI) for wetlands at a coordinate. Free API.",
    {
      latitude: z.number().describe("Decimal latitude"),
      longitude: z.number().describe("Decimal longitude"),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("wetlands", { latitude, longitude });
        return brokerOk(result, "NWI Wetlands data:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 3. Soil Data ─────────────────────────────────────────────────────────
  tool(
    "get_soil_data",
    "Retrieve USDA NRCS SSURGO soil survey data (soil type, hydrologic group, drainage class) for a coordinate. Free API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("soil", { latitude, longitude });
        return brokerOk(result, "USDA Soil Survey data:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 4. Demographics ───────────────────────────────────────────────────────
  tool(
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
        return brokerOk(result, "Census ACS 5-Year Estimates:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 5. Public Lands ───────────────────────────────────────────────────────
  tool(
    "get_public_lands",
    "Check if a coordinate is on BLM, NPS, or USFS managed land. Returns managing agency and unit details. Free API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("public_lands", { latitude, longitude });
        return brokerOk(result, "Public Lands data (BLM/NPS/USFS):");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 6. Natural Hazards ────────────────────────────────────────────────────
  tool(
    "get_natural_hazards",
    "Get natural hazard data: recent USGS earthquakes within 100km, active WFIGS wildfire perimeters within 50km, and FEMA flood information. Free APIs.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("natural_hazards", { latitude, longitude });
        return brokerOk(result, "Natural Hazards assessment:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 7. Infrastructure ─────────────────────────────────────────────────────
  tool(
    "get_infrastructure",
    "Find hospitals, fire stations, and schools within 10 miles of a coordinate using HIFLD federal datasets. Free API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("infrastructure", { latitude, longitude });
        return brokerOk(result, "Infrastructure within 10 miles:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 8. Transportation ─────────────────────────────────────────────────────
  tool(
    "get_transportation",
    "Find highways (NHPN), bridges (NBI), and railroads within 5 miles of a coordinate. Free DOT/ESRI APIs.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("transportation", { latitude, longitude });
        return brokerOk(result, "Transportation data:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 9. Water Resources ────────────────────────────────────────────────────
  tool(
    "get_water_resources",
    "Fetch USGS stream gauge data, current flow conditions, and HUC12 watershed information near a coordinate. Free API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("water_resources", { latitude, longitude });
        return brokerOk(result, "Water resources data:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 10. Elevation ─────────────────────────────────────────────────────────
  tool(
    "get_elevation",
    "Get precise elevation in feet and meters from USGS 3DEP National Elevation Dataset. Falls back to SRTM via Open-Elevation. Free API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("elevation", { latitude, longitude });
        return brokerOk(result, "Elevation data:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 11. Climate ───────────────────────────────────────────────────────────
  tool(
    "get_climate",
    "Get 30-year climate normals (1991-2020): average high/low temperatures and annual precipitation. Uses Open-Meteo ERA5 reanalysis. Free, no API key required.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("climate", { latitude, longitude });
        return brokerOk(result, "30-year climate normals:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 12. Agricultural Land Values ──────────────────────────────────────────
  tool(
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
        return brokerOk(result, "USDA agricultural land values:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 13. Land Cover ────────────────────────────────────────────────────────
  tool(
    "get_land_cover",
    "Get USGS National Land Cover Database (NLCD 2021) land cover class for a coordinate: cropland, forest, wetland, developed, etc. Free ArcGIS REST API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("land_cover", { latitude, longitude });
        return brokerOk(result, "NLCD 2021 land cover:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 14. Full Property Enrichment ──────────────────────────────────────────
  tool(
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
  tool(
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
            "User-Agent": "AcreOS Real Estate Platform (contact@acreos.io)",
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
          source: NOMINATIM_SOURCE,
        }, "Reverse geocode result:", NOMINATIM_SOURCE);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 16. Forward Geocode ───────────────────────────────────────────────────
  tool(
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
            "User-Agent": "AcreOS Real Estate Platform (contact@acreos.io)",
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
            source: NOMINATIM_SOURCE,
          })),
          `Geocode results for "${address}":`,
          NOMINATIM_SOURCE,
        );
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 17. EPA Environmental Query ───────────────────────────────────────────
  tool(
    "get_epa_data",
    "Search EPA TRI (Toxic Release Inventory) facilities within 3 miles of a coordinate. Free EPA Envirofacts API.",
    {
      latitude: z.number(),
      longitude: z.number(),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("environmental", { latitude, longitude });
        return brokerOk(result, "EPA environmental data:");
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 18. Search Organization Properties ───────────────────────────────────
  // T0-3 (2026-06-10): organizationId removed from this and every other
  // org-scoped tool schema below — the org is injected server-side from the
  // authenticated session binding so a caller can never pick another org.
  tool(
    "search_properties",
    "Search properties in your AcreOS organization's portfolio by state, county, status, or free-text. Returns a list of matching properties.",
    {
      state: z.string().optional().describe("Filter by state (two-letter code)"),
      county: z.string().optional().describe("Filter by county name"),
      status: z.string().optional().describe("Filter by status (available, under_contract, sold, etc.)"),
      limit: z.number().optional().default(20).describe("Max results to return"),
    },
    async ({ state, county, status, limit }) => {
      try {
        const organizationId = requireBoundOrg();
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
  tool(
    "get_property",
    "Get full details for a specific property by ID within your AcreOS organization.",
    {
      propertyId: z.number(),
    },
    async ({ propertyId }) => {
      try {
        const organizationId = requireBoundOrg();
        const property = await storage.getProperty(organizationId, propertyId);
        if (!property) return err(`Property ${propertyId} not found`);
        return ok(property, `Property #${propertyId}:`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 20. Search Leads ──────────────────────────────────────────────────────
  tool(
    "search_leads",
    "Search leads/sellers in your AcreOS organization by state, county, lead score range, or status.",
    {
      state: z.string().optional(),
      county: z.string().optional(),
      minScore: z.number().optional().describe("Minimum lead score (0-100)"),
      status: z.string().optional().describe("Lead status filter"),
      limit: z.number().optional().default(20),
    },
    async ({ state, county, minScore, status, limit }) => {
      try {
        const organizationId = requireBoundOrg();
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
  tool(
    "get_deals",
    "Retrieve active deals in your AcreOS organization's pipeline. Optionally filter by stage.",
    {
      stage: z.string().optional().describe("Pipeline stage filter (e.g. due_diligence, offer, closed)"),
      limit: z.number().optional().default(20),
    },
    async ({ stage, limit }) => {
      try {
        const organizationId = requireBoundOrg();
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
  tool(
    "get_portfolio_summary",
    "Get a high-level summary of your organization's AcreOS portfolio: lead counts, property counts, deal pipeline, active seller-financed notes, and monthly cash flow.",
    {},
    async () => {
      try {
        const organizationId = requireBoundOrg();
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

  // ── 23. Cropland Data Layer ───────────────────────────────────────────────
  tool(
    "get_cropland",
    "Identify the crop type at a coordinate using USDA NASS CropScape Cropland Data Layer (CDL) 2023. Returns crop code, crop name, and land use classification. Free – no API key required.",
    {
      latitude: z.number().describe("Decimal latitude (WGS84)"),
      longitude: z.number().describe("Decimal longitude (WGS84)"),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("cropland", { latitude, longitude });
        return brokerOk(result, `Cropland data via ${result.source.title}`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 24. EPA Facility Registry Service ────────────────────────────────────
  tool(
    "get_epa_facilities",
    "Find all EPA-registered facilities within 5 miles of a coordinate using the EPA Facility Registry Service (FRS). Covers Superfund, Clean Air Act, Clean Water Act, RCRA hazardous waste sites, and more. Free – no API key required.",
    {
      latitude: z.number().describe("Decimal latitude"),
      longitude: z.number().describe("Decimal longitude"),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("epa_frs", { latitude, longitude });
        return brokerOk(result, `EPA FRS facilities via ${result.source.title}`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 25. Storm History / Hazard Risk ──────────────────────────────────────
  tool(
    "get_storm_history",
    "Get geographic storm risk estimates (tornado, hurricane, hail) for a coordinate based on NOAA historical storm event patterns. Returns county-level risk classifications. Free – no API key required.",
    {
      latitude: z.number().describe("Decimal latitude"),
      longitude: z.number().describe("Decimal longitude"),
      state: z.string().optional().describe("Two-letter state abbreviation (e.g. TX)"),
    },
    async ({ latitude, longitude, state }) => {
      try {
        const result = await dataSourceBroker.lookup("storm_history", { latitude, longitude, state });
        return brokerOk(result, `Storm history via ${result.source.title}`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 26. PLSS Legal Description ────────────────────────────────────────────
  tool(
    "get_plss",
    "Look up the Public Land Survey System (PLSS) legal description for a coordinate using BLM CadNSDI. Returns section, township, range, and formatted legal description (e.g. 'Sec. 14, T2N, R3E'). Critical for rural land title research. Free – no API key required.",
    {
      latitude: z.number().describe("Decimal latitude"),
      longitude: z.number().describe("Decimal longitude"),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("plss", { latitude, longitude });
        return brokerOk(result, `PLSS via ${result.source.title}`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 27. Watershed / HUC ───────────────────────────────────────────────────
  tool(
    "get_watershed",
    "Get the NHD Plus watershed name and HUC-8/HUC-12 codes for a coordinate using EPA WATERS. Identifies the hydrologic unit containing the property. Free – no API key required.",
    {
      latitude: z.number().describe("Decimal latitude"),
      longitude: z.number().describe("Decimal longitude"),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("watershed", { latitude, longitude });
        return brokerOk(result, `Watershed via ${result.source.title}`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 28. FEMA National Risk Index ─────────────────────────────────────────
  tool(
    "get_fema_nri",
    "Get the official FEMA National Risk Index hazard risk ratings for a location. Returns composite risk score plus individual ratings for riverine flood, hurricane, tornado, hail, wildfire, lightning, earthquake, and drought at the county level. Free – no API key required.",
    {
      latitude: z.number().describe("Decimal latitude"),
      longitude: z.number().describe("Decimal longitude"),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("fema_nri", { latitude, longitude });
        return brokerOk(result, `FEMA NRI via ${result.source.title}`);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── 29. USDA FSA Common Land Units ───────────────────────────────────────
  tool(
    "get_usda_clu",
    "Retrieve USDA FSA Common Land Unit (CLU) farm records for a coordinate. Returns farm number, tract number, CLU ID, and officially calculated acreage from USDA farm records. Free – no API key required.",
    {
      latitude: z.number().describe("Decimal latitude"),
      longitude: z.number().describe("Decimal longitude"),
    },
    async ({ latitude, longitude }) => {
      try {
        const result = await dataSourceBroker.lookup("usda_clu", { latitude, longitude });
        return brokerOk(result, `USDA CLU via ${result.source.title}`);
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
  // T0-3 (2026-06-10): stdio sessions bind via MCP_ORG_ID (there is no HTTP
  // auth layer here — the binding is the operator's env, same as the static
  // key path). Unset → public-data tools only.
  const rawOrgId = process.env.MCP_ORG_ID;
  const parsedOrgId = rawOrgId ? Number.parseInt(rawOrgId, 10) : Number.NaN;
  const server = createMcpServer({
    organizationId: Number.isFinite(parsedOrgId) ? parsedOrgId : undefined,
  });
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    process.stderr.write("[AcreOS MCP] Server running on stdio\n");
  });
}
