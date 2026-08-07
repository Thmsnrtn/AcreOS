/**
 * Fix-and-flip vertical FF-2 — rehab budget builder.
 *
 * Devon §5.1: "A real rehabs table + rehab_line_items (category, scope,
 * vendor, budgeted, committed, spent, variance, photos). Templated
 * scopes — kitchen mid-grade, bath gut, roof tear-off & replace, exterior
 * paint — with default $/sqft so a new flipper can baseline."
 *
 * Routes:
 *   GET    /api/rehabs                     — list rehabs for org
 *   GET    /api/rehabs/:id                 — single rehab w/ line items + totals
 *   POST   /api/rehabs                     — create
 *   PATCH  /api/rehabs/:id                 — update top-level fields
 *   POST   /api/rehabs/:id/line-items      — append line item
 *   PATCH  /api/rehab-line-items/:id       — update line item
 *   DELETE /api/rehab-line-items/:id       — delete line item
 *   POST   /api/rehabs/:id/seed-template   — apply a scope template
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, asc, desc, sql, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  rehabs,
  rehabLineItems,
  REHAB_STATUSES,
  REHAB_LINE_CATEGORIES,
  properties,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { emitRehabStatusChange } from "./services/rehabEvents";
import { logger } from "./utils/logger";

// ----------------------------------------------------------------------------
// Scope templates — Devon §5.1: "Templated scopes — kitchen mid-grade, bath
// gut, roof tear-off & replace, exterior paint — with default $/sqft so a
// new flipper can baseline."
// ----------------------------------------------------------------------------

interface ScopeTemplateLine {
  category: typeof REHAB_LINE_CATEGORIES[number];
  scope: string;
  perSqftCents?: number;          // multiply by sqft for budget
  fixedCents?: number;            // flat amount
}

interface ScopeTemplate {
  key: string;
  label: string;
  description: string;
  lines: ScopeTemplateLine[];
}

const SCOPE_TEMPLATES: ScopeTemplate[] = [
  {
    key: "atlanta_starter_3br_2ba_1500sqft",
    label: "Atlanta starter — 3BR/2BA ~1500 sqft",
    description: "Entry-level rehab in Atlanta metro. ~$50-65K total at 1500 sqft (Devon's typical project).",
    lines: [
      { category: "demolition",     scope: "Interior demo + dumpster", fixedCents: 280000 },
      { category: "kitchen",        scope: "Kitchen — mid-grade gut", fixedCents: 1200000 },
      { category: "bathroom",       scope: "2 bath gut & finish", fixedCents: 1400000 },
      { category: "flooring",       scope: "LVP throughout", perSqftCents: 350 },
      { category: "interior_paint", scope: "Interior paint", perSqftCents: 200 },
      { category: "exterior_paint", scope: "Exterior paint + trim", fixedCents: 350000 },
      { category: "hvac",           scope: "HVAC condenser + servicing", fixedCents: 450000 },
      { category: "electrical",     scope: "Outlets + fixtures", fixedCents: 250000 },
      { category: "plumbing",       scope: "Repairs + fixtures", fixedCents: 200000 },
      { category: "trim_doors",     scope: "Doors + trim package", fixedCents: 350000 },
      { category: "appliances",     scope: "Stainless appliance package", fixedCents: 280000 },
      { category: "punch_list",     scope: "Punch list + cleaning", fixedCents: 150000 },
      { category: "contingency",    scope: "10% contingency reserve", perSqftCents: 600 },
    ],
  },
  {
    key: "kitchen_midgrade",
    label: "Kitchen — mid-grade",
    description: "Mid-grade kitchen rehab: cabinets, counters, appliances, backsplash, fixtures. ~$12K standalone.",
    lines: [
      { category: "kitchen", scope: "Cabinets (mid-grade)", fixedCents: 600000 },
      { category: "kitchen", scope: "Quartz countertops", fixedCents: 280000 },
      { category: "kitchen", scope: "Tile backsplash", fixedCents: 90000 },
      { category: "appliances", scope: "Stainless appliance package", fixedCents: 280000 },
      { category: "plumbing", scope: "Sink + faucet", fixedCents: 50000 },
    ],
  },
  {
    key: "bath_gut",
    label: "Bath gut + finish",
    description: "Full bathroom gut: tile, vanity, fixtures, tub or walk-in. ~$7K standalone.",
    lines: [
      { category: "demolition", scope: "Bath demo", fixedCents: 80000 },
      { category: "plumbing", scope: "Rough-in + fixtures", fixedCents: 250000 },
      { category: "bathroom", scope: "Tile floor + walls", fixedCents: 220000 },
      { category: "bathroom", scope: "Vanity + counter + mirror", fixedCents: 120000 },
    ],
  },
  {
    key: "roof_tear_off_replace",
    label: "Roof — tear-off + replace",
    description: "Asphalt shingle tear-off and full replacement. ~$8-12K depending on sqft.",
    lines: [
      { category: "roof", scope: "Tear-off + decking inspection", perSqftCents: 250 },
      { category: "roof", scope: "Architectural shingle install", perSqftCents: 550 },
    ],
  },
];

const TEMPLATES_BY_KEY = new Map(SCOPE_TEMPLATES.map((t) => [t.key, t]));

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

const createRehabSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  name: z.string().min(1).max(200),
  status: z.enum(REHAB_STATUSES).default("planning"),
  startedAt: z.string().optional(),
  plannedListingDate: z.string().optional(),
  purchasePriceCents: z.coerce.number().int().nonnegative().optional(),
  purchaseClosingCents: z.coerce.number().int().nonnegative().optional(),
  budgetTotalCents: z.coerce.number().int().nonnegative().optional(),
  holdingCostMonthlyCents: z.coerce.number().int().nonnegative().optional(),
  arvCents: z.coerce.number().int().nonnegative().optional(),
  targetMarginCents: z.coerce.number().int().optional(),
  lenderName: z.string().optional(),
  lenderLoanCents: z.coerce.number().int().nonnegative().optional(),
  lenderRateBps: z.coerce.number().int().nonnegative().optional(),
});

const updateRehabSchema = createRehabSchema.partial().omit({ propertyId: true });

const lineItemSchema = z.object({
  category: z.enum(REHAB_LINE_CATEGORIES),
  scope: z.string().min(1).max(500),
  contractorId: z.string().uuid().optional().nullable(),
  budgetCents: z.coerce.number().int().nonnegative().default(0),
  committedCents: z.coerce.number().int().nonnegative().default(0),
  spentCents: z.coerce.number().int().nonnegative().default(0),
  startedAt: z.string().optional().nullable(),
  completedAt: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const lineItemUpdateSchema = lineItemSchema.partial();

const seedTemplateSchema = z.object({
  templateKey: z.string(),
  sqft: z.coerce.number().int().nonnegative().optional(),
  replaceExisting: z.boolean().default(false),
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function recomputeRehabSpend(orgId: number, rehabId: string) {
  const [agg] = await db.execute(sql`
    SELECT COALESCE(SUM(spent_cents), 0) AS spent
    FROM rehab_line_items
    WHERE rehab_id = ${rehabId} AND organization_id = ${orgId}
  `).then((r: any) => r.rows ?? []);
  if (agg) {
    await db.update(rehabs).set({
      spentTotalCents: Number(agg.spent) || 0,
      updatedAt: new Date(),
    }).where(eq(rehabs.id, rehabId));
  }
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

export function registerRehabRoutes(app: Express): void {
  app.get("/api/rehab-scope-templates", isAuthenticated, async (_req: AuthenticatedRequest, res: Response) => {
    return res.json({
      templates: SCOPE_TEMPLATES.map((t) => ({
        key: t.key,
        label: t.label,
        description: t.description,
        lineCount: t.lines.length,
      })),
    });
  });

  app.get("/api/rehabs", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const rows = await db
        .select({
          id: rehabs.id,
          propertyId: rehabs.propertyId,
          name: rehabs.name,
          status: rehabs.status,
          startedAt: rehabs.startedAt,
          plannedListingDate: rehabs.plannedListingDate,
          purchasePriceCents: rehabs.purchasePriceCents,
          budgetTotalCents: rehabs.budgetTotalCents,
          spentTotalCents: rehabs.spentTotalCents,
          arvCents: rehabs.arvCents,
          updatedAt: rehabs.updatedAt,
        })
        .from(rehabs)
        .where(eq(rehabs.organizationId, orgId))
        .orderBy(desc(rehabs.updatedAt));
      return res.json({ rehabs: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/rehabs/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [r] = await db
        .select()
        .from(rehabs)
        .where(and(eq(rehabs.id, req.params.id), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      const items = await db
        .select()
        .from(rehabLineItems)
        .where(and(
          eq(rehabLineItems.rehabId, r.id as string),
          eq(rehabLineItems.organizationId, orgId),
        ))
        .orderBy(asc(rehabLineItems.sequence), asc(rehabLineItems.createdAt));

      // Variance per item + per category roll-up.
      const byCategory: Record<string, { budget: number; committed: number; spent: number; variance: number }> = {};
      let totalBudget = 0;
      let totalCommitted = 0;
      let totalSpent = 0;
      for (const it of items) {
        const b = it.budgetCents;
        const c = it.committedCents;
        const s = it.spentCents;
        totalBudget += b;
        totalCommitted += c;
        totalSpent += s;
        const cat = byCategory[it.category] ?? { budget: 0, committed: 0, spent: 0, variance: 0 };
        cat.budget += b; cat.committed += c; cat.spent += s; cat.variance = cat.spent - cat.budget;
        byCategory[it.category] = cat;
      }

      // Daily holding-cost meter — Devon §3.5: "When my GC says 'we're a
      // week behind,' I want the platform to translate that into '$2,140
      // in additional carry, here's the new break-even sale price.'"
      let daysOnSite: number | null = null;
      if (r.startedAt) {
        const startedMs = new Date(r.startedAt).getTime();
        if (Number.isFinite(startedMs)) {
          daysOnSite = Math.floor((Date.now() - startedMs) / 86_400_000);
        }
      }
      const holdingDaily = r.holdingCostMonthlyCents ? Math.round(r.holdingCostMonthlyCents / 30) : null;
      const accruedHoldingCents = holdingDaily !== null && daysOnSite !== null
        ? holdingDaily * daysOnSite
        : null;

      return res.json({
        rehab: r,
        items,
        totals: {
          budgetCents: totalBudget,
          committedCents: totalCommitted,
          spentCents: totalSpent,
          varianceCents: totalSpent - totalBudget,
          byCategory,
          daysOnSite,
          accruedHoldingCents,
        },
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/rehabs", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = createRehabSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [prop] = await db
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.id, parsed.data.propertyId), eq(properties.organizationId, orgId)));
      if (!prop) return Errors.notFound(res, "Property");

      const [created] = await db.insert(rehabs).values({
        organizationId: orgId,
        propertyId: parsed.data.propertyId,
        name: parsed.data.name,
        status: parsed.data.status,
        startedAt: parsed.data.startedAt ?? null,
        plannedListingDate: parsed.data.plannedListingDate ?? null,
        purchasePriceCents: parsed.data.purchasePriceCents ?? null,
        purchaseClosingCents: parsed.data.purchaseClosingCents ?? null,
        budgetTotalCents: parsed.data.budgetTotalCents ?? null,
        holdingCostMonthlyCents: parsed.data.holdingCostMonthlyCents ?? null,
        arvCents: parsed.data.arvCents ?? null,
        targetMarginCents: parsed.data.targetMarginCents ?? null,
        lenderName: parsed.data.lenderName ?? null,
        lenderLoanCents: parsed.data.lenderLoanCents ?? null,
        lenderRateBps: parsed.data.lenderRateBps ?? null,
      }).returning();

      logger.info("[FF-2] rehab created", { orgId, userId, rehabId: created.id, propertyId: parsed.data.propertyId });
      return res.status(201).json({ rehab: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.patch("/api/rehabs/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = updateRehabSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of [
        "name", "status", "startedAt", "plannedListingDate",
        "purchasePriceCents", "purchaseClosingCents", "budgetTotalCents",
        "holdingCostMonthlyCents", "arvCents", "targetMarginCents",
        "lenderName", "lenderLoanCents", "lenderRateBps",
      ] as const) {
        if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
      }
      // Capture the pre-image status so the workflow emitter can detect a
      // GENUINE status transition (audit Wave 1 — wire the fix-and-flip
      // milestone loop). Only needed when status is actually being changed.
      let beforeStatus: string | null = null;
      if (parsed.data.status !== undefined) {
        const [prev] = await db
          .select({ status: rehabs.status })
          .from(rehabs)
          .where(and(eq(rehabs.id, req.params.id), eq(rehabs.organizationId, orgId)));
        beforeStatus = prev?.status ?? null;
      }
      const [updated] = await db.update(rehabs).set(updates)
        .where(and(eq(rehabs.id, req.params.id), eq(rehabs.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Rehab");
      // Fire the flip lifecycle workflow on a real status transition
      // (fire-and-forget; a workflow failure never fails the rehab write).
      emitRehabStatusChange(beforeStatus, updated);
      return res.json({ rehab: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/rehabs/:id/line-items", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = lineItemSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [r] = await db.select({ id: rehabs.id }).from(rehabs)
        .where(and(eq(rehabs.id, req.params.id), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      const [maxRow] = await db.execute(sql`SELECT COALESCE(MAX(sequence), -1) AS m FROM rehab_line_items WHERE rehab_id = ${r.id}`).then((res: any) => res.rows ?? []);
      const seq = (Number((maxRow as any)?.m) ?? -1) + 1;

      const [item] = await db.insert(rehabLineItems).values({
        organizationId: orgId,
        rehabId: r.id as string,
        sequence: seq,
        category: parsed.data.category,
        scope: parsed.data.scope,
        contractorId: parsed.data.contractorId ?? null,
        budgetCents: parsed.data.budgetCents,
        committedCents: parsed.data.committedCents,
        spentCents: parsed.data.spentCents,
        startedAt: parsed.data.startedAt ?? null,
        completedAt: parsed.data.completedAt ?? null,
        notes: parsed.data.notes ?? null,
      }).returning();

      await recomputeRehabSpend(orgId, r.id as string);
      return res.status(201).json({ item });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.patch("/api/rehab-line-items/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = lineItemUpdateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of [
        "category", "scope", "contractorId", "budgetCents",
        "committedCents", "spentCents", "startedAt", "completedAt", "notes",
      ] as const) {
        if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
      }
      const [updated] = await db.update(rehabLineItems).set(updates)
        .where(and(eq(rehabLineItems.id, req.params.id), eq(rehabLineItems.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Line item");
      await recomputeRehabSpend(orgId, updated.rehabId as string);
      return res.json({ item: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.delete("/api/rehab-line-items/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [deleted] = await db.delete(rehabLineItems)
        .where(and(eq(rehabLineItems.id, req.params.id), eq(rehabLineItems.organizationId, orgId)))
        .returning();
      if (!deleted) return Errors.notFound(res, "Line item");
      await recomputeRehabSpend(orgId, deleted.rehabId as string);
      return res.json({ deleted: true, id: deleted.id });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // FF-8 — flipper dashboard widget data (replaces FLIPPER_MOCK).
  // Devon §1 thirty-second verdict: "The dashboard widget for my persona
  // shows 'Active Rehabs' with three properties and a BudgetBar — and when
  // I open the file (type-specific-widgets.tsx), it's pulling from
  // FLIPPER_MOCK. Hardcoded mock data."
  app.get("/api/flipper/dashboard", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const activeStatuses = ["planning", "demo", "framing", "rough_ins", "drywall", "finishes", "punch_list", "listed", "under_contract"];

      const statusList = sql.join(activeStatuses.map(s => sql`${s}`), sql`, `);
      const rows = await db.execute(sql`
        SELECT id, name, status, started_at, planned_listing_date,
               purchase_price_cents, budget_total_cents, spent_total_cents,
               arv_cents, holding_cost_monthly_cents
        FROM rehabs
        WHERE organization_id = ${orgId}
          AND status IN (${statusList})
        ORDER BY updated_at DESC
        LIMIT 5
      `);

      const activeRehabs = ((rows as any).rows ?? []).map((r: any) => {
        const budget = Number(r.budget_total_cents) || 0;
        const spent = Number(r.spent_total_cents) || 0;
        return {
          id: r.id,
          name: r.name,
          status: r.status,
          budgetCents: budget,
          spentCents: spent,
          spentPct: budget > 0 ? Math.round((spent / budget) * 100) : 0,
          arvCents: Number(r.arv_cents) || null,
          plannedListingDate: r.planned_listing_date,
        };
      });

      if (activeRehabs.length === 0) {
        return res.json({ hasData: false });
      }

      const totalBudget = activeRehabs.reduce((s: number, r: any) => s + r.budgetCents, 0);
      const totalSpent = activeRehabs.reduce((s: number, r: any) => s + r.spentCents, 0);

      // Stalled draws — past inspection date and not funded yet.
      const today = new Date().toISOString().slice(0, 10);
      const stalledRows = await db.execute(sql`
        SELECT COUNT(*) AS c
        FROM construction_draws cd
        WHERE cd.organization_id = ${orgId}
          AND cd.status IN ('requested', 'inspected')
          AND cd.inspection_at IS NOT NULL
          AND cd.inspection_at <= ${today}::date
          AND cd.funded_at IS NULL
      `);
      const stalledDraws = Number(((stalledRows as any).rows?.[0]?.c) ?? 0);

      // YTD-eligible 1099 contractors (over $600 paid this year, not excluded).
      const taxYear = new Date().getFullYear();
      const necRows = await db.execute(sql`
        SELECT COUNT(*) AS c FROM (
          SELECT contractor_id, SUM(amount_cents) AS total
          FROM contractor_payments
          WHERE organization_id = ${orgId}
            AND tax_year = ${taxYear}
            AND excluded_from_1099 = false
          GROUP BY contractor_id
          HAVING SUM(amount_cents) >= 60000
        ) t
      `);
      const necEligible = Number(((necRows as any).rows?.[0]?.c) ?? 0);

      return res.json({
        hasData: true,
        activeRehabs,
        totals: {
          totalBudgetCents: totalBudget,
          totalSpentCents: totalSpent,
          spentPct: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0,
        },
        stalledDraws,
        necEligible,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/rehabs/:id/seed-template", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = seedTemplateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const tpl = TEMPLATES_BY_KEY.get(parsed.data.templateKey);
      if (!tpl) return Errors.badRequest(res, `Unknown template ${parsed.data.templateKey}`);

      const [r] = await db.select({ id: rehabs.id }).from(rehabs)
        .where(and(eq(rehabs.id, req.params.id), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      const sqft = parsed.data.sqft ?? 1500;

      if (parsed.data.replaceExisting) {
        await db.delete(rehabLineItems)
          .where(and(eq(rehabLineItems.rehabId, r.id as string), eq(rehabLineItems.organizationId, orgId)));
      }

      const [maxRow] = await db.execute(sql`SELECT COALESCE(MAX(sequence), -1) AS m FROM rehab_line_items WHERE rehab_id = ${r.id}`).then((res: any) => res.rows ?? []);
      let seq = (Number((maxRow as any)?.m) ?? -1) + 1;

      const inserts = tpl.lines.map((line) => {
        const budget = line.fixedCents ?? Math.round((line.perSqftCents ?? 0) * sqft);
        return {
          organizationId: orgId,
          rehabId: r.id as string,
          sequence: seq++,
          category: line.category,
          scope: line.scope,
          budgetCents: budget,
          committedCents: 0,
          spentCents: 0,
        };
      });
      const inserted = await db.insert(rehabLineItems).values(inserts).returning();
      await recomputeRehabSpend(orgId, r.id as string);

      return res.status(201).json({ inserted: inserted.length, sqft });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
