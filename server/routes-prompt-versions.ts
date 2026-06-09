/**
 * /api/founder/prompt-versions — Phase 4 Week 21-22 (Nadia-AI §2.A).
 *
 * Founder-only endpoints to inspect + manage the prompt registry that
 * backs the A/B versioning harness.
 *
 *   GET    /api/founder/prompt-versions             — list all versions (grouped)
 *   POST   /api/founder/prompt-versions/weights     — bulk-update weights
 *   POST   /api/founder/prompt-versions/promote     — promote a candidate
 *   POST   /api/founder/prompt-versions/auto-promote — run auto-promotion eval
 *   POST   /api/founder/prompt-versions/register    — register a new version
 *
 * The UI is /founder/prompt-versions (client/src/pages/founder/prompt-versions.tsx).
 */

import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { isFounderIdentity } from "./services/founder";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import {
  listVersions,
  updateWeights,
  promoteCandidate,
  evaluateAutoPromotion,
  registerVersion,
  invalidateCache,
} from "./services/promptRegistry";

function requireFounder(req: AuthenticatedRequest, res: any): boolean {
  const user = req.user as any;
  const userId = (req as any).auth?.userId ?? user?.clerkUserId ?? null;
  const email = user?.email ?? null;
  if (!isFounderIdentity({ email, userId })) {
    Errors.notFound(res, "Resource");
    return false;
  }
  return true;
}

const weightsSchema = z.object({
  updates: z
    .array(
      z.object({
        promptName: z.string().min(1).max(100),
        version: z.string().min(1).max(50),
        weight: z.number().int().min(0).max(100),
      }),
    )
    .min(1)
    .max(50),
});

const promoteSchema = z.object({
  promptName: z.string().min(1).max(100),
  candidateVersion: z.string().min(1).max(50),
  prodVersion: z.string().min(1).max(50),
});

const registerSchema = z.object({
  promptName: z.string().min(1).max(100),
  version: z.string().min(1).max(50),
  system: z.string().min(1).max(20000),
  tier: z.enum(["critical", "standard", "background"]).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  isCandidate: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

export function registerPromptVersionsRoutes(app: Express): void {
  // List — grouped by promptName for the UI table.
  app.get("/api/founder/prompt-versions", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    try {
      const all = await listVersions();
      const grouped: Record<string, typeof all> = {};
      for (const v of all) {
        const list = grouped[v.promptName] ?? (grouped[v.promptName] = []);
        list.push(v);
      }
      // Per-prompt summary: prod (active && weight>0 && !candidate),
      // candidate (active && isCandidate), score deltas.
      const summaries = Object.entries(grouped).map(([name, versions]) => {
        const prod = versions.find((v) => v.active && !v.isCandidate && v.weight > 0);
        const candidate = versions.find((v) => v.active && v.isCandidate);
        const delta =
          prod && candidate && prod.evalScore != null && candidate.evalScore != null
            ? Number((candidate.evalScore - prod.evalScore).toFixed(4))
            : null;
        return { promptName: name, versions, prod, candidate, scoreDelta: delta };
      });
      return res.json({ prompts: summaries });
    } catch (err) {
      logger.error("[prompt-versions] list failed", err as Error);
      return Errors.internal(res, err);
    }
  });

  app.post("/api/founder/prompt-versions/weights", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const parsed = weightsSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      await updateWeights(parsed.data.updates);
      return res.json({ ok: true, updated: parsed.data.updates.length });
    } catch (err) {
      logger.error("[prompt-versions] weights update failed", err as Error);
      return Errors.internal(res, err);
    }
  });

  app.post("/api/founder/prompt-versions/promote", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const parsed = promoteSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      await promoteCandidate(
        parsed.data.promptName,
        parsed.data.candidateVersion,
        parsed.data.prodVersion,
      );
      return res.json({ ok: true });
    } catch (err) {
      logger.error("[prompt-versions] promote failed", err as Error);
      return Errors.internal(res, err);
    }
  });

  app.post("/api/founder/prompt-versions/auto-promote", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    try {
      const decisions = await evaluateAutoPromotion();
      return res.json({ ok: true, decisions });
    } catch (err) {
      logger.error("[prompt-versions] auto-promote failed", err as Error);
      return Errors.internal(res, err);
    }
  });

  app.post("/api/founder/prompt-versions/register", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      const v = await registerVersion(parsed.data);
      return res.json({ ok: true, version: v });
    } catch (err) {
      logger.error("[prompt-versions] register failed", err as Error);
      return Errors.internal(res, err);
    }
  });

  app.post("/api/founder/prompt-versions/cache/invalidate", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    invalidateCache();
    return res.json({ ok: true });
  });
}
