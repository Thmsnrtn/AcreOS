/**
 * /api/ui-state — server-backed per-user UI preferences (Tahoe E6).
 *
 * Durable home for ephemeral UI state that used to live only in
 * localStorage — collapsed panels, view toggles, dismissed banners — so it
 * follows a user across devices (Tom uses iOS AND desktop). Keyed by
 * (organization_id, user_id, key); `value` is an opaque jsonb blob owned by
 * each useUiState<T> consumer.
 *
 * GET /api/ui-state          → all keys for (org, user) as { [key]: value }
 * GET /api/ui-state/:key     → single value, or 404 if unset
 * PUT /api/ui-state/:key     → upsert one key's value
 *
 * Writes are scoped to the calling user within their org, so any member may
 * persist their own UI state — no extra permission gate needed.
 */

import { Router, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { uiState } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

// Keys are namespaced "scope:field" — keep them short and bounded.
const KEY_RE = /^[a-zA-Z0-9_:.-]{1,64}$/;

const putSchema = z.object({
  // Any JSON-serializable value. We don't constrain the shape — each
  // consumer owns its own; we only cap the serialized size to prevent abuse.
  value: z.unknown(),
});

const MAX_VALUE_BYTES = 16 * 1024; // 16KB per key is generous for UI prefs

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);

    const rows = await db
      .select({ key: uiState.key, value: uiState.value })
      .from(uiState)
      .where(and(eq(uiState.organizationId, organizationId), eq(uiState.userId, userId)));

    const out: Record<string, unknown> = {};
    for (const row of rows) out[row.key] = row.value;
    res.json(out);
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.get("/:key", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const key = req.params.key;
    if (!KEY_RE.test(key)) {
      return Errors.badRequest(res, "Invalid UI-state key");
    }

    const [row] = await db
      .select({ value: uiState.value })
      .from(uiState)
      .where(
        and(
          eq(uiState.organizationId, organizationId),
          eq(uiState.userId, userId),
          eq(uiState.key, key),
        ),
      )
      .limit(1);

    if (!row) return Errors.notFound(res, "UI state");
    res.json({ key, value: row.value });
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.put("/:key", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = getOrganizationId(req);
    const userId = getUserId(req);
    const key = req.params.key;
    if (!KEY_RE.test(key)) {
      return Errors.badRequest(res, "Invalid UI-state key");
    }

    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const value = parsed.data.value;

    if (Buffer.byteLength(JSON.stringify(value ?? null), "utf8") > MAX_VALUE_BYTES) {
      return Errors.badRequest(res, "UI-state value too large");
    }

    await db
      .insert(uiState)
      .values({ organizationId, userId, key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [uiState.organizationId, uiState.userId, uiState.key],
        set: { value, updatedAt: new Date() },
      });

    logger.info("UI state persisted", { organizationId, userId, key });
    res.json({ key, value });
  } catch (error) {
    Errors.internal(res, error);
  }
});

export default router;
