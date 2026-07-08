/**
 * Platform Connections — founder HTTP surface (native connect-an-account).
 *
 *   GET  /api/founder/connections                      — catalog + status (masked)
 *   POST /api/founder/connections/:provider/fields     — save pasted values
 *   POST /api/founder/connections/:provider/verify     — live check vs the real API
 *   POST /api/founder/connections/:provider/disconnect — revoke all fields
 *   GET  /api/founder/connections/:provider/oauth/start— consent URL (JSON)
 *   GET  /api/founder/connections/oauth/callback       — provider redirect target
 *
 * Auth: isAuthenticated + requireFounder on everything, INCLUDING the OAuth
 * callback (the browser carries the founder session cookie through the
 * provider round-trip). Plaintext secrets travel request→vault only; every
 * response is masked.
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const fieldsBodySchema = z.object({
  values: z
    .record(z.string(), z.string().min(1).max(4_000))
    .refine((v) => Object.keys(v).length > 0, { message: "at least one field required" }),
});

export function registerConnectionsRoutes(app: Express): void {
  app.get(
    "/api/founder/connections",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { getConnectionStatuses } = await import("./services/connections/platformConnections");
        return res.json({ providers: await getConnectionStatuses() });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/connections/:provider/fields",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = fieldsBodySchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
      try {
        const { setConnectionField } = await import("./services/connections/platformConnections");
        const saved: Record<string, string | null> = {};
        for (const [field, value] of Object.entries(parsed.data.values)) {
          const { fingerprint } = await setConnectionField(req.params.provider, field, value, getUserId(req));
          saved[field] = fingerprint;
        }
        return res.json({ ok: true, saved });
      } catch (err) {
        // Unknown provider/field/empty-value are founder-fixable.
        return Errors.badRequest(res, err instanceof Error ? err.message : String(err));
      }
    },
  );

  app.post(
    "/api/founder/connections/:provider/verify",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { verifyProvider } = await import("./services/connections/platformConnections");
        const result = await verifyProvider(req.params.provider);
        return res.json(result);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/connections/:provider/disconnect",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { disconnectProvider } = await import("./services/connections/platformConnections");
        const revoked = await disconnectProvider(req.params.provider, getUserId(req));
        return res.json({ ok: true, revoked });
      } catch (err) {
        return Errors.badRequest(res, err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── OAuth (prewired ad-account login) ─────────────────────────────────────
  app.get(
    "/api/founder/connections/:provider/oauth/start",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { isOAuthProvider, startOAuth } = await import("./services/connections/connectionsOAuth");
        if (!isOAuthProvider(req.params.provider)) {
          return Errors.badRequest(res, `"${req.params.provider}" does not use an OAuth connect flow`);
        }
        const result = await startOAuth(req.params.provider, getUserId(req));
        if (!result.ok) return Errors.badRequest(res, result.reason);
        return res.json({ url: result.url });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/founder/connections/oauth/callback",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const providerError = typeof req.query.error === "string" ? req.query.error : null;
      try {
        if (providerError || !code) {
          logger.warn(`[connections] OAuth callback without code${providerError ? ` (provider error: ${providerError})` : ""}`);
          return res.redirect(`/founder/autopilot/control?connect_error=${encodeURIComponent(providerError ?? "cancelled")}`);
        }
        const { completeOAuth } = await import("./services/connections/connectionsOAuth");
        const result = await completeOAuth(state, code, getUserId(req));
        if (result.ok) {
          return res.redirect(`/founder/autopilot/control?connected=${encodeURIComponent(result.provider ?? "")}`);
        }
        return res.redirect(`/founder/autopilot/control?connect_error=${encodeURIComponent(result.detail)}`);
      } catch (err) {
        logger.error("[connections] OAuth callback failed", err instanceof Error ? err : undefined);
        return res.redirect("/founder/autopilot/control?connect_error=unexpected");
      }
    },
  );
}
