/**
 * /api/list-builder — build a mailing list from a county's public parcel
 * records (W10.3, list builder v0). A customer surface behind the Map door —
 * no new nav entry.
 *
 *   GET  /api/list-builder/counties?state=XX  the counties AcreOS knows for a
 *        state, each with its status (shared/geo/countyStatus.ts) and which
 *        filters its source can answer;
 *   POST /api/list-builder/preview  the EXACT count, a five-row sample, how
 *        many are already leads, and the cost — before anything is saved;
 *   POST /api/list-builder/commit   re-runs the query; saves only if the count
 *        is still the one the customer confirmed and every check passes;
 *   GET  /api/list-builder/lists    the org's saved county lists.
 *
 * A filter the county cannot answer is refused by name (400), never ignored;
 * a source that cannot answer as configured (cannot page, misconfigured) is a
 * structural 422 with the reason; a county source FAILING to answer is an
 * error with no number (502, transient). The service
 * (server/services/listBuilder/countyListBuilder.ts) holds the rules.
 *
 * WHO MAY SAVE. Saving creates leads in bulk, so commit carries the CSV
 * import's own gates (POST /api/leads/csv-import): requirePermission
 * ("canImportData") and requireScope("deal_write"). Counties, preview and
 * lists stay readable to every member.
 *
 * ONE SAVE PER INTENT. Commit honours the Idempotency-Key header
 * (middleware/idempotency.ts replays a finished save), and two requests with
 * the same key IN FLIGHT at once (a double click) share one save in this
 * process (sharedSave) — the middleware only knows a save once it has
 * finished and its response is cached.
 *
 * COST. Preview and commit read a county server (up to 20,000 records), so
 * each is rate limited per org (createRateLimiter, 429), and a request whose
 * client has gone stops reading the county (an AbortSignal checked between
 * county requests — fetchGeo itself takes no signal).
 *
 * Pattern: isAuthenticated + getOrCreateOrg, AuthenticatedRequest, Errors.*.
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";
import { requirePermission } from "./utils/permissions";
import { requireScope } from "./middleware/roleScope";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { createRateLimiter } from "./middleware/rateLimit";
import { OWNER_TYPES } from "@shared/parcel/ownerName";
import { AreaQueryAborted } from "./services/providers/countyAreaQuery";
import {
  commitCountyList,
  countyOptionsForState,
  previewCountyList,
  type ListBuilderRefusal,
} from "./services/listBuilder/countyListBuilder";
import { listCountyLists } from "./storage/listBuilderRepo";

const LISTS_PAGE = 50;

// Per ORG, per minute: a preview reads the county live (several requests,
// up to 20,000 records); a save does it again and writes. Generous for a
// person building a list, a wall for a script.
const PREVIEWS_PER_MINUTE = 10;
const SAVES_PER_MINUTE = 5;
const orgKey = (label: string) => (req: { organization?: { id?: number } }) =>
  `list-builder:${label}:org:${req.organization?.id ?? "none"}`;
const previewLimiter = createRateLimiter({ maxRequests: PREVIEWS_PER_MINUTE, windowMs: 60_000 }, orgKey("preview"));
const commitLimiter = createRateLimiter({ maxRequests: SAVES_PER_MINUTE, windowMs: 60_000 }, orgKey("commit"));

/** A signal that fires when the client goes away before we answer. */
function clientGone(res: Response): AbortSignal {
  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });
  return ac.signal;
}

type SaveOutcome = Awaited<ReturnType<typeof commitCountyList>>;

/**
 * Saves in flight in THIS process, by org + Idempotency-Key. The idempotency
 * middleware replays a save only once it has FINISHED and been CACHED; a
 * double click sends the second request while the first is still running,
 * and without this both would save. (Across instances only the finished-save
 * replay applies.)
 */
const savesInFlight = new Map<string, Promise<SaveOutcome>>();

/**
 * How long a FINISHED save stays shared here. The middleware caches the
 * response only after the handler's res.json (setCached — a Redis round trip
 * when Redis is on), and a request with the same key may already be past the
 * middleware's cache read; dropping the entry the moment the save settled
 * left exactly that window open to a second save. A refusal or failure is
 * released at once — the middleware never caches those, and a retry must run.
 */
export const SAVE_SHARE_GRACE_MS = 60_000;

function releaseSave(key: string, pending: Promise<SaveOutcome>): void {
  if (savesInFlight.get(key) === pending) savesInFlight.delete(key);
}

function startSave(key: string, save: () => Promise<SaveOutcome>): Promise<SaveOutcome> {
  const pending = save();
  savesInFlight.set(key, pending);
  pending.then(
    (out) => {
      if (out.ok) setTimeout(() => releaseSave(key, pending), SAVE_SHARE_GRACE_MS).unref?.();
      else releaseSave(key, pending);
    },
    () => releaseSave(key, pending),
  );
  return pending;
}

/**
 * Run `save` once per key in this process: a request whose key is already
 * saving (or saved within the grace) shares that save's outcome. When the
 * shared save stopped because ITS client went away (AreaQueryAborted, before
 * anything was written) and this client is still here, the first such waiter
 * starts the retry and REGISTERS it under the same key, so any other waiter
 * shares the retry instead of saving again.
 */
export async function sharedSave(
  key: string | null,
  signal: AbortSignal,
  save: () => Promise<SaveOutcome>,
): Promise<SaveOutcome> {
  if (!key) return save();
  for (;;) {
    const shared = savesInFlight.get(key);
    if (!shared) return startSave(key, save);
    try {
      return await shared;
    } catch (e) {
      if (!(e instanceof AreaQueryAborted) || signal.aborted) throw e;
      releaseSave(key, shared);
    }
  }
}

const stateSchema = z.string().trim().regex(/^[A-Za-z]{2}$/, "state must be a two-letter code");

// .strict(): a misspelled filter is refused, not silently dropped — a list
// built without a filter the customer thinks they applied is the wrong list.
const queryShape = {
  state: stateSchema,
  county: z.string().trim().min(1).max(120),
  acreageMin: z.number().finite().min(0).max(1_000_000).optional(),
  acreageMax: z.number().finite().min(0).max(1_000_000).optional(),
  ownerTypes: z.array(z.enum(OWNER_TYPES)).min(1).max(OWNER_TYPES.length).optional(),
  yearsOwnedMin: z.number().int().min(1).max(100).optional(),
};
const previewSchema = z.object(queryShape).strict();
const commitSchema = z
  .object({
    ...queryShape,
    name: z.string().trim().min(1).max(120),
    expectedCount: z.number().int().min(0),
  })
  .strict();

function refuse(res: Response, r: ListBuilderRefusal): void {
  switch (r.kind) {
    case "bad_request":
      return Errors.badRequest(res, r.message, r.details);
    case "unprocessable":
      return Errors.unprocessable(res, r.message, r.details);
    case "conflict":
      return sendError(res, 409, "CONFLICT", r.message, r.details);
    case "plan_limit":
      // 429 LIMIT_EXCEEDED like Errors.limitExceeded, but with the plan's own
      // words — that helper's fixed copy is about request RATE, which this is not.
      return sendError(res, 429, "LIMIT_EXCEEDED", r.message, r.details);
    case "source_error":
      return sendError(res, 502, "COUNTY_SOURCE_FAILED", r.message, r.details);
  }
}

/** The client went away mid-read: nothing to answer, nothing was saved. */
function abandoned(req: AuthenticatedRequest, what: "preview" | "commit"): void {
  logger.info(`[list-builder] ${what} abandoned by the client; county read stopped`, {
    source: "list-builder",
    metadata: { organizationId: req.organization?.id ?? null },
  });
}

export function registerListBuilderRoutes(app: Express): void {
  app.get(
    "/api/list-builder/counties",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = stateSchema.safeParse(req.query.state);
      if (!parsed.success) return Errors.badRequest(res, "A two-letter state is required.");
      try {
        return res.json({ counties: await countyOptionsForState(parsed.data) });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );

  app.post(
    "/api/list-builder/preview",
    isAuthenticated,
    getOrCreateOrg,
    previewLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = previewSchema.safeParse(req.body);
      if (!parsed.success) return Errors.badRequest(res, "Those list filters aren't valid.", parsed.error.issues);
      try {
        const out = await previewCountyList(getOrganizationId(req), parsed.data, { signal: clientGone(res) });
        if (!out.ok) return refuse(res, out);
        return res.json(out.preview);
      } catch (error) {
        if (error instanceof AreaQueryAborted) return abandoned(req, "preview");
        return Errors.internal(res, error);
      }
    },
  );

  app.post(
    "/api/list-builder/commit",
    isAuthenticated,
    getOrCreateOrg,
    requirePermission("canImportData"),
    requireScope("deal_write"),
    // Before the limiter: replaying a finished save costs nothing and must
    // not be refused as a new one.
    idempotencyMiddleware,
    commitLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = commitSchema.safeParse(req.body);
      if (!parsed.success) return Errors.badRequest(res, "That list can't be saved as sent.", parsed.error.issues);
      try {
        const organizationId = getOrganizationId(req);
        const rawKey = req.headers["idempotency-key"];
        const key = typeof rawKey === "string" && rawKey.trim() ? `${organizationId}:${rawKey.trim()}` : null;
        const signal = clientGone(res);
        const out = await sharedSave(key, signal, () => commitCountyList(organizationId, parsed.data, { signal }));
        if (!out.ok) return refuse(res, out);
        // 200, not 201: a raw status write is held at zero new occurrences by
        // the res-status-raw ratchet, and the client keys on the body.
        return res.json(out.list);
      } catch (error) {
        if (error instanceof AreaQueryAborted) return abandoned(req, "commit");
        return Errors.internal(res, error);
      }
    },
  );

  app.get(
    "/api/list-builder/lists",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        return res.json(await listCountyLists(getOrganizationId(req), LISTS_PAGE));
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );
}
