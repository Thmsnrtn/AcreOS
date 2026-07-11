/**
 * Fix-and-flip vertical FF-3 — contractor management + 1099-NEC.
 *
 * Devon §4: "1099-NEC for every sub I paid >$600 — Fail. No contractor
 * entity, no W-9 storage, no YTD totals, no form generator. This is my
 * single biggest tax workflow and it's missing."
 *
 *   GET    /api/contractors                              — list w/ YTD
 *   GET    /api/contractors/:id                          — single + recent payments
 *   POST   /api/contractors                              — create
 *   PATCH  /api/contractors/:id                          — update
 *   DELETE /api/contractors/:id                          — delete
 *   POST   /api/contractors/:id/payments                 — record payment
 *   GET    /api/contractors/:id/payments?taxYear=        — list payments
 *   GET    /api/contractors/1099-nec-batch?taxYear=YYYY  — preview batch
 *   POST   /api/contractors/1099-nec-batch?taxYear=YYYY  — generate PDFs
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "./db";
import {
  contractors,
  contractorPayments,
  organizations,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { assertEntityBelongsToOrg } from "./utils/orgScope";
import { generate1099NecPdf, type Nec1099Form } from "./services/form1099NecPdf";

const NEC_THRESHOLD_CENTS = 60000;  // $600.00 — IRS 1099-NEC threshold

const createContractorSchema = z.object({
  name: z.string().min(1).max(200),
  businessName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  }).optional(),
  licenseNumber: z.string().optional(),
  insuranceExpiresAt: z.string().optional(),
  trades: z.array(z.string()).optional(),
  taxIdEncrypted: z.string().optional(),  // operator types raw, server encrypts (TODO: wire)
  taxIdType: z.enum(["ein", "ssn"]).optional(),
  legalEntityName: z.string().optional(),
  notes: z.string().optional(),
});

const updateContractorSchema = createContractorSchema.partial();

const paymentSchema = z.object({
  amountCents: z.coerce.number().int().nonnegative(),
  paidAt: z.string(),
  method: z.string().optional(),
  referenceNumber: z.string().optional(),
  memo: z.string().optional(),
  rehabId: z.string().uuid().optional(),
  rehabLineItemId: z.string().uuid().optional(),
  taxYear: z.coerce.number().int().min(2020).max(2100).optional(),
  excludedFrom1099: z.boolean().default(false),
});

function maskTaxId(raw: string | null | undefined, type: string | null | undefined): string {
  if (!raw) return "—";
  // Show last 4 only.
  const last4 = raw.replace(/[^0-9]/g, "").slice(-4);
  if (type === "ein") return `XX-XXX${last4}`;
  return `XXX-XX-${last4}`;
}

async function recomputeContractorTotals(orgId: number, contractorId: string) {
  const ytdYear = new Date().getFullYear();
  const [ytdRow] = await db.execute(sql`
    SELECT COALESCE(SUM(amount_cents), 0) AS ytd
    FROM contractor_payments
    WHERE contractor_id = ${contractorId}
      AND organization_id = ${orgId}
      AND tax_year = ${ytdYear}
      AND excluded_from_1099 = false
  `).then((r: any) => r.rows ?? []);
  const [lifetimeRow] = await db.execute(sql`
    SELECT COALESCE(SUM(amount_cents), 0) AS total
    FROM contractor_payments
    WHERE contractor_id = ${contractorId}
      AND organization_id = ${orgId}
  `).then((r: any) => r.rows ?? []);

  await db.update(contractors).set({
    ytdPaidCents: Number((ytdRow as any)?.ytd ?? 0),
    lifetimePaidCents: Number((lifetimeRow as any)?.total ?? 0),
    updatedAt: new Date(),
  }).where(eq(contractors.id, contractorId));
}

export function registerContractorRoutes(app: Express): void {
  // List
  app.get("/api/contractors", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const rows = await db.select().from(contractors)
        .where(eq(contractors.organizationId, orgId))
        .orderBy(desc(contractors.ytdPaidCents));
      return res.json({
        contractors: rows.map((r) => ({
          ...r,
          taxIdMasked: maskTaxId(r.taxIdEncrypted, r.taxIdType),
          taxIdEncrypted: undefined,
        })),
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // 1099-NEC batch routes — registered BEFORE /api/contractors/:id so the
  // literal path wins; the :id matcher was capturing "1099-nec-batch" and
  // 404ing the whole 1099 surface (2026-07-11 full-app sweep).
  // 1099-NEC batch preview — list contractors over $600 for the year.
  app.get("/api/contractors/1099-nec-batch", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsedYear = parseInt(String(req.query.taxYear ?? new Date().getFullYear()), 10);
      const taxYear = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear();

      const rows = await db.execute(sql`
        SELECT c.id, c.name, c.business_name, c.legal_entity_name, c.email, c.address, c.tax_id_encrypted, c.tax_id_type,
               COALESCE(SUM(p.amount_cents), 0) AS total_cents
        FROM contractors c
        LEFT JOIN contractor_payments p
          ON p.contractor_id = c.id
         AND p.organization_id = c.organization_id
         AND p.tax_year = ${taxYear}
         AND p.excluded_from_1099 = false
        WHERE c.organization_id = ${orgId}
        GROUP BY c.id, c.name, c.business_name, c.legal_entity_name, c.email, c.address, c.tax_id_encrypted, c.tax_id_type
        HAVING COALESCE(SUM(p.amount_cents), 0) >= ${NEC_THRESHOLD_CENTS}
        ORDER BY total_cents DESC
      `);

      const contractorList = ((rows as any).rows ?? []).map((r: any) => {
        const issues: string[] = [];
        if (!r.tax_id_encrypted) issues.push("missing tax ID");
        if (!r.legal_entity_name && !r.name) issues.push("missing legal name");
        if (!r.address || !r.address.line1) issues.push("missing address");
        return {
          id: r.id,
          name: r.legal_entity_name ?? r.business_name ?? r.name,
          totalCents: Number(r.total_cents) || 0,
          taxIdMasked: maskTaxId(r.tax_id_encrypted, r.tax_id_type),
          email: r.email,
          issues,
          ready: issues.length === 0,
        };
      });

      return res.json({
        taxYear,
        thresholdCents: NEC_THRESHOLD_CENTS,
        contractorCount: contractorList.length,
        readyCount: contractorList.filter((c: any) => c.ready).length,
        blockedCount: contractorList.filter((c: any) => !c.ready).length,
        contractors: contractorList,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // 1099-NEC batch generate — emit one PDF per ready contractor, base64-encoded.
  app.post("/api/contractors/1099-nec-batch", isAuthenticated, getOrCreateOrg, requireRole(["owner", "admin"]), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const taxYear = parseInt(String(req.query.taxYear ?? req.body?.taxYear ?? new Date().getFullYear()), 10);

      const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
      if (!org) return Errors.notFound(res, "Organization");

      const orgTaxAddress = (org as any).taxAddress ?? null;
      const payerAddress = orgTaxAddress ?? {
        line1: "(payer address not configured)", city: "—", state: "—", zip: "—",
      };

      const rows = await db.execute(sql`
        SELECT c.id, c.name, c.business_name, c.legal_entity_name, c.email, c.address, c.tax_id_encrypted, c.tax_id_type,
               COALESCE(SUM(p.amount_cents), 0) AS total_cents
        FROM contractors c
        LEFT JOIN contractor_payments p
          ON p.contractor_id = c.id
         AND p.organization_id = c.organization_id
         AND p.tax_year = ${taxYear}
         AND p.excluded_from_1099 = false
        WHERE c.organization_id = ${orgId}
        GROUP BY c.id, c.name, c.business_name, c.legal_entity_name, c.email, c.address, c.tax_id_encrypted, c.tax_id_type
        HAVING COALESCE(SUM(p.amount_cents), 0) >= ${NEC_THRESHOLD_CENTS}
      `);

      const eligible = ((rows as any).rows ?? []).filter((r: any) =>
        r.tax_id_encrypted && r.address?.line1 && (r.legal_entity_name || r.name)
      );

      const forms: Array<{ contractorId: string; name: string; pdfBase64: string }> = [];
      for (const r of eligible) {
        const form: Nec1099Form = {
          taxYear,
          payer: {
            name: (org as any).legalEntityName ?? org.name ?? "Payer",
            address: payerAddress,
            phone: (org as any).phone ?? undefined,
            taxIdMasked: maskTaxId((org as any).ein ?? null, "ein"),
          },
          recipient: {
            name: r.name,
            legalEntityName: r.legal_entity_name ?? r.business_name ?? undefined,
            address: r.address,
            taxIdMasked: maskTaxId(r.tax_id_encrypted, r.tax_id_type),
          },
          nonemployeeCompensationCents: Number(r.total_cents) || 0,
        };
        const pdf = generate1099NecPdf(form);
        forms.push({
          contractorId: r.id,
          name: form.recipient.legalEntityName ?? form.recipient.name,
          pdfBase64: pdf.toString("base64"),
        });
      }

      logger.info("[FF-3] 1099-NEC batch generated", {
        orgId, userId, taxYear, formCount: forms.length, eligibleCount: eligible.length,
      });

      return res.json({
        taxYear,
        formCount: forms.length,
        forms,
        warning: "Recipient copies (Copy B). Paper IRS filing requires red-ink Copy A — use IRS FIRE / IRIS for electronic filing.",
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Detail
  app.get("/api/contractors/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [c] = await db.select().from(contractors)
        .where(and(eq(contractors.id, req.params.id), eq(contractors.organizationId, orgId)));
      if (!c) return Errors.notFound(res, "Contractor");

      const payments = await db.select().from(contractorPayments)
        .where(and(eq(contractorPayments.contractorId, c.id), eq(contractorPayments.organizationId, orgId)))
        .orderBy(desc(contractorPayments.paidAt))
        .limit(50);

      return res.json({
        contractor: {
          ...c,
          taxIdMasked: maskTaxId(c.taxIdEncrypted, c.taxIdType),
          taxIdEncrypted: undefined,
        },
        payments,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Create
  app.post("/api/contractors", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = createContractorSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [created] = await db.insert(contractors).values({
        organizationId: orgId,
        name: parsed.data.name,
        businessName: parsed.data.businessName ?? null,
        email: parsed.data.email || null,
        phone: parsed.data.phone ?? null,
        address: parsed.data.address ?? null,
        licenseNumber: parsed.data.licenseNumber ?? null,
        insuranceExpiresAt: parsed.data.insuranceExpiresAt ?? null,
        trades: parsed.data.trades ?? [],
        taxIdEncrypted: parsed.data.taxIdEncrypted ?? null,  // TODO: encrypt at rest in follow-on
        taxIdType: parsed.data.taxIdType ?? null,
        legalEntityName: parsed.data.legalEntityName ?? null,
        notes: parsed.data.notes ?? null,
      }).returning();

      logger.info("[FF-3] contractor created", { orgId, userId, contractorId: created.id });
      return res.status(201).json({ contractor: { ...created, taxIdEncrypted: undefined } });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Update
  app.patch("/api/contractors/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = updateContractorSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
        if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
      }
      const [updated] = await db.update(contractors).set(updates)
        .where(and(eq(contractors.id, req.params.id), eq(contractors.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Contractor");
      return res.json({ contractor: { ...updated, taxIdEncrypted: undefined } });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Delete
  app.delete("/api/contractors/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [deleted] = await db.delete(contractors)
        .where(and(eq(contractors.id, req.params.id), eq(contractors.organizationId, orgId)))
        .returning({ id: contractors.id });
      if (!deleted) return Errors.notFound(res, "Contractor");
      return res.json({ deleted: true, id: deleted.id });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Record payment
  app.post("/api/contractors/:id/payments", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = paymentSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [c] = await db.select({ id: contractors.id }).from(contractors)
        .where(and(eq(contractors.id, req.params.id), eq(contractors.organizationId, orgId)));
      if (!c) return Errors.notFound(res, "Contractor");

      // Lens 48 — body-supplied rehab / rehab-line-item FKs must be in
      // the same tenant. Without this an attacker can write payments
      // pointed at another org's rehab, contaminating 1099 reports.
      if (parsed.data.rehabId) {
        const ok = await assertEntityBelongsToOrg("rehab", parsed.data.rehabId, orgId);
        if (!ok) return Errors.notFound(res, "Rehab");
      }
      if (parsed.data.rehabLineItemId) {
        const ok = await assertEntityBelongsToOrg("rehabLineItem", parsed.data.rehabLineItemId, orgId);
        if (!ok) return Errors.notFound(res, "Rehab line item");
      }

      const taxYear = parsed.data.taxYear ?? new Date(parsed.data.paidAt).getFullYear();

      const [payment] = await db.insert(contractorPayments).values({
        organizationId: orgId,
        contractorId: c.id as string,
        rehabId: parsed.data.rehabId ?? null,
        rehabLineItemId: parsed.data.rehabLineItemId ?? null,
        amountCents: parsed.data.amountCents,
        paidAt: parsed.data.paidAt,
        method: parsed.data.method ?? null,
        referenceNumber: parsed.data.referenceNumber ?? null,
        memo: parsed.data.memo ?? null,
        taxYear,
        excludedFrom1099: parsed.data.excludedFrom1099,
      }).returning();

      await recomputeContractorTotals(orgId, c.id as string);
      return res.status(201).json({ payment });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Payments list (per contractor + year)
  app.get("/api/contractors/:id/payments", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const taxYear = req.query.taxYear ? parseInt(String(req.query.taxYear), 10) : null;
      const conditions = [
        eq(contractorPayments.contractorId, req.params.id),
        eq(contractorPayments.organizationId, orgId),
      ];
      if (taxYear !== null) conditions.push(eq(contractorPayments.taxYear, taxYear));
      const rows = await db.select().from(contractorPayments)
        .where(and(...conditions))
        .orderBy(desc(contractorPayments.paidAt));
      const totalCents = rows.reduce((sum, r) => sum + (r.excludedFrom1099 ? 0 : r.amountCents), 0);
      return res.json({ payments: rows, totalCents, taxYear });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

}
