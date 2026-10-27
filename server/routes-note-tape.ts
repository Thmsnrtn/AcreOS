/**
 * Note-tape import routes — V-Notes-1 N1 (Linnea's day-one path).
 *
 *   POST /api/note-tape/preview  map + validate; WRITES NOTHING. With no
 *        mapping it suggests one from the header row (a suggestion the
 *        operator confirms, never applied as fact).
 *   POST /api/note-tape/commit   re-validates server-side (the preview is never
 *        trusted) and commits in one transaction — or refuses with the
 *        field-level report (unmapped required columns) or the rows still in
 *        error. Nothing is imported partially.
 *
 * Same guard as the existing notes import (canImportData). Org-private: the
 * organization comes from the session, never the body.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requirePermission } from "./utils/permissions";
import { getOrganizationId, getUserId, type AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { NOTE_TAPE_FIELDS, type NoteTapeFieldKey } from "@shared/notes/noteTapeFields";
import { readNoteTape, suggestNoteTapeMapping, validateNoteTape, assertNoRowLost, type NoteTapeMapping, type NoteTapeOverrides } from "./services/notes/noteTapeImport";

const FIELD_KEYS = NOTE_TAPE_FIELDS.map((f) => f.key) as [NoteTapeFieldKey, ...NoteTapeFieldKey[]];
const fieldKey = z.enum(FIELD_KEYS);

const baseBody = z.object({
  csv: z.string().min(1).max(5 * 1024 * 1024),
  fileName: z.string().trim().min(1).max(240),
  mapping: z.record(fieldKey, z.number().int().min(0).nullable()).optional(),
  overrides: z.record(z.string().regex(/^\d+$/), z.record(fieldKey, z.string().max(500))).optional(),
});
const commitBody = baseBody.extend({
  mapping: z.record(fieldKey, z.number().int().min(0).nullable()),
  excludeRows: z.array(z.number().int().min(2)).max(20_000).default([]),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
});

function toOverrides(o: z.infer<typeof baseBody>["overrides"]): NoteTapeOverrides {
  const out: NoteTapeOverrides = {};
  for (const [row, cells] of Object.entries(o ?? {})) out[Number(row)] = cells as Partial<Record<NoteTapeFieldKey, string>>;
  return out;
}

export function registerNoteTapeRoutes(app: Express): void {
  const guard = [isAuthenticated, getOrCreateOrg, requirePermission("canImportData")] as const;

  app.post("/api/note-tape/preview", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      getOrganizationId(req);
      const parsed = baseBody.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      let tape;
      try {
        tape = readNoteTape(parsed.data.csv);
      } catch (err) {
        return Errors.badRequest(res, err instanceof Error ? err.message : "The file could not be read as a CSV.");
      }
      const suggestion = suggestNoteTapeMapping(tape.sheet.headers);
      const mapping: NoteTapeMapping = parsed.data.mapping ?? suggestion.mapping;
      const validation = validateNoteTape({ sheet: tape.sheet, mapping, overrides: toOverrides(parsed.data.overrides) });
      assertNoRowLost(validation);
      res.json({
        headers: tape.sheet.headers,
        fileSha256: tape.sha256,
        mapping,
        mappingWasSuggested: parsed.data.mapping === undefined,
        unmatchedHeaders: suggestion.unmatchedHeaders,
        validation,
      });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  app.post("/api/note-tape/commit", ...guard, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const organizationId = getOrganizationId(req);
      const actorUserId = getUserId(req);
      const parsed = commitBody.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      let tape;
      try {
        tape = readNoteTape(parsed.data.csv);
      } catch (err) {
        return Errors.badRequest(res, err instanceof Error ? err.message : "The file could not be read as a CSV.");
      }
      const validation = validateNoteTape({ sheet: tape.sheet, mapping: parsed.data.mapping, overrides: toOverrides(parsed.data.overrides) });
      assertNoRowLost(validation);
      const { commitNoteTape } = await import("./services/notes/noteTapeCommit");
      const result = await commitNoteTape({
        organizationId,
        actorUserId,
        fileName: parsed.data.fileName,
        fileSha256: tape.sha256,
        asOf: parsed.data.asOf,
        validation,
        excludeRows: parsed.data.excludeRows,
      });
      if (result.status === "refused") {
        return Errors.badRequest(res, result.reason, { unmappedRequired: result.unmappedRequired, unresolvedRows: result.unresolvedRows, rejected: validation.rejected });
      }
      logger.info("[note-tape] committed", { metadata: { organizationId, importId: result.importId, created: result.created, appended: result.appendedToExisting, excluded: result.excludedRows.length } });
      res.json(result);
    } catch (err) {
      Errors.internal(res, err);
    }
  });
}
