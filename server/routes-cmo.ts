/**
 * CMO ad engine routes — founder-only.
 *
 * Endpoints:
 *   GET    /api/founder/cmo/dashboard            — pending bundles, recent live, archetype rollup
 *   GET    /api/founder/cmo/brand-profile        — read brand profile
 *   PATCH  /api/founder/cmo/brand-profile        — update brand profile
 *   GET    /api/founder/cmo/budget               — read budget caps + current spend
 *   PATCH  /api/founder/cmo/budget               — update caps
 *   POST   /api/founder/cmo/generate             — kick off agent generation (manual trigger)
 *   POST   /api/founder/cmo/approve              — approve a bundle for broadcast
 *   POST   /api/founder/cmo/reject               — reject with note (stored, fed back into generation)
 *   GET    /api/founder/cmo/asset                — download a stored render (gated by isFounder)
 *   GET    /api/founder/cmo/archetypes           — list archetypes with rolling perf
 *
 * Every endpoint goes through isAuthenticated + isFounder. The asset
 * download is a stream, not a redirect to a signed URL (v1 uses local FS).
 */

import type { Express, Request, Response } from "express";
import type { AuthenticatedRequest } from "./types/request";
import * as fs from "fs/promises";
import * as path from "path";
import { db } from "./db";
import {
  brandProfiles,
  cmoBudget,
  cmoScripts,
  cmoAdRenders,
  cmoHookArchetypes,
  cmoRejectionNotes,
  decisionsInboxItems,
  outbox,
} from "@shared/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { logger } from "./utils/logger";
import { getStorage } from "./services/cmo/storage";

export function registerCmoRoutes(app: Express) {
  // ─── Dashboard ──────────────────────────────────────────────────────────
  app.get("/api/founder/cmo/dashboard", isAuthenticated, requireFounder, async (_req, res) => {
    const brand = await db.query.brandProfiles.findFirst({
      where: eq(brandProfiles.slug, "acreos"),
    });
    if (!brand) {
      return res.json({ pending: [], live: [], archetypes: [], budget: null });
    }

    const pendingItems = await db
      .select()
      .from(decisionsInboxItems)
      .where(
        and(
          eq(decisionsInboxItems.itemType, "cmo_ad_review"),
          eq(decisionsInboxItems.status, "pending"),
        ),
      )
      .orderBy(desc(decisionsInboxItems.createdAt))
      .limit(20);

    // Eagerly fetch the renders referenced by each pending inbox item so the
    // UI doesn't need to fan-out per-item.
    const allRenderIds: string[] = [];
    for (const item of pendingItems) {
      const ctx = item.contextBundle as { renders?: Array<{ id: string }> } | null;
      if (ctx?.renders) {
        for (const r of ctx.renders) allRenderIds.push(r.id);
      }
    }
    const renders = allRenderIds.length > 0
      ? await db.select().from(cmoAdRenders).where(inArray(cmoAdRenders.id, allRenderIds))
      : [];
    const rendersById = new Map(renders.map((r) => [r.id, r]));

    const recentLive = await db
      .select()
      .from(cmoAdRenders)
      .where(eq(cmoAdRenders.status, "live"))
      .orderBy(desc(cmoAdRenders.broadcastAt))
      .limit(12);

    const archetypes = await db
      .select()
      .from(cmoHookArchetypes)
      .where(eq(cmoHookArchetypes.active, true))
      .orderBy(desc(cmoHookArchetypes.rollingCtrPpm));

    const [budget] = await db.select().from(cmoBudget).where(eq(cmoBudget.brandProfileId, brand.id));

    res.json({
      brandProfile: brand,
      pending: pendingItems.map((item) => ({
        inboxItem: item,
        renders: ((item.contextBundle as { renders?: Array<{ id: string }> } | null)?.renders ?? [])
          .map((r) => rendersById.get(r.id))
          .filter(Boolean),
      })),
      live: recentLive,
      archetypes,
      budget,
    });
  });

  // ─── Brand profile ──────────────────────────────────────────────────────
  app.get("/api/founder/cmo/brand-profile", isAuthenticated, requireFounder, async (_req, res) => {
    const profile = await db.query.brandProfiles.findFirst({
      where: eq(brandProfiles.slug, "acreos"),
    });
    res.json({ profile });
  });

  app.patch("/api/founder/cmo/brand-profile", isAuthenticated, requireFounder, async (req, res) => {
    const { id, ...updates } = req.body as { id?: number } & Partial<typeof brandProfiles.$inferInsert>;
    if (!id) return res.status(400).json({ error: "id is required" });
    const [updated] = await db
      .update(brandProfiles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(brandProfiles.id, id))
      .returning();
    res.json({ profile: updated });
  });

  // ─── Budget ─────────────────────────────────────────────────────────────
  app.get("/api/founder/cmo/budget", isAuthenticated, requireFounder, async (_req, res) => {
    const brand = await db.query.brandProfiles.findFirst({ where: eq(brandProfiles.slug, "acreos") });
    if (!brand) return res.json({ budget: null });
    const [budget] = await db.select().from(cmoBudget).where(eq(cmoBudget.brandProfileId, brand.id));
    res.json({ budget });
  });

  app.patch("/api/founder/cmo/budget", isAuthenticated, requireFounder, async (req, res) => {
    const { id, dailyCapCents, weeklyCapCents, monthlyCapCents } = req.body as {
      id: number;
      dailyCapCents?: number;
      weeklyCapCents?: number;
      monthlyCapCents?: number;
    };
    if (!id) return res.status(400).json({ error: "id is required" });
    const updates: Partial<typeof cmoBudget.$inferInsert> = { updatedAt: new Date() };
    if (typeof dailyCapCents === "number") updates.dailyCapCents = dailyCapCents;
    if (typeof weeklyCapCents === "number") updates.weeklyCapCents = weeklyCapCents;
    if (typeof monthlyCapCents === "number") updates.monthlyCapCents = monthlyCapCents;
    const [updated] = await db
      .update(cmoBudget)
      .set(updates)
      .where(eq(cmoBudget.id, id))
      .returning();
    res.json({ budget: updated });
  });

  // ─── Generation request — emits an outbox event the CMO agent consumes ─
  app.post("/api/founder/cmo/generate", isAuthenticated, requireFounder, async (req, res) => {
    const { intent, count, funnelStage, notes, forcePremium } = req.body as {
      intent: string;
      count: number;
      funnelStage?: "cold" | "warm" | "retargeting";
      notes?: string;
      forcePremium?: boolean;
    };
    if (!intent || !count) {
      return res.status(400).json({ error: "intent and count are required" });
    }
    if (count < 1 || count > 12) {
      return res.status(400).json({ error: "count must be 1-12" });
    }

    const [event] = await db
      .insert(outbox)
      .values({
        eventType: "cmo.manual-generate",
        payload: { intent, count, funnelStage: funnelStage ?? "cold", notes, forcePremium: !!forcePremium },
      })
      .returning();
    logger.info(`[cmo:routes] manual generation queued: outbox=${event.id} intent='${intent}' count=${count}`);
    res.json({ ok: true, outboxId: event.id });
  });

  // ─── Approval + broadcast ──────────────────────────────────────────────
  app.post("/api/founder/cmo/approve", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const { inboxItemId, platforms } = req.body as { inboxItemId: number; platforms?: string[] };
    if (!inboxItemId) return res.status(400).json({ error: "inboxItemId is required" });

    const item = await db.query.decisionsInboxItems.findFirst({
      where: eq(decisionsInboxItems.id, inboxItemId),
    });
    if (!item || item.itemType !== "cmo_ad_review") {
      return res.status(404).json({ error: "inbox item not found or not a CMO bundle" });
    }
    if (item.status !== "pending") {
      return res.status(409).json({ error: `item is ${item.status}, not pending` });
    }

    const ctx = item.contextBundle as { renders?: Array<{ id: string }>; bundleId?: string } | null;
    const renderIds = (ctx?.renders ?? []).map((r) => r.id);
    if (renderIds.length === 0) {
      return res.status(400).json({ error: "inbox item has no renders attached" });
    }

    const targetPlatforms = platforms ?? ["meta", "tiktok"];

    // Update renders + inbox in a single SQL round-trip per table.
    await db
      .update(cmoAdRenders)
      .set({
        status: "approved",
        approvedAt: new Date(),
        approvedBy: req.user?.email ?? "founder",
        updatedAt: new Date(),
      })
      .where(inArray(cmoAdRenders.id, renderIds));

    await db
      .update(decisionsInboxItems)
      .set({
        status: "approved",
        resolvedAt: new Date(),
        resolvedBy: req.user?.email ?? "founder",
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, inboxItemId));

    // Queue broadcast job per platform per render.
    for (const platform of targetPlatforms) {
      for (const renderId of renderIds) {
        await db.insert(outbox).values({
          eventType: "cmo.broadcast",
          payload: { renderId, platform, bundleId: ctx?.bundleId, inboxItemId },
        });
      }
    }

    res.json({
      ok: true,
      approvedRenderIds: renderIds,
      broadcastQueued: targetPlatforms.length * renderIds.length,
    });
  });

  app.post("/api/founder/cmo/reject", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const { inboxItemId, tags, note } = req.body as {
      inboxItemId: number;
      tags?: string[];
      note?: string;
    };
    if (!inboxItemId) return res.status(400).json({ error: "inboxItemId is required" });

    const item = await db.query.decisionsInboxItems.findFirst({
      where: eq(decisionsInboxItems.id, inboxItemId),
    });
    if (!item || item.itemType !== "cmo_ad_review") {
      return res.status(404).json({ error: "inbox item not found" });
    }

    const ctx = item.contextBundle as {
      renders?: Array<{ id: string }>;
      scriptHook?: string;
      brandSlug?: string;
    } | null;
    const renderIds = (ctx?.renders ?? []).map((r) => r.id);
    const brand = ctx?.brandSlug
      ? await db.query.brandProfiles.findFirst({ where: eq(brandProfiles.slug, ctx.brandSlug) })
      : await db.query.brandProfiles.findFirst({ where: eq(brandProfiles.slug, "acreos") });

    if (!brand) return res.status(500).json({ error: "brand profile not found" });

    const [rejectionNote] = await db
      .insert(cmoRejectionNotes)
      .values({
        scriptId: (item.actionPayload as { scriptId?: string } | null)?.scriptId,
        renderId: renderIds[0] ?? null,
        brandProfileId: brand.id,
        tags: tags ?? [],
        note: note ?? null,
        rejectedBy: req.user?.email ?? "founder",
      })
      .returning();

    if (renderIds.length > 0) {
      await db
        .update(cmoAdRenders)
        .set({
          status: "rejected" as never,
          rejectedAt: new Date(),
          rejectionNoteId: rejectionNote.id,
          updatedAt: new Date(),
        })
        .where(inArray(cmoAdRenders.id, renderIds));
    }

    await db
      .update(decisionsInboxItems)
      .set({
        status: "rejected",
        resolvedAt: new Date(),
        resolvedBy: req.user?.email ?? "founder",
        founderModification: note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, inboxItemId));

    // Phase B-2: mirror into the universal agent_rejection_notes table so
    // cross-agent learning loop sees CMO rejections alongside everyone else's.
    // The CMO-specific cmo_rejection_notes row stays as the canonical source
    // for the CMO generator's own loader (which already pulls from it); this
    // mirror lets /founder/inspector/agent/cmo + cross-agent observability
    // queries treat all rejections uniformly.
    try {
      const { recordRejection } = await import("./services/agentRejectionContext");
      await recordRejection({
        agentCodename: "cmo",
        decisionsInboxItemId: inboxItemId,
        tags: tags ?? [],
        note: note ?? null,
        rejectedBy: req.user?.email ?? "founder",
      });
    } catch (err) {
      logger.warn(`[cmo:reject] failed to mirror rejection into agent_rejection_notes: ${err instanceof Error ? err.message : err}`);
    }

    res.json({ ok: true, rejectionNoteId: rejectionNote.id });
  });

  // ─── Asset download (gated streaming for local FS storage in v1) ────────
  app.get("/api/founder/cmo/asset", isAuthenticated, requireFounder, async (req: Request, res: Response) => {
    const key = String(req.query.key ?? "");
    if (!key) return res.status(400).json({ error: "key is required" });

    const storage = getStorage();
    const exists = await storage.exists(`local:${key}` as `local:${string}`);
    if (!exists) return res.status(404).json({ error: "asset not found" });

    const root = process.env.CMO_STORAGE_ROOT ?? "/data/cmo";
    const absolutePath = path.join(root, key);

    try {
      const stat = await fs.stat(absolutePath);
      const ext = path.extname(key).toLowerCase();
      const contentType = ext === ".mp4" ? "video/mp4" : ext === ".mp3" ? "audio/mpeg" : "application/octet-stream";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader("Cache-Control", "private, max-age=300");

      const stream = (await import("fs")).createReadStream(absolutePath);
      stream.pipe(res);
    } catch (err) {
      logger.error("[cmo:routes] asset stream failed", err instanceof Error ? err : undefined, {
        metadata: { key },
      });
      res.status(500).json({ error: "stream failed" });
    }
  });

  // ─── Archetypes ─────────────────────────────────────────────────────────
  app.get("/api/founder/cmo/archetypes", isAuthenticated, requireFounder, async (_req, res) => {
    const archetypes = await db
      .select()
      .from(cmoHookArchetypes)
      .orderBy(desc(cmoHookArchetypes.rollingCtrPpm));
    res.json({ archetypes });
  });
}
