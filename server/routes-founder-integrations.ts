/**
 * Founder Integrations Status Routes
 *
 * Founder-only endpoints that report which external service integrations
 * are configured (env vars set) and allow basic verification.
 * The page surfaces CLI commands for `fly secrets set` rather than
 * attempting programmatic secret management.
 */

import type { Express, Response } from "express";
import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";

// ─── Integration definitions ────────────────────────────────────────────────

interface IntegrationDef {
  key: string;
  displayName: string;
  envVars: string[];
  isCritical: boolean;
  setupDocsUrl: string;
  flySecretName: string; // primary env var name for CLI command
  category: "ai" | "communications" | "data" | "mail";
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    key: "openrouter",
    displayName: "OpenRouter (AI)",
    envVars: ["AI_INTEGRATIONS_OPENROUTER_API_KEY"],
    isCritical: true,
    setupDocsUrl: "https://openrouter.ai/keys",
    flySecretName: "AI_INTEGRATIONS_OPENROUTER_API_KEY",
    category: "ai",
  },
  {
    key: "openai",
    displayName: "OpenAI",
    envVars: ["AI_INTEGRATIONS_OPENAI_API_KEY"],
    isCritical: false,
    setupDocsUrl: "https://platform.openai.com/api-keys",
    flySecretName: "AI_INTEGRATIONS_OPENAI_API_KEY",
    category: "ai",
  },
  {
    key: "lob",
    displayName: "Lob (Direct Mail)",
    envVars: ["LOB_API_KEY", "LOB_LIVE_API_KEY"],
    isCritical: false,
    setupDocsUrl: "https://dashboard.lob.com",
    flySecretName: "LOB_API_KEY",
    category: "mail",
  },
  {
    key: "twilio",
    displayName: "Twilio (SMS/Voice)",
    envVars: ["TWILIO_ACCOUNT_SID"],
    isCritical: true,
    setupDocsUrl: "https://console.twilio.com",
    flySecretName: "TWILIO_ACCOUNT_SID",
    category: "communications",
  },
  {
    key: "ses",
    displayName: "AWS SES (Email)",
    envVars: ["AWS_ACCESS_KEY_ID"],
    isCritical: false,
    setupDocsUrl: "https://console.aws.amazon.com/ses",
    flySecretName: "AWS_ACCESS_KEY_ID",
    category: "communications",
  },
  {
    key: "attom",
    displayName: "ATTOM Data",
    envVars: ["ATTOM_API_KEY"],
    isCritical: true,
    setupDocsUrl: "https://api.gateway.attomdata.com",
    flySecretName: "ATTOM_API_KEY",
    category: "data",
  },
  {
    key: "regrid",
    displayName: "Regrid (Parcels)",
    envVars: ["REGRID_API_KEY"],
    isCritical: true,
    setupDocsUrl: "https://app.regrid.com/developers",
    flySecretName: "REGRID_API_KEY",
    category: "data",
  },
  {
    key: "batchdata",
    displayName: "BatchData",
    envVars: ["BATCHDATA_API_KEY"],
    isCritical: false,
    setupDocsUrl: "https://app.batchdata.com",
    flySecretName: "BATCHDATA_API_KEY",
    category: "data",
  },
];

function isEnvConfigured(envVars: string[]): boolean {
  return envVars.some((v) => !!process.env[v]?.trim());
}

// ─── Route registration ─────────────────────────────────────────────────────

export function registerFounderIntegrationsRoutes(app: Express) {
  /**
   * GET /api/founder/integrations
   * Returns the status of all known integrations, derived from env vars.
   */
  app.get(
    "/api/founder/integrations",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(res, "Integrations dashboard is restricted to founders");
        }

        const integrations = INTEGRATIONS.map((def) => {
          const configured = isEnvConfigured(def.envVars);
          return {
            key: def.key,
            displayName: def.displayName,
            isConfigured: configured,
            isCritical: def.isCritical,
            category: def.category,
            setupDocsUrl: def.setupDocsUrl,
            flySecretName: def.flySecretName,
            envVars: def.envVars,
            lastVerificationStatus: "never_tested" as const,
            lastVerifiedAt: null as string | null,
          };
        });

        const total = integrations.length;
        const configured = integrations.filter((i) => i.isConfigured).length;
        const criticalMissing = integrations.filter(
          (i) => i.isCritical && !i.isConfigured
        ).length;

        logger.info(
          `[FounderIntegrations] Status check: ${configured}/${total} configured, ${criticalMissing} critical missing`
        );

        res.json({
          integrations,
          summary: {
            total,
            configured,
            criticalMissing,
          },
        });
      } catch (error) {
        logger.error(
          "Failed to fetch integrations status",
          error instanceof Error ? error : undefined
        );
        return Errors.internal(res, error);
      }
    }
  );

  /**
   * POST /api/founder/integrations/:key/verify
   * Attempts a minimal verification of the integration.
   * For MVP, checks whether the env var is set and returns pass/fail.
   */
  app.post(
    "/api/founder/integrations/:key/verify",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(res, "Integrations verification is restricted to founders");
        }

        const { key } = req.params;
        const def = INTEGRATIONS.find((i) => i.key === key);

        if (!def) {
          return Errors.notFound(res, "Integration");
        }

        const configured = isEnvConfigured(def.envVars);

        if (!configured) {
          logger.info(
            `[FounderIntegrations] Verification failed for ${key}: env var not set`
          );
          return res.json({
            key,
            status: "fail",
            message: `${def.displayName} is not configured. Set the environment variable to enable it.`,
            verifiedAt: new Date().toISOString(),
          });
        }

        // MVP: env var is set = pass. Real verification (API call) can be added later.
        logger.info(
          `[FounderIntegrations] Verification passed for ${key}: env var is set`
        );
        res.json({
          key,
          status: "pass",
          message: `${def.displayName} environment variable is configured.`,
          verifiedAt: new Date().toISOString(),
        });
      } catch (error) {
        logger.error(
          `Failed to verify integration ${req.params.key}`,
          error instanceof Error ? error : undefined
        );
        return Errors.internal(res, error);
      }
    }
  );
}
