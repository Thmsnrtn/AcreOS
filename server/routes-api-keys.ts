/**
 * Internal management routes for the public API surface.
 *
 *   GET    /api/admin/api-keys          — list this org's keys
 *   POST   /api/admin/api-keys          — create a new key (returns plaintext ONCE)
 *   POST   /api/admin/api-keys/:id/revoke
 *   POST   /api/admin/api-keys/:id/regenerate
 *
 * Auth: standard session (isAuthenticated + getOrCreateOrg) + adminGuard.
 * These power the /settings/api-keys UI — they are *not* the public
 * /api/v1/* surface (which uses bearer-token auth instead).
 *
 * NOT registered in server/routes.ts yet (per Lens 50 v0 spec — the
 * whole API surface is additive scaffold).
 */

import type { Express } from "express";
import { z } from "zod";
import { eq, and, desc, isNull } from "drizzle-orm";
import { db } from "./db";
import { apiKeys } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { adminGuard } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  generateApiKey,
  validateScopes,
  ALL_SCOPES,
  type ApiScope,
} from "./services/apiKeys";
import {
  getOrganizationId,
  getUserId,
  type AuthenticatedRequest,
} from "./types/request";

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z
    .array(z.string())
    .min(1, "at least one scope is required")
    .refine(validateScopes, {
      message: `scopes must be a subset of: ${ALL_SCOPES.join(", ")}`,
    }),
  expires_at: z.string().datetime().optional(),
  rate_limit: z.number().int().positive().max(1_000_000).optional(),
  mode: z.enum(["live", "test"]).default("live"),
});

export function registerApiKeyRoutes(app: Express): void {
  // ─── LIST ────────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/api-keys",
    isAuthenticated,
    getOrCreateOrg,
    adminGuard,
    async (req, res) => {
      const orgId = getOrganizationId(req as AuthenticatedRequest);
      try {
        const rows = await db
          .select({
            id: apiKeys.id,
            name: apiKeys.name,
            prefix: apiKeys.prefix,
            scopes: apiKeys.scopes,
            rateLimit: apiKeys.rateLimit,
            lastUsedAt: apiKeys.lastUsedAt,
            expiresAt: apiKeys.expiresAt,
            createdAt: apiKeys.createdAt,
            createdBy: apiKeys.createdBy,
            revokedAt: apiKeys.revokedAt,
          })
          .from(apiKeys)
          .where(eq(apiKeys.organizationId, orgId))
          .orderBy(desc(apiKeys.createdAt));
        res.json({ keys: rows });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ─── CREATE ──────────────────────────────────────────────────────────────
  // Returns the plaintext token in `plaintext_key`. The UI shows this
  // ONCE and warns the user — there is no second chance.
  app.post(
    "/api/admin/api-keys",
    isAuthenticated,
    getOrCreateOrg,
    adminGuard,
    async (req, res) => {
      const orgId = getOrganizationId(req as AuthenticatedRequest);
      const userId = getUserId(req as AuthenticatedRequest);

      const parsed = createKeySchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { name, scopes, expires_at, rate_limit, mode } = parsed.data;

      try {
        const { plaintext, displayPrefix, hashedKey } = generateApiKey(mode);
        const [created] = await db
          .insert(apiKeys)
          .values({
            organizationId: orgId,
            name,
            prefix: displayPrefix,
            hashedKey,
            scopes: scopes as ApiScope[],
            rateLimit: rate_limit ?? null,
            expiresAt: expires_at ? new Date(expires_at) : null,
            createdBy: userId,
          })
          .returning({
            id: apiKeys.id,
            name: apiKeys.name,
            prefix: apiKeys.prefix,
            scopes: apiKeys.scopes,
            createdAt: apiKeys.createdAt,
          });

        logger.info("api_key created", {
          metadata: { apiKeyId: created.id, orgId, createdBy: userId, scopes },
        });

        res.status(201).json({
          key: created,
          plaintext_key: plaintext,
          warning:
            "This is the only time the full key will be shown. Store it now — we never log it and cannot recover it.",
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ─── REVOKE ──────────────────────────────────────────────────────────────
  app.post(
    "/api/admin/api-keys/:id/revoke",
    isAuthenticated,
    getOrCreateOrg,
    adminGuard,
    async (req, res) => {
      const orgId = getOrganizationId(req as AuthenticatedRequest);
      const userId = getUserId(req as AuthenticatedRequest);
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");

      try {
        const [revoked] = await db
          .update(apiKeys)
          .set({
            revokedAt: new Date(),
            revokedBy: userId,
            revokedReason: req.body?.reason ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(apiKeys.id, id),
              eq(apiKeys.organizationId, orgId),
              isNull(apiKeys.revokedAt),
            ),
          )
          .returning({ id: apiKeys.id });
        if (!revoked) return Errors.notFound(res, "API key");
        logger.info("api_key revoked", { metadata: { apiKeyId: id, orgId, revokedBy: userId } });
        res.json({ revoked: true, id });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ─── REGENERATE ──────────────────────────────────────────────────────────
  // Rotates the underlying secret while keeping the row id, name, and
  // scopes stable. Returns the new plaintext exactly once.
  app.post(
    "/api/admin/api-keys/:id/regenerate",
    isAuthenticated,
    getOrCreateOrg,
    adminGuard,
    async (req, res) => {
      const orgId = getOrganizationId(req as AuthenticatedRequest);
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");

      try {
        const mode = req.body?.mode === "test" ? "test" : "live";
        const { plaintext, displayPrefix, hashedKey } = generateApiKey(mode);
        const [updated] = await db
          .update(apiKeys)
          .set({
            prefix: displayPrefix,
            hashedKey,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(apiKeys.id, id),
              eq(apiKeys.organizationId, orgId),
              isNull(apiKeys.revokedAt),
            ),
          )
          .returning({
            id: apiKeys.id,
            name: apiKeys.name,
            prefix: apiKeys.prefix,
          });
        if (!updated) return Errors.notFound(res, "API key");
        res.json({
          key: updated,
          plaintext_key: plaintext,
          warning:
            "Old key is now invalid. Update every integration with the new value.",
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );
}
