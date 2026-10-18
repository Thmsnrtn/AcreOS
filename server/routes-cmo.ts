import type { CmoApprovedAsset } from "@shared/cmo/publicationAssets";
import { approvedAssetFromRender, verifyApprovedVideoBytes, publicationAssetRevision } from "./services/cmo/publicationAssets";
import { cmoPublicationDestinations } from "@shared/cmo/publication";
import { cmoReviewRevision } from "./services/cmo/reviewRevision";
import { projectGenerationJob } from "@shared/cmo/generationProgress";
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
  outboxDlq,
} from "@shared/schema";
import { eq, desc, asc, and, inArray, sql } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { logger } from "./utils/logger";
import { stampTraceContext } from "./utils/queueTraceContext";
import { getStorage } from "./services/cmo/storage";
import { Errors, sendError } from "./utils/errors";
import { omitProtectedFields } from "./utils/updatePayload";
import { clock } from "./utils/clock";
import { createInsertSchema } from "@shared/db/createInsertSchema";
import { z } from "zod";

const brandUpdateSchema = createInsertSchema(brandProfiles, {
  oneLiner: z.string().trim().min(1).max(1000),
  audiencePrimary: z.string().trim().min(1).max(4000),
}).omit({ id: true, slug: true, createdAt: true, updatedAt: true }).partial()
  .extend({ id: z.number().int().positive() }).strict()
  .refine((value) => Object.keys(value).length > 1, "At least one profile field is required");
const generationRequestSchema = z.object({
  intent: z.string().trim().min(1).max(2000),
  count: z.number().int().min(1).max(12),
  funnelStage: z.enum(["cold", "warm", "retargeting"]).default("cold"),
  notes: z.string().trim().max(4000).optional(),
  forcePremium: z.boolean().default(false),
}).strict();

const approvalRequestSchema = z.object({
  inboxItemId: z.number().int().positive(),
  reviewRevision: z.string().regex(/^[a-f0-9]{64}$/),
  platforms: z.array(z.enum(["meta", "tiktok"])).min(1).max(2).default(["meta", "tiktok"])
    .refine((platforms) => new Set(platforms).size === platforms.length, "Destinations must be unique"),
}).strict();

const rejectionRequestSchema = z.object({
  inboxItemId: z.number().int().positive(),
  tags: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  note: z.string().trim().max(4000).optional(),
}).strict();

const budgetUpdateSchema = z.object({
  id: z.number().int().positive(),
  dailyCapCents: z.number().int().nonnegative().optional(),
  weeklyCapCents: z.number().int().nonnegative().optional(),
  monthlyCapCents: z.number().int().nonnegative().optional(),
}).strict().refine((value) => Object.keys(value).length > 1, "At least one cap is required");

export function registerCmoRoutes(app: Express) {
  // ─── Dashboard ──────────────────────────────────────────────────────────
  app.get("/api/founder/cmo/dashboard", isAuthenticated, requireFounder, async (_req, res) => {
    const brand = await db.query.brandProfiles.findFirst({
      where: eq(brandProfiles.slug, "acreos"),
    });
    if (!brand) {
      return res.json({ brandProfile: null, pending: [], live: [], archetypes: [], budget: null });
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
      .where(sql`(${cmoAdRenders.status} = 'live' OR ${cmoAdRenders.manifestJson}->'platforms' IS NOT NULL)`)
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
      pending: pendingItems.map((item) => {
        const references = (item.contextBundle as { renders?: Array<{ id: string }> } | null)?.renders ?? [];
        const reviewRenders = references.map((r) => rendersById.get(r.id)).filter((r): r is typeof renders[number] => Boolean(r));
        const bundleId = (item.contextBundle as { bundleId?: string } | null)?.bundleId ?? (item.actionPayload as { bundleId?: string } | null)?.bundleId;
        const approvalAvailable = references.length > 0 && new Set(references.map(r => r.id)).size === references.length &&
          reviewRenders.length === references.length && Boolean(bundleId) && reviewRenders.every(r => {
            if (r.status !== "ready" || r.bundleId !== bundleId) return false;
            try { approvedAssetFromRender(r); return true; } catch { return false; }
          });
        return {
          inboxItem: item, renders: reviewRenders,
          reviewRevision: cmoReviewRevision(item, reviewRenders),
          destinations: approvalAvailable ? cmoPublicationDestinations(reviewRenders, ["meta", "tiktok"]) : [],
          approvalAvailable,
        };
      }),
      live: recentLive,
      archetypes,
      budget,
    });
  });

  // The list is bounded; recovery reads use the actual outbox identity, including DLQ rows.
  async function readGenerationJobs(rootId?: number) {
    const [active, dead] = await Promise.all([
      db.select().from(outbox).where(and(eq(outbox.eventType, "cmo.manual-generate"), rootId === undefined ? undefined : eq(outbox.id, rootId))).orderBy(desc(outbox.createdAt)).limit(rootId === undefined ? 20 : 1),
      db.select().from(outboxDlq).where(and(eq(outboxDlq.eventType, "cmo.manual-generate"), rootId === undefined ? undefined : eq(outboxDlq.originalOutboxId, rootId))).orderBy(desc(outboxDlq.createdAt)).limit(rootId === undefined ? 20 : 1),
    ]);
    const roots = [...active, ...dead.filter((row) => row.originalOutboxId != null && !active.some((item) => item.id === row.originalOutboxId)).map((row) => ({ ...row, id: row.originalOutboxId!, status: "failed" }))]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, rootId === undefined ? 20 : 1);
    if (!roots.length) return [];
    // Fetch all children for these roots; retries can leave additional rows.
    // do not cap independently and turn missing rows into false completion.
    const ids = roots.map((row) => row.id);
    const predicate = sql`(${outbox.payload}->>'generationJobId') IN (${sql.join(ids.map((id) => sql`${String(id)}`), sql`, `)})`;
    const deadPredicate = sql`(${outboxDlq.payload}->>'generationJobId') IN (${sql.join(ids.map((id) => sql`${String(id)}`), sql`, `)})`;
    const [children, deadChildren] = await Promise.all([
      db.select().from(outbox).where(and(eq(outbox.eventType, "cmo.render-script"), predicate)),
      db.select().from(outboxDlq).where(and(eq(outboxDlq.eventType, "cmo.render-script"), deadPredicate)),
    ]);
    const allChildren = [...children, ...deadChildren.filter((row) => row.originalOutboxId != null && !children.some((item) => item.id === row.originalOutboxId)).map((row) => ({ ...row, id: row.originalOutboxId!, status: "failed" }))];
    return roots.map((root) => projectGenerationJob(root, allChildren.filter((child) => child.payload.generationJobId === root.id)));
  }

  app.get("/api/founder/cmo/generation-jobs", isAuthenticated, requireFounder, async (_req: AuthenticatedRequest, res) => {
    try {
      return res.json({ jobs: await readGenerationJobs(), limit: 20 });
    } catch (error) { return Errors.internal(res, error); }
  });

  app.get("/api/founder/cmo/generation-jobs/:id", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res) => {
    const rawId = req.params.id;
    if (typeof rawId !== "string" || !/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) || Number(rawId) > 2147483647)
      return Errors.badRequest(res, "Invalid generation request identity");
    try {
      const [job] = await readGenerationJobs(Number(rawId));
      if (!job) return Errors.notFound(res, "Generation request");
      return res.json({ job });
    } catch (error) { return Errors.internal(res, error); }
  });

  // ─── Brand profile ──────────────────────────────────────────────────────
  app.get("/api/founder/cmo/brand-profile", isAuthenticated, requireFounder, async (_req, res) => {
    const profile = await db.query.brandProfiles.findFirst({
      where: eq(brandProfiles.slug, "acreos"),
    });
    res.json({ profile });
  });

  app.patch("/api/founder/cmo/brand-profile", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res) => {
    const parsed = brandUpdateSchema.safeParse(req.body);
    if (!parsed.success) return Errors.badRequest(res, "Invalid brand profile update");
    const { id, ...updates } = parsed.data;
    const [updated] = await db
      .update(brandProfiles)
      .set({ ...omitProtectedFields(updates), updatedAt: clock.now() })
      .where(eq(brandProfiles.id, id))
      .returning();
    if (!updated) return Errors.notFound(res, "Brand profile");
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
    const parsed = budgetUpdateSchema.safeParse(req.body);
    if (!parsed.success) return Errors.badRequest(res, "Invalid operating budget update");
    const { id, dailyCapCents, weeklyCapCents, monthlyCapCents } = parsed.data;
    const updates: Partial<typeof cmoBudget.$inferInsert> = { updatedAt: clock.now() };
    if (typeof dailyCapCents === "number") updates.dailyCapCents = dailyCapCents;
    if (typeof weeklyCapCents === "number") updates.weeklyCapCents = weeklyCapCents;
    if (typeof monthlyCapCents === "number") updates.monthlyCapCents = monthlyCapCents;
    const [updated] = await db
      .update(cmoBudget)
      .set(updates)
      .where(eq(cmoBudget.id, id))
      .returning();
    if (!updated) return Errors.notFound(res, "Operating budget");
    res.json({ budget: updated });
  });

  // ─── Generation request — emits an outbox event the CMO agent consumes ─
  app.post("/api/founder/cmo/generate", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res) => {
    const parsed = generationRequestSchema.safeParse(req.body);
    if (!parsed.success) return Errors.badRequest(res, "Invalid generation request");
    const { intent, count, funnelStage, notes, forcePremium } = parsed.data;

    const [event] = await db
      .insert(outbox)
      .values({
        eventType: "cmo.manual-generate",
        payload: stampTraceContext({ intent, count, funnelStage: funnelStage ?? "cold", notes, forcePremium: !!forcePremium }),
      })
      .returning();
    logger.info(`[cmo:routes] manual generation queued: outbox=${event.id} intent='${intent}' count=${count}`);
    res.json({ ok: true, outboxId: event.id });
  });

  // ─── Approval + broadcast ──────────────────────────────────────────────
  app.post("/api/founder/cmo/approve", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = approvalRequestSchema.safeParse(req.body);
    if (!parsed.success) return Errors.badRequest(res, "Invalid publication approval");
    const { inboxItemId, reviewRevision, platforms: targetPlatforms } = parsed.data;

    const item = await db.query.decisionsInboxItems.findFirst({
      where: eq(decisionsInboxItems.id, inboxItemId),
    });
    if (!item || item.itemType !== "cmo_ad_review") {
      return Errors.notFound(res, "CMO ad-review bundle");
    }
    if (item.status !== "pending") {
      return sendError(res, 409, "CONFLICT", `item is ${item.status}, not pending`);
    }

    const ctx = item.contextBundle as { renders?: Array<{ id: string }>; bundleId?: string } | null;
    const renderIds = (ctx?.renders ?? []).map((r) => r.id);
    const bundleId = ctx?.bundleId ?? (item.actionPayload as { bundleId?: string } | null)?.bundleId;
    const payloadBundleId = (item.actionPayload as { bundleId?: string } | null)?.bundleId;
    if (ctx?.bundleId && payloadBundleId && ctx.bundleId !== payloadBundleId) return Errors.badRequest(res, "Review bundle identities disagree");
    if (renderIds.length === 0 || typeof bundleId !== "string" || !bundleId) {
      return Errors.badRequest(res, "Review bundle or assets are unavailable");
    }

    // Claim the specific pending decision and enqueue all destinations in the
    // same transaction. A racing approval cannot create a second batch.
    const result = await db.transaction(async (tx) => {
      const [lockedItem] = await tx.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.id, inboxItemId)).for("update");
      if (!lockedItem || lockedItem.status !== "pending" || lockedItem.itemType !== "cmo_ad_review") return { conflict: true } as const;
      const lockedRenders = await tx.select().from(cmoAdRenders).where(inArray(cmoAdRenders.id, renderIds)).orderBy(asc(cmoAdRenders.id)).for("update");
      if (cmoReviewRevision(lockedItem, lockedRenders) !== reviewRevision) return { conflict: true } as const;
      if (new Set(renderIds).size !== renderIds.length || lockedRenders.length !== renderIds.length ||
        lockedRenders.some(r => r.bundleId !== bundleId || r.status !== "ready")) return { unavailable: true } as const;
      const destinations = cmoPublicationDestinations(lockedRenders, targetPlatforms);
      if (targetPlatforms.some(platform => !destinations.some(d => d.platform === platform))) return { unavailable: true } as const;
      const approvedRenderIds = [...new Set(destinations.map(d => d.renderId))];
      const approvedAssets: Record<string, CmoApprovedAsset> = {};
      try { for (const render of lockedRenders.filter(r => approvedRenderIds.includes(r.id))) approvedAssets[render.id] = approvedAssetFromRender(render); }
      catch { return { unavailable: true } as const; }
      const [claimed] = await tx.update(decisionsInboxItems).set({
        status: "approved", resolvedAt: clock.now(),
        resolvedBy: req.user?.email ?? "founder", updatedAt: clock.now(),
        contextBundle: sql`coalesce(${decisionsInboxItems.contextBundle}, '{}'::jsonb) || ${JSON.stringify({ bundleId, approvedPlatforms: targetPlatforms, approvedDestinations: destinations, approvedReviewRevision: reviewRevision, approvedAssets })}::jsonb`,
      }).where(and(eq(decisionsInboxItems.id, inboxItemId), eq(decisionsInboxItems.status, "pending"),
        sql`${decisionsInboxItems.contextBundle} = ${JSON.stringify(item.contextBundle)}::jsonb`,
      )).returning({ id: decisionsInboxItems.id });
      if (!claimed) return { conflict: true } as const;
      const updated = await tx.update(cmoAdRenders).set({
        status: "approved", approvedAt: clock.now(),
        approvedBy: req.user?.email ?? "founder", updatedAt: clock.now(),
      }).where(and(inArray(cmoAdRenders.id, approvedRenderIds), eq(cmoAdRenders.bundleId, bundleId), eq(cmoAdRenders.status, "ready"))).returning({ id: cmoAdRenders.id });
      if (updated.length !== approvedRenderIds.length) throw new Error("Review assets changed; approval not queued");
      for (const { renderId, platform } of destinations) {
        await tx.insert(outbox).values({
          eventType: "cmo.broadcast",
          payload: stampTraceContext({ renderId, platform, bundleId, inboxItemId, reviewRevision, assetRevision: publicationAssetRevision(approvedAssets[renderId]) }),
        });
      }
      return { queued: destinations.length, approvedRenderIds } as const;
    });
    if ("conflict" in result) return sendError(res, 409, "CONFLICT", "Review changed or already resolved; refresh and review it again");
    if ("unavailable" in result) return Errors.badRequest(res, "Selected destinations or ready review assets are unavailable");
    res.json({ ok: true, approvedRenderIds: result.approvedRenderIds, broadcastQueued: result.queued });
  });

  app.post("/api/founder/cmo/reject", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = rejectionRequestSchema.safeParse(req.body);
    if (!parsed.success) return Errors.badRequest(res, "Invalid video review rejection");
    const { inboxItemId, tags, note } = parsed.data;

    const item = await db.query.decisionsInboxItems.findFirst({
      where: eq(decisionsInboxItems.id, inboxItemId),
    });
    if (!item || item.itemType !== "cmo_ad_review") {
      return Errors.notFound(res, "inbox item");
    }
    if (item.status !== "pending") return sendError(res, 409, "CONFLICT", "Review already resolved; use publishing controls to pause queued work");

    const ctx = item.contextBundle as {
      renders?: Array<{ id: string }>;
      scriptHook?: string;
      brandSlug?: string;
      bundleId?: string;
    } | null;
    const renderIds = (ctx?.renders ?? []).map((r) => r.id);
    const bundleId = ctx?.bundleId ?? (item.actionPayload as { bundleId?: string } | null)?.bundleId;
    const payloadBundleId = (item.actionPayload as { bundleId?: string } | null)?.bundleId;
    if (ctx?.bundleId && payloadBundleId && ctx.bundleId !== payloadBundleId) return Errors.badRequest(res, "Review bundle identities disagree");
    if (typeof bundleId !== "string" || !bundleId || renderIds.length === 0) return Errors.badRequest(res, "Review bundle or assets are unavailable");
    const brand = ctx?.brandSlug
      ? await db.query.brandProfiles.findFirst({ where: eq(brandProfiles.slug, ctx.brandSlug) })
      : await db.query.brandProfiles.findFirst({ where: eq(brandProfiles.slug, "acreos") });

    if (!brand) return Errors.internal(res, new Error('brand profile not found'));

    const rejectionNote = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(decisionsInboxItems).set({
        status: "rejected", resolvedAt: clock.now(), resolvedBy: req.user?.email ?? "founder",
        founderModification: note ?? null, updatedAt: clock.now(),
      }).where(and(eq(decisionsInboxItems.id, inboxItemId), eq(decisionsInboxItems.status, "pending"),
        sql`${decisionsInboxItems.contextBundle} = ${JSON.stringify(item.contextBundle)}::jsonb`,
      )).returning({ id: decisionsInboxItems.id });
      if (!claimed) return null;
      const [rejectionNote] = await tx.insert(cmoRejectionNotes).values({
        scriptId: (item.actionPayload as { scriptId?: string } | null)?.scriptId,
        renderId: renderIds[0], brandProfileId: brand.id, tags, note: note ?? null,
        rejectedBy: req.user?.email ?? "founder",
      }).returning();
      const rejected = await tx.update(cmoAdRenders).set({
        status: "rejected", rejectedAt: clock.now(), rejectionNoteId: rejectionNote.id,
        updatedAt: clock.now(),
      }).where(and(inArray(cmoAdRenders.id, renderIds), eq(cmoAdRenders.bundleId, bundleId), eq(cmoAdRenders.status, "ready")))
        .returning({ id: cmoAdRenders.id });
      if (rejected.length !== new Set(renderIds).size) throw new Error("Review assets changed; rejection not recorded");
      return rejectionNote;
    });
    if (!rejectionNote) return sendError(res, 409, "CONFLICT", "Review already resolved; nothing else rejected");

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
  app.get("/api/founder/cmo/asset", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const key = String(req.query.key ?? "");
    if (!key) return Errors.badRequest(res, "key is required");

    const storage = getStorage();
    if (req.query.renderId !== undefined || req.query.assetRevision !== undefined) {
      const { renderId, assetRevision } = req.query;
      if (typeof renderId !== "string" || typeof assetRevision !== "string" || !/^[a-f0-9]{64}$/.test(assetRevision)) return Errors.badRequest(res, "Valid render and asset revision are required");
      const render = await db.query.cmoAdRenders.findFirst({ where: eq(cmoAdRenders.id, renderId) });
      if (!render || render.storagePath !== `local:${key}`) return Errors.notFound(res, "asset");
      try {
        const asset = approvedAssetFromRender(render);
        if (asset.publication.video.sha256 !== assetRevision) throw new Error("Asset revision changed");
        const bytes = Buffer.from(await storage.read(`local:${key}`));
        verifyApprovedVideoBytes(bytes, asset);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Cache-Control", "private, no-store");
        return res.send(bytes);
      } catch { return sendError(res, 409, "CONFLICT", "Review video is unavailable or changed; refresh and review again"); }
    }
    const exists = await storage.exists(`local:${key}` as `local:${string}`);
    if (!exists) return Errors.notFound(res, "asset");

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
      Errors.internal(res, new Error('stream failed'));
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
