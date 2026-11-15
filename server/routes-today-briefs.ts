/**
 * /api/today/briefs — the morning brief archive (E2 slice 1, leg 2).
 *
 *   GET  /api/today/briefs              the org's past briefs, newest day first
 *   GET  /api/today/briefs/:id          reopen one (sections as they stood)
 *   POST /api/today/briefs/:id/dismiss  stamp today's card dismissed (org-wide)
 *   POST /api/today/briefs/:id/restore  clear the stamp
 *
 * Rows are written by GET /api/today (server/routes-today.ts buildBriefCard);
 * this router only reads and stamps them. Every query is pinned to the
 * session's org (req.organization, never the client): another org's id is a
 * 404, never a read or a write. Dismissal is a stamp, never a deletion.
 *
 * Mounted in server/routes.ts AHEAD of /api/today and WITHOUT todayGuard:
 * these routes call no model, so the per-org AI budget must not be able to
 * refuse a dismissal, and opening the archive must not spend the page's
 * 10-per-minute burst cap. Auth posture is the same (isAuthenticated +
 * getOrCreateOrg).
 */

import { Router, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { paxMorningBriefs } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { clock } from "./utils/clock";
import { routeParam } from "./utils/routeParams";
import { assertWritablePatch } from "./utils/patch";
import { db } from "./db";
import type { BriefSectionKey } from "./services/morningBriefSections";

const router = Router();

/** A brief id from the path, or null when it is not a positive integer. */
function briefIdParam(req: AuthenticatedRequest): number | null {
  const n = Number(routeParam(req.params.id));
  return Number.isInteger(n) && n > 0 ? n : null;
}

const ARCHIVE_DEFAULT_LIMIT = 30;
const ARCHIVE_MAX_LIMIT = 90;

function sectionCounts(sections: unknown): { changed: number; needsYou: number; prepared: number } {
  const s = (sections ?? {}) as Partial<Record<BriefSectionKey, unknown>>;
  const len = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  return { changed: len(s.changed), needsYou: len(s.needsYou), prepared: len(s.prepared) };
}

// GET /api/today/briefs — the archive list, newest day first. Org-scoped.
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const raw = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, ARCHIVE_MAX_LIMIT) : ARCHIVE_DEFAULT_LIMIT;
    const rows = await db
      .select({
        id: paxMorningBriefs.id,
        briefDate: paxMorningBriefs.briefDate,
        headline: paxMorningBriefs.headline,
        sections: paxMorningBriefs.sections,
        dismissedAt: paxMorningBriefs.dismissedAt,
      })
      .from(paxMorningBriefs)
      .where(eq(paxMorningBriefs.organizationId, orgId))
      .orderBy(desc(paxMorningBriefs.briefDate))
      .limit(limit);
    res.json({
      briefs: rows.map((r) => ({
        id: r.id,
        date: r.briefDate,
        headline: r.headline,
        dismissed: r.dismissedAt != null,
        counts: sectionCounts(r.sections),
      })),
    });
  } catch (error) {
    logger.error("Today brief archive list error", error instanceof Error ? error : undefined);
    Errors.internal(res, error);
  }
});

// GET /api/today/briefs/:id — reopen one archived brief. Org-scoped: another
// org's id is a 404, never a read.
router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const id = briefIdParam(req);
    if (id == null) return Errors.badRequest(res, "A brief id is required");
    const [row] = await db
      .select()
      .from(paxMorningBriefs)
      .where(and(eq(paxMorningBriefs.id, id), eq(paxMorningBriefs.organizationId, orgId)))
      .limit(1);
    if (!row) return Errors.notFound(res, "Brief");
    res.json({
      id: row.id,
      date: row.briefDate,
      headline: row.headline,
      sections: row.sections,
      dismissed: row.dismissedAt != null,
    });
  } catch (error) {
    logger.error("Today brief reopen error", error instanceof Error ? error : undefined);
    Errors.internal(res, error);
  }
});

// POST /api/today/briefs/:id/dismiss | /restore — a stamp, never a deletion.
// Two literal registrations (not a loop over a template path) so every route
// scanner in this repo reads them as the write routes they are.
async function stampBrief(req: AuthenticatedRequest, res: Response, action: "dismiss" | "restore") {
  try {
    const orgId = getOrganizationId(req);
    const userId = getUserId(req);
    const id = briefIdParam(req);
    if (id == null) return Errors.badRequest(res, "A brief id is required");
    const now = clock.now();
    const [row] = await db
      .update(paxMorningBriefs)
      .set(
        assertWritablePatch(
          action === "dismiss"
            ? { dismissedAt: now, dismissedBy: userId, updatedAt: now }
            : { dismissedAt: null, dismissedBy: null, updatedAt: now },
          `paxMorningBriefs.${action}`,
        ),
      )
      .where(and(eq(paxMorningBriefs.id, id), eq(paxMorningBriefs.organizationId, orgId)))
      .returning({ id: paxMorningBriefs.id, dismissedAt: paxMorningBriefs.dismissedAt });
    if (!row) return Errors.notFound(res, "Brief");
    return res.json({ id: row.id, dismissed: row.dismissedAt != null });
  } catch (error) {
    logger.error(`Today brief ${action} error`, error instanceof Error ? error : undefined);
    return Errors.internal(res, error);
  }
}

router.post("/:id/dismiss", async (req: AuthenticatedRequest, res: Response) => stampBrief(req, res, "dismiss"));
router.post("/:id/restore", async (req: AuthenticatedRequest, res: Response) => stampBrief(req, res, "restore"));

export default router;
