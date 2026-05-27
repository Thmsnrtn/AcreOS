/**
 * /api/v1/webhooks — webhook subscription management (v0 scaffold).
 *
 * Scope: webhooks:write (also required for read — webhooks aren't a
 * separate read scope in v0; the only consumer is the integration
 * that owns them).
 *
 * Endpoints:
 *   POST   /api/v1/webhooks        — register a new endpoint
 *   GET    /api/v1/webhooks        — list this org's endpoints
 *   DELETE /api/v1/webhooks/:id    — revoke an endpoint
 *
 * The signing_secret is returned ONCE in the POST response. After that
 * it's only retrievable by the customer's own records — same posture
 * Stripe takes with `whsec_*` secrets.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { webhookSubscriptions } from "@shared/schema";
import { requireApiKey } from "../middleware/requireApiKey";
import { publicApiRateLimit } from "../middleware/publicApiRateLimit";
import { idempotencyMiddleware } from "../middleware/idempotency";
import { Errors } from "../utils/errors";
import { sendEnvelope } from "./envelope";
import { serializeWebhookSubscription } from "./serializers";
import {
  ALL_PUBLIC_EVENTS,
  type PublicWebhookEventType,
} from "../services/publicWebhookDispatcher";
import { generateWebhookSecret } from "../services/apiKeys";

export const webhooksV1Router = Router();

webhooksV1Router.use(publicApiRateLimit());

const createWebhookSchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (u) => {
        try {
          const parsed = new URL(u);
          // Force HTTPS and reject obvious SSRF targets. The full SSRF
          // guard lives in middleware/fileUploadSecurity.ts (validateUrl)
          // — wiring it here is a TODO before opening this surface.
          if (parsed.protocol !== "https:") return false;
          const host = parsed.hostname.toLowerCase();
          if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
          if (host.endsWith(".local") || host.endsWith(".internal")) return false;
          return true;
        } catch {
          return false;
        }
      },
      { message: "url must be HTTPS and resolve to a public host" },
    ),
  events: z
    .array(z.string())
    .min(1)
    .max(ALL_PUBLIC_EVENTS.length)
    .refine(
      (events) =>
        events.every((e) =>
          (ALL_PUBLIC_EVENTS as readonly string[]).includes(e),
        ),
      {
        message: `events must be a subset of: ${ALL_PUBLIC_EVENTS.join(", ")}`,
      },
    ),
});

// ─── POST /api/v1/webhooks ──────────────────────────────────────────────────
webhooksV1Router.post(
  "/",
  requireApiKey("webhooks:write"),
  idempotencyMiddleware,
  async (req: Request, res: Response) => {
    const orgId = req.apiKeyOrganization!.id;
    const apiKeyId = req.apiKey!.id;
    const parsed = createWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const { url, events } = parsed.data;

    try {
      const signingSecret = generateWebhookSecret();
      const [created] = await db
        .insert(webhookSubscriptions)
        .values({
          organizationId: orgId,
          url,
          events: events as PublicWebhookEventType[],
          signingSecret,
          isActive: true,
          createdBy: `api_key:${apiKeyId}`,
        })
        .returning();

      // Include the signing_secret ONLY in the create response.
      sendEnvelope(
        req,
        res,
        serializeWebhookSubscription(created, { includeSecret: true }),
        undefined,
        201,
      );
    } catch (err) {
      Errors.internal(res, err);
    }
  },
);

// ─── GET /api/v1/webhooks ───────────────────────────────────────────────────
webhooksV1Router.get(
  "/",
  requireApiKey("webhooks:write"),
  async (req: Request, res: Response) => {
    const orgId = req.apiKeyOrganization!.id;
    try {
      const rows = await db
        .select()
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.organizationId, orgId))
        .orderBy(desc(webhookSubscriptions.createdAt));
      sendEnvelope(
        req,
        res,
        rows.map((r) => serializeWebhookSubscription(r)),
      );
    } catch (err) {
      Errors.internal(res, err);
    }
  },
);

// ─── DELETE /api/v1/webhooks/:id ────────────────────────────────────────────
webhooksV1Router.delete(
  "/:id",
  requireApiKey("webhooks:write"),
  async (req: Request, res: Response) => {
    const orgId = req.apiKeyOrganization!.id;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");

    try {
      const [deleted] = await db
        .delete(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.id, id),
            eq(webhookSubscriptions.organizationId, orgId),
          ),
        )
        .returning();
      if (!deleted) return Errors.notFound(res, "Webhook subscription");
      sendEnvelope(req, res, { deleted: true, id: deleted.id });
    } catch (err) {
      Errors.internal(res, err);
    }
  },
);
