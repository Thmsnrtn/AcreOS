/**
 * The note record route — V-Notes-1 N2.
 *
 *   GET /api/notes/:id/record  terms, yield fields and document set with the
 *        provenance of every value, plus the collateral data picture
 *        (services/notes/noteRecord.ts). Read-only.
 *
 * Same guard as the acquired-note detail route (owner or admin). A note
 * outside the caller's organization is a 404, exactly like a note that does
 * not exist — the response never confirms another tenant's id.
 */

import type { Express, Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { getOrganizationId, type AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerNoteRecordRoutes(app: Express): void {
  app.get("/api/notes/:id/record", isAuthenticated, getOrCreateOrg, requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const organizationId = getOrganizationId(req);
      const id = String(req.params.id);
      // Not a uuid → not an acquired note; same answer as "not yours".
      if (!UUID.test(id)) return Errors.notFound(res, "Note");
      const { buildNoteRecord } = await import("./services/notes/noteRecord");
      const record = await buildNoteRecord(organizationId, id);
      if (!record) return Errors.notFound(res, "Note");
      res.json(record);
    } catch (err) {
      Errors.internal(res, err);
    }
  });
}
