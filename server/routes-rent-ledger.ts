/**
 * Buy-and-hold vertical BH-3 — rent ledger + state-aware late-fee engine.
 *
 * Imelda §2.4-§2.5:
 *   "Anyone shipping landlord rent collection has to ship a state-rule
 *    engine, not just a templated email."
 *   "If Maria in Unit 3B owes \$1,400 and pays \$700 on the 5th and \$700
 *    on the 18th, my system needs to know that the first \$700 doesn't
 *    satisfy the rent and doesn't stop the late-fee clock unless I say so.
 *    In Texas, accepting partial rent after filing a notice to vacate can
 *    void the notice and force me to start over."
 *
 *   POST  /api/leases/:id/rent-charges/seed     — generate next 12 months
 *   GET   /api/leases/:id/ledger                — full ledger (charges + payments)
 *   POST  /api/leases/:id/payments              — record payment (partial-aware)
 *   POST  /api/rent-charges/:id/apply-late-fee  — apply state-rule late fee
 *   POST  /api/rent-charges/:id/legal-posture   — flip to notice_served / etc
 *   GET   /api/late-fee-rules                   — list seeded rules
 *   GET   /api/rent/aging                       — org-wide aging buckets
 *
 * Stripe ACH integration is OUT OF SCOPE for this PR (Imelda flags it as
 * money-transmitter territory in some states). The rent_payment row
 * accepts a stripe_payment_intent_id when wired but defaults to manual
 * receipt entry.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, asc, desc, sql, gt, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  rentalLeases,
  rentCharges,
  rentPayments,
  lateFeeRules,
  properties,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

const seedSchema = z.object({
  monthsAhead: z.coerce.number().int().min(1).max(24).default(12),
  startMonth: z.string().optional(),  // ISO YYYY-MM-01; default = next month
});

const paymentSchema = z.object({
  amountCents: z.coerce.number().int().nonnegative(),
  receivedAt: z.string(),
  method: z.string().optional(),
  referenceNumber: z.string().optional(),
  payorType: z.enum(["tenant", "hap"]).default("tenant"),
  payorTenantId: z.string().uuid().optional(),
  acceptedDespitePartial: z.boolean().default(false),
  notes: z.string().optional(),
});

const postureSchema = z.object({
  legalPosture: z.enum(["ok", "late", "notice_served", "eviction_filed"]),
  notes: z.string().optional(),
});

// ----------------------------------------------------------------------------
// Late-fee compute — pulled from late_fee_rules table seeded in BH-1.
// ----------------------------------------------------------------------------

interface LateFeeContext {
  monthlyRentCents: number;
  daysLate: number;
  unitCount: number;  // 1 for SFR, > 1 for multifamily
  state: string;
}

async function computeLateFee(orgId: number, ctx: LateFeeContext): Promise<{ feeCents: number; rule: any | null; explanation: string }> {
  const [rule] = await db.select().from(lateFeeRules).where(eq(lateFeeRules.state, ctx.state.toUpperCase()));
  if (!rule) {
    return { feeCents: 0, rule: null, explanation: `No late-fee rule for ${ctx.state}; no fee applied.` };
  }
  if (ctx.daysLate <= rule.graceDays) {
    return { feeCents: 0, rule, explanation: `${ctx.daysLate} days late, within ${rule.graceDays}-day grace.` };
  }
  const capPct = ctx.unitCount >= 4 ? rule.capPctLargeProperty : rule.capPctSmallProperty;
  const capPctNum = capPct ? parseFloat(String(capPct)) : null;
  const capByPct = capPctNum !== null ? Math.round(ctx.monthlyRentCents * capPctNum) : null;
  const capFlat = rule.capFlatCents ?? null;
  // Initial fee + per-day after grace
  const daysAfterGrace = ctx.daysLate - rule.graceDays;
  const initial = rule.initialFeeCents ?? 0;
  const perDay = (rule.perDayCents ?? 0) * daysAfterGrace;
  let feeCents = initial + perDay;
  // If neither initial nor per-day is set, default to the cap (flat 10% etc).
  if (feeCents === 0 && capByPct !== null) feeCents = capByPct;
  // Apply cap.
  if (capByPct !== null) feeCents = Math.min(feeCents, capByPct);
  if (capFlat !== null) feeCents = Math.min(feeCents, capFlat);

  return {
    feeCents,
    rule,
    explanation: `${ctx.state} rule: cap ${capPctNum ? `${(capPctNum * 100).toFixed(0)}%` : "flat"}, ${rule.graceDays}d grace; ${ctx.daysLate}d late → \$${(feeCents / 100).toFixed(2)} fee.`,
  };
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

export function registerRentLedgerRoutes(app: Express): void {
  // List late-fee rules (read-only).
  app.get("/api/late-fee-rules", isAuthenticated, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const rules = await db.select().from(lateFeeRules).orderBy(asc(lateFeeRules.state));
      return res.json({ rules });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Seed N months of recurring rent charges from a lease.
  app.post("/api/leases/:id/rent-charges/seed", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = seedSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [lease] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
      if (!lease) return Errors.notFound(res, "Lease");

      const startMonth = parsed.data.startMonth
        ? new Date(parsed.data.startMonth)
        : new Date();
      // Snap to first of next month.
      const seedStart = new Date(startMonth.getFullYear(), startMonth.getMonth() + (parsed.data.startMonth ? 0 : 1), 1);

      const charges = [];
      for (let i = 0; i < parsed.data.monthsAhead; i++) {
        const month = new Date(seedStart.getFullYear(), seedStart.getMonth() + i, 1);
        const dueDay = Math.min(lease.rentDueDayOfMonth, new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate());
        const dueDate = new Date(month.getFullYear(), month.getMonth(), dueDay);
        charges.push({
          organizationId: orgId,
          leaseId: lease.id,
          chargedForMonth: month.toISOString().slice(0, 10),
          dueDate: dueDate.toISOString().slice(0, 10),
          amountCents: lease.monthlyRentCents,
          hapPortionCents: lease.isSection8 ? lease.hapPortionCents : null,
          tenantPortionCents: lease.isSection8 ? lease.tenantPortionCents : null,
          paidCents: 0,
          balanceCents: lease.monthlyRentCents,
        });
      }

      // Idempotent — ON CONFLICT on (lease_id, charged_for_month) skips dupes.
      const inserted: any[] = [];
      for (const c of charges) {
        const result = await db.insert(rentCharges).values(c).onConflictDoNothing().returning();
        if (result.length > 0) inserted.push(result[0]);
      }

      logger.info("[BH-3] rent charges seeded", { orgId, userId, leaseId: lease.id, count: inserted.length });
      return res.status(201).json({ inserted: inserted.length });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Lease ledger — charges with payment breakdown.
  app.get("/api/leases/:id/ledger", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [lease] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
      if (!lease) return Errors.notFound(res, "Lease");

      const charges = await db.select().from(rentCharges)
        .where(and(eq(rentCharges.leaseId, lease.id), eq(rentCharges.organizationId, orgId)))
        .orderBy(asc(rentCharges.chargedForMonth));

      const payments = await db.select().from(rentPayments)
        .where(and(eq(rentPayments.leaseId, lease.id), eq(rentPayments.organizationId, orgId)))
        .orderBy(desc(rentPayments.receivedAt));

      const paymentsByCharge = new Map<string, any[]>();
      for (const p of payments) {
        if (p.rentChargeId) {
          if (!paymentsByCharge.has(p.rentChargeId)) paymentsByCharge.set(p.rentChargeId, []);
          paymentsByCharge.get(p.rentChargeId)!.push(p);
        }
      }
      const chargesWithPayments = charges.map((c) => ({
        ...c,
        payments: paymentsByCharge.get(c.id) ?? [],
      }));

      const totalDueCents = charges.reduce((s, c) => s + c.amountCents, 0);
      const totalPaidCents = charges.reduce((s, c) => s + c.paidCents, 0);
      const totalBalanceCents = charges.reduce((s, c) => s + c.balanceCents, 0);
      const totalLateFeesCents = charges.reduce((s, c) => s + c.lateFeeCents, 0);

      return res.json({
        lease,
        charges: chargesWithPayments,
        unappliedPayments: payments.filter((p) => !p.rentChargeId),
        totals: {
          totalDueCents,
          totalPaidCents,
          totalBalanceCents,
          totalLateFeesCents,
        },
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Record payment — applies to oldest open charge first; partial-aware.
  app.post("/api/leases/:id/payments", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = paymentSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [lease] = await db.select().from(rentalLeases)
        .where(and(eq(rentalLeases.id, req.params.id), eq(rentalLeases.organizationId, orgId)));
      if (!lease) return Errors.notFound(res, "Lease");

      // Find oldest open charge.
      const [openCharge] = await db.select().from(rentCharges)
        .where(and(
          eq(rentCharges.leaseId, lease.id),
          eq(rentCharges.organizationId, orgId),
          gt(rentCharges.balanceCents, 0),
        ))
        .orderBy(asc(rentCharges.chargedForMonth))
        .limit(1);

      const isPartial = openCharge ? parsed.data.amountCents < openCharge.balanceCents : false;
      // Imelda §2.5: "accepting partial rent after filing a notice to
      // vacate can void the notice." Check posture and warn if accepting.
      if (isPartial && openCharge && openCharge.legalPosture === "notice_served" && !parsed.data.acceptedDespitePartial) {
        return sendError(res, 409, "partial_payment_voids_notice", "Partial payment after notice-to-vacate may void the notice. Set acceptedDespitePartial=true to override and accept.", {
          openChargeId: openCharge.id,
          balanceCents: openCharge.balanceCents,
        });
      }

      const payment = await db.transaction(async (tx) => {
        const [p] = await tx.insert(rentPayments).values({
          organizationId: orgId,
          leaseId: lease.id,
          rentChargeId: openCharge?.id ?? null,
          payorType: parsed.data.payorType,
          payorTenantId: parsed.data.payorTenantId ?? null,
          amountCents: parsed.data.amountCents,
          receivedAt: parsed.data.receivedAt,
          method: parsed.data.method ?? null,
          referenceNumber: parsed.data.referenceNumber ?? null,
          isPartial,
          acceptedDespitePartial: isPartial ? parsed.data.acceptedDespitePartial : null,
          notes: parsed.data.notes ?? null,
        }).returning();

        if (openCharge) {
          const newPaid = openCharge.paidCents + parsed.data.amountCents;
          const newBalance = Math.max(0, openCharge.amountCents + openCharge.lateFeeCents - newPaid);
          await tx.update(rentCharges).set({
            paidCents: newPaid,
            balanceCents: newBalance,
            // If now fully paid, reset legal posture to ok.
            legalPosture: newBalance === 0 ? "ok" : openCharge.legalPosture,
            legalPostureAt: newBalance === 0 ? new Date() : openCharge.legalPostureAt,
            updatedAt: new Date(),
          }).where(eq(rentCharges.id, openCharge.id));
        }

        return p;
      });

      logger.info("[BH-3] rent payment recorded", { orgId, userId, leaseId: lease.id, amountCents: parsed.data.amountCents, isPartial });
      return res.status(201).json({ payment, isPartial });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Apply state-rule late fee to a charge.
  app.post("/api/rent-charges/:id/apply-late-fee", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [charge] = await db.select().from(rentCharges)
        .where(and(eq(rentCharges.id, req.params.id), eq(rentCharges.organizationId, orgId)));
      if (!charge) return Errors.notFound(res, "Rent charge");

      const [lease] = await db.select().from(rentalLeases).where(eq(rentalLeases.id, charge.leaseId as string));
      if (!lease) return Errors.notFound(res, "Lease");

      // Unit count from property.
      const [prop] = await db.select({ id: properties.id }).from(properties)
        .where(eq(properties.id, lease.propertyId));
      // We don't have a unit_count on properties yet — assume 1 SFR / 4+ multifam
      // based on lease.unitLabel presence. Conservative: small_property by default.
      const unitCount = lease.unitLabel ? 4 : 1;

      const today = new Date();
      const due = new Date(charge.dueDate);
      const daysLate = Math.floor((today.getTime() - due.getTime()) / 86_400_000);

      const result = await computeLateFee(orgId, {
        monthlyRentCents: lease.monthlyRentCents,
        daysLate,
        unitCount,
        state: lease.state,
      });

      if (result.feeCents > 0) {
        await db.update(rentCharges).set({
          lateFeeCents: charge.lateFeeCents + result.feeCents,
          balanceCents: charge.balanceCents + result.feeCents,
          lateFeeAppliedAt: new Date(),
          legalPosture: charge.legalPosture === "ok" ? "late" : charge.legalPosture,
          updatedAt: new Date(),
        }).where(eq(rentCharges.id, charge.id));
      }

      return res.json({
        feeCents: result.feeCents,
        explanation: result.explanation,
        rule: result.rule,
        daysLate,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Update legal posture explicitly (operator action).
  app.post("/api/rent-charges/:id/legal-posture", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = postureSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [updated] = await db.update(rentCharges).set({
        legalPosture: parsed.data.legalPosture,
        legalPostureAt: new Date(),
        notes: parsed.data.notes ?? null,
        updatedAt: new Date(),
      })
        .where(and(eq(rentCharges.id, req.params.id), eq(rentCharges.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Rent charge");

      logger.info("[BH-3] legal posture changed", { orgId, userId, chargeId: updated.id, posture: parsed.data.legalPosture });
      return res.json({ charge: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Org-wide aging buckets — Imelda §3 portfolio: "Aging buckets are right
  // shape, wrong source. Wire them to rent-roll late-pay data."
  app.get("/api/rent/aging", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const today = new Date().toISOString().slice(0, 10);
      const rows = await db.execute(sql`
        SELECT
          rc.id, rc.lease_id, rc.charged_for_month, rc.due_date,
          rc.amount_cents, rc.balance_cents, rc.late_fee_cents,
          rc.legal_posture,
          (CURRENT_DATE - rc.due_date) AS days_overdue
        FROM rent_charges rc
        WHERE rc.organization_id = ${orgId}
          AND rc.balance_cents > 0
        ORDER BY rc.due_date ASC
      `);

      const charges = ((rows as any).rows ?? []).map((r: any) => ({
        ...r,
        days_overdue: Number(r.days_overdue) || 0,
      }));
      const buckets = {
        current: charges.filter((c: any) => c.days_overdue <= 0),
        d1_30: charges.filter((c: any) => c.days_overdue > 0 && c.days_overdue <= 30),
        d31_60: charges.filter((c: any) => c.days_overdue > 30 && c.days_overdue <= 60),
        d61_90: charges.filter((c: any) => c.days_overdue > 60 && c.days_overdue <= 90),
        d90_plus: charges.filter((c: any) => c.days_overdue > 90),
      };

      const totalsByBucket = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [
        k,
        { count: v.length, totalCents: v.reduce((s: number, c: any) => s + Number(c.balance_cents), 0) },
      ]));

      return res.json({ asOf: today, totalsByBucket, charges });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Overnight rent receipts — the Imelda "answer-the-phone-from-the-truck"
  // surface needs a single read that says "X dollars came in since 12:01am,
  // Y of it was HAP." `since` is an ISO timestamp (date or datetime); the
  // route trims it to a date for the DB column (rent_payments.received_at
  // is a date, not a timestamp).
  app.get("/api/rent-ledger/summary", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const rawSince = typeof req.query.since === "string" ? req.query.since : null;
      const todayIso = new Date().toISOString().slice(0, 10);
      // Normalize "2026-05-26" or "2026-05-26T00:00:00.000Z" -> "2026-05-26".
      // Anything unparseable falls back to today (start of day in server tz),
      // which matches the Today-tab intent without surfacing a 400.
      let sinceDate = todayIso;
      if (rawSince) {
        const parsed = new Date(rawSince);
        if (Number.isFinite(parsed.getTime())) {
          sinceDate = parsed.toISOString().slice(0, 10);
        }
      }

      const totalsRow = await db.execute(sql`
        SELECT
          COUNT(*)::int AS payments_count,
          COALESCE(SUM(amount_cents), 0)::bigint AS total_cents,
          COALESCE(SUM(CASE WHEN payor_type = 'hap' THEN amount_cents ELSE 0 END), 0)::bigint AS hap_cents,
          COALESCE(SUM(CASE WHEN payor_type = 'tenant' THEN amount_cents ELSE 0 END), 0)::bigint AS tenant_cents
        FROM rent_payments
        WHERE organization_id = ${orgId}
          AND received_at >= ${sinceDate}::date
      `);
      const r = ((totalsRow as any).rows?.[0]) ?? {};
      return res.json({
        since: sinceDate,
        paymentsCount: Number(r.payments_count) || 0,
        totalCents: Number(r.total_cents) || 0,
        hapCents: Number(r.hap_cents) || 0,
        tenantCents: Number(r.tenant_cents) || 0,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
