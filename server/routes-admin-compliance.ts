/**
 * Admin compliance routes — Kareem §5 + §7.
 *
 *   POST /api/admin/deployments
 *        Records a production deploy. Called by the GitHub Actions
 *        deploy.yml workflow on success. Authenticated by the
 *        DEPLOY_BOT_TOKEN shared secret (set via `fly secrets set
 *        DEPLOY_BOT_TOKEN=...` and `gh secret set DEPLOY_BOT_TOKEN`).
 *        Founder login also accepted for manual entry.
 *
 *   GET  /api/admin/deployments
 *        Founder-only list of recent deploys. Pagination via limit/offset.
 *
 *   POST /api/admin/dr-drills
 *        Records a DR drill result. Founder-only.
 *
 *   GET  /api/admin/dr-drills
 *        Founder-only list of past DR drills. The last-drill row is also
 *        surfaced on /api/jobs/health so the founder home flags drill
 *        staleness.
 */

import type { Express, Response, NextFunction, Request } from "express";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { db } from "./db";
import { deployments, drDrills } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated, requireFounder } from "./auth";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

/**
 * Authenticate either as a founder OR via the DEPLOY_BOT_TOKEN shared
 * secret. The token-only path is required so .github/workflows/deploy.yml
 * can POST deploy rows without a human session.
 */
function isAuthenticatedOrBotToken(req: Request, res: Response, next: NextFunction): void {
  const token = (req.header("x-deploy-bot-token") || "").trim();
  const expected = (process.env.DEPLOY_BOT_TOKEN || "").trim();
  if (expected && token && token === expected) {
    (req as Request & { isDeployBot?: boolean }).isDeployBot = true;
    return next();
  }
  // Fall through to normal auth — the founder gate runs as the next
  // middleware in the chain.
  return isAuthenticated(req as AuthenticatedRequest, res, next);
}

function requireFounderOrBot(req: Request, res: Response, next: NextFunction): void {
  if ((req as Request & { isDeployBot?: boolean }).isDeployBot) return next();
  return requireFounder(req as AuthenticatedRequest, res, next);
}

const deployInsertSchema = z.object({
  gitSha: z.string().min(7).max(64),
  prNumber: z.number().int().positive().optional(),
  approvedBy: z.string().max(256).optional(),
  deployedBy: z.string().max(256),
  workflowRunUrl: z.string().url().optional(),
  flyMachineIds: z.string().max(512).optional(),
  environment: z.string().max(32).default("production"),
  status: z.enum(["started", "success", "failure", "rollback"]).default("success"),
  rollbackOfDeploymentId: z.number().int().positive().optional(),
  notes: z.string().max(2048).optional(),
});

const drillInsertSchema = z.object({
  ranBy: z.string().max(256),
  snapshotAgeHours: z.number().int().nonnegative().optional(),
  restoreMinutes: z.number().int().nonnegative().optional(),
  bootMinutes: z.number().int().nonnegative().optional(),
  syntheticCheckMinutes: z.number().int().nonnegative().optional(),
  dataVerifyMinutes: z.number().int().nonnegative().optional(),
  totalRtoMinutes: z.number().int().nonnegative(),
  passedRtoTarget: z.boolean().default(false),
  whatWentWrong: z.string().max(4096).optional(),
  whatsFlaky: z.string().max(4096).optional(),
  actionItems: z.string().max(4096).optional(),
  postmortemRef: z.string().max(1024).optional(),
});

export function registerAdminComplianceRoutes(app: Express): void {
  // ── deployments ────────────────────────────────────────────────────────
  app.post(
    "/api/admin/deployments",
    isAuthenticatedOrBotToken,
    requireFounderOrBot,
    async (req: Request, res: Response) => {
      try {
        const parsed = deployInsertSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const [row] = await db.insert(deployments).values(parsed.data).returning();
        logger.info("[admin.deployments] recorded", {
          metadata: { id: row.id, gitSha: row.gitSha, status: row.status, deployedBy: row.deployedBy },
        });
        return res.status(201).json(row);
      } catch (err) {
        logger.error("[admin.deployments] insert failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/admin/deployments",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const rows = await db
          .select()
          .from(deployments)
          .orderBy(desc(deployments.deployedAt))
          .limit(limit)
          .offset(offset);
        return res.json({ deployments: rows, limit, offset });
      } catch (err) {
        logger.error("[admin.deployments.list] failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── DR drills ──────────────────────────────────────────────────────────
  app.post(
    "/api/admin/dr-drills",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = drillInsertSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const [row] = await db.insert(drDrills).values(parsed.data).returning();
        logger.info("[admin.dr-drills] recorded", {
          metadata: { id: row.id, totalRtoMinutes: row.totalRtoMinutes, passed: row.passedRtoTarget },
        });
        return res.status(201).json(row);
      } catch (err) {
        logger.error("[admin.dr-drills] insert failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/admin/dr-drills",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = Math.min(Number(req.query.limit) || 50, 500);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const rows = await db
          .select()
          .from(drDrills)
          .orderBy(desc(drDrills.ranAt))
          .limit(limit)
          .offset(offset);
        return res.json({ drills: rows, limit, offset });
      } catch (err) {
        logger.error("[admin.dr-drills.list] failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
