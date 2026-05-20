/**
 * Outbox consumer — runs script→bundle render in the background on the
 * worker process group. The CMO agent emits `cmo.render-script` events;
 * this handler picks them up, renders, and surfaces the bundle in the
 * founder approval queue.
 *
 * Registration happens in server/worker.ts (or wherever the outbox
 * dispatcher lives). The handler is idempotent — if a render with the
 * same scriptId + bundleId already exists in 'ready' state, it short-
 * circuits and reuses the existing bundle.
 */

import { db } from "../db";
import { cmoAdRenders, cmoScripts } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { renderScriptToBundle } from "../services/cmo/renderOrchestrator";
import { logger } from "../utils/logger";

export interface CmoRenderPayload {
  scriptId: string;
  bundleId?: string;
  aspectRatios?: Array<"9:16" | "1:1" | "16:9">;
}

export async function handleCmoRender(payload: CmoRenderPayload): Promise<{ bundleId: string }> {
  // Idempotency: if a 'ready' render exists for this script, skip.
  const existingReady = await db.query.cmoAdRenders.findFirst({
    where: and(
      eq(cmoAdRenders.scriptId, payload.scriptId),
      eq(cmoAdRenders.status, "ready"),
    ),
  });
  if (existingReady) {
    logger.info(`[cmo:render-job] script ${payload.scriptId.slice(0, 8)} already has ready render — skipping`);
    return { bundleId: existingReady.bundleId ?? existingReady.id };
  }

  const script = await db.query.cmoScripts.findFirst({
    where: eq(cmoScripts.id, payload.scriptId),
  });
  if (!script) {
    throw new Error(`[cmo:render-job] script ${payload.scriptId} not found`);
  }

  logger.info(`[cmo:render-job] rendering script ${script.id.slice(0, 8)} archetype=${script.hookArchetype}`);

  const result = await renderScriptToBundle({
    scriptId: payload.scriptId,
    bundleId: payload.bundleId,
    aspectRatios: payload.aspectRatios,
  });

  logger.info(
    `[cmo:render-job] bundle ${result.bundleId.slice(0, 8)} done — ${result.renders.length} renders, ` +
      `decision item ${result.decisionsInboxItemId}, total cost $${(result.costBreakdown.totalCents / 100).toFixed(2)}`,
  );

  return { bundleId: result.bundleId };
}
