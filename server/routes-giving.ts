/**
 * Giving (W5a) — $1 per paying member per month, AcreOS's own money.
 *
 * FOUNDER (Decisions door → Giving):
 *   GET  /api/founder/giving                       — months, mapping, cap, receipts
 *   PUT  /api/founder/giving/cap                   — the monthly cap (cents)
 *   POST /api/founder/giving/food-banks            — county → food bank (hand entry)
 *   POST /api/founder/giving/months/:id/approve    — approve within the cap
 *   POST /api/founder/giving/months/:id/decline
 *   POST /api/founder/giving/receipts              — money paid outside AcreOS
 *
 * MEMBER (Settings door → "Your membership makes a difference"):
 *   GET  /api/giving/membership                    — receipted totals only
 *   PUT  /api/giving/area                          — the member's own county
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated, requireFounder } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { getOrganizationId, getUserId, type AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { isCalendarDate } from "@shared/dates/calendar";
import {
  approveGivingMonth,
  declineGivingMonth,
  founderGivingView,
  memberGivingPanelFor,
  recordGivingReceipt,
  setGivingCapCents,
  setMemberGivingArea,
  upsertFoodBank,
} from "./services/trust/givingService";

const stateCode = z.string().trim().regex(/^[A-Za-z]{2}$/, "Two-letter state code");

export function registerGivingRoutes(app: Express): void {
  app.get("/api/founder/giving", isAuthenticated, requireFounder, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      return res.json(await founderGivingView());
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.put("/api/founder/giving/cap", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = z.object({ capCents: z.number().int().min(0).max(10_000_000) }).strict().safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      await setGivingCapCents(parsed.data.capCents, getUserId(req));
      return res.json({ ok: true });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/founder/giving/food-banks", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = z
      .object({
        state: stateCode,
        county: z.string().trim().min(2).max(80),
        name: z.string().trim().min(2).max(160),
        website: z.string().trim().url().max(300).optional().nullable(),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      await upsertFoodBank({ ...parsed.data, website: parsed.data.website ?? null });
      return res.json({ ok: true });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/founder/giving/months/:id/approve", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return Errors.badRequest(res, "Invalid month id");
    const parsed = z.object({ amountCents: z.number().int() }).strict().safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      const result = await approveGivingMonth({
        monthId: id,
        amountCents: parsed.data.amountCents,
        // Set by requireFounder itself — not a body field a caller can claim.
        approverIsFounder: req.isFounder === true,
        founderId: getUserId(req),
      });
      if (!result.ok) return Errors.badRequest(res, result.reason);
      return res.json(result);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/founder/giving/months/:id/decline", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return Errors.badRequest(res, "Invalid month id");
    try {
      if (!(await declineGivingMonth(id, getUserId(req)))) return Errors.badRequest(res, "That month is not awaiting a decision.");
      return res.json({ ok: true });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/founder/giving/receipts", isAuthenticated, requireFounder, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = z
      .object({
        month: z.string().regex(/^\d{4}-\d{2}$/),
        foodBankId: z.number().int(),
        amountCents: z.number().int(),
        reference: z.string().trim().min(3).max(200),
        receiptUrl: z.string().trim().url().max(500).optional().nullable(),
        paidOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine((v) => isCalendarDate(v), "Not a real calendar date"),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      const result = await recordGivingReceipt({ ...parsed.data, receiptUrl: parsed.data.receiptUrl ?? null, founderId: getUserId(req) });
      if (!result.ok) return Errors.badRequest(res, result.reason);
      return res.json(result);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/giving/membership", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      return res.json(await memberGivingPanelFor(getOrganizationId(req)));
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.put("/api/giving/area", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = z
      .object({ area: z.object({ state: stateCode, county: z.string().trim().min(2).max(80) }).strict().nullable() })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      await setMemberGivingArea(getOrganizationId(req), parsed.data.area);
      return res.json({ ok: true });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
