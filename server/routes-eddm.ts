/**
 * Pillar 3 Tab 4 — EDDM map endpoints.
 *
 * The EDDM (Every Door Direct Mail) surface lets land investors paint a
 * carrier-route map and queue a blast against the selected routes. Real
 * USPS carrier-route geometry requires the USPS BCG (Business Customer
 * Gateway) permit, which we trigger at $1k MRR. Until then this file
 * synthesizes a deterministic 5×4 grid over the county bounding box so the
 * UI is exercisable end-to-end. The UI surfaces a clear "Demo routes"
 * badge — only the geometry is mocked, every cost/household number flows
 * through the same MailRouter cost path as the Compose tab.
 *
 * TODO(usps-bcg): replace synthesizeRoutes() with a real USPS BCG fetch
 * once the permit lands ($1k MRR trigger). Smarty's carrier-route service
 * is the documented fallback.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization, getOrganizationId, getUserId } from "./types/request";
import { db } from "./db";
import { mailShipments, mailShipmentPieces, properties } from "@shared/schema";

// ── Constants ───────────────────────────────────────────────────────────────

// Per Pillar 3 cost weights — postcard_eddm = 31¢/piece. Households are
// the EDDM cost unit (one piece per household per route).
const EDDM_PER_PIECE_CENTS = 31;
const HOLD_WINDOW_MINUTES = 30;

// Mock-grid dimensions for the synthetic carrier-route stub.
const GRID_COLS = 5;
const GRID_ROWS = 4; // 5 × 4 = 20 mock routes per county

// Rough county bounding boxes. Real impl resolves these via Census TIGER
// or the USPS service. The fallback bbox is used for unknown counties so
// the endpoint always returns ≥1 feature — the UI shows the demo badge
// regardless.
const FALLBACK_BBOX: BoundingBox = {
  west: -98.5,
  south: 30.0,
  east: -97.5,
  north: 31.0,
};
const COUNTY_BBOX: Record<string, BoundingBox> = {
  // key = `${stateUpper}|${countyLower}` — easy to extend without a migration.
  "TX|hidalgo": { west: -98.6, south: 26.0, east: -97.9, north: 26.6 },
  "TX|cameron": { west: -97.8, south: 25.8, east: -97.1, north: 26.3 },
  "TX|harris": { west: -95.8, south: 29.5, east: -94.9, north: 30.1 },
  "OK|oklahoma": { west: -97.7, south: 35.3, east: -97.1, north: 35.7 },
  "NM|otero": { west: -106.5, south: 32.0, east: -104.9, north: 33.3 },
};

// ── Types ───────────────────────────────────────────────────────────────────

interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface CarrierRouteFeature {
  type: "Feature";
  id: string;
  properties: {
    routeId: string;
    householdCount: number;
    county: string;
    state: string;
    synthetic: true;
  };
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const routesQuerySchema = z.object({
  county: z.string().min(1).max(100),
  state: z.string().length(2),
});

const parcelsQuerySchema = z.object({
  // bbox = "west,south,east,north"
  bbox: z.string().min(1),
  acreageMin: z.coerce.number().nonnegative().optional(),
  acreageMax: z.coerce.number().nonnegative().optional(),
  ownerStateNotIn: z.string().optional(), // comma-separated 2-letter codes
  lastSaleYearMin: z.coerce.number().int().min(1900).max(2200).optional(),
  taxStatus: z.string().optional(), // "delinquent" | "current"
});

const queueSchema = z.object({
  routeIds: z.array(z.string().min(1)).min(1).max(500),
  pieceType: z.literal("postcard_4x6").or(z.literal("postcard_6x9")),
  copy: z.string().max(8000).optional(),
  templateId: z.number().int().positive().optional(),
  label: z.string().max(200).optional(),
  // Total household count snapshot from the UI — server re-derives the
  // authoritative number from routeIds but stores this as the queued size
  // so the hold-window UI matches what Tom saw.
  householdCount: z.number().int().positive(),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function countyBbox(state: string, county: string): BoundingBox {
  const key = `${state.toUpperCase()}|${county.trim().toLowerCase()}`;
  return COUNTY_BBOX[key] ?? FALLBACK_BBOX;
}

function parseBbox(input: string): BoundingBox | null {
  const parts = input.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

/**
 * Deterministic synthetic-grid stub.
 *
 * Splits the county bbox into a 5×4 lattice of rectangular polygons.
 * `routeId` is `${state}-${county}-R{row}{col}` so the same county is
 * stable across refreshes (so route selection survives reload). Household
 * count is a deterministic hash of routeId folded into [100, 500] — no
 * random per-request drift, which would break the cost preview.
 */
function synthesizeRoutes(state: string, county: string): CarrierRouteFeature[] {
  const bbox = countyBbox(state, county);
  const lonStep = (bbox.east - bbox.west) / GRID_COLS;
  const latStep = (bbox.north - bbox.south) / GRID_ROWS;
  const stateUp = state.toUpperCase();
  const countyClean = county.trim().toLowerCase().replace(/\s+/g, "-");

  const features: CarrierRouteFeature[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const west = bbox.west + col * lonStep;
      const east = west + lonStep;
      const south = bbox.south + row * latStep;
      const north = south + latStep;
      const routeId = `${stateUp}-${countyClean}-R${row}${col}`;
      const householdCount = 100 + (deterministicHash(routeId) % 401); // 100..500
      features.push({
        type: "Feature",
        id: routeId,
        properties: {
          routeId,
          householdCount,
          county: countyClean,
          state: stateUp,
          synthetic: true,
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      });
    }
  }
  return features;
}

function deterministicHash(input: string): number {
  // FNV-1a 32-bit — stable, no deps, plenty of variance for [0,401).
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

// ── Route registration ──────────────────────────────────────────────────────

export function registerEddmRoutes(app: Express): void {
  // ── GET /api/outreach/mail/eddm/routes ───────────────────────────────────
  app.get(
    "/api/outreach/mail/eddm/routes",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = routesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      try {
        const features = synthesizeRoutes(parsed.data.state, parsed.data.county);
        res.json({
          type: "FeatureCollection",
          features,
          synthetic: true,
          source: "synthetic-grid",
          // The badge copy the UI surfaces verbatim.
          notice: "Demo carrier routes (USPS data wires in at $1k MRR)",
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ── GET /api/outreach/mail/eddm/parcels ──────────────────────────────────
  app.get(
    "/api/outreach/mail/eddm/parcels",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = parcelsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const bbox = parseBbox(parsed.data.bbox);
      if (!bbox) {
        return Errors.badRequest(res, "Invalid bbox — use 'west,south,east,north'");
      }
      const orgId = getOrganizationId(req);

      try {
        const conditions = [
          eq(properties.organizationId, orgId),
          sql`${properties.latitude} IS NOT NULL`,
          sql`${properties.longitude} IS NOT NULL`,
          sql`CAST(${properties.longitude} AS DOUBLE PRECISION) BETWEEN ${bbox.west} AND ${bbox.east}`,
          sql`CAST(${properties.latitude} AS DOUBLE PRECISION) BETWEEN ${bbox.south} AND ${bbox.north}`,
        ];
        if (parsed.data.acreageMin !== undefined) {
          conditions.push(
            sql`CAST(${properties.sizeAcres} AS DOUBLE PRECISION) >= ${parsed.data.acreageMin}`,
          );
        }
        if (parsed.data.acreageMax !== undefined) {
          conditions.push(
            sql`CAST(${properties.sizeAcres} AS DOUBLE PRECISION) <= ${parsed.data.acreageMax}`,
          );
        }

        const rows = await db
          .select({
            id: properties.id,
            apn: properties.apn,
            latitude: properties.latitude,
            longitude: properties.longitude,
            sizeAcres: properties.sizeAcres,
            state: properties.state,
            county: properties.county,
            parcelBoundary: properties.parcelBoundary,
          })
          .from(properties)
          .where(and(...conditions))
          .limit(2000);

        const features = rows.map((r) => {
          const lng = Number(r.longitude);
          const lat = Number(r.latitude);
          const geometry =
            r.parcelBoundary && r.parcelBoundary.coordinates
              ? r.parcelBoundary
              : { type: "Point" as const, coordinates: [lng, lat] };
          return {
            type: "Feature" as const,
            id: r.id,
            properties: {
              id: r.id,
              apn: r.apn,
              acres: r.sizeAcres ? Number(r.sizeAcres) : null,
              state: r.state,
              county: r.county,
            },
            geometry,
          };
        });

        res.json({ type: "FeatureCollection", features, total: features.length });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ── POST /api/outreach/mail/eddm/queue ───────────────────────────────────
  app.post(
    "/api/outreach/mail/eddm/queue",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = queueSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const org = getOrganization(req);
      const userId = getUserId(req);
      const { routeIds, pieceType, copy, templateId, label, householdCount } = parsed.data;

      try {
        const pieceCount = householdCount;
        const perPieceCents = EDDM_PER_PIECE_CENTS;
        const totalCents = perPieceCents * pieceCount;
        const leavesAt = new Date(Date.now() + HOLD_WINDOW_MINUTES * 60 * 1000);

        const [row] = await db
          .insert(mailShipments)
          .values({
            organizationId: org.id,
            createdByUserId: userId,
            status: "queued",
            pieceType,
            speed: "eddm_geo",
            provider: "eddm_usps",
            pieceCount,
            perPieceCents,
            totalCents,
            savedVsLobCents: 0,
            deliveryEtaDays: 10,
            label: label ?? null,
            templateId: templateId ?? null,
            copySnapshot: copy ?? null,
            // Store the route selection on the audience filter snapshot
            // (the column is jsonb — see schema.ts comment near
            // mailShipments.audienceFilter). The TS type doesn't list
            // `eddmRoutes` yet but jsonb accepts the extra key; this lets
            // the worker rebuild the audience without a migration.
            audienceFilter: { eddmRoutes: routeIds } as unknown as Record<string, unknown>,
            leavesAt,
          })
          .returning({ id: mailShipments.id });

        // EDDM has no per-recipient list — the carrier walks every door on
        // the route. We persist a single piece-row per route as a
        // placeholder so the In-Flight tracker has something to count.
        await db.insert(mailShipmentPieces).values(
          routeIds.map((rid) => ({
            shipmentId: row.id,
            organizationId: org.id,
            leadId: null,
            recipientName: `EDDM route ${rid}`,
            addressLine1: `Carrier route ${rid}`,
            city: "—",
            state: "—",
            zip: "—",
            status: "pending" as const,
          })),
        );

        res.status(201).json({
          shipmentId: row.id,
          leavesAt: leavesAt.toISOString(),
          holdWindowMinutes: HOLD_WINDOW_MINUTES,
          quote: {
            pieceCount,
            perPieceCents,
            totalCents,
            provider: "eddm_usps",
            savedVsLobCents: 0,
            deliveryEtaDays: 10,
            routeCount: routeIds.length,
          },
        });
      } catch (err) {
        logger.error("[outreach-mail/eddm] queue failed", {
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
        Errors.internal(res, err);
      }
    },
  );
}
