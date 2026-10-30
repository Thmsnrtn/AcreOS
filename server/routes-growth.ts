/**
 * W5b growth routes — every one behind an existing customer door, none a new
 * destination:
 *
 *   Deals door (leads)     PATCH /api/leads/:id/outreach-language
 *                          POST  /api/lead-imports/parse-spreadsheet
 *                          POST  /api/lead-imports/batches
 *                          GET   /api/lead-imports/batches
 *                          POST  /api/lead-imports/batches/:id/undo
 *   Pax (ambient)          GET/PATCH /api/pax/language
 *   Settings               GET   /api/sms/a2p-registration
 *                          POST  /api/sms/a2p-registration/refresh
 *                          POST  /api/sms/a2p-registration/self-report
 *   Map door               GET   /api/maps/offline-pack
 *   Today door             GET   /api/today/first-deal
 *   Finance door           GET   /api/finance/outcome
 *
 * Every query is scoped to the caller's organization.
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requirePermission } from "./utils/permissions";
import { getOrganizationId, getUserId, type AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { db } from "./db";
import { leads, properties, users } from "@shared/schema";
import { OUTREACH_LANGUAGES, OUTREACH_LANGUAGE_SOURCES, outreachLanguageForLead } from "@shared/outreach/outreachLanguage";
import { A2P_STATUSES } from "@shared/sms/a2p10dlc";
import { OFFLINE_AREA_MAX_PARCELS } from "@shared/map/offlineSources";
import { IMPORT_FORMAT_PRESETS } from "@shared/leads/importFormats";
import { clock } from "./utils/clock";
import { routeParam } from "./utils/routeParams";

const PAX_LANGUAGES = ["auto", "en", "es"] as const;

export function registerGrowthRoutes(app: Express): void {
  // ── Outreach language for one owner (the ONE writer of these columns) ────
  const languageBody = z.object({
    language: z.enum(OUTREACH_LANGUAGES).nullable(),
    source: z.enum(OUTREACH_LANGUAGE_SOURCES).optional(),
  });
  app.patch(
    "/api/leads/:id/outreach-language",
    isAuthenticated,
    getOrCreateOrg,
    requirePermission("canEditLeads"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const leadId = Number(routeParam(req.params.id));
        if (!Number.isInteger(leadId) || leadId <= 0) return Errors.badRequest(res, "Invalid lead id");
        const parsed = languageBody.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
        const { language } = parsed.data;
        if (language !== null && !parsed.data.source) {
          return Errors.badRequest(res, "Say who chose the language: source is 'customer_choice' or 'owner_stated'.");
        }
        // The language and its source come ONLY from this request — what the
        // customer chose or what the owner said. Nothing about the lead
        // (name, address, county) is read to decide it.
        const [row] = await db
          .update(leads)
          .set({
            outreachLanguage: language,
            outreachLanguageSource: language === null ? null : parsed.data.source!,
            outreachLanguageSetAt: language === null ? null : clock.now(),
            updatedAt: clock.now(),
          })
          .where(and(eq(leads.organizationId, orgId), eq(leads.id, leadId), isNull(leads.deletedAt)))
          .returning({ id: leads.id, outreachLanguage: leads.outreachLanguage, outreachLanguageSource: leads.outreachLanguageSource });
        if (!row) return Errors.notFound(res, "Lead");
        return res.json({ leadId: row.id, ...outreachLanguageForLead(row) });
      } catch (err) {
        return Errors.internal(res, err as Error);
      }
    },
  );

  // ── Pax language (the user's own setting) ───────────────────────────────
  app.get("/api/pax/language", isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const [u] = await db.select({ paxLanguage: users.paxLanguage }).from(users).where(eq(users.id, userId)).limit(1);
      return res.json({ language: u?.paxLanguage ?? "auto" });
    } catch (err) {
      return Errors.internal(res, err as Error);
    }
  });
  app.patch("/api/pax/language", isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = getUserId(req);
      const parsed = z.object({ language: z.enum(PAX_LANGUAGES) }).safeParse(req.body ?? {});
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const stored = parsed.data.language === "auto" ? null : parsed.data.language;
      const [u] = await db.update(users).set({ paxLanguage: stored }).where(eq(users.id, userId)).returning({ id: users.id });
      if (!u) return Errors.notFound(res, "User");
      return res.json({ language: parsed.data.language });
    } catch (err) {
      return Errors.internal(res, err as Error);
    }
  });

  // ── A2P 10DLC registration (Settings → Integrations) ─────────────────────
  app.get("/api/sms/a2p-registration", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const { getA2pRegistration, a2pGateForSms } = await import("./services/sms/a2pRegistration");
      const { orgByoTwilioNumber } = await import("./services/comms/providers/twilio");
      const { numberKindOf } = await import("@shared/sms/a2p10dlc");
      // The verdict shown is the SAME function the send chokepoint applies.
      const [registration, twilioNumber, sendVerdict] = await Promise.all([getA2pRegistration(orgId), orgByoTwilioNumber(orgId), a2pGateForSms(orgId)]);
      return res.json({
        connected: twilioNumber ? { provider: "twilio", phoneNumber: twilioNumber, numberKind: numberKindOf(twilioNumber), readableByAcreOS: numberKindOf(twilioNumber) === "10dlc" } : null,
        registration,
        sendVerdict,
      });
    } catch (err) {
      return Errors.internal(res, err as Error);
    }
  });
  app.post(
    "/api/sms/a2p-registration/refresh",
    isAuthenticated,
    getOrCreateOrg,
    requirePermission("canAccessSettings"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { refreshA2pFromProvider } = await import("./services/sms/a2pRegistration");
        const out = await refreshA2pFromProvider(getOrganizationId(req));
        if (!out.ok) {
          return out.reason === "provider_error"
            ? Errors.serviceUnavailable(res, out.message)
            : Errors.badRequest(res, out.message, { reason: out.reason });
        }
        return res.json({ registration: out.registration });
      } catch (err) {
        return Errors.internal(res, err as Error);
      }
    },
  );
  const selfReportBody = z.object({
    provider: z.string().min(1).max(60),
    phoneNumber: z.string().min(7).max(20),
    brandStatus: z.enum(A2P_STATUSES),
    campaignStatus: z.enum(A2P_STATUSES),
    brandId: z.string().max(80).optional(),
    campaignId: z.string().max(80).optional(),
  });
  app.post(
    "/api/sms/a2p-registration/self-report",
    isAuthenticated,
    getOrCreateOrg,
    requirePermission("canAccessSettings"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = selfReportBody.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
        const { selfReportA2p } = await import("./services/sms/a2pRegistration");
        const out = await selfReportA2p(getOrganizationId(req), req.user?.id ?? null, parsed.data);
        if (!out.ok) return Errors.badRequest(res, out.message, { reason: out.reason });
        return res.json({ registration: out.registration });
      } catch (err) {
        return Errors.internal(res, err as Error);
      }
    },
  );

  // ── One-click migration import ───────────────────────────────────────────
  app.post(
    "/api/lead-imports/parse-spreadsheet",
    isAuthenticated,
    getOrCreateOrg,
    requirePermission("canImportData"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = z.object({ fileName: z.string().max(255), base64: z.string().min(1).max(14_000_000) }).safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
        const { readXlsx, XlsxReadError } = await import("./services/imports/xlsxReader");
        const { DATA_IMPORT_JOB_MAX_ROWS } = await import("@shared/product-limits");
        try {
          const out = readXlsx(Buffer.from(parsed.data.base64, "base64"), { maxRows: DATA_IMPORT_JOB_MAX_ROWS });
          return res.json(out);
        } catch (e) {
          if (e instanceof XlsxReadError) return Errors.badRequest(res, e.message);
          throw e;
        }
      } catch (err) {
        return Errors.internal(res, err as Error);
      }
    },
  );
  const batchBody = z.object({
    sourceFormat: z.string().min(1).max(60),
    fileName: z.string().max(255).nullable().optional(),
    rowCount: z.number().int().nonnegative(),
  });
  app.post(
    "/api/lead-imports/batches",
    isAuthenticated,
    getOrCreateOrg,
    requirePermission("canImportData"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = batchBody.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
        const known = new Set(["mapped", ...IMPORT_FORMAT_PRESETS.map((p) => p.id)]);
        if (!known.has(parsed.data.sourceFormat)) return Errors.badRequest(res, "Unknown source format");
        const { createImportBatch } = await import("./services/leads/importBatches");
        const batch = await createImportBatch(getOrganizationId(req), req.user?.id ?? null, {
          sourceFormat: parsed.data.sourceFormat,
          fileName: parsed.data.fileName ?? null,
          rowCount: parsed.data.rowCount,
        });
        return res.json({ id: batch.id });
      } catch (err) {
        return Errors.internal(res, err as Error);
      }
    },
  );
  app.get("/api/lead-imports/batches", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { listImportBatches } = await import("./services/leads/importBatches");
      return res.json({ batches: await listImportBatches(getOrganizationId(req)) });
    } catch (err) {
      return Errors.internal(res, err as Error);
    }
  });
  app.post(
    "/api/lead-imports/batches/:id/undo",
    isAuthenticated,
    getOrCreateOrg,
    requirePermission("canImportData"),
    requirePermission("canDeleteLeads"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const batchId = Number(routeParam(req.params.id));
        if (!Number.isInteger(batchId) || batchId <= 0) return Errors.badRequest(res, "Invalid import id");
        const { undoImportBatch } = await import("./services/leads/importBatches");
        const out = await undoImportBatch(getOrganizationId(req), batchId, req.user?.id ?? null);
        if (!out.ok) {
          return out.reason === "not_found" ? Errors.notFound(res, "Import") : Errors.badRequest(res, "This import was already undone.");
        }
        return res.json(out);
      } catch (err) {
        return Errors.internal(res, err as Error);
      }
    },
  );

  // ── Offline parcel facts for one area (Map door) ─────────────────────────
  app.get("/api/maps/offline-pack", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const box = z
        .object({
          west: z.coerce.number().min(-180).max(180),
          south: z.coerce.number().min(-90).max(90),
          east: z.coerce.number().min(-180).max(180),
          north: z.coerce.number().min(-90).max(90),
        })
        .safeParse(req.query);
      if (!box.success) return Errors.validationFailed(res, box.error.issues);
      const { west, south, east, north } = box.data;
      if (east - west > 2 || north - south > 2) return Errors.badRequest(res, "An offline area can span at most 2 degrees.");
      const lat = sql`coalesce(${properties.latitude}::float8, (${properties.parcelCentroid}->>'lat')::float8)`;
      const lng = sql`coalesce(${properties.longitude}::float8, (${properties.parcelCentroid}->>'lng')::float8)`;
      const rows = await db
        .select({
          id: properties.id,
          apn: properties.apn,
          county: properties.county,
          state: properties.state,
          acres: properties.sizeAcres,
          address: properties.address,
          status: properties.status,
          zoning: properties.zoning,
          roadAccess: properties.roadAccess,
          assessedValue: properties.assessedValue,
          lat: sql<number | null>`${lat}`,
          lng: sql<number | null>`${lng}`,
          boundary: properties.parcelBoundary,
        })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, orgId),
            sql`${properties.deletedAt} IS NULL`,
            sql`${lat} BETWEEN ${south} AND ${north}`,
            sql`${lng} BETWEEN ${west} AND ${east}`,
          ),
        )
        .limit(OFFLINE_AREA_MAX_PARCELS + 1);
      return res.json({ parcels: rows.slice(0, OFFLINE_AREA_MAX_PARCELS), truncated: rows.length > OFFLINE_AREA_MAX_PARCELS });
    } catch (err) {
      return Errors.internal(res, err as Error);
    }
  });

  // ── Today: the next step toward a first deal ─────────────────────────────
  app.get("/api/today/first-deal", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { firstDealStepForOrg } = await import("./services/growth/firstDealProgram");
      const step = await firstDealStepForOrg(getOrganizationId(req));
      if (!step) return Errors.notFound(res, "Organization");
      return res.json(step);
    } catch (err) {
      return Errors.internal(res, err as Error);
    }
  });

  // ── Finance: deals closed and realised profit ────────────────────────────
  app.get("/api/finance/outcome", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { customerOutcomeForOrg } = await import("./services/growth/customerOutcome");
      return res.json(await customerOutcomeForOrg(getOrganizationId(req)));
    } catch (err) {
      return Errors.internal(res, err as Error);
    }
  });
}
