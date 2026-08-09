/**
 * /api/me/autonomy — per-agent autonomy matrix.
 *
 * Split off from /api/me/preferences in JC#14 (migration 0030) — autonomy is
 * operational policy (who acts, when, with what monetary ceiling), not a
 * visual preference. Lives in its own column so theme writes can't trample
 * agent policy and agents have a narrow read surface at action time.
 *
 * GET    /api/me/autonomy            → current matrix (empty object if unset;
 *                                       client fills defaults from
 *                                       settings/autonomy-panel)
 * GET    /api/me/autonomy/effective  → the ENFORCED verdict per agent ×
 *                                       action, from the same
 *                                       resolveActionPolicy function the
 *                                       approval-kernel chokepoint consults —
 *                                       promise = behavior by construction
 * PATCH  /api/me/autonomy            → merge partial update; level 0-3,
 *                                       threshold cents are non-negative
 *                                       ints, time guards 0-23
 *
 * ENFORCED (P-1, 2026-08-09): the matrix is consumed by resolveActionPolicy
 * (server/services/resolveActionPolicy.ts) at the single chokepoint where
 * pending_actions are written (approvalKernel.proposePendingAction); the
 * verdict + matrix rule are stamped on every frozen action and `forbid`
 * refuses outright. The old "wired progressively as Phase E surfaces" note
 * is retired. pax.pausedUntil is additionally enforced at the tool/scheduler
 * chokepoints — see server/services/paxPause.ts and the schema field below.
 */

import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { users, type AutonomyPreferences } from "@shared/models/auth";
import type { AutonomyAgent } from "@shared/models/auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import {
  KERNEL_ACTION_MATRIX_IDS,
  MATRIX_ACTION_IDS,
  loadOrgAutonomySnapshot,
  resolvePolicyFromSnapshot,
  type ResolvedActionPolicy,
} from "./services/resolveActionPolicy";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

const autonomyLevelSchema = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3),
]);

const agentAutonomySchema = z.object({
  level: autonomyLevelSchema.optional(),
  perAction: z.record(z.string().max(64), autonomyLevelSchema).optional(),
  thresholdsCents: z.record(z.string().max(64), z.number().int().min(0).max(1_000_000_000)).optional(),
  // Workstream A (Honesty) — kill switch. ISO-8601 datetime. While in the
  // future, downstream executors skip auto-execution for this agent (only
  // ask / draft, never execute). ENFORCED (2026-07-29) for pax via
  // server/services/paxPause.ts (org-level: any org user's active pause
  // pauses the org) at three points: the executeTool chokepoint
  // (server/ai/tools.ts refuses non-PAUSE_SAFE_TOOLS), the Pax scheduler
  // (paxScheduler.ts skips due tasks), and the autonomous decision executor
  // (autonomousDecisionExecutor.ts defers org-scoped items). Expiry is
  // implicit — every read compares against now, so behavior resumes the
  // moment the timestamp passes.
  pausedUntil: z.string().datetime().optional(),
}).strict();

const autonomySchema = z.object({
  atlas: agentAutonomySchema.optional(),
  pax: agentAutonomySchema.optional(),
  sophie: agentAutonomySchema.optional(),
  timeGuards: z.object({
    pauseStartHour: z.number().int().min(0).max(23).optional(),
    pauseEndHour: z.number().int().min(0).max(23).optional(),
    dailyActionLimit: z.number().int().min(0).max(10000).optional(),
  }).strict().optional(),
}).strict();

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const [row] = await db
      .select({ autonomyPreferences: users.autonomyPreferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    res.json((row?.autonomyPreferences ?? {}) as AutonomyPreferences);
  } catch (error) {
    Errors.internal(res, error);
  }
});

// ── P-1 promise parity: what the kernel will actually do ────────────────────
// Renders from resolveActionPolicy — the SAME function the approval-kernel
// chokepoint consults — so the panel can display enforcement truth, not
// stored intent. Org-scoped (getOrCreateOrg): the matrix is stored per-user
// but enforced most-restrictive-human-wins across the org, so the verdict
// here can be stricter than the caller's own stored preference.
//
// Without params: verdicts for every matrix action id per agent, plus the
// five kernel-governed action types (the only ones the pending-actions
// chokepoint sees today — verdicts for the rest are policy resolution, not
// yet a chokepoint). Point query: ?agent=pax&actionType=send_email
// [&amountCents=12345] for a single verdict (e.g. threshold previews).
const effectiveQuerySchema = z.object({
  agent: z.enum(["atlas", "pax", "sophie"]).optional(),
  actionType: z.string().min(1).max(64).optional(),
  amountCents: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
}).strict();

router.get("/effective", getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);

    const parsed = effectiveQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const { agent, actionType, amountCents } = parsed.data;

    // One snapshot, many pure resolutions — no per-action query fan-out.
    const snapshot = await loadOrgAutonomySnapshot(organizationId);
    const when = new Date();
    const verdict = (a: AutonomyAgent, action: string, cents?: number): ResolvedActionPolicy =>
      resolvePolicyFromSnapshot(snapshot, {
        organizationId,
        agent: a,
        actionType: action,
        amountCents: cents ?? null,
        when,
      });

    if (actionType) {
      return res.json(verdict(agent ?? "pax", actionType, amountCents));
    }

    const agents: Partial<Record<AutonomyAgent, Record<string, ResolvedActionPolicy>>> = {};
    for (const [agentId, actionIds] of Object.entries(MATRIX_ACTION_IDS)) {
      const perAction: Record<string, ResolvedActionPolicy> = {};
      for (const id of actionIds) perAction[id] = verdict(agentId as AutonomyAgent, id);
      agents[agentId as AutonomyAgent] = perAction;
    }

    // The kernel-governed action types (all Pax-lane today). These are the
    // verdicts the pending-actions chokepoint enforces verbatim.
    const kernel: Record<string, ResolvedActionPolicy> = {};
    for (const tool of Object.keys(KERNEL_ACTION_MATRIX_IDS)) kernel[tool] = verdict("pax", tool);

    res.json({
      organizationId,
      resolvedAt: when.toISOString(),
      enforcedAt: "approvalKernel.proposePendingAction (the pending_actions chokepoint)",
      agents,
      kernel,
    });
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.patch("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);

    const parsed = autonomySchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const update = parsed.data;
    if (Object.keys(update).length === 0) {
      return Errors.badRequest(res, "Empty autonomy update");
    }

    const [current] = await db
      .select({ autonomyPreferences: users.autonomyPreferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const merged: AutonomyPreferences = {
      ...(current?.autonomyPreferences ?? {}),
      ...update,
    };

    await db
      .update(users)
      .set({ autonomyPreferences: merged, updatedAt: new Date() })
      .where(eq(users.id, userId));

    logger.info("Autonomy preferences updated", { userId, fields: Object.keys(update) });
    res.json(merged);
  } catch (error) {
    Errors.internal(res, error);
  }
});

export default router;
