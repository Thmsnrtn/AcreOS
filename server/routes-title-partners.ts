/**
 * Hartwell title-partner API — Phase 7 Months 7.
 *
 * Three surfaces:
 *
 *   1. POST /api/title-orders
 *      Authenticated org-side endpoint that creates a title_orders row,
 *      routes to a specific partner (titleCompanyId) or broadcasts to all
 *      active partners whose territoryStates / territoryCounties match
 *      the deal's property. Returns { orderId, status, estimatedDeliveryDate }.
 *
 *   2. POST /api/webhooks/title-orders/:orderId/status
 *      Partner-tier inbound webhook. Verifies HMAC-SHA256 signature on the
 *      raw body using the partner's per-partner shared secret (decrypted
 *      from title_partners.hmac_secret_encrypted). Fails closed if the
 *      secret is missing. Updates status + status_details, optionally
 *      records commitment / Schedule B / policy S3 keys, and dispatches
 *      a customer notification.
 *
 *   3. POST /api/founder/title-partners
 *      Founder-only endpoint that registers a partner. Hashes the API key
 *      (sha256), encrypts the HMAC secret via fieldEncryption, and stores
 *      the territory + tier metadata.
 *
 *   3b. GET /api/founder/title-partners
 *       Lists registered partners (sans secrets), used by the founder UI.
 *
 *   3c. GET /api/founder/title-partners/billing-report
 *       Aggregates closed orders by partner & tier, surfacing per-file
 *       price by tier (pilot=$895, standard=$795, volume=$695, enterprise
 *       see-notes).
 *
 * The exchange-document JSON schema (commitment / Schedule B / policy)
 * lives at docs/api/title-partners-v1.md and is the contract a partner
 * must satisfy when uploading to the shared S3 exchange bucket.
 */

import crypto from "crypto";
import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { z } from "zod";
import { eq, and, or, isNull, sql } from "drizzle-orm";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { db } from "./db";
import { titleOrders, titlePartners, deals } from "@shared/schema";
import { encrypt, decrypt } from "./services/fieldEncryption";
import { notificationDispatcher } from "./services/notificationDispatcher";

// ─── Volume pricing tier → per-file price (USD) ──────────────────────────────

export const VOLUME_TIER_PRICING: Record<string, number> = {
  pilot: 895,
  standard: 795,
  volume: 695,
  // Enterprise is contract-negotiated; reported as 0 in the billing surface
  // until per-partner override columns ship.
  enterprise: 0,
};

const VOLUME_TIERS = ["pilot", "standard", "volume", "enterprise"] as const;

// ─── Schemas ────────────────────────────────────────────────────────────────

const propertyAddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().length(2),
  county: z.string().optional(),
  zip: z.string().min(5),
});

const partySchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  entityType: z.string().optional(),
});

const createOrderBodySchema = z.object({
  dealId: z.number().int().positive(),
  propertyAddress: propertyAddressSchema,
  buyerInfo: partySchema,
  sellerInfo: partySchema,
  salePrice: z.union([z.number().positive(), z.string().min(1)]),
  expectedClosingDate: z.string().min(8), // ISO date YYYY-MM-DD
  titleCompanyId: z.number().int().positive().optional(),
});

const inboundStatusBodySchema = z.object({
  status: z.string().min(1),
  statusDetails: z.record(z.string(), z.unknown()).optional(),
  commitmentS3Key: z.string().optional(),
  scheduleBS3Key: z.string().optional(),
  policyS3Key: z.string().optional(),
});

const registerPartnerBodySchema = z.object({
  organizationId: z.number().int().positive().nullable().optional(),
  partnerName: z.string().min(1),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(7),
  territoryStates: z.array(z.string().length(2)).default([]),
  territoryCounties: z.array(z.string()).default([]),
  apiKey: z.string().min(16),
  hmacSecret: z.string().min(16),
  webhookUrl: z.string().url(),
  volumePricingTier: z.enum(VOLUME_TIERS).default("pilot"),
});

// ─── API key auth (partner-tier) ─────────────────────────────────────────────

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

type PartnerAuthedRequest = Request & {
  titlePartner?: typeof titlePartners.$inferSelect;
  titlePartnerSecret?: string; // decrypted HMAC secret, only set in webhook path
  rawBody?: Buffer;
};

/**
 * Resolve a partner from the inbound `Authorization: Bearer <apiKey>` header.
 * Hashes the presented key and looks up by api_key_hash. Constant-time
 * compare via the hash equality below; we don't iterate over plaintext.
 */
async function authenticatePartnerByApiKey(
  apiKey: string
): Promise<typeof titlePartners.$inferSelect | null> {
  const hash = hashApiKey(apiKey);
  const [partner] = await db
    .select()
    .from(titlePartners)
    .where(and(eq(titlePartners.apiKeyHash, hash), eq(titlePartners.isActive, true)))
    .limit(1);
  return partner ?? null;
}

function extractBearer(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== "string") return null;
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim() || null;
}

async function requirePartnerApiKey(
  req: PartnerAuthedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const key = extractBearer(req);
    if (!key) {
      return Errors.unauthorized(res);
    }
    const partner = await authenticatePartnerByApiKey(key);
    if (!partner) {
      return Errors.unauthorized(res);
    }
    req.titlePartner = partner;
    next();
  } catch (err) {
    return Errors.internal(res, err);
  }
}

// ─── HMAC verification on inbound webhook ────────────────────────────────────

/**
 * Verify the HMAC-SHA256 signature on the raw request body. Fails closed
 * if either the partner has no stored secret or the header is missing.
 *
 * Header format: `X-Acreos-Signature: sha256=<hex>`
 */
function verifyHmac(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  const presented = signatureHeader.replace(/^sha256=/, "").trim();
  if (!presented) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(presented, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─── Routing logic ───────────────────────────────────────────────────────────

/**
 * Pick a partner for an order. If titleCompanyId is set, route to that one
 * (must be active, and must be reachable BY THIS ORG). Otherwise, return the
 * highest-priority partner whose territoryStates / territoryCounties match —
 * with platform-default partners (organizationId NULL) preferred only as a
 * fallback.
 *
 * Reachable, for both branches, means the same thing: the partner is either
 * this org's own (`organization_id = :orgId`) or a platform default
 * (`organization_id IS NULL` — "any org can route to it", per the column's
 * own contract in shared/schema/accounting-ops.ts). A partner privately
 * registered to ANOTHER org is not reachable, and the explicit-id branch is
 * NOT an exception to that: `titleCompanyId` arrives straight off the request
 * body (`z.number().int().positive().optional()`), so an unscoped by-id read
 * let an authenticated caller name any tenant's partner row — and then had
 * its buyer/seller/price payload POSTed to the webhookUrl stored on it.
 * The predicate lives in the STATEMENT, not in a post-filter, and matches the
 * one `wireInstructions.issueWireInstructions` already uses on this table.
 */
async function routeTitleOrder(
  organizationId: number,
  state: string,
  county: string | undefined,
  titleCompanyId?: number
): Promise<typeof titlePartners.$inferSelect | null> {
  if (titleCompanyId) {
    const [partner] = await db
      .select()
      .from(titlePartners)
      .where(
        and(
          eq(titlePartners.id, titleCompanyId),
          or(
            isNull(titlePartners.organizationId),
            eq(titlePartners.organizationId, organizationId)
          ),
          eq(titlePartners.isActive, true)
        )
      )
      .limit(1);
    return partner ?? null;
  }

  const candidates = await db
    .select()
    .from(titlePartners)
    .where(eq(titlePartners.isActive, true));

  const matchesTerritory = (
    p: typeof titlePartners.$inferSelect
  ): boolean => {
    const states = (p.territoryStates ?? []) as string[];
    const counties = (p.territoryCounties ?? []) as string[];
    const stateOk = states.length === 0 || states.includes(state);
    const countyOk =
      counties.length === 0 || (county ? counties.includes(county) : true);
    return stateOk && countyOk;
  };

  const orgScoped = candidates.filter(
    (p) => p.organizationId === organizationId && matchesTerritory(p)
  );
  if (orgScoped.length > 0) return orgScoped[0];

  const platformDefault = candidates.filter(
    (p) => p.organizationId === null && matchesTerritory(p)
  );
  if (platformDefault.length > 0) return platformDefault[0];

  return null;
}

function estimateDeliveryDate(expectedClosingDate: string): string {
  // Default: 5 business days before expected close, floored at "today + 7d".
  const expected = new Date(expectedClosingDate);
  const minLeadtime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const target = new Date(expected.getTime() - 5 * 24 * 60 * 60 * 1000);
  const date = target > minLeadtime ? target : minLeadtime;
  return date.toISOString().slice(0, 10);
}

// ─── Route registration ─────────────────────────────────────────────────────

export function registerTitlePartnerRoutes(app: Express) {
  // ─── 1. POST /api/title-orders ───────────────────────────────────────────
  app.post(
    "/api/title-orders",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = createOrderBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }
        const body = parsed.data;

        // Verify the deal belongs to this org.
        const [deal] = await db
          .select()
          .from(deals)
          .where(and(eq(deals.id, body.dealId), eq(deals.organizationId, orgId)))
          .limit(1);
        if (!deal) {
          return Errors.notFound(res, "Deal");
        }

        const partner = await routeTitleOrder(
          orgId,
          body.propertyAddress.state,
          body.propertyAddress.county,
          body.titleCompanyId
        );

        // An explicitly named partner the org-scoped read did not match is a
        // 404 — never a silent downgrade to an unassigned "pending" broadcast.
        // Naming another org's private partner must not come back 201.
        if (body.titleCompanyId && !partner) {
          return Errors.notFound(res, "Title partner");
        }

        const estimatedDelivery = estimateDeliveryDate(body.expectedClosingDate);

        const [created] = await db
          .insert(titleOrders)
          .values({
            organizationId: orgId,
            dealId: body.dealId,
            titlePartnerId: partner?.id ?? null,
            status: partner ? "assigned" : "pending",
            statusDetails: {},
            propertyAddress: body.propertyAddress,
            buyerInfo: body.buyerInfo,
            sellerInfo: body.sellerInfo,
            salePrice: String(body.salePrice),
            expectedClosingDate: body.expectedClosingDate,
            estimatedDeliveryDate: estimatedDelivery,
            partnerAssignedAt: partner ? new Date() : null,
          })
          .returning();

        logger.info(
          `[title-orders] created order=${created.id} org=${orgId} deal=${body.dealId} partner=${partner?.id ?? "broadcast"}`
        );

        // Best-effort outbound webhook to the partner. We don't block the
        // response on it — partners are expected to poll if their webhook
        // failed. (Phase 7+ will move this onto the durable outbox queue.)
        if (partner?.webhookUrl) {
          fireAndForgetPartnerWebhook(partner, created).catch((err) => {
            logger.warn(
              `[title-orders] partner notify failed order=${created.id} partner=${partner.id} err=${err?.message ?? "unknown"}`
            );
          });
        }

        return res.status(201).json({
          orderId: created.id,
          status: created.status,
          estimatedDeliveryDate: created.estimatedDeliveryDate,
          assignedPartnerId: partner?.id ?? null,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );

  // ─── 2. POST /api/webhooks/title-orders/:orderId/status ─────────────────
  // Raw body parser so we can verify HMAC-SHA256 over the bytes the
  // partner actually signed. Mounted as a one-off so the global JSON
  // parser doesn't claim the body first.
  app.post(
    "/api/webhooks/title-orders/:orderId/status",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      try {
        const apiKey = extractBearer(req);
        if (!apiKey) return Errors.unauthorized(res);

        const partner = await authenticatePartnerByApiKey(apiKey);
        if (!partner) return Errors.unauthorized(res);

        // Fail closed if the secret is missing or undecryptable — never
        // accept an unsigned status update.
        if (!partner.hmacSecretEncrypted) {
          logger.warn(
            `[title-orders.webhook] partner ${partner.id} has no HMAC secret — rejecting`
          );
          return Errors.forbidden(res, "HMAC secret not configured for partner");
        }

        let secret: string;
        try {
          secret = decrypt(partner.hmacSecretEncrypted);
        } catch (err) {
          logger.error(
            `[title-orders.webhook] failed to decrypt secret for partner ${partner.id}`,
            err instanceof Error ? err : undefined
          );
          return Errors.forbidden(res, "HMAC secret unavailable");
        }
        if (!secret) {
          return Errors.forbidden(res, "HMAC secret empty");
        }

        const sigHeader = req.headers["x-acreos-signature"];
        const sigStr = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;

        const rawBody: Buffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(JSON.stringify(req.body ?? {}));
        if (!verifyHmac(rawBody, sigStr, secret)) {
          logger.warn(
            `[title-orders.webhook] HMAC verify failed for partner ${partner.id}`
          );
          return Errors.unauthorized(res);
        }

        // Now safe to parse JSON.
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(rawBody.toString("utf-8"));
        } catch {
          return Errors.badRequest(res, "Invalid JSON body");
        }
        const parsed = inboundStatusBodySchema.safeParse(parsedBody);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }
        const body = parsed.data;

        const orderId = Number(req.params.orderId);
        if (!Number.isFinite(orderId) || orderId <= 0) {
          return Errors.badRequest(res, "Invalid orderId");
        }

        const [order] = await db
          .select()
          .from(titleOrders)
          .where(eq(titleOrders.id, orderId))
          .limit(1);
        if (!order) {
          return Errors.notFound(res, "Title order");
        }

        // Only the partner this order is assigned to may update it.
        if (order.titlePartnerId && order.titlePartnerId !== partner.id) {
          return Errors.forbidden(res, "Order not assigned to this partner");
        }

        // SEC (2026-09-04): "or any partner if it was broadcast" was not a
        // policy, it was the absence of one. When `titlePartnerId` is NULL —
        // the state POST /api/title-orders writes whenever routeTitleOrder()
        // finds no territory match (`titlePartnerId: partner?.id ?? null`,
        // status "pending") — the check above is vacuous, and the auto-claim
        // below then handed the order to whichever partner called first. Any
        // holder of ANY active partner key could walk integer order ids and
        // take over another organization's pending title order, writing its
        // status, statusDetails and all three document S3 keys. The HMAC
        // proves WHO is calling, using that caller's own secret; it says
        // nothing about which orders they may touch.
        //
        // Eligibility is the SAME rule routeTitleOrder() uses to choose a
        // partner in the first place — a partner scoped to an organization
        // serves only that organization, and a partner with a NULL
        // organizationId is platform-wide — so a partner can only claim what
        // it could have been routed.
        if (
          !order.titlePartnerId &&
          partner.organizationId != null &&
          partner.organizationId !== order.organizationId
        ) {
          logger.warn(
            `[title-orders.webhook] partner ${partner.id} tried to claim unassigned order ${orderId} outside its organization`,
          );
          return Errors.forbidden(res, "Order not assigned to this partner");
        }

        const updates: Partial<typeof titleOrders.$inferInsert> = {
          status: body.status,
          statusDetails: body.statusDetails ?? order.statusDetails,
          updatedAt: new Date(),
        };
        if (body.commitmentS3Key) updates.commitmentS3Key = body.commitmentS3Key;
        if (body.scheduleBS3Key) updates.scheduleBS3Key = body.scheduleBS3Key;
        if (body.policyS3Key) updates.policyS3Key = body.policyS3Key;
        // Auto-claim the order on first webhook from a partner.
        if (!order.titlePartnerId) {
          updates.titlePartnerId = partner.id;
          updates.partnerAssignedAt = new Date();
        }

        await db
          .update(titleOrders)
          .set(updates)
          .where(eq(titleOrders.id, orderId));

        // Customer notification — non-blocking.
        notificationDispatcher
          .dispatch({
            eventType: "deal:closed", // closest mapped event for now
            channel: "in_app",
            priority: 3,
            orgId: order.organizationId,
            payload: {
              titleOrderId: order.id,
              dealId: order.dealId,
              status: body.status,
              statusDetails: body.statusDetails ?? {},
              partnerName: partner.partnerName,
            },
          })
          .catch((err) => {
            logger.warn(
              `[title-orders.webhook] notification dispatch failed: ${err?.message ?? "unknown"}`
            );
          });

        logger.info(
          `[title-orders.webhook] order=${orderId} partner=${partner.id} status=${body.status}`
        );
        return res.json({ ok: true, orderId, status: body.status });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );

  // ─── 3. POST /api/founder/title-partners — register a partner ───────────
  app.post(
    "/api/founder/title-partners",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(res, "Title-partner registry is restricted to founders");
        }
        const parsed = registerPartnerBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }
        const b = parsed.data;

        const [created] = await db
          .insert(titlePartners)
          .values({
            organizationId: b.organizationId ?? null,
            partnerName: b.partnerName,
            contactEmail: b.contactEmail,
            contactPhone: b.contactPhone,
            territoryStates: b.territoryStates,
            territoryCounties: b.territoryCounties,
            apiKeyHash: hashApiKey(b.apiKey),
            hmacSecretEncrypted: encrypt(b.hmacSecret),
            webhookUrl: b.webhookUrl,
            volumePricingTier: b.volumePricingTier,
            isActive: true,
          })
          .returning();

        logger.info(
          `[title-partners] registered partner=${created.id} tier=${created.volumePricingTier}`
        );

        return res.status(201).json({
          id: created.id,
          partnerName: created.partnerName,
          volumePricingTier: created.volumePricingTier,
          territoryStates: created.territoryStates,
          territoryCounties: created.territoryCounties,
          isActive: created.isActive,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );

  // ─── 3b. GET /api/founder/title-partners — list ─────────────────────────
  app.get(
    "/api/founder/title-partners",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(res, "Title-partner registry is restricted to founders");
        }
        const rows = await db.select().from(titlePartners);
        const safe = rows.map((r) => ({
          id: r.id,
          organizationId: r.organizationId,
          partnerName: r.partnerName,
          contactEmail: r.contactEmail,
          contactPhone: r.contactPhone,
          territoryStates: r.territoryStates,
          territoryCounties: r.territoryCounties,
          webhookUrl: r.webhookUrl,
          volumePricingTier: r.volumePricingTier,
          perFilePrice: VOLUME_TIER_PRICING[r.volumePricingTier] ?? 0,
          isActive: r.isActive,
          createdAt: r.createdAt,
        }));
        return res.json({ partners: safe });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );

  // ─── 3c. GET /api/founder/title-partners/billing-report ──────────────────
  app.get(
    "/api/founder/title-partners/billing-report",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(res, "Billing report is restricted to founders");
        }

        const closedAgg = await db
          .select({
            partnerId: titleOrders.titlePartnerId,
            count: sql<number>`count(*)::int`.as("count"),
          })
          .from(titleOrders)
          .where(eq(titleOrders.status, "closed"))
          .groupBy(titleOrders.titlePartnerId);

        const partners = await db.select().from(titlePartners);
        const byId = new Map(partners.map((p) => [p.id, p]));

        const rows = closedAgg
          .filter((r) => r.partnerId !== null)
          .map((r) => {
            const partner = byId.get(r.partnerId as number);
            const tier = partner?.volumePricingTier ?? "pilot";
            const perFile = VOLUME_TIER_PRICING[tier] ?? 0;
            return {
              partnerId: r.partnerId,
              partnerName: partner?.partnerName ?? "(unknown)",
              tier,
              perFilePrice: perFile,
              closedFiles: r.count,
              accruedRevenue: perFile * r.count,
            };
          });

        const total = rows.reduce((acc, r) => acc + r.accruedRevenue, 0);
        return res.json({ rows, totalAccruedRevenue: total });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );
}

// ─── Outbound partner notification (best-effort) ─────────────────────────────

async function fireAndForgetPartnerWebhook(
  partner: typeof titlePartners.$inferSelect,
  order: typeof titleOrders.$inferSelect
): Promise<void> {
  if (!partner.webhookUrl) return;
  let secret = "";
  try {
    secret = decrypt(partner.hmacSecretEncrypted);
  } catch {
    // If the secret is unrecoverable we silently skip — the partner can
    // still poll. Failing here would block the order create path.
    return;
  }
  if (!secret) return;

  const body = JSON.stringify({
    event: "title_order.created",
    orderId: order.id,
    organizationId: order.organizationId,
    dealId: order.dealId,
    propertyAddress: order.propertyAddress,
    buyerInfo: order.buyerInfo,
    sellerInfo: order.sellerInfo,
    salePrice: order.salePrice,
    expectedClosingDate: order.expectedClosingDate,
    estimatedDeliveryDate: order.estimatedDeliveryDate,
  });
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");

  try {
    await fetch(partner.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Acreos-Signature": `sha256=${sig}`,
      },
      body,
      // 10s timeout via AbortController would be ideal; node-fetch in this
      // codebase relies on the global fetch which already enforces a sane
      // default. Keep the surface minimal here.
    });
  } catch (err) {
    logger.warn(
      `[title-orders] outbound partner webhook failed partner=${partner.id} err=${(err as Error)?.message ?? "unknown"}`
    );
  }
}

// Re-export for tests / future integrations.
export { hashApiKey, verifyHmac, routeTitleOrder, estimateDeliveryDate };
