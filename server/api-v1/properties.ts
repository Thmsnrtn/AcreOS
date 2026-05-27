/**
 * /api/v1/properties — public property endpoints (v0 scaffold).
 *
 * Scopes: properties:read | properties:write
 *
 * Endpoints:
 *   GET    /api/v1/properties           — cursor-paginated list
 *   POST   /api/v1/properties           — create (idempotency-key supported)
 *   GET    /api/v1/properties/:id       — fetch single
 *
 * PATCH is intentionally absent from v0 — see docs/api/v1.md "Roadmap".
 * Not registered in server/routes.ts yet.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, lt, gt, desc, asc } from "drizzle-orm";
import { db } from "../db";
import { properties } from "@shared/schema";
import { requireApiKey } from "../middleware/requireApiKey";
import { publicApiRateLimit } from "../middleware/publicApiRateLimit";
import { idempotencyMiddleware } from "../middleware/idempotency";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";
import {
  sendEnvelope,
  parseListQuery,
  buildPaginationMeta,
} from "./envelope";
import { serializeProperty } from "./serializers";
import { dispatchWebhookEvent } from "../services/publicWebhookDispatcher";

export const propertiesV1Router = Router();

propertiesV1Router.use(publicApiRateLimit());

const createPropertySchema = z.object({
  apn: z.string().min(1).max(100),
  county: z.string().min(1).max(100),
  state: z.string().length(2),
  size_acres: z.union([z.number().positive(), z.string().min(1)]),
  address: z.string().max(500).nullish(),
  city: z.string().max(100).nullish(),
  zip: z.string().max(20).nullish(),
  zoning: z.string().max(100).nullish(),
  status: z.string().max(50).optional(),
  assessed_value: z.union([z.number(), z.string()]).nullish(),
  market_value: z.union([z.number(), z.string()]).nullish(),
  list_price: z.union([z.number(), z.string()]).nullish(),
  legal_description: z.string().max(2000).nullish(),
});

// ─── GET /api/v1/properties ─────────────────────────────────────────────────
propertiesV1Router.get(
  "/",
  requireApiKey("properties:read"),
  async (req: Request, res: Response) => {
    const orgId = req.apiKeyOrganization!.id;
    const parsed = parseListQuery(req);
    if ("error" in parsed) return Errors.badRequest(res, parsed.error);
    const { limit, cursor } = parsed;

    try {
      const direction = cursor?.direction ?? "f";
      const rows = await db
        .select()
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, orgId),
            cursor
              ? direction === "f"
                ? lt(properties.id, cursor.id)
                : gt(properties.id, cursor.id)
              : undefined,
          ),
        )
        .orderBy(direction === "f" ? desc(properties.id) : asc(properties.id))
        .limit(limit + 1);

      const ordered = direction === "f" ? rows : [...rows].reverse();
      const { rows: trimmed, pagination } = buildPaginationMeta(
        ordered,
        limit,
        (r) => r.id,
      );
      sendEnvelope(req, res, trimmed.map(serializeProperty), pagination);
    } catch (err) {
      Errors.internal(res, err);
    }
  },
);

// ─── POST /api/v1/properties ────────────────────────────────────────────────
propertiesV1Router.post(
  "/",
  requireApiKey("properties:write"),
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    const orgId = req.apiKeyOrganization!.id;
    const parsed = createPropertySchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const input = parsed.data;

    try {
      const [created] = await db
        .insert(properties)
        .values({
          organizationId: orgId,
          apn: input.apn,
          county: input.county,
          state: input.state,
          sizeAcres: String(input.size_acres),
          address: input.address ?? null,
          city: input.city ?? null,
          zip: input.zip ?? null,
          zoning: input.zoning ?? null,
          status: input.status ?? "prospect",
          assessedValue:
            input.assessed_value !== undefined && input.assessed_value !== null
              ? String(input.assessed_value)
              : null,
          marketValue:
            input.market_value !== undefined && input.market_value !== null
              ? String(input.market_value)
              : null,
          listPrice:
            input.list_price !== undefined && input.list_price !== null
              ? String(input.list_price)
              : null,
          legalDescription: input.legal_description ?? null,
        })
        .returning();

      dispatchWebhookEvent(
        orgId,
        "property.created",
        serializeProperty(created),
      ).catch((err) =>
        logger.warn("property.created webhook dispatch failed", {
          metadata: { err: err instanceof Error ? err.message : String(err) },
        }),
      );

      sendEnvelope(req, res, serializeProperty(created), undefined, 201);
    } catch (err) {
      Errors.internal(res, err);
    }
  },
);

// ─── GET /api/v1/properties/:id ─────────────────────────────────────────────
propertiesV1Router.get(
  "/:id",
  requireApiKey("properties:read"),
  async (req: Request, res: Response) => {
    const orgId = req.apiKeyOrganization!.id;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");

    try {
      const [row] = await db
        .select()
        .from(properties)
        .where(and(eq(properties.id, id), eq(properties.organizationId, orgId)))
        .limit(1);
      if (!row) return Errors.notFound(res, "Property");
      sendEnvelope(req, res, serializeProperty(row));
    } catch (err) {
      Errors.internal(res, err);
    }
  },
);
