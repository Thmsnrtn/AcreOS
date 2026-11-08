/**
 * /api/pax/core — E2 slice 1 (Pax core): business memory, prepared work,
 * rails, presets, shadow mode and the trust ledger. Logic lives in
 * server/services/paxCore.ts; this file validates, scopes and answers.
 *
 *   GET    /autonomy                   preset, shadow mode, rails, stand-down state
 *   PUT    /autonomy/preset            { preset }       owner / admin
 *   GET    /autonomy/preview?preset=   last month's counts under that preset
 *   PUT    /autonomy/shadow            { on }           owner / admin
 *   PATCH  /rails/:key                 { text }         owner / admin
 *   POST   /rails/:key/revoke | /restore                owner / admin
 *   GET    /ledger?limit=              the trust-ledger timeline
 *   GET    /memory                     the org's business memory
 *   POST   /memory                     { category, content }
 *   PATCH  /memory/:id                 { category?, content? }
 *   DELETE /memory/:id
 *   GET    /packets?status=            prepared work (default: prepared)
 *   GET    /packets/:id
 *   POST   /packets/:id/approve | /dismiss
 *
 * Every query is pinned to the session's org (req.organization), never the
 * client; another org's id is a 404. Nothing here sends, pays, signs or
 * executes a tool. Mounted with isAuthenticated + getOrCreateOrg and no AI
 * guard: no route here calls a model.
 *
 * Stand-down is the existing Pax Pause (Settings → Pax, routes-pax-controls);
 * this router only REPORTS it (`standDown`), and preparePacket() enforces it.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { PAX_MEMORY_CATEGORIES, PAX_PRESETS, RAIL_TEXT_MAX, MEMORY_CONTENT_MAX } from "@shared/pax-core";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization, getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { routeParam } from "./utils/routeParams";
import { getUserPermissionContext, isAdminOrAbove } from "./utils/permissions";
import { getPaxControls } from "./services/paxControls";
import {
  PaxCoreRefusal,
  createMemory,
  decidePacket,
  deleteMemory,
  editRail,
  getAutonomySettings,
  getPacket,
  listMemory,
  listPackets,
  listRails,
  listTimeline,
  previewPreset,
  setPreset,
  setRailActive,
  setShadowMode,
  updateMemory,
} from "./services/paxCore";

const router = Router();

async function isAdmin(req: AuthenticatedRequest): Promise<boolean> {
  const org = getOrganization(req);
  const userId = getUserId(req);
  if (org.ownerId === userId) return true;
  const ctx = await getUserPermissionContext(req.user, org);
  return isAdminOrAbove(ctx?.role ?? "member");
}

function idParam(req: AuthenticatedRequest): number | null {
  const n = Number(routeParam(req.params.id));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof PaxCoreRefusal) return Errors.badRequest(res, error.message);
  logger.error(`[pax-core] ${what} failed`, error instanceof Error ? error : undefined);
  return Errors.internal(res, error);
}

// ── Autonomy: preset, shadow, rails, stand-down ─────────────────────────────

async function autonomyPayload(orgId: number) {
  const [settings, rails, controls] = await Promise.all([
    getAutonomySettings(orgId),
    listRails(orgId),
    getPaxControls(orgId),
  ]);
  return {
    presets: PAX_PRESETS,
    preset: settings.preset,
    shadowMode: settings.shadowMode,
    readFailed: settings.readFailed,
    rails,
    // Stand-down IS the Pax Pause; reported here so this screen and Today
    // show the state. Enforced in preparePacket().
    standDown: {
      active: controls.paused,
      until: controls.pausedUntil ? controls.pausedUntil.toISOString() : null,
      checkFailed: controls.checkFailed,
    },
  };
}

router.get("/autonomy", async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.json(await autonomyPayload(getOrganizationId(req)));
  } catch (error) {
    fail(res, error, "GET /autonomy");
  }
});

const presetBody = z.object({ preset: z.string().min(1).max(40) }).strict();

router.put("/autonomy/preset", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    if (!(await isAdmin(req))) return Errors.forbidden(res, "Ask an owner to change this");
    const parsed = presetBody.safeParse(req.body ?? {});
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    await setPreset(orgId, parsed.data.preset, getUserId(req));
    res.json(await autonomyPayload(orgId));
  } catch (error) {
    fail(res, error, "PUT /autonomy/preset");
  }
});

router.get("/autonomy/preview", async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.json(await previewPreset(getOrganizationId(req), String(req.query.preset ?? "")));
  } catch (error) {
    fail(res, error, "GET /autonomy/preview");
  }
});

const shadowBody = z.object({ on: z.boolean() }).strict();

router.put("/autonomy/shadow", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    if (!(await isAdmin(req))) return Errors.forbidden(res, "Ask an owner to change this");
    const parsed = shadowBody.safeParse(req.body ?? {});
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    await setShadowMode(orgId, parsed.data.on, getUserId(req));
    res.json(await autonomyPayload(orgId));
  } catch (error) {
    fail(res, error, "PUT /autonomy/shadow");
  }
});

const railBody = z.object({ text: z.string().trim().min(1).max(RAIL_TEXT_MAX) }).strict();

router.patch("/rails/:key", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    if (!(await isAdmin(req))) return Errors.forbidden(res, "Ask an owner to change this");
    const parsed = railBody.safeParse(req.body ?? {});
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    res.json({ rails: await editRail(orgId, routeParam(req.params.key), parsed.data.text, getUserId(req)) });
  } catch (error) {
    fail(res, error, "PATCH /rails/:key");
  }
});

router.post("/rails/:key/revoke", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    if (!(await isAdmin(req))) return Errors.forbidden(res, "Ask an owner to change this");
    res.json({ rails: await setRailActive(orgId, routeParam(req.params.key), false, getUserId(req)) });
  } catch (error) {
    fail(res, error, "POST /rails/:key/revoke");
  }
});

router.post("/rails/:key/restore", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    if (!(await isAdmin(req))) return Errors.forbidden(res, "Ask an owner to change this");
    res.json({ rails: await setRailActive(orgId, routeParam(req.params.key), true, getUserId(req)) });
  } catch (error) {
    fail(res, error, "POST /rails/:key/restore");
  }
});

// ── Trust ledger ────────────────────────────────────────────────────────────

router.get("/ledger", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const raw = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 200) : 50;
    res.json({ entries: await listTimeline(getOrganizationId(req), limit) });
  } catch (error) {
    fail(res, error, "GET /ledger");
  }
});

// ── Memory ──────────────────────────────────────────────────────────────────

const categorySchema = z.enum(PAX_MEMORY_CATEGORIES);
const memoryCreate = z
  .object({ category: categorySchema, content: z.string().trim().min(1).max(MEMORY_CONTENT_MAX) })
  .strict();
const memoryPatch = z
  .object({ category: categorySchema.optional(), content: z.string().trim().min(1).max(MEMORY_CONTENT_MAX).optional() })
  .strict()
  .refine((v) => v.category !== undefined || v.content !== undefined, { message: "Nothing to change" });

router.get("/memory", async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ items: await listMemory(getOrganizationId(req)) });
  } catch (error) {
    fail(res, error, "GET /memory");
  }
});

router.post("/memory", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = memoryCreate.safeParse(req.body ?? {});
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    res.status(201).json({ item: await createMemory(getOrganizationId(req), parsed.data, getUserId(req)) });
  } catch (error) {
    fail(res, error, "POST /memory");
  }
});

router.patch("/memory/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = idParam(req);
    if (id == null) return Errors.badRequest(res, "A memory id is required");
    const parsed = memoryPatch.safeParse(req.body ?? {});
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    const item = await updateMemory(getOrganizationId(req), id, parsed.data, getUserId(req));
    if (!item) return Errors.notFound(res, "Memory item");
    res.json({ item });
  } catch (error) {
    fail(res, error, "PATCH /memory/:id");
  }
});

router.delete("/memory/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = idParam(req);
    if (id == null) return Errors.badRequest(res, "A memory id is required");
    const deleted = await deleteMemory(getOrganizationId(req), id, getUserId(req));
    if (!deleted) return Errors.notFound(res, "Memory item");
    res.json({ deleted: true, id });
  } catch (error) {
    fail(res, error, "DELETE /memory/:id");
  }
});

// ── Packets ─────────────────────────────────────────────────────────────────

const PACKET_STATUSES = new Set(["prepared", "approved", "dismissed", "all"]);

router.get("/packets", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const raw = String(req.query.status ?? "prepared");
    if (!PACKET_STATUSES.has(raw)) return Errors.badRequest(res, "Unknown packet status");
    res.json({ packets: await listPackets(getOrganizationId(req), raw as "prepared" | "approved" | "dismissed" | "all") });
  } catch (error) {
    fail(res, error, "GET /packets");
  }
});

router.get("/packets/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = idParam(req);
    if (id == null) return Errors.badRequest(res, "A packet id is required");
    const packet = await getPacket(getOrganizationId(req), id);
    if (!packet) return Errors.notFound(res, "Prepared work");
    res.json({ packet });
  } catch (error) {
    fail(res, error, "GET /packets/:id");
  }
});

async function decide(req: AuthenticatedRequest, res: Response, decision: "approve" | "dismiss") {
  try {
    const id = idParam(req);
    if (id == null) return Errors.badRequest(res, "A packet id is required");
    const result = await decidePacket(getOrganizationId(req), id, decision, getUserId(req));
    if (result.status === "not_found") return Errors.notFound(res, "Prepared work");
    if (result.status === "already_decided") {
      return Errors.badRequest(res, `This was already ${result.packet.status}.`);
    }
    return res.json({ packet: result.packet, memory: result.memory });
  } catch (error) {
    return fail(res, error, `POST /packets/:id/${decision}`);
  }
}

router.post("/packets/:id/approve", async (req: AuthenticatedRequest, res: Response) => decide(req, res, "approve"));
router.post("/packets/:id/dismiss", async (req: AuthenticatedRequest, res: Response) => decide(req, res, "dismiss"));

export default router;
