/**
 * Fix-and-flip vertical FF-6 — construction-draw schedule.
 *
 * Devon §3.5: "I'm two months into 1247 Maple. My private lender funds in
 * three draws: 25% / 50% / 25%, each gated on inspection. I need a draw
 * schedule view showing draws taken, draws remaining, inspection dates,
 * lender contact, % complete per draw."
 *
 *   GET    /api/rehabs/:id/draws         — schedule + summary
 *   POST   /api/rehabs/:id/draws         — append a draw
 *   POST   /api/rehabs/:id/draws/seed    — quick-seed 25/50/25 split
 *   PATCH  /api/draws/:id                — update status / dates / inspector
 *   DELETE /api/draws/:id
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, asc, sql } from "drizzle-orm";
import { db } from "./db";
import { constructionDraws, rehabs, DRAW_STATUSES } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const drawSchema = z.object({
  label: z.string().min(1).max(120),
  pctOfLoan: z.coerce.number().min(0).max(1),
  amountCents: z.coerce.number().int().nonnegative(),
  status: z.enum(DRAW_STATUSES).default("planned"),
  requestedAt: z.string().optional(),
  inspectionAt: z.string().optional(),
  fundedAt: z.string().optional(),
  inspectorName: z.string().optional(),
  inspectorContact: z.string().optional(),
  notes: z.string().optional(),
});

const updateSchema = drawSchema.partial();

const seedSchema = z.object({
  loanCents: z.coerce.number().int().nonnegative().optional(),
  splits: z.array(z.coerce.number().min(0).max(1)).optional(),  // [0.25, 0.5, 0.25] default
});

export function registerConstructionDrawRoutes(app: Express): void {
  app.get("/api/rehabs/:id/draws", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const rehabId = req.params.id;

      const [r] = await db.select({
        id: rehabs.id,
        lenderName: rehabs.lenderName,
        lenderLoanCents: rehabs.lenderLoanCents,
        lenderRateBps: rehabs.lenderRateBps,
      }).from(rehabs)
        .where(and(eq(rehabs.id, rehabId), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      const draws = await db.select().from(constructionDraws)
        .where(and(eq(constructionDraws.rehabId, rehabId), eq(constructionDraws.organizationId, orgId)))
        .orderBy(asc(constructionDraws.sequence));

      const fundedCents = draws.filter((d) => d.status === "funded").reduce((s, d) => s + d.amountCents, 0);
      const remainingCents = (r.lenderLoanCents ?? 0) - fundedCents;
      const fundedPct = r.lenderLoanCents && r.lenderLoanCents > 0 ? Math.round((fundedCents / r.lenderLoanCents) * 100) : 0;

      // Daily interest accrual on the funded portion (simple).
      const dailyInterestCents = r.lenderRateBps && r.lenderLoanCents
        ? Math.round((fundedCents * (r.lenderRateBps / 10000)) / 365)
        : null;

      return res.json({
        rehab: r,
        draws,
        summary: {
          drawCount: draws.length,
          fundedCents,
          remainingCents,
          fundedPct,
          dailyInterestCents,
        },
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/rehabs/:id/draws", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const rehabId = req.params.id;
      const parsed = drawSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [r] = await db.select({ id: rehabs.id }).from(rehabs)
        .where(and(eq(rehabs.id, rehabId), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      const [maxRow] = await db.execute(sql`SELECT COALESCE(MAX(sequence), 0) AS m FROM construction_draws WHERE rehab_id = ${rehabId}`).then((res: any) => res.rows ?? []);
      const seq = (Number((maxRow as any)?.m) ?? 0) + 1;

      const [created] = await db.insert(constructionDraws).values({
        organizationId: orgId,
        rehabId,
        sequence: seq,
        label: parsed.data.label,
        pctOfLoan: String(parsed.data.pctOfLoan),
        amountCents: parsed.data.amountCents,
        status: parsed.data.status,
        requestedAt: parsed.data.requestedAt ?? null,
        inspectionAt: parsed.data.inspectionAt ?? null,
        fundedAt: parsed.data.fundedAt ?? null,
        inspectorName: parsed.data.inspectorName ?? null,
        inspectorContact: parsed.data.inspectorContact ?? null,
        notes: parsed.data.notes ?? null,
      }).returning();

      logger.info("[FF-6] draw added", { orgId, userId, rehabId, drawId: created.id });
      return res.status(201).json({ draw: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/rehabs/:id/draws/seed", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const rehabId = req.params.id;
      const parsed = seedSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [r] = await db.select({ id: rehabs.id, lenderLoanCents: rehabs.lenderLoanCents }).from(rehabs)
        .where(and(eq(rehabs.id, rehabId), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      const loan = parsed.data.loanCents ?? r.lenderLoanCents ?? 0;
      if (loan <= 0) return Errors.badRequest(res, "Set lender loan amount on the rehab first, or pass loanCents.");

      const splits = parsed.data.splits ?? [0.25, 0.5, 0.25];
      const sum = splits.reduce((s, v) => s + v, 0);
      if (Math.abs(sum - 1.0) > 0.001) return Errors.badRequest(res, `Splits must sum to 1.0; got ${sum}`);

      // Wipe existing draws first — seed is intended for greenfield use.
      await db.delete(constructionDraws)
        .where(and(eq(constructionDraws.rehabId, rehabId), eq(constructionDraws.organizationId, orgId)));

      const inserts = splits.map((pct, idx) => ({
        organizationId: orgId,
        rehabId,
        sequence: idx + 1,
        label: `Draw ${idx + 1} (${Math.round(pct * 100)}%)`,
        pctOfLoan: String(pct),
        amountCents: Math.round(loan * pct),
        status: "planned" as const,
      }));
      const created = await db.insert(constructionDraws).values(inserts).returning();
      return res.status(201).json({ created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.patch("/api/draws/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
        if (parsed.data[k] !== undefined) {
          updates[k] = k === "pctOfLoan" ? String(parsed.data[k]) : parsed.data[k];
        }
      }
      const [updated] = await db.update(constructionDraws).set(updates)
        .where(and(eq(constructionDraws.id, req.params.id), eq(constructionDraws.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Draw");
      return res.json({ draw: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.delete("/api/draws/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [deleted] = await db.delete(constructionDraws)
        .where(and(eq(constructionDraws.id, req.params.id), eq(constructionDraws.organizationId, orgId)))
        .returning({ id: constructionDraws.id });
      if (!deleted) return Errors.notFound(res, "Draw");
      return res.json({ deleted: true, id: deleted.id });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
