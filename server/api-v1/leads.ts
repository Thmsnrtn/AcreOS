/**
 * /api/v1/leads — public CRM lead endpoints (v0 scaffold).
 *
 * Scopes: leads:read | leads:write
 *
 * Endpoints:
 *   GET    /api/v1/leads           — cursor-paginated list
 *   POST   /api/v1/leads           — create (idempotency-key supported)
 *   GET    /api/v1/leads/:id       — fetch single
 *   PATCH  /api/v1/leads/:id       — partial update (idempotency-key supported)
 *
 * Note: this file is NOT registered in server/routes.ts yet (per the v0
 * spec — surface scaffolded but not opened to traffic).
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, lt, gt, desc, asc } from "drizzle-orm";
import { db } from "../db";
import { leads, type Lead } from "@shared/schema";
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
import { serializeLead } from "./serializers";
import { dispatchWebhookEvent } from "../services/publicWebhookDispatcher";

export const leadsV1Router = Router();

// Wire 1: bearer auth + per-org rate limit on every route in this router.
leadsV1Router.use(publicApiRateLimit());

const createLeadSchema = z.object({
  type: z.enum(["seller", "buyer"]).default("seller"),
  first_name: z.string().min(1).max(255),
  last_name: z.string().min(1).max(255),
  email: z.string().email().nullish(),
  phone: z.string().max(50).nullish(),
  address: z.string().max(500).nullish(),
  city: z.string().max(100).nullish(),
  state: z.string().max(2).nullish(),
  zip: z.string().max(20).nullish(),
  status: z.string().max(50).optional(),
  source: z.string().max(100).nullish(),
  tags: z.array(z.string()).max(50).optional(),
  tcpa_consent: z.boolean().optional(),
});

const updateLeadSchema = createLeadSchema.partial();

function mapCreateInput(input: z.infer<typeof createLeadSchema>) {
  return {
    type: input.type,
    firstName: input.first_name,
    lastName: input.last_name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    zip: input.zip ?? null,
    status: input.status ?? "new",
    source: input.source ?? "api",
    tags: input.tags ?? null,
    tcpaConsent: input.tcpa_consent ?? false,
  };
}

function mapUpdateInput(input: z.infer<typeof updateLeadSchema>): Partial<Lead> {
  const out: Partial<Lead> = {};
  if (input.type !== undefined) out.type = input.type;
  if (input.first_name !== undefined) out.firstName = input.first_name;
  if (input.last_name !== undefined) out.lastName = input.last_name;
  if (input.email !== undefined) out.email = input.email ?? null;
  if (input.phone !== undefined) out.phone = input.phone ?? null;
  if (input.address !== undefined) out.address = input.address ?? null;
  if (input.city !== undefined) out.city = input.city ?? null;
  if (input.state !== undefined) out.state = input.state ?? null;
  if (input.zip !== undefined) out.zip = input.zip ?? null;
  if (input.status !== undefined) out.status = input.status;
  if (input.source !== undefined) out.source = input.source ?? null;
  if (input.tags !== undefined) out.tags = input.tags ?? null;
  if (input.tcpa_consent !== undefined) out.tcpaConsent = input.tcpa_consent;
  return out;
}

// ─── GET /api/v1/leads ──────────────────────────────────────────────────────
leadsV1Router.get(
  "/",
  requireApiKey("leads:read"),
  async (req: Request, res: Response) => {
    const orgId = req.apiKeyOrganization!.id;
    const parsed = parseListQuery(req);
    if ("error" in parsed) return Errors.badRequest(res, parsed.error);
    const { limit, cursor } = parsed;

    try {
      // Sort: id DESC for forward cursors (newest first), id ASC if walking
      // backward. We fetch limit+1 rows to detect has_more in one query.
      const direction = cursor?.direction ?? "f";
      const rows = await db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.organizationId, orgId),
            cursor
              ? direction === "f"
                ? lt(leads.id, cursor.id)
                : gt(leads.id, cursor.id)
              : undefined,
          ),
        )
        .orderBy(direction === "f" ? desc(leads.id) : asc(leads.id))
        .limit(limit + 1);

      const ordered = direction === "f" ? rows : [...rows].reverse();
      const { rows: trimmed, pagination } = buildPaginationMeta(
        ordered,
        limit,
        (r) => r.id,
      );
      sendEnvelope(req, res, trimmed.map(serializeLead), pagination);
    } catch (err) {
      Errors.internal(res, err);
    }
  },
);

// ─── POST /api/v1/leads ─────────────────────────────────────────────────────
leadsV1Router.post(
  "/",
  requireApiKey("leads:write"),
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    const orgId = req.apiKeyOrganization!.id;
    const parsed = createLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }

    try {
      const [created] = await db
        .insert(leads)
        .values({ organizationId: orgId, ...mapCreateInput(parsed.data) })
        .returning();

      // Outbound webhook — best-effort, never blocks the API response.
      dispatchWebhookEvent(orgId, "lead.created", { ...serializeLead(created) }).catch(
        (err) =>
          logger.warn("lead.created webhook dispatch failed", {
            metadata: { err: err instanceof Error ? err.message : String(err) },
          }),
      );

      sendEnvelope(req, res, serializeLead(created), undefined, 201);
    } catch (err) {
      Errors.internal(res, err);
    }
  },
);

// ─── GET /api/v1/leads/:id ──────────────────────────────────────────────────
leadsV1Router.get(
  "/:id",
  requireApiKey("leads:read"),
  async (req: Request, res: Response) => {
    const orgId = req.apiKeyOrganization!.id;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");

    try {
      const [row] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), eq(leads.organizationId, orgId)))
        .limit(1);
      if (!row) return Errors.notFound(res, "Lead");
      sendEnvelope(req, res, serializeLead(row));
    } catch (err) {
      Errors.internal(res, err);
    }
  },
);

// ─── PATCH /api/v1/leads/:id ────────────────────────────────────────────────
leadsV1Router.patch(
  "/:id",
  requireApiKey("leads:write"),
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    const orgId = req.apiKeyOrganization!.id;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");

    const parsed = updateLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const patch = mapUpdateInput(parsed.data);
    if (Object.keys(patch).length === 0) {
      return Errors.badRequest(res, "No updatable fields provided");
    }

    try {
      const [updated] = await db
        .update(leads)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(leads.id, id), eq(leads.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Lead");

      dispatchWebhookEvent(orgId, "lead.updated", { ...serializeLead(updated) }).catch(
        (err) =>
          logger.warn("lead.updated webhook dispatch failed", {
            metadata: { err: err instanceof Error ? err.message : String(err) },
          }),
      );

      sendEnvelope(req, res, serializeLead(updated));
    } catch (err) {
      Errors.internal(res, err);
    }
  },
);
